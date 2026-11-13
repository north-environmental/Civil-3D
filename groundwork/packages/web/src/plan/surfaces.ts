/** Proposed-surface store (filled by the grading worker in Phase 5). */
import type { Grid } from '@groundwork/core';
import { sampleGrid } from '@groundwork/core';
import { createStore } from '../lib/store';

export type Surfaces = {
  key: string;
  proposed: Grid | null;
  /** 1 where the cell was graded (inside an object or a tie-in slope). */
  disturbed: Uint8Array | null;
};
export const surfaces = createStore<Surfaces>({ key: '', proposed: null, disturbed: null });

export function proposedAt(x: number, y: number): number | null {
  const g = surfaces.get().proposed;
  if (!g) return null;
  if (x < g.x0 || y < g.y0 || x > g.x0 + g.nx * g.cellFt || y > g.y0 + g.ny * g.cellFt) return null;
  return sampleGrid(g, x, y);
}
