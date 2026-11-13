/**
 * Hand-calc tests from docs/reference/engineering-criteria.md (T1–T6, T10, T13).
 * Written BEFORE the grading engine (test-first). Tolerances are the ones stated in the reference.
 * T7–T9, T11, T12 live with the layout and zoning tests.
 */
import { describe, expect, it } from 'vitest';
import { GRADING_DEFAULTS } from '../criteria/grading';
import type { Ring } from '../geometry/basic';
import { type Grid, makeGrid } from '../geometry/grid';
import { CF_PER_CY, metersToFtUS } from '../site/units';
import { evaluateModel, flatPad, makeModel, planarPad, solveFfe, surfaceSlopePct } from './engine';

function gridFrom(x0: number, y0: number, w: number, h: number, cellFt: number, f: (x: number, y: number) => number): Grid {
  const g = makeGrid({ x0, y0, cellFt, nx: Math.round(w / cellFt), ny: Math.round(h / cellFt) });
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) g.data[j * g.nx + i] = f(x0 + (i + 0.5) * cellFt, y0 + (j + 0.5) * cellFt);
  return g;
}
const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const C = { ...GRADING_DEFAULTS };
const pct = (actual: number, expected: number) => Math.abs(actual - expected) / expected;

describe('hand calcs: earthwork', () => {
  it('T1: flat pad fill. 100 × 100 ft pad at 102.00 on flat 100.00 = 20,000 CF = 740.74 CY (±0.5% at 1, 2, 5 ft grids)', () => {
    for (const cell of [1, 2, 5]) {
      const existing = gridFrom(-50, -50, 200, 200, cell, () => 100);
      const m = makeModel({ existing, objects: [flatPad('pad', rect(0, 0, 100, 100), { elevFt: 102 })], criteria: C, daylight: false, sections: false });
      const r = evaluateModel(m, 0);
      expect(pct(r.fillCf, 20000), `cell ${cell}`).toBeLessThan(0.005);
      expect(pct(r.fillCf / CF_PER_CY, 740.74), `cell ${cell}`).toBeLessThan(0.005);
      expect(r.cutCf).toBe(0);
    }
  });

  it('T2: pad on a tilted plane. z = 100 + 0.02x, pad x∈[0,200], y∈[0,100] at 102 → fill 10,000 CF (370.37 CY), cut 10,000 CF, net 0 (±0.5%)', () => {
    for (const cell of [1, 2, 5]) {
      const existing = gridFrom(-50, -50, 300, 200, cell, (x) => 100 + 0.02 * x);
      const m = makeModel({ existing, objects: [flatPad('pad', rect(0, 0, 200, 100), { elevFt: 102 })], criteria: { ...C, shrinkPct: 0 }, daylight: false, sections: false });
      const r = evaluateModel(m, 0);
      expect(pct(r.fillCf, 10000), `fill, cell ${cell}`).toBeLessThan(0.005);
      expect(pct(r.cutCf, 10000), `cut, cell ${cell}`).toBeLessThan(0.005);
      expect(pct(r.fillCf / CF_PER_CY, 370.37)).toBeLessThan(0.005);
      expect(Math.abs(r.netCf)).toBeLessThan(10000 * 0.005);
    }
  });

  it('T3: pad + 3:1 daylight on flat ground = 22,475.40 CF = 832.42 CY (±0.5% at 1 ft; ±1% at 5 ft)', () => {
    // 20,000 pad + side wedges 2·a·b·h = 2,400 + corner quarter-cones π·b²·h/3 = 75.40 (b = 3h = 6 ft)
    const expected = 20000 + 2400 + (Math.PI * 36 * 2) / 3;
    expect(expected).toBeCloseTo(22475.4, 1);
    for (const [cell, tol] of [
      [1, 0.005],
      [5, 0.01],
    ] as const) {
      const existing = gridFrom(-50, -50, 200, 200, cell, () => 100);
      const m = makeModel({ existing, objects: [flatPad('pad', rect(0, 0, 100, 100), { elevFt: 102 })], criteria: C, daylight: true, sections: false });
      const r = evaluateModel(m, 0);
      expect(pct(r.fillCf, expected), `cell ${cell}: ${r.fillCf.toFixed(1)} CF`).toBeLessThan(tol);
      expect(r.cutCf).toBe(0);
      if (cell === 1) expect(pct(r.fillCf / CF_PER_CY, 832.42)).toBeLessThan(0.005);
      // The tie-in is reported separately from the pad.
      const tie = r.byCategory.find((c) => c.category === 'tieIn')!;
      expect(pct(tie.fillCf, expected - 20000)).toBeLessThan(cell === 1 ? 0.01 : 0.08);
      expect(r.walls).toHaveLength(0);
    }
  });

  it('T4: retaining wall detection. Pads at 100 and 120 with a 50 ft gap at 3:1 → wall, exposed height 120 − 50/3 − 100 = 3.33 ft (±0.3 ft at 1 ft grid)', () => {
    const existing = gridFrom(-60, -60, 370, 220, 1, () => 100);
    const objects = [flatPad('A', rect(0, 0, 100, 100), { elevFt: 100 }), flatPad('B', rect(150, 0, 250, 100), { elevFt: 120 })];
    const m = makeModel({ existing, objects, criteria: C, daylight: true, sections: false });
    const r = evaluateModel(m, 0);
    expect(r.walls.length).toBeGreaterThanOrEqual(1);
    const wall = r.walls.slice().sort((a, b) => b.maxHeightFt - a.maxHeightFt)[0];
    expect(Math.abs(wall.maxHeightFt - (120 - 50 / 3 - 100))).toBeLessThan(0.3);
    expect(wall.betweenObjectIds.sort()).toEqual(['A', 'B']);
    // The wall sits between the pads (x in the 100–150 gap) and runs their shared 100 ft length.
    expect(wall.at[0]).toBeGreaterThan(100);
    expect(wall.at[0]).toBeLessThan(150);
    expect(wall.lengthFt).toBeGreaterThan(90);
    expect(wall.lengthFt).toBeLessThan(125);
    // A 70 ft gap ties in at 3:1 with no wall: 20 ft < 70 / 3.
    const wide = makeModel({ existing, objects: [flatPad('A', rect(0, 0, 100, 100), { elevFt: 100 }), flatPad('B', rect(170, 0, 270, 100), { elevFt: 120 })], criteria: C, daylight: true, sections: false });
    expect(evaluateModel(wide, 0).walls).toHaveLength(0);
  });

  it('T5: FFE balance with 10% shrink → FFE 109.89 (±0.02 ft); fill ≈ 4,213 CY, cut ≈ 4,682 CY', () => {
    const closedForm = 110 + (4 * (Math.sqrt(0.9) - 1)) / (Math.sqrt(0.9) + 1);
    expect(closedForm).toBeCloseTo(109.89, 2);
    const existing = gridFrom(200, -50, 600, 400, 2, (x) => 100 + 0.02 * x);
    const m = makeModel({ existing, objects: [flatPad('pad', rect(300, 0, 700, 300), { ffeOffsetFt: 0 })], criteria: { ...C, shrinkPct: 10 }, daylight: false, sections: false });
    const sol = solveFfe(m, { targetNetCf: 0, minFt: 100, maxFt: 120 });
    expect(sol.achieved).toBe(true);
    expect(Math.abs(sol.ffeFt - 109.89)).toBeLessThan(0.02);
    const r = evaluateModel(m, sol.ffeFt);
    expect(Math.abs(r.fillCf / CF_PER_CY - 4213)).toBeLessThan(4213 * 0.01);
    expect(Math.abs(r.cutCf / CF_PER_CY - 4682)).toBeLessThan(4682 * 0.01);
    expect(Math.abs(r.netCf / CF_PER_CY)).toBeLessThan(5);
  });

  it('T6: FFE balance without shrink → FFE 110.00 (±0.02 ft)', () => {
    const existing = gridFrom(200, -50, 600, 400, 2, (x) => 100 + 0.02 * x);
    const m = makeModel({ existing, objects: [flatPad('pad', rect(300, 0, 700, 300), { ffeOffsetFt: 0 })], criteria: { ...C, shrinkPct: 0 }, daylight: false, sections: false });
    const sol = solveFfe(m, { targetNetCf: 0, minFt: 100, maxFt: 120 });
    expect(Math.abs(sol.ffeFt - 110)).toBeLessThan(0.02);
    // Net is monotonic in FFE: raising the pad always needs more fill.
    expect(evaluateModel(m, 111).netCf).toBeLessThan(evaluateModel(m, 110).netCf);
    expect(evaluateModel(m, 110).netCf).toBeLessThan(evaluateModel(m, 109).netCf);
    // A target outside the feasible range is reported, not forced.
    const stuck = solveFfe(m, { targetNetCf: 0, minFt: 112, maxFt: 120 });
    expect(stuck.achieved).toBe(false);
    expect(stuck.ffeFt).toBe(112);
  });

  it('subgrade: pavement/slab sections come off the fill and add to the cut', () => {
    const existing = gridFrom(-50, -50, 200, 200, 1, () => 100);
    const pad = flatPad('pad', rect(0, 0, 100, 100), { elevFt: 102, sectionFt: 1.17 });
    const r = evaluateModel(makeModel({ existing, objects: [pad], criteria: C, daylight: false, sections: true }), 0);
    expect(r.fillCf).toBeCloseTo(100 * 100 * (2 - 1.17), 0);
    expect(r.sectionCf).toBeCloseTo(100 * 100 * 1.17, 0);
    const low = flatPad('pad', rect(0, 0, 100, 100), { elevFt: 100.5, sectionFt: 1.17 });
    const r2 = evaluateModel(makeModel({ existing, objects: [low], criteria: C, daylight: false, sections: true }), 0);
    expect(r2.cutCf).toBeCloseTo(100 * 100 * (1.17 - 0.5), 0);
    expect(r2.fillCf).toBe(0);
  });

  it('priority: where footprints overlap the higher-priority object wins', () => {
    const existing = gridFrom(-50, -50, 300, 200, 1, () => 100);
    const lo = flatPad('park', rect(0, 0, 200, 100), { elevFt: 101, priority: 2, category: 'parking' });
    const hi = flatPad('pad', rect(50, 0, 150, 100), { elevFt: 103, priority: 5, category: 'pad' });
    const r = evaluateModel(makeModel({ existing, objects: [lo, hi], criteria: C, daylight: false, sections: false }), 0);
    expect(r.fillCf).toBeCloseTo(100 * 100 * 3 + 100 * 100 * 1, 0);
    expect(r.byCategory.find((c) => c.category === 'pad')!.fillCf).toBeCloseTo(30000, 0);
    expect(r.byCategory.find((c) => c.category === 'parking')!.fillCf).toBeCloseTo(10000, 0);
  });

  it('offsite grading: tie-in slopes that cross the parcel line are measured', () => {
    const existing = gridFrom(-50, -50, 200, 200, 1, () => 100);
    const pad = flatPad('pad', rect(0, 0, 100, 100), { elevFt: 102 });
    // Parcel line 3 ft east of the pad: the 6 ft wide 3:1 slope crosses it.
    const parcel = rect(-40, -40, 103, 140);
    const r = evaluateModel(makeModel({ existing, objects: [pad], criteria: C, daylight: true, sections: false, parcel }), 0);
    // Offsite: the strip x∈[103, ~105.7] where fill > 0.1 ft (toe at 106; 0.1 ft tolerance trims 0.3 ft).
    expect(r.offsiteAreaSf).toBeGreaterThan(100 * 2.2);
    expect(r.offsiteAreaSf).toBeLessThan(100 * 3.2 + 30);
    expect(r.offsiteMaxDeltaFt).toBeCloseTo(2 - 3.5 / 3, 1);
    const inside = evaluateModel(makeModel({ existing, objects: [pad], criteria: C, daylight: true, sections: false, parcel: rect(-40, -40, 140, 140) }), 0);
    expect(inside.offsiteAreaSf).toBe(0);
  });
});

