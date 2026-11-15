/**
 * Zoning envelopes: where buildings, parking, loading and pavement may go.
 * Required yards are per-edge strips (square-capped) whose depth depends on the edge class;
 * residential separations are buffers of the residential district polygons; constraints are subtracted.
 */
import { type Pt, type Region, distToRegionBoundary, distToSegment, pointInRing, regionArea } from '../geometry/basic';
import { bufferPolyline, difference, offsetRegion, unionSolids } from '../geometry/clip';
import type { ParcelEdge, Site } from '../site/model';
import { type ZoningRuleSet, citationOf, findRule, ruleNumber } from './rules';

export type EdgeSetbacks = {
  edgeIndex: number;
  buildingFt: number;
  buildingRuleKey: string;
  parkingFt: number;
  parkingRuleKey: string;
  /** Depth of the required front yard on this edge (0 for non-front edges). */
  frontYardFt: number;
  /** Street ROW line inside the lot line on this edge, ft (0 unless the lot runs into the street). */
  rowInsetFt: number;
  /** Setback lines measured from the LOT line: rule depth + rowInsetFt. */
  buildingLineFt: number;
  parkingLineFt: number;
  frontYardLineFt: number;
};

export type Envelopes = {
  building: Region;
  parking: Region;
  loading: Region;
  pavement: Region;
  /** Union of required front yards (for the 50 % front-yard parking cap and the loading rule). */
  frontYards: Region;
  edgeSetbacks: EdgeSetbacks[];
  residentialBuildingSepFt: number;
  residentialParkingSepFt: number;
  areas: { buildingSf: number; parkingSf: number; loadingSf: number; pavementSf: number; frontYardSf: number };
};

export function edgeSetbacks(edges: ParcelEdge[], rules: ZoningRuleSet): EdgeSetbacks[] {
  const front = ruleNumber(rules, 'setback.building.front', 0);
  const frontRes = ruleNumber(rules, 'setback.building.frontAcrossResidential', front);
  const side = ruleNumber(rules, 'setback.building.side', 0);
  const rear = ruleNumber(rules, 'setback.building.rear', 0);
  const resSep = ruleNumber(rules, 'setback.building.fromResidential', 0);
  const pStreet = ruleNumber(rules, 'setback.parking.street', 0);
  const pSide = ruleNumber(rules, 'setback.parking.sideRear', 0);
  const pRes = ruleNumber(rules, 'setback.parking.fromResidential', 0);
  return edges.map((e) => {
    let buildingFt: number;
    let buildingRuleKey: string;
    let frontYardFt = 0;
    if (e.edgeClass === 'front') {
      const across = e.acrossStreetFromResidential && frontRes > front;
      buildingFt = across ? frontRes : front;
      buildingRuleKey = across ? 'setback.building.frontAcrossResidential' : 'setback.building.front';
      frontYardFt = buildingFt;
    } else {
      buildingFt = e.edgeClass === 'rear' ? rear : side;
      buildingRuleKey = e.edgeClass === 'rear' ? 'setback.building.rear' : 'setback.building.side';
      if (e.abutsResidential && resSep > buildingFt) {
        buildingFt = resSep;
        buildingRuleKey = 'setback.building.fromResidential';
      }
    }
    let parkingFt = e.edgeClass === 'front' ? pStreet : pSide;
    let parkingRuleKey = e.edgeClass === 'front' ? 'setback.parking.street' : 'setback.parking.sideRear';
    if (e.abutsResidential && pRes > parkingFt) {
      parkingFt = pRes;
      parkingRuleKey = 'setback.parking.fromResidential';
    }
    const rowInsetFt = e.edgeClass === 'front' ? (e.rowInsetFt ?? 0) : 0;
    return {
      edgeIndex: e.index,
      buildingFt,
      buildingRuleKey,
      parkingFt,
      parkingRuleKey,
      frontYardFt,
      rowInsetFt,
      buildingLineFt: buildingFt + rowInsetFt,
      parkingLineFt: parkingFt + rowInsetFt,
      frontYardLineFt: frontYardFt > 0 ? frontYardFt + rowInsetFt : 0,
    };
  });
}

/** Union of per-edge yard strips. Each strip is the edge buffered by its depth with square caps. */
function yardStrips(edges: ParcelEdge[], depth: (i: number) => number): Region {
  const parts: Region[] = [];
  for (const e of edges) {
    const d = depth(e.index);
    if (d > 0) parts.push(bufferPolyline([e.a, e.b], d, 'square', 'miter'));
  }
  return unionSolids(parts);
}

const cache = new WeakMap<Site, WeakMap<ZoningRuleSet, Envelopes>>();

