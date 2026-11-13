/**
 * Regular grids aligned to the site CRS. Cell (i, j) has its CENTER at
 * (x0 + (i + 0.5) * cellFt, y0 + (j + 0.5) * cellFt); j increases to the north.
 */
import type { BBox, Pt, Region } from './basic';

export type GridSpec = { x0: number; y0: number; cellFt: number; nx: number; ny: number };
export type Grid = GridSpec & { data: Float32Array };

export const NODATA = -9999;

export function makeGrid(spec: GridSpec, fill = 0): Grid {
  const data = new Float32Array(spec.nx * spec.ny);
  if (fill !== 0) data.fill(fill);
  return { ...spec, data };
}
export function gridSpecForBBox(b: BBox, cellFt: number): GridSpec {
  const x0 = Math.floor(b.minX / cellFt) * cellFt;
  const y0 = Math.floor(b.minY / cellFt) * cellFt;
  const nx = Math.max(1, Math.ceil((b.maxX - x0) / cellFt));
  const ny = Math.max(1, Math.ceil((b.maxY - y0) / cellFt));
  return { x0, y0, cellFt, nx, ny };
}
export function cellCenter(g: GridSpec, i: number, j: number): Pt {
  return [g.x0 + (i + 0.5) * g.cellFt, g.y0 + (j + 0.5) * g.cellFt];
}
export function gridBBox(g: GridSpec): BBox {
  return { minX: g.x0, minY: g.y0, maxX: g.x0 + g.nx * g.cellFt, maxY: g.y0 + g.ny * g.cellFt };
}

/** Bilinear sample at a world point. Clamps to the grid edge; returns NaN if the grid is empty. */
export function sampleGrid(g: Grid, x: number, y: number): number {
  const fx = (x - g.x0) / g.cellFt - 0.5;
  const fy = (y - g.y0) / g.cellFt - 0.5;
  let i0 = Math.floor(fx);
  let j0 = Math.floor(fy);
  let tx = fx - i0;
  let ty = fy - j0;
  if (i0 < 0) {
    i0 = 0;
    tx = 0;
  } else if (i0 >= g.nx - 1) {
    i0 = Math.max(0, g.nx - 2);
    tx = g.nx > 1 ? 1 : 0;
  }
  if (j0 < 0) {
    j0 = 0;
    ty = 0;
  } else if (j0 >= g.ny - 1) {
    j0 = Math.max(0, g.ny - 2);
    ty = g.ny > 1 ? 1 : 0;
  }
  const i1 = Math.min(g.nx - 1, i0 + 1);
  const j1 = Math.min(g.ny - 1, j0 + 1);
  const d = g.data;
  const a = d[j0 * g.nx + i0];
  const b = d[j0 * g.nx + i1];
  const c = d[j1 * g.nx + i0];
  const e = d[j1 * g.nx + i1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + e * tx * ty;
}

/** Resample a source grid onto a new grid spec (bilinear). */
export function resampleGrid(src: Grid, spec: GridSpec): Grid {
  const out = makeGrid(spec);
  for (let j = 0; j < spec.ny; j++) {
    const y = spec.y0 + (j + 0.5) * spec.cellFt;
    for (let i = 0; i < spec.nx; i++) {
      out.data[j * spec.nx + i] = sampleGrid(src, spec.x0 + (i + 0.5) * spec.cellFt, y);
    }
  }
  return out;
}

/**
 * Rasterize a region: calls `visit(i, j)` for each cell whose CENTER is inside (even-odd scanline).
 */
export function forEachCellInRegion(g: GridSpec, region: Region, visit: (i: number, j: number) => void): void {
  if (!region.length) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of region)
    for (const p of r) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  const j0 = Math.max(0, Math.floor((minY - g.y0) / g.cellFt - 0.5));
  const j1 = Math.min(g.ny - 1, Math.ceil((maxY - g.y0) / g.cellFt - 0.5));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const y = g.y0 + (j + 0.5) * g.cellFt;
    xs.length = 0;
    for (const r of region) {
      for (let k = 0, n = r.length, m = n - 1; k < n; m = k++) {
        const a = r[k];
        const b = r[m];
        if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const ia = Math.max(0, Math.ceil((xs[k] - g.x0) / g.cellFt - 0.5));
      const ib = Math.min(g.nx - 1, Math.floor((xs[k + 1] - g.x0) / g.cellFt - 0.5 - 1e-9));
      for (let i = ia; i <= ib; i++) visit(i, j);
    }
  }
}
export function rasterizeRegion(g: GridSpec, region: Region): Uint8Array {
  const mask = new Uint8Array(g.nx * g.ny);
  forEachCellInRegion(g, region, (i, j) => {
    mask[j * g.nx + i] = 1;
  });
  return mask;
}

