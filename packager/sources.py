"""One function per public data source. Every service is asked for EPSG:2272 (PA South, ftUS).

Endpoints are the ones proven in the earlier prototype (groundwork/packages/data/src/live.ts),
plus USGS NHD streams and the USGS 3DEP source index (new here).
"""

import io
import math
import re
from datetime import datetime, timezone

import numpy as np
from shapely.geometry import LineString, MultiLineString, Polygon, box, shape
from shapely.geometry.polygon import orient
from shapely.ops import linemerge, unary_union

from .net import FetchError, envelope_params
from .projection import FTUS_PER_M, ft_to_lonlat, lonlat_to_ft

EPSG = 2272


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------------------------
# Source catalogue (ids are what metadata.sources / features[*].source refer to)
# ---------------------------------------------------------------------------------------------

CENSUS_GEOCODER = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress"
DEM_SERVICE = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer"
DEM_INDEX = "https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer/11"
NHD_FLOWLINES = "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6"
NWI_WETLANDS = "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0"
FEMA_FLOOD = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28"
OVERPASS = "https://overpass-api.de/api/interpreter"

# County parcel and road services, keyed by county name as the Census geocoder returns it.
# To add a county: find its public ArcGIS parcel layer and fill in the same fields.
COUNTIES = {
    "Lebanon": {
        "parcels": {
            "url": "https://services1.arcgis.com/9TQ9L457YNtHSPdi/arcgis/rest/services/LebCoTaxParcels/FeatureServer/0",
            "name": "Lebanon County GIS tax parcels",
            "addressField": "SITUS_ADDR",
            "idField": "MAP_NUMBER",
            "deededAcresField": "DEEDED_ACR",
            "dataDate": "2017",
            "notes": "County tax-map linework (not a survey). The county's public layer is a 2017 snapshot.",
        },
        "roads": {
            "url": "https://services1.arcgis.com/9TQ9L457YNtHSPdi/arcgis/rest/services/Roads_0620/FeatureServer/0",
            "name": "Lebanon County GIS road centerlines",
            "nameField": "RD_NAME",
            "routeField": "ST_RT_NO",
            "dataDate": "2020-06",
        },
    },
}

IMAGERY = {
    "pema": {
        "id": "pema-2018",
        "name": "PEMA orthoimagery 2018-2020 (via PASDA)",
        "url": "https://imagery.pasda.psu.edu/arcgis/rest/services/PEMAImagery2018_2020/MapServer",
        "op": "export",
        "maxPx": 4096,
        "dataDate": "2018-2020",
    },
    "naip": {
        "id": "usda-naip",
        "name": "USDA NAIP aerial imagery (via USGS National Map), latest",
        "url": "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer",
        "op": "exportImage",
        "maxPx": 4000,
        "dataDate": None,
    },
}

# Assumed road right-of-way widths, ft (EFCG defaults; the real ROW must come from a survey/deed).
ROW_DEFAULT_FT = {"state": 60, "local": 50, "private": 30}


# ---------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------

def polygons_from_geojson(geom):
    """GeoJSON (Multi)Polygon -> list of valid shapely Polygons (CCW outer rings)."""
    if not geom:
        return []
    try:
        g = shape(geom)
    except Exception:
        return []
    if not g.is_valid:
        g = g.buffer(0)
    parts = [g] if g.geom_type == "Polygon" else list(getattr(g, "geoms", []))
    return [orient(p, 1.0) for p in parts if p.geom_type == "Polygon" and p.area > 0]


def lines_from_geojson(geom):
    if not geom:
        return []
    try:
        g = shape(geom)
    except Exception:
        return []
    if g.geom_type == "LineString":
        return [g]
    if g.geom_type == "MultiLineString":
        return list(g.geoms)
    return []


def clip_polygons(polys, extent_box):
    out = []
    for p in polys:
        c = p.intersection(extent_box)
        for part in ([c] if c.geom_type == "Polygon" else getattr(c, "geoms", [])):
            if part.geom_type == "Polygon" and part.area > 1:
                out.append(orient(part, 1.0))
    return out