export function buildEnvelopes(site: Site, rules: ZoningRuleSet): Envelopes {
  let m = cache.get(site);
  if (!m) cache.set(site, (m = new WeakMap()));
  const hit = m.get(rules);
  if (hit) return hit;

  const parcel: Region = [site.parcel.ring];
  const sb = edgeSetbacks(site.edges, rules);
  const resSep = ruleNumber(rules, 'setback.building.fromResidential', 0);
  const pRes = ruleNumber(rules, 'setback.parking.fromResidential', 0);
  const residential: Region = unionSolids(site.districts.filter((d) => d.kind === 'residential').map((d) => [d.ring]));
  const hard = site.constraints.filter((c) => !c.informational);
  const constraintRegion: Region = unionSolids(hard.map((c) => (c.bufferFt > 0 ? offsetRegion([c.ring], c.bufferFt, 'round') : [c.ring])));

  const buildingYards = yardStrips(site.edges, (i) => sb[i].buildingLineFt);
  const parkingYards = yardStrips(site.edges, (i) => sb[i].parkingLineFt);
  const frontYardStrips = yardStrips(site.edges, (i) => sb[i].frontYardLineFt);
  // Pavement (drives): same street / side-rear setbacks as parking, but no residential buffer.
  const pStreet = ruleNumber(rules, 'setback.parking.street', 0);
  const pSide = ruleNumber(rules, 'setback.parking.sideRear', 0);
  const pavementYards = yardStrips(site.edges, (i) => (site.edges[i].edgeClass === 'front' ? pStreet + sb[i].rowInsetFt : pSide));

  const resBufBuilding = residential.length && resSep > 0 ? offsetRegion(residential, resSep, 'round') : [];
  const resBufParking = residential.length && pRes > 0 ? offsetRegion(residential, pRes, 'round') : [];

  const sub = (base: Region, ...cuts: Region[]): Region => {
    let r = base;
    for (const c of cuts) if (c.length) r = difference(r, c);
    return r;
  };
  const building = sub(parcel, buildingYards, resBufBuilding, constraintRegion);
  const parking = sub(parcel, parkingYards, resBufParking, constraintRegion);
  const loading = sub(parking, frontYardStrips);
  const pavement = sub(parcel, pavementYards, constraintRegion);
  const frontYards = sub(parcel, sub(parcel, frontYardStrips));

  const env: Envelopes = {
    building,
    parking,
    loading,
    pavement,
    frontYards,
    edgeSetbacks: sb,
    residentialBuildingSepFt: resSep,
    residentialParkingSepFt: pRes,
    areas: {
      buildingSf: regionArea(building),
      parkingSf: regionArea(parking),
      loadingSf: regionArea(loading),
      pavementSf: regionArea(pavement),
      frontYardSf: regionArea(frontYards),
    },
  };
  m.set(rules, env);
  return env;
}

/** Hard constraints (buffered) as one region; used by the layout engine as an obstacle. */
export function constraintRegion(site: Site): Region {
  return unionSolids(site.constraints.filter((c) => !c.informational).map((c) => (c.bufferFt > 0 ? offsetRegion([c.ring], c.bufferFt, 'round') : [c.ring])));
}

export type GoverningRule = { label: string; citation: string; distanceFt: number; detail: string };

/**
 * Which rule creates the envelope boundary at point `p` (for hover tooltips on setback lines).
 * Returns null when p is not near an envelope boundary.
 */
export function governingRuleAt(site: Site, rules: ZoningRuleSet, env: Envelopes, p: Pt, tolFt = 6): (GoverningRule & { envelope: 'building' | 'parking' }) | null {
  const dB = env.building.length ? distToRegionBoundary(p, env.building) : Infinity;
  const dP = env.parking.length ? distToRegionBoundary(p, env.parking) : Infinity;
  if (Math.min(dB, dP) > tolFt) return null;
  const which: 'building' | 'parking' = dB <= dP ? 'building' : 'parking';
  let best: GoverningRule | null = null;
  let bestErr = Infinity;
  const consider = (key: string, want: number, actual: number, detail: string) => {
    const err = Math.abs(actual - want);
    if (want > 0 && err < bestErr) {
      bestErr = err;
      const rule = findRule(rules, key);
      best = { label: rule?.label ?? key, citation: citationOf(rules, key), distanceFt: want, detail };
    }
  };
  for (const e of site.edges) {
    const s = env.edgeSetbacks[e.index];
    const d = distToSegment(p, e.a, e.b);
    const where = e.roadName
      ? `from the ${e.roadName} right-of-way${s.rowInsetFt > 0 ? ` (ROW line assumed ${s.rowInsetFt.toFixed(0)} ft inside the lot line)` : ''}`
      : `from the ${e.facing} ${e.edgeClass} lot line`;
    if (which === 'building') consider(s.buildingRuleKey, s.buildingFt, d - s.rowInsetFt, where);
    else consider(s.parkingRuleKey, s.parkingFt, d - s.rowInsetFt, where);
  }
  for (const dist of site.districts) {
    if (dist.kind !== 'residential' || pointInRing(p, dist.ring)) continue;
    const d = distToRegionBoundary(p, [dist.ring]);
    if (which === 'building') consider('setback.building.fromResidential', env.residentialBuildingSepFt, d, `from the ${dist.name} district boundary`);
    else consider('setback.parking.fromResidential', env.residentialParkingSepFt, d, `from the ${dist.name} district boundary`);
  }
  for (const c of site.constraints) {
    if (c.informational) continue;
    const d = distToRegionBoundary(p, [c.ring]);
    if (Math.abs(d - c.bufferFt) < bestErr) {
      bestErr = Math.abs(d - c.bufferFt);
      best = { label: `${c.name}: no-build area${c.bufferFt ? ` + ${c.bufferFt} ft buffer` : ''}`, citation: c.source || 'Site constraint', distanceFt: c.bufferFt, detail: 'constraint' };
    }
  }
  if (!best || bestErr > tolFt * 1.5) return null;
  return { ...(best as GoverningRule), envelope: which };
}
