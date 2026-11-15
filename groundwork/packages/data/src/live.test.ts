/** Offline tests for the pure helpers in the live-data adapters (no network). */
import { describe, expect, it } from 'vitest';
import { type Ring, pointInRing, ringArea } from '@groundwork/core';
import { chainLines, clipLineToBBox, countyRoadName, districtsFromZoningFile, simplifyRing, situsKey } from './live';

describe('live-data helpers', () => {
  it('normalizes an address to the county situs format', () => {
    expect(situsKey('1625 Heilmandale Rd, Lebanon, PA 17046')).toBe('1625 HEILMANDALE RD');
    expect(situsKey('1625 heilmandale road')).toBe('1625 HEILMANDALE RD');
  });

  it('names county roads and picks out state routes', () => {
    expect(countyRoadName('STATE ROUTE 72  N', '0072')).toEqual({ name: 'Route 72', ref: '72' });
    expect(countyRoadName('HEILMANDALE RD', '4006')).toEqual({ name: 'Heilmandale Rd', ref: 'SR 4006' });
    expect(countyRoadName('ORANGE LN', ' ')).toEqual({ name: 'Orange Ln' });
  });

  it('chains road pieces end to end and clips them to the area', () => {
    const chained = chainLines([
      [[100, 0], [200, 0]],
      [[0, 0], [100, 0]],
      [[300, 0], [200, 0]],
    ]);
    expect(chained).toHaveLength(1);
    expect(chained[0].length).toBe(4);
    const clipped = clipLineToBBox(chained[0], { minX: 50, minY: -10, maxX: 250, maxY: 10 });
    expect(clipped).toHaveLength(1);
    const ends = [clipped[0][0][0], clipped[0][clipped[0].length - 1][0]].sort((x, y) => x - y); // direction is not guaranteed
    expect(ends[0]).toBeCloseTo(50, 3);
    expect(ends[1]).toBeCloseTo(250, 3);
  });

  it('simplifies a densified ring without changing its area by more than a hair', () => {
    const ring: Ring = [];
    for (let i = 0; i < 100; i++) ring.push([i * 10, Math.sin(i) * 0.3]); // nearly straight, densified edge
    ring.push([1000, 500], [0, 500]);
    const simple = simplifyRing(ring, 1);
    expect(simple.length).toBeLessThan(10);
    expect(Math.abs(ringArea(simple) - ringArea(ring)) / ringArea(ring)).toBeLessThan(0.002);
  });

  it('fits digitized districts to the lot: the lot is the site district and neighbours close up to its lines', () => {
    const lot: Ring = [[0, 0], [1000, 0], [1000, 600], [0, 600]];
    const file = {
      source: 'test', sourceTitle: 'test', method: '', accuracyNote: '',
      districts: [
        { code: 'I', name: 'Industrial', kind: 'industrial' as const, ring: [[-8, -8], [1008, -8], [1008, 608], [-8, 608]] as Ring }, // digitized ~8 ft fat
        { code: 'RR', name: 'Rural Residential', kind: 'residential' as const, ring: [[-500, 612], [1500, 612], [1500, 1200], [-500, 1200]] as Ring }, // 12 ft gap to the lot
      ],
    };
    const out = districtsFromZoningFile(file, lot, { minX: -400, minY: -400, maxX: 1400, maxY: 1000 }, 'I-1');
    expect(out[0]).toMatchObject({ id: 'dist-site', code: 'I-1' });
    expect(out.filter((d) => d.kind === 'industrial')).toHaveLength(1); // the 8 ft sliver is dropped
    const rr = out.find((d) => d.code === 'RR')!;
    expect(pointInRing([500, 601], rr.ring)).toBe(true); // closed up to the north lot line…
    expect(pointInRing([500, 599], rr.ring)).toBe(false); // …and never inside the lot
    expect(Math.max(...rr.ring.map((q) => q[1]))).toBeLessThanOrEqual(1000.01); // clipped to the area
  });
});
