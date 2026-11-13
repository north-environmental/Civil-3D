import { describe, expect, it } from 'vitest';
import '../derive';
import { makeTestSite, rectRing } from '../testing/fixtures';
import { NORTH_LEBANON_I1, loadingBerthsRequired, ruleTable } from '../zoning/rules';
import { type HostServices, executeCommand, newProject } from './index';

function testProject() {
  const site = makeTestSite({
    ring: rectRing(0, 0, 2400, 2000),
    roads: [{ name: 'Front St', centerline: [[-500, -25], [2900, -25]], rowWidthFt: 50 }],
    districts: [{ kind: 'residential', ring: rectRing(0, 2000, 2400, 600) }],
  });
  const services: HostServices = {
    resolveSite: () => site,
    ordinanceText: (s) => (s.includes('1003') ? { section: '27-1003', title: 'Yards', text: 'Front yard: 100 ft', source: 'test', verbatim: false } : null),
    listOrdinanceSections: () => ['27-1003 Yards'],
  };
  const p = executeCommand(newProject(), 'load_site', { siteId: 'test' }, { services }).project;
  return { p, services };
}

describe('zoning commands', () => {
  it('T8: loading berths for 411,840 SF = 13 conservative, 12 rounded down', () => {
    const t = ruleTable(NORTH_LEBANON_I1, 'loading.berthsRequired')!;
    expect(loadingBerthsRequired(411840, t)).toEqual({ conservative: 13, roundedDown: 12 });
    expect(loadingBerthsRequired(2000, t).conservative).toBe(0);
    expect(loadingBerthsRequired(10000, t).conservative).toBe(1);
    expect(loadingBerthsRequired(50000, t).conservative).toBe(2);
    expect(loadingBerthsRequired(50001, t).conservative).toBe(4);
    expect(loadingBerthsRequired(90000, t)).toEqual({ conservative: 4, roundedDown: 4 });
  });

  it('pre-loads confirmed I-1 rules with citations and interpretation flags', () => {
    const { p, services } = testProject();
    const r = executeCommand(p, 'get_zoning_rules', {}, { services }).result as any;
    expect(r.rules.length).toBeGreaterThan(30);
    expect(r.rules.every((x: any) => x.status === 'confirmed' && /§ 27-\d{4}/.test(x.citation))).toBe(true);
    expect(r.rules.flatMap((x: any) => x.interpretationFlags ?? []).join(' ')).toMatch(/rounded UP/);
    expect(r.interpretationFlagCount).toBeGreaterThan(8);
    expect(r.residentialSeparation).toEqual({ buildingFt: 150, parkingFt: 100 });
    expect(r.summary).toMatch(/Front St: building 100 ft/);
    const setbacks = executeCommand(p, 'get_zoning_rules', { category: 'setback' }, { services }).result as any;
    expect(setbacks.rules.every((x: any) => x.key.startsWith('setback.'))).toBe(true);
  });

  it('lot-level checks pass before any layout; layout checks are n/a', () => {
    const { p, services } = testProject();
    const r = executeCommand(p, 'run_checks', {}, { services }).result as any;
    const by = Object.fromEntries(r.checks.map((c: any) => [c.id, c]));
    expect(by['z.lot.minAreaAc'].status).toBe('pass');
    expect(by['z.lot.minAreaAc'].citation).toBe('§ 27-1003');
    expect(by['z.lot.minWidthFt'].value).toBe(2400);
    expect(by['z.height.maxFt'].status).toBe('n/a');
    expect(r.counts.fail).toBe(0);
  });

  it('ordinance text lookup, and the propose -> confirm flow', () => {
    const { p, services } = testProject();
    expect((executeCommand(p, 'get_ordinance_text', { section: '§ 27-1003' }, { services }).result as any).verbatim).toBe(false);
    expect(() => executeCommand(p, 'get_ordinance_text', { section: '99' }, { services })).toThrow(/No cached text/);
    const proposed = executeCommand(
      p,
      'set_zoning_rules',
      {
        rules: [
          {
            id: 'X.height',
            key: 'height.maxFt',
            category: 'height',
            appliesTo: 'building',
            value: 60,
            units: 'ft',
            operator: 'max',
            label: 'Max height (proposed)',
            citation: { section: '§ 27-1003', source: 'user', quote: 'test' },
          },
        ],
      },
      { services, source: 'mcp' },
    );
    let q = proposed.project;
    expect(q.rules!.rules.find((r) => r.id === 'X.height')!.confirmed).toBe(false);
    // A proposed rule never overrides a confirmed rule with the same key…
    let checks = executeCommand(q, 'run_checks', {}, { services }).result as any;
    expect(checks.checks.find((c: any) => c.id === 'z.height.maxFt').limit).toBe(75);
    // …and the open proposal is surfaced as a warning.
    expect(checks.checks.find((c: any) => c.id === 'z.unconfirmed').status).toBe('warn');
    q = executeCommand(q, 'confirm_zoning_rules', {}, { services }).project;
    expect(q.rules!.rules.every((r) => r.confirmed)).toBe(true);
    checks = executeCommand(q, 'run_checks', {}, { services }).result as any;
    expect(checks.checks.find((c: any) => c.id === 'z.unconfirmed')).toBeUndefined();
    // undo restores the proposal state
    q = executeCommand(q, 'undo', {}, { services }).project;
    expect(q.rules!.rules.find((r) => r.id === 'X.height')!.confirmed).toBe(false);
  });

  it('set_edge_class overrides classification and envelopes follow', () => {
    const { p, services } = testProject();
    expect(p.site!.edges[1].edgeClass).toBe('side');
    const q = executeCommand(p, 'set_edge_class', { edgeIndex: 1, abutsResidential: true }, { services }).project;
    expect(q.site!.edges[1].abutsResidential).toBe(true);
    const before = executeCommand(p, 'get_zoning_rules', {}, { services }).result as any;
    const after = executeCommand(q, 'get_zoning_rules', {}, { services }).result as any;
    expect(after.envelopes.buildingAc).toBeLessThan(before.envelopes.buildingAc);
  });
});