def clip_lines(lines, extent_box, min_len_ft=20):
    out = []
    for l in lines:
        c = l.intersection(extent_box)
        for part in ([c] if c.geom_type == "LineString" else getattr(c, "geoms", [])):
            if part.geom_type == "LineString" and part.length >= min_len_ft:
                out.append(part)
    return out


def title_case(s):
    return re.sub(r"\b([a-z])", lambda m: m.group(1).upper(), s.lower())


def situs_key(address):
    """'1625 Heilmandale Rd, Lebanon, PA' -> '1625 HEILMANDALE RD' (county situs format)."""
    s = address.split(",")[0].upper()
    for long, short in (("ROAD", "RD"), ("LANE", "LN"), ("STREET", "ST"), ("AVENUE", "AVE"), ("DRIVE", "DR")):
        s = re.sub(rf"\b{long}\b", short, s)
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# ---------------------------------------------------------------------------------------------
# 1. Geocode (address -> point, county, municipality)
# ---------------------------------------------------------------------------------------------

def geocode(fetcher, address):
    j, url = fetcher.get_json(
        CENSUS_GEOCODER,
        {
            "address": address,
            "benchmark": "Public_AR_Current",
            "vintage": "Current_Current",
            "layers": "Counties,County Subdivisions",
            "format": "json",
        },
        save_as="geocode.json",
        layer="geocode",
    )
    matches = (j.get("result") or {}).get("addressMatches") or []
    if not matches:
        raise FetchError(f'the Census geocoder found no match for "{address}"')
    m = matches[0]
    geo = m.get("geographies") or {}
    county = ((geo.get("Counties") or [{}])[0].get("NAME") or "").replace(" County", "").strip()
    muni = (geo.get("County Subdivisions") or [{}])[0].get("NAME") or ""
    muni = re.sub(r"\b(township|borough|city)\b", lambda x: x.group(1).title(), muni)
    lon, lat = m["coordinates"]["x"], m["coordinates"]["y"]
    x, y = lonlat_to_ft(lon, lat)
    state = (m.get("addressComponents") or {}).get("state") or "PA"
    return {
        "matchedAddress": title_case(m.get("matchedAddress", address)).replace(", Pa,", ", PA"),
        "lon": lon, "lat": lat, "x": x, "y": y,
        "county": county, "municipality": muni, "state": state,
        "streetName": title_case(" ".join(filter(None, [
            (m.get("addressComponents") or {}).get("streetName"),
            (m.get("addressComponents") or {}).get("suffixType"),
        ]))),
        "url": url,
    }


# ---------------------------------------------------------------------------------------------
# 2. Parcel
# ---------------------------------------------------------------------------------------------

def fetch_parcel(fetcher, county, address, x, y):
    cfg = (COUNTIES.get(county) or {}).get("parcels")
    if not cfg:
        raise FetchError(
            f"no parcel data source is set up for {county} County yet "
            f"(add one in packager/sources.py, COUNTIES)"
        )
    fields = ",".join([cfg["idField"], cfg["addressField"], cfg["deededAcresField"]])
    errors = []
    key = situs_key(address)
    attempts = [
        ("by address", {"where": f"{cfg['addressField']}='{key.replace(chr(39), chr(39) * 2)}'"}, "parcel-by-address.geojson"),
        ("by map point", {
            "geometry": f"{x},{y}", "geometryType": "esriGeometryPoint", "inSR": EPSG,
            "spatialRel": "esriSpatialRelIntersects", "where": "1=1",
        }, "parcel-by-point.geojson"),
    ]
    for label, params, raw in attempts:
        try:
            feats, url, _ = fetcher.arcgis_query(cfg["url"], {**params, "outFields": fields, "outSR": EPSG}, save_as=raw, layer="parcel")
            polys = polygons_from_geojson(feats[0]["geometry"]) if feats else []
            if not polys:
                raise FetchError("no parcel found " + label)
            props = feats[0].get("properties") or {}
            poly = max(polys, key=lambda p: p.area)
            raw_vertices = len(poly.exterior.coords) - 1
            poly = orient(poly.simplify(1.0, preserve_topology=True), 1.0)
            deeded = props.get(cfg["deededAcresField"])
            return {
                "polygon": poly,
                "id": props.get(cfg["idField"]),
                "recordAreaAc": float(deeded) if deeded not in (None, "", 0) else None,
                "rawVertices": raw_vertices,
                "matchedBy": label,
                "source": {
                    "id": "county-parcels", "name": cfg["name"], "url": cfg["url"],
                    "retrievedAt": now_iso(), "dataDate": cfg["dataDate"],
                    "notes": f"Matched {label}. {cfg['notes']} Simplified from {raw_vertices} to "
                             f"{len(poly.exterior.coords) - 1} points (1 ft tolerance). Owner fields not requested.",
                },
            }
        except FetchError as e:
            errors.append(f"{label}: {e}")
    raise FetchError("parcel not found (" + "; ".join(errors) + ")")


