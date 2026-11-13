/**
 * Fixture-first site store. The app reads ONLY from data/sites/<id>/; live fetching happens in
 * scripts/fetch-site-data.ts. Node-only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { type Grid, type HostServices, type Site, SiteFixtureSchema, assembleSite } from '@groundwork/core';

export type OrdinanceSection = { section: string; title: string; text: string; source: string; verbatim: boolean };

export function listSiteIds(dataDir: string): string[] {
  if (!fs.existsSync(dataDir)) return [];
  return fs
    .readdirSync(dataDir)
    .filter((d) => fs.existsSync(path.join(dataDir, d, 'site.json')))
    .sort();
}
export function siteAssetsDir(dataDir: string, siteId: string): string | null {
  const dir = path.join(dataDir, siteId);
  return fs.existsSync(dir) ? dir : null;
}

export function loadSiteFixture(dataDir: string, siteId: string): Site {
  const dir = path.join(dataDir, siteId);
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8'));
  const fixture = SiteFixtureSchema.parse(raw);
  const t = fixture.terrain;
  const buf = fs.readFileSync(path.join(dir, t.file));
  if (buf.byteLength !== t.nx * t.ny * 4) {
    throw new Error(`DEM ${t.file} has ${buf.byteLength} bytes; expected ${t.nx * t.ny * 4} for ${t.nx} × ${t.ny} Float32 samples`);
  }
  const data = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const dem: Grid = { x0: t.x0, y0: t.y0, cellFt: t.cellFt, nx: t.nx, ny: t.ny, data };
  return assembleSite(fixture, dem);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Match a free-text address / parcel id / site id to a fixture. */
export function resolveSiteId(dataDir: string, query: { siteId?: string; address?: string; parcelId?: string }): string | null {
  const ids = listSiteIds(dataDir);
  if (query.siteId && ids.includes(query.siteId)) return query.siteId;
  for (const id of ids) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dataDir, id, 'site.json'), 'utf8'));
      if (query.parcelId && (raw.parcel?.id === query.parcelId || raw.parcel?.pin === query.parcelId)) return id;
      if (query.address) {
        const q = norm(query.address);
        const a = norm(raw.address ?? '');
        // Match on the street-number + street-name prefix, e.g. "1625 heilmandale".
        const key = a.split(' ').slice(0, 2).join(' ');
        if (q && (a.includes(q) || q.includes(key) || norm(raw.name ?? '').includes(q) || q.includes(norm(id)))) return id;
      }
    } catch {
      /* skip unreadable fixtures */
    }
  }
  return null;
}

export function loadOrdinance(dataDir: string, siteId: string): OrdinanceSection[] {
  const file = path.join(dataDir, siteId, 'ordinance.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')).sections as OrdinanceSection[];
}

/** Host services for the command layer (sync, fixture-backed). */
export function createHostServices(dataDir: string): HostServices {
  const siteCache = new Map<string, Site>();
  let ordinance: OrdinanceSection[] | null = null;
  let ordinanceSite = '';
  const ord = (): OrdinanceSection[] => {
    const id = ordinanceSite || listSiteIds(dataDir)[0] || '';
    if (!ordinance) ordinance = id ? loadOrdinance(dataDir, id) : [];
    return ordinance;
  };
  const key = (s: string) => s.replace(/[^0-9a-z.]+/gi, '').toLowerCase().replace(/^27-?/, '');
  return {
    resolveSite(query) {
      const id = resolveSiteId(dataDir, query);
      if (!id) return null;
      if (!siteCache.has(id)) siteCache.set(id, loadSiteFixture(dataDir, id));
      ordinanceSite = id;
      ordinance = null;
      return siteCache.get(id)!;
    },
    ordinanceText(section) {
      const want = key(section.replace(/§/g, ''));
      const all = ord();
      return all.find((s) => key(s.section) === want) ?? all.find((s) => key(s.section).startsWith(want) || want.startsWith(key(s.section))) ?? null;
    },
    listOrdinanceSections() {
      return ord().map((s) => `${s.section} ${s.title}`);
    },
  };
}

/** Write a fixture folder (site.json, DEM sidecar, ordinance.json, provenance.json). */
export function writeFixture(dir: string, fixture: import('@groundwork/core').SiteFixture, dem: Grid, ordinance: OrdinanceSection[]): void {
  fs.mkdirSync(dir, { recursive: true });
  const round = (v: unknown): unknown =>
    typeof v === 'number' ? Math.round(v * 1000) / 1000 : Array.isArray(v) ? v.map(round) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v;
  fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify(round(fixture), null, 1));
  fs.writeFileSync(path.join(dir, fixture.terrain.file), Buffer.from(dem.data.buffer, dem.data.byteOffset, dem.data.byteLength));
  fs.writeFileSync(path.join(dir, 'ordinance.json'), JSON.stringify({ sections: ordinance }, null, 1));
  fs.writeFileSync(path.join(dir, 'provenance.json'), JSON.stringify(fixture.provenance, null, 1));
}
