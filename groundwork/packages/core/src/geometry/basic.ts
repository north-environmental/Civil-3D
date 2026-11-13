/**
 * Basic planar geometry. All coordinates are in the site's projected CRS, US survey feet.
 * A Ring is an implicitly closed list of points (first point is NOT repeated at the end).
 * A Region is a list of rings (outer rings CCW, holes CW); point-in-region uses even-odd.
 */
export type Pt = [number, number];
export type Ring = Pt[];
export type Region = Ring[];
export type BBox = { minX: number; minY: number; maxX: number; maxY: number };

export const EPS = 1e-9;

export function sub(a: Pt, b: Pt): Pt {
  return [a[0] - b[0], a[1] - b[1]];
}
export function add(a: Pt, b: Pt): Pt {
  return [a[0] + b[0], a[1] + b[1]];
}
export function scale(a: Pt, k: number): Pt {
  return [a[0] * k, a[1] * k];
}
export function dot(a: Pt, b: Pt): number {
  return a[0] * b[0] + a[1] * b[1];
}
export function cross(a: Pt, b: Pt): number {
  return a[0] * b[1] - a[1] * b[0];
}
export function len(a: Pt): number {
  return Math.hypot(a[0], a[1]);
}
export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
export function norm(a: Pt): Pt {
  const l = len(a);
  return l < EPS ? [0, 0] : [a[0] / l, a[1] / l];
}
export function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
/** Left-hand perpendicular (rotate +90°). */
export function perp(a: Pt): Pt {
  return [-a[1], a[0]];
}
export function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}
export function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}
/** Unit vector for an angle in degrees, CCW from +x (east). */
export function unitDeg(angleDeg: number): Pt {
  const r = degToRad(angleDeg);
  return [Math.cos(r), Math.sin(r)];
}
/** Normalize an angle to [0, 360). */
export function norm360(a: number): number {
  return ((a % 360) + 360) % 360;
}
/** Smallest absolute difference between two directions treated as undirected lines (0..90). */
export function axisAngleDiffDeg(a: number, b: number): number {
  const d = Math.abs(norm360(a - b)) % 180;
  return d > 90 ? 180 - d : d;
}
/** Azimuth (degrees clockwise from north) of a vector. */
export function azimuthDeg(v: Pt): number {
  return norm360(radToDeg(Math.atan2(v[0], v[1])));
}