export type GridStats = { minFt: number; maxFt: number; meanFt: number; stdFt: number; count: number };
export function gridStats(g: Grid, mask?: Uint8Array): GridStats {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let k = 0; k < g.data.length; k++) {
    if (mask && !mask[k]) continue;
    const v = g.data[k];
    if (v <= NODATA + 1 || Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    sum2 += v * v;
    n++;
  }
  const mean = n ? sum / n : NaN;
  return { minFt: min, maxFt: max, meanFt: mean, stdFt: n ? Math.sqrt(Math.max(0, sum2 / n - mean * mean)) : NaN, count: n };
}

export type ContourSet = { levelFt: number; index: boolean; lines: Pt[][] };

/**
 * Marching-squares contours. Nodes are the cell centers. Returns chained polylines per level.
 * `mask` (optional) limits contours to quads whose four nodes are all flagged.
 */
export function contours(g: Grid, intervalFt: number, indexEvery = 5, mask?: Uint8Array): ContourSet[] {
  const { nx, ny, data } = g;
  let min = Infinity;
  let max = -Infinity;
  for (let k = 0; k < data.length; k++) {
    if (mask && !mask[k]) continue;
    const v = data[k];
    if (Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) return [];
  const out: ContourSet[] = [];
  const first = Math.ceil(min / intervalFt);
  const last = Math.floor(max / intervalFt);
  for (let l = first; l <= last; l++) {
    // Nudge the level so nodes exactly on a contour don't create degenerate cases.
    const level = l * intervalFt + 1e-4;
    const segs: number[] = [];
    for (let j = 0; j + 1 < ny; j++) {
      for (let i = 0; i + 1 < nx; i++) {
        const k00 = j * nx + i;
        const k10 = k00 + 1;
        const k01 = k00 + nx;
        const k11 = k01 + 1;
        if (mask && !(mask[k00] && mask[k10] && mask[k01] && mask[k11])) continue;
        const a = data[k00];
        const b = data[k10];
        const c = data[k11];
        const d = data[k01];
        const code = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const x = g.x0 + (i + 0.5) * g.cellFt;
        const y = g.y0 + (j + 0.5) * g.cellFt;
        const cf = g.cellFt;
        // edge interpolation points: bottom (a-b), right (b-c), top (d-c), left (a-d)
        const bx = x + ((level - a) / (b - a)) * cf;
        const ry = y + ((level - b) / (c - b)) * cf;
        const tx = x + ((level - d) / (c - d)) * cf;
        const ly = y + ((level - a) / (d - a)) * cf;
        const B = [bx, y];
        const R = [x + cf, ry];
        const T = [tx, y + cf];
        const L = [x, ly];
        const push = (p: number[], q: number[]) => segs.push(p[0], p[1], q[0], q[1]);
        switch (code) {
          case 1:
          case 14:
            push(L, B);
            break;
          case 2:
          case 13:
            push(B, R);
            break;
          case 3:
          case 12:
            push(L, R);
            break;
          case 4:
          case 11:
            push(R, T);
            break;
          case 6:
          case 9:
            push(B, T);
            break;
          case 7:
          case 8:
            push(L, T);
            break;
          case 5:
            push(L, T);
            push(B, R);
            break;
          case 10:
            push(L, B);
            push(R, T);
            break;
        }
      }
    }
    if (!segs.length) continue;
    out.push({ levelFt: l * intervalFt, index: l % indexEvery === 0, lines: chainSegments(segs) });
  }
  return out;
}

/** Chain loose segments [x1,y1,x2,y2,...] into polylines by matching endpoints. */
export function chainSegments(segs: number[]): Pt[][] {
  const n = segs.length / 4;
  const key = (x: number, y: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
  const ends = new Map<string, number[]>();
  for (let s = 0; s < n; s++) {
    for (const e of [0, 1]) {
      const k = key(segs[s * 4 + e * 2], segs[s * 4 + e * 2 + 1]);
      const arr = ends.get(k);
      if (arr) arr.push(s * 2 + e);
      else ends.set(k, [s * 2 + e]);
    }
  }
  const used = new Uint8Array(n);
  const lines: Pt[][] = [];
  const pt = (s: number, e: number): Pt => [segs[s * 4 + e * 2], segs[s * 4 + e * 2 + 1]];
  const extend = (line: Pt[], atEnd: boolean) => {
    while (true) {
      const tip = atEnd ? line[line.length - 1] : line[0];
      const cands = ends.get(key(tip[0], tip[1]));
      let found = false;
      if (cands) {
        for (const c of cands) {
          const s = c >> 1;
          if (used[s]) continue;
          used[s] = 1;
          const other = pt(s, 1 - (c & 1));
          if (atEnd) line.push(other);
          else line.unshift(other);
          found = true;
          break;
        }
      }
      if (!found) break;
    }
  };
  for (let s = 0; s < n; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const line: Pt[] = [pt(s, 0), pt(s, 1)];
    extend(line, true);
    extend(line, false);
    lines.push(line);
  }
  return lines;
}
