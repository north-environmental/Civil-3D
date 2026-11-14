import { describe, expect, it } from 'vitest';
import '../derive';
import { executeCommand, newProject, type HostServices } from '../commands';
import { adaRequiredStalls, adaRequiredVanStalls } from '../criteria/ada';
import { LAYOUT_DEFAULTS } from '../criteria/layout';
import { pointInRing } from '../geometry/basic';
import { activeScenario, type Building, type Driveway, type ParkingField, type Project } from '../site/project';
import { makeTestSite, rectRing } from '../testing/fixtures';
import { adaZoneFt, fieldDepthFt, makeParkingField, moduleDepthFt, parkingStallGeometry, rowCapacity, stallsPerRowNoIslands } from './building';

describe('hand calcs: parking and ADA', () => {
  it('T7: ADA accessible and van counts (Table 208.2, § 208.2.4)', () => {
    const cases: [number, number, number][] = [
      [10, 1, 1],
      [25, 1, 1],
      [26, 2, 1],
      [300, 7, 2],
      [301, 8, 2],
      [500, 9, 2],
      [501, 11, 2],
      [600, 12, 2],
      [1000, 20, 4],
      [1001, 21, 4],
      [1200, 22, 4],
    ];
    for (const [total, acc, van] of cases) {
      expect(adaRequiredStalls(total), `total ${total}`).toBe(acc);
      expect(adaRequiredVanStalls(adaRequiredStalls(total)), `van for ${total}`).toBe(van);
    }
    expect(adaRequiredStalls(0)).toBe(0);
  });

  it('T9: one 300 ft double-loaded module, 10 × 20 ft stalls, 24 ft aisle, no islands = 60 stalls, 64 ft deep', () => {
    const perSide = stallsPerRowNoIslands(300, LAYOUT_DEFAULTS.carStallWidthFt);
    expect(perSide).toBe(30);
    expect(perSide * 2).toBe(60);
    expect(moduleDepthFt(LAYOUT_DEFAULTS)).toBe(64);
    expect(fieldDepthFt(2, LAYOUT_DEFAULTS)).toBe(64);
    expect(fieldDepthFt(3, LAYOUT_DEFAULTS)).toBe(64 + 44);
  });

  it('parking field: islands, ADA stalls in the first row, consistent totals and striping', () => {
    const c = { ...LAYOUT_DEFAULTS };
    const cap = rowCapacity(540, c);
    expect(cap.positions).toBe(47); // (540 − 2·(24 + 10)) / 10
    expect(cap.islands).toBe(2);
    expect(cap.stalls).toBe(45);
    const f = makeParkingField({ origin: [0, 0], angleDeg: 0, lengthFt: 540, rows: 8, id: 'p', name: 'P', auto: true, slopePct: 1.5 }, c);
    expect(f.depthFt).toBe(256);
    expect(f.stallsAda).toBe(adaRequiredStalls(360));
    expect(f.stallsVan).toBe(2);
    expect(adaZoneFt(8, 2, c)).toBe(8 * 10 + 8 + 3 * 5);
    expect(f.stallsTotal).toBe(7 * 45 + (45 - 11) + 8);
    expect(f.stallsAda).toBeGreaterThanOrEqual(adaRequiredStalls(f.stallsTotal));
    const g = parkingStallGeometry(f, c);
    expect(g.adaStalls).toHaveLength(8);
    expect(g.adaAisles).toHaveLength(4);
    expect(g.islands.length).toBe(8 * 2 + 8 * 2); // end islands + two interior islands per row (34 standard stalls still span two 15-stall groups in the ADA row)
  });
});

function project(): { p: Project; services: HostServices } {
  const site = makeTestSite({
    ring: rectRing(0, 0, 2600, 2000),
    roads: [
      { name: 'South St', centerline: [[-700, -25], [3300, -25]], rowWidthFt: 50 },
      { name: 'West Ave', centerline: [[-30, -700], [-30, 2700]], rowWidthFt: 60, roadClass: 'state', ref: 'PA 9' },
    ],
    districts: [{ kind: 'residential', ring: rectRing(0, 2000, 2600, 800) }],
    addressRoadName: 'South St',
    elev: (x, y) => 100 + 0.01 * y + 0.004 * x,
  });
  const services: HostServices = { resolveSite: () => site };
  let p = executeCommand(newProject(), 'load_site', { siteId: 'test' }, { services }).project;
  p = executeCommand(p, 'set_program', { buildingSf: 410000, employeesLargestShift: 300, employeesTwoLargestShifts: 520 }, { services }).project;
  return { p, services };
}
const run = (p: Project, services: HostServices, name: string, input: unknown = {}) => executeCommand(p, name, input, { services, source: 'script' });
const fails = (p: Project) => activeScenario(p).checks.filter((c) => c.status === 'fail');

