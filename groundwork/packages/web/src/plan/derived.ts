/** Derived display data computed off the main thread and cached in a small store. */
import type { ContourSet, Grid } from '@groundwork/core';
import { createStore } from '../lib/store';
import { callWorker } from '../worker/client';

export type Derived = { existingContours: ContourSet[] | null; contoursFor: Grid | null };
export const derived = createStore<Derived>({ existingContours: null, contoursFor: null });

export function ensureExistingContours(dem: Grid | null): void {
  const d = derived.get();
  if (!dem) {
    if (d.existingContours) derived.set({ existingContours: null, contoursFor: null });
    return;
  }
  if (d.contoursFor === dem) return;
  derived.set({ contoursFor: dem });
  callWorker<ContourSet[]>('existingContours', { dem })
    .then((sets) => {
      if (derived.get().contoursFor === dem) derived.set({ existingContours: sets });
    })
    .catch(() => undefined);
}
