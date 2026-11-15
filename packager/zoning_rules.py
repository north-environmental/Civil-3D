"""Zoning: find the district for the parcel and read the hand-entered values.

Zoning has no reliable public web service, so values are entered by hand in
packager/zoning/<municipality>.json. A digitized zoning map (optional) lets the packager look up
the district automatically; otherwise pass --district.
"""

import json
import os
import re

from shapely.geometry import Polygon

ZONING_DIR = os.path.join(os.path.dirname(__file__), "zoning")
REQUIRED_KEYS = ("frontSetbackFt", "sideSetbackFt", "rearSetbackFt", "maxHeightFt", "maxLotCoveragePct",
                 "stallWidthFt", "stallLengthFt")


def _slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")


def load_municipality(municipality):
    path = os.path.join(ZONING_DIR, _slug(municipality) + ".json")
    if not os.path.exists(path):
        return None, path
    with open(path, encoding="utf-8") as f:
        return json.load(f), path


def district_from_map(cfg, parcel):
    """District covering most of the parcel, from the digitized zoning map. Returns (code, mapCode, share, residential polygons)."""
    dm = cfg.get("districtMap") if cfg else None
    if not dm:
        return None, None, 0.0, []
    with open(os.path.join(ZONING_DIR, dm["file"]), encoding="utf-8") as f:
        j = json.load(f)
    best, best_area, residential = None, 0.0, []
    for d in j["districts"]:
        poly = Polygon(d["ring"])
        if not poly.is_valid:
            poly = poly.buffer(0)
        if d.get("kind") == "residential":
            residential.append(poly)
        a = poly.intersection(parcel).area
        if a > best_area:
            best, best_area = d, a
    if not best:
        return None, None, 0.0, residential
    code = dm.get("aliases", {}).get(best["code"], best["code"])
    return code, best["code"], best_area / parcel.area, residential


def build_zoning(municipality, county, parcel, district_override=None):
    """Return (zoning dict for the package, list of warnings, residential polygons or [])."""
    warnings = []
    cfg, path = load_municipality(municipality)
    residential = []
    if cfg is None:
        warnings.append(f"No zoning values are entered for {municipality} yet: all zoning limits are blank. "
                        f"Create {os.path.relpath(path)} (copy north-lebanon-township.json as a template).")
        district = district_override
        cfg = {"jurisdiction": f"{municipality}, {county} County", "verified": False}
    else:
        code, map_code, share, residential = district_from_map(cfg, parcel)
        district = district_override or code
        if district_override and code and district_override != code:
            warnings.append(f"Zoning district set by hand to {district_override}; the zoning map suggests {code}.")
        elif not district_override and code:
            if share < 0.9:
                warnings.append(f"Only {share:.0%} of the parcel falls in district {code} on the zoning map; "
                                f"part of the lot may be in another district.")
            if map_code != code:
                warnings.append(cfg["districtMap"].get("aliasNote") or f"Map label {map_code} treated as {code}.")
        if not district:
            warnings.append("Could not tell the zoning district from the map; pass --district to set it.")

    entry = (cfg.get("districts") or {}).get(district) if district else None
    if district and cfg.get("districts") is not None and entry is None:
        warnings.append(f"District {district} has no values entered yet in the zoning file: limits are blank.")
    values = dict((entry or {}).get("values") or {})
    for k in REQUIRED_KEYS:
        values.setdefault(k, {"value": None, "section": None, "note": "Not entered: unknown."})
    if not cfg.get("verified"):
        warnings.append("Zoning values come from an unofficial copy of the code. Verify with the township before relying on them.")

    zoning = {
        "jurisdiction": cfg.get("jurisdiction"),
        "district": district,
        "districtName": (entry or {}).get("districtName"),
        "codeName": cfg.get("codeName"),
        "officialUrl": cfg.get("officialUrl"),
        "enteredFrom": cfg.get("enteredFrom"),
        "verified": bool(cfg.get("verified")),
        "values": values,
        "parkingRatios": (entry or {}).get("parkingRatios") or [],
    }
    return zoning, warnings, residential


def value(zoning, key):
    v = (zoning.get("values") or {}).get(key) or {}
    return v.get("value")
