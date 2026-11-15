/**
 * Live data adapters (SPEC §6). Node-only, used ONLY by scripts/fetch-site-data.ts; the app itself
 * reads the cached fixture and never touches the network.
 *
 * Each source is tried once with a timeout; a failure is reported and the documented fallback is
 * used. Everything is requested in (or converted to) the site CRS, EPSG:2272 ftUS, so the parcel,
 * aerials, terrain and wetlands register with each other without any client-side warping.
 *
 * Verified against the live services on 2026-11-15 for 1625 Heilmandale Rd (see PROGRESS.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  type AsBuilt,
  type BBox,
  type Constraint,
  type Crs,
  type District,
  type DistrictKind,
  EPSG_2272,
  FTUS_PER_M,
  type Grid,
  type ImagerySet,
  type Provenance,
  type Pt,
  ROW_DEFAULT_FT,
  type Region,
  type Ring,
  type Road,
  type SiteFixture,
  bboxOf,
  difference,
  ensureCCW,
  expandBBox,
  fromLonLat,
  intersect,
  offsetRegion,
  outerRings,
  pointInRing,
  polylineLength,
  ringArea,
  ringCentroid,
  simplifyPolyline,
  terrainStats,
  toLonLat,
} from '@groundwork/core';

const UA = 'groundwork-demo/0.2 (site-data fetch script)';
const TIMEOUT_MS = 45_000;

export type LayerReport = { layer: string; source: string; ok: boolean; detail: string };

async function get(url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { 'user-agent': UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res;
}
async function getJson(url: string, init?: RequestInit, timeoutMs?: number): Promise<any> {
  const j = await (await get(url, init, timeoutMs)).json();
  if (j?.error) throw new Error(`service error ${j.error.code ?? ''}: ${j.error.message ?? JSON.stringify(j.error)}`);
  return j;
}
const qs = (o: Record<string, string | number>): string => new URLSearchParams(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]))).toString();
const bboxStr = (b: BBox): string => `${b.minX},${b.minY},${b.maxX},${b.maxY}`;

// ---- geocoding --------------------------------------------------------------------------------

export async function geocode(address: string): Promise<{ lonLat: Pt; matched: string; source: string }> {
  const u = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${qs({ address, benchmark: 'Public_AR_Current', format: 'json' })}`;
  const j = await getJson(u);
  const m = j?.result?.addressMatches?.[0];
  if (!m) throw new Error('no address match');
  return { lonLat: [m.coordinates.x, m.coordinates.y], matched: m.matchedAddress, source: u };
}

// ---- geometry helpers -------------------------------------------------------------------------

function geojsonRings(geom: any): Ring[] {
  if (!geom) return [];
  const polys: number[][][][] = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  const out: Ring[] = [];
  for (const poly of polys) {
    const outer = poly[0]?.map((c) => [c[0], c[1]] as Pt);
    if (outer && outer.length >= 4) out.push(ensureCCW(outer.slice(0, -1))); // GeoJSON repeats the first vertex
  }
  return out;
}
function largestRing(geom: any): Ring | null {
  let best: Ring | null = null;
  for (const r of geojsonRings(geom)) if (!best || ringArea(r) > ringArea(best)) best = r;
  return best;
}

/** Douglas–Peucker on a closed ring (split at the vertex farthest from vertex 0 so both halves are open lines). */
export function simplifyRing(ring: Ring, tolFt: number): Ring {
  if (ring.length < 5) return ring;
  let k = 0;
  let far = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > far) {
      far = d;
      k = i;
    }
  }
  const a = simplifyPolyline(ring.slice(0, k + 1), tolFt);
  const b = simplifyPolyline([...ring.slice(k), ring[0]], tolFt);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

const rectRing = (b: BBox): Ring => [
  [b.minX, b.minY],
  [b.maxX, b.minY],
  [b.maxX, b.maxY],
  [b.minX, b.maxY],
];
const inBBox = (p: Pt, b: BBox): boolean => p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minY && p[1] <= b.maxY;

/** Keep the parts of a polyline inside a box (cut at the box edge by bisection; good to ~1 ft). */
export function clipLineToBBox(line: Pt[], b: BBox): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  const cut = (inside: Pt, outside: Pt): Pt => {
    let lo = inside;
    let hi = outside;
    for (let i = 0; i < 24; i++) {
      const mid: Pt = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
      if (inBBox(mid, b)) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const inside = inBBox(p, b);
    if (i > 0) {
      const q = line[i - 1];
      const qin = inBBox(q, b);
      if (inside && !qin) cur.push(cut(p, q));
      if (!inside && qin) {
        cur.push(cut(q, p));
        if (cur.length >= 2) out.push(cur);
        cur = [];
      }
    }
    if (inside) cur.push(p);
  }
  if (cur.length >= 2) out.push(cur);
  return out;
}

