/**
 * Zoning compliance: every rule in the active rule set is evaluated into a Check
 * {status, value, limit, units, citation, objectIds, message}. Rules that need a layout are n/a until one exists.
 */
import {
  type Pt,
  type Region,
  type Ring,
  azimuthDeg,
  dot,
  norm,
  outwardNormalOf,
  regionArea,
  regionToRingDist,
  ringArea,
  ringToRingDist,
  ringToSegmentDist,
  sub,
} from '../geometry/basic';
import { intersect, unionSolids } from '../geometry/clip';
import type { Site } from '../site/model';
import type { Building, Check, CheckStatus, DesignObject, Driveway, ParkingField, Scenario } from '../site/project';
import { compass8, fmtInt } from '../site/units';
import { frontages } from './edges';
import type { Envelopes } from './envelopes';
import { type ZoningRuleSet, findRule, loadingBerthsRequired, ruleNumber, ruleTable } from './rules';

const r1 = (v: number) => Math.round(v * 10) / 10;

export type ParkingRequirement = {
  /** Default reading: § 27-1405 item S (service and storage) + item W (office). */
  storageReading: number | null;
  /** Alternate reading: item V (manufacturing-district uses) + item W. */
  manufacturingReading: number | null;
  officeSpaces: number;
  basis: string;
};

export function parkingRequired(s: Scenario, rules: ZoningRuleSet): ParkingRequirement {
  const p = s.program;
  const perTwo = ruleNumber(rules, 'parking.ratio.perEmployeeTwoShifts', 0.5);
  const perLargest = ruleNumber(rules, 'parking.ratio.perEmployeeLargestShift', 1);
  const officeSf = ruleNumber(rules, 'parking.ratio.officeSfPerSpace', 200);
  const office = p ? Math.ceil(p.officeSf / officeSf - 1e-9) : 0;
  const st = p?.employeesTwoLargestShifts !== undefined ? Math.ceil(p.employeesTwoLargestShifts * perTwo - 1e-9) + office : null;
  const mf = p?.employeesLargestShift !== undefined ? Math.ceil(p.employeesLargestShift * perLargest - 1e-9) + office : null;
  const basis = p
    ? `S: ${p.employeesTwoLargestShifts ?? '—'} employees on the two largest shifts × ${perTwo} + office ${fmtInt(p.officeSf)} SF / ${officeSf} = ${st ?? '—'}; ` +
      `V: ${p.employeesLargestShift ?? '—'} on the largest shift × ${perLargest} + office = ${mf ?? '—'}`
    : 'no program';
  return { storageReading: st, manufacturingReading: mf, officeSpaces: office, basis };
}

/** All impervious cover (building + pavement) as one region, for coverage and landscape math. */
export function imperviousRegion(objects: DesignObject[]): Region {
  const parts: Region[] = [];
  for (const o of objects) {
    if (o.type === 'building' || o.type === 'truckCourt' || o.type === 'truckApron' || o.type === 'trailerField' || o.type === 'parkingField' || o.type === 'driveway') parts.push([o.polygon]);
    else if (o.type === 'drive') parts.push(o.polygon);
  }
  return unionSolids(parts);
}
export function parkingIslandSf(objects: DesignObject[]): number {
  return objects.reduce((s, o) => (o.type === 'parkingField' ? s + o.islandSf : s), 0);
}

function polyOf(o: DesignObject): Ring[] {
  return o.type === 'drive' ? o.polygon : [o.polygon];
}

