/**
 * Concept-level grading engine (raster). Pure and deterministic.
 *
 * - Grading objects define finished elevation inside their footprint as z = z0(x, y) + k(x, y) · FFE,
 *   so one prepared model can be evaluated at any finished floor elevation.
 * - Overlaps resolve by priority (pad > truck court > drive > parking > basin).
 * - Outside all footprints the ground ties in to existing at H:V = s:1. For every exterior cell the
 *   distance d is measured from the CELL CENTER to each object's BOUNDARY (exact geometry, not a
 *   cell-to-cell distance transform, which under-reports tie-in volume by ~2 % at 1 ft and ~8 % at 5 ft):
 *       L = max_i(z_i − d_i / s),  U = min_i(z_i + d_i / s),  proposed = clamp(existing, L, U)
 *   Where L > U two objects are too close to tie together: those cells need a retaining wall.
 * - Earthwork is the grid sum of (subgrade − existing) × cell area, split into cut and fill.
 */
import { type Pt, type Region, type Ring, degToRad, pointInRegion, signedArea } from '../geometry/basic';
import type { GradingCriteria } from '../criteria/grading';
import { type Grid, type GridSpec, forEachCellInRegion, rasterizeRegion } from '../geometry/grid';
import type { EarthworkCategory } from '../site/project';

/** Writes [z0, k] for a point: finished elevation = z0 + k · FFE. */
export type SurfaceFn = (x: number, y: number, out: Float64Array) => void;

export type GradingObject = {
  id: string;
  name: string;
  category: Exclude<EarthworkCategory, 'tieIn'>;
  priority: number;
  region: Region;
  surface: SurfaceFn;
  /** Pavement / slab section thickness (finished grade → subgrade), ft. */
  sectionFt: (x: number, y: number) => number;
};

export const PRIORITY = { pad: 5, truckCourt: 4, drive: 3, parking: 2, basin: 1 } as const;

export function flatPad(
  id: string,
  ring: Ring,
  o: { elevFt?: number; ffeOffsetFt?: number; sectionFt?: number; priority?: number; category?: GradingObject['category'] },
): GradingObject {
  const fixed = o.elevFt !== undefined;
  const z0 = fixed ? o.elevFt! : (o.ffeOffsetFt ?? 0);
  const k = fixed ? 0 : 1;
  const sec = o.sectionFt ?? 0;
  return {
    id,
    name: id,
    category: o.category ?? 'pad',
    priority: o.priority ?? PRIORITY.pad,
    region: [signedArea(ring) < 0 ? ring.slice().reverse() : ring],
    surface: (_x, _y, out) => {
      out[0] = z0;
      out[1] = k;
    },
    sectionFt: () => sec,
  };
}

/** A plane that falls at `slopePct` in direction `dirDeg` (CCW from east) from `origin`. */
export function planarPad(
  id: string,
  ring: Ring,
  o: { origin: Pt; dirDeg: number; slopePct: number; elevAtOriginFt?: number; ffeOffsetFt?: number; sectionFt?: number; priority?: number; category?: GradingObject['category'] },
): GradingObject {
  const r = degToRad(o.dirDeg);
  const dx = Math.cos(r);
  const dy = Math.sin(r);
  const g = o.slopePct / 100;
  const fixed = o.elevAtOriginFt !== undefined;
  const base = fixed ? o.elevAtOriginFt! : (o.ffeOffsetFt ?? 0);
  const k = fixed ? 0 : 1;
  const sec = o.sectionFt ?? 0;
  return {
    id,
    name: id,
    category: o.category ?? 'parking',
    priority: o.priority ?? PRIORITY.parking,
    region: [signedArea(ring) < 0 ? ring.slice().reverse() : ring],
    surface: (x, y, out) => {
      out[0] = base - g * ((x - o.origin[0]) * dx + (y - o.origin[1]) * dy);
      out[1] = k;
    },
    sectionFt: () => sec,
  };
}