/** Signed area of a ring (positive = CCW). */
export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
export function ringArea(ring: Ring): number {
  return Math.abs(signedArea(ring));
}
/** Area of a region (outer rings positive, holes negative by orientation). */
export function regionArea(region: Region): number {
  let a = 0;
  for (const r of region) a += signedArea(r);
  return Math.abs(a);
}
export function ensureCCW(ring: Ring): Ring {
  return signedArea(ring) < 0 ? ring.slice().reverse() : ring;
}
export function ringCentroid(ring: Ring): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < EPS) return ring[0] ?? [0, 0];
  return [cx / (3 * a), cy / (3 * a)];
}
export function ringPerimeter(ring: Ring): number {
  let l = 0;
  for (let i = 0, n = ring.length; i < n; i++) l += dist(ring[i], ring[(i + 1) % n]);
  return l;
}
export function bboxOf(points: Pt[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}
export function bboxOfRegion(region: Region): BBox {
  return bboxOf(region.flat());
}
export function expandBBox(b: BBox, d: number): BBox {
  return { minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d };
}
export function unionBBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function pointInRing(p: Pt, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}
export function pointInRegion(p: Pt, region: Region): boolean {
  let inside = false;
  for (const r of region) if (pointInRing(p, r)) inside = !inside;
  return inside;
}

/** Closest point on segment ab to p, with parameter t in [0,1]. */
export function closestOnSegment(p: Pt, a: Pt, b: Pt): { pt: Pt; t: number; d: number } {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const l2 = abx * abx + aby * aby;
  let t = l2 < EPS ? 0 : ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const pt: Pt = [a[0] + abx * t, a[1] + aby * t];
  return { pt, t, d: Math.hypot(p[0] - pt[0], p[1] - pt[1]) };
}
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  return closestOnSegment(p, a, b).d;
}
/** Distance from a point to a ring's boundary (not signed). */
export function distToRing(p: Pt, ring: Ring): number {
  let best = Infinity;
  for (let i = 0, n = ring.length; i < n; i++) {
    const d = distToSegment(p, ring[i], ring[(i + 1) % n]);
    if (d < best) best = d;
  }
  return best;
}
export function distToRegionBoundary(p: Pt, region: Region): number {
  let best = Infinity;
  for (const r of region) best = Math.min(best, distToRing(p, r));
  return best;
}
export function distToPolyline(p: Pt, line: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) best = Math.min(best, distToSegment(p, line[i], line[i + 1]));
  return best;
}
/** Closest point on a polyline with station (distance along). */
export function closestOnPolyline(p: Pt, line: Pt[]): { pt: Pt; d: number; station: number; segIndex: number } {
  let best = { pt: line[0], d: Infinity, station: 0, segIndex: 0 };
  let acc = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const c = closestOnSegment(p, line[i], line[i + 1]);
    const segLen = dist(line[i], line[i + 1]);
    if (c.d < best.d) best = { pt: c.pt, d: c.d, station: acc + c.t * segLen, segIndex: i };
    acc += segLen;
  }
  return best;
}
export function polylineLength(line: Pt[]): number {
  let l = 0;
  for (let i = 0; i + 1 < line.length; i++) l += dist(line[i], line[i + 1]);
  return l;
}
/** Point at a station along a polyline (clamped), with the local unit direction. */
export function pointAlong(line: Pt[], station: number): { pt: Pt; dir: Pt } {
  let acc = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const segLen = dist(line[i], line[i + 1]);
    if (station <= acc + segLen || i === line.length - 2) {
      const t = segLen < EPS ? 0 : Math.max(0, Math.min(1, (station - acc) / segLen));
      return { pt: lerp(line[i], line[i + 1], t), dir: norm(sub(line[i + 1], line[i])) };
    }
    acc += segLen;
  }
  return { pt: line[line.length - 1], dir: [1, 0] };
}

/** Proper segment intersection test (shared endpoints / collinear touching count as intersecting). */
export function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p: Pt, q: Pt, r: Pt) =>
    Math.min(p[0], q[0]) - EPS <= r[0] &&
    r[0] <= Math.max(p[0], q[0]) + EPS &&
    Math.min(p[1], q[1]) - EPS <= r[1] &&
    r[1] <= Math.max(p[1], q[1]) + EPS;
  if (Math.abs(d1) < EPS && on(a, b, c)) return true;
  if (Math.abs(d2) < EPS && on(a, b, d)) return true;
  if (Math.abs(d3) < EPS && on(c, d, a)) return true;
  if (Math.abs(d4) < EPS && on(c, d, b)) return true;
  return false;
}
/** Intersection point of infinite lines (a,b) and (c,d), or null if parallel. */
export function lineIntersection(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < EPS) return null;
  const t = cross(sub(c, a), s) / den;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}

/** True when every vertex of `inner` is inside `outer` and no edges cross. */
export function ringInsideRegion(inner: Ring, outer: Region, tol = 0): boolean {
  for (const p of inner) {
    if (!pointInRegion(p, outer)) {
      if (tol > 0 && distToRegionBoundary(p, outer) <= tol) continue;
      return false;
    }
  }
  for (let i = 0, n = inner.length; i < n; i++) {
    const a = inner[i];
    const b = inner[(i + 1) % n];
    // Sample the midpoint as a cheap guard against edges that leave a concave region.
    const m = lerp(a, b, 0.5);
    if (!pointInRegion(m, outer) && !(tol > 0 && distToRegionBoundary(m, outer) <= tol)) return false;
    for (const r of outer) {
      for (let k = 0, rn = r.length; k < rn; k++) {
        const c = r[k];
        const d = r[(k + 1) % rn];
        const d1 = cross(sub(b, a), sub(c, a));
        const d2 = cross(sub(b, a), sub(d, a));
        const d3 = cross(sub(d, c), sub(a, c));
        const d4 = cross(sub(d, c), sub(b, c));
        if (((d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol)) && ((d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol))) {
          // strict crossing
          if (tol === 0) return false;
          const ip = lineIntersection(a, b, c, d);
          if (ip && Math.min(dist(ip, a), dist(ip, b)) > tol) return false;
        }
      }
    }
  }
  return true;
}

