"""preview.svg: a quick map of the package (shaded relief, contours, parcel, setbacks, features).

Uses only numpy and the Python standard library (the relief is a small PNG written by hand).
"""

import base64
import struct
import zlib

import numpy as np

MAX_PX = 1000


def _png_gray(img):
    """uint8 2-D array (row 0 = top) -> PNG bytes."""
    h, w = img.shape
    raw = b"".join(b"\x00" + img[r].tobytes() for r in range(h))
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def _downsample(ft, step):
    if step <= 1:
        return ft
    r, c = (ft.shape[0] // step) * step, (ft.shape[1] // step) * step
    return np.nanmean(ft[:r, :c].reshape(r // step, step, c // step, step), axis=(1, 3))


def _hillshade(z, cell_ft):
    zf = np.where(np.isfinite(z), z, np.nanmean(z))
    gy, gx = np.gradient(zf, cell_ft)          # rows run south->north, so gy is d/dNorth
    slope = np.arctan(np.hypot(gx, gy) * 2.0)  # 2x exaggeration for readability
    aspect = np.arctan2(-gx, -gy)
    az, alt = np.radians(315), np.radians(45)  # light from the north-west
    hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(60 + 160 * hs, 0, 255).astype(np.uint8)


def _contour_segments(z, level):
    """Marching squares (vectorised). z rows run south->north. Returns array of segments in grid units."""
    a, b, c, d = z[:-1, :-1], z[:-1, 1:], z[1:, 1:], z[1:, :-1]   # SW, SE, NE, NW corners
    def cross(p, q):
        with np.errstate(invalid="ignore", divide="ignore"):
            t = (level - p) / (q - p)
        ok = ((p < level) != (q < level)) & np.isfinite(p) & np.isfinite(q)
        return t, ok
    rows, cols = np.mgrid[0:a.shape[0], 0:a.shape[1]].astype(float)
    tb, okb = cross(a, b); tr, okr = cross(b, c); tt, okt = cross(d, c); tl, okl = cross(a, d)
    pts = {
        "b": (cols + tb, rows, okb), "r": (cols + 1, rows + tr, okr),
        "t": (cols + tt, rows + 1, okt), "l": (cols, rows + tl, okl),
    }
    segs = []
    for e1, e2 in (("b", "r"), ("b", "t"), ("b", "l"), ("r", "t"), ("r", "l"), ("t", "l")):
        x1, y1, o1 = pts[e1]
        x2, y2, o2 = pts[e2]
        n_ok = okb.astype(int) + okr + okt + okl
        m = o1 & o2 & (n_ok == 2)
        if m.any():
            segs.append(np.stack([x1[m], y1[m], x2[m], y2[m]], axis=1))
    sad = (okb & okr & okt & okl)
    if sad.any():  # saddle: pair bottom-left and top-right
        for e1, e2 in (("b", "l"), ("t", "r")):
            x1, y1, _ = pts[e1]; x2, y2, _ = pts[e2]
            segs.append(np.stack([x1[sad], y1[sad], x2[sad], y2[sad]], axis=1))
    return np.concatenate(segs) if segs else np.zeros((0, 4))


def write_preview(path, pkg, ft):
    t, md = pkg["terrain"], pkg["metadata"]
    ext = md["extent"]
    cell = t["cellSizeFt"]
    step = max(1, int(np.ceil(max(ft.shape) / MAX_PX)))
    z = _downsample(ft, step)
    gcell = cell * step
    h, w = z.shape
    sx = 1.0  # one SVG unit per downsampled cell
    x0g, y0g = t["x0Ft"], t["y0Ft"]

    def P(x, y):
        return (x - x0g) / gcell, h - (y - y0g) / gcell

    def path_ring(r):
        pts = [P(x, y) for x, y in r]
        return "M" + "L".join(f"{px:.1f},{py:.1f}" for px, py in pts) + "Z"

    def path_poly(p):
        return "".join(path_ring(r) for r in [p["outer"], *p.get("holes", [])])

    def path_line(l):
        return "M" + "L".join(f"{px:.1f},{py:.1f}" for px, py in (P(x, y) for x, y in l))

    png = _png_gray(_hillshade(z, gcell)[::-1])
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h + 60}" width="100%" style="max-width:{w}px;display:block" '
           f'font-family="Segoe UI, Arial, sans-serif">',
           '<rect width="100%" height="100%" fill="#111418"/>',
           f'<image href="data:image/png;base64,{base64.b64encode(png).decode()}" x="0" y="0" width="{w}" height="{h}"/>']

    # contours (10 ft, every 50 ft heavier)
    zmin, zmax = np.nanmin(z), np.nanmax(z)
    minor, major = [], []
    for lev in np.arange(np.ceil(zmin / 10) * 10, zmax, 10):
        s = _contour_segments(z, lev)
        d = "".join(f"M{x1:.1f},{h - y1:.1f}L{x2:.1f},{h - y2:.1f}" for x1, y1, x2, y2 in (s + 0.5))
        (major if lev % 50 == 0 else minor).append(d)
    out.append(f'<path d="{"".join(minor)}" stroke="#c9a96b" stroke-opacity="0.35" stroke-width="0.6" fill="none"/>')
    out.append(f'<path d="{"".join(major)}" stroke="#e0c080" stroke-opacity="0.7" stroke-width="1" fill="none"/>')

    f = pkg["features"]
    for it in f["floodplain"]["items"]:
        out.append(f'<path d="{path_poly(it["polygon"])}" fill="#3b82f6" fill-opacity="0.18" stroke="#3b82f6" stroke-width="0.8"/>')
    for it in f["wetlands"]["items"]:
        out.append(f'<path d="{path_poly(it["polygon"])}" fill="#2dd4bf" fill-opacity="0.25" stroke="#2dd4bf" stroke-width="0.8" fill-rule="evenodd"/>')
    for it in f["streams"]["items"]:
        out.append(f'<path d="{path_line(it["line"])}" stroke="#60a5fa" stroke-width="1.6" fill="none"/>')
    for it in f["roads"]["items"]:
        out.append(f'<path d="{path_line(it["centerline"])}" stroke="#f5f5f5" stroke-opacity="0.75" stroke-width="2" fill="none"/>')
    for it in f["buildings"]["items"]:
        out.append(f'<path d="{path_poly(it["footprint"])}" fill="#9ca3af" fill-opacity="0.6" stroke="#d1d5db" stroke-width="0.6"/>')
    for p in pkg["derived"]["parkingEnvelope"]:
        out.append(f'<path d="{path_poly(p)}" fill="none" stroke="#a3e635" stroke-width="1" stroke-dasharray="3 3"/>')
    for p in pkg["derived"]["buildingEnvelope"]:
        out.append(f'<path d="{path_poly(p)}" fill="#f59e0b" fill-opacity="0.08" stroke="#f59e0b" stroke-width="1.4" stroke-dasharray="6 4"/>')
    out.append(f'<path d="{path_poly(pkg["parcel"]["polygon"])}" fill="none" stroke="#ffffff" stroke-width="2"/>')

    # scale bar + legend
    bar_ft = 500 if (w * gcell) > 2500 else 200
    bl = bar_ft / gcell
    y = h + 22
    out.append(f'<rect x="0" y="{h}" width="{w}" height="60" fill="#111418"/>')
    out.append(f'<line x1="12" y1="{y}" x2="{12 + bl:.1f}" y2="{y}" stroke="#fff" stroke-width="2"/>'
               f'<text x="12" y="{y + 16}" fill="#ddd" font-size="11">{bar_ft} ft</text>')
    legend = [("#ffffff", "solid", "Parcel"), ("#f59e0b", "dash", "Building setback"), ("#a3e635", "dash", "Parking setback"),
              ("#f5f5f5", "solid", "Road"), ("#60a5fa", "solid", "Stream"), ("#2dd4bf", "solid", "Wetland (NWI)"),
              ("#3b82f6", "solid", "Floodplain"), ("#e0c080", "solid", "Contours 10 ft")]
    lx = 30 + bl + 30
    for col, style, label in legend:
        dash = ' stroke-dasharray="5 3"' if style == "dash" else ""
        out.append(f'<line x1="{lx:.0f}" y1="{y}" x2="{lx + 18:.0f}" y2="{y}" stroke="{col}" stroke-width="2"{dash}/>'
                   f'<text x="{lx + 22:.0f}" y="{y + 4}" fill="#ddd" font-size="11">{label}</text>')
        lx += 30 + 6.2 * len(label)
    title = f'{md["siteName"]}: {pkg["parcel"]["areaAc"]:.2f} ac, zoning {pkg["zoning"].get("district") or "unknown"}. North is up.'
    out.append(f'<text x="12" y="{h + 50}" fill="#aaa" font-size="11">{title}</text>')
    out.append("</svg>")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out))
