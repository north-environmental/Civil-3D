/** Program and layout commands. */
import { z } from 'zod';
import { type Pt, type Ring, distToPolyline, norm360, orientedRect, ringArea, ringCentroid, ringInsideRegion } from '../geometry/basic';
import { LAYOUT_DEFAULTS, type LayoutCriteria } from '../criteria/layout';
import { deriveProject as deriveNow } from '../derive';
import { basinDepthFor, basinStorageCf } from '../layout/basin';
import { fieldDepthFt, makeParkingField } from '../layout/building';
import { type LayoutResult, buildLayout } from '../layout/generate';
import { frontageAngleDeg, solveLayout } from '../layout/solver';
import type { Site } from '../site/model';
import {
  type AccessSpec,
  type Basin,
  type Building,
  type DesignObject,
  type Placement,
  type Program,
  type Project,
  type Scenario,
  type Side,
  type TrailerField,
  activeScenario,
  replaceScenario,
} from '../site/project';
import { compass8, fmtAc, fmtInt } from '../site/units';
import { findRoad, frontages } from '../zoning/edges';
import { buildEnvelopes } from '../zoning/envelopes';
import { parkingRequired } from '../zoning/checks';
import type { ZoningRuleSet } from '../zoning/rules';
import { requireRules, requireSite } from './base';
import { relativePosition } from './site';
import { CommandError, defineCommand } from './registry';

const SideSchema = z.enum(['+u', '-u', '+v', '-v']);
const PtSchema = z.tuple([z.number(), z.number()]);

function requireProgram(s: Scenario): Program {
  if (!s.program) throw new CommandError('No program set. Call set_program first (e.g. {"buildingSf": 410000, "buildingType": "crossDock"}).');
  return s.program;
}

/** Compass description of a direction in the building frame, e.g. the "+v" side faces "N". */
export function sideFacing(rotationDeg: number, side: Side): string {
  const base = side === '+u' ? 0 : side === '+v' ? 90 : side === '-u' ? 180 : 270;
  const math = norm360(rotationDeg + base);
  return compass8(norm360(90 - math));
}

function withLayout(p: Project, s: Scenario, placement: Placement, layout: LayoutResult): Project {
  const omit = new Set(s.prefs.omit ?? []);
  const objects = layout.objects.filter((o) => !omit.has(o.id));
  return replaceScenario(p, { ...s, placement, objects, results: { ...s.results, layoutNotes: layout.notes } });
}

/** Rebuild the auto-generated objects around the current placement (no search). */
export function rebuild(p: Project, s: Scenario): { project: Project; layout: LayoutResult | null } {
  if (!p.site || !p.rules || !s.program || !s.placement) return { project: replaceScenario(p, s), layout: null };
  const env = buildEnvelopes(p.site, p.rules);
  const layout = buildLayout(p.site, p.rules, env, s, s.placement);
  return { project: withLayout(p, s, s.placement, layout), layout };
}

function layoutBrief(site: Site, s: Scenario, layout: LayoutResult): Record<string, unknown> {
  const b = layout.objects.find((o): o is Building => o.type === 'building')!;
  return {
    building: {
      id: b.id,
      areaSf: b.areaSf,
      lengthFt: b.lengthFt,
      depthFt: b.depthFt,
      rotationDeg: +b.rotationDeg.toFixed(1),
      location: relativePosition(site, b.center),
      dockSidesFace: b.dockSides.map((d) => sideFacing(b.rotationDeg, d)),
      carSideFaces: sideFacing(b.rotationDeg, b.carSide),
      dockDoors: b.dockDoors,
    },
    carStalls: { provided: layout.stats.carStallsProvided, target: layout.stats.carStallsTarget },
    trailerStalls: { provided: layout.stats.trailerProvided, target: layout.stats.trailerTarget },
    driveways: layout.objects.filter((o) => o.type === 'driveway').map((o: any) => ({ id: o.id, network: o.network, road: o.roadName, stationFt: Math.round(o.stationFt), routed: layout.objects.some((d: any) => d.type === 'drive' && d.drivewayId === o.id) })),
    basins: layout.objects.filter((o) => o.type === 'basin').map((o: any) => ({ id: o.id, areaAc: +(o.areaSf / 43560).toFixed(2), location: relativePosition(site, ringCentroid(o.polygon)) })),
    basinReservation: { placedAc: +(layout.stats.basinPlacedSf / 43560).toFixed(2), requiredAc: +(layout.stats.basinRequiredSf / 43560).toFixed(2) },
    objectIds: layout.objects.map((o) => o.id),
    notes: layout.notes,
  };
}

function failingSummary(p: Project): string {
  const s = activeScenario(p);
  const fails = s.checks.filter((c) => c.status === 'fail');
  return fails.length ? ` ${fails.length} check(s) failing: ${fails.map((c) => c.title).join('; ')}.` : ' All hard checks pass.';
}

// ---------------------------------------------------------------------------------------------