/** A local frame: origin + rotation (degrees CCW from east). u = along angle, v = left of u. */
export type Frame = { origin: Pt; angleDeg: number };
export function toWorld(f: Frame, uv: Pt): Pt {
  const r = degToRad(f.angleDeg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [f.origin[0] + uv[0] * c - uv[1] * s, f.origin[1] + uv[0] * s + uv[1] * c];
}
export function toLocal(f: Frame, p: Pt): Pt {
  const r = degToRad(f.angleDeg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = p[0] - f.origin[0];
  const dy = p[1] - f.origin[1];
  return [dx * c + dy * s, -dx * s + dy * c];
}
/** Rectangle in a frame given local u/v extents, returned CCW in world coordinates. */
export function frameRect(f: Frame, u0: number, v0: number, u1: number, v1: number): Ring {
  const ua = Math.min(u0, u1);
  const ub = Math.max(u0, u1);
  const va = Math.min(v0, v1);
  const vb = Math.max(v0, v1);
  return [toWorld(f, [ua, va]), toWorld(f, [ub, va]), toWorld(f, [ub, vb]), toWorld(f, [ua, vb])];
}
/** Rectangle centered at `center`, `lengthFt` along the angle, `depthFt` across. */
export function orientedRect(center: Pt, lengthFt: number, depthFt: number, angleDeg: number): Ring {
  return frameRect({ origin: center, angleDeg }, -lengthFt / 2, -depthFt / 2, lengthFt / 2, depthFt / 2);
}

/** Douglas-Peucker simplification of an open polyline. */
export function simplifyPolyline(line: Pt[], tol: number): Pt[] {
  if (line.length <= 2) return line.slice();
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(line[i], line[a], line[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tol) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

export function round(v: number, digits = 2): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}
export function roundPt(p: Pt, digits = 2): Pt {
  return [round(p[0], digits), round(p[1], digits)];
}
export function roundRing(r: Ring, digits = 2): Ring {
  return r.map((p) => roundPt(p, digits));
}

/** Minimum distance between a ring's boundary and a segment (0 if they cross). */
export function ringToSegmentDist(ring: Ring, a: Pt, b: Pt): number {
  let best = Infinity;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    if (segmentsIntersect(p, q, a, b)) return 0;
    best = Math.min(best, distToSegment(p, a, b), distToSegment(a, p, q), distToSegment(b, p, q));
  }
  return best;
}
/** Minimum distance between two rings' boundaries (0 if they cross or one contains the other). */
export function ringToRingDist(r1: Ring, r2: Ring): number {
  if (pointInRing(r1[0], r2) || pointInRing(r2[0], r1)) return 0;
  let best = Infinity;
  for (let i = 0, n = r2.length; i < n; i++) {
    best = Math.min(best, ringToSegmentDist(r1, r2[i], r2[(i + 1) % n]));
    if (best === 0) return 0;
  }
  return best;
}
export function regionToRingDist(region: Region, ring: Ring): number {
  let best = Infinity;
  for (const r of region) best = Math.min(best, ringToRingDist(r, ring));
  return best;
}
/** Outward unit normal of edge i of a CCW ring. */
export function outwardNormalOf(ring: Ring, i: number): Pt {
  const a = ring[i];
  const b = ring[(i + 1) % ring.length];
  const d = norm(sub(b, a));
  return [d[1], -d[0]];
}
