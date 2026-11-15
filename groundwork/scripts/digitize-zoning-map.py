#!/usr/bin/env python3
"""
One-off tool: digitize zoning districts around a lot from the North Lebanon Township zoning map PDF.

The map's district fills are raster (150 ppi) and its linework is vector, so the page is rendered,
each pixel is classified by fill colour, linework and labels are filled in from their neighbours,
and district outlines are traced. The raster is georeferenced by sliding the lot polygon over the
map's Industrial district until they overlap best (the map is north-up at 1 inch = 1,000 ft).

The result is APPROXIMATE (about +/- 10 ft plus the map's own generalization). It was used once to
build data/sources/north-lebanon-township/zoning-districts-2023.json, which the site fetch reads.

Needs: Python 3 with numpy and Pillow, and poppler's `pdftoppm`.

  curl -L -o zoning-map.pdf https://northlebanontwppa.gov/wp-content/uploads/2023/06/NLT-Zoning-Map-2023.pdf
  python3 scripts/digitize-zoning-map.py zoning-map.pdf data/sites/heilmandale/site.json out.json
"""
import json, math, subprocess, sys, tempfile, os
import numpy as np
from PIL import Image, ImageDraw

sys.setrecursionlimit(100000)
DPI = 300
# Window of the 41.5 x 29 in page that holds the lot, in pixels at DPI (x, y, width, height).
WINDOW = (750, 2500, 2600, 2000)
FT_PER_PX = 1000.0 / DPI  # the map's stated scale
# District fill colours as rendered (the fills are semi-transparent, so lighter than the legend).
COLOURS = {'A': (233, 254, 201), 'I': (229, 229, 229), 'RR': (254, 202, 130), 'R1': (254, 254, 202), 'C2A': (254, 138, 138), 'R2': (202, 162, 130), 'MR1': (170, 206, 254), 'C1': (254, 202, 234)}
KINDS = {'A': ('Agricultural', 'agricultural'), 'RR': ('Rural Residential', 'residential'), 'R1': ('Low Density Residential', 'residential'), 'R2': ('High Density Residential', 'residential'),
         'C1': ('Neighborhood Commercial', 'commercial'), 'C2A': ('General Commercial', 'commercial'), 'MR1': ('Municipal Recreation', 'other'), 'I': ('Industrial', 'industrial')}


def classify(img):
    names = list(COLOURS)
    c = np.array([COLOURS[n] for n in names])
    d = ((img[:, :, None, :] - c[None, None, :, :]) ** 2).sum(-1)
    cls = d.argmin(-1)
    cls[d.min(-1) > 200] = -1  # linework, labels, flood-zone overlay
    for _ in range(200):  # fill unknown pixels from classified neighbours
        unk = cls == -1
        if not unk.any():
            break
        new = cls.copy()
        for sh in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nb = np.roll(cls, sh, axis=(0, 1))
            m = unk & (nb != -1) & (new == -1)
            new[m] = nb[m]
        cls = new

    def majority(c, k=2):  # 5 x 5 majority filter removes speckle
        h, w = c.shape
        best = np.zeros((h, w), int)
        bestn = np.zeros((h, w), int)
        for v in range(len(names)):
            m = (c == v).astype(int)
            acc = np.zeros((h, w), int)
            for dy in range(-k, k + 1):
                for dx in range(-k, k + 1):
                    acc += np.roll(m, (dy, dx), axis=(0, 1))
            upd = acc > bestn
            best[upd] = v
            bestn[upd] = acc[upd]
        return best

    return majority(majority(cls)), names


def georeference(industrial, lot):
    h, w = industrial.shape

    def mask(s, ox, oy):
        im = Image.new('1', (w, h), 0)
        ImageDraw.Draw(im).polygon([((p[0] - ox) / s, (oy - p[1]) / s) for p in lot], fill=1)
        return np.array(im, dtype=bool)

    xs = [p[0] for p in lot]
    ys = [p[1] for p in lot]
    best = (0.0, FT_PER_PX, 0.0, 0.0)
    for wx in range(0, w - 1000, 20):  # coarse: slide the lot's NW corner over the window
        for ny in range(0, h - 600, 20):
            ox, oy = min(xs) - wx * FT_PER_PX, max(ys) + ny * FT_PER_PX
            m = mask(FT_PER_PX, ox, oy)
            v = (m & industrial).sum() / m.sum()
            if v > best[0]:
                best = (v, FT_PER_PX, ox, oy)
    _, s, ox, oy = best
    m0 = mask(s, ox, oy)
    yy, xx = np.nonzero(m0)
    y0, y1, x0, x1 = yy.min() - 25, yy.max() + 25, xx.min() - 25, xx.max() + 25
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)

    def iou(s, ox, oy):  # true overlap score near the lot only
        m = mask(s, ox, oy)[y0:y1, x0:x1]
        i = industrial[y0:y1, x0:x1]
        return (m & i).sum() / (m | i).sum()

    best = (iou(s, ox, oy), s, ox, oy)
    for _ in range(3):  # fine: scale and offset, keeping the lot centroid's pixel fixed while scaling
        for ss in np.arange(3.30, 3.381, 0.005):
            pxc, pyc = (cx - best[2]) / best[1], (best[3] - cy) / best[1]
            for dx in range(-3, 4):
                for dy in range(-3, 4):
                    ox2, oy2 = cx - (pxc + dx) * ss, cy + (pyc + dy) * ss
                    v = iou(ss, ox2, oy2)
                    if v > best[0]:
                        best = (v, float(ss), ox2, oy2)
    return best