defineCommand({
  name: 'set_program',
  group: 'Program/layout',
  title: 'Set program',
  description:
    'Set or update the building program for the active scenario. buildingSf (SF) and buildingType ("crossDock" = docks on ' +
    'both long sides, default depth 540 ft; "rearLoad" = docks on one long side, default depth 340 ft). Optional: lengthFt / ' +
    'depthFt (ft) to force dimensions, clearHeightFt (ft, default 40), dockDoors (number or "max"), trailerStalls (number or ' +
    '"max"), carStalls (explicit target) or employeesLargestShift + employeesTwoLargestShifts (the zoning parking ratios in ' +
    '§ 27-1405 are per employee), officeSf (SF, default 10,000), trailerRowInCourts (55 ft trailer row opposite the docks; ' +
    'court depth 185 ft with, 130 ft without). Fields you omit keep their current value. If a layout exists it is regenerated ' +
    'in place. Employee counts are assumptions unless the user gave them: log them with log_note. Returns the resolved ' +
    'program, building dimensions and the car stalls required under each zoning reading.',
  input: z.object({
    buildingSf: z.number().positive().max(5_000_000).optional(),
    buildingType: z.enum(['crossDock', 'rearLoad']).optional(),
    lengthFt: z.number().positive().nullable().optional(),
    depthFt: z.number().positive().nullable().optional(),
    clearHeightFt: z.number().positive().max(120).optional(),
    dockDoors: z.union([z.number().int().min(0), z.literal('max')]).optional(),
    trailerStalls: z.union([z.number().int().min(0), z.literal('max')]).optional(),
    carStalls: z.number().int().min(0).nullable().optional(),
    employeesLargestShift: z.number().int().min(0).optional(),
    employeesTwoLargestShifts: z.number().int().min(0).optional(),
    officeSf: z.number().min(0).optional(),
    trailerRowInCourts: z.boolean().optional(),
    layoutCriteria: z.record(z.number()).optional().describe('Override layout design defaults by key (see assumptions), e.g. {"dockDoorSpacingFt": 13}.'),
    stormwater: z
      .object({ method: z.enum(['pctOfSite', 'runoffDepth']).optional(), pctOfSite: z.number().min(0).max(40).optional(), pctOfSiteDepthFt: z.number().min(1).max(20).optional(), runoffDepthIn: z.number().min(0).max(12).optional(), basinDepthFt: z.number().min(1).max(20).optional(), maxBasins: z.number().int().min(1).max(6).optional() })
      .optional()
      .describe('Stormwater reservation rule (planning-level).'),
  }),
  mutates: true,
  handler: (p, input) => {
    requireSite(p);
    const rules = requireRules(p);
    const s = activeScenario(p);
    const prev = s.program;
    if (!prev && input.buildingSf === undefined) throw new CommandError('buildingSf is required the first time set_program is called.', 'invalid_input');
    const program: Program = {
      buildingSf: input.buildingSf ?? prev!.buildingSf,
      buildingType: input.buildingType ?? prev?.buildingType ?? 'crossDock',
      lengthFt: input.lengthFt === null ? undefined : (input.lengthFt ?? (input.buildingSf !== undefined || input.buildingType !== undefined ? undefined : prev?.lengthFt)),
      depthFt: input.depthFt === null ? undefined : (input.depthFt ?? (input.buildingType !== undefined && input.buildingType !== prev?.buildingType ? undefined : prev?.depthFt)),
      clearHeightFt: input.clearHeightFt ?? prev?.clearHeightFt ?? s.layoutCriteria.clearHeightFt,
      dockDoors: input.dockDoors ?? prev?.dockDoors ?? 'max',
      trailerStalls: input.trailerStalls ?? prev?.trailerStalls ?? 'max',
      carStalls: input.carStalls === null ? undefined : (input.carStalls ?? prev?.carStalls),
      employeesLargestShift: input.employeesLargestShift ?? prev?.employeesLargestShift,
      employeesTwoLargestShifts: input.employeesTwoLargestShifts ?? prev?.employeesTwoLargestShifts,
      officeSf: input.officeSf ?? prev?.officeSf ?? s.layoutCriteria.officeSf,
    };
    let layoutCriteria = s.layoutCriteria;
    if (input.layoutCriteria) {
      const bad = Object.keys(input.layoutCriteria).filter((k) => !(k in LAYOUT_DEFAULTS));
      if (bad.length) throw new CommandError(`Unknown layout criteria: ${bad.join(', ')}. Known keys: ${Object.keys(LAYOUT_DEFAULTS).join(', ')}.`, 'invalid_input');
      layoutCriteria = { ...s.layoutCriteria, ...(input.layoutCriteria as Partial<LayoutCriteria>) };
    }
    const stormwater = input.stormwater ? { ...s.stormwater, ...input.stormwater } : s.stormwater;
    // A type change invalidates the dock/car side arrangement.
    let placement = s.placement;
    if (placement && prev && prev.buildingType !== program.buildingType) {
      placement = program.buildingType === 'crossDock' ? { ...placement, dockSides: ['+v', '-v'], carSide: '-u' } : { ...placement, dockSides: ['-v'], carSide: '+v' };
    }
    const next: Scenario = { ...s, program, layoutCriteria, stormwater, placement, prefs: { ...s.prefs, trailerRowInCourts: input.trailerRowInCourts ?? s.prefs.trailerRowInCourts } };
    const { project, layout } = rebuild(p, next);
    const depth = program.depthFt ?? (program.buildingType === 'crossDock' ? layoutCriteria.crossDockDepthFt : layoutCriteria.rearLoadDepthFt);
    const length = program.lengthFt ?? Math.ceil(program.buildingSf / depth - 1e-9);
    const req = parkingRequired(next, rules);
    const msg =
      `Program: ${fmtInt(program.buildingSf)} SF ${program.buildingType === 'crossDock' ? 'cross-dock' : 'rear-load'} (${fmtInt(length)} × ${fmtInt(depth)} ft, ${program.clearHeightFt} ft clear), ` +
      `dock doors ${program.dockDoors}, trailer stalls ${program.trailerStalls}, ` +
      (program.carStalls !== undefined
        ? `${program.carStalls} car stalls`
        : req.storageReading !== null
          ? `car parking per § 27-1405: ${req.storageReading} (item S + W) / ${req.manufacturingReading ?? '—'} (item V + W)`
          : 'car parking not set (no employee counts)') +
      `, office ${fmtInt(program.officeSf)} SF.` +
      (layout ? ' Layout regenerated.' : '');
    return {
      project,
      log: msg,
      result: {
        summary: msg + (layout ? failingSummary(deriveNow(project)) : ' Next: set_access for trucks and cars, then generate_layout or place_building.'),
        program,
        building: { lengthFt: length, depthFt: depth, areaSf: length * depth },
        carStallsRequired: { serviceStorageReading: req.storageReading, manufacturingReading: req.manufacturingReading, basis: req.basis },
        ...(layout ? { layoutNotes: layout.notes } : {}),
      },
    };
  },
});

