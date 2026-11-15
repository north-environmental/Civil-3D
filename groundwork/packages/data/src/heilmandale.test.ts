/**
 * The real demo site: 1625 Heilmandale Rd, built by scripts/fetch-site-data.ts from public GIS
 * services and cached under data/sites/heilmandale/ so these tests (and the app) run offline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type Building,
  type Project,
  HEADLINE_STEPS,
  HEADLINE_STEPS_GRADING,
  NORTH_LEBANON_I1,
  activeScenario,
  axisAngleDiffDeg,
  buildEnvelopes,
  executeCommand,
  frontageAngleDeg,
  frontages,
  newProject,
  pointInRing,
  ringArea,
  ringToRingDist,
  terrainStats,
} from '@groundwork/core';
import { createHostServices, loadSiteFixture, resolveSiteId } from './fixtures';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/sites');
const siteDir = path.join(dataDir, 'heilmandale');

describe('1625 Heilmandale Rd: real site data', () => {
  const site = loadSiteFixture(dataDir, 'heilmandale');
  const raw = fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8');

  it('resolves by address and is not flagged synthetic', () => {
    expect(resolveSiteId(dataDir, { address: '1625 Heilmandale Rd' })).toBe('heilmandale');
    expect(resolveSiteId(dataDir, { address: '1625 heilmandale road, lebanon pa' })).toBe('heilmandale');
    expect(site.synthetic).toBe(false);
    expect(site.terrain.synthetic).toBe(false);
  });

  it('parcel matches the county record: 110.35 ac deeded, computed within 0.5%', () => {
    expect(site.parcel.recordAreaAc).toBe(110.35);
    expect(Math.abs(site.areaSf / 43560 - 110.35) / 110.35).toBeLessThan(0.005);
    expect(site.parcel.pin).toMatch(/^27-/); // North Lebanon Township map numbers start with 27
    expect(site.parcel.ring.length).toBeLessThan(80); // simplified from 434 densified vertices
  });

  it('stores no owner names or mailing addresses', () => {
    // The county layer carries these fields; the fetch never requests them.
    expect(raw).not.toMatch(/"(OWNER|MAILING_AD|CITY|ZIP_CODE|SALE_PRICE)"/);
    expect(Object.keys(JSON.parse(raw).parcel).sort()).toEqual(['id', 'pin', 'recordAreaAc', 'ring']);
  });

  it('frontages: long Heilmandale Rd frontage deeded to the centerline, short Route 72 and Orange Ln frontages, Elias Ave', () => {
    const fr = Object.fromEntries(frontages(site.edges).map((f) => [f.roadName, f]));
    expect(Object.keys(fr).sort()).toEqual(['Elias Ave', 'Heilmandale Rd', 'Orange Ln', 'Route 72']);
    expect(fr['Heilmandale Rd'].lengthFt).toBeGreaterThan(3000);
    expect(fr['Route 72'].lengthFt).toBeLessThan(200);
    expect(fr['Heilmandale Rd'].acrossStreetFromResidential).toBe(true); // Rural Residential north of the road
    expect(fr['Route 72'].acrossStreetFromResidential).toBe(false); // General Commercial across Route 72
    // The lot line runs down the Heilmandale Rd centerline, so the ROW line is half the assumed 60 ft ROW inside it.
    const heil = site.edges.filter((e) => e.roadName === 'Heilmandale Rd');
    expect(Math.min(...heil.map((e) => e.rowInsetFt))).toBeGreaterThan(28);
    expect(Math.max(...heil.map((e) => e.rowInsetFt))).toBeLessThan(32); // the digitized centerline wanders a foot or two
    expect(site.roads.find((r) => r.name === 'Heilmandale Rd')?.ref).toBe('SR 4006');
  });

  it('front yards are measured from the right-of-way line, not the centerline lot line', () => {
    const env = buildEnvelopes(site, NORTH_LEBANON_I1);
    const e = site.edges.find((x) => x.roadName === 'Heilmandale Rd' && x.acrossStreetFromResidential)!;
    const sb = env.edgeSetbacks[e.index];
    expect(sb.buildingFt).toBe(150); // § 27-1003: across the street from a residential district
    expect(sb.buildingLineFt).toBeCloseTo(150 + e.rowInsetFt, 6);
    // A point 160 ft inside that lot line is still in the front yard; one 190 ft inside is not.
    const mid: [number, number] = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
    const d = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
    const inward: [number, number] = [-(e.b[1] - e.a[1]) / d, (e.b[0] - e.a[0]) / d];
    const at = (ft: number): [number, number] => [mid[0] + inward[0] * ft, mid[1] + inward[1] * ft];
    const inBuilding = (q: [number, number]) => env.building.some((r) => pointInRing(q, r));
    expect(inBuilding(at(160))).toBe(false);
    expect(inBuilding(at(190))).toBe(true);
  });

  it('zoning districts come from the 2023 township map: RR to the north and west, commercial across Route 72', () => {
    const codes = new Set(site.districts.map((d) => d.code));
    for (const c of ['I-1', 'RR', 'A', 'C2A']) expect(codes).toContain(c);
    expect(site.districts.find((d) => d.code === 'RR')?.kind).toBe('residential');
    const westSide = site.edges.filter((e) => e.abutsResidential);
    expect(westSide.length).toBeGreaterThan(0);
    expect(westSide.every((e) => ['W', 'S', 'SW', 'NW'].includes(e.facing))).toBe(true);
    expect(site.provenance.find((p) => p.layer === 'districts')?.sourceUrl).toMatch(/NLT-Zoning-Map-2023\.pdf$/);
  });

  it('NWI wetland of about 4.8 ac on the south side, as in the 2020 minutes (4.5–5 ac)', () => {
    const onLot = site.constraints.filter((c) => c.kind === 'wetland' && pointInRing([c.ring[0][0], c.ring[0][1]], site.parcel.ring));
    expect(onLot).toHaveLength(1);
    const ac = ringArea(onLot[0].ring) / 43560;
    expect(ac).toBeGreaterThan(4.3);
    expect(ac).toBeLessThan(5.3);
    const cy = onLot[0].ring.reduce((a, q) => a + q[1], 0) / onLot[0].ring.length;
    const ys = site.parcel.ring.map((q) => q[1]);
    expect(cy).toBeLessThan((Math.min(...ys) + Math.max(...ys)) / 2); // south half
  });

  it('terrain is USGS LiDAR in feet, reviewed as pre-development, with plausible relief', () => {
    const st = terrainStats(site.dem, [site.parcel.ring]);
    expect(site.terrain.preDevelopment).toBe(true);
    expect(site.dem.cellFt).toBe(5);
    expect(st.minElevFt).toBeGreaterThan(450); // feet, not meters (the ground is ~155–175 m)
    expect(st.maxElevFt).toBeLessThan(650);
    expect(st.reliefFt).toBeGreaterThan(40);
    expect(st.reliefFt).toBeLessThan(90);
  });

  it('aerials are cached in the site CRS and cover the lot', () => {
    expect(site.imagery.sets.map((s) => s.id)).toEqual(['pema2018', 'naip']);
    for (const set of site.imagery.sets) {
      for (const c of set.chunks) {
        expect(fs.existsSync(path.join(siteDir, c.file)), c.file).toBe(true);
        expect((c.x1 - c.x0) / c.widthPx).toBeCloseTo(set.ftPerPx, 6); // square pixels at the stated resolution
        expect((c.y1 - c.y0) / c.heightPx).toBeCloseTo(set.ftPerPx, 6);
      }
      const minX = Math.min(...set.chunks.map((c) => c.x0));
      const maxX = Math.max(...set.chunks.map((c) => c.x1));
      const minY = Math.min(...set.chunks.map((c) => c.y0));
      const maxY = Math.max(...set.chunks.map((c) => c.y1));
      for (const q of site.parcel.ring) expect(q[0] > minX && q[0] < maxX && q[1] > minY && q[1] < maxY).toBe(true);
    }
    expect(site.neighbors.length).toBeGreaterThan(50);
  });

  it('every layer records its source; layers that did not load say so', () => {
    const layers = site.provenance.map((p) => p.layer);
    for (const l of ['parcel', 'roads', 'terrain', 'wetlands', 'districts', 'imagery:pema2018']) expect(layers).toContain(l);
    for (const p of site.provenance) if (p.synthetic) expect(p.notes).toMatch(/NOT LOADED|APPROXIMATE/);
  });
});

describe('1625 Heilmandale Rd: headline test fit on the real lot', () => {
  const services = createHostServices(dataDir);
  let p: Project = newProject();
  const results: Record<string, any> = {};
  for (const st of HEADLINE_STEPS) {
    const r = executeCommand(p, st.command, st.input, { services, source: 'mcp' });
    p = r.project;
    results[st.command] = r.result;
  }
  const s = activeScenario(p);
  const b = s.objects.find((o): o is Building => o.type === 'building')!;

  it('load_site reports real data and the four frontages', () => {
    expect(results.load_site.summary).not.toMatch(/SYNTHETIC/);
    expect(results.load_site.frontages.map((f: any) => f.road).sort()).toEqual(['Elias Ave', 'Heilmandale Rd', 'Orange Ln', 'Route 72']);
    expect(results.get_site_context.constraints.every((c: any) => c.kind !== 'wetland' || c.areaAc < 5.5)).toBe(true); // off-lot wetlands are not listed
    expect(JSON.stringify(results.get_site_context).length).toBeLessThan(9000);
  });

  it('fits the ~410,000 SF cross-dock parallel to Heilmandale Rd with no failing check', () => {
    expect(b.areaSf).toBeGreaterThanOrEqual(410000);
    const heil = frontages(p.site!.edges).find((f) => f.roadName === 'Heilmandale Rd')!;
    expect(axisAngleDiffDeg(b.rotationDeg, frontageAngleDeg(heil))).toBeLessThan(0.1);
    expect(s.checks.filter((c) => c.status === 'fail').map((c) => `${c.title}: ${c.message}`)).toEqual([]);
    for (const q of b.polygon) expect(pointInRing(q, p.site!.parcel.ring)).toBe(true);
  });

  it('program: 100+ trailer stalls, 350+ car stalls, trucks from Heilmandale Rd, cars from Orange Ln, networks apart', () => {
    const y = Object.fromEntries(s.results.yield.map((r) => [r.key, r.value]));
    expect(y.trailerStalls).toBeGreaterThanOrEqual(100);
    expect(y.carStalls).toBeGreaterThanOrEqual(350);
    const dw = s.objects.filter((o) => o.type === 'driveway') as any[];
    expect(dw.filter((d) => d.network === 'truck').map((d) => d.roadName)).toEqual(['Heilmandale Rd']);
    expect(dw.filter((d) => d.network === 'car').map((d) => d.roadName)).toEqual(['Orange Ln']);
    expect(s.checks.find((c) => c.id === 'e.network.separation')?.status).toBe('pass');
  });

  it('keeps the basin and all pavement out of the NWI wetland and its 25 ft buffer', () => {
    const wet = p.site!.constraints.find((c) => c.kind === 'wetland' && pointInRing(c.ring[0], p.site!.parcel.ring))!;
    for (const o of s.objects as any[]) {
      if (o.type === 'landscape' || !o.polygon) continue;
      const rings = typeof o.polygon[0][0] === 'number' ? [o.polygon] : o.polygon;
      for (const r of rings) expect(ringToRingDist(r, wet.ring), o.name).toBeGreaterThanOrEqual(24.5);
    }
  });

  it('a Route 72 truck driveway is correctly rejected: the frontage is too short for the § 27-1407 spacing', () => {
    let q = executeCommand(p, 'set_access', { network: 'truck', road: 'Route 72', position: 'auto' }, { services }).project;
    q = executeCommand(q, 'generate_layout', { alignToRoad: 'Heilmandale Rd' }, { services }).project;
    const fails = activeScenario(q).checks.filter((c) => c.status === 'fail');
    expect(fails.some((c) => /Driveway spacing/.test(c.title) && /Route 72/.test(c.title))).toBe(true);
  });

  it('grading still runs on the real terrain and lands in a sane range', () => {
    let q = p;
    for (const st of HEADLINE_STEPS_GRADING) q = executeCommand(q, st.command, st.input, { services, source: 'mcp' }).project;
    const ew = activeScenario(q).results.earthwork!;
    const st = terrainStats(p.site!.dem, [p.site!.parcel.ring]);
    expect(ew.ffeFt).toBeGreaterThan(st.minElevFt);
    expect(ew.ffeFt).toBeLessThan(st.maxElevFt);
    expect(ew.cutCy + ew.fillCy).toBeGreaterThan(50_000);
    expect(ew.cutCy + ew.fillCy).toBeLessThan(900_000);
  });
});