describe('hand calcs: slopes and units', () => {
  it('T10: ADA slope check. Planar parking field at 2.5% fails (> 2.08%); at 1.5% passes', () => {
    const existing = gridFrom(-50, -50, 400, 300, 5, () => 100);
    const field = rect(0, 0, 300, 128);
    const stalls = rect(40, 0, 143, 20);
    const limit = C.adaMaxSlopePct;
    expect(limit).toBeCloseTo(2.0833, 3);
    for (const [slopePct, pass] of [
      [2.5, false],
      [1.5, true],
    ] as const) {
      const obj = planarPad('park', field, { origin: [0, 0], dirDeg: 90, slopePct, elevAtOriginFt: 101, category: 'parking', priority: 2 });
      const m = makeModel({ existing, objects: [obj], criteria: C, daylight: true, sections: false });
      const r = evaluateModel(m, 0);
      const measured = surfaceSlopePct(m, r.proposed, stalls);
      expect(measured.maxPct).toBeCloseTo(slopePct, 2);
      expect(measured.maxPct <= limit).toBe(pass);
    }
  });

  it('T13: 3DEP value 150.000 m = 492.125 ftUS (±0.001 ft)', () => {
    expect(Math.abs(metersToFtUS(150) - 492.125)).toBeLessThan(0.001);
  });
});
