/** Site commands: load_site, get_site_context, add_constraint. */
import { z } from 'zod';
import { type Pt, bboxOf, ensureCCW, ringArea, ringCentroid } from '../geometry/basic';
import { steepSlopeConstraints, terrainStats } from '../site/terrain';
import { type Site } from '../site/model';
import type { Project } from '../site/project';
import { compass8, fmtAc, fmtInt } from '../site/units';
import { azimuthDeg } from '../geometry/basic';
import { assembleSite, frontages } from '../zoning/edges';
import { BUILTIN_RULESETS } from '../zoning/rules';
import { requireSite } from './base';
import { CommandError, defineCommand, newScenario } from './registry';

/** Compass position of a point relative to the parcel centroid, e.g. "SW part of the site". */
export function relativePosition(site: Site, p: Pt): string {
  const c = ringCentroid(site.parcel.ring);
  const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
  if (d < 150) return 'center of the site';
  return `${compass8(azimuthDeg([p[0] - c[0], p[1] - c[1]]))} part of the site`;
}

export function siteContext(site: Site) {
  const stats = terrainStats(site.dem, [site.parcel.ring]);
  const fr = frontages(site.edges);
  // Group non-front edges by facing + adjacent district.
  const adj = new Map<string, { facing: string; edgeClass: string; district: string; kind: string; lengthFt: number; abutsResidential: boolean }>();
  for (const e of site.edges) {
    if (e.edgeClass === 'front') continue;
    const key = `${e.facing}|${e.edgeClass}|${e.adjacentDistrictCode ?? '?'}`;
    const cur = adj.get(key) ?? { facing: e.facing, edgeClass: e.edgeClass, district: e.adjacentDistrictCode ?? 'unknown', kind: e.adjacentDistrictKind ?? 'unknown', lengthFt: 0, abutsResidential: false };
    cur.lengthFt += e.lengthFt;
    cur.abutsResidential ||= e.abutsResidential;
    adj.set(key, cur);
  }
  return {
    site: { id: site.id, name: site.name, address: site.address, jurisdiction: site.jurisdiction, synthetic: site.synthetic, crs: `EPSG:${site.crs.epsg} (${site.crs.name})` },
    parcel: {
      areaSf: Math.round(site.areaSf),
      areaAc: +(site.areaSf / 43560).toFixed(2),
      recordAreaAc: site.parcel.recordAreaAc ?? null,
      district: site.zoningDistrictCode,
      edges: site.edges.length,
      /** Site CRS feet, for commands that take coordinates. */
      bbox: (() => {
        const b = bboxOf(site.parcel.ring);
        return [Math.round(b.minX), Math.round(b.minY), Math.round(b.maxX), Math.round(b.maxY)];
      })(),
      centroid: ringCentroid(site.parcel.ring).map((v) => Math.round(v)),
    },
    frontages: fr.map((f) => {
      const e = site.edges[f.edgeIndexes[0]];
      return {
        road: f.roadName,
        lengthFt: Math.round(f.lengthFt),
        side: e.facing,
        acrossStreetDistrict: e.adjacentDistrictCode ?? 'unknown',
        acrossStreetKind: e.adjacentDistrictKind ?? 'unknown',
        acrossStreetFromResidential: f.acrossStreetFromResidential,
        rowWidthFt: site.roads.find((r) => r.id === f.roadId)?.rowWidthFt ?? null,
        rowAssumed: site.roads.find((r) => r.id === f.roadId)?.rowAssumed ?? true,
      };
    }),
    otherEdges: [...adj.values()].map((a) => ({ ...a, lengthFt: Math.round(a.lengthFt) })),
    constraints: site.constraints.map((c) => ({
      id: c.id,
      kind: c.kind,
      name: c.name,
      areaAc: +(ringArea(c.ring) / 43560).toFixed(2),
      bufferFt: c.bufferFt,
      location: relativePosition(site, ringCentroid(c.ring)),
      informational: c.informational,
    })),
    terrain: {
      source: site.terrain.source,
      synthetic: site.terrain.synthetic,
      preDevelopment: site.terrain.preDevelopment,
      lowElevFt: +stats.minElevFt.toFixed(1),
      lowPoint: relativePosition(site, stats.lowPoint),
      lowPointXY: stats.lowPoint.map((v) => Math.round(v)),
      highElevFt: +stats.maxElevFt.toFixed(1),
      highPoint: relativePosition(site, stats.highPoint),
      highPointXY: stats.highPoint.map((v) => Math.round(v)),
      reliefFt: +stats.reliefFt.toFixed(1),
      avgSlopePct: +stats.avgSlopePct.toFixed(1),
      maxSlopePct: +stats.maxSlopePct.toFixed(1),
      generalFall: `toward the ${stats.fallDirection}`,
    },
    asBuiltReference: site.asBuilt.map((a) => ({ name: a.name, kind: a.kind, areaSf: Math.round(ringArea(a.ring)) })),
    dataNotes: site.provenance.filter((p) => p.synthetic).length
      ? ['Site data is SYNTHETIC (no network during the build). Do not present parcel, terrain or district geometry as real.', ...site.provenance.map((p) => `${p.layer}: ${p.notes}`)]
      : site.provenance.map((p) => `${p.layer}: ${p.sourceUrl} (${p.fetchedAt.slice(0, 10)}) ${p.notes}`),
  };
}

