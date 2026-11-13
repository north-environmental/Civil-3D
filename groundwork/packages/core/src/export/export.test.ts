import DxfParser from 'dxf-parser';
import { describe, expect, it } from 'vitest';
import '../derive';
import { type HostServices, executeCommand, newProject } from '../commands';
import { activeScenario, type Project } from '../site/project';
import { makeTestSite, rectRing } from '../testing/fixtures';
import { buildDxf, buildGeoJson, buildXlsxSheets } from './build';
import { signedArea } from '../geometry/basic';

function gradedProject(): Project {
  const site = makeTestSite({
    ring: rectRing(2_330_000, 380_000, 2600, 2000),
    roads: [
      { name: 'South St', centerline: [[2_329_300, 379_975], [2_333_300, 379_975]], rowWidthFt: 50 },
      { name: 'West Ave', centerline: [[2_329_970, 379_300], [2_329_970, 382_700]], rowWidthFt: 60, roadClass: 'state' },
    ],
    elev: (x, y) => 400 + 0.012 * (y - 380_000) + 0.004 * (x - 2_330_000),
  });
  const services: HostServices = { resolveSite: () => site };
  let p = executeCommand(newProject(), 'load_site', { siteId: 'test' }, { services }).project;
  const run = (name: string, input: unknown = {}) => (p = executeCommand(p, name, input, { services, now: '2026-11-13T12:00:00.000Z' }).project);
  run('set_program', { buildingSf: 410000, employeesLargestShift: 300, employeesTwoLargestShifts: 520 });
  run('set_access', { network: 'truck', road: 'West Ave' });
  run('set_access', { network: 'car', road: 'South St' });
  run('generate_layout', { rotationDeg: 0 });
  run('optimize_ffe', {});
  return p;
}

describe('exports', () => {
  const p = gradedProject();
  const s = activeScenario(p);

  it('DXF parses back, is AutoCAD 2010 format in feet, and uses the AIA layers', () => {
    const { content, counts } = buildDxf(p, s, '2026-11-13T12:00:00.000Z');
    const dxf = new DxfParser().parseSync(content)!;
    expect(dxf.header.$ACADVER).toBe('AC1024');
    expect(dxf.header.$INSUNITS).toBe(2); // feet
    const layers = Object.keys(dxf.tables.layer.layers);
    for (const name of ['C-PROP', 'C-BLDG', 'C-PKNG-STRP', 'C-ROAD', 'C-TRCK', 'C-TOPO-EXST-MINR', 'C-TOPO-EXST-MAJR', 'C-TOPO-PROP-MINR', 'C-TOPO-PROP-MAJR', 'C-STRM-BSIN', 'C-SETB', 'C-ANNO']) {
      expect(layers, name).toContain(name);
      expect(counts[name], `entities on ${name}`).toBeGreaterThan(0);
    }
    expect(dxf.entities.length).toBe(Object.values(counts).reduce((a, b) => a + b, 0));
    // The parcel comes back in state plane feet, closed, with the right vertices.
    const parcel = dxf.entities.find((e: any) => e.layer === 'C-PROP') as any;
    expect(parcel.type).toBe('LWPOLYLINE');
    expect(parcel.shape).toBe(true);
    expect(parcel.vertices).toHaveLength(4);
    expect(parcel.vertices[0].x).toBeCloseTo(2_330_000, 2);
    expect(parcel.vertices[2].y).toBeCloseTo(382_000, 2);
    // Building polygon matches the design object.
    const bld = s.objects.find((o) => o.type === 'building') as any;
    const dxfBld = dxf.entities.find((e: any) => e.layer === 'C-BLDG') as any;
    expect(dxfBld.vertices[0].x).toBeCloseTo(bld.polygon[0][0], 2);
    // Contours carry their elevation; index contours are on the MAJR layer.
    const major = dxf.entities.filter((e: any) => e.layer === 'C-TOPO-EXST-MAJR') as any[];
    expect(major.every((e) => Math.abs(e.elevation % 5) < 1e-6)).toBe(true);
    const texts = dxf.entities.filter((e: any) => e.type === 'TEXT').map((e: any) => e.text as string);
    expect(texts.some((t) => /Concept-level, not for construction/.test(t))).toBe(true);
    expect(texts.some((t) => /^FFE \d+\.\d$/.test(t))).toBe(true);
    expect(content.includes('\r')).toBe(false);
  });

  it('GeoJSON is WGS84 with closed, counter-clockwise polygons for every design object', () => {
    const gj = buildGeoJson(p, s, '2026-11-13T12:00:00.000Z') as any;
    expect(gj.type).toBe('FeatureCollection');
    expect(gj.metadata.disclaimer).toMatch(/not for construction/);
    const ids = gj.features.map((f: any) => f.properties.id);
    for (const o of s.objects) expect(ids).toContain(o.id);
    for (const f of gj.features) {
      if (f.geometry.type !== 'Polygon') continue;
      const outer = f.geometry.coordinates[0] as [number, number][];
      expect(outer[0]).toEqual(outer[outer.length - 1]);
      for (const [lon, lat] of outer) {
        expect(lon).toBeGreaterThan(-78);
        expect(lon).toBeLessThan(-75);
        expect(lat).toBeGreaterThan(39.5);
        expect(lat).toBeLessThan(41.5);
      }
      expect(signedArea(outer.slice(0, -1)), f.properties.id).toBeGreaterThan(0);
    }
    const b = gj.features.find((f: any) => f.properties.type === 'building');
    expect(b.properties.ffeFt).toBe(s.grading.ffeFt);
  });

  it('XLSX model has the four sheets with citations, earthwork and assumptions', () => {
    const sheets = buildXlsxSheets(p, s, '2026-11-13T12:00:00.000Z');
    expect(sheets.map((x) => x.name)).toEqual(['Yield', 'Compliance', 'Earthwork', 'Assumptions']);
    const [y, c, e, a] = sheets;
    expect(y.rows.length).toBeGreaterThan(10);
    expect(c.rows.some((r) => /§ 27-1003/.test(String(r[6])))).toBe(true);
    expect(c.rows.every((r) => ['PASS', 'WARN', 'FAIL', 'N/A'].includes(String(r[1])))).toBe(true);
    expect(e.rows.find((r) => r[0] === 'Total to subgrade')![1]).toBe(Math.round(s.results.earthwork!.cutCy));
    expect(a.rows.some((r) => /EFCG default/.test(String(r[2])))).toBe(true);
    expect(a.rows.some((r) => /Zoning interpretation/.test(String(r[0])))).toBe(true);
    for (const sh of sheets) expect(sh.notes!.join(' ')).toMatch(/Concept-level, not for construction/);
  });

  it('export command returns effects for each requested format and refuses an empty scenario', () => {
    const r = executeCommand(p, 'export', { formats: ['dxf', 'xlsx', 'geojson', 'png'] }, { now: '2026-11-13T12:00:00.000Z' });
    expect(r.effects.map((e) => e.type).sort()).toEqual(['render', 'writeText', 'writeText', 'writeXlsx']);
    expect(r.result.summary).toMatch(/Exported scenario A: DXF \(\d+ layers, \d+ entities\)/);
    const empty = executeCommand(p, 'create_scenario', { copyFrom: 'empty' }).project;
    expect(() => executeCommand(empty, 'export', {})).toThrow(/no layout to export/);
  });
});
