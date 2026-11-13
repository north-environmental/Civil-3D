/**
 * Live data adapters (SPEC §6). Node-only, used ONLY by scripts/fetch-site-data.ts.
 * Each source is tried once with a ~20 s timeout; failures are reported and the fallback is kept.
 *
 * NOTE: these adapters were written in a sandbox with no outbound access to the data hosts, so they
 * are untested against the live services. Endpoint shapes follow SPEC §6 and public ArcGIS REST /
 * Overpass conventions. See docs/LIMITATIONS.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  type AsBuilt,
  type BBox,
  type Constraint,
  type Crs,
  type District,
  EPSG_2272,
  FTUS_PER_M,
  type Grid,
  type Pt,
  type Provenance,
  ROW_DEFAULT_FT,
  type Ring,
  type Road,
  type SiteFixture,
  bboxOf,
  ensureCCW,
  expandBBox,
  fromLonLat,
  pointInRing,
  ringArea,
  ringCentroid,
  terrainStats,
  toLonLat,
} from '@groundwork/core';

const UA = 'groundwork-demo/0.1 (site-data fetch script)';
const TIMEOUT_MS = 20_000;

export type LayerReport = { layer: string; source: string; ok: boolean; detail: string };

async function get(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { 'user-agent': UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res;
}
const getJson = async (url: string, init?: RequestInit): Promise<any> => (await get(url, init)).json();

export async function geocode(address: string): Promise<{ lonLat: Pt; source: string }> {
  try {
    const u = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
    const j = await getJson(u);
    const m = j?.result?.addressMatches?.[0];
    if (m) return { lonLat: [m.coordinates.x, m.coordinates.y], source: u };
    throw new Error('no address match');
  } catch (censusErr) {
    const u = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const j = await getJson(u);
    if (j?.[0]) return { lonLat: [Number(j[0].lon), Number(j[0].lat)], source: u };
    throw new Error(`geocoding failed (Census: ${(censusErr as Error).message}; Nominatim: no result)`);
  }
}

function largestRing(geom: any): Ring | null {
  if (!geom) return null;
  const polys: number[][][][] = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  let best: Ring | null = null;
  for (const poly of polys) {
    const outer = poly[0]?.map((c) => [c[0], c[1]] as Pt);
    if (!outer || outer.length < 4) continue;
    const ring = outer.slice(0, -1); // GeoJSON repeats the first vertex
    if (!best || ringArea(ring) > ringArea(best)) best = ring;
  }
  return best ? ensureCCW(best) : null;
}

export async function fetchParcel(lonLat: Pt, crs: Crs): Promise<{ ring: Ring; pin?: string; source: string }> {
  const bases = ['https://imagery.pasda.psu.edu/ArcGIS/rest/services/PA_Parcels/MapServer/1', 'https://services.pasda.psu.edu/server/rest/services/PA_Parcels/MapServer/1'];
  let lastErr: Error | null = null;
  for (const base of bases) {
    try {
      const q = new URLSearchParams({
        geometry: `${lonLat[0]},${lonLat[1]}`,
        geometryType: 'esriGeometryPoint',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: '*',
        outSR: String(crs.epsg),
        f: 'geojson',
      });
      const u = `${base}/query?${q}`;
      const j = await getJson(u);
      const feat = j?.features?.[0];
      const ring = largestRing(feat?.geometry);
      if (!ring) throw new Error('no parcel polygon at the geocoded point');
      return { ring, pin: feat.properties?.PIN ?? feat.properties?.pin, source: u };
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw lastErr ?? new Error('parcel fetch failed');
}

function lonLatBBox(b: BBox, crs: Crs): { s: number; w: number; n: number; e: number } {
  const c = [toLonLat(crs, [b.minX, b.minY]), toLonLat(crs, [b.maxX, b.maxY]), toLonLat(crs, [b.minX, b.maxY]), toLonLat(crs, [b.maxX, b.minY])];
  return { s: Math.min(...c.map((p) => p[1])), w: Math.min(...c.map((p) => p[0])), n: Math.max(...c.map((p) => p[1])), e: Math.max(...c.map((p) => p[0])) };
}

export async function fetchOsm(b: BBox, crs: Crs, parcel: Ring): Promise<{ roads: Road[]; asBuilt: AsBuilt[]; source: string }> {
  const ll = lonLatBBox(b, crs);
  const query = `[out:json][timeout:20];(way["highway"](${ll.s},${ll.w},${ll.n},${ll.e});way["building"](${ll.s},${ll.w},${ll.n},${ll.e}););out geom;`;
  const u = 'https://overpass-api.de/api/interpreter';
  const j = await getJson(u, { method: 'POST', body: `data=${encodeURIComponent(query)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const drivable = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service']);
  const byName = new Map<string, { name: string; ref?: string; hw: string; lines: Pt[][] }>();
  const asBuilt: AsBuilt[] = [];
  for (const el of j.elements ?? []) {
    if (el.type !== 'way' || !el.geometry) continue;
    const pts: Pt[] = el.geometry.map((g: any) => fromLonLat(crs, [g.lon, g.lat]));
    if (el.tags?.building) {
      const ring = ensureCCW(pts.slice(0, -1));
      if (ring.length >= 3 && pointInRing(ringCentroid(ring), parcel) && ringArea(ring) > 20000)
        asBuilt.push({ id: `asbuilt-${el.id}`, name: `As-built building (${Math.round(ringArea(ring)).toLocaleString()} SF, OSM)`, kind: 'building', ring, note: '© OpenStreetMap contributors (ODbL)' });
      continue;
    }
    const hw = el.tags?.highway;
    if (!hw || !drivable.has(hw)) continue;
    const ref: string | undefined = el.tags.ref;
    const name: string = el.tags.name ?? (ref ? `Route ${ref.replace(/\D+/g, '')}` : '');
    if (!name) continue; // unnamed service roads are not frontage candidates
    const key = name.toLowerCase();
    const cur = byName.get(key) ?? { name, ref, hw, lines: [] as Pt[][] };
    cur.lines.push(pts);
    byName.set(key, cur);
  }
  const roads: Road[] = [];
  for (const [key, r] of byName) {
    // Chain ways end-to-end where they touch; anything left over becomes its own road entry.
    const lines = r.lines.map((l) => l.slice());
    let merged = true;
    while (merged && lines.length > 1) {
      merged = false;
      outer: for (let a = 0; a < lines.length; a++) {
        for (let c = 0; c < lines.length; c++) {
          if (a === c) continue;
          const A = lines[a];
          const C = lines[c];
          const near = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 3;
          let joined: Pt[] | null = null;
          if (near(A[A.length - 1], C[0])) joined = [...A, ...C.slice(1)];
          else if (near(A[A.length - 1], C[C.length - 1])) joined = [...A, ...C.slice(0, -1).reverse()];
          else if (near(A[0], C[C.length - 1])) joined = [...C, ...A.slice(1)];
          else if (near(A[0], C[0])) joined = [...C.slice().reverse(), ...A.slice(1)];
          if (joined) {
            lines.splice(Math.max(a, c), 1);
            lines.splice(Math.min(a, c), 1);
            lines.push(joined);
            merged = true;
            break outer;
          }
        }
      }
    }
    const roadClass: Road['roadClass'] = r.ref || ['motorway', 'trunk', 'primary', 'secondary'].includes(r.hw) ? 'state' : r.hw === 'service' ? 'private' : 'local';
    lines.forEach((centerline, i) =>
      roads.push({ id: `road-${key.replace(/[^a-z0-9]+/g, '-')}${i ? `-${i + 1}` : ''}`, name: r.name, ref: r.ref, roadClass, centerline, rowWidthFt: ROW_DEFAULT_FT[roadClass], rowAssumed: true }),
    );
  }
  return { roads, asBuilt, source: u };
}

export async function fetchDem(b: BBox, crs: Crs): Promise<{ dem: Grid; source: string }> {
  const { fromArrayBuffer } = await import('geotiff');
  const nx = Math.min(4000, Math.round((b.maxX - b.minX) / FTUS_PER_M)); // ~1 m pixels
  const cellFt = (b.maxX - b.minX) / nx;
  const ny = Math.min(4000, Math.round((b.maxY - b.minY) / cellFt));
  const maxY = b.minY + ny * cellFt;
  const q = new URLSearchParams({
    bbox: `${b.minX},${b.minY},${b.maxX},${maxY}`,
    bboxSR: String(crs.epsg),
    imageSR: String(crs.epsg),
    size: `${nx},${ny}`,
    format: 'tiff',
    pixelType: 'F32',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  });
  const u = `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?${q}`;
  const buf = await (await get(u)).arrayBuffer();
  const tiff = await fromArrayBuffer(buf);
  const img = await tiff.getImage();
  const raster = (await img.readRasters({ interleave: true })) as unknown as Float32Array;
  const w = img.getWidth();
  const h = img.getHeight();
  if (w !== nx || h !== ny) throw new Error(`unexpected DEM size ${w}×${h} (asked ${nx}×${ny})`);
  const data = new Float32Array(nx * ny);
  // GeoTIFF rows run north→south; our grid rows run south→north. Convert meters → ftUS here, once.
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) data[j * nx + i] = raster[(ny - 1 - j) * nx + i] * FTUS_PER_M;
  return { dem: { x0: b.minX, y0: b.minY, cellFt, nx, ny, data }, source: u };
}

async function arcgisPolygons(base: string, b: BBox, crs: Crs, where = '1=1'): Promise<{ rings: { ring: Ring; props: any }[]; source: string }> {
  const q = new URLSearchParams({
    where,
    geometry: `${b.minX},${b.minY},${b.maxX},${b.maxY}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: String(crs.epsg),
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    outSR: String(crs.epsg),
    f: 'geojson',
  });
  const u = `${base}/query?${q}`;
  const j = await getJson(u);
  const rings: { ring: Ring; props: any }[] = [];
  for (const f of j.features ?? []) {
    const ring = largestRing(f.geometry);
    if (ring) rings.push({ ring, props: f.properties ?? {} });
  }
  return { rings, source: u };
}

export async function fetchWetlands(b: BBox, crs: Crs): Promise<{ constraints: Constraint[]; source: string }> {
  const r = await arcgisPolygons('https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0', b, crs);
  return {
    source: r.source,
    constraints: r.rings.map((x, i) => ({
      id: `wetland-${i + 1}`,
      kind: 'wetland' as const,
      name: `Wetland (${x.props.WETLAND_TYPE ?? x.props.ATTRIBUTE ?? 'NWI'}) ${(ringArea(x.ring) / 43560).toFixed(1)} ac`,
      ring: x.ring,
      bufferFt: 25,
      informational: false,
      source: 'USFWS National Wetlands Inventory; 25 ft no-disturb buffer is an EFCG assumption',
    })),
  };
}
export async function fetchFloodplain(b: BBox, crs: Crs): Promise<{ constraints: Constraint[]; source: string }> {
  const r = await arcgisPolygons('https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28', b, crs, "SFHA_TF='T'");
  return {
    source: r.source,
    constraints: r.rings.map((x, i) => ({
      id: `flood-${i + 1}`,
      kind: 'floodplain' as const,
      name: `Flood hazard zone ${x.props.FLD_ZONE ?? ''}`.trim(),
      ring: x.ring,
      bufferFt: 0,
      informational: false,
      source: 'FEMA National Flood Hazard Layer',
    })),
  };
}

/** Cache Web Mercator imagery tiles (z15–z18) covering the bbox. Returns the tile count. */
export async function fetchImagery(b: BBox, crs: Crs, dir: string, maxTiles = 400): Promise<{ count: number; minZoom: number; maxZoom: number; source: string }> {
  const ll = lonLatBBox(b, crs);
  const base = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile';
  const x = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const y = (lat: number, z: number) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
  const tiles: { z: number; x: number; y: number }[] = [];
  let maxZoom = 15;
  for (let z = 15; z <= 18; z++) {
    const list: typeof tiles = [];
    for (let tx = x(ll.w, z); tx <= x(ll.e, z); tx++) for (let ty = y(ll.n, z); ty <= y(ll.s, z); ty++) list.push({ z, x: tx, y: ty });
    if (tiles.length + list.length > maxTiles) break;
    tiles.push(...list);
    maxZoom = z;
  }
  let count = 0;
  for (const t of tiles) {
    const file = path.join(dir, 'imagery', String(t.z), String(t.x), `${t.y}.jpg`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const res = await get(`${base}/${t.z}/${t.y}/${t.x}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    count++;
  }
  fs.writeFileSync(path.join(dir, 'imagery', 'manifest.json'), JSON.stringify({ tiles }));
  return { count, minZoom: 15, maxZoom, source: `${base}/{z}/{y}/{x}` };
}

/**
 * Approximate district polygons from the 2020 Planning Commission minutes, positioned around the
 * real parcel: residential N and W, agricultural S, commercial E (across Route 72).
 * The township zoning map is a PDF and is not digitized automatically; these are flagged approximate.
 */
export function districtsFromMinutes(parcel: Ring): District[] {
  const b = bboxOf(parcel);
  const f = 1500;
  const off = 28; // ~ half a right-of-way: boundaries are assumed at street centerlines
  const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  return [
    { id: 'dist-i1', code: 'I-1', name: 'Industrial', kind: 'industrial', ring: rect(b.minX - off, b.minY, b.maxX + off, b.maxY + off) },
    { id: 'dist-res-n', code: 'RES', name: 'Residential (north)', kind: 'residential', ring: rect(b.minX - f, b.maxY + off, b.maxX + f, b.maxY + f) },
    { id: 'dist-res-w', code: 'RES', name: 'Residential (west)', kind: 'residential', ring: rect(b.minX - f, b.minY - f, b.minX - off, b.maxY + off) },
    { id: 'dist-ag-s', code: 'AG', name: 'Agricultural', kind: 'agricultural', ring: rect(b.minX - off, b.minY - f, b.maxX + off, b.minY) },
    { id: 'dist-com-e', code: 'COM', name: 'Commercial', kind: 'commercial', ring: rect(b.maxX + off, b.minY - f, b.maxX + f, b.maxY + off) },
  ];
}

export type FetchOutcome = { fixture: SiteFixture; dem: Grid; reports: LayerReport[] } | { fixture: null; dem: null; reports: LayerReport[] };

/**
 * Try every live source once. The parcel anchors everything: if geocoding or the parcel fails,
 * nothing is replaced (a real DEM under a synthetic parcel would be misleading).
 */
export async function fetchLiveSite(opts: { id: string; address: string; name: string; jurisdiction: string; districtCode: string; addressRoadName: string; dir: string; fallback: { fixture: SiteFixture; dem: Grid } }): Promise<FetchOutcome> {
  const crs = EPSG_2272;
  const now = new Date().toISOString();
  const reports: LayerReport[] = [];
  const provenance: Provenance[] = [];
  const ok = (layer: string, source: string, detail: string, license: string, notes = '') => {
    reports.push({ layer, source, ok: true, detail });
    provenance.push({ layer, sourceUrl: source, fetchedAt: now, license, notes: notes || detail, synthetic: false });
  };
  const fail = (layer: string, source: string, err: unknown, fallbackNote: string) => {
    reports.push({ layer, source, ok: false, detail: `${(err as Error).message}; ${fallbackNote}` });
    provenance.push({ layer, sourceUrl: source, fetchedAt: now, license: 'n/a', notes: `FAILED (${(err as Error).message}); ${fallbackNote}`, synthetic: true });
  };

  let lonLat: Pt;
  let parcel: Ring;
  let pin: string | undefined;
  try {
    const g = await geocode(opts.address);
    lonLat = g.lonLat;
    ok('geocode', g.source, `lon ${lonLat[0].toFixed(5)}, lat ${lonLat[1].toFixed(5)}`, 'US Census Bureau / OSM Nominatim');
    const p = await fetchParcel(lonLat, crs);
    parcel = p.ring;
    pin = p.pin;
    ok('parcel', p.source, `${(ringArea(parcel) / 43560).toFixed(1)} ac, PIN ${pin ?? 'n/a'}`, 'PASDA / county parcel data (public)');
  } catch (err) {
    fail('parcel', 'census geocoder + PASDA PA_Parcels', err, 'kept the existing fixture (nothing replaced)');
    return { fixture: null, dem: null, reports };
  }

  const area = expandBBox(bboxOf(parcel), 1000);
  let roads: Road[] = [];
  let asBuilt: AsBuilt[] = [];
  try {
    const o = await fetchOsm(area, crs, parcel);
    roads = o.roads;
    asBuilt = o.asBuilt;
    ok('roads', o.source, `${roads.length} named road segments, ${asBuilt.length} as-built building(s); ROW widths are class defaults`, '© OpenStreetMap contributors (ODbL)');
  } catch (err) {
    fail('roads', 'https://overpass-api.de/api/interpreter', err, 'no roads: frontages cannot be classified; digitize roads manually');
  }

  let dem: Grid;
  let terrain: SiteFixture['terrain'];
  try {
    const d = await fetchDem(area, crs);
    dem = d.dem;
    let pre = true;
    let note = `3DEP mosaic, ~${dem.cellFt.toFixed(2)} ft cells, meters converted to ftUS`;
    const bld = asBuilt[0];
    if (bld) {
      const st = terrainStats(dem, [bld.ring]);
      if (st.stdElevFt < 0.5) {
        pre = false;
        note += `. WARNING: std-dev under the as-built footprint is ${st.stdElevFt.toFixed(2)} ft (< 0.5 ft): this DEM post-dates construction. Use a pre-2020 collection (PAMAP 2006–2008 or USGS PA South Central 2017/2018 QL2) and re-run.`;
      } else note += `. Std-dev under the as-built footprint ${st.stdElevFt.toFixed(2)} ft: reads as pre-development ground.`;
    }
    terrain = { x0: dem.x0, y0: dem.y0, cellFt: dem.cellFt, nx: dem.nx, ny: dem.ny, source: 'USGS 3DEP elevation ImageServer', synthetic: false, preDevelopment: pre, verticalDatum: 'NAVD88', file: 'dem.f32' };
    ok('terrain', d.source, note, 'USGS 3DEP (public domain)', note);
  } catch (err) {
    fail('terrain', 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer', err, 'kept the existing fixture (a synthetic DEM under a real parcel would mislead)');
    return { fixture: null, dem: null, reports };
  }

  const constraints: Constraint[] = [];
  try {
    const w = await fetchWetlands(area, crs);
    constraints.push(...w.constraints);
    ok('wetlands', w.source, `${w.constraints.length} polygon(s)`, 'USFWS NWI (public domain)');
  } catch (err) {
    fail('wetlands', 'USFWS NWI REST', err, 'no wetland layer: add the ~5 ac south-side wetland manually with add_constraint');
  }
  try {
    const f = await fetchFloodplain(area, crs);
    constraints.push(...f.constraints);
    ok('floodplain', f.source, `${f.constraints.length} polygon(s)`, 'FEMA NFHL (public domain)');
  } catch (err) {
    fail('floodplain', 'FEMA NFHL REST', err, 'no floodplain layer');
  }

  let imagery: SiteFixture['imagery'] = { available: false, attribution: '' };
  try {
    const im = await fetchImagery(expandBBox(bboxOf(parcel), 300), crs, opts.dir);
    imagery = { available: im.count > 0, tileUrl: '/api/site/assets/imagery/{z}/{x}/{y}.jpg', minZoom: im.minZoom, maxZoom: im.maxZoom, attribution: 'USGS National Map imagery (public domain)' };
    ok('imagery', im.source, `${im.count} tiles z${im.minZoom}–z${im.maxZoom}`, 'USGS (public domain)');
  } catch (err) {
    fail('imagery', 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer', err, 'no imagery (plain background)');
  }

  const districts = districtsFromMinutes(parcel);
  provenance.push({
    layer: 'districts',
    sourceUrl: 'https://northlebanontwppa.gov/wp-content/uploads/2021/12/2020-08-PC-Minutes.pdf',
    fetchedAt: now,
    license: 'n/a',
    notes: 'Approximate rectangles placed around the parcel from the 2020 minutes (residential N/W, agricultural S, commercial E). NOT digitized from the 2023 zoning map; verify.',
    synthetic: true,
  });

  const fixture: SiteFixture = {
    ...opts.fallback.fixture,
    id: opts.id,
    name: opts.name,
    address: opts.address,
    jurisdiction: opts.jurisdiction,
    crs,
    synthetic: false,
    parcel: { id: pin ?? 'parcel-1', pin, ring: parcel, recordAreaAc: 110 },
    zoningDistrictCode: opts.districtCode,
    addressRoadName: opts.addressRoadName,
    roads,
    districts,
    constraints,
    asBuilt,
    terrain,
    imagery,
    provenance,
  };
  return { fixture, dem, reports };
}
