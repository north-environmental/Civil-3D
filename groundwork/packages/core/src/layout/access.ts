/**
 * Site access: driveways on road frontages and routed drives (separate truck / car networks).
 * Routing is grid A* inside the pavement envelope, avoiding the building, constraints and the other
 * network, then simplified by line-of-sight and buffered into a pavement polygon with filleted bends.
 */
import {
  type Pt,
  type Region,
  bboxOf,
  closestOnPolyline,
  dist,
  expandBBox,
  norm,
  pointAlong,
  polylineLength,
  sub,
  toWorld,
} from '../geometry/basic';
import { bufferPolyline, offsetRegion, overlapArea, unionSolids } from '../geometry/clip';
import { type GridSpec, gridSpecForBBox, rasterizeRegion } from '../geometry/grid';
import type { LayoutCriteria } from '../criteria/layout';
import type { Site } from '../site/model';
import type { AccessSpec, Drive, Driveway, Network } from '../site/project';
import { type Frontage, findRoad, frontages } from '../zoning/edges';
import type { Port } from './building';

/** Depth of the on-site driveway throat measured from the right-of-way line, ft (EFCG default). */
export const THROAT_DEPTH_FT = 30;

export type DrivewayResult = { driveway: Driveway | null; note?: string };

export function frontageFor(site: Site, roadName: string): Frontage | null {
  const road = findRoad(site, roadName);
  if (!road) return null;
  return frontages(site.edges).find((f) => f.roadId === road.id) ?? null;
}

/** Valid station range for a driveway centerline on a frontage, honoring intersection spacing. */
export function stationLimits(site: Site, f: Frontage, widthFt: number, radiusFt: number, spacingFt: number): { lo: number; hi: number; startIsIntersection: boolean; endIsIntersection: boolean } {
  const n = site.edges.length;
  const first = f.edgeIndexes[0];
  const last = f.edgeIndexes[f.edgeIndexes.length - 1];
  const prev = site.edges[(first - 1 + n) % n];
  const next = site.edges[(last + 1) % n];
  const startIsIntersection = prev.edgeClass === 'front' && prev.roadId !== f.roadId;
  const endIsIntersection = next.edgeClass === 'front' && next.roadId !== f.roadId;
  const corner = widthFt / 2 + radiusFt;
  return {
    lo: startIsIntersection ? spacingFt : corner,
    hi: f.lengthFt - (endIsIntersection ? spacingFt : corner),
    startIsIntersection,
    endIsIntersection,
  };
}

