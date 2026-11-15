"""Plain-English summary, printed at the end of a run and saved as summary.md."""

FEATURE_LABELS = {
    "roads": "Roads", "buildings": "Existing buildings", "streams": "Streams",
    "wetlands": "Wetlands", "floodplain": "Floodplain",
}


def _fmt_val(v, unit=""):
    return "unknown" if v is None else f"{v:,g}{unit}"


def build_summary(pkg, report, file_bytes, out_dir):
    md, parcel, t, z, der = pkg["metadata"], pkg["parcel"], pkg["terrain"], pkg["zoning"], pkg["derived"]
    L = []
    L.append(f"# Site package: {md['siteName']}")
    L.append("")
    L.append(f"**{md['address']}**, {md['municipality']}, {md['county']} County, {md['state']}  ")
    L.append(f"Parcel {md['parcelId'] or 'ID unknown'}. Made {md['createdAt'][:10]}. File size {file_bytes / 1e6:.1f} MB (limit 15 MB).")
    L.append("")
    L.append("## Key numbers")
    rec = f" (county record says {parcel['recordAreaAc']:.2f} ac)" if parcel.get("recordAreaAc") else ""
    L.append(f"- **Parcel area:** {parcel['areaAc']:.2f} acres{rec}.")
    fronts = sorted({e['road'] for e in parcel['edges'] if e['type'] == 'front'})
    L.append(f"- **Road frontage:** {', '.join(fronts) if fronts else 'none found (no road touches the lot line)'}.")
    pe = t.get("parcelElevFt") or {}
    L.append(f"- **Ground elevation on the parcel:** {pe.get('min', t['minElevFt']):,.1f} to {pe.get('max', t['maxElevFt']):,.1f} ft "
             f"(NAVD88), a {pe.get('max', t['maxElevFt']) - pe.get('min', t['minElevFt']):,.0f} ft difference.")
    surveys = t.get("lidarSurveys") or []
    if len(surveys) == 1:
        when = f"survey {surveys[0]['project']}, flown {surveys[0]['collectStart']} to {surveys[0]['collectEnd']}"
    elif surveys:
        when = "surveys flown in " + " and ".join((s["collectStart"] or "?")[:4] for s in surveys) + "; USGS does not say which one it used here"
    else:
        when = "survey date not found"
    L.append(f"- **Terrain grid:** {t['cellSizeFt']:g} ft cells, {t['cols']:,} x {t['rows']:,}, from USGS 3DEP LiDAR ({when}).")
    zd = z.get("district") or "unknown"
    L.append(f"- **Zoning:** {zd}{' ' + z['districtName'] if z.get('districtName') else ''}. "
             f"Setbacks front {_fmt_val(z['values']['frontSetbackFt']['value'], ' ft')}, side "
             f"{_fmt_val(z['values']['sideSetbackFt']['value'], ' ft')}, rear {_fmt_val(z['values']['rearSetbackFt']['value'], ' ft')}; "
             f"max height {_fmt_val(z['values']['maxHeightFt']['value'], ' ft')}; max lot coverage "
             f"{_fmt_val(z['values']['maxLotCoveragePct']['value'], '%')}.")
    L.append(f"- **Buildable area after setbacks:** {der['buildingEnvelopeAreaAc']:.1f} ac for buildings, "
             f"{der['parkingEnvelopeAreaAc']:.1f} ac for parking.")
    L.append("")
    L.append("## What was found")
    for k, label in FEATURE_LABELS.items():
        f = pkg["features"][k]
        n = len(f["items"])
        if f["status"] == "found":
            L.append(f"- {label}: **{n} found**.")
        elif f["status"] == "none_found":
            L.append(f"- {label}: none in this area.")
        else:
            L.append(f"- {label}: **could not get them**: {f['reason']}.")
    img = pkg.get("imagery")
    L.append(f"- Aerial photo: {'included (' + img['source'] + ', ' + str(img.get('dataDate') or 'date unknown') + ')' if img else 'not included'}.")
    L.append("")
    if md["warnings"]:
        L.append("## Things to know")
        for w in md["warnings"]:
            L.append(f"- {w}")
        L.append("")
    failed = [r for r in report if r["status"] in ("failed",)]
    if failed:
        L.append("## Sources that did not answer")
        for r in failed:
            L.append(f"- {r['layer']} ({r['source']}): {r['detail']}")
        L.append("")
    L.append("## Files")
    L.append(f"- `{md['siteId']}.sitepkg.json`: the package (load this in the viewer)")
    L.append("- `preview.svg`: quick map (open in any browser)")
    L.append("- `fetch-report.json`: every data source tried, with timings")
    L.append(f"- Raw downloads: `data/raw/{md['siteId']}/` (not pushed to GitHub)")
    return "\n".join(L) + "\n"


def console_text(summary_md):
    """Markdown -> plain console text."""
    out = []
    for line in summary_md.splitlines():
        line = line.replace("**", "").replace("`", "").rstrip()
        if line.startswith("# "):
            out.append(line[2:].upper())
        elif line.startswith("## "):
            out.append("")
            out.append(line[3:])
        else:
            out.append(line)
    return "\n".join(out)