export function evaluateZoningChecks(site: Site, rules: ZoningRuleSet, s: Scenario, env: Envelopes): Check[] {
  const checks: Check[] = [];
  const add = (key: string, title: string, status: CheckStatus, message: string, o: Partial<Check> = {}) => {
    const rule = findRule(rules, key);
    checks.push({
      id: `z.${key}${o.id ? `.${o.id}` : ''}`,
      ruleId: rule?.id ?? key,
      group: 'zoning',
      category: rule?.category ?? 'lot',
      title,
      status,
      value: o.value ?? null,
      limit: o.limit ?? null,
      units: o.units ?? '',
      citation: rule ? `${rule.citation.section}${rule.confirmed ? '' : ' (proposed, unconfirmed)'}` : '',
      objectIds: o.objectIds ?? [],
      message,
    });
  };
  const has = (key: string) => !!findRule(rules, key);
  const objs = s.objects;
  const building = objs.find((o): o is Building => o.type === 'building');
  const fields = objs.filter((o): o is ParkingField => o.type === 'parkingField');
  const courts = objs.filter((o) => o.type === 'truckCourt' || o.type === 'truckApron' || o.type === 'trailerField');
  const driveways = objs.filter((o): o is Driveway => o.type === 'driveway');
  const fr = frontages(site.edges);

  // ---- Use and lot -------------------------------------------------------------------------
  if (has('use.permitted')) add('use.permitted', 'Permitted use', 'pass', `Distribution warehouse is permitted by right in ${rules.districtName}.`);
  if (has('lot.minAreaAc')) {
    const min = ruleNumber(rules, 'lot.minAreaAc', 0);
    const ac = site.areaSf / 43560;
    add('lot.minAreaAc', 'Minimum lot area', ac >= min ? 'pass' : 'fail', `Lot area ${ac.toFixed(1)} ac vs ${min} ac minimum.`, { value: r1(ac), limit: min, units: 'ac' });
  }
  if (has('lot.minWidthFt')) {
    const min = ruleNumber(rules, 'lot.minWidthFt', 0);
    // Lot width measured along the primary frontage direction (extent of the parcel).
    const main = fr.slice().sort((a, b) => b.lengthFt - a.lengthFt)[0];
    let width = 0;
    if (main) {
      const d = norm(sub(main.line[main.line.length - 1], main.line[0]));
      const proj = site.parcel.ring.map((p) => dot(p, d));
      width = Math.max(...proj) - Math.min(...proj);
    } else {
      const xs = site.parcel.ring.map((p) => p[0]);
      width = Math.max(...xs) - Math.min(...xs);
    }
    add('lot.minWidthFt', 'Minimum lot width', width >= min ? 'pass' : 'fail', `Lot width ${fmtInt(width)} ft vs ${min} ft minimum.`, { value: Math.round(width), limit: min, units: 'ft' });
  }

  // ---- Coverage ----------------------------------------------------------------------------
  if (has('lot.maxCoveragePct')) {
    const max = ruleNumber(rules, 'lot.maxCoveragePct', 100);
    if (!building) add('lot.maxCoveragePct', 'Lot coverage (buildings)', 'n/a', 'No building placed yet.', { limit: max, units: '%' });
    else {
      const cov = (building.areaSf / site.areaSf) * 100;
      add('lot.maxCoveragePct', 'Lot coverage (buildings)', cov <= max ? 'pass' : 'fail', `Building footprint covers ${cov.toFixed(1)}% of the lot vs ${max}% maximum (buildings-only reading).`, {
        value: r1(cov),
        limit: max,
        units: '%',
        objectIds: [building.id],
      });
      const imp = ((regionArea(imperviousRegion(objs)) - parkingIslandSf(objs)) / site.areaSf) * 100;
      add(
        'lot.maxCoveragePct',
        'Lot coverage (impervious reading)',
        imp <= max ? 'pass' : 'warn',
        imp <= max
          ? `Impervious cover is ${imp.toFixed(1)}%, also within ${max}% if "lot coverage" includes pavement.`
          : `Impervious cover is ${imp.toFixed(1)}%, which would exceed ${max}% IF "lot coverage" (§ 27-102) includes pavement. Confirm the definition.`,
        { id: 'impervious', value: r1(imp), limit: max, units: '%' },
      );
    }
  }

  // ---- Building yards ----------------------------------------------------------------------
  const yardCheck = (key: string, title: string, edgeFilter: (i: number) => boolean, id?: string) => {
    if (!has(key)) return;
    const edges = site.edges.filter((e) => edgeFilter(e.index));
    if (!edges.length) return;
    const limit = Math.max(...edges.map((e) => env.edgeSetbacks[e.index].buildingFt));
    if (!building) return add(key, title, 'n/a', 'No building placed yet.', { id, limit, units: 'ft' });
    let worst = Infinity;
    let worstEdge = edges[0];
    for (const e of edges) {
      // Measured from the street ROW line, which can sit inside a lot line deeded to the centerline.
      const d = ringToSegmentDist(building.polygon, e.a, e.b) - env.edgeSetbacks[e.index].buildingLineFt;
      if (d < worst) {
        worst = d;
        worstEdge = e;
      }
    }
    const req = env.edgeSetbacks[worstEdge.index].buildingFt;
    const actual = worst + req;
    const where = worstEdge.roadName ? `the ${worstEdge.roadName} right-of-way` : `the ${worstEdge.facing} lot line`;
    add(key, title, worst >= -0.05 ? 'pass' : 'fail', `Building is ${fmtInt(actual)} ft from ${where}; ${req} ft required.${worst < -0.05 ? ` Move it ${Math.ceil(-worst)} ft away.` : ''}`, {
      id,
      value: Math.round(actual),
      limit: req,
      units: 'ft',
      objectIds: [building.id],
    });
  };
  for (const f of fr) {
    const key = f.acrossStreetFromResidential && has('setback.building.frontAcrossResidential') ? 'setback.building.frontAcrossResidential' : 'setback.building.front';
    yardCheck(key, `Front yard, ${f.roadName}`, (i) => f.edgeIndexes.includes(i), f.roadId);
  }
  yardCheck('setback.building.side', 'Side yard', (i) => site.edges[i].edgeClass === 'side' && env.edgeSetbacks[i].buildingRuleKey === 'setback.building.side');
  yardCheck('setback.building.rear', 'Rear yard', (i) => site.edges[i].edgeClass === 'rear' && env.edgeSetbacks[i].buildingRuleKey === 'setback.building.rear');
  const residential = site.districts.filter((d) => d.kind === 'residential');
  if (has('setback.building.fromResidential') && residential.length) {
    const limit = env.residentialBuildingSepFt;
    if (!building) add('setback.building.fromResidential', 'Building separation from residential district', 'n/a', 'No building placed yet.', { limit, units: 'ft' });
    else {
      let d = Infinity;
      let name = '';
      for (const dist of residential) {
        const x = ringToRingDist(building.polygon, dist.ring);
        if (x < d) {
          d = x;
          name = dist.name;
        }
      }
      add('setback.building.fromResidential', 'Building separation from residential district', d >= limit - 0.05 ? 'pass' : 'fail', `Building is ${fmtInt(d)} ft from the ${name} district boundary; ${limit} ft required.`, {
        value: Math.round(d),
        limit,
        units: 'ft',
        objectIds: [building.id],
      });
    }
  }
  if (building) {
    const hard = site.constraints.filter((c) => !c.informational);
    for (const c of hard) {
      const d = ringToRingDist(building.polygon, c.ring);
      if (d < c.bufferFt - 0.05)
        add('use.permitted', `Building clear of ${c.name}`, 'fail', `Building is ${fmtInt(d)} ft from ${c.name}; ${c.bufferFt} ft buffer required.`, { id: `constraint.${c.id}`, value: Math.round(d), limit: c.bufferFt, units: 'ft', objectIds: [building.id] });
    }
  }
  if (has('height.maxFt')) {
    const max = ruleNumber(rules, 'height.maxFt', 999);
    if (!building) add('height.maxFt', 'Building height', 'n/a', 'No building placed yet.', { limit: max, units: 'ft' });
    else
      add('height.maxFt', 'Building height', building.heightFt <= max ? 'pass' : 'fail', `Building height ${building.heightFt} ft (${building.clearHeightFt} ft clear + roof allowance) vs ${max} ft maximum.`, {
        value: building.heightFt,
        limit: max,
        units: 'ft',
        objectIds: [building.id],
      });
  }

  // ---- Parking setbacks --------------------------------------------------------------------
  const setbackOver = (key: string, title: string, items: DesignObject[], dist: (ring: Ring) => { d: number; where: string }, limit: number, id?: string, note = '') => {
    if (!has(key)) return;
    if (!items.length) return add(key, title, 'n/a', 'Nothing placed yet.', { id, limit, units: 'ft' });
    let worst = Infinity;
    let where = '';
    let who = items[0];
    for (const o of items)
      for (const ring of polyOf(o)) {
        const x = dist(ring);
        if (x.d < worst) {
          worst = x.d;
          where = x.where;
          who = o;
        }
      }
    add(key, title, worst >= limit - 0.05 ? 'pass' : 'fail', `${who.name} is ${fmtInt(worst)} ft from ${where}; ${limit} ft required.${note}`, { id, value: Math.round(worst), limit, units: 'ft', objectIds: [who.id] });
  };
  const edgeDist = (filter: (i: number) => boolean) => (ring: Ring) => {
    let d = Infinity;
    let where = '';
    for (const e of site.edges) {
      if (!filter(e.index)) continue;
      const x = ringToSegmentDist(ring, e.a, e.b) - env.edgeSetbacks[e.index].rowInsetFt;
      if (x < d) {
        d = x;
        where = e.roadName ? `the ${e.roadName} right-of-way` : `the ${e.facing} lot line`;
      }
    }
    return { d, where };
  };
  const resDist = (ring: Ring) => {
    let d = Infinity;
    let where = '';
    for (const dist of residential) {
      const x = ringToRingDist(ring, dist.ring);
      if (x < d) {
        d = x;
        where = `the ${dist.name} district boundary`;
      }
    }
    return { d, where };
  };
  const pStreet = ruleNumber(rules, 'setback.parking.street', 0);
  const pSide = ruleNumber(rules, 'setback.parking.sideRear', 0);
  const pRes = ruleNumber(rules, 'setback.parking.fromResidential', 0);
  if (site.edges.some((e) => e.edgeClass === 'front')) setbackOver('setback.parking.street', 'Parking setback from street right-of-way', [...fields, ...courts], edgeDist((i) => site.edges[i].edgeClass === 'front'), pStreet);
  if (site.edges.some((e) => e.edgeClass !== 'front')) setbackOver('setback.parking.sideRear', 'Parking setback from side/rear lot lines', [...fields, ...courts], edgeDist((i) => site.edges[i].edgeClass !== 'front'), pSide);
  if (residential.length) {
    setbackOver('setback.parking.fromResidential', 'Car parking setback from residential district', fields, resDist, pRes);
    setbackOver('setback.parking.fromResidential', 'Truck court / trailer parking setback from residential district', courts, resDist, pRes, 'truck', ' (Applied to truck courts conservatively.)');
  }
  if (has('setback.parking.street') && env.areas.frontYardSf > 0 && fields.length) {
    const used = regionArea(intersect(unionSolids(fields.map((f) => [f.polygon])), env.frontYards));
    const pct = (used / env.areas.frontYardSf) * 100;
    add('setback.parking.street', 'Parking within the required front yard', pct <= 50 ? 'pass' : 'fail', `Car parking uses ${pct.toFixed(1)}% of the required front yard; up to 50% is allowed.`, { id: 'frontYardShare', value: r1(pct), limit: 50, units: '%', objectIds: fields.map((f) => f.id) });
  }

  // ---- Parking supply ----------------------------------------------------------------------
  const req = parkingRequired(s, rules);
  const provided = fields.reduce((n, f) => n + f.stallsTotal, 0);
  if (has('parking.ratio.perEmployeeTwoShifts')) {
    if (req.storageReading === null) add('parking.ratio.perEmployeeTwoShifts', 'Car parking required (service/storage reading)', 'n/a', 'Give employees per shift in set_program to evaluate § 27-1405.');
    else if (!building) add('parking.ratio.perEmployeeTwoShifts', 'Car parking required (service/storage reading)', 'n/a', `${req.storageReading} spaces will be required (${req.basis}).`, { limit: req.storageReading, units: 'spaces' });
    else
      add(
        'parking.ratio.perEmployeeTwoShifts',
        'Car parking required (service/storage reading)',
        provided >= req.storageReading ? 'pass' : 'fail',
        `${provided} spaces provided vs ${req.storageReading} required (item S + office item W). ${provided < req.storageReading ? `Short by ${req.storageReading - provided}: add parking rows or a second field.` : ''}`.trim(),
        { value: provided, limit: req.storageReading, units: 'spaces', objectIds: fields.map((f) => f.id) },
      );
  }
  if (has('parking.ratio.perEmployeeLargestShift') && req.manufacturingReading !== null && building) {
    add(
      'parking.ratio.perEmployeeLargestShift',
      'Car parking required (manufacturing-district reading)',
      provided >= req.manufacturingReading ? 'pass' : 'warn',
      `${provided} spaces provided vs ${req.manufacturingReading} under the alternate reading (item V + office). ${provided < req.manufacturingReading ? 'Below the stricter reading; confirm the applicable use with the Zoning Administrator (item X).' : 'Meets the stricter reading too.'}`,
      { value: provided, limit: req.manufacturingReading, units: 'spaces', objectIds: fields.map((f) => f.id) },
    );
  }
  const stall = ruleTable(rules, 'parking.stallSize');
  if (stall && fields.length) {
    const c = s.layoutCriteria;
    const ok = c.carStallWidthFt >= stall.widthFt && c.carStallLengthFt >= stall.lengthFt;
    add('parking.stallSize', 'Car stall size', ok ? 'pass' : 'fail', `Stalls are ${c.carStallWidthFt} × ${c.carStallLengthFt} ft; minimum ${stall.widthFt} × ${stall.lengthFt} ft.`, { value: c.carStallWidthFt, limit: stall.widthFt, units: 'ft' });
  }
  if (has('parking.aisleMinFt') && fields.length) {
    const min = ruleNumber(rules, 'parking.aisleMinFt', 0);
    add('parking.aisleMinFt', 'Parking aisle width', s.layoutCriteria.carAisleFt >= min ? 'pass' : 'fail', `Aisles are ${s.layoutCriteria.carAisleFt} ft wide; minimum ${min} ft where stalls face each other.`, { value: s.layoutCriteria.carAisleFt, limit: min, units: 'ft' });
  }
  const p2b = ruleTable(rules, 'setback.parking.toBuilding');
  if (p2b && building && fields.length) {
    const big = fields.filter((f) => f.stallsTotal >= (p2b.minSpaces ?? 10));
    if (big.length) {
      let d = Infinity;
      let who = big[0];
      for (const f of big) {
        const x = ringToRingDist(f.polygon, building.polygon);
        if (x < d) {
          d = x;
          who = f;
        }
      }
      add('setback.parking.toBuilding', 'Parking lot to principal building', d >= p2b.minFt - 0.05 ? 'pass' : 'fail', `${who.name} is ${fmtInt(d)} ft from the building line; ${p2b.minFt} ft required (sidewalk and screen plantings go in this strip).`, {
        value: Math.round(d),
        limit: p2b.minFt,
        units: 'ft',
        objectIds: [who.id, building.id],
      });
    }
  }

  // ---- Loading -----------------------------------------------------------------------------
  const berths = ruleTable(rules, 'loading.berthsRequired');
  if (berths) {
    if (!building) add('loading.berthsRequired', 'Loading berths', 'n/a', 'No building placed yet.');
    else {
      const need = loadingBerthsRequired(building.areaSf, berths);
      add(
        'loading.berthsRequired',
        'Loading berths',
        building.dockDoors >= need.conservative ? 'pass' : 'fail',
        `${building.dockDoors} dock positions provided vs ${need.conservative} berths required for ${fmtInt(building.areaSf)} SF (partial 40,000 SF increments rounded up; ${need.roundedDown} if rounded down).`,
        { value: building.dockDoors, limit: need.conservative, units: 'berths', objectIds: [building.id] },
      );
    }
  }
  const berth = ruleTable(rules, 'loading.berthSize');
  if (berth && courts.length) {
    const c = s.layoutCriteria;
    const ok = c.trailerStallWidthFt >= berth.widthFt && c.trailerStallLengthFt >= berth.lengthFt && (building?.clearHeightFt ?? 99) >= (berth.clearanceFt ?? 0);
    add('loading.berthSize', 'Loading berth size', ok ? 'pass' : 'fail', `Berths/trailer stalls are ${c.trailerStallWidthFt} × ${c.trailerStallLengthFt} ft; minimum ${berth.widthFt} × ${berth.lengthFt} ft, ${berth.clearanceFt} ft clear.`, { value: c.trailerStallWidthFt, limit: berth.widthFt, units: 'ft' });
  }
  if (has('loading.notInFrontYard')) {
    const truckCourts = objs.filter((o) => o.type === 'truckCourt');
    if (!truckCourts.length) add('loading.notInFrontYard', 'Loading outside the required front yard', 'n/a', 'No truck courts placed yet.');
    else {
      const inYard = regionArea(intersect(unionSolids(truckCourts.map((o) => [(o as any).polygon as Ring])), env.frontYards));
      // Report which street (if any) each dock wall faces.
      const facing: string[] = [];
      for (const tc of truckCourts) {
        const ring = (tc as any).polygon as Ring;
        // Court edge 2 is the outer edge (rings are built u0v0, u1v0, u1v1, u0v1); use the centroid-to-building direction instead for robustness.
        if (!building) continue;
        const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
        const cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
        const out = norm([cx - building.center[0], cy - building.center[1]]);
        for (const f of fr) {
          const e = site.edges[f.edgeIndexes[0]];
          const n = outwardNormalOf(site.parcel.ring, e.index);
          if (dot(out, n) > 0.7) facing.push(`${tc.name} faces ${f.roadName}${f.acrossStreetFromResidential ? ' (residential across the street)' : ''} at ${fmtInt(ringToSegmentDist(ring, e.a, e.b))} ft`);
        }
      }
      add(
        'loading.notInFrontYard',
        'Loading outside the required front yard',
        inYard < 1 ? 'pass' : 'fail',
        inYard < 1 ? `Truck courts are entirely behind the required front yard lines.${facing.length ? ` ${facing.join('; ')}.` : ''}` : `${fmtInt(inYard)} SF of truck court lies inside a required front yard. Move the building back or drop the trailer row on that side.`,
        { value: Math.round(inYard), limit: 0, units: 'SF', objectIds: truckCourts.map((o) => o.id) },
      );
    }
  }

  // ---- Driveways ---------------------------------------------------------------------------
  const dw = ruleTable(rules, 'driveway.width');
  const spacing = ruleNumber(rules, 'driveway.spacingFt', 0);
  const minRadius = ruleNumber(rules, 'driveway.minRadiusFt', 0);
  if (!driveways.length) {
    if (dw) add('driveway.width', 'Driveway width at street line', 'n/a', 'No driveways placed yet.');
    if (spacing) add('driveway.spacingFt', 'Driveway spacing', 'n/a', 'No driveways placed yet.');
  }
  for (const d of driveways) {
    if (dw) {
      const lanes = d.lanes;
      const range: [number, number] = lanes <= 1 ? [dw.oneLaneMin, dw.oneLaneMax] : lanes === 2 ? [dw.twoLaneMin, dw.twoLaneMax] : [dw.threeLaneMin, dw.threeLaneMax];
      const ok = lanes <= (dw.maxLanes ?? 3) && d.widthFt >= range[0] - 1e-6 && d.widthFt <= range[1] + 1e-6;
      add('driveway.width', `Driveway width, ${d.name}`, ok ? 'pass' : 'fail', `${d.widthFt} ft with ${lanes} lane${lanes === 1 ? '' : 's'} at the street line; allowed ${range[0]}–${range[1]} ft for ${lanes} lane${lanes === 1 ? '' : 's'} (max ${dw.maxLanes} lanes).`, {
        id: d.id,
        value: d.widthFt,
        limit: range[1],
        units: 'ft',
        objectIds: [d.id],
      });
    }
    if (spacing) {
      let nearest = Infinity;
      let what = '';
      if (d.toIntersectionFt !== null && d.toIntersectionFt < nearest) {
        nearest = d.toIntersectionFt;
        what = 'the nearest intersecting street right-of-way line';
      }
      for (const o of driveways) {
        if (o.id === d.id) continue;
        const x = Math.hypot(o.position[0] - d.position[0], o.position[1] - d.position[1]);
        if (x < nearest) {
          nearest = x;
          what = o.name;
        }
      }
      if (nearest === Infinity) add('driveway.spacingFt', `Driveway spacing, ${d.name}`, 'pass', `No intersecting street or other driveway nearby (${spacing} ft minimum).`, { id: d.id, limit: spacing, units: 'ft', objectIds: [d.id] });
      else
        add('driveway.spacingFt', `Driveway spacing, ${d.name}`, nearest >= spacing - 0.05 ? 'pass' : 'fail', `Centerline is ${fmtInt(nearest)} ft from ${what}; ${spacing} ft required.`, {
          id: d.id,
          value: Math.round(nearest),
          limit: spacing,
          units: 'ft',
          objectIds: [d.id],
        });
    }
    if (minRadius && d.radiusFt < minRadius) add('driveway.minRadiusFt', `Driveway apron radius, ${d.name}`, 'fail', `Radius ${d.radiusFt} ft; minimum ${minRadius} ft.`, { id: d.id, value: d.radiusFt, limit: minRadius, units: 'ft', objectIds: [d.id] });
  }
  if (minRadius && driveways.length && driveways.every((d) => d.radiusFt >= minRadius))
    add('driveway.minRadiusFt', 'Driveway apron radii', 'pass', `All curb returns are ≥ ${minRadius} ft (trucks ${s.layoutCriteria.truckCurbReturnFt} ft, cars ${s.layoutCriteria.carCurbReturnFt} ft).`, { value: Math.min(...driveways.map((d) => d.radiusFt)), limit: minRadius, units: 'ft' });
  if (has('driveway.oneWayPreferred') && driveways.length > 1)
    add('driveway.oneWayPreferred', 'Multiple driveways', 'warn', `${driveways.length} two-way driveways. The ordinance prefers one-way operation where possible (advisory); consider enter-only / exit-only pairs.`, { objectIds: driveways.map((d) => d.id) });

  // ---- Landscaping -------------------------------------------------------------------------
  if (has('landscape.minPct')) {
    const min = ruleNumber(rules, 'landscape.minPct', 0);
    if (!building) add('landscape.minPct', 'Landscaped area', 'n/a', 'No layout yet.', { limit: min, units: '%' });
    else {
      const hard = regionArea(imperviousRegion(objs)) - parkingIslandSf(objs);
      const basins = objs.reduce((a, o) => (o.type === 'basin' ? a + o.areaSf : a), 0);
      const wet = site.constraints.filter((c) => c.kind === 'wetland').reduce((a, c) => a + ringArea(c.ring), 0);
      const pct = ((site.areaSf - hard - basins - wet) / site.areaSf) * 100;
      add('landscape.minPct', 'Landscaped area', pct >= min ? 'pass' : 'fail', `${pct.toFixed(1)}% of the lot is landscaped (excluding building, pavement, basins and wetlands) vs ${min}% minimum.`, { value: r1(pct), limit: min, units: '%' });
    }
  }
  const lot = ruleTable(rules, 'landscape.parkingLot');
  const island = ruleTable(rules, 'landscape.island');
  if (lot && fields.length) {
    const need = fields.filter((f) => f.stallsTotal >= lot.interiorMinSpaces);
    const c = s.layoutCriteria;
    const islandOk = !island || (c.parkingEndIslandFt >= island.minWidthFt && c.parkingEndIslandFt * c.carStallLengthFt >= island.minSf);
    const ok = need.every((f) => f.islandSf > 0) && islandOk;
    add(
      'landscape.parkingLot',
      'Parking lot landscaping',
      ok ? 'pass' : 'fail',
      ok
        ? `End islands (${c.parkingEndIslandFt} × ${c.carStallLengthFt} ft) at every row and an interior island every ${c.parkingIslandEveryStalls} stalls: ${fmtInt(fields.reduce((a, f) => a + f.islandSf, 0))} SF of islands; perimeter planting strip along each field.`
        : 'Lots of 25+ spaces need interior islands (≥ 50 SF, ≥ 5 ft wide).',
      { value: Math.round(fields.reduce((a, f) => a + f.islandSf, 0)), units: 'SF', objectIds: fields.map((f) => f.id) },
    );
  }
  const west = ruleTable(rules, 'landscape.westWallScreen');
  if (west && building) {
    const ring = building.polygon;
    const sides: { name: string; side: string }[] = [
      { name: 'wall -v', side: '-v' },
      { name: 'wall +u', side: '+u' },
      { name: 'wall +v', side: '+v' },
      { name: 'wall -u', side: '-u' },
    ];
    const screens = objs.filter((o) => o.type === 'landscape' && (o.kind === 'screen' || o.kind === 'strip'));
    const issues: string[] = [];
    const served: string[] = [];
    for (let i = 0; i < 4; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % 4];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len <= west.wallMinFt) continue;
      const az = azimuthDeg(outwardNormalOf(ring, i));
      if (az < 202.5 || az > 337.5) continue; // W / SW / NW only
      const dir = compass8(az);
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const has = screens.some((sc) => regionToRingDist([sc.polygon as Ring], [a, b, mid]) <= west.withinFt && (sc as any).wallSide === sides[i].side);
      if (has) served.push(`${fmtInt(len)} ft wall facing ${dir}`);
      else if (building.dockSides.includes(sides[i].side as any)) issues.push(`the ${fmtInt(len)} ft dock wall facing ${dir} cannot take a planting within ${west.withinFt} ft (truck court); rotate the building or seek relief`);
      else issues.push(`the ${fmtInt(len)} ft wall facing ${dir} has no screen planting within ${west.withinFt} ft`);
    }
    if (!issues.length)
      add('landscape.westWallScreen', 'Screen planting for long W/SW/NW walls', 'pass', served.length ? `Screen planting strip provided along the ${served.join(' and the ')}.` : `No wall longer than ${west.wallMinFt} ft faces west, southwest or northwest.`, { objectIds: [building.id] });
    else add('landscape.westWallScreen', 'Screen planting for long W/SW/NW walls', 'fail', `${issues.join('; ')}.`.replace(/^t/, 'T'), { objectIds: [building.id] });
  }
  if (has('landscape.bufferScreen')) {
    const buffers = objs.filter((o) => o.type === 'landscape' && o.kind === 'buffer');
    const needs = site.edges.some((e) => e.abutsResidential || e.acrossStreetFromResidential);
    if (needs && building)
      add('landscape.bufferScreen', 'Buffer / screen planting toward residential', buffers.length ? 'pass' : 'warn', buffers.length ? `${buffers.length} dense screen planting strip(s) reserved along the residential-facing edges (${fmtInt(buffers.reduce((a, o) => a + (o as any).areaSf, 0))} SF). Plant selection is not modeled.` : 'No buffer strip reserved along residential-facing edges.', {
        objectIds: buffers.map((o) => o.id),
      });
  }

  // ---- Rules with no evaluator ---------------------------------------------------------------
  const unconfirmed = rules.rules.filter((r) => !r.confirmed);
  if (unconfirmed.length)
    checks.push({
      id: 'z.unconfirmed',
      ruleId: 'unconfirmed',
      group: 'zoning',
      category: 'use',
      title: 'Proposed zoning rules awaiting confirmation',
      status: 'warn',
      value: unconfirmed.length,
      limit: 0,
      units: 'rules',
      citation: '',
      objectIds: [],
      message: `${unconfirmed.length} rule(s) are proposed but not confirmed: ${unconfirmed.slice(0, 4).map((r) => r.label).join('; ')}${unconfirmed.length > 4 ? '…' : ''}. Confirm them (confirm_zoning_rules) before relying on the results.`,
    });
  return checks;
}