export type GradingModel = {
  spec: GridSpec;
  existing: Float32Array;
  objects: GradingObject[];
  /** Index into `objects` of the object that owns each cell, or -1 for exterior cells. */
  owner: Int16Array;
  z0: Float32Array;
  k: Float32Array;
  section: Float32Array;
  /** Boundary pieces: [ax, ay, bx, by, z0a, ka, z0b, kb, existingNearFt] per piece. */
  pieces: Float64Array;
  pieceCount: number;
  inParcel: Uint8Array | null;
  criteria: GradingCriteria;
  daylight: boolean;
  sections: boolean;
};

const PIECE = 9;

export function makeModel(opts: { existing: Grid; objects: GradingObject[]; criteria: GradingCriteria; daylight?: boolean; sections?: boolean; parcel?: Ring; onsite?: Region }): GradingModel {
  const g = opts.existing;
  const spec: GridSpec = { x0: g.x0, y0: g.y0, cellFt: g.cellFt, nx: g.nx, ny: g.ny };
  const n = g.nx * g.ny;
  const owner = new Int16Array(n).fill(-1);
  const z0 = new Float32Array(n);
  const k = new Float32Array(n);
  const section = new Float32Array(n);
  const objects = opts.objects;
  const order = objects.map((_, i) => i).sort((a, b) => objects[a].priority - objects[b].priority);
  const out = new Float64Array(2);
  const sections = opts.sections ?? true;
  for (const idx of order) {
    const o = objects[idx];
    forEachCellInRegion(spec, o.region, (i, j) => {
      const c = j * g.nx + i;
      const x = g.x0 + (i + 0.5) * g.cellFt;
      const y = g.y0 + (j + 0.5) * g.cellFt;
      o.surface(x, y, out);
      owner[c] = idx;
      z0[c] = out[0];
      k[c] = out[1];
      section[c] = sections ? o.sectionFt(x, y) : 0;
    });
  }

  // Boundary pieces for the tie-in, skipping edges that face another object (interior joints).
  const daylight = opts.daylight ?? true;
  const data: number[] = [];
  if (daylight) {
    const maxLen = Math.max(15, 3 * g.cellFt);
    const probe = Math.max(0.75, g.cellFt * 0.6);
    for (let oi = 0; oi < objects.length; oi++) {
      const o = objects[oi];
      for (const ring of o.region) {
        const m = ring.length;
        for (let e = 0; e < m; e++) {
          const a = ring[e];
          const b = ring[(e + 1) % m];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 1e-6) continue;
          const parts = Math.max(1, Math.ceil(len / maxLen));
          // Outers are CCW and holes CW, so the non-solid side is on the right of travel.
          const nx = (b[1] - a[1]) / len;
          const ny = -(b[0] - a[0]) / len;
          for (let p = 0; p < parts; p++) {
            const ax = a[0] + ((b[0] - a[0]) * p) / parts;
            const ay = a[1] + ((b[1] - a[1]) * p) / parts;
            const bx = a[0] + ((b[0] - a[0]) * (p + 1)) / parts;
            const by = a[1] + ((b[1] - a[1]) * (p + 1)) / parts;
            const mx = (ax + bx) / 2 + nx * probe;
            const my = (ay + by) / 2 + ny * probe;
            let covered = false;
            for (let q = 0; q < objects.length && !covered; q++) if (q !== oi && pointInRegion([mx, my], objects[q].region)) covered = true;
            if (covered) continue;
            o.surface(ax, ay, out);
            const za = out[0];
            const ka = out[1];
            o.surface(bx, by, out);
            // Existing ground near the piece (for the reach estimate).
            const ci = Math.min(g.nx - 1, Math.max(0, Math.floor(((ax + bx) / 2 - g.x0) / g.cellFt)));
            const cj = Math.min(g.ny - 1, Math.max(0, Math.floor(((ay + by) / 2 - g.y0) / g.cellFt)));
            data.push(ax, ay, bx, by, za, ka, out[0], out[1], g.data[cj * g.nx + ci]);
          }
        }
      }
    }
  }
  return {
    spec,
    existing: g.data,
    objects,
    owner,
    z0,
    k,
    section,
    pieces: Float64Array.from(data),
    pieceCount: data.length / PIECE,
    inParcel: opts.onsite ? rasterizeRegion(spec, opts.onsite) : opts.parcel ? rasterizeRegion(spec, [opts.parcel]) : null,
    criteria: opts.criteria,
    daylight,
    sections,
  };
}

