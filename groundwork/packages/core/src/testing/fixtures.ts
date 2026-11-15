/** Small synthetic sites for unit tests (flat or planar DEM, simple parcels). */
import { type Pt, type Ring, bboxOf, expandBBox } from '../geometry/basic';
import { EPSG_2272 } from '../geometry/crs';
import { type Grid, gridSpecForBBox, makeGrid } from '../geometry/grid';
import type { District, Road, Site, SiteFixture } from '../site/model';
import { assembleSite } from '../zoning/edges';

export type TestSiteOpts = {
  ring: Ring;
  roads?: Partial<Road>[];
  districts?: Partial<District>[];
  constraints?: SiteFixture['constraints'];
  /** Elevation function (ft). Default: flat at 100. */
  elev?: (x: number, y: number) => number;
  cellFt?: number;
  bufferFt?: number;
  addressRoadName?: string;
};

export function makeTestSite(o: TestSiteOpts): Site {
  const cellFt = o.cellFt ?? 5;
  const spec = gridSpecForBBox(expandBBox(bboxOf(o.ring), o.bufferFt ?? 200), cellFt);
  const dem: Grid = makeGrid(spec);
  const f = o.elev ?? (() => 100);
  for (let j = 0; j < spec.ny; j++) for (let i = 0; i < spec.nx; i++) dem.data[j * spec.nx + i] = f(spec.x0 + (i + 0.5) * cellFt, spec.y0 + (j + 0.5) * cellFt);
  const fixture: SiteFixture = {
    id: 'test',
    name: 'Test site',
    address: '1 Test Rd',
    jurisdiction: 'Testville',
    crs: EPSG_2272,
    synthetic: true,
    parcel: { id: 'p1', ring: o.ring },
    zoningDistrictCode: 'I-1',
    addressRoadName: o.addressRoadName,
    roads: (o.roads ?? []).map((r, i) => ({ id: r.id ?? `road-${i + 1}`, name: r.name ?? `Road ${i + 1}`, roadClass: r.roadClass ?? 'local', centerline: r.centerline as Pt[], rowWidthFt: r.rowWidthFt ?? 50, rowAssumed: true, ref: r.ref })),
    districts: (o.districts ?? []).map((d, i) => ({ id: d.id ?? `dist-${i + 1}`, code: d.code ?? 'RES', name: d.name ?? 'Residential', kind: d.kind ?? 'residential', ring: d.ring as Ring })),
    constraints: o.constraints ?? [],
    asBuilt: [],
    terrain: { ...spec, source: 'test', synthetic: true, preDevelopment: true, verticalDatum: 'NAVD88', file: 'dem.f32' },
    neighbors: [],
    imagery: { available: false, sets: [], attribution: '' },
    provenance: [],
  };
  return assembleSite(fixture, dem);
}

/** Axis-aligned rectangle ring (CCW) from the SW corner. */
export function rectRing(x0: number, y0: number, w: number, h: number): Ring {
  return [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + h],
    [x0, y0 + h],
  ];
}
