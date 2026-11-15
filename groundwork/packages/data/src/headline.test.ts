import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type Building,
  type Project,
  HEADLINE_STEPS,
  activeScenario,
  axisAngleDiffDeg,
  executeCommand,
  frontageAngleDeg,
  frontages,
  newProject,
  pointInRing,
  ringToRingDist,
} from '@groundwork/core';
import { createHostServices } from './fixtures';

// Regression run on the controlled SYNTHETIC fixture (three clean frontages), so the engine's numbers
// stay comparable from change to change. The real demo site is covered in heilmandale.test.ts.
const STEPS = HEADLINE_STEPS.flatMap((st) => {
  if (st.command === 'load_site') return [{ ...st, input: { siteId: 'synthetic' } }];
  if (st.command === 'set_access' && st.input.network === 'truck')
    return [
      { ...st, input: { network: 'truck', road: 'Route 72', position: 'auto' } },
      { ...st, input: { network: 'truck', road: 'Heilmandale Rd', position: 'auto' } },
    ];
  return [st];
});

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/sites');

describe('headline scenario on the synthetic fixture (SPEC §10, steps 1–6)', () => {
  const services = createHostServices(dataDir);
  let p: Project = newProject();
  const results: Record<string, any> = {};
  let solveMs = 0;
  for (const st of STEPS) {
    const t = Date.now();
    const r = executeCommand(p, st.command, st.input, { services, source: 'mcp' });
    if (st.command === 'generate_layout') solveMs = Date.now() - t;
    p = r.project;
    results[st.command] = r.result;
  }
  const s = activeScenario(p);
  const b = s.objects.find((o): o is Building => o.type === 'building')!;

  it('solver runs in under 10 s', () => {
    expect(solveMs).toBeLessThan(10_000);
  });

  it('building: ~410,000 SF cross-dock, long axis parallel to Heilmandale Rd, inside the building envelope', () => {
    expect(b.areaSf).toBeGreaterThanOrEqual(410000);
    expect(b.areaSf).toBeLessThan(411000);
    const heil = frontages(p.site!.edges).find((f) => f.roadName === 'Heilmandale Rd')!;
    expect(axisAngleDiffDeg(b.rotationDeg, frontageAngleDeg(heil))).toBeLessThan(0.1);
    expect(results.generate_layout.summary).toMatch(/parallel to Heilmandale Rd/);
  });

  it('all hard checks pass', () => {
    const fails = s.checks.filter((c) => c.status === 'fail');
    expect(fails.map((c) => `${c.title}: ${c.message}`)).toEqual([]);
    expect(results.run_checks.counts.fail).toBe(0);
  });

  it('program attainment: ≥ 100 trailer stalls, parking meets both § 27-1405 readings, 13+ loading berths', () => {
    const y = Object.fromEntries(s.results.yield.map((r) => [r.key, r.value]));
    expect(y.trailerStalls).toBeGreaterThanOrEqual(100);
    expect(y.carStalls).toBeGreaterThanOrEqual(350);
    expect(y.loadingBerths).toBeGreaterThanOrEqual(13);
    expect(y.coveragePct).toBeLessThan(50);
    // 410k SF ≈ 9.4 ac on ~110 ac: sanity.
    expect(b.areaSf / 43560).toBeGreaterThan(9.3);
    expect(b.areaSf / 43560).toBeLessThan(9.5);
  });

  it('truck access from Route 72 and Heilmandale Rd, cars only from Orange Ln, networks disconnected', () => {
    const dw = s.objects.filter((o) => o.type === 'driveway') as any[];
    expect(dw.filter((d) => d.network === 'truck').map((d) => d.roadName).sort()).toEqual(['Heilmandale Rd', 'Route 72']);
    expect(dw.filter((d) => d.network === 'car').map((d) => d.roadName)).toEqual(['Orange Ln']);
    expect(s.objects.filter((o) => o.type === 'drive')).toHaveLength(3);
    const sep = s.checks.find((c) => c.id === 'e.network.separation')!;
    expect(sep.status).toBe('pass');
    expect(sep.value).toBe(0);
    // No truck drive touches any car pavement.
    const truck = s.objects.filter((o: any) => (o.type === 'drive' && o.network === 'truck') || o.type === 'truckCourt' || o.type === 'truckApron');
    const car = s.objects.filter((o: any) => (o.type === 'drive' && o.network === 'car') || o.type === 'parkingField');
    for (const t of truck) for (const c of car) for (const tr of t.type === 'drive' ? t.polygon : [(t as any).polygon]) for (const cr of c.type === 'drive' ? c.polygon : [(c as any).polygon]) expect(ringToRingDist(tr, cr)).toBeGreaterThan(5);
  });

  it('stormwater reservation ≈ 9% of the site, outside the wetland and its buffer', () => {
    const basins = s.objects.filter((o) => o.type === 'basin') as any[];
    const area = basins.reduce((a, o) => a + o.areaSf, 0);
    expect(area / p.site!.areaSf).toBeGreaterThan(0.085);
    expect(area / p.site!.areaSf).toBeLessThan(0.1);
    const wet = p.site!.constraints.find((c) => c.kind === 'wetland')!;
    for (const o of basins) {
      expect(ringToRingDist(o.polygon, wet.ring)).toBeGreaterThanOrEqual(25);
      for (const pt of o.polygon) expect(pointInRing(pt, p.site!.parcel.ring)).toBe(true);
    }
  });

  it('the log reads like a narrative and results stay compact', () => {
    expect(p.log.filter((e) => e.source === 'mcp').length).toBeGreaterThanOrEqual(6);
    expect(p.log.some((e) => e.kind === 'note' && /Assumption/.test(e.message))).toBe(true);
    for (const [name, r] of Object.entries(results)) expect(JSON.stringify(r).length, name).toBeLessThan(16_000);
  });
});

