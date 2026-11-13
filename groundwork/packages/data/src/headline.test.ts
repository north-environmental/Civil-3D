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

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/sites');

describe('headline scenario on the Heilmandale fixture (SPEC §10, steps 1–6)', () => {
  const services = createHostServices(dataDir);
  let p: Project = newProject();
  const results: Record<string, any> = {};
  let solveMs = 0;
  for (const st of HEADLINE_STEPS) {
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
