/** Assumptions list: every design default / assumed value in force, with its source (SPEC §11). */
import { GRADING_DEFAULTS, GRADING_META } from '../criteria/grading';
import { LAYOUT_DEFAULTS, LAYOUT_META } from '../criteria/layout';
import { STORMWATER_DEFAULTS, STORMWATER_META } from '../criteria/stormwater';
import type { Assumption, Project, Scenario } from '../site/project';

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
}

export function buildAssumptions(p: Project, s: Scenario): Assumption[] {
  const out: Assumption[] = [];
  const site = p.site;
  if (site) {
    if (site.synthetic)
      out.push({
        key: 'site.synthetic',
        label: 'Site data',
        value: 'SYNTHETIC parcel, roads, districts, wetland and terrain (no network during build)',
        source: 'Fallback per SPEC §6; replace with npm run fetch-site-data',
        changed: true,
      });
    else if (!site.terrain.preDevelopment)
      out.push({ key: 'site.terrain', label: 'Terrain', value: 'DEM may post-date construction', source: site.terrain.source, changed: true });
    for (const r of site.roads) {
      if (r.rowAssumed)
        out.push({
          key: `row.${r.id}`,
          label: `Right-of-way width, ${r.name}`,
          value: `${r.rowWidthFt} ft (assumed by road class)`,
          source: 'EFCG assumption per SPEC §6.2 (state route 60 ft, local 50 ft)',
          changed: false,
        });
    }
    out.push({
      key: 'zoning.districtBoundary',
      label: 'District boundaries along streets',
      value: 'Assumed at the street centerline',
      source: 'EFCG assumption; digitized/approximate district polygons',
      changed: false,
    });
  }
  if (s.program) {
    if (s.program.employeesLargestShift !== undefined || s.program.employeesTwoLargestShifts !== undefined)
      out.push({
        key: 'program.employees',
        label: 'Employees (parking basis)',
        value: `${s.program.employeesLargestShift ?? '—'} on the largest shift; ${s.program.employeesTwoLargestShifts ?? '—'} on the two largest successive shifts`,
        source: 'User/Claude assumption (not from the tenant)',
        changed: true,
      });
  }
  for (const k of Object.keys(LAYOUT_DEFAULTS) as (keyof typeof LAYOUT_DEFAULTS)[]) {
    const m = LAYOUT_META[k];
    const v = s.layoutCriteria[k];
    out.push({ key: `layout.${k}`, label: m.label, value: `${fmt(v)} ${m.units}`, source: m.source, changed: v !== LAYOUT_DEFAULTS[k] });
  }
  out.push({
    key: 'stormwater.method',
    label: 'Stormwater reservation method',
    value: s.stormwater.method,
    source: 'EFCG default; planning-level land reservation, not a hydrologic design',
    changed: s.stormwater.method !== 'pctOfSite',
  });
  for (const k of Object.keys(STORMWATER_DEFAULTS) as (keyof typeof STORMWATER_DEFAULTS)[]) {
    const m = STORMWATER_META[k];
    const v = s.stormwater[k];
    // Only list the parameters of the active sizing method (plus the shared ones).
    const forMethod = /\((.*) method/.exec(m.label)?.[1];
    if (forMethod && !forMethod.includes(s.stormwater.method)) continue;
    out.push({ key: `stormwater.${k}`, label: m.label, value: `${fmt(v)} ${m.units}`, source: m.source, changed: v !== STORMWATER_DEFAULTS[k] });
  }
  for (const k of Object.keys(GRADING_DEFAULTS) as (keyof typeof GRADING_DEFAULTS)[]) {
    const m = GRADING_META[k];
    const v = s.grading.criteria[k];
    out.push({ key: `grading.${k}`, label: m.label, value: `${fmt(v)} ${m.units}`, source: m.source, changed: v !== GRADING_DEFAULTS[k] });
  }
  return out;
}
