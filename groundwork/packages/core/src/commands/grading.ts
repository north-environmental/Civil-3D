/** Grading commands: criteria, grade at an FFE, optimize FFE, earthwork report, sections. */
import { z } from 'zod';
import { GRADING_DEFAULTS, GRADING_META, type GradingCriteria } from '../criteria/grading';
import { deriveProject } from '../derive';
import { type Pt } from '../geometry/basic';
import type { Grid } from '../geometry/grid';
import { defaultFfe, gradeScenario, optimizeFfe, prepareGrading, sectionProfile } from '../grading/scenario';
import { type EarthworkReport, type Project, type Scenario, activeScenario, replaceScenario } from '../site/project';
import { fmtInt } from '../site/units';
import { requireSite } from './base';
import { rebuild } from './layout';
import { relativePosition } from './site';
import { CommandError, defineCommand } from './registry';

function requireLayout(s: Scenario): void {
  if (!s.objects.some((o) => o.type === 'building')) throw new CommandError('Nothing to grade: place a building first (generate_layout or place_building).');
}

const CAT: Record<string, string> = { pad: 'building pad', truckCourt: 'truck courts', parking: 'car parking', drive: 'drives', basin: 'basins', tieIn: 'tie-in slopes' };

export function earthworkBrief(ew: EarthworkReport): Record<string, unknown> {
  return {
    ffeFt: ew.ffeFt,
    cutCy: Math.round(ew.cutCy),
    fillCy: Math.round(ew.fillCy),
    netCy: Math.round(ew.netCy),
    netMeaning: ew.netCy >= 0 ? 'surplus (export)' : 'deficit (import)',
    shrinkPct: ew.shrinkPct,
    feasibleFfeFt: ew.feasibleFfe ? { min: +ew.feasibleFfe.minFt.toFixed(1), max: +ew.feasibleFfe.maxFt.toFixed(1), binding: ew.feasibleFfe.binding } : null,
    walls: { count: ew.walls.length, totalLengthFt: Math.round(ew.wallTotalLengthFt), maxHeightFt: +ew.wallMaxHeightFt.toFixed(1), dockWingWalls: ew.dockWingWalls.length },
    offsiteGradingSf: Math.round(ew.offsiteAreaSf),
    maxCutFt: +ew.maxCutFt.toFixed(1),
    maxFillFt: +ew.maxFillFt.toFixed(1),
    driveGrades: ew.drives.map((d) => ({ id: d.id, name: d.name, gradePct: +d.gradePct.toFixed(1), maxPct: d.maxGradePct })),
    ...(ew.balance ? { balance: ew.balance } : {}),
  };
}

function headline(ew: EarthworkReport): string {
  return (
    `FFE ${ew.ffeFt.toFixed(1)} ft: cut ${fmtInt(ew.cutCy)} CY, fill ${fmtInt(ew.fillCy)} CY, net ${fmtInt(Math.abs(ew.netCy))} CY ${ew.netCy >= 0 ? 'surplus (export)' : 'deficit (import)'} ` +
    `after ${ew.shrinkPct}% shrink (to subgrade; ${ew.gridCellFt} ft grid). ` +
    (ew.walls.length ? `${ew.walls.length} retaining wall(s), ${fmtInt(ew.wallTotalLengthFt)} ft, up to ${ew.wallMaxHeightFt.toFixed(1)} ft. ` : `No retaining walls${ew.dockWingWalls.length ? ` (${ew.dockWingWalls.length} dock wing walls at building corners)` : ''}. `) +
    (ew.offsiteAreaSf > 0 ? `Offsite grading ${fmtInt(ew.offsiteAreaSf)} SF.` : 'No offsite grading.')
  );
}

