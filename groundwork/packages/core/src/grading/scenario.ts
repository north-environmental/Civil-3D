/**
 * Scenario-level grading: builds the model from the design objects, evaluates it at an FFE, solves
 * for the balancing FFE inside the feasible range, and assembles the earthwork report.
 * Runs unchanged on the server (MCP) and in the browser worker (display).
 */
import { type Pt, type Ring, bboxOf, expandBBox } from '../geometry/basic';
import { unionSolids } from '../geometry/clip';
import { type ContourSet, type Grid, contours, gridSpecForBBox, resampleGrid, sampleGrid } from '../geometry/grid';
import type { Site } from '../site/model';
import type { EarthworkReport, ParkingField, Scenario } from '../site/project';
import { CF_PER_CY } from '../site/units';
import { parkingStallGeometry } from '../layout/building';
import { type EvalResult, type GradingModel, evaluateModel, makeModel, solveFfe, surfaceSlopePct } from './engine';
import { type GradingSetup, buildGradingObjects, feasibleFfeRange } from './objects';

/** Grading extends this far beyond the parcel so offsite tie-ins are seen, ft. */
const GRID_MARGIN_FT = 80;
/** Radius around a driveway's ROW crossing treated as permitted apron work (not offsite grading), ft. EFCG default. */
const ROW_APRON_RADIUS_FT = 45;

const gridCache = new WeakMap<Float32Array, Map<string, Grid>>();

/** Existing ground resampled onto the grading grid (parcel bbox + margin), cached per DEM and cell size. */
export function gradingGrid(site: Site, cellFt: number): Grid {
  let byCell = gridCache.get(site.dem.data);
  if (!byCell) gridCache.set(site.dem.data, (byCell = new Map()));
  const key = `${cellFt}:${site.parcel.ring.length}:${site.parcel.ring[0][0]}`;
  let g = byCell.get(key);
  if (!g) {
    const spec = gridSpecForBBox(expandBBox(bboxOf(site.parcel.ring), GRID_MARGIN_FT), cellFt);
    g = resampleGrid(site.dem, spec);
    byCell.set(key, g);
  }
  return g;
}

export type PreparedGrading = { model: GradingModel; setup: GradingSetup; existing: Grid };

export function prepareGrading(site: Site, s: Scenario, cellFt?: number): PreparedGrading {
  const cell = cellFt ?? s.grading.criteria.gridCellFt;
  const existing = gradingGrid(site, cell);
  const setup = buildGradingObjects(site, s);
  // Driveway aprons inside the right-of-way are permitted work, not offsite grading.
  const aprons: Ring[] = s.objects.filter((o) => o.type === 'driveway').map((o: any) => {
    const ring: Ring = [];
    for (let a = 0; a < 16; a++) ring.push([o.position[0] + Math.cos((a / 16) * 2 * Math.PI) * ROW_APRON_RADIUS_FT, o.position[1] + Math.sin((a / 16) * 2 * Math.PI) * ROW_APRON_RADIUS_FT]);
    return ring;
  });
  const onsite = aprons.length ? unionSolids([[site.parcel.ring], ...aprons.map((r) => [r])]) : [site.parcel.ring];
  const model = makeModel({ existing, objects: setup.objects, criteria: s.grading.criteria, daylight: true, sections: true, onsite });
  return { model, setup, existing };
}

/** Default FFE: mean existing elevation under the building, to 0.1 ft. */
export function defaultFfe(setup: GradingSetup): number {
  return Math.round(setup.padMeanExistingFt * 10) / 10;
}