export type WallResult = { id: string; lengthFt: number; maxHeightFt: number; avgHeightFt: number; at: Pt; betweenObjectIds: string[] };
export type EvalResult = {
  ffeFt: number;
  proposed: Float32Array;
  /** Wall height per cell (0 where none); only filled when walls are computed. */
  wallHeight: Float32Array | null;
  cutCf: number;
  fillCf: number;
  /** cut × (1 − shrink) − fill, CF. */
  netCf: number;
  sectionCf: number;
  disturbedSf: number;
  byCategory: { category: EarthworkCategory; cutCf: number; fillCf: number; areaSf: number }[];
  walls: WallResult[];
  offsiteAreaSf: number;
  offsiteMaxDeltaFt: number;
  maxCutFt: number;
  maxFillFt: number;
};

const CATEGORIES: EarthworkCategory[] = ['pad', 'truckCourt', 'parking', 'drive', 'basin', 'tieIn'];

/**
 * Evaluate the model at a finished floor elevation. `quick` skips wall grouping (used by the optimizer).
 */
export function evaluateModel(m: GradingModel, ffeFt: number, opts: { quick?: boolean } = {}): EvalResult {
  const { spec, existing, owner } = m;
  const { nx, ny, cellFt } = spec;
  const n = nx * ny;
  const s = m.criteria.tieInSlopeHtoV;
  const proposed = new Float32Array(n);
  for (let c = 0; c < n; c++) proposed[c] = owner[c] >= 0 ? m.z0[c] + m.k[c] * ffeFt : existing[c];

  let L: Float32Array | null = null;
  let U: Float32Array | null = null;
  if (m.pieceCount) {
    L = new Float32Array(n).fill(-1e9);
    U = new Float32Array(n).fill(1e9);
    const P = m.pieces;
    // Every object's cone must be known wherever ANY other object's tie-in slope can reach (that is how
    // a low pad limits a high neighbor's fill slope), so the reach uses the largest height on the site.
    let hMax = 0;
    for (let p = 0; p < m.pieceCount; p++) {
      const o = p * PIECE;
      const e = P[o + 8];
      hMax = Math.max(hMax, Math.abs(P[o + 4] + P[o + 5] * ffeFt - e), Math.abs(P[o + 6] + P[o + 7] * ffeFt - e));
    }
    const reach = Math.min(500, s * hMax * 1.75 + 15 + 2 * cellFt);
    for (let p = 0; p < m.pieceCount; p++) {
      const o = p * PIECE;
      const ax = P[o];
      const ay = P[o + 1];
      const bx = P[o + 2];
      const by = P[o + 3];
      const za = P[o + 4] + P[o + 5] * ffeFt;
      const zb = P[o + 6] + P[o + 7] * ffeFt;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - spec.x0) / cellFt));
      const i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx) + reach - spec.x0) / cellFt));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - reach - spec.y0) / cellFt));
      const j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by) + reach - spec.y0) / cellFt));
      const abx = bx - ax;
      const aby = by - ay;
      const l2 = abx * abx + aby * aby;
      for (let j = j0; j <= j1; j++) {
        const y = spec.y0 + (j + 0.5) * cellFt;
        const row = j * nx;
        for (let i = i0; i <= i1; i++) {
          const c = row + i;
          if (owner[c] >= 0) continue;
          const x = spec.x0 + (i + 0.5) * cellFt;
          let t = ((x - ax) * abx + (y - ay) * aby) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + abx * t - x;
          const qy = ay + aby * t - y;
          const d = Math.sqrt(qx * qx + qy * qy);
          if (d > reach) continue;
          const z = za + (zb - za) * t;
          const lo = z - d / s;
          const hi = z + d / s;
          if (lo > L[c]) L[c] = lo;
          if (hi < U[c]) U[c] = hi;
        }
      }
    }
  }

  const cut = new Float64Array(CATEGORIES.length);
  const fill = new Float64Array(CATEGORIES.length);
  const area = new Float64Array(CATEGORIES.length);
  const catIndex = m.objects.map((o) => CATEGORIES.indexOf(o.category));
  const tie = CATEGORIES.indexOf('tieIn');
  const cellArea = cellFt * cellFt;
  const wallHeight = opts.quick ? null : new Float32Array(n);
  let sectionCf = 0;
  let disturbed = 0;
  let offsite = 0;
  let offsiteMax = 0;
  let maxCut = 0;
  let maxFill = 0;
  let anyWall = false;
  const tol = m.criteria.offsiteToleranceFt;
  for (let c = 0; c < n; c++) {
    const e = existing[c];
    let diff: number;
    let cat: number;
    if (owner[c] >= 0) {
      const sec = m.section[c];
      diff = proposed[c] - sec - e;
      sectionCf += sec * cellArea;
      cat = catIndex[owner[c]];
      disturbed += cellArea;
      area[cat] += cellArea;
    } else {
      if (!L || L[c] < -1e8) continue;
      const lo = L[c];
      const hi = U![c];
      let z: number;
      if (lo > hi + 1e-4) {
        // Too close to tie in at s:1 from both sides: a wall takes up the difference.
        z = e < hi ? hi : e > lo ? lo : e;
        if (wallHeight) {
          wallHeight[c] = lo - hi;
          anyWall = true;
        }
      } else z = e < lo ? lo : e > hi ? hi : e;
      proposed[c] = z;
      diff = z - e;
      if (Math.abs(diff) < 0.005) continue;
      cat = tie;
      disturbed += cellArea;
      area[cat] += cellArea;
    }
    if (diff > 0) {
      fill[cat] += diff * cellArea;
      if (proposed[c] - e > maxFill) maxFill = proposed[c] - e;
    } else {
      cut[cat] -= diff * cellArea;
      if (e - proposed[c] > maxCut) maxCut = e - proposed[c];
    }
    if (m.inParcel && !m.inParcel[c]) {
      const dz = Math.abs(proposed[c] - e);
      if (dz > tol) {
        offsite += cellArea;
        if (dz > offsiteMax) offsiteMax = dz;
      }
    }
  }
  let cutCf = 0;
  let fillCf = 0;
  for (let i = 0; i < CATEGORIES.length; i++) {
    cutCf += cut[i];
    fillCf += fill[i];
  }
  const walls = wallHeight && anyWall ? groupWalls(m, wallHeight) : [];
  return {
    ffeFt,
    proposed,
    wallHeight,
    cutCf,
    fillCf,
    netCf: cutCf * (1 - m.criteria.shrinkPct / 100) - fillCf,
    sectionCf,
    disturbedSf: disturbed,
    byCategory: CATEGORIES.map((category, i) => ({ category, cutCf: cut[i], fillCf: fill[i], areaSf: area[i] })).filter((r) => r.areaSf > 0),
    walls,
    offsiteAreaSf: offsite,
    offsiteMaxDeltaFt: offsiteMax,
    maxCutFt: maxCut,
    maxFillFt: maxFill,
  };
}