defineCommand({
  name: 'load_site',
  group: 'Site',
  title: 'Load site',
  description:
    'Load a site by street address, parcel ID or site id from the cached fixtures (no network). Builds the site model: ' +
    'parcel, roads with right-of-way, adjacent zoning districts, constraints (wetlands, floodplain, steep slopes), ' +
    'existing terrain and the as-built reference. Also pre-loads the confirmed zoning rule set for the parcel district ' +
    'when one is built in. STARTS A NEW PROJECT: existing scenarios are discarded. Returns parcel area (ac), frontages, ' +
    'district and whether the data is synthetic. Follow with get_site_context for the full picture. ' +
    'Demo site: {"address": "1625 Heilmandale Rd"}.',
  input: z.object({
    address: z.string().optional().describe('Street address, e.g. "1625 Heilmandale Rd".'),
    parcelId: z.string().optional().describe('Parcel ID / PIN.'),
    siteId: z.string().optional().describe('Fixture id, e.g. "heilmandale".'),
  }),
  mutates: true,
  handler: (p, input, ctx) => {
    if (!input.address && !input.parcelId && !input.siteId) throw new CommandError('Give an address, parcelId or siteId. Demo site: {"address": "1625 Heilmandale Rd"}.', 'invalid_input');
    if (!ctx.services.resolveSite) throw new CommandError('This host cannot load sites (no fixture store).');
    const found = ctx.services.resolveSite(input);
    if (!found) {
      throw new CommandError(
        `No cached site matches ${JSON.stringify(input)}. Sites are loaded from fixtures under data/sites/ (run \`npm run fetch-site-data\` to add one). Available demo site: "1625 Heilmandale Rd".`,
        'not_found',
      );
    }
    // Attach derived informational constraints (steep slopes > 25 %) and re-assemble edges.
    const steep = found.constraints.some((c) => c.kind === 'steepSlope') ? [] : steepSlopeConstraints(found.dem, 25);
    const site: Site = steep.length ? assembleSite({ ...found, constraints: [...found.constraints, ...steep] }, found.dem) : found;
    const rules = BUILTIN_RULESETS[site.zoningDistrictCode] ?? null;
    const project: Project = {
      ...p,
      name: site.name,
      site,
      rules,
      scenarios: [newScenario('A', 'Scenario A')],
      activeScenarioId: 'A',
    };
    const fr = frontages(site.edges);
    const frText = fr.map((f) => `${f.roadName} (${fmtInt(f.lengthFt)} ft)`).join(', ');
    const msg =
      `Loaded ${site.address}: ${fmtAc(site.areaSf, 1)} parcel in ${site.jurisdiction}, district ${site.zoningDistrictCode}; frontage on ${frText || 'no public road'}.` +
      (site.synthetic ? ' Site data is SYNTHETIC (generated placeholder; no network during the build).' : '') +
      (rules ? ` ${rules.districtName} rule set pre-loaded (${rules.rules.length} rules, confirmed).` : ` No built-in rule set for ${site.zoningDistrictCode}: read the ordinance with get_ordinance_text and propose rules with set_zoning_rules.`);
    return {
      project,
      log: msg,
      result: {
        summary: msg,
        siteId: site.id,
        areaAc: +(site.areaSf / 43560).toFixed(2),
        district: site.zoningDistrictCode,
        frontages: fr.map((f) => ({ road: f.roadName, lengthFt: Math.round(f.lengthFt) })),
        synthetic: site.synthetic,
        rulesLoaded: !!rules,
        next: 'get_site_context, get_zoning_rules, then set_program and generate_layout.',
      },
    };
  },
});