/** Chain polylines that touch end to end (within tolFt). */
export function chainLines(input: Pt[][], tolFt = 3): Pt[][] {
  const lines = input.map((l) => l.slice());
  const near = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) < tolFt;
  let merged = true;
  while (merged && lines.length > 1) {
    merged = false;
    outer: for (let a = 0; a < lines.length; a++) {
      for (let c = 0; c < lines.length; c++) {
        if (a === c) continue;
        const A = lines[a];
        const C = lines[c];
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
  return lines;
}

function lonLatBBox(b: BBox, crs: Crs): { s: number; w: number; n: number; e: number } {
  const c = [toLonLat(crs, [b.minX, b.minY]), toLonLat(crs, [b.maxX, b.maxY]), toLonLat(crs, [b.minX, b.maxY]), toLonLat(crs, [b.maxX, b.minY])];
  return { s: Math.min(...c.map((p) => p[1])), w: Math.min(...c.map((p) => p[0])), n: Math.max(...c.map((p) => p[1])), e: Math.max(...c.map((p) => p[0])) };
}

async function arcgisFeatures(base: string, params: Record<string, string | number>): Promise<{ features: any[]; source: string }> {
  const u = `${base}/query?${qs({ outFields: '*', f: 'geojson', ...params })}`;
  const j = await getJson(u);
  return { features: j.features ?? [], source: u };
}
const envelopeQuery = (b: BBox, crs: Crs) => ({ geometry: bboxStr(b), geometryType: 'esriGeometryEnvelope', inSR: crs.epsg, spatialRel: 'esriSpatialRelIntersects', outSR: crs.epsg, where: '1=1' });

// ---- parcel -----------------------------------------------------------------------------------

/** Lebanon County, PA tax parcels (county GIS, ArcGIS Online). A 2017 snapshot: the pre-development tract. */
const LEBANON_PARCELS = 'https://services1.arcgis.com/9TQ9L457YNtHSPdi/arcgis/rest/services/LebCoTaxParcels/FeatureServer/0';
/** PASDA statewide parcel layer (does not cover every county). */
const PASDA_PARCELS = 'https://imagery.pasda.psu.edu/arcgis/rest/services/PA_Parcels/MapServer/1';

/** "1625 Heilmandale Rd, Lebanon, PA 17046" → "1625 HEILMANDALE RD" (county situs format). */
export function situsKey(address: string): string {
  return address
    .split(',')[0]
    .toUpperCase()
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bLANE\b/g, 'LN')
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type ParcelResult = { ring: Ring; rawVertexCount: number; pin?: string; deededAc?: number; source: string; note: string };

export async function fetchParcel(address: string, lonLat: Pt, crs: Crs): Promise<ParcelResult> {
  const errors: string[] = [];
  const finish = (ring: Ring, pin: string | undefined, deededAc: number | undefined, source: string, note: string): ParcelResult => {
    // County linework is densified along curves (hundreds of sub-5 ft chords); 1 ft tolerance keeps the shape.
    const simple = ensureCCW(simplifyRing(ring, 1));
    return { ring: simple, rawVertexCount: ring.length, pin, deededAc, source, note };
  };
  // Owner names and mailing addresses are deliberately not requested.
  const fields = 'MAP_NUMBER,SITUS_ADDR,DEEDED_ACR';
  try {
    const r = await arcgisFeatures(LEBANON_PARCELS, { where: `SITUS_ADDR='${situsKey(address).replace(/'/g, "''")}'`, outFields: fields, outSR: crs.epsg });
    const ring = largestRing(r.features[0]?.geometry);
    if (!ring) throw new Error(`no parcel with situs address "${situsKey(address)}"`);
    const p = r.features[0].properties ?? {};
    return finish(ring, p.MAP_NUMBER, p.DEEDED_ACR, r.source, 'Lebanon County tax parcel matched by situs address (county GIS snapshot dated 2017: the tract before development)');
  } catch (err) {
    errors.push(`county, by address: ${(err as Error).message}`);
  }
  try {
    const r = await arcgisFeatures(LEBANON_PARCELS, { geometry: `${lonLat[0]},${lonLat[1]}`, geometryType: 'esriGeometryPoint', inSR: 4326, spatialRel: 'esriSpatialRelIntersects', outFields: fields, outSR: crs.epsg });
    const ring = largestRing(r.features[0]?.geometry);
    if (!ring) throw new Error('no parcel at the geocoded point');
    const p = r.features[0].properties ?? {};
    return finish(ring, p.MAP_NUMBER, p.DEEDED_ACR, r.source, 'Lebanon County tax parcel at the geocoded point (the geocode is interpolated along the street: confirm it is the right lot)');
  } catch (err) {
    errors.push(`county, by point: ${(err as Error).message}`);
  }
  try {
    const r = await arcgisFeatures(PASDA_PARCELS, { geometry: `${lonLat[0]},${lonLat[1]}`, geometryType: 'esriGeometryPoint', inSR: 4326, spatialRel: 'esriSpatialRelIntersects', outSR: crs.epsg });
    const ring = largestRing(r.features[0]?.geometry);
    if (!ring) throw new Error('no parcel at the geocoded point');
    return finish(ring, r.features[0].properties?.PIN, undefined, r.source, 'PASDA statewide parcel at the geocoded point');
  } catch (err) {
    errors.push(`PASDA statewide: ${(err as Error).message}`);
  }
  throw new Error(`parcel not found (${errors.join('; ')})`);
}

/** Neighbouring lot lines for context. Geometry only: no owner attributes are requested. */
export async function fetchNeighbors(b: BBox, crs: Crs, sitePin?: string): Promise<{ rings: Ring[]; source: string }> {
  const r = await arcgisFeatures(LEBANON_PARCELS, { ...envelopeQuery(b, crs), outFields: 'MAP_NUMBER', maxAllowableOffset: 2 });
  const rings: Ring[] = [];
  for (const f of r.features) {
    if (sitePin && f.properties?.MAP_NUMBER === sitePin) continue;
    for (const ring of geojsonRings(f.geometry)) if (ring.length >= 3 && ringArea(ring) > 500) rings.push(simplifyRing(ring, 2));
  }
  return { rings, source: r.source };
}

// ---- roads ------------------------------------------------------------------------------------

const titleCase = (s: string): string => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const roadId = (name: string, i: number): string => `road-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}${i ? `-${i + 1}` : ''}`;

type RawRoad = { name: string; ref?: string; roadClass: Road['roadClass']; lines: Pt[][] };

function buildRoads(raw: Map<string, RawRoad>, b: BBox): Road[] {
  const roads: Road[] = [];
  for (const r of raw.values()) {
    const pieces = chainLines(r.lines)
      .flatMap((l) => clipLineToBBox(l, b))
      .map((l) => simplifyPolyline(l, 0.5))
      .filter((l) => polylineLength(l) > 40)
      .sort((x, y) => polylineLength(y) - polylineLength(x));
    pieces.forEach((centerline, i) => roads.push({ id: roadId(r.name, i), name: r.name, ref: r.ref, roadClass: r.roadClass, centerline, rowWidthFt: ROW_DEFAULT_FT[r.roadClass], rowAssumed: true }));
  }
  return roads;
}

/** OpenStreetMap via Overpass: named drivable ways plus large building footprints inside the parcel. */
export async function fetchOsm(b: BBox, crs: Crs, parcel: Ring): Promise<{ roads: Road[]; asBuilt: AsBuilt[]; source: string }> {
  const ll = lonLatBBox(b, crs);
  const query = `[out:json][timeout:25];(way["highway"](${ll.s},${ll.w},${ll.n},${ll.e});way["building"](${ll.s},${ll.w},${ll.n},${ll.e}););out geom;`;
  const u = 'https://overpass-api.de/api/interpreter';
  const j = await getJson(u, { method: 'POST', body: `data=${encodeURIComponent(query)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } }, 30_000);
  const drivable = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service']);
  const raw = new Map<string, RawRoad>();
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
    const roadClass: Road['roadClass'] = ref || ['motorway', 'trunk', 'primary', 'secondary'].includes(hw) ? 'state' : hw === 'service' ? 'private' : 'local';
    const cur = raw.get(key) ?? { name, ref, roadClass, lines: [] as Pt[][] };
    cur.lines.push(pts);
    raw.set(key, cur);
  }
  return { roads: buildRoads(raw, b), asBuilt, source: u };
}

/** Lebanon County road centerlines (county GIS). RD_NAME is upper case; ST_RT_NO is the PennDOT state route. */
const LEBANON_ROADS = 'https://services1.arcgis.com/9TQ9L457YNtHSPdi/arcgis/rest/services/Roads_0620/FeatureServer/0';

/** "STATE ROUTE 72  N" → Route 72 (ref 72); "HEILMANDALE RD" with ST_RT_NO 4006 → Heilmandale Rd (ref SR 4006). */
export function countyRoadName(rdName: string, stRtNo: string): { name: string; ref?: string } {
  const sr = stRtNo.trim().replace(/^0+/, '');
  const m = rdName.match(/^\s*STATE ROUTE\s+0*(\d+)/i);
  if (m) return { name: `Route ${m[1]}`, ref: m[1] };
  const name = titleCase(rdName.replace(/\s+/g, ' ').trim());
  return sr ? { name, ref: `SR ${sr}` } : { name };
}

export async function fetchCountyRoads(b: BBox, crs: Crs): Promise<{ roads: Road[]; source: string }> {
  const r = await arcgisFeatures(LEBANON_ROADS, { ...envelopeQuery(b, crs), outFields: 'RD_NAME,ST_RT_NO' });
  const raw = new Map<string, RawRoad>();
  for (const f of r.features) {
    const rd = String(f.properties?.RD_NAME ?? '').trim();
    if (!rd) continue;
    const { name, ref } = countyRoadName(rd, String(f.properties?.ST_RT_NO ?? ''));
    const g = f.geometry;
    const lines: number[][][] = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : [];
    // A numbered PennDOT route is a state road; everything else is treated as a local street.
    const cur = raw.get(name.toLowerCase()) ?? { name, ref, roadClass: ref ? 'state' : 'local', lines: [] as Pt[][] };
    if (ref && !cur.ref) {
      cur.ref = ref;
      cur.roadClass = 'state';
    }
    for (const l of lines) cur.lines.push(l.map((c) => [c[0], c[1]] as Pt));
    raw.set(name.toLowerCase(), cur);
  }
  const roads = buildRoads(raw, b);
  if (!roads.length) throw new Error('no road centerlines in the area');
  return { roads, source: r.source };
}

// ---- terrain ----------------------------------------------------------------------------------

/** USGS 3DEP bare-earth elevation, resampled by the service to `cellFt` cells in the site CRS. */
export async function fetchDem(b: BBox, crs: Crs, cellFt = 5): Promise<{ dem: Grid; source: string }> {
  const { fromArrayBuffer } = await import('geotiff');
  const nx = Math.round((b.maxX - b.minX) / cellFt);
  const ny = Math.round((b.maxY - b.minY) / cellFt);
  if (nx > 4000 || ny > 4000) throw new Error(`DEM request too large (${nx} × ${ny} cells)`);
  const box: BBox = { minX: b.minX, minY: b.minY, maxX: b.minX + nx * cellFt, maxY: b.minY + ny * cellFt };
  const u = `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?${qs({
    bbox: bboxStr(box),
    bboxSR: crs.epsg,
    imageSR: crs.epsg,
    size: `${nx},${ny}`,
    format: 'tiff',
    pixelType: 'F32',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  })}`;
  const buf = await (await get(u, {}, 90_000)).arrayBuffer();
  const tiff = await fromArrayBuffer(buf);
  const img = await tiff.getImage();
  const raster = (await img.readRasters({ interleave: true })) as unknown as Float32Array;
  const w = img.getWidth();
  const h = img.getHeight();
  if (w !== nx || h !== ny) throw new Error(`unexpected DEM size ${w}×${h} (asked ${nx}×${ny})`);
  const data = new Float32Array(nx * ny);
  let bad = 0;
  // GeoTIFF rows run north→south; our grid rows run south→north. Convert meters → ftUS here, once.
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const m = raster[(ny - 1 - j) * nx + i];
      if (!Number.isFinite(m) || m < -500 || m > 9000) bad++;
      data[j * nx + i] = m * FTUS_PER_M;
    }
  if (bad > 0) throw new Error(`${bad} no-data cells in the DEM`);
  return { dem: { x0: box.minX, y0: box.minY, cellFt, nx, ny, data }, source: u };
}

// ---- constraints ------------------------------------------------------------------------------

export async function fetchWetlands(b: BBox, crs: Crs): Promise<{ constraints: Constraint[]; source: string }> {
  const r = await arcgisFeatures('https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0', { ...envelopeQuery(b, crs), outFields: 'ATTRIBUTE,WETLAND_TYPE' });
  const constraints: Constraint[] = [];
  const seen = new Set<string>();
  for (const f of r.features) {
    for (const ring of geojsonRings(f.geometry)) {
      const c = ringCentroid(ring);
      const key = `${Math.round(c[0] / 5)}:${Math.round(c[1] / 5)}:${Math.round(ringArea(ring) / 100)}`;
      if (seen.has(key) || ringArea(ring) < 200) continue; // the service returns some polygons twice
      seen.add(key);
      const p = f.properties ?? {};
      constraints.push({
        id: `wetland-${constraints.length + 1}`,
        kind: 'wetland',
        name: `${p.WETLAND_TYPE ?? 'Wetland'} (NWI ${p.ATTRIBUTE ?? 'n/a'}), ${(ringArea(ring) / 43560).toFixed(1)} ac`,
        ring: simplifyRing(ring, 1),
        bufferFt: 25,
        informational: false,
        source: 'USFWS National Wetlands Inventory (planning-level mapping, not a delineation); 25 ft no-disturb buffer is an EFCG assumption',
      });
    }
  }
  return { constraints, source: r.source };
}

export async function fetchFloodplain(b: BBox, crs: Crs): Promise<{ constraints: Constraint[]; source: string }> {
  const r = await arcgisFeatures('https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28', { ...envelopeQuery(b, crs), where: "SFHA_TF='T'", outFields: 'FLD_ZONE' });
  const constraints: Constraint[] = [];
  for (const f of r.features)
    for (const ring of geojsonRings(f.geometry))
      constraints.push({
        id: `flood-${constraints.length + 1}`,
        kind: 'floodplain',
        name: `Flood hazard zone ${f.properties?.FLD_ZONE ?? ''}`.trim(),
        ring: simplifyRing(ring, 1),
        bufferFt: 0,
        informational: false,
        source: 'FEMA National Flood Hazard Layer',
      });
  return { constraints, source: r.source };
}

// ---- imagery ----------------------------------------------------------------------------------

export type ImagerySource = {
  id: string;
  label: string;
  attribution: string;
  license: string;
  /** ArcGIS MapServer (…/export) or ImageServer (…/exportImage) base URL. */
  base: string;
  kind: 'map' | 'image';
  ftPerPx: number;
};

/** Public-domain aerials that can be exported straight into the site CRS. */
export const PA_IMAGERY: ImagerySource[] = [
  {
    id: 'pema2018',
    label: 'Aerial 2018–2020 (PEMA)',
    attribution: 'PEMA orthoimagery, 2018–2020 collection, via PASDA (public domain)',
    license: 'Pennsylvania Emergency Management Agency / PASDA (public)',
    base: 'https://imagery.pasda.psu.edu/arcgis/rest/services/PEMAImagery2018_2020/MapServer',
    kind: 'map',
    ftPerPx: 1,
  },
  {
    id: 'naip',
    label: 'Aerial, latest (USGS NAIP)',
    attribution: 'USDA NAIP via the USGS National Map (public domain)',
    license: 'USDA / USGS (public domain)',
    base: 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer',
    kind: 'image',
    ftPerPx: 2,
  },
];

/**
 * Cache one aerial as JPEG chunks already in the site CRS (north up). The server reprojects, so
 * the client just draws each chunk into its world rectangle and it lines up with the parcel.
 */
export async function fetchImagerySet(src: ImagerySource, b: BBox, crs: Crs, dir: string, maxChunkPx = 2048): Promise<{ set: ImagerySet; bytes: number; source: string }> {
  const wPx = Math.ceil((b.maxX - b.minX) / src.ftPerPx);
  const hPx = Math.ceil((b.maxY - b.minY) / src.ftPerPx);
  const cols = Math.ceil(wPx / maxChunkPx);
  const rows = Math.ceil(hPx / maxChunkPx);
  const cw = Math.ceil(wPx / cols);
  const ch = Math.ceil(hPx / rows);
  const outDir = path.join(dir, 'imagery', src.id);
  fs.mkdirSync(outDir, { recursive: true });
  const chunks: ImagerySet['chunks'] = [];
  let bytes = 0;
  const op = src.kind === 'map' ? 'export' : 'exportImage';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const box: BBox = { minX: b.minX + c * cw * src.ftPerPx, minY: b.minY + r * ch * src.ftPerPx, maxX: b.minX + (c + 1) * cw * src.ftPerPx, maxY: b.minY + (r + 1) * ch * src.ftPerPx };
      const u = `${src.base}/${op}?${qs({ bbox: bboxStr(box), bboxSR: crs.epsg, imageSR: crs.epsg, size: `${cw},${ch}`, format: 'jpg', f: 'image' })}`;
      const res = await get(u, {}, 120_000);
      if (!(res.headers.get('content-type') ?? '').includes('image')) throw new Error(`expected an image, got ${res.headers.get('content-type')}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // A blank (no coverage) JPEG compresses to almost nothing.
      if (buf.byteLength / (cw * ch) < 0.05) throw new Error('blank image: no coverage here');
      const file = `imagery/${src.id}/r${r}c${c}.jpg`;
      fs.writeFileSync(path.join(dir, file), buf);
      bytes += buf.byteLength;
      chunks.push({ file, x0: box.minX, y0: box.minY, x1: box.maxX, y1: box.maxY, widthPx: cw, heightPx: ch });
    }
  }
  return { set: { id: src.id, label: src.label, attribution: src.attribution, ftPerPx: src.ftPerPx, chunks }, bytes, source: `${src.base}/${op}` };
}

// ---- zoning districts -------------------------------------------------------------------------

type DistrictFile = { source: string; sourceTitle: string; method: string; accuracyNote: string; districts: { code: string; name: string; kind: DistrictKind; ring: Ring }[] };

/** How far a digitized neighbouring district is stretched to meet the lot line it visibly abuts on the map, ft. */
const DISTRICT_SNAP_FT = 30;

/**
 * District polygons digitized from the township zoning map (data/sources/…), fitted to the parcel:
 * the lot itself becomes the site district exactly, and neighbouring districts are closed up to the
 * lot line so "abuts" / "across the street" tests do not fall into a digitizing sliver.
 */
export function districtsFromZoningFile(file: DistrictFile, parcel: Ring, area: BBox, siteCode: string): District[] {
  const box: Region = [rectRing(area)];
  const lot: Region = [parcel];
  const out: District[] = [{ id: 'dist-site', code: siteCode, name: 'Industrial (the site)', kind: 'industrial', ring: parcel }];
  const count = new Map<string, number>();
  const push = (d: DistrictFile['districts'][number], region: Region) => {
    for (const ring of outerRings(region)) {
      if (ringArea(ring) < 10_000) continue;
      const n = (count.get(d.code) ?? 0) + 1;
      count.set(d.code, n);
      out.push({ id: `dist-${d.code.toLowerCase()}-${n}`, code: d.code, name: d.name, kind: d.kind, ring: simplifyRing(ensureCCW(ring), 1) });
    }
  };
  for (const d of file.districts) {
    const ring = ensureCCW(d.ring);
    if (d.kind === 'industrial') {
      // Industrial land beyond the lot (other tracts, or a strip between the lot and a street). Slivers
      // thinner than ~24 ft hugging the lot line are digitizing noise: open them away.
      const beyond = difference([ring], lot);
      push(d, intersect(offsetRegion(offsetRegion(beyond, -12, 'miter'), 12, 'miter'), box));
    } else {
      push(d, intersect(difference(offsetRegion([ring], DISTRICT_SNAP_FT, 'miter'), lot), box));
    }
  }
  return out;
}

/**
 * Fallback when no digitized zoning map exists: rough rectangles from the 2020 Planning Commission
 * minutes (residential N and W, agricultural S, commercial E). Flagged approximate.
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

// ---- orchestration ----------------------------------------------------------------------------

export type FetchOptions = {
  id: string;
  address: string;
  name: string;
  jurisdiction: string;
  districtCode: string;
  addressRoadName: string;
  /** Fixture folder (imagery chunks are written here as they download). */
  dir: string;
  /** Context margin around the parcel for aerials, terrain, roads and neighbours, ft. */
  marginFt?: number;
  /** Digitized zoning-map file (see data/sources/). */
  zoningDistrictsFile?: string;
  /** Set when a person has checked that the terrain pre-dates construction (what was checked, and when). */
  terrainReviewNote?: string;
  /** Site-specific notes appended to a layer's provenance, e.g. { imagery: '…' }. */
  notes?: Record<string, string>;
  /** Skip the (large) aerial download. */
  skipImagery?: boolean;
};

export type FetchOutcome = { fixture: SiteFixture; dem: Grid; reports: LayerReport[] } | { fixture: null; dem: null; reports: LayerReport[] };

/**
 * Try every live source once. The parcel anchors everything: if geocoding, the parcel or the
 * terrain fails, nothing is written (a real DEM under a made-up parcel would be misleading).
 */
export async function fetchLiveSite(opts: FetchOptions): Promise<FetchOutcome> {
  const crs = EPSG_2272;
  const now = new Date().toISOString();
  const margin = opts.marginFt ?? 800;
  const reports: LayerReport[] = [];
  const provenance: Provenance[] = [];
  const extra = (layer: string) => (opts.notes?.[layer] ? ` ${opts.notes[layer]}` : '');
  const ok = (layer: string, source: string, detail: string, license: string, synthetic = false) => {
    reports.push({ layer, source, ok: true, detail });
    provenance.push({ layer, sourceUrl: source, fetchedAt: now, license, notes: detail + extra(layer), synthetic });
  };
  const fail = (layer: string, source: string, err: unknown, fallbackNote: string) => {
    reports.push({ layer, source, ok: false, detail: `${(err as Error).message}; ${fallbackNote}` });
    provenance.push({ layer, sourceUrl: source, fetchedAt: now, license: 'n/a', notes: `NOT LOADED (${(err as Error).message}); ${fallbackNote}`, synthetic: true });
  };

  // 1. Geocode + parcel (required).
  let parcel: ParcelResult;
  try {
    const g = await geocode(opts.address);
    ok('geocode', g.source, `${g.matched} → lon ${g.lonLat[0].toFixed(5)}, lat ${g.lonLat[1].toFixed(5)} (interpolated along the street)`, 'US Census Bureau geocoder (public domain)');
    parcel = await fetchParcel(opts.address, g.lonLat, crs);
    const ac = ringArea(parcel.ring) / 43560;
    ok(
      'parcel',
      parcel.source,
      `${ac.toFixed(2)} ac computed${parcel.deededAc ? ` (${parcel.deededAc} ac deeded)` : ''}, map number ${parcel.pin ?? 'n/a'}; ${parcel.note}. ${parcel.rawVertexCount} vertices simplified to ${parcel.ring.length} (1 ft tolerance). Tax-map linework, not a boundary survey.`,
      'Lebanon County GIS tax parcels (public record)',
    );
  } catch (err) {
    fail('parcel', 'US Census geocoder + Lebanon County tax parcels', err, 'nothing written');
    return { fixture: null, dem: null, reports };
  }
  const ring = parcel.ring;
  const area = expandBBox(bboxOf(ring), margin);
  // Snap the box to whole 5 ft so the DEM grid and the aerial chunks share clean edges.
  area.minX = Math.floor(area.minX / 5) * 5;
  area.minY = Math.floor(area.minY / 5) * 5;
  area.maxX = Math.ceil(area.maxX / 5) * 5;
  area.maxY = Math.ceil(area.maxY / 5) * 5;

  // 2. Roads: OpenStreetMap first, county centerlines second.
  let roads: Road[] = [];
  let asBuilt: AsBuilt[] = [];
  const rowNote = 'Right-of-way widths are class defaults (EFCG assumption): confirm against the recorded ROW';
  try {
    const o = await fetchOsm(area, crs, ring);
    if (!o.roads.length) throw new Error('no named roads returned');
    roads = o.roads;
    asBuilt = o.asBuilt;
    ok('roads', o.source, `${roads.length} named road segments, ${asBuilt.length} as-built building footprint(s). ${rowNote}.`, '© OpenStreetMap contributors (ODbL)');
  } catch (osmErr) {
    try {
      const c = await fetchCountyRoads(area, crs);
      roads = c.roads;
      ok('roads', c.source, `${roads.length} road centerline segments (${[...new Set(roads.map((r) => r.name))].join(', ')}). ${rowNote}. OpenStreetMap was tried first and failed (${(osmErr as Error).message}), so there is no as-built building footprint.`, 'Lebanon County GIS road centerlines (public record)');
    } catch (err) {
      fail('roads', LEBANON_ROADS, err, `no roads: frontages cannot be classified (OpenStreetMap also failed: ${(osmErr as Error).message})`);
    }
  }

  // 3. Terrain (required).
  let dem: Grid;
  let terrain: SiteFixture['terrain'];
  try {
    const d = await fetchDem(area, crs, 5);
    dem = d.dem;
    const st = terrainStats(dem, [ring]);
    let pre = false;
    let note = `USGS 3DEP bare-earth elevation resampled to ${dem.cellFt} ft cells (${dem.nx} × ${dem.ny}), meters converted to ftUS. On the parcel: ${st.minElevFt.toFixed(0)}–${st.maxElevFt.toFixed(0)} ft, average slope ${st.avgSlopePct.toFixed(1)}%.`;
    const bld = asBuilt[0];
    if (bld) {
      const flat = terrainStats(dem, [bld.ring]).stdElevFt;
      pre = flat >= 0.5;
      note += pre ? ` Elevation std-dev under the as-built footprint is ${flat.toFixed(2)} ft: reads as pre-development ground.` : ` WARNING: std-dev under the as-built footprint is ${flat.toFixed(2)} ft (< 0.5 ft): this surface post-dates construction.`;
    }
    if (opts.terrainReviewNote) {
      pre = true;
      note += ` ${opts.terrainReviewNote}`;
    } else if (!bld) note += ' Not checked against an as-built footprint: confirm that the LiDAR pre-dates any construction.';
    terrain = { x0: dem.x0, y0: dem.y0, cellFt: dem.cellFt, nx: dem.nx, ny: dem.ny, source: 'USGS 3DEP elevation (LiDAR-derived)', synthetic: false, preDevelopment: pre, verticalDatum: 'NAVD88', file: 'dem.f32' };
    ok('terrain', d.source, note, 'USGS 3DEP (public domain)');
  } catch (err) {
    fail('terrain', 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer', err, 'nothing written (a made-up surface under a real parcel would mislead)');
    return { fixture: null, dem: null, reports };
  }

  // 4. Wetlands and floodplain.
  const constraints: Constraint[] = [];
  try {
    const w = await fetchWetlands(area, crs);
    constraints.push(...w.constraints);
    const onSite = w.constraints.filter((c) => c.ring.some((p) => pointInRing(p, ring)) || pointInRing(ringCentroid(c.ring), ring));
    ok('wetlands', w.source, `${w.constraints.length} NWI polygon(s) in the area, ${onSite.length} touching the parcel${onSite.length ? ` (${onSite.map((c) => (ringArea(c.ring) / 43560).toFixed(1) + ' ac').join(', ')})` : ''}. Planning-level mapping: a field delineation governs. 25 ft no-disturb buffer is an EFCG assumption.`, 'USFWS National Wetlands Inventory (public domain)');
  } catch (err) {
    fail('wetlands', 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0', err, 'no wetland layer: add wetlands manually with add_constraint');
  }
  try {
    const f = await fetchFloodplain(area, crs);
    constraints.push(...f.constraints);
    ok('floodplain', f.source, `${f.constraints.length} special flood hazard polygon(s) in the area`, 'FEMA NFHL (public domain)');
  } catch (err) {
    fail('floodplain', 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28', err, 'no floodplain layer: check the FEMA map before relying on this layout');
  }

  // 5. Neighbouring lot lines (context only).
  let neighbors: Ring[] = [];
  try {
    const n = await fetchNeighbors(area, crs, parcel.pin);
    neighbors = n.rings;
    ok('neighbors', n.source, `${neighbors.length} neighbouring lot outlines (drawn for context only; no owner data requested)`, 'Lebanon County GIS tax parcels (public record)');
  } catch (err) {
    fail('neighbors', LEBANON_PARCELS, err, 'no neighbouring lot lines');
  }

  // 6. Aerials, already in the site CRS.
  const sets: ImagerySet[] = [];
  if (!opts.skipImagery) {
    fs.rmSync(path.join(opts.dir, 'imagery'), { recursive: true, force: true });
    for (const src of PA_IMAGERY) {
      try {
        const im = await fetchImagerySet(src, area, crs, opts.dir);
        sets.push(im.set);
        ok(`imagery:${src.id}`, im.source, `${src.label}: ${im.set.chunks.length} chunk(s) at ${src.ftPerPx} ft/pixel, ${(im.bytes / 1e6).toFixed(1)} MB, exported in EPSG:${crs.epsg} so it registers with the parcel`, src.license);
      } catch (err) {
        fail(`imagery:${src.id}`, src.base, err, 'this aerial is not available');
      }
    }
  }
  const imagery: SiteFixture['imagery'] = { available: sets.length > 0, sets, attribution: sets.map((s) => s.attribution).join('; ') };

  // 7. Zoning districts.
  let districts: District[];
  const zf = opts.zoningDistrictsFile && fs.existsSync(opts.zoningDistrictsFile) ? (JSON.parse(fs.readFileSync(opts.zoningDistrictsFile, 'utf8')) as DistrictFile) : null;
  if (zf) {
    districts = districtsFromZoningFile(zf, ring, area, opts.districtCode);
    ok('districts', zf.source, `${districts.length} district polygons from: ${zf.sourceTitle}. ${zf.method} ${zf.accuracyNote} Neighbouring districts are closed up to the lot line (within ${DISTRICT_SNAP_FT} ft).`, 'North Lebanon Township (public record)');
  } else {
    districts = districtsFromMinutes(ring);
    provenance.push({
      layer: 'districts',
      sourceUrl: 'https://northlebanontwppa.gov/wp-content/uploads/2021/12/2020-08-PC-Minutes.pdf',
      fetchedAt: now,
      license: 'n/a',
      notes: 'APPROXIMATE rectangles placed around the parcel from the 2020 minutes (residential N/W, agricultural S, commercial E). Not digitized from the zoning map: verify.',
      synthetic: true,
    });
    reports.push({ layer: 'districts', source: 'minutes', ok: false, detail: 'no digitized zoning map: approximate rectangles from the 2020 minutes' });
  }

  const fixture: SiteFixture = {
    id: opts.id,
    name: opts.name,
    address: opts.address,
    jurisdiction: opts.jurisdiction,
    crs,
    synthetic: false,
    parcel: { id: parcel.pin ?? 'parcel-1', pin: parcel.pin, ring, recordAreaAc: parcel.deededAc },
    zoningDistrictCode: opts.districtCode,
    addressRoadName: opts.addressRoadName,
    roads,
    districts,
    constraints,
    asBuilt,
    neighbors,
    terrain,
    imagery,
    provenance,
  };
  return { fixture, dem, reports };
}