describe('layout commands', () => {
  it('T11: driveway 120 ft from the intersecting street ROW fails § 27-1407; 160 ft passes', () => {
    const { p, services } = project();
    let q = run(p, services, 'set_access', { network: 'truck', road: 'South St', position: 120 }).project;
    q = run(q, services, 'place_building', { center: [1400, 1000], rotationDeg: 0 }).project;
    const d = activeScenario(q).objects.find((o): o is Driveway => o.type === 'driveway')!;
    expect(d.toIntersectionFt).toBeCloseTo(120, 3);
    const c1 = activeScenario(q).checks.find((c) => c.id === `z.driveway.spacingFt.${d.id}`)!;
    expect(c1.status).toBe('fail');
    expect(c1.message).toMatch(/120 ft from the nearest intersecting street right-of-way line; 150 ft required/);
    expect(c1.citation).toBe('§ 27-1407');
    q = run(q, services, 'edit_object', { id: d.id, stationFt: 160 }).project;
    expect(activeScenario(q).checks.find((c) => c.id === `z.driveway.spacingFt.${d.id}`)!.status).toBe('pass');
    // "auto" keeps 150 ft from the intersection on its own.
    q = run(q, services, 'set_access', { network: 'truck', road: 'South St', position: 'auto' }).project;
    expect((activeScenario(q).objects.find((o) => o.type === 'driveway') as Driveway).stationFt).toBeGreaterThanOrEqual(150);
  });

  it('generate_layout: all hard checks pass, networks separated, everything inside the parcel', () => {
    const { p, services } = project();
    let q = run(p, services, 'set_access', { network: 'truck', road: 'West Ave' }).project;
    q = run(q, services, 'set_access', { network: 'car', road: 'South St' }).project;
    const t0 = Date.now();
    const r = run(q, services, 'generate_layout', {});
    expect(Date.now() - t0).toBeLessThan(10_000);
    q = r.project;
    const s = activeScenario(q);
    expect(fails(q).map((c) => `${c.title}: ${c.message}`)).toEqual([]);
    expect(s.checks.find((c) => c.id === 'e.network.separation')!.status).toBe('pass');
    const b = s.objects.find((o): o is Building => o.type === 'building')!;
    expect(b.areaSf).toBeGreaterThanOrEqual(410000);
    expect(b.areaSf).toBeLessThan(410000 + 540);
    const field = s.objects.find((o): o is ParkingField => o.type === 'parkingField')!;
    expect(field.stallsTotal).toBeGreaterThanOrEqual(350);
    for (const o of s.objects) {
      const rings = o.type === 'drive' ? o.polygon : [o.polygon];
      for (const ring of rings) for (const pt of ring) expect(pointInRing(pt, q.site!.parcel.ring) || o.type === 'driveway', `${o.id} inside parcel`).toBe(true);
    }
    expect(r.result.rationale).toMatch(/feasible candidates/);
    expect(JSON.stringify(r.result).length).toBeLessThan(5000);
    // Docks should not face the residential district to the north at close range.
    expect(r.result.summary).toMatch(/dock doors/);
  });

  it('explains failures: building pushed into the residential separation', () => {
    const { p, services } = project();
    const q = run(p, services, 'place_building', { center: [1400, 1650], rotationDeg: 0 }).project;
    const f = fails(q);
    expect(f.length).toBeGreaterThan(0);
    const sep = f.find((c) => c.id === 'z.setback.building.fromResidential')!;
    expect(sep.message).toMatch(/150 ft required/);
    expect(sep.limit).toBe(150);
    expect(sep.objectIds).toEqual(['bldg-1']);
    expect(activeScenario(q).results.layoutNotes.join(' ')).toMatch(/outside the/);
  });

  it('reports the limiting factor when the trailer target cannot be met, then accepts a trailer field', () => {
    const { p, services } = project();
    let q = run(p, services, 'set_program', { trailerStalls: 200 }).project;
    const r = run(q, services, 'generate_layout', { rotationDeg: 0 });
    q = r.project;
    expect((r.result.notes as string[]).join(' ')).toMatch(/Requested 200 trailer stalls; placed 126\. Limiting factor: truck court length/);
    const b = activeScenario(q).objects.find((o): o is Building => o.type === 'building')!;
    const add = run(q, services, 'add_trailer_field', { center: [b.center[0], 300], rotationDeg: 0, lengthFt: 900, rows: 1 });
    expect(add.result.stalls).toBe(75);
    q = add.project;
    expect(activeScenario(q).results.yield.find((y) => y.key === 'trailerStalls')!.value).toBe(201);
    // Manual objects survive regeneration.
    q = run(q, services, 'edit_object', { id: 'bldg-1', moveBy: [50, 0] }).project;
    expect(activeScenario(q).objects.some((o) => o.id === 'trailer-m1')).toBe(true);
  });

  it('edit / undo / delete round trip; rear-load scenario B and compare', () => {
    const { p, services } = project();
    let q = run(p, services, 'generate_layout', { rotationDeg: 0 }).project;
    const before = (activeScenario(q).objects.find((o) => o.type === 'building') as Building).center;
    q = run(q, services, 'edit_object', { id: 'bldg-1', moveBy: [100, -50] }).project;
    const after = (activeScenario(q).objects.find((o) => o.type === 'building') as Building).center;
    expect(after[0] - before[0]).toBeCloseTo(100, 6);
    q = run(q, services, 'undo').project;
    expect((activeScenario(q).objects.find((o) => o.type === 'building') as Building).center).toEqual(before);
    q = run(q, services, 'create_scenario', { name: 'B: rear-load' }).project;
    q = run(q, services, 'set_program', { buildingType: 'rearLoad' }).project;
    q = run(q, services, 'generate_layout', {}).project;
    const b = activeScenario(q).objects.find((o): o is Building => o.type === 'building')!;
    expect(b.depthFt).toBe(340);
    expect(b.dockSides).toHaveLength(1);
    const cmp = run(q, services, 'compare_scenarios').result as any;
    expect(cmp.rows.find((r: any) => r.metric === 'Building').values.A).toMatch(/cross-dock/);
    expect(cmp.rows.find((r: any) => r.metric === 'Building').values.B).toMatch(/rear-load/);
    q = run(q, services, 'delete_object', { id: 'bldg-1' }).project;
    expect(activeScenario(q).objects).toHaveLength(0);
    expect(() => run(q, services, 'edit_object', { id: 'nope' })).toThrow(/No object "nope"/);
  });
});