# ---------------------------------------------------------------------------------------------
# 3. Terrain (USGS 3DEP bare-earth DEM, LiDAR-derived)
# ---------------------------------------------------------------------------------------------

def fetch_dem(fetcher, x0, y0, cols, rows, cell_ft):
    """Ask 3DEP for a grid already in EPSG:2272 at cell_ft spacing. Returns float32 feet, row 0 = south."""
    import tifffile

    xmax, ymax = x0 + cols * cell_ft, y0 + rows * cell_ft
    content, ctype, url = fetcher.get(
        DEM_SERVICE + "/exportImage",
        {
            "bbox": f"{x0},{y0},{xmax},{ymax}", "bboxSR": EPSG, "imageSR": EPSG,
            "size": f"{cols},{rows}", "format": "tiff", "pixelType": "F32",
            "noDataInterpretation": "esriNoDataMatchAny",
            "interpolation": "RSP_BilinearInterpolation", "f": "image",
        },
        save_as="terrain-3dep.tif", layer="terrain", timeout=120,
    )
    if "tif" not in ctype and not content[:4] in (b"II*\x00", b"MM\x00*"):
        raise FetchError(f"expected an elevation image, got {ctype or 'unknown content'}")
    arr = tifffile.imread(io.BytesIO(content))
    if arr.ndim == 3:
        arr = arr[..., 0] if arr.shape[-1] < arr.shape[0] else arr[0]
    if arr.shape != (rows, cols):
        raise FetchError(f"elevation grid came back {arr.shape[1]} x {arr.shape[0]}, expected {cols} x {rows}")
    m = arr.astype(np.float64)
    bad = ~np.isfinite(m) | (m < -500) | (m > 9000)
    ft = (m * FTUS_PER_M).astype(np.float32)          # metres -> US survey feet, once, here
    ft[bad] = np.nan
    ft = ft[::-1, :].copy()                           # GeoTIFF rows run north->south; ours south->north
    return ft, url


def fetch_dem_index(fetcher, x, y):
    """Which LiDAR project the 3DEP surface comes from at a point, and when it was flown."""
    feats, url, _ = fetcher.arcgis_query(
        DEM_INDEX,
        {
            "geometry": f"{x},{y}", "geometryType": "esriGeometryPoint", "inSR": EPSG,
            "spatialRel": "esriSpatialRelIntersects", "where": "1=1", "outSR": EPSG,
            "returnGeometry": "false",
            "outFields": "project,collect_start,collect_end,ql,dem_gsd_meters,sourcedem_pub_date",
        },
        save_as="terrain-3dep-index.geojson", layer="terrain-index",
    )
    if not feats:
        return []

    def as_date(v):
        if v in (None, ""):
            return None
        if isinstance(v, (int, float)):  # ArcGIS epoch milliseconds
            return datetime.fromtimestamp(v / 1000, timezone.utc).strftime("%Y-%m-%d")
        return str(v)[:10]

    # Several LiDAR projects can overlap. The seamless 3DEP service does not report which one it
    # used for a given spot, so all of them are listed (oldest first).
    out = []
    for f in feats:
        p = f.get("properties") or {}
        out.append({
            "project": p.get("project"),
            "collectStart": as_date(p.get("collect_start")),
            "collectEnd": as_date(p.get("collect_end")),
            "qualityLevel": p.get("ql"),
            "demResolutionM": p.get("dem_gsd_meters"),
            "demPublished": as_date(p.get("sourcedem_pub_date")),
        })
    return sorted(out, key=lambda r: r["collectStart"] or "")


