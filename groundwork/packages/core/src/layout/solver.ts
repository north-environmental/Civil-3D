/**
 * Auto-solver for generate_layout: enumerate orientations × positions on a coarse grid inside the
 * building envelope, score each candidate cheaply, then build the full layout for the best few.
 *
 * Score (lower is better): hard constraints must pass; then program attainment, soft preferences
 * (docks not facing residential, short truck/car routes) and an earthwork proxy (std-dev of existing
 * elevation under the pad and truck courts).
 */
import { type Pt, type Ring, bboxOfRegion, closestOnPolyline, distToPolyline, dot, norm360, outwardNormalOf, radToDeg, ringInsideRegion, ringToSegmentDist, toWorld } from '../geometry/basic';
import { sampleGrid } from '../geometry/grid';
import type { Site } from '../site/model';
import type { Placement, Program, Scenario, Side } from '../site/project';
import type { Envelopes } from '../zoning/envelopes';
import { type Frontage, findRoad, frontages } from '../zoning/edges';
import { type ZoningRuleSet, ruleTable } from '../zoning/rules';
import { attachedFieldFrame, buildingDims, courtDepth, fieldDepthFt, makeAprons, makeBuilding, makeCourts, rowCapacity, truckEnd } from './building';
import { buildGradingObjects, feasibleFfeRange } from '../grading/objects';
import { type LayoutResult, buildLayout, carStallTarget } from './generate';

/** Preferred minimum distance from the truck apron to its street frontage (throat + queuing), ft. EFCG default. */
const MIN_TRUCK_APPROACH_FT = 300;

export type SolverOptions = {
  /** Fixed rotation of the long axis, degrees CCW from east. */
  rotationDeg?: number;
  /** Road whose frontage the long axis should parallel. */
  alignToRoad?: string;
  /** Position grid step, ft. */
  stepFt?: number;
  /** Candidates built in full. */
  keep?: number;
};

export type Candidate = {
  placement: Placement;
  score: number;
  parts: { stallShortfall: number; rows: number; stdElevFt: number; truckFt: number; carFt: number; residentialPenalty: number };
};

export type SolveResult = {
  placement: Placement;
  layout: LayoutResult;
  rationale: string;
  alternatives: { rotationDeg: number; carSide: Side; offsetFt: number; scoreDelta: number; note: string }[];
  evaluated: number;
  feasible: number;
};

/** Direction (degrees CCW from east) of a road's frontage along the parcel. */
export function frontageAngleDeg(f: Frontage): number {
  const a = f.line[0];
  const b = f.line[f.line.length - 1];
  return norm360(radToDeg(Math.atan2(b[1] - a[1], b[0] - a[0])));
}

function candidateSides(program: Program): { dockSides: Side[]; carSide: Side }[] {
  if (program.buildingType === 'crossDock')
    return [
      { dockSides: ['+v', '-v'], carSide: '-u' },
      { dockSides: ['+v', '-v'], carSide: '+u' },
    ];
  return [
    { dockSides: ['-v'], carSide: '+v' },
    { dockSides: ['+v'], carSide: '-v' },
  ];
}