defineCommand({
  name: 'set_access',
  group: 'Program/layout',
  title: 'Set access (driveway)',
  description:
    'Assign a driveway: network ("truck", "car" or "emergency"), the road it connects to (by name, e.g. "Route 72", ' +
    '"Heilmandale Rd", "Orange Ln"), and position along that frontage in feet from the frontage start, or "auto" to let the ' +
    'engine place it near its destination while keeping 150 ft from intersections and other driveways (§ 27-1407). ' +
    'By default this adds a driveway (or updates the one already on that network + road). Set exclusive=true to make this ' +
    'the ONLY access for that network (e.g. "cars only from Orange Ln"). Set remove=true to delete it. Truck and car ' +
    'networks are routed separately and never share pavement. If a layout exists the driveways and drives are regenerated. ' +
    'Returns the driveway ids, stations and whether each was routed.',
  input: z.object({
    network: z.enum(['truck', 'car', 'emergency']),
    road: z.string().min(1),
    position: z.union([z.number().min(0), z.literal('auto')]).default('auto'),
    lanes: z.number().int().min(1).max(3).optional(),
    widthFt: z.number().min(10).max(60).optional(),
    exclusive: z.boolean().default(false).describe('Remove other driveways of this network.'),
    remove: z.boolean().default(false),
  }),
  mutates: true,
  handler: (p, input) => {
    const site = requireSite(p);
    const s = activeScenario(p);
    const road = findRoad(site, input.road);
    const fr = frontages(site.edges);
    if (!road || !fr.some((f) => f.roadId === road.id))
      throw new CommandError(`The parcel has no frontage on "${input.road}". Frontages: ${fr.map((f) => `${f.roadName} (${fmtInt(f.lengthFt)} ft)`).join(', ') || 'none'}.`, 'not_found');
    const same = (a: AccessSpec) => a.network === input.network && findRoad(site, a.road)?.id === road.id;
    let access = s.access.slice();
    let msg: string;
    if (input.remove) {
      if (!access.some(same)) throw new CommandError(`No ${input.network} access on ${road.name} to remove.`, 'not_found');
      access = access.filter((a) => !same(a));
      msg = `Removed ${input.network} access on ${road.name}.`;
    } else {
      if (input.exclusive) access = access.filter((a) => a.network !== input.network || same(a));
      const existing = access.find(same);
      const spec: AccessSpec = { id: existing?.id ?? `acc-${s.nextId}`, network: input.network, road: road.name, position: input.position, lanes: input.lanes, widthFt: input.widthFt };
      access = existing ? access.map((a) => (a === existing ? spec : a)) : [...access, spec];
      msg = `${input.network === 'truck' ? 'Truck' : input.network === 'car' ? 'Car' : 'Emergency'} access ${existing ? 'updated' : 'added'} on ${road.name} (${input.position === 'auto' ? 'auto position' : `station ${fmtInt(input.position)} ft`})${input.exclusive ? `; it is now the only ${input.network} access` : ''}.`;
    }
    const next: Scenario = { ...s, access, nextId: s.nextId + 1 };
    const { project, layout } = rebuild(p, next);
    const sc = activeScenario(project);
    const dws = sc.objects.filter((o) => o.type === 'driveway') as any[];
    return {
      project,
      log: msg,
      changedIds: dws.map((d) => d.id),
      result: {
        summary:
          msg +
          ` Access now: ${access.map((a) => `${a.network} via ${a.road}`).join(', ') || 'none'}.` +
          (layout ? ` Driveways: ${dws.map((d) => `${d.id} ${d.network} on ${d.roadName} at ${fmtInt(d.stationFt)} ft${sc.objects.some((o: any) => o.type === 'drive' && o.drivewayId === d.id) ? '' : ' (NOT routed)'}`).join('; ')}.` + failingSummary(deriveNow(project)) : ' (No building yet; driveways are placed when the layout is generated.)'),
        access,
        ...(layout ? { layoutNotes: layout.notes } : {}),
      },
    };
  },
});

function autoAssignAccess(site: Site, s: Scenario, layout: LayoutResult): AccessSpec[] | null {
  const fr = frontages(site.edges);
  if (!fr.length) return null;
  const need = { truck: !s.access.some((a) => a.network === 'truck'), car: !s.access.some((a) => a.network === 'car') };
  if (!need.truck && !need.car) return null;
  const access = s.access.slice();
  let id = s.nextId;
  const nearest = (pt: Pt, exclude?: string) =>
    fr
      .filter((f) => f.roadId !== exclude || fr.length === 1)
      .map((f) => ({ f, d: distToPolyline(pt, f.line) + (f.acrossStreetFromResidential ? 150 : 0) }))
      .sort((a, b) => a.d - b.d)[0]?.f;
  let truckRoad: string | undefined = s.access.find((a) => a.network === 'truck') ? findRoad(site, s.access.find((a) => a.network === 'truck')!.road)?.id : undefined;
  if (need.truck) {
    const apron = layout.objects.find((o) => o.type === 'truckApron') ?? layout.objects.find((o) => o.type === 'truckCourt');
    if (apron) {
      const f = nearest(ringCentroid((apron as any).polygon as Ring));
      if (f) {
        access.push({ id: `acc-${id++}`, network: 'truck', road: f.roadName, position: 'auto' });
        truckRoad = f.roadId;
      }
    }
  }
  if (need.car) {
    const field = layout.objects.find((o) => o.type === 'parkingField');
    if (field) {
      const f = nearest(ringCentroid((field as any).polygon as Ring), truckRoad);
      if (f) access.push({ id: `acc-${id++}`, network: 'car', road: f.roadName, position: 'auto' });
    }
  }
  return access;
}

