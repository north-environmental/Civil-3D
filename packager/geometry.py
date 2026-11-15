"""Parcel edge classification (front / side / rear) and setback envelopes.

Edge logic ported from the prototype (groundwork/packages/core/src/zoning/edges.ts):
an edge is a FRONT edge when a road centerline runs alongside it, roughly parallel, on the
outside; REAR edges face away from the main frontage; everything else is a SIDE edge.

Envelope logic: a point may hold a building only if it is at least the required setback from
every property line. That region is the parcel minus a round-ended buffer of each edge by its
setback (for front edges, the setback is measured from the road right-of-way line, so the
right-of-way inset is added).
"""

import math

from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

ROW_MATCH_TOL_FT = 20          # digitizing tolerance when matching an edge to a road, ft
FRONTAGE_ANGLE_TOL_DEG = 30    # max angle between edge and road to count as frontage
CENTERLINE_SIDE_TOL_FT = 15    # a deeded-to-centerline lot can sit a little either side of the road line
MIN_ENVELOPE_PIECE_SF = 1000   # drop slivers smaller than this from envelopes


def _norm(v):
    l = math.hypot(v[0], v[1]) or 1.0
    return (v[0] / l, v[1] / l)


def _axis_angle_diff(a_deg, b_deg):
    d = abs(a_deg - b_deg) % 180
    return min(d, 180 - d)


def outward_normal(a, b):
    """Parcel ring is counter-clockwise, so the inside is on the left and outward is on the right."""
    d = _norm((b[0] - a[0], b[1] - a[1]))
    return (d[1], -d[0])


def normalize_road_name(name):
    import re
    s = (name or "").lower()
    s = re.sub(r"\bpa\b|\bstate\b|\bsr\b", "", s)
    s = re.sub(r"\broute\b|\brte\b|\brt\b", "route", s)
    for long, short in (("road", "rd"), ("lane", "ln"), ("street", "st"), ("avenue", "ave"), ("drive", "dr")):
        s = re.sub(rf"\b{long}\b", short, s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def classify_edges(parcel, roads, address_road=None):
    """Return one dict per outer-ring edge: index, a, b, lengthFt, type, road, rowInsetFt."""
    ring = list(orient(parcel, 1.0).exterior.coords)[:-1]
    n = len(ring)
    edges = []
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        out = outward_normal(a, b)
        edge_angle = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
        best, best_score, best_dist = None, 0.0, 0.0
        for r in roads:
            line = r["centerline"]
            hits, dsum = 0, 0.0
            for t in (0.2, 0.5, 0.8):
                p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
                s = line.project(Point(p))
                c = line.interpolate(s)
                d = math.hypot(c.x - p[0], c.y - p[1])
                p1, p2 = line.interpolate(max(0.0, s - 5)), line.interpolate(min(line.length, s + 5))
                road_angle = math.degrees(math.atan2(p2.y - p1.y, p2.x - p1.x))
                signed = (c.x - p[0]) * out[0] + (c.y - p[1]) * out[1]
                if (d <= r["rowWidthFt"] / 2 + ROW_MATCH_TOL_FT
                        and _axis_angle_diff(edge_angle, road_angle) <= FRONTAGE_ANGLE_TOL_DEG
                        and signed > -max(CENTERLINE_SIDE_TOL_FT, r["rowWidthFt"] / 2)):
                    hits += 1
                    dsum += signed
            score = hits * 1000 - dsum / hits if hits >= 2 else 0
            if score > best_score:
                best, best_score, best_dist = r, score, dsum / hits
        edges.append({
            "index": i, "a": a, "b": b, "lengthFt": length,
            "type": "front" if best else "side",
            "road": best["name"] if best else None,
            "roadId": best["id"] if best else None,
            # When the deed runs to the road centerline, the ROW line is half the ROW width inside the lot.
            "rowInsetFt": round(max(0.0, best["rowWidthFt"] / 2 - best_dist), 1) if best else 0.0,
        })

    fronts = [e for e in edges if e["type"] == "front"]
    if fronts:
        by_road = {}
        for e in fronts:
            by_road[e["roadId"]] = by_road.get(e["roadId"], 0) + e["lengthFt"]
        primary_id = max(by_road, key=by_road.get)
        if address_road:
            want = normalize_road_name(address_road)
            for e in fronts:
                if normalize_road_name(e["road"]) == want:
                    primary_id = e["roadId"]
                    break
        nx = ny = 0.0
        for e in fronts:
            if e["roadId"] == primary_id:
                o = outward_normal(e["a"], e["b"])
                nx += o[0] * e["lengthFt"]
                ny += o[1] * e["lengthFt"]
        primary = _norm((nx, ny))
        for e in edges:
            if e["type"] != "front":
                o = outward_normal(e["a"], e["b"])
                e["type"] = "rear" if (o[0] * -primary[0] + o[1] * -primary[1]) > math.sqrt(0.5) else "side"
    return edges


def setback_envelope(parcel, edges, depth_by_edge):
    """Parcel minus a round-ended buffer of each edge by its depth (ft). Returns list of Polygons."""
    strips = []
    for e in edges:
        d = depth_by_edge[e["index"]]
        if d and d > 0:
            strips.append(LineString([e["a"], e["b"]]).buffer(d, quad_segs=8))
    env = parcel.difference(unary_union(strips)) if strips else parcel
    parts = [env] if env.geom_type == "Polygon" else list(getattr(env, "geoms", []))
    return [orient(p, 1.0) for p in parts if p.geom_type == "Polygon" and p.area >= MIN_ENVELOPE_PIECE_SF]


def polygon_to_json(poly, nd=2):
    def ring(coords):
        pts = list(coords)[:-1]
        return [[round(x, nd), round(y, nd)] for x, y in pts]
    poly = orient(poly, 1.0)  # outer CCW, holes CW
    return {"outer": ring(poly.exterior.coords), "holes": [ring(h.coords) for h in poly.interiors]}


def line_to_json(line, nd=2):
    return [[round(x, nd), round(y, nd)] for x, y in line.coords]