export function solveLayout(site: Site, rules: ZoningRuleSet, env: Envelopes, s: Scenario, opts: SolverOptions = {}): SolveResult | { error: string; evaluated: number } {
  const program = s.program!;
  const c = s.layoutCriteria;
  const { lengthFt, depthFt } = buildingDims(program, c);
  const fr = frontages(site.edges);
  const p2b = ruleTable(rules, 'setback.parking.toBuilding')?.minFt ?? 20;
  const { target: carTarget } = carStallTarget(s, rules);
  const westRule = ruleTable(rules, 'landscape.westWallScreen');

  // Orientations -----------------------------------------------------------------------------
  let angles: number[] = [];
  let alignedTo: string | undefined;
  if (opts.rotationDeg !== undefined) angles = [opts.rotationDeg];
  else if (opts.alignToRoad) {
    const road = findRoad(site, opts.alignToRoad);
    const f = road ? fr.find((x) => x.roadId === road.id) : undefined;
    if (!f) return { error: `Cannot align to "${opts.alignToRoad}": the parcel has no frontage on that road. Frontages: ${fr.map((x) => x.roadName).join(', ') || 'none'}.`, evaluated: 0 };
    angles = [Math.round(frontageAngleDeg(f) * 10) / 10 % 180];
    alignedTo = f.roadName;
  } else {
    const set = new Set<number>();
    for (let a = 0; a < 180; a += 5) set.add(a);
    for (const f of fr) {
      const a = Math.round((frontageAngleDeg(f) % 180) * 10) / 10;
      set.add(a);
      set.add(Math.round(((a + 90) % 180) * 10) / 10);
    }
    angles = [...set].sort((x, y) => x - y);
  }

  const truckFronts = s.access.filter((a) => a.network === 'truck').map((a) => fr.find((f) => f.roadId === findRoad(site, a.road)?.id)).filter((f): f is Frontage => !!f);
  const carFronts = s.access.filter((a) => a.network === 'car').map((a) => fr.find((f) => f.roadId === findRoad(site, a.road)?.id)).filter((f): f is Frontage => !!f);
  const resEdges = site.edges.filter((e) => e.abutsResidential || e.acrossStreetFromResidential);
  const depthWithCourt = courtDepth(c, s.prefs.trailerRowInCourts);
  const step = opts.stepFt ?? 50;
  const bb = bboxOfRegion(env.building);
  const cap = (len: number) => rowCapacity(len, c).stalls;

  const candidates: Candidate[] = [];
  let evaluated = 0;
  for (const rotationDeg of angles) {
    for (const sides of candidateSides(program)) {
      for (let x = bb.minX + step / 2; x < bb.maxX; x += step) {
        for (let y = bb.minY + step / 2; y < bb.maxY; y += step) {
          evaluated++;
          const placement: Placement = { center: [x, y], rotationDeg, dockSides: sides.dockSides, carSide: sides.carSide, source: 'solver', alignedToRoad: alignedTo };
          const b = makeBuilding(program, placement, c);
          if (!ringInsideRegion(b.polygon, env.building)) continue;
          const courts = makeCourts(b, c, { trailerRow: s.prefs.trailerRowInCourts, trailerTarget: program.trailerStalls });
          if (!courts.every((ct) => ringInsideRegion(ct.polygon, env.loading))) continue;
          const { aprons } = makeAprons(b, courts, c);
          if (!aprons.every((a) => ringInsideRegion(a.polygon, env.pavement))) continue;

          // Car parking capacity on the car side (rows that fit the parking envelope).
          const ff = attachedFieldFrame(b, sides.carSide, p2b);
          const perRow = cap(ff.lengthFt);
          const rowsWanted = perRow > 0 ? Math.min(16, Math.ceil((carTarget + 12) / perRow)) : 0;
          let rows = 0;
          for (let r = rowsWanted; r >= 1; r--) {
            const d = fieldDepthFt(r, c);
            const ring: Ring = [toWorld({ origin: ff.origin, angleDeg: ff.angleDeg }, [0, 0]), toWorld({ origin: ff.origin, angleDeg: ff.angleDeg }, [ff.lengthFt, 0]), toWorld({ origin: ff.origin, angleDeg: ff.angleDeg }, [ff.lengthFt, d]), toWorld({ origin: ff.origin, angleDeg: ff.angleDeg }, [0, d])];
            if (ringInsideRegion(ring, env.parking)) {
              rows = r;
              break;
            }
          }
          const stalls = rows * perRow;
          const stallShortfall = carTarget > 0 ? Math.max(0, carTarget - stalls) / carTarget : 0;

          // Earthwork proxy: std-dev of existing ground under the pad and the truck courts.
          let sum = 0;
          let sum2 = 0;
          let n = 0;
          const f = { origin: b.center, angleDeg: rotationDeg };
          const vExt = b.depthFt / 2 + (sides.dockSides.length ? depthWithCourt : 0);
          for (let iu = 0; iu <= 6; iu++) {
            for (let iv = 0; iv <= 6; iv++) {
              const u = -lengthFt / 2 + (lengthFt * iu) / 6;
              const vv = -vExt + (2 * vExt * iv) / 6;
              if (sides.dockSides.length === 1 && Math.sign(vv) !== (sides.dockSides[0] === '+v' ? 1 : -1) && Math.abs(vv) > depthFt / 2) continue;
              const w = toWorld(f, [u, vv]);
              const z = sampleGrid(site.dem, w[0], w[1]);
              sum += z;
              sum2 += z * z;
              n++;
            }
          }
          const mean = sum / n;
          const stdElevFt = Math.sqrt(Math.max(0, sum2 / n - mean * mean));

          // Route-length proxies.
          const end = truckEnd(b);
          const truckPt: Pt = end !== null ? toWorld(f, [end * (lengthFt / 2 + 40), 0]) : toWorld(f, [0, (sides.dockSides[0] === '+v' ? 1 : -1) * (depthFt / 2 + 100)]);
          const carPt: Pt = toWorld({ origin: ff.origin, angleDeg: ff.angleDeg }, [ff.lengthFt / 2, fieldDepthFt(Math.max(1, rows), c)]);
          const distTo = (pt: Pt, list: Frontage[]) => (list.length ? list.reduce((a, x) => a + distToPolyline(pt, x.line), 0) / list.length : fr.length ? Math.min(...fr.map((x) => distToPolyline(pt, x.line))) : 0);
          const truckFt = distTo(truckPt, truckFronts);
          const carFt = distTo(carPt, carFronts);

          // Drive-profile feasibility (SPEC §5.2.5): the pad sits near mean existing ground, so a driveway whose
          // road is much higher or lower than that needs length to make up the difference at the max grade.
          let profilePenalty = 0;
          const gc = s.grading.criteria;
          const profile = (pt: Pt, list: Frontage[], below: number, maxPct: number) => {
            for (const fx of list) {
              const cp = closestOnPolyline(pt, fx.line);
              const zRoad = sampleGrid(site.dem, cp.pt[0], cp.pt[1]);
              const need = Math.abs(zRoad - (mean - below));
              profilePenalty += Math.max(0, need - (maxPct / 100) * Math.max(60, cp.d - 40));
            }
          };
          profile(truckPt, truckFronts, gc.dockHeightFt, gc.truckDriveMaxGradePct);
          profile(carPt, carFronts, gc.parkingAnchorBelowFfeFt, gc.carDriveMaxGradePct);

          // Docks facing residential: penalty fades with distance.
          let residentialPenalty = 0;
          if (s.prefs.docksAwayFromResidential) {
            for (const ct of courts) {
              const cx = (ct.polygon[0][0] + ct.polygon[2][0]) / 2;
              const cy = (ct.polygon[0][1] + ct.polygon[2][1]) / 2;
              const out: Pt = [cx - b.center[0], cy - b.center[1]];
              const l = Math.hypot(out[0], out[1]) || 1;
              for (const e of resEdges) {
                const nrm = outwardNormalOf(site.parcel.ring, e.index);
                const facing = dot([out[0] / l, out[1] / l], nrm);
                if (facing < 0.5) continue;
                const d = ringToSegmentDist(ct.polygon, e.a, e.b);
                residentialPenalty += facing * Math.max(0, 1 - d / 900);
              }
            }
          }

          // A dock wall longer than the ordinance threshold that faces W / SW / NW cannot take the required
          // screen planting (§ 27-1304.1.B.3.b) because the truck court is in the way: strongly avoid it.
          let westWallPenalty = 0;
          if (westRule && lengthFt > westRule.wallMinFt) {
            for (const side of sides.dockSides) {
              const mathDeg = norm360(rotationDeg + (side === '+v' ? 90 : 270));
              const az = norm360(90 - mathDeg);
              if (az >= 202.5 && az <= 337.5) westWallPenalty += 1;
            }
          }

          // Weights: truck pavement is the costliest to build, so its route length counts more than the car
          // drive; but a truck entrance needs queuing length, so nothing is gained below MIN_TRUCK_APPROACH_FT.
          const score = 400 * stallShortfall + 6 * stdElevFt + 0.016 * Math.max(truckFt, MIN_TRUCK_APPROACH_FT) + 0.007 * carFt + 14 * residentialPenalty + (truckFt < MIN_TRUCK_APPROACH_FT ? 0.05 * (MIN_TRUCK_APPROACH_FT - truckFt) : 0) + 150 * westWallPenalty + 5 * profilePenalty;
          candidates.push({ placement, score, parts: { stallShortfall, rows, stdElevFt, truckFt, carFt, residentialPenalty } });
        }
      }
    }
  }
  if (!candidates.length) {
    return {
      error:
        `No feasible position for a ${Math.round(lengthFt)} × ${Math.round(depthFt)} ft building with ${program.buildingType === 'crossDock' ? 'two' : 'one'} ${Math.round(depthWithCourt)} ft truck court(s) inside the envelopes` +
        (alignedTo ? ` when aligned to ${alignedTo}` : opts.rotationDeg !== undefined ? ` at ${opts.rotationDeg}°` : '') +
        `. Options: reduce building SF, turn off trailer rows in the courts (130 ft courts), choose a different orientation, or use a rear-load building.`,
      evaluated,
    };
  }
  candidates.sort((a, b) => a.score - b.score);

  // Keep the best few that differ meaningfully, and build them in full.
  const keep = opts.keep ?? 5;
  const picked: Candidate[] = [];
  for (const cnd of candidates) {
    const similar = picked.some((p) => p.placement.rotationDeg === cnd.placement.rotationDeg && p.placement.carSide === cnd.placement.carSide && Math.hypot(p.placement.center[0] - cnd.placement.center[0], p.placement.center[1] - cnd.placement.center[1]) < 175);
    if (similar) continue;
    picked.push(cnd);
    if (picked.length >= keep) break;
  }
  const full = picked.map((cnd) => {
    const layout = buildLayout(site, rules, env, s, cnd.placement);
    const basinShort = layout.stats.basinRequiredSf > 0 ? Math.max(0, 1 - layout.stats.basinPlacedSf / layout.stats.basinRequiredSf) : 0;
    const carShort = layout.stats.carStallsTarget > 0 ? Math.max(0, layout.stats.carStallsTarget - layout.stats.carStallsProvided) / layout.stats.carStallsTarget : 0;
    // Exact drive-grade feasibility on the routed drives: how far mean ground under the pad lies outside the FFE range.
    const setup = buildGradingObjects(site, { ...s, objects: layout.objects });
    const range = feasibleFfeRange(setup.drives);
    const ffeGapFt = range ? Math.max(0, range.minFt - setup.padMeanExistingFt, setup.padMeanExistingFt - range.maxFt) : 0;
    const total = cnd.score - 400 * cnd.parts.stallShortfall + 400 * carShort + 250 * layout.stats.routesMissing + 120 * basinShort + 1000 * layout.stats.hardFailures.length + 10 * ffeGapFt;
    return { cnd, layout, total, basinShort, ffeGapFt };
  });
  full.sort((a, b) => a.total - b.total);
  const best = full[0];
  const bp = best.cnd.parts;
  const st = best.layout.stats;
  const rationale =
    `Chose this position out of ${candidates.length.toLocaleString('en-US')} feasible candidates (${evaluated.toLocaleString('en-US')} tried): ` +
    `${st.carStallsProvided} of ${st.carStallsTarget} car stalls, ${st.trailerProvided} trailer stalls, ${st.dockDoors} dock doors; ` +
    `existing ground under the pad and courts varies by σ ${bp.stdElevFt.toFixed(1)} ft (flatter is cheaper to grade); ` +
    `truck apron about ${Math.round(bp.truckFt)} ft and parking about ${Math.round(bp.carFt)} ft from their assigned frontages` +
    (bp.residentialPenalty > 0.05 ? '; a dock court faces a residential district (mitigated by distance and the buffer planting)' : '; no dock court faces a residential district at close range') +
    (best.basinShort > 0.03 ? `; stormwater reservation is ${(best.basinShort * 100).toFixed(0)}% short` : '') +
    (best.ffeGapFt > 0.5 ? `; drive grades force the floor about ${best.ffeGapFt.toFixed(1)} ft away from mean existing ground (expect import or export)` : '; drive grades allow the floor to sit at mean existing ground') +
    '.';
  const alternatives = full.slice(1, 4).map((x) => ({
    rotationDeg: x.cnd.placement.rotationDeg,
    carSide: x.cnd.placement.carSide,
    offsetFt: Math.round(Math.hypot(x.cnd.placement.center[0] - best.cnd.placement.center[0], x.cnd.placement.center[1] - best.cnd.placement.center[1])),
    scoreDelta: Math.round((x.total - best.total) * 10) / 10,
    note:
      `${x.cnd.placement.rotationDeg !== best.cnd.placement.rotationDeg ? `rotated to ${x.cnd.placement.rotationDeg}°, ` : ''}` +
      `${x.cnd.placement.carSide !== best.cnd.placement.carSide ? 'cars on the opposite side, ' : ''}` +
      `σ ${(x.cnd.parts.stdElevFt - bp.stdElevFt >= 0 ? '+' : '') + (x.cnd.parts.stdElevFt - bp.stdElevFt).toFixed(1)} ft, ` +
      `truck route ${(x.cnd.parts.truckFt - bp.truckFt >= 0 ? '+' : '') + Math.round(x.cnd.parts.truckFt - bp.truckFt)} ft, ` +
      `${x.layout.stats.carStallsProvided} car stalls` +
      (x.layout.stats.routesMissing ? `, ${x.layout.stats.routesMissing} route(s) not found` : ''),
  }));
  return { placement: best.cnd.placement, layout: best.layout, rationale, alternatives, evaluated, feasible: candidates.length };
}