def trace(mask):
    """Boundary loops of a binary mask (pixel-edge chains)."""
    m = np.pad(mask, 1)
    edges = {}
    ys, xs = np.nonzero(m)

    def add(a, b):
        edges.setdefault(a, []).append(b)

    up, dn, lf, rt = ~m[ys - 1, xs], ~m[ys + 1, xs], ~m[ys, xs - 1], ~m[ys, xs + 1]
    for y, x in zip(ys[up].tolist(), xs[up].tolist()): add((x + 1, y), (x, y))
    for y, x in zip(ys[dn].tolist(), xs[dn].tolist()): add((x, y + 1), (x + 1, y + 1))
    for y, x in zip(ys[lf].tolist(), xs[lf].tolist()): add((x, y), (x, y + 1))
    for y, x in zip(ys[rt].tolist(), xs[rt].tolist()): add((x + 1, y + 1), (x + 1, y))
    loops = []
    while edges:
        start = next(iter(edges))
        cur, loop = start, [start]
        while True:
            outs = edges[cur]
            nxt = outs.pop()
            if not outs:
                del edges[cur]
            cur = nxt
            if cur == start:
                break
            loop.append(cur)
        loops.append([(x - 1, y - 1) for x, y in loop])
    return loops


def area(r):
    return sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r))) / 2


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        t = 0 if l2 == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
        d = math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
        if d > dmax:
            dmax, idx = d, i
    if dmax <= tol:
        return [a, b]
    return simplify(pts[:idx + 1], tol)[:-1] + simplify(pts[idx:], tol)


def main():
    pdf, site_json, out = sys.argv[1:4]
    lot = json.load(open(site_json))['parcel']['ring']
    with tempfile.TemporaryDirectory() as tmp:
        x, y, w, h = WINDOW
        subprocess.run(['pdftoppm', '-r', str(DPI), '-x', str(x), '-y', str(y), '-W', str(w), '-H', str(h), '-png', pdf, os.path.join(tmp, 'win')], check=True)
        img = np.array(Image.open(os.path.join(tmp, 'win-1.png')).convert('RGB')).astype(int)
    cls, names = classify(img)
    score, s, ox, oy = georeference(cls == names.index('I'), lot)
    print(f'georeferenced: {s:.3f} ft/px, overlap {score * 100:.1f}%')
    districts = []
    for ci, code in enumerate(names):
        for loop in trace(cls == ci):
            ring = [(ox + px * s, oy - py * s) for px, py in loop]
            a = area(ring)
            if a < 43560:  # holes (negative area) and anything under 1 ac (map symbols, speckle)
                continue
            k = max(range(len(ring)), key=lambda i: (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2)
            simple = simplify(ring[:k + 1], 5)[:-1] + simplify(ring[k:] + [ring[0]], 5)[:-1]
            name, kind = KINDS[code]
            districts.append({'code': code, 'name': name, 'kind': kind, 'areaAcInWindow': round(a / 43560, 2), 'ring': [[round(px, 1), round(py, 1)] for px, py in simple]})
    json.dump({
        'jurisdiction': 'North Lebanon Township, Lebanon County, PA',
        'source': 'https://northlebanontwppa.gov/wp-content/uploads/2023/06/NLT-Zoning-Map-2023.pdf',
        'sourceTitle': 'North Lebanon Township Zoning Map (adopted 4/17/2023, printed 6/2/2023; prepared by the Lebanon City Authority / County GIS Department)',
        'crs': 'EPSG:2272',
        'method': f'The PDF was rendered at {DPI} dpi; district fill colours were classified per pixel, linework and labels were filled from their neighbours, and district outlines were traced and simplified (5 ft tolerance). The raster was georeferenced by matching the Industrial district at the lot to the county tax parcel (best fit {s:.3f} ft per pixel, overlap {score * 100:.1f}%).',
        'accuracyNote': "Approximate: about +/- 10 ft plus the map's own generalization. The map states that boundaries shown along roads follow the road centerlines and that the Zoning Hearing Board decides any uncertainty. Only the window around the lot was digitized; polygons are cut off at the window edge.",
        'window': {'minX': round(ox), 'maxX': round(ox + WINDOW[2] * s), 'minY': round(oy - WINDOW[3] * s), 'maxY': round(oy)},
        'districts': districts,
    }, open(out, 'w'), indent=1)
    print(f'wrote {len(districts)} district polygons to {out}')


if __name__ == '__main__':
    main()