defineCommand({
  name: 'generate_layout',
  group: 'Program/layout',
  title: 'Generate layout (auto-solver)',
  description:
    'Auto-solve a test fit for the active program: tries building orientations and positions inside the building envelope ' +
    'and, for each, generates truck courts, trailer rows, car parking with ADA stalls, driveways, separated truck/car ' +
    'drives, a stormwater reservation and landscape strips. Honors the driveways from set_access and soft preferences. ' +
    'Options: alignToRoad (long axis parallel to that road frontage), rotationDeg (long-axis angle, degrees counter-clockwise ' +
    'from east), docksAwayFromResidential (default true). Without either orientation option it searches 0–175° in 5° steps ' +
    'plus road-parallel angles. If no access is assigned it picks frontages and says so. Replaces the current auto-generated ' +
    'layout (manual objects are kept). Returns the chosen placement, a one-paragraph rationale, runner-up deltas, yields, ' +
    'notes on anything not achieved (with the limiting factor and options) and failing checks.',
  input: z.object({
    alignToRoad: z.string().optional().describe('Road name; the building long axis is set parallel to this frontage.'),
    rotationDeg: z.number().min(-360).max(360).optional(),
    docksAwayFromResidential: z.boolean().optional(),
    trailerRowInCourts: z.boolean().optional(),
  }),
  mutates: true,
  handler: (p, input) => {
    const site = requireSite(p);
    const rules = requireRules(p);
    let s = activeScenario(p);
    requireProgram(s);
    s = {
      ...s,
      prefs: {
        ...s.prefs,
        alignToRoad: input.alignToRoad ?? (input.rotationDeg !== undefined ? undefined : s.prefs.alignToRoad),
        rotationDeg: input.rotationDeg ?? (input.alignToRoad ? undefined : s.prefs.rotationDeg),
        docksAwayFromResidential: input.docksAwayFromResidential ?? s.prefs.docksAwayFromResidential,
        trailerRowInCourts: input.trailerRowInCourts ?? s.prefs.trailerRowInCourts,
        omit: [],
      },
    };
    const env = buildEnvelopes(site, rules);
    const solved = solveLayout(site, rules, env, s, { alignToRoad: s.prefs.alignToRoad, rotationDeg: s.prefs.rotationDeg });
    if ('error' in solved) throw new CommandError(solved.error);
    let layout = solved.layout;
    let autoNote = '';
    const auto = autoAssignAccess(site, s, layout);
    if (auto) {
      const added = auto.filter((a) => !s.access.includes(a));
      s = { ...s, access: auto, nextId: s.nextId + added.length };
      layout = buildLayout(site, rules, env, s, solved.placement);
      autoNote = ` No ${added.map((a) => a.network).join('/')} access was assigned, so I chose ${added.map((a) => `${a.network} via ${a.road}`).join(' and ')} (nearest frontage; change with set_access).`;
    }
    const project = withLayout(p, s, solved.placement, layout);
    const b = layout.objects.find((o): o is Building => o.type === 'building')!;
    const msg =
      `Placed ${fmtInt(b.areaSf)} SF ${b.buildingType === 'crossDock' ? 'cross-dock' : 'rear-load'}, ${fmtInt(b.lengthFt)} × ${fmtInt(b.depthFt)} ft, long axis at ${b.rotationDeg.toFixed(1)}°` +
      (solved.placement.alignedToRoad ? ` (parallel to ${solved.placement.alignedToRoad})` : '') +
      `, in the ${relativePosition(site, b.center)}; docks face ${b.dockSides.map((d) => sideFacing(b.rotationDeg, d)).join(' and ')}, cars on the ${sideFacing(b.rotationDeg, b.carSide)} side. ` +
      `${layout.stats.dockDoors} dock doors, ${layout.stats.trailerProvided} trailer stalls, ${layout.stats.carStallsProvided} car stalls, ${fmtAc(layout.stats.basinPlacedSf, 1)} stormwater reservation.`;
    return {
      project,
      log: msg + autoNote,
      changedIds: layout.objects.map((o) => o.id),
      result: {
        summary: msg + autoNote + failingSummary(deriveNow(project)),
        rationale: solved.rationale,
        alternatives: solved.alternatives,
        candidates: { tried: solved.evaluated, feasible: solved.feasible },
        ...layoutBrief(site, s, layout),
      },
    };
  },
});

