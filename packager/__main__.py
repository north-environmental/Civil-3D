"""Make a site package:   python -m packager "1625 Heilmandale Rd, North Lebanon Township, PA"

Steps: find the site -> download & clip public data -> terrain grid -> zoning & setbacks ->
validate -> save to sites/<site-name>/ -> plain-English summary.
"""

import argparse
import base64
import json
import os
import re
import sys
import time

import numpy as np
from shapely.geometry import box

from . import FORMAT_NAME, FORMAT_VERSION, __version__
from . import sources as S
from .geometry import classify_edges, line_to_json, polygon_to_json, setback_envelope
from .net import FetchError, Fetcher
from .preview import write_preview
from .summary import build_summary, console_text
from .terrain import cell_mask, choose_cell_size, encode, fill_small_holes, grid_shape
from .validate import MAX_BYTES, validate
from .zoning_rules import build_zoning, value

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITES_FILE = os.path.join(os.path.dirname(__file__), "sites.json")


class Stop(Exception):
    """A problem that means no package can be made."""


def say(msg):
    print(msg, flush=True)


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="package", description="Make a site package for one property.")
    ap.add_argument("address", nargs="+", help='street address, e.g. "1625 Heilmandale Rd, North Lebanon Township, PA", or a short name from packager/sites.json')
    ap.add_argument("--name", help="folder name under sites/ (default: from the street address)")
    ap.add_argument("--buffer-ft", type=float, default=500, help="how far beyond the parcel to gather data (default 500 ft)")
    ap.add_argument("--district", help="zoning district code, if the zoning map can't tell (e.g. I-1)")
    ap.add_argument("--imagery", choices=["pema", "naip", "none"], default="pema", help="aerial photo source (default pema)")
    ap.add_argument("--max-mb", type=float, default=14.0, help="size target for the package (default 14, hard limit 15)")
    ap.add_argument("--simulate-failure", default="", help=argparse.SUPPRESS)  # testing: comma list of layers
    a = ap.parse_args(argv)

    address = " ".join(a.address).strip()
    try:
        with open(SITES_FILE, encoding="utf-8") as f:
            aliases = {k.lower(): v for k, v in json.load(f).items() if not k.startswith("_")}
    except FileNotFoundError:
        aliases = {}
    if address.lower() in aliases:
        address = aliases[address.lower()]
    budget = min(a.max_mb * 1e6, MAX_BYTES - 200_000)

    t_start = time.time()
    try:
        out = run(address, a, budget)
    except Stop as e:
        say("")
        say("NO PACKAGE WAS MADE.")
        say(str(e))
        return 1
    say("")
    say(out["console"])
    say(f"(Finished in {time.time() - t_start:.0f} seconds.)")
    return 0