defineCommand({
  name: 'get_site_context',
  group: 'Context',
  title: 'Get site context',
  description:
    'Describe the loaded site for planning: parcel area (SF, ac) and district; each road frontage (road name, length ft, ' +
    'which side of the parcel, district across the street, whether that is residential); other edges with the adjacent ' +
    'district; constraints (wetlands, floodplain, steep slopes, manual) with area and location; existing terrain (high/low ' +
    'elevation ft and where, relief, average slope %, general fall direction); the as-built reference; and data-quality notes ' +
    '(including a SYNTHETIC flag). Also returns the parcel bbox and centroid in site CRS feet (x east, y north) for commands that ' +
    'take coordinates. Use it before choosing a building orientation and access points.',
  input: z.object({}),
  mutates: false,
  handler: (p) => {
    const site = requireSite(p);
    const c = siteContext(site);
    const t = c.terrain;
    const summary =
      `${fmtAc(site.areaSf, 1)} (${fmtInt(site.areaSf)} SF) in ${site.zoningDistrictCode}. Frontages: ` +
      c.frontages.map((f) => `${f.road} on the ${f.side} side, ${fmtInt(f.lengthFt)} ft, ${f.acrossStreetKind} across`).join('; ') +
      `. Terrain ${t.lowElevFt}–${t.highElevFt} ft (${t.reliefFt} ft relief), avg slope ${t.avgSlopePct}%, falling ${t.generalFall}; low point in the ${t.lowPoint}.` +
      (c.constraints.length ? ` Constraints: ${c.constraints.map((x) => `${x.name} (${x.location})`).join('; ')}.` : ' No mapped constraints.') +
      (site.synthetic ? ' NOTE: synthetic site data.' : '');
    return { result: { summary, ...c } };
  },
});

defineCommand({
  name: 'add_constraint',
  group: 'Site',
  title: 'Add constraint',
  description:
    'Add a manual exclusion polygon (easement, wetland buffer, "keep out" area). It is subtracted from every zoning envelope ' +
    'and avoided by the layout solver. Coordinates are in the site CRS (state plane, US survey feet), as [x, y] pairs; ' +
    'get_site_context and render_view help you locate things. Optional bufferFt adds a no-build buffer around the polygon. ' +
    'Returns the constraint id and area.',
  input: z.object({
    name: z.string().min(1).max(80),
    kind: z.enum(['manual', 'easement', 'wetland', 'floodplain']).default('manual'),
    ring: z.array(z.tuple([z.number(), z.number()])).min(3).describe('Polygon vertices [x, y] in site CRS feet (not closed).'),
    bufferFt: z.number().min(0).max(500).default(0),
  }),
  mutates: true,
  handler: (p, input) => {
    const site = requireSite(p);
    const ring = ensureCCW(input.ring as Pt[]);
    const id = `manual-${site.constraints.filter((c) => c.id.startsWith('manual-')).length + 1}`;
    const constraint = { id, kind: input.kind, name: input.name, ring, bufferFt: input.bufferFt, informational: false, source: 'Added manually' };
    const next: Site = { ...site, constraints: [...site.constraints, constraint] };
    const msg = `Added constraint "${input.name}" (${fmtAc(ringArea(ring), 2)}${input.bufferFt ? `, ${input.bufferFt} ft buffer` : ''}) in the ${relativePosition(site, ringCentroid(ring))}.`;
    return { project: { ...p, site: next }, log: msg, changedIds: [id], result: { summary: msg, id, areaSf: Math.round(ringArea(ring)) } };
  },
});