defineCommand({
  name: 'place_building',
  group: 'Program/layout',
  title: 'Place building',
  description:
    'Place the building explicitly and regenerate everything around it. center = [x, y] in site CRS feet (omit to let the ' +
    'solver choose the position for the given orientation). Orientation: rotationDeg (long-axis angle, degrees counter-clockwise ' +
    'from east) or alignTo (road name: long axis parallel to that frontage). Optional lengthFt / depthFt override the ' +
    'program dimensions; dockSides (["+v","-v"] = both long sides; +v is the left side of the long axis) and carSide ' +
    '("+u"/"-u" = building ends, "+v"/"-v" = long sides; default: chosen toward the car access). Unlike generate_layout this ' +
    'does not search orientations. Returns the placement, what faces which compass direction, yields and failing checks with reasons.',
  input: z.object({
    center: PtSchema.optional(),
    rotationDeg: z.number().min(-360).max(360).optional(),
    alignTo: z.string().optional().describe('Road name to parallel.'),
    lengthFt: z.number().positive().optional(),
    depthFt: z.number().positive().optional(),
    dockSides: z.array(SideSchema).min(1).max(2).optional(),
    carSide: SideSchema.optional(),
  }),
  mutates: true,
  handler: (p, input) => {
    const site = requireSite(p);
    const rules = requireRules(p);
    let s = activeScenario(p);
    let program = requireProgram(s);
    if (input.lengthFt || input.depthFt) {
      program = { ...program, lengthFt: input.lengthFt ?? program.lengthFt, depthFt: input.depthFt ?? program.depthFt };
      s = { ...s, program };
    }
    const env = buildEnvelopes(site, rules);
    let rotationDeg = input.rotationDeg ?? s.placement?.rotationDeg;
    let alignedToRoad: string | undefined;
    if (input.alignTo) {
      const road = findRoad(site, input.alignTo);
      const f = road ? frontages(site.edges).find((x) => x.roadId === road.id) : undefined;
      if (!f) throw new CommandError(`Cannot align to "${input.alignTo}": no frontage on that road. Frontages: ${frontages(site.edges).map((x) => x.roadName).join(', ')}.`, 'not_found');
      rotationDeg = Math.round((frontageAngleDeg(f) % 180) * 10) / 10;
      alignedToRoad = f.roadName;
    }
    if (rotationDeg === undefined) throw new CommandError('Give rotationDeg or alignTo (or use generate_layout to search orientations).', 'invalid_input');
    s = { ...s, prefs: { ...s.prefs, alignToRoad: alignedToRoad, rotationDeg: alignedToRoad ? undefined : rotationDeg, omit: [] } };

    let placement: Placement;
    let layout: LayoutResult;
    let rationale: string | undefined;
    if (!input.center) {
      const solved = solveLayout(site, rules, env, s, { rotationDeg });
      if ('error' in solved) throw new CommandError(solved.error);
      placement = { ...solved.placement, alignedToRoad, source: 'explicit' };
      if (input.dockSides) placement.dockSides = input.dockSides;
      if (input.carSide) placement.carSide = input.carSide;
      layout = input.dockSides || input.carSide ? buildLayout(site, rules, env, s, placement) : solved.layout;
      rationale = solved.rationale;
    } else {
      const defaults: { dockSides: Side[]; carSide: Side }[] =
        program.buildingType === 'crossDock'
          ? [
              { dockSides: ['+v', '-v'], carSide: '-u' },
              { dockSides: ['+v', '-v'], carSide: '+u' },
            ]
          : [
              { dockSides: ['-v'], carSide: '+v' },
              { dockSides: ['+v'], carSide: '-v' },
            ];
      const options = input.carSide || input.dockSides ? [{ dockSides: input.dockSides ?? (s.placement?.dockSides.length === (program.buildingType === 'crossDock' ? 2 : 1) ? s.placement.dockSides : defaults[0].dockSides), carSide: input.carSide ?? s.placement?.carSide ?? defaults[0].carSide }] : defaults;
      let best: { placement: Placement; layout: LayoutResult; score: number } | null = null as { placement: Placement; layout: LayoutResult; score: number } | null;
      for (const o of options) {
        const pl: Placement = { center: input.center, rotationDeg, dockSides: o.dockSides, carSide: o.carSide, source: 'explicit', alignedToRoad };
        const l = buildLayout(site, rules, env, s, pl);
        const score = l.stats.hardFailures.length * 1000 + l.stats.routesMissing * 200 + Math.max(0, l.stats.carStallsTarget - l.stats.carStallsProvided);
        if (!best || score < best.score) best = { placement: pl, layout: l, score };
      }
      placement = best!.placement;
      layout = best!.layout;
    }
    const project = withLayout(p, s, placement, layout);
    const b = layout.objects.find((o): o is Building => o.type === 'building')!;
    const msg =
      `Placed ${fmtInt(b.areaSf)} SF ${b.buildingType === 'crossDock' ? 'cross-dock' : 'rear-load'}, ${fmtInt(b.lengthFt)} × ${fmtInt(b.depthFt)} ft, rotated ${b.rotationDeg.toFixed(1)}°` +
      (alignedToRoad ? ` to parallel ${alignedToRoad}` : '') +
      `, in the ${relativePosition(site, b.center)}; docks face ${b.dockSides.map((d) => sideFacing(b.rotationDeg, d)).join(' and ')}, cars on the ${sideFacing(b.rotationDeg, b.carSide)} side. ` +
      `${layout.stats.dockDoors} dock doors, ${layout.stats.trailerProvided} trailer stalls, ${layout.stats.carStallsProvided} car stalls.`;
    return {
      project,
      log: msg,
      changedIds: layout.objects.map((o) => o.id),
      result: { summary: msg + failingSummary(deriveNow(project)), ...(rationale ? { rationale } : {}), ...layoutBrief(site, s, layout) },
    };
  },
});