export function makeDriveway(
  site: Site,
  access: AccessSpec,
  index: number,
  target: Pt | null,
  others: Driveway[],
  c: LayoutCriteria,
  spacingFt: number,
): DrivewayResult {
  const f = frontageFor(site, access.road);
  if (!f) {
    const roads = site.roads.map((r) => r.name).join(', ');
    return { driveway: null, note: `No frontage on "${access.road}" for ${access.network} access. Roads with frontage: ${frontages(site.edges).map((x) => x.roadName).join(', ') || 'none'} (site roads: ${roads}).` };
  }
  const truck = access.network === 'truck';
  const lanes = access.lanes ?? (truck ? c.truckDrivewayLanes : c.carDrivewayLanes);
  const widthFt = access.widthFt ?? (truck ? c.truckDrivewayWidthFt : c.carDrivewayWidthFt);
  const radiusFt = truck ? c.truckCurbReturnFt : c.carCurbReturnFt;
  const lim = stationLimits(site, f, widthFt, radiusFt, spacingFt);
  let station: number;
  let note: string | undefined;
  if (access.position === 'auto') {
    const want = target ? closestOnPolyline(target, f.line).station : f.lengthFt / 2;
    station = Math.min(lim.hi, Math.max(lim.lo, want));
    // Keep the spacing from other driveways on this frontage by sliding along it.
    const sameRoad = others.filter((o) => o.roadId === f.roadId);
    for (let iter = 0; iter < 6; iter++) {
      const clash = sameRoad.find((o) => Math.abs(o.stationFt - station) < spacingFt);
      if (!clash) break;
      const up = clash.stationFt + spacingFt;
      const down = clash.stationFt - spacingFt;
      const candidates = [up, down].filter((s) => s >= lim.lo && s <= lim.hi);
      if (!candidates.length) {
        note = `${f.roadName}: no position keeps ${spacingFt} ft from the other driveway; frontage is too short.`;
        break;
      }
      station = candidates.sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
    }
    if (lim.hi < lim.lo) note = `${f.roadName} frontage (${Math.round(f.lengthFt)} ft) is too short for a driveway ${spacingFt} ft from the intersections.`;
  } else {
    station = Math.max(0, Math.min(f.lengthFt, access.position));
  }
  const { pt, dir } = pointAlong(f.line, station);
  const inward: Pt = [-dir[1], dir[0]]; // parcel ring is CCW: interior is on the left
  const toIntersectionFt = Math.min(lim.startIsIntersection ? station : Infinity, lim.endIsIntersection ? f.lengthFt - station : Infinity);
  const frame = { origin: pt, angleDeg: (Math.atan2(dir[1], dir[0]) * 180) / Math.PI };
  const h = widthFt / 2;
  const polygon = [toWorld(frame, [-h, 0]), toWorld(frame, [h, 0]), toWorld(frame, [h, THROAT_DEPTH_FT]), toWorld(frame, [-h, THROAT_DEPTH_FT])];
  const id = `dwy-${index + 1}`;
  return {
    note,
    driveway: {
      id,
      name: `${truck ? 'Truck' : access.network === 'car' ? 'Car' : 'Emergency'} driveway, ${f.roadName}`,
      auto: true,
      type: 'driveway',
      accessId: access.id,
      network: access.network,
      roadId: f.roadId,
      roadName: f.roadName,
      position: pt,
      inward,
      stationFt: station,
      widthFt,
      lanes,
      radiusFt,
      toIntersectionFt: Number.isFinite(toIntersectionFt) ? toIntersectionFt : null,
      polygon,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------------------------

export type RouteObstacles = {
  /** Where pavement may go (pavement envelope). */
  allowed: Region;
  /** Never crossed, any network (building + clearance is applied by the router). */
  building: Region;
  /** Pavement of each network (courts/aprons/trailer bands for truck; fields for car; plus routed drives). */
  truckPavement: Region[];
  carPavement: Region[];
  /** Other keep-outs (basins, manual). */
  other: Region[];
};

const ROUTE_CELL_FT = 10;

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, val: number) {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

function buildBlocked(g: GridSpec, obs: RouteObstacles, network: Network, halfWidth: number, c: LayoutCriteria): Uint8Array {
  const allowed = rasterizeRegion(g, offsetRegion(obs.allowed, -(halfWidth + 1), 'miter'));
  const blocked = new Uint8Array(g.nx * g.ny);
  for (let k = 0; k < blocked.length; k++) blocked[k] = allowed[k] ? 0 : 1;
  const stamp = (region: Region, inflate: number) => {
    if (!region.length) return;
    const m = rasterizeRegion(g, offsetRegion(region, inflate, 'miter'));
    for (let k = 0; k < m.length; k++) if (m[k]) blocked[k] = 1;
  };
  stamp(obs.building, c.buildingClearanceFt + halfWidth);
  const own = network === 'truck' ? obs.truckPavement : network === 'car' ? obs.carPavement : [];
  const foreign = network === 'truck' ? obs.carPavement : network === 'car' ? obs.truckPavement : [];
  for (const r of own) stamp(r, halfWidth + 2);
  // The emergency network may touch both (it is the one allowed, gated connection).
  for (const r of foreign) stamp(r, c.networkSeparationFt + halfWidth);
  for (const r of obs.other) stamp(r, halfWidth + 5);
  return blocked;
}

function lineClear(g: GridSpec, blocked: Uint8Array, a: Pt, b: Pt): boolean {
  const d = dist(a, b);
  const steps = Math.max(1, Math.ceil(d / (g.cellFt * 0.4)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    const i = Math.floor((x - g.x0) / g.cellFt);
    const j = Math.floor((y - g.y0) / g.cellFt);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny || blocked[j * g.nx + i]) return false;
  }
  return true;
}

export type RouteResult = { drive: Drive | null; note?: string };

/**
 * Route a drive from a driveway to the nearest reachable port of its destination.
 * `id` and `name` are assigned by the caller.
 */
export function routeDrive(site: Site, obs: RouteObstacles, from: Driveway, ports: Port[], widthFt: number, c: LayoutCriteria, id: string): RouteResult {
  const network = from.network;
  if (!ports.length) return { drive: null, note: `${from.name}: nothing to connect to (no ${network === 'truck' ? 'truck court' : 'parking field'}).` };
  const half = widthFt / 2;
  const g = gridSpecForBBox(expandBBox(bboxOf(site.parcel.ring), 20), ROUTE_CELL_FT);
  const blocked = buildBlocked(g, obs, network, half, c);
  const cellOf = (p: Pt): number => {
    const i = Math.floor((p[0] - g.x0) / g.cellFt);
    const j = Math.floor((p[1] - g.y0) / g.cellFt);
    return i < 0 || j < 0 || i >= g.nx || j >= g.ny ? -1 : j * g.nx + i;
  };
  const center = (k: number): Pt => [g.x0 + ((k % g.nx) + 0.5) * g.cellFt, g.y0 + (Math.floor(k / g.nx) + 0.5) * g.cellFt];

  // Start a little inside the site, beyond the street setback, on the driveway axis.
  let start: Pt | null = null;
  for (let d = THROAT_DEPTH_FT + half + 6; d <= THROAT_DEPTH_FT + half + 80; d += 5) {
    const p: Pt = [from.position[0] + from.inward[0] * d, from.position[1] + from.inward[1] * d];
    const k = cellOf(p);
    if (k >= 0 && !blocked[k]) {
      start = p;
      break;
    }
  }
  if (!start) return { drive: null, note: `${from.name}: the driveway throat is blocked (building, constraint or setback within ${Math.round(THROAT_DEPTH_FT + half + 80)} ft of the street).` };

  const targets = new Map<number, Port>();
  for (const p of ports) {
    const k = cellOf(p.outside);
    if (k >= 0 && !blocked[k] && !targets.has(k)) targets.set(k, p);
  }
  if (!targets.size) return { drive: null, note: `${from.name}: every connection point of the ${network === 'truck' ? 'truck court' : 'parking field'} is blocked (too close to a setback, constraint or the other network).` };
  const targetPts = [...targets.keys()].map(center);
  const hCost = (k: number): number => {
    const p = center(k);
    let best = Infinity;
    for (const t of targetPts) best = Math.min(best, Math.hypot(t[0] - p[0], t[1] - p[1]));
    return best;
  };

  const n = g.nx * g.ny;
  const gScore = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open = new MinHeap();
  const s0 = cellOf(start);
  gScore[s0] = 0;
  open.push(hCost(s0), s0);
  let goal = -1;
  const NB = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];
  while (open.size) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (targets.has(cur)) {
      goal = cur;
      break;
    }
    const ci = cur % g.nx;
    const cj = (cur - ci) / g.nx;
    for (const [di, dj, w] of NB) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.ny) continue;
      const nk = nj * g.nx + ni;
      if (blocked[nk] || closed[nk]) continue;
      // No corner cutting.
      if (di !== 0 && dj !== 0 && (blocked[cj * g.nx + ni] || blocked[nj * g.nx + ci])) continue;
      // A small penalty on diagonals favors orthogonal runs.
      const tentative = gScore[cur] + w * g.cellFt * (di !== 0 && dj !== 0 ? 1.03 : 1);
      if (tentative < gScore[nk]) {
        gScore[nk] = tentative;
        came[nk] = cur;
        open.push(tentative + hCost(nk), nk);
      }
    }
  }
  if (goal < 0) return { drive: null, note: `${from.name}: no route to the ${network === 'truck' ? 'truck court' : 'parking field'} inside the allowed pavement area without crossing the building, a constraint or the other network.` };

  const cells: number[] = [];
  for (let k = goal; k >= 0; k = came[k]) cells.push(k);
  cells.reverse();
  const port = targets.get(goal)!;
  const raw: Pt[] = cells.map(center);
  raw[0] = start;
  raw[raw.length - 1] = port.outside;
  // Line-of-sight simplification (string pulling).
  const pulled: Pt[] = [raw[0]];
  let i = 0;
  while (i < raw.length - 1) {
    let j = raw.length - 1;
    while (j > i + 1 && !lineClear(g, blocked, raw[i], raw[j])) j--;
    pulled.push(raw[j]);
    i = j;
  }
  const centerline: Pt[] = [from.position, ...pulled, port.inside];
  // Drop near-duplicate points.
  const clean: Pt[] = [centerline[0]];
  for (const p of centerline.slice(1)) if (dist(p, clean[clean.length - 1]) > 1) clean.push(p);
  const polygon = bufferPolyline(clean, half, 'butt', 'round');
  return {
    drive: {
      id,
      name: `${network === 'truck' ? 'Truck' : network === 'car' ? 'Car' : 'Emergency'} drive from ${from.roadName}`,
      auto: true,
      type: 'drive',
      network,
      centerline: clean,
      widthFt,
      lengthFt: polylineLength(clean),
      drivewayId: from.id,
      toObjectId: port.objectId,
      polygon,
    },
  };
}

/** Truck and car pavement must not touch (emergency links excepted). Returns the overlap area in SF. */
export function networkOverlapSf(truck: Region[], car: Region[]): number {
  if (!truck.length || !car.length) return 0;
  return overlapArea(unionSolids(truck), unionSolids(car));
}

/** Unit direction from the driveway into the site, for drawing curb returns. */
export function drivewayAxis(d: Driveway): { along: Pt; inward: Pt } {
  return { along: norm(sub([d.inward[1], -d.inward[0]], [0, 0])), inward: d.inward };
}
