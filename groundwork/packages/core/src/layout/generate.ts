/**
 * Layout orchestration: given a program, a building placement and the access assignments, generate the
 * full test fit (building, truck courts, aprons, parking, driveways, routed drives, basins, landscape).
 * Deterministic; no search here (see solver.ts).
 */
import { type Pt, type Region, dist, regionArea, ringInsideRegion } from '../geometry/basic';
import { offsetRegion, unionSolids } from '../geometry/clip';
import type { Site } from '../site/model';
import type {
  Basin,
  DesignObject,
  Drive,
  Driveway,
  ParkingField,
  Placement,
  Scenario,
  TrailerField,
  TruckApron,
} from '../site/project';
import { fmtInt } from '../site/units';
import { imperviousRegion, parkingIslandSf, parkingRequired } from '../zoning/checks';
import { type Envelopes, constraintRegion } from '../zoning/envelopes';
import { type ZoningRuleSet, ruleNumber, ruleTable } from '../zoning/rules';
import { type RouteObstacles, makeDriveway, routeDrive } from './access';
import { basinFreeRegion, placeBasins, requiredBasinAreaSf } from './basin';
import { type Port, attachedFieldFrame, fieldDepthFt, fieldPorts, makeAprons, makeBuilding, makeCourts, makeParkingField, rowCapacity } from './building';
import { makeLandscape } from './landscape';

export type LayoutResult = {
  objects: DesignObject[];
  notes: string[];
  stats: {
    carStallsTarget: number;
    carStallsProvided: number;
    trailerTarget: number | 'max';
    trailerProvided: number;
    dockDoors: number;
    routesMissing: number;
    basinRequiredSf: number;
    basinPlacedSf: number;
    hardFailures: string[];
  };
};

/** Car stall target: explicit program value, else the stricter of the two § 27-1405 readings. */
export function carStallTarget(s: Scenario, rules: ZoningRuleSet): { target: number; basis: string } {
  if (s.program?.carStalls !== undefined) return { target: s.program.carStalls, basis: 'program' };
  const req = parkingRequired(s, rules);
  const vals = [req.storageReading, req.manufacturingReading].filter((v): v is number => v !== null);
  if (!vals.length) return { target: 0, basis: 'no employee counts given' };
  return { target: Math.max(...vals), basis: `stricter of the two § 27-1405 readings (${req.basis})` };
}