defineCommand({
  name: 'edit_object',
  group: 'Program/layout',
  title: 'Edit object',
  description:
    'Parametric edit of one design object by id (ids come from get_project_summary / generate_layout). ' +
    'Building: center [x,y] or moveBy [dx,dy] (ft), rotationDeg, lengthFt, depthFt, carSide, dockSides → everything ' +
    'regenerates around it. Driveway: stationFt (ft along its frontage) or moveByFt, widthFt, lanes. Parking field: rows, ' +
    'slopePct. Truck court: trailerRow (true/false, applies to all courts). Basin: topElevFt (top-of-berm elevation, ft), ' +
    'depthFt, center/moveBy. Trailer field (manual): center/moveBy, rotationDeg, lengthFt, rows. Returns what changed and failing checks.',
  input: z.object({
    id: z.string(),
    center: PtSchema.optional(),
    moveBy: PtSchema.optional(),
    rotationDeg: z.number().min(-360).max(360).optional(),
    lengthFt: z.number().positive().optional(),
    depthFt: z.number().positive().optional(),
    carSide: SideSchema.optional(),
    dockSides: z.array(SideSchema).min(1).max(2).optional(),
    stationFt: z.number().min(0).optional(),
    moveByFt: z.number().optional(),
    widthFt: z.number().positive().optional(),
    lanes: z.number().int().min(1).max(3).optional(),
    rows: z.number().int().min(1).max(20).optional(),
    slopePct: z.number().min(0).max(10).optional(),
    trailerRow: z.boolean().optional(),
    topElevFt: z.number().nullable().optional(),
  }),
  mutates: true,
  handler: (p, input) => {
    const site = requireSite(p);
    requireRules(p);
    let s = activeScenario(p);
    const obj = s.objects.find((o) => o.id === input.id);
    if (!obj) throw new CommandError(`No object "${input.id}" in scenario ${s.id}. Objects: ${s.objects.map((o) => o.id).join(', ') || 'none'}.`, 'not_found');
    let msg = '';
    const shift = (pt: Pt): Pt => (input.center ? input.center : input.moveBy ? [pt[0] + input.moveBy[0], pt[1] + input.moveBy[1]] : pt);
    switch (obj.type) {
      case 'building': {
        if (!s.placement || !s.program) throw new CommandError('The building has no placement to edit.');
        const placement: Placement = { ...s.placement, center: shift(s.placement.center), rotationDeg: input.rotationDeg ?? s.placement.rotationDeg, carSide: input.carSide ?? s.placement.carSide, dockSides: input.dockSides ?? s.placement.dockSides, source: 'explicit', alignedToRoad: input.rotationDeg !== undefined ? undefined : s.placement.alignedToRoad };
        const program = input.lengthFt || input.depthFt ? { ...s.program, lengthFt: input.lengthFt ?? s.program.lengthFt, depthFt: input.depthFt ?? s.program.depthFt } : s.program;
        s = { ...s, placement, program };
        msg = `Building ${input.center || input.moveBy ? `moved to the ${relativePosition(site, placement.center)}` : 'updated'}${input.rotationDeg !== undefined ? `, rotated to ${placement.rotationDeg.toFixed(1)}°` : ''}${input.lengthFt || input.depthFt ? `, resized to ${fmtInt(program.lengthFt ?? obj.lengthFt)} × ${fmtInt(program.depthFt ?? obj.depthFt)} ft` : ''}; layout regenerated.`;
        break;
      }
      case 'driveway': {
        const acc = s.access.find((a) => a.id === obj.accessId);
        if (!acc) throw new CommandError('This driveway has no access record; use set_access.');
        const station = input.stationFt ?? (input.moveByFt !== undefined ? obj.stationFt + input.moveByFt : acc.position);
        s = { ...s, access: s.access.map((a) => (a === acc ? { ...a, position: station, widthFt: input.widthFt ?? a.widthFt, lanes: input.lanes ?? a.lanes } : a)) };
        msg = `${obj.name} moved to station ${typeof station === 'number' ? fmtInt(station) : station} ft along ${obj.roadName}${input.widthFt ? `, ${input.widthFt} ft wide` : ''}.`;
        break;
      }
      case 'parkingField': {
        if (obj.auto) {
          if (input.rows !== undefined && s.program) {
            // Row count on the auto field is driven by the stall target.
            const perRow = obj.rows[obj.rows.length - 1]?.stalls ?? 40;
            s = { ...s, program: { ...s.program, carStalls: Math.max(1, input.rows * perRow - 12) } };
            msg = `Car stall target set for ${input.rows} rows of parking.`;
          }
          if (input.slopePct !== undefined) {
            s = { ...s, grading: { ...s.grading, criteria: { ...s.grading.criteria, parkingSlopePct: input.slopePct } } };
            msg += ` Parking slope set to ${input.slopePct}%.`;
          }
        } else {
          const rows = input.rows ?? obj.rows.length;
          const next = makeParkingField({ origin: shift(obj.origin), angleDeg: input.rotationDeg ?? obj.angleDeg, lengthFt: input.lengthFt ?? obj.lengthFt, rows, id: obj.id, name: obj.name, auto: false, slopePct: input.slopePct ?? obj.slopePct }, s.layoutCriteria);
          s = { ...s, objects: s.objects.map((o) => (o.id === obj.id ? next : o)) };
          msg = `${obj.name} updated: ${next.stallsTotal} stalls in ${rows} rows.`;
        }
        break;
      }
      case 'truckCourt': {
        if (input.trailerRow === undefined) throw new CommandError('Truck courts follow the building. You can set trailerRow (true/false); to move them, edit the building.');
        s = { ...s, prefs: { ...s.prefs, trailerRowInCourts: input.trailerRow } };
        msg = `Trailer row ${input.trailerRow ? 'added to' : 'removed from'} the truck courts (court depth ${input.trailerRow ? 185 : 130} ft).`;
        break;
      }
      case 'basin': {
        const moved = input.center || input.moveBy;
        const c = ringCentroid(obj.polygon);
        const nc = shift(c);
        const polygon = moved ? obj.polygon.map((q): Pt => [q[0] + nc[0] - c[0], q[1] + nc[1] - c[1]]) : obj.polygon;
        const next: Basin = { ...obj, polygon, auto: moved ? false : obj.auto, topElevFt: input.topElevFt === undefined ? obj.topElevFt : input.topElevFt, depthFt: input.depthFt ?? obj.depthFt };
        s = { ...s, objects: s.objects.map((o) => (o.id === obj.id ? next : o)) };
        msg = `${obj.name} updated${moved ? ' (moved; now a manual basin)' : ''}${input.topElevFt !== undefined ? `, top of berm ${input.topElevFt ?? 'auto'} ft` : ''}${input.depthFt ? `, depth ${input.depthFt} ft` : ''}.`;
        break;
      }
      case 'trailerField': {
        const next = makeTrailerField(obj.id, obj.name, shift(obj.center), input.rotationDeg ?? obj.rotationDeg, input.lengthFt ?? obj.lengthFt, input.rows ?? obj.rows, s.layoutCriteria);
        s = { ...s, objects: s.objects.map((o) => (o.id === obj.id ? next : o)) };
        msg = `${obj.name} updated: ${next.stalls} trailer stalls.`;
        break;
      }
      default:
        throw new CommandError(`${obj.name} (${obj.type}) is generated from other objects and cannot be edited directly. Edit the building, driveways or program instead.`);
    }
    const { project } = rebuild(p, s);
    return { project, log: msg.trim(), changedIds: [input.id], result: { summary: msg.trim() + failingSummary(deriveNow(project)), layoutNotes: activeScenario(project).results.layoutNotes } };
  },
});