def run(address, a, budget):
    report, warnings, src_list = [], [], []

    def record(layer, source, status, detail, seconds=None):
        report.append({"layer": layer, "source": source, "status": status, "detail": detail, "seconds": seconds})

    sim = [s.strip() for s in a.simulate_failure.split(",") if s.strip()]

    # 1. Find the site --------------------------------------------------------------------------
    say(f"Looking up the address: {address}")
    tmp_fetch = Fetcher(os.path.join(ROOT, "data", "raw", "_lookup"), sim)
    try:
        geo = S.geocode(tmp_fetch, address)
    except FetchError as e:
        raise Stop(f"Could not find that address: {e}. Check the spelling, or include the town and state.")
    say(f"  Found: {geo['matchedAddress']} ({geo['municipality']}, {geo['county']} County)")
    site_id = a.name or slugify(address.split(",")[0])
    raw_dir = os.path.join(ROOT, "data", "raw", site_id)
    fetch = Fetcher(raw_dir, sim)
    os.replace(os.path.join(tmp_fetch.raw_dir, "geocode.json"), os.path.join(raw_dir, "geocode.json"))
    src_list.append({"id": "census-geocoder", "name": "US Census Bureau geocoder", "url": S.CENSUS_GEOCODER,
                     "retrievedAt": S.now_iso(), "dataDate": None, "notes": "Address point is interpolated along the street."})
    record("address", "US Census geocoder", "found", geo["matchedAddress"])

    say("Getting the property boundary ...")
    try:
        p = S.fetch_parcel(fetch, geo["county"], address, geo["x"], geo["y"])
    except FetchError as e:
        record("parcel", "county parcels", "failed", str(e))
        raise Stop(f"Could not get the property boundary: {e}")
    parcel = p["polygon"]
    src_list.append(p["source"])
    record("parcel", p["source"]["name"], "found", f"parcel {p['id']}, matched {p['matchedBy']}", fetch.last_seconds)
    if p["matchedBy"] != "by address":
        warnings.append("The parcel was found from the map point, not the street address. Confirm it is the right lot.")
    area_ac = parcel.area / 43560
    say(f"  Parcel {p['id']}: {area_ac:.2f} acres")

    bx = parcel.bounds
    buf = a.buffer_ft
    extent = (round(bx[0] - buf, 2), round(bx[1] - buf, 2), round(bx[2] + buf, 2), round(bx[3] + buf, 2))
    ext_box = box(*extent)

    # 2. Download and clip features --------------------------------------------------------------
    feats = {k: {"status": "skipped", "reason": None, "source": None, "items": []}
             for k in ("roads", "buildings", "streams", "wetlands", "floodplain")}

    def set_feat(key, items, src, truncated=False):
        feats[key] = {"status": "found" if items else "none_found", "reason": None, "source": src["id"], "items": items}
        src_list.append(src)
        if truncated:
            warnings.append(f"The {key} service returned its maximum number of shapes; some may be missing.")

    say("Getting roads ...")
    try:
        roads, src, tr = S.fetch_roads_county(fetch, geo["county"], extent)
        set_feat("roads", roads, src, tr)
        record("roads", src["name"], "found", f"{len(roads)} road pieces", fetch.last_seconds)
    except FetchError as e:
        record("roads", "county roads", "failed", str(e))
        say(f"  County roads not available ({e}); will try OpenStreetMap.")

    say("Getting existing buildings (OpenStreetMap) ...")
    osm_roads = osm_buildings = None
    try:
        osm_roads, osm_buildings, osm_src = S.fetch_osm(fetch, extent)
        set_feat("buildings", osm_buildings, osm_src)
        record("buildings", osm_src["name"], "found" if osm_buildings else "none_found", f"{len(osm_buildings)} footprints", fetch.last_seconds)
        if not feats["roads"]["items"]:
            feats["roads"] = {"status": "found" if osm_roads else "none_found", "reason": None, "source": "osm", "items": osm_roads}
            record("roads", "OpenStreetMap (fallback)", "found" if osm_roads else "none_found", f"{len(osm_roads)} road pieces")
    except FetchError as e:
        feats["buildings"] = {"status": "failed", "reason": f"OpenStreetMap did not answer ({e})", "source": "osm", "items": []}
        record("buildings", "OpenStreetMap (Overpass)", "failed", str(e))
        if not feats["roads"]["items"]:
            feats["roads"] = {"status": "failed", "reason": "neither the county road layer nor OpenStreetMap answered", "source": None, "items": []}

    for key, fn, label in (("streams", S.fetch_streams, "streams (USGS NHD)"),
                           ("wetlands", S.fetch_wetlands, "wetlands (USFWS NWI)"),
                           ("floodplain", S.fetch_floodplain, "floodplain (FEMA)")):
        say(f"Getting {label} ...")
        try:
            items, src, tr = fn(fetch, extent)
            set_feat(key, items, src, tr)
            record(key, src["name"], "found" if items else "none_found", f"{len(items)} shapes", fetch.last_seconds)
        except FetchError as e:
            feats[key] = {"status": "failed", "reason": str(e), "source": None, "items": []}
            record(key, label, "failed", str(e))
            say(f"  Could not get {key}: {e}")

    # 3. Edges, zoning, envelopes ---------------------------------------------------------------
    say("Working out front, side and rear lot lines and the setbacks ...")
    edges = classify_edges(parcel, feats["roads"]["items"], geo.get("streetName"))
    if not any(e["type"] == "front" for e in edges):
        warnings.append("No road was found alongside any lot line, so every lot line is treated as a side line. Check road frontage.")
    zoning, zw, residential = build_zoning(geo["municipality"], geo["county"], parcel, a.district)
    warnings.extend(zw)

    def depth(e, kind):
        if kind == "building":
            key = {"front": "frontSetbackFt", "side": "sideSetbackFt", "rear": "rearSetbackFt"}[e["type"]]
        else:
            key = "parkingSetbackFromRowFt" if e["type"] == "front" else "parkingSetbackSideRearFt"
        v = value(zoning, key)
        if v is None:
            return None, key
        return v + (e["rowInsetFt"] if e["type"] == "front" else 0), key

    bdep, pdep, lines = {}, {}, []
    missing = set()
    for e in edges:
        bd, bk = depth(e, "building")
        pd, pk = depth(e, "parking")
        if bd is None:
            missing.add(bk)
        if pd is None:
            missing.add(pk)
        bdep[e["index"]], pdep[e["index"]] = bd or 0, pd or 0
        lines.append({"edgeIndex": e["index"], "type": e["type"], "buildingSetbackFt": bd, "parkingSetbackFt": pd,
                      "section": (zoning["values"].get(bk) or {}).get("section"), "parkingSection": (zoning["values"].get(pk) or {}).get("section")})
    if missing:
        warnings.append("Some setbacks are unknown (" + ", ".join(sorted(missing)) + "); those lot lines show no setback.")
    b_env = setback_envelope(parcel, edges, bdep)
    p_env = setback_envelope(parcel, edges, pdep)
    if any(e["type"] == "front" and e["rowInsetFt"] > 0 for e in edges):
        warnings.append("The lot appears to be deeded to the road centerline, so front setbacks are measured from an assumed "
                        "right-of-way line (state road 60 ft wide, local 50 ft). Confirm the real right-of-way.")

    # Residential districts nearby (not subtracted from the envelope in format v1.0)
    sep = value(zoning, "residentialSeparationFt")
    if residential and sep:
        near = [r for r in residential if r.distance(parcel) < sep]
        if near:
            warnings.append(f"A residential zoning district is within {sep:g} ft of the parcel; the ordinance keeps buildings "
                            f"{sep:g} ft from residential districts. This is not cut out of the buildable area yet.")
    wet_on = [w for w in feats["wetlands"]["items"] if w["polygon"].intersects(parcel)]
    if wet_on:
        warnings.append(f"{len(wet_on)} mapped wetland area(s) touch the parcel ({sum(w['polygon'].intersection(parcel).area for w in wet_on) / 43560:.1f} ac). "
                        "They are not cut out of the buildable area; NWI mapping is not a delineation.")
    fl_on = [f for f in feats["floodplain"]["items"] if f["polygon"].intersects(parcel)]
    if fl_on:
        warnings.append("Part of the parcel is in a FEMA flood hazard zone.")
    for key, label in (("roads", "Roads"), ("buildings", "Existing buildings"), ("streams", "Streams"),
                       ("wetlands", "Wetlands"), ("floodplain", "Floodplain (FEMA flood map)")):
        if feats[key]["status"] == "failed":
            warnings.append(f"{label}: the data source did not answer, so this is UNKNOWN, not 'none'. Run the packager again later to fill it in.")

    # 4. Terrain -------------------------------------------------------------------------------
    say("Checking which LiDAR survey covers the site ...")
    lidar = []
    try:
        lidar = S.fetch_dem_index(fetch, parcel.centroid.x, parcel.centroid.y)
        record("terrain-index", "USGS 3DEP source index", "found" if lidar else "none_found",
               "; ".join(f"{l['project']} {l['collectStart']}..{l['collectEnd']}" for l in lidar) or "no index entry", fetch.last_seconds)
    except FetchError as e:
        record("terrain-index", "USGS 3DEP source index", "failed", str(e))
    if len(lidar) > 1:
        warnings.append("More than one LiDAR survey covers this site (" + ", ".join(
            f"{(l['collectStart'] or '?')[:4]}" for l in lidar) + "). USGS's combined ground surface does not say which one "
            "it used here, so the terrain date is not certain. Check for building pads in the 3D view.")
    terrain_budget = min(8e6, budget * 0.6)
    cell = choose_cell_size(extent, terrain_budget)
    x0, y0, cols, rows = grid_shape(extent, cell)
    say(f"Downloading the ground surface (USGS 3DEP, {cell} ft grid, {cols:,} x {rows:,}) ...")
    try:
        ft, dem_url = S.fetch_dem(fetch, x0, y0, cols, rows, cell)
    except FetchError as e:
        record("terrain", "USGS 3DEP", "failed", str(e))
        raise Stop(f"Could not get the ground surface from USGS 3DEP: {e}")
    record("terrain", "USGS 3DEP elevation service", "found", f"{cols} x {rows} at {cell} ft", fetch.last_seconds)
    filled = fill_small_holes(ft)
    if filled:
        warnings.append(f"{filled} small gaps in the elevation data were filled from neighbouring cells.")
    pmask = cell_mask(parcel, x0, y0, cell, cols, rows)
    pvals = ft[pmask]
    if not pmask.any() or np.isfinite(pvals).mean() < 0.95:
        raise Stop("The elevation data has too many holes on this parcel (need 95% coverage).")
    pmin, pmax = float(np.nanmin(pvals)), float(np.nanmax(pvals))
    enc, ew = encode(ft)
    if ew:
        warnings.append(ew)

    # Is the ground before or after current buildings? A big flat pad under an existing footprint = after.
    pre_dev = None
    big = [b for b in feats["buildings"]["items"] if b["footprint"].intersects(parcel) and b["footprint"].area > 20000]
    if big:
        stds = []
        for b in big:
            m = cell_mask(b["footprint"].buffer(-10) if b["footprint"].buffer(-10).area > 0 else b["footprint"], x0, y0, cell, cols, rows)
            if m.sum() > 20:
                stds.append(float(np.nanstd(ft[m])))
        if stds:
            pre_dev = not any(s < 0.5 for s in stds)
            warnings.append("The ground surface already shows the existing building pad(s): it is AFTER construction."
                            if not pre_dev else "The ground under the existing buildings is not flat: the ground surface appears to be from BEFORE they were built.")
    years = sorted({(l["collectStart"] or "")[:4] for l in lidar if l.get("collectStart")})
    lidar_note = ("LiDAR surveys covering the site: " + "; ".join(
        f"{l['project']} (flown {l['collectStart']} to {l['collectEnd']}, {l['qualityLevel']})" for l in lidar)
        if lidar else "LiDAR survey not identified")
    src_list.append({"id": "usgs-3dep", "name": "USGS 3D Elevation Program (3DEP) bare-earth DEM, LiDAR-derived",
                     "url": S.DEM_SERVICE, "retrievedAt": S.now_iso(),
                     "dataDate": (" or ".join(years) if years else None),
                     "notes": f"{lidar_note}. Resampled by USGS to {cell} ft in EPSG:2272."})

    # 5. Assemble (without imagery first, to measure) ---------------------------------------------
    created = S.now_iso()
    def items_json(key):
        out = []
        for it in feats[key]["items"]:
            j = dict(it)
            for g in ("centerline", "line"):
                if g in j:
                    j[g] = line_to_json(j[g])
            for g in ("polygon", "footprint"):
                if g in j:
                    j[g] = polygon_to_json(j[g])
            out.append(j)
        return {**feats[key], "items": out}

    pkg = {
        "format": FORMAT_NAME,
        "version": FORMAT_VERSION,
        "metadata": {
            "siteId": site_id,
            "siteName": a.name.replace("-", " ").title() if a.name else address.split(",")[0].strip(),
            "address": geo["matchedAddress"],
            "municipality": geo["municipality"],
            "county": geo["county"],
            "state": geo["state"],
            "parcelId": p["id"],
            "createdAt": created,
            "packagerVersion": __version__,
            "bufferFt": buf,
            "extent": {"xMinFt": extent[0], "yMinFt": extent[1], "xMaxFt": extent[2], "yMaxFt": extent[3]},
            "sources": [],
            "warnings": [],
        },
        "crs": {"epsg": 2272, "name": "NAD83 / Pennsylvania South (ftUS)", "horizontalUnits": "US survey foot",
                "verticalDatum": "NAVD88", "verticalUnits": "US survey foot"},
        "parcel": {
            "id": p["id"],
            "polygon": polygon_to_json(parcel),
            "areaSf": round(parcel.area, 1),
            "areaAc": round(parcel.area / 43560, 4),
            "recordAreaAc": p["recordAreaAc"],
            "edges": [{"index": e["index"], "lengthFt": round(e["lengthFt"], 2), "type": e["type"], "road": e["road"],
                       "rowInsetFt": e["rowInsetFt"]} for e in edges],
            "source": "county-parcels",
        },
        "terrain": {
            "cellSizeFt": cell, "cols": cols, "rows": rows, "x0Ft": x0, "y0Ft": y0,
            **enc,
            "source": "usgs-3dep",
            "nativeResolution": " or ".join(sorted({f"{l['demResolutionM']:g} m" for l in lidar if l.get("demResolutionM")})) or "1 m",
            "preDevelopment": pre_dev,
            "parcelElevFt": {"min": round(pmin, 2), "max": round(pmax, 2)},
            "lidarSurveys": lidar,
        },
        "features": {k: items_json(k) for k in feats},
        "zoning": zoning,
        "derived": {
            "buildingEnvelope": [polygon_to_json(x) for x in b_env],
            "parkingEnvelope": [polygon_to_json(x) for x in p_env],
            "buildingEnvelopeAreaAc": round(sum(x.area for x in b_env) / 43560, 3),
            "parkingEnvelopeAreaAc": round(sum(x.area for x in p_env) / 43560, 3),
            "setbackLines": lines,
            "method": "Parcel minus a round-ended buffer of each lot line by its setback; front setbacks are measured from "
                      "the (assumed) road right-of-way line. Wetland buffers and residential separations are not subtracted.",
        },
    }

    # 6. Imagery, if it fits -------------------------------------------------------------------
    def size_of(obj):
        return len(json.dumps(obj, separators=(",", ":")).encode())

    if a.imagery != "none":
        room = budget - size_of(pkg) - 50_000
        if room < 400_000:
            warnings.append("No aerial photo: not enough room under the size limit.")
            record("imagery", a.imagery, "skipped", "no room under the size limit")
        else:
            say("Getting an aerial photo ...")
            try:
                img, src = S.fetch_imagery(fetch, a.imagery, extent, room)
                b64 = base64.b64encode(img["jpeg"]).decode("ascii")
                if len(b64) > room:
                    warnings.append("No aerial photo: the photo came back larger than the room left under the size limit.")
                    record("imagery", src["name"], "skipped", f"{len(b64) / 1e6:.1f} MB, too large")
                else:
                    src_list.append(src)
                    pkg["imagery"] = {"mime": "image/jpeg", "xMinFt": extent[0], "yMinFt": extent[1], "xMaxFt": extent[2],
                                      "yMaxFt": extent[3], "widthPx": img["widthPx"], "heightPx": img["heightPx"],
                                      "source": src["id"], "dataDate": src["dataDate"], "data": b64}
                    record("imagery", src["name"], "found", f"{img['widthPx']} x {img['heightPx']} px at {img['ftPerPx']} ft/px, {len(img['jpeg']) / 1e6:.1f} MB", fetch.last_seconds)
            except FetchError as e:
                warnings.append(f"No aerial photo: {e}.")
                record("imagery", a.imagery, "failed", str(e))

    pkg["metadata"]["sources"] = src_list
    pkg["metadata"]["warnings"] = warnings

    # 7. Validate and save -----------------------------------------------------------------------
    say("Checking the package against SITE_PACKAGE_FORMAT.md ...")
    text = json.dumps(pkg, separators=(",", ":"))
    nbytes = len(text.encode())
    problems = validate(pkg, nbytes)
    if problems:
        raise Stop("The package failed its checks, so it was not saved:\n  - " + "\n  - ".join(problems))
    out_dir = os.path.join(ROOT, "sites", site_id)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, f"{site_id}.sitepkg.json"), "w", encoding="utf-8") as f:
        f.write(text)
    with open(os.path.join(out_dir, "fetch-report.json"), "w", encoding="utf-8") as f:
        json.dump({"siteId": site_id, "createdAt": created, "address": address, "layers": report}, f, indent=2)
    write_preview(os.path.join(out_dir, "preview.svg"), pkg, ft)
    md = build_summary(pkg, report, nbytes, out_dir)
    with open(os.path.join(out_dir, "summary.md"), "w", encoding="utf-8") as f:
        f.write(md)
    return {"console": console_text(md) + f"\nSaved to: {os.path.relpath(out_dir, ROOT)}{os.sep}", "pkg": pkg}


if __name__ == "__main__":
    sys.exit(main())