defineCommand({
  name: 'set_grading_criteria',
  group: 'Grading',
  title: 'Set grading criteria',
  description:
    'Change grading design criteria for the active scenario; only the keys you pass change. Common keys: tieInSlopeHtoV ' +
    '(daylight slope, H:1V, default 3), dockHeightFt (FFE to truck court, default 4.0), truckCourtSlopePct (default 1.5), ' +
    'parkingSlopePct (default 1.5; max 4 per § 27-1410, ADA stalls ≤ 2.08), truckDriveMaxGradePct (6), carDriveMaxGradePct (8), ' +
    'shrinkPct (cut shrink, default 10), topsoilStripFt (0.5), padOverbuildFt (10), pavement/slab sections (sectionBuildingSlabFt ' +
    '1.17, sectionDockApronFt 1.33, sectionHeavyAsphaltFt 1.5, sectionStandardAsphaltFt 1.0), gridCellFt (5). Slopes are percent ' +
    '(2.0 = 2%), lengths in feet. If the scenario is graded it is regraded at the current FFE (run optimize_ffe again to ' +
    're-balance). Pass reset=true to restore defaults. Returns the changed values and the new earthwork headline.',
  input: z.object({ criteria: z.record(z.number()).default({}), reset: z.boolean().default(false) }),
  mutates: true,
  handler: (p, input) => {
    requireSite(p);
    const s = activeScenario(p);
    const bad = Object.keys(input.criteria).filter((k) => !(k in GRADING_DEFAULTS));
    if (bad.length) throw new CommandError(`Unknown grading criteria: ${bad.join(', ')}. Known keys: ${Object.keys(GRADING_DEFAULTS).join(', ')}.`, 'invalid_input');
    const c = input.criteria as Partial<GradingCriteria>;
    if (c.tieInSlopeHtoV !== undefined && c.tieInSlopeHtoV < 1) throw new CommandError('tieInSlopeHtoV must be ≥ 1 (H:1V).', 'invalid_input');
    if (c.gridCellFt !== undefined && (c.gridCellFt < 1 || c.gridCellFt > 25)) throw new CommandError('gridCellFt must be between 1 and 25 ft.', 'invalid_input');
    const criteria: GradingCriteria = { ...(input.reset ? GRADING_DEFAULTS : s.grading.criteria), ...c };
    const changed = (Object.keys(criteria) as (keyof GradingCriteria)[]).filter((k) => criteria[k] !== s.grading.criteria[k]);
    if (!changed.length) return { result: { summary: 'No grading criteria changed.' } };
    const next: Scenario = { ...s, grading: { ...s.grading, criteria } };
    // Parking slope lives on the field objects, so regenerate the layout around the same placement.
    const { project } = rebuild(p, next);
    const msg = `Grading criteria updated: ${changed.map((k) => `${GRADING_META[k].label} ${s.grading.criteria[k]} → ${criteria[k]} ${GRADING_META[k].units}`).join('; ')}.`;
    const ew = activeScenario(deriveProject(project)).results.earthwork;
    return { project, log: msg, result: { summary: msg + (ew ? ` Regraded at the current FFE. ${headline(ew)}` : ''), changed, ...(ew ? { earthwork: earthworkBrief(ew) } : {}) } };
  },
});

defineCommand({
  name: 'grade_site',
  group: 'Grading',
  title: 'Grade site',
  description:
    'Build the concept-level proposed surface for the active scenario at a finished floor elevation (ffeFt, feet NAVD88). ' +
    'Omit ffeFt to keep the current FFE, or (first time) to start at the mean existing ground under the building. The surface: ' +
    'flat pad at FFE with 10 ft overbuild, truck courts 4.0 ft below FFE at the dock face falling 1.5% away, parking planes, ' +
    'drives interpolated from the existing road at the right-of-way to the object they serve, basins, and 3:1 tie-in slopes ' +
    'to existing ground. Returns cut / fill / net (CY, to subgrade, after shrink), the feasible FFE range from drive grades, ' +
    'retaining walls (where objects are too close to tie in at 3:1), offsite grading and drive grades. Use optimize_ffe ' +
    'instead when you want the FFE that balances earthwork.',
  input: z.object({ ffeFt: z.number().min(-500).max(20000).optional() }),
  mutates: true,
  handler: (p, input) => {
    const site = requireSite(p);
    const s = activeScenario(p);
    requireLayout(s);
    const prep = prepareGrading(site, s);
    const ffe = Math.round((input.ffeFt ?? s.grading.ffeFt ?? defaultFfe(prep.setup)) * 10) / 10;
    const out = gradeScenario(site, s, ffe, { prep });
    const next: Scenario = { ...s, grading: { ...s.grading, ffeFt: ffe, graded: true, balanceTargetCy: null } };
    const msg = `Graded scenario ${s.id} at ${headline(out.report)}`;
    return { project: replaceScenario(p, next), log: msg, result: { summary: msg, ...earthworkBrief(out.report), next: 'optimize_ffe to balance; get_earthwork_report for the breakdown; render_view {view: "cutfill"} to see it.' } };
  },
});