defineCommand({
  name: 'delete_object',
  group: 'Program/layout',
  title: 'Delete object',
  description:
    'Delete a design object by id. Deleting the building clears the whole generated layout. Deleting a driveway removes ' +
    'that access. Deleting a generated basin, parking field or landscape strip hides it until the next generate_layout / ' +
    'place_building. Manual objects are removed outright. Returns what was removed and failing checks.',
  input: z.object({ id: z.string() }),
  mutates: true,
  handler: (p, input) => {
    requireSite(p);
    let s = activeScenario(p);
    const obj = s.objects.find((o) => o.id === input.id);
    if (!obj) throw new CommandError(`No object "${input.id}" in scenario ${s.id}. Objects: ${s.objects.map((o) => o.id).join(', ') || 'none'}.`, 'not_found');
    let msg: string;
    if (obj.type === 'building') {
      s = { ...s, placement: null, objects: s.objects.filter((o) => !o.auto), results: { ...s.results, layoutNotes: [] }, grading: { ...s.grading, graded: false, ffeFt: null } };
      msg = 'Deleted the building and the layout generated around it.';
      return { project: replaceScenario(p, s), log: msg, result: { summary: msg } };
    }
    if (obj.type === 'driveway' && obj.accessId) {
      s = { ...s, access: s.access.filter((a) => a.id !== obj.accessId) };
      msg = `Deleted ${obj.name} (access removed).`;
    } else if (!obj.auto) {
      s = { ...s, objects: s.objects.filter((o) => o.id !== obj.id) };
      msg = `Deleted ${obj.name}.`;
    } else if (obj.type === 'truckCourt' || obj.type === 'truckApron' || obj.type === 'drive') {
      throw new CommandError(`${obj.name} follows the building${obj.type === 'drive' ? ' and its driveway' : ''}. To remove it, change dockSides (place_building / edit_object) or delete the driveway.`);
    } else {
      s = { ...s, prefs: { ...s.prefs, omit: [...(s.prefs.omit ?? []), obj.id] } };
      msg = `Removed ${obj.name} (hidden until the layout is regenerated).`;
    }
    const { project } = rebuild(p, s);
    return { project, log: msg, changedIds: [input.id], result: { summary: msg + failingSummary(deriveNow(project)) } };
  },
});

function nextManualId(s: Scenario, prefix: string): string {
  let n = 1;
  while (s.objects.some((o) => o.id === `${prefix}-m${n}`)) n++;
  return `${prefix}-m${n}`;
}

export function makeTrailerField(id: string, name: string, center: Pt, rotationDeg: number, lengthFt: number, rows: number, c: LayoutCriteria): TrailerField {
  // One or two stall rows served by a maneuvering lane between/alongside them.
  const depthFt = rows * c.trailerStallLengthFt + c.maneuverLaneFt;
  return { id, name, auto: false, type: 'trailerField', center, rotationDeg, lengthFt, depthFt, rows, stalls: rows * Math.floor(lengthFt / c.trailerStallWidthFt), polygon: orientedRect(center, lengthFt, depthFt, rotationDeg) };
}

function checkManualPlacement(site: Site, rules: ZoningRuleSet, ring: Ring, kind: 'parking' | 'loading' | 'pavement'): string {
  const env = buildEnvelopes(site, rules);
  const region = kind === 'parking' ? env.parking : kind === 'loading' ? env.loading : env.pavement;
  return ringInsideRegion(ring, region, 0.05) ? '' : ` WARNING: it extends outside the ${kind} envelope (setback, residential buffer or constraint); see run_checks.`;
}