export function buildLayout(site: Site, rules: ZoningRuleSet, env: Envelopes, s: Scenario, placement: Placement, opts: { skipBasin?: boolean; skipRoutes?: boolean } = {}): LayoutResult {
  const program = s.program;
  if (!program) throw new Error('buildLayout requires a program');
  const c = s.layoutCriteria;
  const notes: string[] = [];
  const hardFailures: string[] = [];
  const manual = s.objects.filter((o) => !o.auto);

  // 1. Building ------------------------------------------------------------------------------
  const building = makeBuilding(program, placement, c);
  if (building.areaSf !== program.buildingSf && !program.lengthFt)
    notes.push(`Requested ${fmtInt(program.buildingSf)} SF; placed ${fmtInt(building.areaSf)} SF (${fmtInt(building.lengthFt)} × ${fmtInt(building.depthFt)} ft, length rounded up to the next foot).`);
  if (!ringInsideRegion(building.polygon, env.building, 0.05)) hardFailures.push('Building extends outside the building envelope (a required yard, the residential separation or a constraint).');

  // 2. Truck courts and aprons ---------------------------------------------------------------
  const courts = makeCourts(building, c, { trailerRow: s.prefs.trailerRowInCourts, trailerTarget: program.trailerStalls });
  const { aprons, ports: truckPorts } = makeAprons(building, courts, c);
  for (const court of courts) if (!ringInsideRegion(court.polygon, env.loading, 0.05)) hardFailures.push(`${court.name} extends outside the loading envelope (required front yard, parking setback or residential buffer).`);
  for (const a of aprons) if (!ringInsideRegion(a.polygon, env.pavement, 0.05)) hardFailures.push(`${a.name} extends outside the pavement envelope.`);
  const manualTrailers = manual.filter((o): o is TrailerField => o.type === 'trailerField');
  const trailerProvided = courts.reduce((n, x) => n + x.trailerStalls, 0) + manualTrailers.reduce((n, x) => n + x.stalls, 0);
  if (program.trailerStalls !== 'max' && trailerProvided < program.trailerStalls) {
    notes.push(
      `Requested ${program.trailerStalls} trailer stalls; placed ${trailerProvided}. Limiting factor: truck court length (building length ${fmtInt(building.lengthFt)} ft at ${c.trailerStallWidthFt} ft per stall${s.prefs.trailerRowInCourts ? '' : '; trailer rows are turned off'}). Options: lengthen the building, or add a trailer storage field with add_trailer_field.`,
    );
  }
  if (program.dockDoors !== 'max' && building.dockDoors < program.dockDoors)
    notes.push(`Requested ${program.dockDoors} dock doors; placed ${building.dockDoors}. Limiting factor: dock wall length at ${c.dockDoorSpacingFt} ft o.c. with ${c.dockCornerClearFt} ft clear at each corner.`);

  // 3. Car parking ---------------------------------------------------------------------------
  const { target: carTarget, basis } = carStallTarget(s, rules);
  const p2b = ruleTable(rules, 'setback.parking.toBuilding')?.minFt ?? 20;
  const manualFields = manual.filter((o): o is ParkingField => o.type === 'parkingField');
  const fields: ParkingField[] = [];
  let need = carTarget - manualFields.reduce((n, f) => n + f.stallsTotal, 0);
  if (carTarget === 0 && !manualFields.length) notes.push('No car parking generated: give employees per shift (or carStalls) in set_program so § 27-1405 can be applied.');
  if (need > 0) {
    const fr = attachedFieldFrame(building, building.carSide, p2b);
    const cap = rowCapacity(fr.lengthFt, c);
    let best: ParkingField | null = null as ParkingField | null;
    if (cap.stalls > 0) {
      const maxRows = 16;
      for (let rows = 1; rows <= maxRows; rows++) {
        const f = makeParkingField({ ...fr, rows, id: 'parking-1', name: 'Employee parking', auto: true, slopePct: s.grading.criteria.parkingSlopePct, attachedTo: { buildingId: building.id, side: building.carSide } }, c);
        if (!ringInsideRegion(f.polygon, env.parking, 0.05)) break;
        best = f;
        if (f.stallsTotal >= need) break;
      }
    }
    if (best) {
      fields.push(best);
      need -= best.stallsTotal;
      if (need > 0) {
        const nextDepth = fieldDepthFt(best.rows.length + 1, c);
        notes.push(
          `Requested ${carTarget} car stalls (${basis}); placed ${best.stallsTotal}. Limiting factor: parking envelope depth beside the building (${fmtInt(best.depthFt)} ft used; the next row needs ${fmtInt(nextDepth)} ft). Options: shift the building away from that side, or add a second field with add_parking_field.`,
        );
      }
    } else {
      notes.push(`No room for car parking on the ${building.carSide} side of the building within the parking envelope (${p2b} ft from the building, setbacks and the residential buffer). Move the building or change carSide.`);
    }
  }
  const allFields = [...fields, ...manualFields];
  const carProvided = allFields.reduce((n, f) => n + f.stallsTotal, 0);

  // 4. Driveways -----------------------------------------------------------------------------
  const spacing = ruleNumber(rules, 'driveway.spacingFt', 150);
  const driveways: Driveway[] = [];
  const carPorts: Port[] = allFields.flatMap((f) => fieldPorts(f, c));
  const order = [...s.access].sort((a, b) => (a.network === b.network ? 0 : a.network === 'truck' ? -1 : b.network === 'truck' ? 1 : a.network === 'car' ? -1 : 1));
  for (const acc of order) {
    const ports = acc.network === 'truck' ? truckPorts : acc.network === 'car' ? carPorts : [...truckPorts, ...carPorts];
    // Aim at the port nearest this road's frontage.
    let target: Pt | null = null;
    const index = s.access.indexOf(acc);
    const probe = makeDriveway(site, { ...acc, position: 'auto' }, index, null, [], c, spacing).driveway;
    if (probe && ports.length) {
      let bestD = Infinity;
      for (const p of ports) {
        const d = dist(p.outside, probe.position);
        if (d < bestD) {
          bestD = d;
          target = p.outside;
        }
      }
      // Re-aim using the frontage-projected distance rather than the mid-frontage probe.
      const again = makeDriveway(site, { ...acc, position: 'auto' }, index, target, [], c, spacing).driveway;
      if (again) {
        bestD = Infinity;
        for (const p of ports) {
          const d = dist(p.outside, again.position);
          if (d < bestD) {
            bestD = d;
            target = p.outside;
          }
        }
      }
    }
    const r = makeDriveway(site, acc, index, target, driveways, c, spacing);
    if (r.note) notes.push(r.note);
    if (r.driveway) driveways.push(r.driveway);
  }

  // 5. Routed drives (truck network first, then cars around it) ------------------------------
  const drives: Drive[] = [];
  let routesMissing = 0;
  const manualBasins = manual.filter((o): o is Basin => o.type === 'basin');
  if (!opts.skipRoutes) {
    const truckSolid: Region[] = [...courts.map((x) => [x.polygon]), ...aprons.map((x) => [x.polygon]), ...manualTrailers.map((x) => [x.polygon])];
    const carSolid: Region[] = allFields.map((f) => [f.polygon]);
    const obstacles: RouteObstacles = {
      allowed: env.pavement,
      building: [building.polygon],
      truckPavement: truckSolid,
      carPavement: carSolid,
      other: manualBasins.map((b) => [b.polygon]),
    };
    // Own-network pavement is blocked for routing, so drives reach courts only through the apron ports
    // and never cut through a trailer row.
    for (const d of driveways) {
      const ports = d.network === 'truck' ? truckPorts : d.network === 'car' ? carPorts : [...carPorts, ...truckPorts];
      const width = d.network === 'truck' ? c.truckDriveWidthFt : c.carDriveWidthFt;
      const r = routeDrive(site, obstacles, d, ports, width, c, `drive-${drives.length + routesMissing + 1}`);
      if (r.drive) {
        drives.push(r.drive);
        if (d.network === 'truck') obstacles.truckPavement.push(r.drive.polygon);
        else if (d.network === 'car') obstacles.carPavement.push(r.drive.polygon);
      } else {
        routesMissing++;
        if (r.note) notes.push(r.note);
      }
    }
  }
  const hasTruck = s.access.some((a) => a.network === 'truck');
  const hasCar = s.access.some((a) => a.network === 'car');
  if (!hasTruck) notes.push('No truck access assigned. Use set_access {network: "truck", road: …}.');
  if (!hasCar && allFields.length) notes.push('No car access assigned. Use set_access {network: "car", road: …}.');

  // 6. Stormwater reservation ----------------------------------------------------------------
  const placedSoFar: DesignObject[] = [building, ...courts, ...aprons, ...allFields, ...manualTrailers, ...driveways, ...drives];
  const impervSf = regionArea(imperviousRegion(placedSoFar)) - parkingIslandSf(placedSoFar);
  const reqBasin = requiredBasinAreaSf(s.stormwater, site.areaSf, impervSf);
  const manualBasinSf = manualBasins.reduce((n, b) => n + b.areaSf, 0);
  let basins: Basin[] = [];
  let basinPlaced = manualBasinSf;
  if (!opts.skipBasin) {
    const needSf = Math.max(0, reqBasin.areaSf - manualBasinSf);
    if (needSf > 400) {
      const free = basinFreeRegion(env.pavement, [
        { region: [building.polygon], inflateFt: 30 },
        { region: unionSolids([...courts.map((x) => [x.polygon]), ...aprons.map((x) => [x.polygon]), ...allFields.map((x) => [x.polygon]), ...manualTrailers.map((x) => [x.polygon])]), inflateFt: 20 },
        { region: unionSolids(drives.map((d) => d.polygon)), inflateFt: 15 },
        { region: unionSolids(driveways.map((d) => [d.polygon])), inflateFt: 40 },
        { region: unionSolids(manualBasins.map((b) => [b.polygon])), inflateFt: 20 },
        { region: constraintRegion(site), inflateFt: 5 },
      ]);
      const r = placeBasins({ dem: site.dem, free, angleDeg: building.rotationDeg, requiredAreaSf: needSf, sw: s.stormwater, startIndex: manualBasins.length });
      basins = r.basins;
      basinPlaced += r.placedAreaSf;
      if (r.note) notes.push(r.note);
    }
  }

  // 7. Landscape -----------------------------------------------------------------------------
  const west = ruleTable(rules, 'landscape.westWallScreen');
  const landscape = makeLandscape(site, building, allFields, c, west ? { wallMinFt: west.wallMinFt, withinFt: west.withinFt } : null, p2b);

  const autoObjects: DesignObject[] = [building, ...courts, ...(aprons as TruckApron[]), ...fields, ...driveways, ...drives, ...basins, ...landscape];
  if (hardFailures.length) notes.unshift(...hardFailures);
  return {
    objects: [...autoObjects, ...manual],
    notes,
    stats: {
      carStallsTarget: carTarget,
      carStallsProvided: carProvided,
      trailerTarget: program.trailerStalls,
      trailerProvided,
      dockDoors: building.dockDoors,
      routesMissing,
      basinRequiredSf: reqBasin.areaSf,
      basinPlacedSf: basinPlaced,
      hardFailures,
    },
  };
}

/** Inflate helper re-exported for the solver. */
export function inflate(region: Region, d: number): Region {
  return offsetRegion(region, d, 'miter');
}