defineCommand({
  name: 'optimize_ffe',
  group: 'Grading',
  title: 'Optimize FFE',
  description:
    'Find the finished floor elevation that balances earthwork (default) or hits a net target, and grade the scenario at it. ' +
    'targetNetCy: 0 = balanced; positive = that many CY of surplus to export; negative = CY of import allowed. ' +
    'Net = cut × (1 − shrink) − fill, to subgrade. Everything moves with FFE except driveway tie-ins (fixed to the existing ' +
    'road) and basins, so the search stays inside the feasible FFE range set by maximum drive grades (trucks 6%, cars 8%). ' +
    'Returns the FFE (to 0.1 ft), the feasible range and which drive binds it, cut / fill / net, walls and offsite grading; ' +
    'if the target cannot be reached inside the range it says so and names the binding constraint and options.',
  input: z.object({ targetNetCy: z.number().default(0).describe('Net earthwork target in CY: 0 balance, + export, − import.') }),
  mutates: true,
  handler: (p, input) => {
    const site = requireSite(p);
    const s = activeScenario(p);
    requireLayout(s);
    const out = optimizeFfe(site, s, input.targetNetCy);
    const ffe = out.report.ffeFt;
    const next: Scenario = { ...s, grading: { ...s.grading, ffeFt: ffe, graded: true, balanceTargetCy: input.targetNetCy } };
    const msg = `Optimized FFE for scenario ${s.id}: ${out.note} ${headline(out.report)}`;
    return {
      project: replaceScenario(p, next),
      log: msg,
      result: { summary: msg, achieved: out.achieved, ...earthworkBrief(out.report), searchedFfeFt: { min: out.searchRange.minFt, max: out.searchRange.maxFt } },
    };
  },
});

defineCommand({
  name: 'get_earthwork_report',
  group: 'Grading',
  title: 'Get earthwork report',
  description:
    'Earthwork breakdown for the active (graded) scenario: cut and fill in CY by area (building pad, truck courts, car ' +
    'parking, drives, basins, tie-in slopes), totals to subgrade, net after shrink, topsoil strip (reported separately, ' +
    'assumed reused on site), pavement/slab section adjustment, disturbed area, max cut/fill depth, retaining walls (length, ' +
    'max exposed height, between which objects, where), offsite grading, drive grades and spot elevations (building corners, ' +
    'dock faces, driveway tie-ins). grid "report" recomputes on the 2 ft report grid (slower, more precise); default is the ' +
    'interactive 5 ft grid already shown in the app.',
  input: z.object({ grid: z.enum(['interactive', 'report']).default('interactive') }),
  mutates: false,
  handler: (p, input) => {
    const site = requireSite(p);
    const s = activeScenario(p);
    if (!s.grading.graded || s.grading.ffeFt === null || !s.results.earthwork) throw new CommandError('The active scenario is not graded. Run grade_site or optimize_ffe first.');
    const ew = input.grid === 'report' ? gradeScenario(site, s, s.grading.ffeFt, { cellFt: s.grading.criteria.reportGridCellFt }).report : s.results.earthwork;
    const base = s.results.earthwork;
    return {
      result: {
        summary:
          headline(ew) +
          (input.grid === 'report' ? ` (Interactive ${base.gridCellFt} ft grid gave cut ${fmtInt(base.cutCy)} / fill ${fmtInt(base.fillCy)} CY.)` : '') +
          ` Largest movers: ${ew.byCategory
            .slice()
            .sort((a, b) => b.cutCy + b.fillCy - (a.cutCy + a.fillCy))
            .slice(0, 3)
            .map((b) => `${CAT[b.category]} (cut ${fmtInt(b.cutCy)}, fill ${fmtInt(b.fillCy)} CY)`)
            .join('; ')}.`,
        ...earthworkBrief(ew),
        byArea: ew.byCategory.map((b) => ({ area: CAT[b.category], cutCy: Math.round(b.cutCy), fillCy: Math.round(b.fillCy), areaAc: +(b.areaSf / 43560).toFixed(2) })),
        topsoilStripCy: Math.round(ew.topsoilStripCy),
        sectionAdjustmentCy: Math.round(ew.sectionAdjustmentCy),
        disturbedAc: +(ew.disturbedAreaSf / 43560).toFixed(1),
        wallList: ew.walls.map((w) => ({ id: w.id, lengthFt: Math.round(w.lengthFt), maxHeightFt: +w.maxHeightFt.toFixed(1), between: w.betweenObjectIds, where: relativePosition(site, w.at) })),
        spotElevations: ew.spots.map((sp) => ({ label: sp.label, elevFt: +sp.elevFt.toFixed(1) })),
        notes: [
          'Volumes are to subgrade: pavement and slab sections are subtracted from finished grade.',
          `Topsoil strip (${s.grading.criteria.topsoilStripFt} ft over the disturbed area) is reported separately and assumed reused on site.`,
          'Concept-level grid volumes; not for bidding or construction.',
        ],
      },
    };
  },
});

