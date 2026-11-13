/** Grading work executed inside the worker: same core code the server runs for MCP calls. */
import { type Grid, type GradingDisplay, type Scenario, type Site, gradeScenario, gradingDisplay } from '@groundwork/core';

export type GradeRequest = { site: Omit<Site, 'dem'>; dem: Grid; scenario: Scenario; ffeFt: number };
export type GradeResponse = GradingDisplay & {
  /** Per-cell category: 0 untouched, 1 pad, 2 truck court, 3 parking, 4 drive, 5 basin, 6 tie-in slope. */
  category: Uint8Array;
  ms: number;
};

const CAT: Record<string, number> = { pad: 1, truckCourt: 2, parking: 3, drive: 4, basin: 5 };

export function handleGradingMessage(payload: unknown): { result: GradeResponse; transfer: Transferable[] } {
  const req = payload as GradeRequest;
  const t0 = performance.now();
  const site = { ...req.site, dem: req.dem } as Site;
  const out = gradeScenario(site, req.scenario, req.ffeFt);
  const disp = gradingDisplay(out);
  const model = out.prep.model;
  const n = model.spec.nx * model.spec.ny;
  const category = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const o = model.owner[k];
    category[k] = o >= 0 ? CAT[model.objects[o].category] : Number.isNaN(disp.delta[k]) ? 0 : 6;
  }
  const result: GradeResponse = { ...disp, category, ms: performance.now() - t0 };
  const transfer: Transferable[] = [result.proposed.buffer, result.delta.buffer, category.buffer];
  if (result.wallHeight) transfer.push(result.wallHeight.buffer);
  return { result, transfer };
}
