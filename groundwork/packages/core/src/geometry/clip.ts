/**
 * Robust polygon booleans and offsets (Clipper, integer arithmetic).
 * Inputs are translated to a local origin and scaled to 0.001 ft so that state-plane
 * coordinates (~2.4e6 ft) stay inside Clipper's fast integer range.
 */
import ClipperLib from 'clipper-lib';
import { type Pt, type Region, type Ring, signedArea } from './basic';

const SCALE = 1000; // 0.001 ft resolution

type IntPath = { X: number; Y: number }[];

function originOf(regions: (Region | Pt[])[]): Pt {
  for (const r of regions) {
    for (const item of r) {
      if (typeof (item as any)[0] === 'number') return [Math.floor((item as Pt)[0]), Math.floor((item as Pt)[1])];
      const ring = item as Ring;
      if (ring.length) return [Math.floor(ring[0][0]), Math.floor(ring[0][1])];
    }
  }
  return [0, 0];
}
function toInt(ring: Pt[], o: Pt): IntPath {
  return ring.map((p) => ({ X: Math.round((p[0] - o[0]) * SCALE), Y: Math.round((p[1] - o[1]) * SCALE) }));
}
function fromInt(paths: IntPath[], o: Pt): Region {
  const out: Region = [];
  for (const path of paths) {
    if (path.length < 3) continue;
    const ring: Ring = path.map((p) => [p.X / SCALE + o[0], p.Y / SCALE + o[1]]);
    if (Math.abs(signedArea(ring)) > 1e-4) out.push(ring);
  }
  return out;
}

function boolOp(type: number, subject: Region, clip: Region): Region {
  const o = originOf([subject, clip]);
  const c = new ClipperLib.Clipper();
  if (subject.length) c.AddPaths(subject.map((r) => toInt(r, o)), ClipperLib.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip.map((r) => toInt(r, o)), ClipperLib.PolyType.ptClip, true);
  const sol: IntPath[] = [];
  c.Execute(type, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return fromInt(sol, o);
}

/** Make every ring CCW so non-zero union treats all rings as solid. */
function solid(regions: Region[]): Region {
  const out: Region = [];
  for (const reg of regions) for (const r of reg) out.push(signedArea(r) < 0 ? r.slice().reverse() : r);
  return out;
}

export function union(...regions: Region[]): Region {
  const all: Region = [];
  for (const r of regions) all.push(...r);
  if (!all.length) return [];
  return boolOp(ClipperLib.ClipType.ctUnion, all, []);
}
/** Union where every input ring is treated as a solid (orientation ignored). */
export function unionSolids(regions: Region[]): Region {
  const all = solid(regions);
  if (!all.length) return [];
  return boolOp(ClipperLib.ClipType.ctUnion, all, []);
}
export function intersect(a: Region, b: Region): Region {
  if (!a.length || !b.length) return [];
  return boolOp(ClipperLib.ClipType.ctIntersection, a, b);
}
export function difference(a: Region, b: Region): Region {
  if (!a.length) return [];
  if (!b.length) return a;
  return boolOp(ClipperLib.ClipType.ctDifference, a, b);
}

export type JoinType = 'miter' | 'round' | 'square';
function joinType(j: JoinType): number {
  return j === 'miter' ? ClipperLib.JoinType.jtMiter : j === 'round' ? ClipperLib.JoinType.jtRound : ClipperLib.JoinType.jtSquare;
}

/** Offset a closed region outward (positive) or inward (negative). */
export function offsetRegion(region: Region, deltaFt: number, join: JoinType = 'miter'): Region {
  if (!region.length) return [];
  if (deltaFt === 0) return region;
  const o = originOf([region]);
  const co = new ClipperLib.ClipperOffset(4, 0.02 * SCALE);
  co.AddPaths(region.map((r) => toInt(r, o)), joinType(join), ClipperLib.EndType.etClosedPolygon);
  const sol: IntPath[] = [];
  co.Execute(sol, deltaFt * SCALE);
  return fromInt(sol, o);
}

export type EndType = 'butt' | 'square' | 'round';
/** Buffer an open polyline by `halfWidthFt` on each side. */
export function bufferPolyline(line: Pt[], halfWidthFt: number, end: EndType = 'butt', join: JoinType = 'round'): Region {
  if (line.length < 2 || halfWidthFt <= 0) return [];
  const o = originOf([line]);
  const co = new ClipperLib.ClipperOffset(4, 0.05 * SCALE);
  const et =
    end === 'butt' ? ClipperLib.EndType.etOpenButt : end === 'square' ? ClipperLib.EndType.etOpenSquare : ClipperLib.EndType.etOpenRound;
  co.AddPath(toInt(line, o), joinType(join), et);
  const sol: IntPath[] = [];
  co.Execute(sol, halfWidthFt * SCALE);
  return fromInt(sol, o);
}

/** Area of the intersection of two regions (0 when disjoint). */
export function overlapArea(a: Region, b: Region): number {
  const i = intersect(a, b);
  let s = 0;
  for (const r of i) s += signedArea(r);
  return Math.abs(s);
}

/** Remove tiny slivers and simplify vertices closer than tol. */
export function cleanRegion(region: Region, tolFt = 0.01): Region {
  if (!region.length) return [];
  const o = originOf([region]);
  const paths = region.map((r) => toInt(r, o));
  const cleaned = ClipperLib.Clipper.CleanPolygons(paths, tolFt * SCALE);
  return fromInt(cleaned, o);
}

/** Outer rings only (CCW), largest first. */
export function outerRings(region: Region): Ring[] {
  return region.filter((r) => signedArea(r) > 0).sort((a, b) => signedArea(b) - signedArea(a));
}