defineCommand({
  name: 'add_parking_field',
  group: 'Program/layout',
  title: 'Add parking field',
  description:
    'Add a manual car parking field: 90° rows with a 24 ft aisle, end islands and ADA stalls per Table 208.2. origin = [x, y] ' +
    'corner in site CRS feet; rotationDeg = direction of the rows (degrees CCW from east); lengthFt = row length; rows = ' +
    'number of stall rows (2 rows = one 64 ft double-loaded module). The field extends to the left of the row direction. ' +
    'Manual fields persist through layout regeneration and count toward the car stall total. Returns the id and stall counts.',
  input: z.object({ origin: PtSchema, rotationDeg: z.number().default(0), lengthFt: z.number().min(60).max(3000), rows: z.number().int().min(1).max(20).default(2), name: z.string().max(60).optional() }),
  mutates: true,
  handler: (p, input) => {
    const site = requireSite(p);
    const rules = requireRules(p);
    const s = activeScenario(p);
    const id = nextManualId(s, 'parking');
    const f = makeParkingField({ origin: input.origin, angleDeg: input.rotationDeg, lengthFt: input.lengthFt, rows: input.rows, id, name: input.name ?? 'Parking field (manual)', auto: false, slopePct: s.grading.criteria.parkingSlopePct }, s.layoutCriteria);
    const { project } = rebuild(p, { ...s, objects: [...s.objects, f] });
    const msg = `Added ${f.name}: ${f.stallsTotal} stalls (${f.stallsAda} accessible, ${f.stallsVan} van) in ${input.rows} rows, ${fmtInt(f.lengthFt)} × ${fmtInt(fieldDepthFt(input.rows, s.layoutCriteria))} ft, in the ${relativePosition(site, ringCentroid(f.polygon))}.`;
    return { project, log: msg, changedIds: [id], result: { summary: msg + checkManualPlacement(site, rules, f.polygon, 'parking'), id, stalls: f.stallsTotal, ada: f.stallsAda, van: f.stallsVan } };
  },
});

defineCommand({
  name: 'add_trailer_field',
  group: 'Program/layout',
  title: 'Add trailer field',
  description:
    'Add a manual trailer storage field (12 × 55 ft stalls along a 70 ft maneuvering lane). center = [x, y] in site CRS feet, ' +
    'rotationDeg = direction of the stall row (degrees CCW from east), lengthFt = row length, rows = 1 or 2. Use it when the ' +
    'truck courts cannot hold the trailer stall target. It is truck pavement: keep it clear of car parking. Returns the id and stall count.',
  input: z.object({ center: PtSchema, rotationDeg: z.number().default(0), lengthFt: z.number().min(60).max(3000), rows: z.number().int().min(1).max(2).default(1), name: z.string().max(60).optional() }),
  mutates: true,
  handler: (p, input) => {
    const site = requireSite(p);
    const rules = requireRules(p);
    const s = activeScenario(p);
    const id = nextManualId(s, 'trailer');
    const f = makeTrailerField(id, input.name ?? 'Trailer field (manual)', input.center, input.rotationDeg, input.lengthFt, input.rows, s.layoutCriteria);
    const { project } = rebuild(p, { ...s, objects: [...s.objects, f] });
    const msg = `Added ${f.name}: ${f.stalls} trailer stalls, ${fmtInt(f.lengthFt)} × ${fmtInt(f.depthFt)} ft, in the ${relativePosition(site, f.center)}.`;
    return { project, log: msg, changedIds: [id], result: { summary: msg + checkManualPlacement(site, rules, f.polygon, 'loading'), id, stalls: f.stalls } };
  },
});

defineCommand({
  name: 'add_basin',
  group: 'Program/layout',
  title: 'Add basin',
  description:
    'Add a manual stormwater basin footprint (planning-level reservation): center = [x, y] in site CRS feet, lengthFt × widthFt ' +
    'at the top of bank, rotationDeg (degrees CCW from east). Optional topElevFt (top-of-berm elevation, ft; default: from ' +
    'existing ground when graded) and depthFt (storage depth; default 3 ft for the area-based reservation, plus 1 ft freeboard, 3:1 sides). Manual basins persist and reduce ' +
    'the automatic reservation by their area. Returns the id, area (ac) and storage volume (CF).',
  input: z.object({ center: PtSchema, lengthFt: z.number().min(40).max(3000), widthFt: z.number().min(40).max(3000), rotationDeg: z.number().default(0), topElevFt: z.number().optional(), depthFt: z.number().min(1).max(20).optional(), name: z.string().max(60).optional() }),
  mutates: true,
  handler: (p, input) => {
    const site = requireSite(p);
    const rules = requireRules(p);
    const s = activeScenario(p);
    const id = nextManualId(s, 'basin');
    const polygon = orientedRect(input.center, input.lengthFt, input.widthFt, input.rotationDeg);
    const depthFt = input.depthFt ?? basinDepthFor(s.stormwater);
    const basin: Basin = {
      id,
      name: input.name ?? 'Stormwater basin (manual)',
      auto: false,
      type: 'basin',
      polygon,
      areaSf: ringArea(polygon),
      depthFt,
      freeboardFt: s.stormwater.freeboardFt,
      sideSlopeHtoV: s.stormwater.sideSlopeHtoV,
      storageCf: basinStorageCf(Math.min(input.lengthFt, input.widthFt), Math.max(input.lengthFt, input.widthFt), depthFt, s.stormwater.freeboardFt, s.stormwater.sideSlopeHtoV),
      topElevFt: input.topElevFt ?? null,
      meanExistingElevFt: 0,
    };
    const { project } = rebuild(p, { ...s, objects: [...s.objects, basin as DesignObject] });
    const msg = `Added ${basin.name}: ${fmtAc(basin.areaSf, 2)}, ${fmtInt(basin.storageCf)} CF below the design water surface, in the ${relativePosition(site, input.center)}.`;
    return { project, log: msg, changedIds: [id], result: { summary: msg + checkManualPlacement(site, rules, polygon, 'pavement'), id, areaAc: +(basin.areaSf / 43560).toFixed(2), storageCf: Math.round(basin.storageCf) } };
  },
});