function buildReport(site: Site, s: Scenario, prep: PreparedGrading, r: EvalResult): EarthworkReport {
  const c = s.grading.criteria;
  const cy = (cf: number) => cf / CF_PER_CY;
  const feasible = feasibleFfeRange(prep.setup.drives);
  const ffe = r.ffeFt;
  // Slopes measured on the proposed grid.
  const fields = s.objects.filter((o): o is ParkingField => o.type === 'parkingField');
  const slopes: EarthworkReport['slopes'] = [];
  for (const f of fields) {
    const whole = surfaceSlopePct(prep.model, r.proposed, f.polygon);
    slopes.push({ id: f.id, name: f.name, kind: 'parking', slopePct: whole.maxPct });
    const g = parkingStallGeometry(f, s.layoutCriteria);
    let ada = 0;
    let cells = 0;
    for (const ring of [...g.adaStalls, ...g.adaAisles]) {
      const m = surfaceSlopePct(prep.model, r.proposed, ring);
      ada = Math.max(ada, m.maxPct);
      cells += m.cells;
    }
    // Small stalls can fall between 5 ft cell centers; fall back to the field plane, which they lie on.
    if (f.stallsAda > 0) slopes.push({ id: f.id, name: `${f.name}: accessible stalls and aisles`, kind: 'ada', slopePct: cells ? ada : whole.maxPct });
  }
  // Tie-in slopes steeper than the preferred mowing slope (informational) and steeper than the maximum.
  const { nx, ny, cellFt } = prep.model.spec;
  let steepPreferred = 0;
  let steepMax = 0;
  const prefLimit = 100 / c.preferredTieInSlopeHtoV + 0.5;
  const maxLimit = 100 / c.tieInSlopeHtoV + 1.0;
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      if (prep.model.owner[k] >= 0 || Math.abs(r.proposed[k] - prep.model.existing[k]) < 0.05) continue;
      if (prep.model.owner[k - 1] >= 0 || prep.model.owner[k + 1] >= 0 || prep.model.owner[k - nx] >= 0 || prep.model.owner[k + nx] >= 0) continue;
      if (r.wallHeight && r.wallHeight[k] > 0.05) continue;
      const gx = (r.proposed[k + 1] - r.proposed[k - 1]) / (2 * cellFt);
      const gy = (r.proposed[k + nx] - r.proposed[k - nx]) / (2 * cellFt);
      const sl = Math.hypot(gx, gy) * 100;
      if (sl > prefLimit) steepPreferred += cellFt * cellFt;
      if (sl > maxLimit) steepMax += cellFt * cellFt;
    }
  }
  // Where a dock-height court meets the pad at a building corner there is always a short wing wall.
  const catOf = new Map(prep.setup.objects.map((o) => [o.id, o.category]));
  const classified = r.walls.map((w) => {
    const cats = new Set(w.betweenObjectIds.map((id) => catOf.get(id)));
    const wing = cats.has('pad') && cats.has('truckCourt') && [...cats].every((x) => x === 'pad' || x === 'truckCourt');
    return { ...w, kind: wing ? ('dockWing' as const) : ('retaining' as const) };
  });
  const siteWalls = classified.filter((w) => w.kind === 'retaining').map((w, i) => ({ ...w, id: `wall-${i + 1}` }));
  const wingWalls = classified.filter((w) => w.kind === 'dockWing').map((w, i) => ({ ...w, id: `wing-${i + 1}` }));
  return {
    ffeFt: ffe,
    gridCellFt: prep.model.spec.cellFt,
    cutCy: cy(r.cutCf),
    fillCy: cy(r.fillCf),
    netCy: cy(r.netCf),
    shrinkPct: c.shrinkPct,
    topsoilStripCy: cy(r.disturbedSf * c.topsoilStripFt),
    disturbedAreaSf: r.disturbedSf,
    sectionAdjustmentCy: cy(r.sectionCf),
    byCategory: r.byCategory.map((b) => ({ category: b.category, cutCy: cy(b.cutCf), fillCy: cy(b.fillCf), areaSf: b.areaSf })),
    walls: siteWalls,
    dockWingWalls: wingWalls,
    wallTotalLengthFt: siteWalls.reduce((a, w) => a + w.lengthFt, 0),
    wallMaxHeightFt: siteWalls.reduce((a, w) => Math.max(a, w.maxHeightFt), 0),
    offsiteAreaSf: r.offsiteAreaSf,
    offsiteMaxDeltaFt: r.offsiteMaxDeltaFt,
    maxCutFt: r.maxCutFt,
    maxFillFt: r.maxFillFt,
    feasibleFfe: feasible,
    drives: prep.setup.drives.map((d) => {
      const end = d.endZ0 + d.endK * ffe;
      return { id: d.id, name: d.name, gradePct: d.lengthFt > 0 ? ((end - d.startElevFt) / d.lengthFt) * 100 : 0, maxGradePct: d.maxGradePct, startElevFt: d.startElevFt, endElevFt: end, lengthFt: d.lengthFt };
    }),
    spots: prep.setup.spots.map((sp) => ({ label: sp.label, at: sp.at, elevFt: sp.z0 + sp.k * ffe })),
    slopes,
    steepTieInSf: { overPreferred: steepPreferred, overMax: steepMax },
  };
}

