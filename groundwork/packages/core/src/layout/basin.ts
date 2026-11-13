/**
 * Stormwater reservation (planning-level land-use reservation, not a hydrologic design).
 * Sizes the basin footprint from the configured rule and places it on the lowest free ground.
 */
import { type Frame, type Pt, type Region, bboxOf, frameRect, toLocal, toWorld } from '../geometry/basic';
import { difference, offsetRegion, unionSolids } from '../geometry/clip';
import { type Grid, type GridSpec, rasterizeRegion, sampleGrid } from '../geometry/grid';
import type { StormwaterCriteria } from '../criteria/stormwater';
import type { Basin } from '../site/project';

/** Storage below the design water surface of a rectangular basin with sloped sides (prismoidal formula), CF. */
export function basinStorageCf(topW: number, topL: number, depthFt: number, freeboardFt: number, sideSlope: number): number {
  const w1 = topW - 2 * sideSlope * freeboardFt;
  const l1 = topL - 2 * sideSlope * freeboardFt;
  const w0 = w1 - 2 * sideSlope * depthFt;
  const l0 = l1 - 2 * sideSlope * depthFt;
  if (w0 <= 0 || l0 <= 0 || w1 <= 0 || l1 <= 0) return 0;
  const a1 = w1 * l1;
  const a0 = w0 * l0;
  return (depthFt / 3) * (a1 + a0 + Math.sqrt(a1 * a0));
}

/** Storage depth used for a basin under the active sizing method. */
export function basinDepthFor(sw: StormwaterCriteria): number {
  return sw.method === 'pctOfSite' ? sw.pctOfSiteDepthFt : sw.basinDepthFt;
}

/** Required basin surface area (top of bank), SF. */
export function requiredBasinAreaSf(sw: StormwaterCriteria, parcelAreaSf: number, imperviousSf: number): { areaSf: number; storageCf: number | null; basis: string } {
  if (sw.method === 'pctOfSite') {
    const areaSf = (sw.pctOfSite / 100) * parcelAreaSf;
    return { areaSf, storageCf: null, basis: `${sw.pctOfSite}% of the ${(parcelAreaSf / 43560).toFixed(1)} ac parcel (pctOfSite method)` };
  }
  const storageCf = (sw.runoffDepthIn / 12) * imperviousSf;
  // Smallest 2:1 rectangle whose storage meets the requirement.
  let lo = 100;
  let hi = 1e7;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const w = Math.sqrt(mid / 2);
    if (basinStorageCf(w, 2 * w, sw.basinDepthFt, sw.freeboardFt, sw.sideSlopeHtoV) >= storageCf) hi = mid;
    else lo = mid;
  }
  return { areaSf: hi, storageCf, basis: `${sw.runoffDepthIn} in of runoff over ${(imperviousSf / 43560).toFixed(1)} ac of new impervious = ${Math.round(storageCf).toLocaleString('en-US')} CF, ${sw.basinDepthFt} ft deep (runoffDepth method)` };
}

const CELL_FT = 20;

export type BasinPlacement = { basins: Basin[]; placedAreaSf: number; requiredAreaSf: number; note?: string };

/**
 * Place up to `maxBasins` rectangles (in the given frame's orientation) totalling `requiredAreaSf`
 * on free ground, preferring the lowest mean existing elevation.
 */