describe('headline scenario: grading (SPEC §10 step 7, Phase 5 acceptance)', () => {
  const services = createHostServices(dataDir);
  let p: Project = newProject();
  for (const st of STEPS) p = executeCommand(p, st.command, st.input, { services, source: 'mcp' }).project;
  const run = (name: string, input: unknown = {}) => {
    const r = executeCommand(p, name, input, { services, source: 'mcp' });
    p = r.project;
    return r.result as any;
  };

  it('grades at the default FFE, then balances within ±2% of total movement', () => {
    const g = run('grade_site');
    expect(g.ffeFt).toBeGreaterThan(470);
    expect(g.ffeFt).toBeLessThan(515);
    const o = run('optimize_ffe', { targetNetCy: 0 });
    expect(o.achieved).toBe(true);
    const ew = activeScenario(p).results.earthwork!;
    const movement = ew.cutCy + ew.fillCy;
    expect(Math.abs(ew.netCy)).toBeLessThanOrEqual(0.02 * movement);
    expect(Math.round(ew.ffeFt * 10) / 10).toBe(ew.ffeFt); // reported to 0.1 ft
    // Inside the feasible range from drive grades.
    expect(ew.ffeFt).toBeGreaterThanOrEqual(ew.feasibleFfe!.minFt - 1e-6);
    expect(ew.ffeFt).toBeLessThanOrEqual(ew.feasibleFfe!.maxFt + 1e-6);
    // Sanity: a 110 ac site is tens to a few hundred thousand CY, not millions or single digits.
    expect(movement).toBeGreaterThan(50_000);
    expect(movement).toBeLessThan(900_000);
    expect(ew.maxCutFt).toBeLessThan(30);
    expect(ew.maxFillFt).toBeLessThan(30);
  });

  it('drive grades, walls and offsite grading are checked and nothing fails', () => {
    const s = activeScenario(p);
    const ew = s.results.earthwork!;
    for (const d of ew.drives) expect(Math.abs(d.gradePct), d.name).toBeLessThanOrEqual(d.maxGradePct + 1e-6);
    expect(s.checks.filter((c) => c.status === 'fail').map((c) => `${c.title}: ${c.message}`)).toEqual([]);
    const ids = s.checks.filter((c) => c.group === 'grading').map((c) => c.id);
    for (const id of ['g.walls', 'g.offsite', 'g.tieIn.slope', 'g.balance', 'g.truckCourt.slope']) expect(ids).toContain(id);
    expect(ids.some((i) => i.startsWith('g.drive.grade.'))).toBe(true);
    expect(ids.some((i) => i.startsWith('g.ada.slope.'))).toBe(true);
    expect(ew.offsiteAreaSf).toBe(0);
    // Dock faces sit one dock height below FFE; building corners at FFE.
    const dock = ew.spots.find((x) => x.label.startsWith('Dock face'))!;
    expect(dock.elevFt).toBeCloseTo(ew.ffeFt - 4.0, 5);
    expect(ew.spots.find((x) => x.label.startsWith('Building corner'))!.elevFt).toBe(ew.ffeFt);
  });

  it('interactive regrade (5 ft grid) takes well under 1.5 s', () => {
    const s = activeScenario(p);
    const b = s.objects.find((o) => o.type === 'building') as Building;
    const t0 = Date.now();
    run('edit_object', { id: 'bldg-1', moveBy: [-40, 20] }); // regenerates the layout AND regrades
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(1500);
    const moved = activeScenario(p).objects.find((o) => o.type === 'building') as Building;
    expect(moved.center[0]).toBeCloseTo(b.center[0] - 40, 6);
    expect(activeScenario(p).results.earthwork).not.toBeNull();
    run('undo');
  });

  it('the 2 ft report grid agrees with the interactive 5 ft grid within 3%', () => {
    const a = run('get_earthwork_report');
    const b = run('get_earthwork_report', { grid: 'report' });
    expect(Math.abs(b.cutCy - a.cutCy) / a.cutCy).toBeLessThan(0.03);
    expect(Math.abs(b.fillCy - a.fillCy) / a.fillCy).toBeLessThan(0.03);
    expect(b.byArea.map((x: any) => x.area)).toEqual(expect.arrayContaining(['building pad', 'truck courts', 'car parking', 'drives', 'basins', 'tie-in slopes']));
    expect(JSON.stringify(b).length).toBeLessThan(8000);
  });

  it('import target, criteria changes and sections', () => {
    const o = run('optimize_ffe', { targetNetCy: -20000 });
    expect(o.achieved).toBe(true);
    expect(activeScenario(p).results.earthwork!.netCy).toBeLessThan(-12000);
    const before = activeScenario(p).results.earthwork!.cutCy;
    run('set_grading_criteria', { criteria: { shrinkPct: 15, tieInSlopeHtoV: 4 } });
    const ew = activeScenario(p).results.earthwork!;
    expect(ew.shrinkPct).toBe(15);
    expect(ew.cutCy).not.toBe(before);
    // The earlier target no longer holds after the criteria change, and the report says so.
    expect(ew.balance!.targetNetCy).toBe(-20000);
    expect(() => run('set_grading_criteria', { criteria: { nope: 1 } })).toThrow(/Unknown grading criteria/);
    const sec = run('cut_section', {});
    expect(sec.profile.length).toBe(60);
    expect(sec.maxFillFt + sec.maxCutFt).toBeGreaterThan(1);
    const ffe = activeScenario(p).results.earthwork!.ffeFt;
    expect(sec.profile.some((row: number[]) => Math.abs(row[2] - ffe) < 0.05)).toBe(true); // crosses the pad
  });
});