# ---------------------------------------------------------------------------------------------
# 4. Features
# ---------------------------------------------------------------------------------------------

def _road_name_county(rd_name, st_rt_no):
    sr = str(st_rt_no or "").strip().lstrip("0")
    m = re.match(r"^\s*STATE ROUTE\s+0*(\d+)", rd_name, re.I)
    if m:
        return f"Route {m.group(1)}", m.group(1)
    name = title_case(re.sub(r"\s+", " ", rd_name).strip())
    return name, (f"SR {sr}" if sr else None)


def _build_roads(raw, extent_box):
    """raw: {key: {name, ref, roadClass, lines[]}} -> list of road items (merged, clipped, simplified)."""
    roads = []
    for r in raw.values():
        merged = linemerge(MultiLineString(r["lines"])) if len(r["lines"]) > 1 else r["lines"][0]
        parts = [merged] if merged.geom_type == "LineString" else list(merged.geoms)
        pieces = clip_lines(parts, extent_box, min_len_ft=40)
        pieces = sorted((p.simplify(0.5) for p in pieces), key=lambda p: -p.length)
        slug = re.sub(r"[^a-z0-9]+", "-", r["name"].lower()).strip("-")
        for i, line in enumerate(pieces):
            roads.append({
                "id": f"road-{slug}" + (f"-{i + 1}" if i else ""),
                "name": r["name"],
                "ref": r["ref"],
                "roadClass": r["roadClass"],
                "centerline": line,
                "rowWidthFt": ROW_DEFAULT_FT[r["roadClass"]],
                "rowAssumed": True,
            })
    return roads


def fetch_roads_county(fetcher, county, extent):
    cfg = (COUNTIES.get(county) or {}).get("roads")
    if not cfg:
        raise FetchError(f"no county road layer is set up for {county} County")
    feats, url, truncated = fetcher.arcgis_query(
        cfg["url"], {**envelope_params(*extent), "outFields": f"{cfg['nameField']},{cfg['routeField']}"},
        save_as="roads-county.geojson", layer="roads",
    )
    raw = {}
    for f in feats:
        p = f.get("properties") or {}
        rd = str(p.get(cfg["nameField"]) or "").strip()
        if not rd:
            continue
        name, ref = _road_name_county(rd, p.get(cfg["routeField"]))
        cur = raw.setdefault(name.lower(), {"name": name, "ref": ref, "roadClass": "state" if ref else "local", "lines": []})
        if ref and not cur["ref"]:
            cur["ref"], cur["roadClass"] = ref, "state"
        cur["lines"].extend(lines_from_geojson(f.get("geometry")))
    raw = {k: v for k, v in raw.items() if v["lines"]}
    roads = _build_roads(raw, box(*extent))
    if not roads:
        raise FetchError("no road centerlines in the area")
    src = {"id": "county-roads", "name": cfg["name"], "url": cfg["url"], "retrievedAt": now_iso(),
           "dataDate": cfg["dataDate"], "notes": "Right-of-way widths are EFCG assumptions (state 60 ft, local 50 ft)."}
    return roads, src, truncated