export type GradeOutput = { report: EarthworkReport; result: EvalResult; prep: PreparedGrading };

export function gradeScenario(site: Site, s: Scenario, ffeFt: number, opts: { cellFt?: number; prep?: PreparedGrading } = {}): GradeOutput {
  const prep = opts.prep ?? prepareGrading(site, s, opts.cellFt);
  const result = evaluateModel(prep.model, ffeFt);
  return { report: buildReport(site, s, prep, result), result, prep };
}

export type OptimizeOutput = GradeOutput & { achieved: boolean; note: string; searchRange: { minFt: number; maxFt: number }; exactFfeFt: number };

/** How close to the target counts as balanced: 2 % of total movement (SPEC Phase 5 acceptance). */
export const BALANCE_TOLERANCE = 0.02;

/**
 * Find the FFE whose net earthwork equals `targetNetCy` (0 = balanced; + export, − import) inside the
 * feasible range set by drive grades. FFE is reported to 0.1 ft.
 */
export function optimizeFfe(site: Site, s: Scenario, targetNetCy = 0, opts: { cellFt?: number; searchFt?: number } = {}): OptimizeOutput {
  const prep = prepareGrading(site, s, opts.cellFt);
  const feasible = feasibleFfeRange(prep.setup.drives);
  const mid = prep.setup.padMeanExistingFt;
  const span = opts.searchFt ?? 20;
  let minFt = mid - span;
  let maxFt = mid + span;
  if (feasible) {
    minFt = Math.max(minFt, feasible.minFt);
    maxFt = Math.min(maxFt, feasible.maxFt);
    if (minFt > maxFt) {
      // The feasible window lies outside the search span around existing ground: use the window itself.
      minFt = feasible.minFt;
      maxFt = feasible.maxFt;
    }
  }
  // Work inside the range at 0.1 ft resolution so the reported FFE is itself feasible.
  const lo = Math.ceil(minFt * 10 - 1e-6) / 10;
  const hi = Math.floor(maxFt * 10 + 1e-6) / 10;
  const sol = solveFfe(prep.model, { targetNetCf: targetNetCy * CF_PER_CY, minFt: Math.min(lo, hi), maxFt: Math.max(lo, hi) });
  const ffe = Math.min(Math.max(lo, hi), Math.max(Math.min(lo, hi), Math.round(sol.ffeFt * 10) / 10));
  const out = gradeScenario(site, s, ffe, { prep });
  const balance = describeBalance(out.report, targetNetCy);
  out.report.balance = balance;
  const { achieved, note } = balance;
  return { ...out, achieved, note, searchRange: { minFt: lo, maxFt: hi }, exactFfeFt: sol.ffeFt };
}

/**
 * Is the earthwork balanced (or on target)? Shared by optimize_ffe and the derived report, so the
 * statement stays true after later layout edits.
 */