export function placeBasins(opts: {
  dem: Grid;
  free: Region;
  /** Orientation of the basin rectangles (the building frame). */
  angleDeg: number;
  requiredAreaSf: number;
  sw: StormwaterCriteria;
  startIndex?: number;
}): BasinPlacement {
  const { dem, sw } = opts;
  const basins: Basin[] = [];
  if (opts.requiredAreaSf < 400 || !opts.free.length) return { basins, placedAreaSf: 0, requiredAreaSf: opts.requiredAreaSf };
  const origin = opts.free[0][0];
  const frame: Frame = { origin, angleDeg: opts.angleDeg };
  // Erode by more than half a cell diagonal so every accepted 20 ft cell lies wholly inside the free region.
  let freeLocal: Region = offsetRegion(opts.free, -15, 'miter').map((r) => r.map((p) => toLocal(frame, p)));
  if (!freeLocal.length) return { basins, placedAreaSf: 0, requiredAreaSf: opts.requiredAreaSf, note: 'Stormwater reservation: no free area left for a basin.' };
  let remaining = opts.requiredAreaSf;
  let placed = 0;
  const minBasinSf = Math.max(20000, opts.requiredAreaSf * 0.08);

  for (let b = 0; b < sw.maxBasins && remaining > minBasinSf * 0.5; b++) {
    const bb = bboxOf(freeLocal.flat());
    const spec: GridSpec = { x0: Math.floor(bb.minX / CELL_FT) * CELL_FT, y0: Math.floor(bb.minY / CELL_FT) * CELL_FT, cellFt: CELL_FT, nx: 0, ny: 0 };
    spec.nx = Math.ceil((bb.maxX - spec.x0) / CELL_FT);
    spec.ny = Math.ceil((bb.maxY - spec.y0) / CELL_FT);
    if (spec.nx < 2 || spec.ny < 2) break;
    const mask = rasterizeRegion(spec, freeLocal);
    // Summed-area tables of the free mask and of existing elevation.
    const W = spec.nx + 1;
    const sf = new Float64Array(W * (spec.ny + 1));
    const se = new Float64Array(W * (spec.ny + 1));
    for (let j = 0; j < spec.ny; j++) {
      for (let i = 0; i < spec.nx; i++) {
        const k = j * spec.nx + i;
        const wpt = toWorld(frame, [spec.x0 + (i + 0.5) * CELL_FT, spec.y0 + (j + 0.5) * CELL_FT]);
        const z = mask[k] ? sampleGrid(dem, wpt[0], wpt[1]) : 0;
        const a = (j + 1) * W + (i + 1);
        sf[a] = mask[k] + sf[a - 1] + sf[a - W] - sf[a - W - 1];
        se[a] = z + se[a - 1] + se[a - W] - se[a - W - 1];
      }
    }
    const rectSum = (t: Float64Array, i0: number, j0: number, i1: number, j1: number) => t[j1 * W + i1] - t[j0 * W + i1] - t[j1 * W + i0] + t[j0 * W + i0];

    type Pick = { i: number; j: number; w: number; h: number; elev: number; area: number };
    let best = null as Pick | null;
    const fractions = b === sw.maxBasins - 1 ? [1, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2] : [1, 0.75, 0.6, 0.5, 0.4, 0.33, 0.25];
    for (const frac of fractions) {
      const area = remaining * frac;
      if (area < minBasinSf && frac < 1) break;
      for (const ratio of [1, 1.5, 2, 3, 4]) {
        for (const flip of [false, true]) {
          if (ratio === 1 && flip) continue;
          const long = Math.sqrt(area * ratio);
          const short = area / long;
          const w = Math.max(2, Math.round((flip ? short : long) / CELL_FT));
          const h = Math.max(2, Math.round((flip ? long : short) / CELL_FT));
          if (w > spec.nx || h > spec.ny) continue;
          for (let j = 0; j + h <= spec.ny; j++) {
            for (let i = 0; i + w <= spec.nx; i++) {
              if (rectSum(sf, i, j, i + w, j + h) !== w * h) continue;
              const elev = rectSum(se, i, j, i + w, j + h) / (w * h);
              // Lowest ground wins; ties go to squarer shapes (smaller ratio is tried first).
              if (!best || elev < best.elev - 0.05) best = { i, j, w, h, elev, area: w * h * CELL_FT * CELL_FT };
            }
          }
        }
      }
      if (best) break;
    }
    if (!best) break;
    const u0 = spec.x0 + best.i * CELL_FT;
    const v0 = spec.y0 + best.j * CELL_FT;
    const wFt = best.w * CELL_FT;
    const hFt = best.h * CELL_FT;
    const polygon = frameRect(frame, u0, v0, u0 + wFt, v0 + hFt);
    const idx = (opts.startIndex ?? 0) + basins.length + 1;
    basins.push({
      id: `basin-${idx}`,
      name: `Stormwater basin ${idx}`,
      auto: true,
      type: 'basin',
      polygon,
      areaSf: wFt * hFt,
      depthFt: basinDepthFor(sw),
      freeboardFt: sw.freeboardFt,
      sideSlopeHtoV: sw.sideSlopeHtoV,
      storageCf: basinStorageCf(Math.min(wFt, hFt), Math.max(wFt, hFt), basinDepthFor(sw), sw.freeboardFt, sw.sideSlopeHtoV),
      topElevFt: null,
      meanExistingElevFt: best.elev,
    });
    placed += wFt * hFt;
    remaining -= wFt * hFt;
    // Remove the placed basin (+ a 20 ft berm strip) from the free region before the next pass.
    const localRect: Pt[] = [
      [u0, v0],
      [u0 + wFt, v0],
      [u0 + wFt, v0 + hFt],
      [u0, v0 + hFt],
    ];
    freeLocal = difference(freeLocal, offsetRegion([localRect], 35, 'miter'));
    if (!freeLocal.length) break;
  }
  const short = opts.requiredAreaSf - placed;
  return {
    basins,
    placedAreaSf: placed,
    requiredAreaSf: opts.requiredAreaSf,
    note:
      short > opts.requiredAreaSf * 0.03
        ? `Stormwater reservation: placed ${(placed / 43560).toFixed(1)} ac of ${(opts.requiredAreaSf / 43560).toFixed(1)} ac required. Limiting factor: free area outside pavement, setbacks and wetlands. Options: shrink the building or parking, use underground storage, or reduce the reservation percentage.`
        : undefined,
  };
}

/** Free region for basins: the pavement envelope minus everything already placed (inflated). */
export function basinFreeRegion(allowed: Region, solids: { region: Region; inflateFt: number }[]): Region {
  const cuts = unionSolids(solids.filter((s) => s.region.length).map((s) => offsetRegion(s.region, s.inflateFt, 'miter')));
  return difference(allowed, cuts);
}