def fetch_osm(fetcher, extent):
    """OpenStreetMap roads (named, drivable) and building footprints, via the Overpass API."""
    corners = [ft_to_lonlat(x, y) for x, y in ((extent[0], extent[1]), (extent[2], extent[1]), (extent[0], extent[3]), (extent[2], extent[3]))]
    s, n = min(c[1] for c in corners), max(c[1] for c in corners)
    w, e = min(c[0] for c in corners), max(c[0] for c in corners)
    q = f'[out:json][timeout:25];(way["highway"]({s},{w},{n},{e});way["building"]({s},{w},{n},{e}););out geom;'
    j, url = fetcher.get_json(OVERPASS, save_as="osm.json", data={"data": q}, layer="osm", timeout=60)
    ext = box(*extent)
    drivable = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "service"}
    raw_roads, buildings = {}, []
    for el in j.get("elements") or []:
        if el.get("type") != "way" or not el.get("geometry"):
            continue
        pts = [lonlat_to_ft(g["lon"], g["lat"]) for g in el["geometry"]]
        tags = el.get("tags") or {}
        if tags.get("building"):
            if len(pts) < 4:
                continue
            poly = Polygon(pts)
            if not poly.is_valid:
                poly = poly.buffer(0)
            for part in clip_polygons([poly] if poly.geom_type == "Polygon" else list(poly.geoms), ext):
                h = tags.get("height")
                try:
                    h = float(str(h).replace("m", "").strip()) * FTUS_PER_M if h else None
                except ValueError:
                    h = None
                buildings.append({"id": f"osm-building-{el['id']}", "footprint": part, "heightFt": h})
            continue
        hw = tags.get("highway")
        if hw not in drivable or len(pts) < 2:
            continue
        ref = tags.get("ref")
        name = tags.get("name") or (f"Route {re.sub(r'[^0-9]+', '', ref)}" if ref else "")
        if not name:
            continue
        rc = "state" if (ref or hw in ("motorway", "trunk", "primary", "secondary")) else ("private" if hw == "service" else "local")
        cur = raw_roads.setdefault(name.lower(), {"name": name, "ref": ref, "roadClass": rc, "lines": []})
        cur["lines"].append(LineString(pts))
    src = {"id": "osm", "name": "OpenStreetMap contributors (ODbL), via Overpass API", "url": OVERPASS,
           "retrievedAt": now_iso(), "dataDate": None, "notes": "Community-mapped; completeness varies."}
    return _build_roads(raw_roads, ext), buildings, src


_FCODE_KIND = {46006: "perennial", 46003: "intermittent", 46007: "ephemeral", 55800: "artificial path",
               33600: "canal/ditch", 33601: "canal/ditch", 33603: "canal/ditch", 46000: "stream"}


def fetch_streams(fetcher, extent):
    feats, url, truncated = fetcher.arcgis_query(
        NHD_FLOWLINES, {**envelope_params(*extent), "outFields": "gnis_name,fcode,ftype"},
        save_as="streams-nhd.geojson", layer="streams",
    )
    items = []
    ext = box(*extent)
    for f in feats:
        p = f.get("properties") or {}
        fcode = p.get("fcode") or p.get("FCODE")
        kind = _FCODE_KIND.get(int(fcode) if fcode else 0, "other")
        if kind == "other" and str(fcode).startswith("428"):
            continue  # pipelines are not surface streams
        for line in clip_lines(lines_from_geojson(f.get("geometry")), ext, min_len_ft=10):
            items.append({"id": f"stream-{len(items) + 1}", "name": p.get("gnis_name") or None, "kind": kind,
                          "line": line.simplify(1.0)})
    src = {"id": "usgs-nhd", "name": "USGS National Hydrography Dataset (NHD) flowlines, high resolution",
           "url": NHD_FLOWLINES, "retrievedAt": now_iso(), "dataDate": None,
           "notes": "Mapped stream centerlines (1:24,000 or better), not a field survey."}
    return items, src, truncated


