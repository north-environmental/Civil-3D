import { describe, expect, it } from 'vitest';
import '../derive';
import { bboxOfRegion } from '../geometry/basic';
import { makeTestSite, rectRing } from '../testing/fixtures';
import { buildEnvelopes } from '../zoning/envelopes';
import { analyzeRoute } from './accessibleRoute';
import { type HostServices, executeCommand, newProject } from './index';

describe('accessible route check (stretch, partial)', () => {
  it('classifies walking surface, ramp and too-steep runs and enforces the 30 in ramp rise', () => {
    // 100 ft at 2%, 40 ft at 8% (rise 3.2 ft = 38 in), 20 ft at 12%.
    const surf = (x: number) => (x <= 100 ? 0.02 * x : x <= 140 ? 2 + 0.08 * (x - 100) : 5.2 + 0.12 * (x - 140));
    const r = analyzeRoute((x) => surf(x), [[0, 0], [160, 0]]);
    expect(r.runs.map((x) => x.kind)).toEqual(['walk', 'ramp', 'tooSteep']);
    expect(r.runs[1].riseFt).toBeCloseTo(3.2, 1);
    expect(r.maxRunningPct).toBeCloseTo(12, 1);
    expect(r.maxCrossPct).toBeCloseTo(0, 6);
    // A cross slope shows up when the surface tilts sideways.
    expect(analyzeRoute((_x, y) => 0.03 * y, [[0, 0], [50, 0]]).maxCrossPct).toBeCloseTo(3, 6);
  });

  it('runs through the command layer on existing ground', () => {
    const site = makeTestSite({ ring: rectRing(0, 0, 1000, 800), elev: (x) => 100 + 0.03 * x });
    const services: HostServices = { resolveSite: () => site };
    const p = executeCommand(newProject(), 'load_site', { siteId: 'test' }, { services }).project;
    const flat = executeCommand(p, 'check_accessible_route', { points: [[100, 100], [100, 400]] }, { services }).result as any;
    expect(flat.status).toBe('fail'); // 3% cross slope when walking along the contour
    expect(flat.maxRunningSlopePct).toBeCloseTo(0, 1);
    const down = executeCommand(p, 'check_accessible_route', { points: [[100, 100], [400, 100]] }, { services }).result as any;
    expect(down.status).toBe('pass');
    expect(down.maxRunningSlopePct).toBeCloseTo(3, 1);
  });
});

describe('second jurisdiction through the ordinance-ingestion flow (stretch)', () => {
  it('a different rule set (same semantic keys) drives envelopes and checks without engine changes', () => {
    // A FICTIONAL district for testing only: not a real ordinance.
    const site = { ...makeTestSite({ ring: rectRing(0, 0, 2000, 1500), roads: [{ name: 'Front St', centerline: [[-500, -25], [2500, -25]], rowWidthFt: 50 }] }), zoningDistrictCode: 'X-1', jurisdiction: 'Testville (fictional)' };
    const services: HostServices = { resolveSite: () => site };
    let p = executeCommand(newProject(), 'load_site', { siteId: 'test' }, { services }).project;
    expect(p.rules).toBeNull();
    expect(() => executeCommand(p, 'get_zoning_rules', {}, { services })).toThrow(/No zoning rule set/);
    const rule = (id: string, key: string, value: number, category: string, appliesTo: string, operator: string, units: string) => ({
      id,
      key,
      category,
      appliesTo,
      value,
      units,
      operator,
      label: `Test rule ${id}`,
      citation: { section: 'Test § 1', source: 'user', quote: 'fictional test rule' },
    });
    p = executeCommand(
      p,
      'set_zoning_rules',
      {
        mode: 'replace',
        district: 'X-1',
        districtName: 'X-1 Test Industrial',
        rules: [
          rule('X.front', 'setback.building.front', 60, 'setback', 'building', 'min', 'ft'),
          rule('X.side', 'setback.building.side', 40, 'setback', 'building', 'min', 'ft'),
          rule('X.rear', 'setback.building.rear', 50, 'setback', 'building', 'min', 'ft'),
          rule('X.cov', 'lot.maxCoveragePct', 10, 'coverage', 'lot', 'max', 'pct'),
          rule('X.h', 'height.maxFt', 40, 'height', 'building', 'max', 'ft'),
          rule('X.pk', 'setback.parking.street', 15, 'setback', 'parking', 'min', 'ft'),
        ],
      },
      { services },
    ).project;
    expect(p.rules!.rules.every((r) => !r.confirmed)).toBe(true);
    p = executeCommand(p, 'confirm_zoning_rules', {}, { services }).project;
    const env = buildEnvelopes(p.site!, p.rules!);
    const b = bboxOfRegion(env.building);
    expect([b.minX, b.minY, b.maxX, b.maxY].map(Math.round)).toEqual([40, 60, 1960, 1450]);
    p = executeCommand(p, 'set_program', { buildingSf: 410000, carStalls: 100 }, { services }).project;
    p = executeCommand(p, 'generate_layout', { rotationDeg: 0 }, { services }).project;
    const checks = (executeCommand(p, 'run_checks', {}, { services }).result as any).checks as any[];
    const cov = checks.find((c) => c.id === 'z.lot.maxCoveragePct');
    expect(cov.status).toBe('fail'); // 410,400 / 3,000,000 = 13.7% > 10%
    expect(cov.citation).toBe('Test § 1');
    expect(checks.find((c) => c.id === 'z.height.maxFt').status).toBe('fail'); // 46 ft > 40 ft
  });
});
