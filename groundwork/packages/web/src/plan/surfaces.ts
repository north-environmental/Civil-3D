/** Proposed-surface store: the browser regrades in a worker (same core engine) whenever the design changes. */
import { type ContourSet, type Grid, type GridSpec, sampleGrid } from '@groundwork/core';
import { type AppState, app } from '../lib/app';
import { createStore } from '../lib/store';
import { callWorker } from '../worker/client';
import type { GradeResponse } from '../worker/grading';

export type Surfaces = {
  key: string;
  spec: GridSpec | null;
  proposed: Grid | null;
  delta: Float32Array | null;
  category: Uint8Array | null;
  wallHeight: Float32Array | null;
  contours: ContourSet[] | null;
  /** Symmetric color-scale limit for the cut/fill map, ft. */
  scaleFt: number;
  cutfill: HTMLCanvasElement | null;
  ms: number;
};
const EMPTY: Surfaces = { key: '', spec: null, proposed: null, delta: null, category: null, wallHeight: null, contours: null, scaleFt: 5, cutfill: null, ms: 0 };
export const surfaces = createStore<Surfaces>(EMPTY);

export function proposedAt(x: number, y: number): number | null {
  const g = surfaces.get().proposed;
  if (!g) return null;
  if (x < g.x0 || y < g.y0 || x > g.x0 + g.nx * g.cellFt || y > g.y0 + g.ny * g.cellFt) return null;
  return sampleGrid(g, x, y);
}

/** Diverging cut (red) / fill (blue) color for a depth in ft on a symmetric scale. Returns [r, g, b, a]. */
export function cutFillColor(d: number, scaleFt: number): [number, number, number, number] {
  const t = Math.max(-1, Math.min(1, d / scaleFt));
  const a = Math.abs(t);
  if (a < 0.02) return [70, 78, 92, 90];
  const k = Math.pow(a, 0.75);
  // cut: light salmon -> deep red; fill: light blue -> deep blue
  const c = t < 0 ? [229 - 50 * k, 138 - 100 * k, 127 - 97 * k] : [126 - 95 * k, 166 - 80 * k, 230 - 46 * k];
  return [c[0], c[1], c[2], 150 + 90 * k];
}

function cutFillCanvas(r: GradeResponse, scaleFt: number): HTMLCanvasElement {
  const { nx, ny } = r.spec;
  const canvas = document.createElement('canvas');
  canvas.width = nx;
  canvas.height = ny;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(nx, ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const d = r.delta[j * nx + i];
      if (Number.isNaN(d)) continue;
      const o = ((ny - 1 - j) * nx + i) * 4; // grid rows run south→north; image rows run top→bottom
      const c = cutFillColor(d, scaleFt);
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = c[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

let running = false;
let queued = false;

/** Recompute display surfaces when the active scenario's graded design changes. */
export function ensureSurfaces(s: AppState): void {
  const p = s.project;
  const sc = p?.scenarios.find((x) => x.id === p.activeScenarioId);
  if (!p?.site || !s.dem || !sc || !sc.grading.graded || sc.grading.ffeFt === null || !sc.objects.some((o) => o.type === 'building')) {
    if (surfaces.get().key) surfaces.set(EMPTY);
    return;
  }
  const key = `${p.site.id}:${sc.id}:${p.revision}`;
  if (surfaces.get().key === key) return;
  if (running) {
    queued = true;
    return;
  }
  running = true;
  callWorker<GradeResponse>('grade', { payload: { site: p.site, dem: s.dem, scenario: sc, ffeFt: sc.grading.ffeFt } })
    .then((r) => {
      const scaleFt = Math.max(2, Math.ceil(r.maxAbsDeltaFt / 2) * 2);
      surfaces.set({
        key,
        spec: r.spec,
        proposed: { ...r.spec, data: r.proposed },
        delta: r.delta,
        category: r.category,
        wallHeight: r.wallHeight,
        contours: r.contours,
        scaleFt,
        cutfill: cutFillCanvas(r, scaleFt),
        ms: r.ms,
      });
      ((window as any).__gw ??= {}).gradedKey = key;
      ((window as any).__gw ??= {}).gradeMs = r.ms;
    })
    .catch(() => undefined)
    .finally(() => {
      running = false;
      if (queued) {
        queued = false;
        ensureSurfaces(app.get());
      }
    });
}
