import { describe, expect, it } from 'vitest';
import { bboxOfRegion, pointInRegion, regionArea } from '../geometry/basic';
import { makeTestSite, rectRing } from '../testing/fixtures';
import { buildEnvelopes, governingRuleAt } from './envelopes';
import { NORTH_LEBANON_I1 } from './rules';

const rules = NORTH_LEBANON_I1;
const big = 3000;

describe('zoning envelopes', () => {
  it('T12: 1,000 × 800 ft rectangle, front on ROW, rear abutting residential, plain sides', () => {
    const site = makeTestSite({
      ring: rectRing(0, 0, 1000, 800),
      roads: [{ name: 'Front St', centerline: [[-500, -25], [1500, -25]], rowWidthFt: 50 }],
      // Residential district abuts the rear (north) lot line only.
      districts: [{ kind: 'residential', ring: rectRing(0, 800, 1000, 600) }],
    });
    const cls = site.edges.map((e) => e.edgeClass);
    expect(cls).toEqual(['front', 'side', 'rear', 'side']);
    expect(site.edges[2].abutsResidential).toBe(true);
    expect(site.edges[0].acrossStreetFromResidential).toBe(false);
    expect(site.edges[1].abutsResidential || site.edges[3].abutsResidential).toBe(false);

    const env = buildEnvelopes(site, rules);
    const b = bboxOfRegion(env.building);
    expect(b.maxX - b.minX).toBeCloseTo(960, 2); // 1,000 − 2·20
    expect(b.maxY - b.minY).toBeCloseTo(550, 2); // 800 − 100 − 150
    expect(b.minY).toBeCloseTo(100, 2);
    expect(regionArea(env.building)).toBeCloseTo(960 * 550, 0);
    const p = bboxOfRegion(env.parking);
    expect(p.maxX - p.minX).toBeCloseTo(980, 2); // 10 ft sides
    expect(p.maxY - p.minY).toBeCloseTo(675, 2); // 800 − 25 − 100
    expect(regionArea(env.parking)).toBeCloseTo(980 * 675, 0);
    // Loading may not be in the required front yard (100 ft).
    const l = bboxOfRegion(env.loading);
    expect(l.minY).toBeCloseTo(100, 2);
    expect(env.edgeSetbacks[2].buildingRuleKey).toBe('setback.building.fromResidential');
  });

  it('front yard is 150 ft when across the street from a residential district', () => {
    const site = makeTestSite({
      ring: rectRing(0, 0, 1000, 800),
      roads: [{ name: 'Front St', centerline: [[-500, -25], [1500, -25]], rowWidthFt: 50 }],
      districts: [{ kind: 'residential', ring: rectRing(-big, -25 - big, 2 * big, big) }], // boundary at the street centerline
    });
    expect(site.edges[0].acrossStreetFromResidential).toBe(true);
    const env = buildEnvelopes(site, rules);
    expect(bboxOfRegion(env.building).minY).toBeCloseTo(150, 2);
    // Parking: 100 ft from the district boundary (street centerline) = 75 ft inside the ROW line, which beats 25 ft.
    expect(bboxOfRegion(env.parking).minY).toBeCloseTo(75, 1);
  });

  it('corner lot: both street edges are fronts; residential separation applies only to the abutting side', () => {
    const site = makeTestSite({
      ring: rectRing(0, 0, 900, 700),
      roads: [
        { name: 'South St', centerline: [[-600, -25], [1500, -25]], rowWidthFt: 50 },
        { name: 'West Ave', centerline: [[-30, -600], [-30, 1300]], rowWidthFt: 60, roadClass: 'state' },
      ],
      districts: [{ kind: 'residential', ring: rectRing(900, -200, 500, 1200) }], // abuts the east side
      addressRoadName: 'South St',
    });
    const [s, e, n, w] = site.edges;
    expect([s.edgeClass, e.edgeClass, n.edgeClass, w.edgeClass]).toEqual(['front', 'side', 'rear', 'front']);
    expect(e.abutsResidential).toBe(true);
    expect(n.abutsResidential).toBe(false);
    const env = buildEnvelopes(site, rules);
    const b = bboxOfRegion(env.building);
    expect(b.minX).toBeCloseTo(100, 2); // west front yard
    expect(b.minY).toBeCloseTo(100, 2); // south front yard
    expect(b.maxX).toBeCloseTo(900 - 150, 2); // residential separation on the east side only
    expect(b.maxY).toBeCloseTo(700 - 30, 2); // plain rear yard
    const p = bboxOfRegion(env.parking);
    expect(p.minX).toBeCloseTo(25, 2);
    expect(p.maxX).toBeCloseTo(900 - 100, 2);
    expect(p.maxY).toBeCloseTo(700 - 10, 2);
  });

  it('L-shaped (concave) parcel: envelope stays inside and respects each edge', () => {
    // L: 1,200 × 1,000 with the NE 600 × 500 quadrant removed. Front on the south.
    const ring: [number, number][] = [
      [0, 0],
      [1200, 0],
      [1200, 500],
      [600, 500],
      [600, 1000],
      [0, 1000],
    ];
    const site = makeTestSite({ ring, roads: [{ name: 'South St', centerline: [[-600, -25], [1800, -25]], rowWidthFt: 50 }] });
    expect(site.edges.map((e) => e.edgeClass)).toEqual(['front', 'side', 'rear', 'side', 'rear', 'side']);
    const env = buildEnvelopes(site, rules);
    // Expected: [20,1180]×[100,470] ∪ [20,580]×[100,970], minus the 10 × 60 ft notch where the inner
    // rear yard (30 ft) is extended past the reflex corner by its square cap (conservative).
    const expected = 1160 * 370 + 560 * 500 - 10 * 60;
    expect(regionArea(env.building)).toBeCloseTo(expected, -1);
    expect(pointInRegion([300, 900], env.building)).toBe(true);
    expect(pointInRegion([900, 300], env.building)).toBe(true);
    expect(pointInRegion([590, 480], env.building)).toBe(false); // within 20 ft of the inner side edge / 30 ft of the inner rear edge
    expect(pointInRegion([900, 485], env.building)).toBe(false);
    expect(pointInRegion([900, 600], env.building)).toBe(false); // outside the parcel
    expect(regionArea(env.parking)).toBeGreaterThan(regionArea(env.building));
  });

  it('subtracts hard constraints (with buffer) but not informational ones', () => {
    const base = { ring: rectRing(0, 0, 1000, 800), roads: [{ name: 'Front St', centerline: [[-500, -25], [1500, -25]] as [number, number][], rowWidthFt: 50 }] };
    const plain = buildEnvelopes(makeTestSite(base), rules);
    const withWet = buildEnvelopes(
      makeTestSite({ ...base, constraints: [{ id: 'w', kind: 'wetland', name: 'Wetland', ring: rectRing(400, 300, 100, 100), bufferFt: 25, informational: false, source: '' }] }),
      rules,
    );
    // 150 × 150 square with rounded corners removed: between 100² and 150².
    const removed = regionArea(plain.building) - regionArea(withWet.building);
    expect(removed).toBeGreaterThan(150 * 150 - 4 * (25 * 25 - (Math.PI * 25 * 25) / 4) - 5);
    expect(removed).toBeLessThanOrEqual(150 * 150 + 1);
    const info = buildEnvelopes(
      makeTestSite({ ...base, constraints: [{ id: 's', kind: 'steepSlope', name: 'Steep', ring: rectRing(400, 300, 100, 100), bufferFt: 0, informational: true, source: '' }] }),
      rules,
    );
    expect(regionArea(info.building)).toBeCloseTo(regionArea(plain.building), 0);
  });

  it('reports the governing rule and citation at a setback line', () => {
    const site = makeTestSite({
      ring: rectRing(0, 0, 1000, 800),
      roads: [{ name: 'Front St', centerline: [[-500, -25], [1500, -25]], rowWidthFt: 50 }],
      districts: [{ kind: 'residential', ring: rectRing(0, 800, 1000, 600) }],
    });
    const env = buildEnvelopes(site, rules);
    const front = governingRuleAt(site, rules, env, [500, 100.5]);
    expect(front?.citation).toBe('§ 27-1003');
    expect(front?.distanceFt).toBe(100);
    expect(front?.detail).toMatch(/Front St/);
    const rear = governingRuleAt(site, rules, env, [500, 650]);
    expect(rear?.distanceFt).toBe(150);
    expect(rear?.label).toMatch(/residential/i);
    const park = governingRuleAt(site, rules, env, [500, 25.5]);
    expect(park?.envelope).toBe('parking');
    expect(park?.citation).toBe('§ 27-1404.G');
    expect(governingRuleAt(site, rules, env, [500, 400])).toBeNull();
  });
});