describe('stormwater sizing methods (stretch)', () => {
  it('SCS curve-number runoff matches the hand calc', async () => {
    const { scsRunoffIn, requiredBasinAreaSf, basinStorageCf } = await import('./basin');
    // P = 3 in, CN 98: S = 0.204, Q = (3 − 0.0408)² / (3 + 0.1633) = 2.768 in
    expect(scsRunoffIn(3, 98)).toBeCloseTo(2.768, 2);
    // P = 3 in, CN 71: S = 4.085, Ia = 0.817, Q = 2.183² / 6.268 = 0.760 in
    expect(scsRunoffIn(3, 71)).toBeCloseTo(0.76, 2);
    expect(scsRunoffIn(0.5, 71)).toBe(0); // below the initial abstraction
    const sw = { ...(await import('../criteria/stormwater')).STORMWATER_DEFAULTS, method: 'tr55' as const };
    const parcel = 100 * 43560;
    const imperv = 20 * 43560;
    const r = requiredBasinAreaSf(sw, parcel, imperv);
    const cnPost = (98 * 20 + 74 * 80) / 100;
    const expected = ((scsRunoffIn(3, cnPost) - scsRunoffIn(3, 71)) / 12) * parcel;
    expect(r.storageCf).toBeCloseTo(expected, 0);
    // The footprint returned actually stores the required volume (2:1 rectangle, 6 ft deep, 1 ft freeboard, 3:1).
    const w = Math.sqrt(r.areaSf / 2);
    expect(basinStorageCf(w, 2 * w, sw.basinDepthFt, sw.freeboardFt, sw.sideSlopeHtoV)).toBeGreaterThanOrEqual(expected * 0.999);
    expect(r.basis).toMatch(/placeholder/);
  });

  it('switching the method through set_program resizes the reservation and shows up in the assumptions', () => {
    const { p, services } = project();
    let q = run(p, services, 'generate_layout', { rotationDeg: 0 }).project;
    const pct = activeScenario(q).results.yield.find((y) => y.key === 'basinArea')!.value;
    q = run(q, services, 'set_program', { stormwater: { method: 'tr55', designStormIn: 3.2 } }).project;
    const tr = activeScenario(q).results.yield.find((y) => y.key === 'basinArea')!;
    expect(tr.value).toBeLessThan(pct);
    expect(tr.value).toBeGreaterThan(20000);
    expect(tr.limit).toMatch(/tr55 method/);
    const sum = run(q, services, 'get_project_summary', { includeAssumptions: true }).result as any;
    expect(sum.assumptionsChanged.join(' ')).toMatch(/Design storm depth.*3\.2 in/);
    expect(sum.assumptions.some((a: any) => /pctOfSite method/.test(a.label))).toBe(false);
  });
});