defineCommand({
  name: 'cut_section',
  group: 'Grading',
  title: 'Cut section',
  description:
    'Cut a section along a line: from [x1, y1] to [x2, y2] in site CRS feet (x east, y north; see get_site_context for the ' +
    'parcel bbox and get_project_summary for object centers). Returns the existing and proposed profile sampled along the ' +
    'line (stations in ft, elevations in ft), the max cut and fill depth on the line, and an image of the profile (existing ' +
    'dashed, proposed solid, 5× vertical exaggeration by default). Proposed equals existing where the scenario is not graded. ' +
    'Omit the line to cut through the building center across its depth.',
  input: z.object({
    from: z.tuple([z.number(), z.number()]).optional(),
    to: z.tuple([z.number(), z.number()]).optional(),
    samples: z.number().int().min(10).max(400).default(60).describe('Number of profile points returned.'),
    verticalExaggeration: z.number().min(1).max(20).default(5),
  }),
  mutates: false,
  handler: (p: Project, input) => {
    const site = requireSite(p);
    const s = activeScenario(p);
    let a = input.from as Pt | undefined;
    let b = input.to as Pt | undefined;
    if (!a || !b) {
      const bld = s.objects.find((o) => o.type === 'building') as any;
      if (!bld) throw new CommandError('Give from and to points, or place a building first.');
      const ang = (bld.rotationDeg * Math.PI) / 180;
      const half = bld.depthFt / 2 + 320;
      a = [bld.center[0] + Math.sin(ang) * half, bld.center[1] - Math.cos(ang) * half];
      b = [bld.center[0] - Math.sin(ang) * half, bld.center[1] + Math.cos(ang) * half];
    }
    let proposed: Grid | null = null;
    if (s.grading.graded && s.grading.ffeFt !== null && s.objects.some((o) => o.type === 'building')) {
      const out = gradeScenario(site, s, s.grading.ffeFt);
      proposed = { ...out.prep.model.spec, data: out.result.proposed };
    }
    const prof = sectionProfile(site, a, b, proposed, input.samples);
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      result: {
        summary:
          `Section ${fmtInt(prof.lengthFt)} ft long from the ${relativePosition(site, a)} to the ${relativePosition(site, b)}: existing ${r1(prof.minElevFt)}–${r1(prof.maxElevFt)} ft; ` +
          (proposed ? `max cut ${r1(prof.maxCutFt)} ft, max fill ${r1(prof.maxFillFt)} ft along the line.` : 'scenario not graded, so proposed = existing.'),
        from: a.map(Math.round),
        to: b.map(Math.round),
        lengthFt: Math.round(prof.lengthFt),
        maxCutFt: r1(prof.maxCutFt),
        maxFillFt: r1(prof.maxFillFt),
        profile: prof.stationFt.map((st, i) => [Math.round(st), r1(prof.existingFt[i]), r1(prof.proposedFt[i])]),
        profileColumns: ['stationFt', 'existingFt', 'proposedFt'],
      },
      effects: [{ type: 'render', view: 'section', params: { scenario: s.id, line: [a, b], ve: input.verticalExaggeration }, width: 1600, height: 700, as: 'image' }],
    };
  },
});
