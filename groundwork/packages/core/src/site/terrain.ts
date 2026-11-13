/** Existing-terrain analysis: stats inside a region, fall direction, steep-slope polygons. */
import { type Pt, type Region, type Ring, azimuthDeg, ringArea } from '../geometry/basic';
import { type Grid, chainSegments, forEachCellInRegion } from '../geometry/grid';
import { compass8 } from './units';
import type { Constraint } from './model';

export type TerrainStats = {
  minElevFt: number;
  maxElevFt: number;
  meanElevFt: number;
  reliefFt: number;
  lowPoint: Pt;
  highPoint: Pt;
  /** Mean of the cell slope magnitudes, percent. */
  avgSlopePct: number;
  maxSlopePct: number;
  /** Compass direction the ground generally falls toward (downhill), e.g. "S". */
  fallDirection: string;
  fallAzimuthDeg: number;
  /** Std-dev of elevation, a quick flatness measure. */
  stdElevFt: number;
  areaSf: number;
};

export function terrainStats(dem: Grid, region: Region): TerrainStats {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  let lo: Pt = [0, 0];
  let hi: Pt = [0, 0];
  let gxSum = 0;
  let gySum = 0;
  let slopeSum = 0;
  let slopeMax = 0;
  let slopeN = 0;
  const { nx, ny, data, cellFt } = dem;
  forEachCellInRegion(dem, region, (i, j) => {
    const z = data[j * nx + i];
    const p: Pt = [dem.x0 + (i + 0.5) * cellFt, dem.y0 + (j + 0.5) * cellFt];
    if (z < min) {
      min = z;
      lo = p;
    }
    if (z > max) {
      max = z;
      hi = p;
    }
    sum += z;
    sum2 += z * z;
    n++;
    if (i > 0 && i < nx - 1 && j > 0 && j < ny - 1) {
      const gx = (data[j * nx + i + 1] - data[j * nx + i - 1]) / (2 * cellFt);
      const gy = (data[(j + 1) * nx + i] - data[(j - 1) * nx + i]) / (2 * cellFt);
      const s = Math.hypot(gx, gy) * 100;
      gxSum += gx;
      gySum += gy;
      slopeSum += s;
      if (s > slopeMax) slopeMax = s;
      slopeN++;
    }
  });
  const mean = n ? sum / n : NaN;
  const az = azimuthDeg([-gxSum, -gySum]);
  return {
    minElevFt: min,
    maxElevFt: max,
    meanElevFt: mean,
    reliefFt: max - min,
    lowPoint: lo,
    highPoint: hi,
    avgSlopePct: slopeN ? slopeSum / slopeN : 0,
    maxSlopePct: slopeMax,
    fallDirection: compass8(az),
    fallAzimuthDeg: az,
    stdElevFt: n ? Math.sqrt(Math.max(0, sum2 / n - mean * mean)) : NaN,
    areaSf: n * cellFt * cellFt,
  };
}

/** Polygons where the existing slope exceeds `thresholdPct` (informational constraint layer). */
export function steepSlopeConstraints(dem: Grid, thresholdPct = 25, minAreaSf = 2500): Constraint[] {
  const { nx, ny, data, cellFt } = dem;
  const slope = new Float32Array(nx * ny);
  let any = false;
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const gx = (data[j * nx + i + 1] - data[j * nx + i - 1]) / (2 * cellFt);
      const gy = (data[(j + 1) * nx + i] - data[(j - 1) * nx + i]) / (2 * cellFt);
      const s = Math.hypot(gx, gy) * 100;
      slope[j * nx + i] = s;
      if (s > thresholdPct) any = true;
    }
  }
  if (!any) return [];
  // Marching squares at the threshold; closed loops become polygons.
  const segs: number[] = [];
  for (let j = 0; j + 1 < ny; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const a = slope[j * nx + i];
      const b = slope[j * nx + i + 1];
      const c = slope[(j + 1) * nx + i + 1];
      const d = slope[(j + 1) * nx + i];
      const t = thresholdPct;
      const code = (a > t ? 1 : 0) | (b > t ? 2 : 0) | (c > t ? 4 : 0) | (d > t ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const x = dem.x0 + (i + 0.5) * cellFt;
      const y = dem.y0 + (j + 0.5) * cellFt;
      const B = [x + ((t - a) / (b - a)) * cellFt, y];
      const R = [x + cellFt, y + ((t - b) / (c - b)) * cellFt];
      const T = [x + ((t - d) / (c - d)) * cellFt, y + cellFt];
      const L = [x, y + ((t - a) / (d - a)) * cellFt];
      const push = (p: number[], q: number[]) => segs.push(p[0], p[1], q[0], q[1]);
      if (code === 1 || code === 14) push(L, B);
      else if (code === 2 || code === 13) push(B, R);
      else if (code === 3 || code === 12) push(L, R);
      else if (code === 4 || code === 11) push(R, T);
      else if (code === 6 || code === 9) push(B, T);
      else if (code === 7 || code === 8) push(L, T);
      else if (code === 5) {
        push(L, T);
        push(B, R);
      } else {
        push(L, B);
        push(R, T);
      }
    }
  }
  const out: Constraint[] = [];
  let k = 0;
  for (const line of chainSegments(segs)) {
    if (line.length < 4) continue;
    const closed = Math.hypot(line[0][0] - line[line.length - 1][0], line[0][1] - line[line.length - 1][1]) < 0.01;
    if (!closed) continue;
    const ring: Ring = line.slice(0, -1);
    const area = ringArea(ring);
    if (area < minAreaSf) continue;
    out.push({
      id: `steep-${++k}`,
      kind: 'steepSlope',
      name: `Steep slope > ${thresholdPct}%`,
      ring,
      bufferFt: 0,
      informational: true,
      source: 'Derived from the DEM',
    });
  }
  return out;
}