def fetch_wetlands(fetcher, extent):
    feats, url, truncated = fetcher.arcgis_query(
        NWI_WETLANDS, {**envelope_params(*extent), "outFields": "ATTRIBUTE,WETLAND_TYPE"},
        save_as="wetlands-nwi.geojson", layer="wetlands",
    )
    items, seen = [], set()
    ext = box(*extent)
    for f in feats:
        p = f.get("properties") or {}
        for poly in clip_polygons(polygons_from_geojson(f.get("geometry")), ext):
            c = poly.centroid
            key = (round(c.x / 5), round(c.y / 5), round(poly.area / 100))
            if key in seen or poly.area < 200:
                continue  # the service returns some polygons twice
            seen.add(key)
            items.append({
                "id": f"wetland-{len(items) + 1}",
                "wetlandType": p.get("ATTRIBUTE") or p.get("WETLAND_TYPE") or "wetland",
                "description": p.get("WETLAND_TYPE"),
                "polygon": orient(poly.simplify(1.0, preserve_topology=True), 1.0),
                "areaAc": round(poly.area / 43560, 2),
            })
    src = {"id": "usfws-nwi", "name": "USFWS National Wetlands Inventory", "url": NWI_WETLANDS,
           "retrievedAt": now_iso(), "dataDate": None,
           "notes": "Planning-level mapping from aerial photos, not a wetland delineation."}
    return items, src, truncated


def fetch_floodplain(fetcher, extent):
    feats, url, truncated = fetcher.arcgis_query(
        FEMA_FLOOD, {**envelope_params(*extent), "where": "SFHA_TF='T'", "outFields": "FLD_ZONE"},
        save_as="floodplain-fema.geojson", layer="floodplain", timeout=60,
    )
    items = []
    ext = box(*extent)
    for f in feats:
        zone = (f.get("properties") or {}).get("FLD_ZONE")
        for poly in clip_polygons(polygons_from_geojson(f.get("geometry")), ext):
            items.append({"id": f"flood-{len(items) + 1}", "zone": zone,
                          "polygon": orient(poly.simplify(1.0, preserve_topology=True), 1.0)})
    src = {"id": "fema-nfhl", "name": "FEMA National Flood Hazard Layer (special flood hazard areas)",
           "url": FEMA_FLOOD, "retrievedAt": now_iso(), "dataDate": None,
           "notes": "Effective FEMA flood map; 1%-annual-chance zones only."}
    return items, src, truncated


# ---------------------------------------------------------------------------------------------
# 5. Imagery (optional)
# ---------------------------------------------------------------------------------------------

def fetch_imagery(fetcher, which, extent, budget_bytes):
    """One north-up JPEG covering the extent, already in EPSG:2272. Resolution chosen to fit the budget."""
    cfg = IMAGERY[which]
    w_ft, h_ft = extent[2] - extent[0], extent[3] - extent[1]
    # Typical aerial JPEG ~0.25 bytes per pixel; base64 adds 4/3.
    px_budget = budget_bytes / (0.25 * 4 / 3)
    ft_per_px = max(1.0, math.sqrt(w_ft * h_ft / max(px_budget, 1)), w_ft / cfg["maxPx"], h_ft / cfg["maxPx"])
    ft_per_px = math.ceil(ft_per_px * 10) / 10
    wpx, hpx = int(round(w_ft / ft_per_px)), int(round(h_ft / ft_per_px))
    content, ctype, url = fetcher.get(
        f"{cfg['url']}/{cfg['op']}",
        {"bbox": f"{extent[0]},{extent[1]},{extent[2]},{extent[3]}", "bboxSR": EPSG, "imageSR": EPSG,
         "size": f"{wpx},{hpx}", "format": "jpg", "f": "image"},
        save_as=f"imagery-{which}.jpg", layer="imagery", timeout=120,
    )
    if "image" not in ctype:
        raise FetchError(f"expected a photo, got {ctype or 'unknown content'}")
    if len(content) / (wpx * hpx) < 0.02:
        raise FetchError("the photo came back blank (no coverage here)")
    src = {"id": cfg["id"], "name": cfg["name"], "url": cfg["url"], "retrievedAt": now_iso(),
           "dataDate": cfg["dataDate"], "notes": f"Exported at {ft_per_px} ft per pixel."}
    return {"jpeg": content, "widthPx": wpx, "heightPx": hpx, "ftPerPx": ft_per_px}, src
