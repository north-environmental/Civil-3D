"""Check a site package against SITE_PACKAGE_FORMAT.md section 4. Returns a list of plain-English problems."""

import base64
import math

from . import FORMAT_NAME

MAX_BYTES = 15_000_000
FEATURE_TYPES = ("roads", "buildings", "streams", "wetlands", "floodplain")
STATUSES = ("found", "none_found", "failed", "skipped")
REQUIRED_ZONING = ("frontSetbackFt", "sideSetbackFt", "rearSetbackFt", "maxHeightFt", "maxLotCoveragePct",
                   "stallWidthFt", "stallLengthFt")


def _ring_area(r):
    a = 0.0
    for i in range(len(r)):
        x1, y1 = r[i]
        x2, y2 = r[(i + 1) % len(r)]
        a += x1 * y2 - x2 * y1
    return a / 2


def _iter_points(obj):
    """Every [x, y] pair inside a geometry-ish structure."""
    if isinstance(obj, list):
        if len(obj) == 2 and all(isinstance(v, (int, float)) for v in obj):
            yield obj
        else:
            for o in obj:
                yield from _iter_points(o)
    elif isinstance(obj, dict):
        for k in ("outer", "holes"):
            if k in obj:
                yield from _iter_points(obj[k])


def validate(pkg, file_bytes=None):
    errs = []
    need = lambda cond, msg: (None if cond else errs.append(msg))

    # 1. format / version
    need(pkg.get("format") == FORMAT_NAME, f'format must be "{FORMAT_NAME}"')
    need(str(pkg.get("version", "")).startswith("1."), "version must start with 1.")
    # 2. required parts
    for part in ("metadata", "crs", "parcel", "terrain", "features", "zoning", "derived"):
        need(isinstance(pkg.get(part), dict), f"missing part: {part}")
    if errs:
        return errs
    md, parcel, t = pkg["metadata"], pkg["parcel"], pkg["terrain"]
    feats, zon, der = pkg["features"], pkg["zoning"], pkg["derived"]
    for k in ("siteId", "siteName", "address", "municipality", "county", "state", "parcelId", "createdAt",
              "packagerVersion", "bufferFt", "extent", "sources", "warnings"):
        need(k in md, f"metadata.{k} is missing")
    # 3. crs
    need(pkg["crs"].get("epsg") == 2272, "crs.epsg must be 2272")
    # 5. extent plausibility
    ext = md.get("extent") or {}
    try:
        x0, y0, x1, y1 = ext["xMinFt"], ext["yMinFt"], ext["xMaxFt"], ext["yMaxFt"]
        need(1_100_000 <= x0 < x1 <= 2_900_000 and 100_000 <= y0 < y1 <= 600_000,
             "metadata.extent is not a plausible PA South State Plane rectangle")
    except (KeyError, TypeError):
        errs.append("metadata.extent needs xMinFt, yMinFt, xMaxFt, yMaxFt")
        return errs
    tol = 1.0
    inside = lambda p: x0 - tol <= p[0] <= x1 + tol and y0 - tol <= p[1] <= y1 + tol

    # 4. parcel
    outer = ((parcel.get("polygon") or {}).get("outer")) or []
    need(len(outer) >= 3, "parcel outer ring needs at least 3 points")
    if len(outer) >= 3:
        a = _ring_area(outer)
        need(a > 0, "parcel outer ring must be counter-clockwise with non-zero area")
        holes = sum(abs(_ring_area(h)) for h in parcel["polygon"].get("holes") or [])
        need(abs((a - holes) / 43560 - parcel.get("areaAc", -1)) <= 0.001 * max(parcel.get("areaAc", 1), 1e-9),
             "parcel.areaAc does not match the polygon (more than 0.1% off)")
        try:
            from shapely.geometry import Polygon
            need(Polygon(outer, parcel["polygon"].get("holes") or []).is_valid, "parcel boundary crosses itself")
        except Exception:
            pass
        need(len(parcel.get("edges") or []) == len(outer), "parcel.edges must have one entry per outer-ring side")
        for e in parcel.get("edges") or []:
            need(e.get("type") in ("front", "side", "rear"), f"parcel edge {e.get('index')} has an invalid type")
    need(all(inside(p) for p in _iter_points(parcel.get("polygon"))), "parcel lies outside metadata.extent")

    # 6. terrain
    try:
        n = t["rows"] * t["cols"]
        raw = base64.b64decode(t["data"])
        need(len(raw) == 2 * n, f"terrain data decodes to {len(raw) // 2} values, expected {n}")
        need(t["cellSizeFt"] > 0, "terrain.cellSizeFt must be > 0")
        need(t.get("encoding") == "uint16-scaled-base64", "terrain.encoding must be uint16-scaled-base64")
        need(-100 <= t["minElevFt"] <= t["maxElevFt"] <= 4000, "terrain elevations outside -100..4000 ft")
        gx1, gy1 = t["x0Ft"] + t["cols"] * t["cellSizeFt"], t["y0Ft"] + t["rows"] * t["cellSizeFt"]
        need(all(t["x0Ft"] <= p[0] <= gx1 and t["y0Ft"] <= p[1] <= gy1 for p in outer),
             "terrain grid does not cover the whole parcel")
        if len(raw) == 2 * n:
            import numpy as np
            from shapely import contains_xy
            from shapely.geometry import Polygon
            q = np.frombuffer(raw, dtype="<u2").reshape(t["rows"], t["cols"])
            c = t["cellSizeFt"]
            xs = t["x0Ft"] + (np.arange(t["cols"]) + 0.5) * c
            ys = t["y0Ft"] + (np.arange(t["rows"]) + 0.5) * c
            gx, gy = np.meshgrid(xs, ys)
            m = contains_xy(Polygon(outer), gx, gy)
            if m.any():
                share = float((q[m] != t["noData"]).mean())
                need(share >= 0.95, f"only {share:.0%} of parcel cells have elevation data (need 95%)")
    except (KeyError, TypeError, ValueError) as e:
        errs.append(f"terrain is incomplete or unreadable ({e})")

    # 7. features
    for ft in FEATURE_TYPES:
        f = feats.get(ft)
        if not isinstance(f, dict):
            errs.append(f"features.{ft} is missing")
            continue
        need(f.get("status") in STATUSES, f"features.{ft}.status is invalid")
        need(isinstance(f.get("items"), list), f"features.{ft}.items must be a list")
        if f.get("status") == "found":
            need(bool(f.get("items")), f"features.{ft} says found but has no items")
        for it in f.get("items") or []:
            geom = it.get("centerline") or it.get("line") or it.get("polygon") or it.get("footprint")
            if not all(inside(p) for p in _iter_points(geom)):
                errs.append(f"features.{ft} item {it.get('id')} lies outside metadata.extent")
                break

    # 8. zoning
    vals = zon.get("values") or {}
    for k in REQUIRED_ZONING:
        need(k in vals, f"zoning.values.{k} is missing (use value null if unknown)")
    for k, v in vals.items():
        need(isinstance(v, dict) and (v.get("section") or v.get("note")), f"zoning.values.{k} needs a section or a note")

    # derived
    for k in ("buildingEnvelope", "parkingEnvelope", "setbackLines"):
        need(k in der, f"derived.{k} is missing")
    need(all(inside(p) for p in _iter_points(der.get("buildingEnvelope"))), "building envelope lies outside the extent")

    # 9. size
    if file_bytes is not None:
        need(file_bytes < MAX_BYTES, f"package is {file_bytes / 1e6:.1f} MB; the limit is 15 MB")
    return errs