export function describeBalance(report: EarthworkReport, targetNetCy: number): NonNullable<EarthworkReport['balance']> {
  const movement = report.cutCy + report.fillCy;
  const miss = report.netCy - targetNetCy;
  const achieved = Math.abs(miss) <= BALANCE_TOLERANCE * movement;
  const fmt = (v: number) => Math.round(v).toLocaleString('en-US');
  const ffe = report.ffeFt;
  const fr = report.feasibleFfe;
  let note: string;
  if (achieved) {
    note = `${targetNetCy === 0 ? 'Balanced' : 'Target met'} at FFE ${ffe.toFixed(1)} ft: net ${fmt(report.netCy)} CY is ${((Math.abs(miss) / Math.max(1, movement)) * 100).toFixed(1)}% of the ${fmt(movement)} CY moved (tolerance ±${BALANCE_TOLERANCE * 100}%).`;
  } else if (fr && (ffe <= fr.minFt + 0.1 || ffe >= fr.maxFt - 0.1)) {
    const low = ffe <= fr.minFt + 0.1;
    note =
      `${targetNetCy === 0 ? 'Balance' : 'Target'} not achievable within the feasible FFE range ${fr.minFt.toFixed(1)}–${fr.maxFt.toFixed(1)} ft. ` +
      `At the ${low ? 'lowest' : 'highest'} feasible FFE (${ffe.toFixed(1)} ft) the net is ${fmt(report.netCy)} CY (${report.netCy >= 0 ? 'export' : 'import'}). ` +
      `Binding: ${fr.binding[low ? 0 : 1]}. Options: lengthen that drive, move its driveway, accept the ${report.netCy >= 0 ? 'export' : 'import'}, or change the basin depth.`;
  } else {
    note = `Not ${targetNetCy === 0 ? 'balanced' : 'on target'} at FFE ${ffe.toFixed(1)} ft: net ${fmt(report.netCy)} CY (${report.netCy >= 0 ? 'export' : 'import'}) vs a target of ${fmt(targetNetCy)} CY. The layout or criteria changed since the last optimize_ffe; run it again.`;
  }
  return { targetNetCy, achieved, note };
}

export type SectionProfile = { stationFt: number[]; existingFt: number[]; proposedFt: number[]; lengthFt: number; maxCutFt: number; maxFillFt: number; minElevFt: number; maxElevFt: number };

/** Existing vs proposed profile along a line (proposed = existing where the scenario is not graded). */
export function sectionProfile(site: Site, a: Pt, b: Pt, proposed: Grid | null, samples = 200): SectionProfile {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(2, Math.min(1000, samples));
  const out: SectionProfile = { stationFt: [], existingFt: [], proposedFt: [], lengthFt: len, maxCutFt: 0, maxFillFt: 0, minElevFt: Infinity, maxElevFt: -Infinity };
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    const e = sampleGrid(site.dem, x, y);
    let p = e;
    if (proposed && x >= proposed.x0 && y >= proposed.y0 && x <= proposed.x0 + proposed.nx * proposed.cellFt && y <= proposed.y0 + proposed.ny * proposed.cellFt) p = sampleGrid(proposed, x, y);
    out.stationFt.push(t * len);
    out.existingFt.push(e);
    out.proposedFt.push(p);
    out.maxCutFt = Math.max(out.maxCutFt, e - p);
    out.maxFillFt = Math.max(out.maxFillFt, p - e);
    out.minElevFt = Math.min(out.minElevFt, e, p);
    out.maxElevFt = Math.max(out.maxElevFt, e, p);
  }
  return out;
}

/** Display products for the UI: proposed grid, cut/fill, proposed contours limited to graded cells. */
export type GradingDisplay = {
  spec: GradingModel['spec'];
  proposed: Float32Array;
  /** proposed − existing, ft (NaN where untouched). */
  delta: Float32Array;
  wallHeight: Float32Array | null;
  contours: ContourSet[];
  maxAbsDeltaFt: number;
};

export function gradingDisplay(out: GradeOutput): GradingDisplay {
  const { model } = out.prep;
  const n = model.spec.nx * model.spec.ny;
  const delta = new Float32Array(n);
  const mask = new Uint8Array(n);
  let maxAbs = 0;
  for (let k = 0; k < n; k++) {
    const d = out.result.proposed[k] - model.existing[k];
    if (model.owner[k] >= 0 || Math.abs(d) > 0.02) {
      delta[k] = d;
      mask[k] = 1;
      if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
    } else delta[k] = NaN;
  }
  const grid: Grid = { ...model.spec, data: out.result.proposed };
  return { spec: model.spec, proposed: out.result.proposed, delta, wallHeight: out.result.wallHeight, contours: contours(grid, 1, 5, mask), maxAbsDeltaFt: maxAbs };
}