/** Group wall cells into walls (4-connected), with length, max/avg height and the objects they separate. */
function groupWalls(m: GradingModel, wallHeight: Float32Array): WallResult[] {
  const { nx, ny, cellFt, x0, y0 } = m.spec;
  const minH = m.criteria.minWallHeightFt;
  const seen = new Uint8Array(nx * ny);
  const out: WallResult[] = [];
  const stack: number[] = [];
  for (let start = 0; start < wallHeight.length; start++) {
    if (seen[start] || wallHeight[start] <= 0.05) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    let cells = 0;
    let sumH = 0;
    let maxH = 0;
    let sx = 0;
    let sy = 0;
    let adj = 0;
    const neighbors = new Set<number>();
    while (stack.length) {
      const c = stack.pop()!;
      const i = c % nx;
      const j = (c - i) / nx;
      const h = wallHeight[c];
      cells++;
      sumH += h;
      if (h > maxH) maxH = h;
      sx += i;
      sy += j;
      const nb = [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, j > 0 ? c - nx : -1, j < ny - 1 ? c + nx : -1];
      for (const q of nb) {
        if (q < 0) continue;
        if (m.owner[q] >= 0) {
          adj++;
          neighbors.add(m.owner[q]);
        } else if (!seen[q] && wallHeight[q] > 0.05) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (maxH < minH) continue;
    // The wall zone touches the objects on both sides, so half the contact length is the wall length.
    const lengthFt = Math.max((adj * cellFt) / 2, Math.sqrt(cells) * cellFt);
    out.push({
      id: `wall-${out.length + 1}`,
      lengthFt,
      maxHeightFt: maxH,
      avgHeightFt: sumH / cells,
      at: [x0 + (sx / cells + 0.5) * cellFt, y0 + (sy / cells + 0.5) * cellFt],
      betweenObjectIds: [...neighbors].map((i) => m.objects[i].id),
    });
  }
  return out.sort((a, b) => b.maxHeightFt * b.lengthFt - a.maxHeightFt * a.lengthFt).map((w, i) => ({ ...w, id: `wall-${i + 1}` }));
}

export type FfeSolution = { ffeFt: number; achieved: boolean; netCf: number; iterations: number; bound: 'none' | 'min' | 'max' };

/**
 * Solve net(FFE) = target by bisection within [minFt, maxFt]. Net (cut × (1 − shrink) − fill) falls
 * monotonically as FFE rises. If the target is not reachable inside the range, returns the nearest bound.
 */
export function solveFfe(m: GradingModel, o: { targetNetCf: number; minFt: number; maxFt: number; tolFt?: number }): FfeSolution {
  const f = (ffe: number) => evaluateModel(m, ffe, { quick: true }).netCf - o.targetNetCf;
  let lo = o.minFt;
  let hi = o.maxFt;
  let flo = f(lo);
  let fhi = f(hi);
  let iterations = 2;
  if (flo <= 0) return { ffeFt: lo, achieved: Math.abs(flo) < 1, netCf: flo + o.targetNetCf, iterations, bound: 'min' };
  if (fhi >= 0) return { ffeFt: hi, achieved: Math.abs(fhi) < 1, netCf: fhi + o.targetNetCf, iterations, bound: 'max' };
  const tol = o.tolFt ?? 0.002;
  while (hi - lo > tol && iterations < 60) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    iterations++;
    if (fm > 0) {
      lo = mid;
      flo = fm;
    } else {
      hi = mid;
      fhi = fm;
    }
  }
  // Linear interpolation inside the final bracket.
  const ffe = flo === fhi ? (lo + hi) / 2 : lo + ((hi - lo) * flo) / (flo - fhi);
  return { ffeFt: ffe, achieved: true, netCf: f(ffe) + o.targetNetCf, iterations: iterations + 1, bound: 'none' };
}

/** Max and mean slope (percent) of a surface over the cells inside `ring` (central differences). */
export function surfaceSlopePct(m: GradingModel, surface: Float32Array, ring: Ring): { maxPct: number; avgPct: number; cells: number } {
  const { nx, ny, cellFt } = m.spec;
  let max = 0;
  let sum = 0;
  let cells = 0;
  forEachCellInRegion(m.spec, [ring], (i, j) => {
    if (i < 1 || j < 1 || i >= nx - 1 || j >= ny - 1) return;
    const c = j * nx + i;
    const o = m.owner[c];
    // Only difference across cells of the same object so joints do not read as slopes.
    if (m.owner[c - 1] !== o || m.owner[c + 1] !== o || m.owner[c - nx] !== o || m.owner[c + nx] !== o) return;
    const gx = (surface[c + 1] - surface[c - 1]) / (2 * cellFt);
    const gy = (surface[c + nx] - surface[c - nx]) / (2 * cellFt);
    const sl = Math.hypot(gx, gy) * 100;
    if (sl > max) max = sl;
    sum += sl;
    cells++;
  });
  return { maxPct: max, avgPct: cells ? sum / cells : 0, cells };
}
