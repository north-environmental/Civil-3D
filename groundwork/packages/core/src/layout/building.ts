/**
 * Parametric generators: building, truck courts, truck aprons, car parking fields.
 * All geometry is built in the building frame (u along the length, v across the depth) and
 * transformed to site coordinates. Deterministic.
 */
import { type Frame, type Pt, type Ring, frameRect, ringArea, toWorld } from '../geometry/basic';
import { adaRequiredStalls, adaRequiredVanStalls } from '../criteria/ada';
import type { LayoutCriteria } from '../criteria/layout';
import type { Building, ParkingField, ParkingRow, Placement, Program, Side, TruckApron, TruckCourt } from '../site/project';

export function buildingDims(program: Program, c: LayoutCriteria): { lengthFt: number; depthFt: number } {
  const depthFt = program.depthFt ?? (program.buildingType === 'crossDock' ? c.crossDockDepthFt : c.rearLoadDepthFt);
  // Length rounds UP to the next foot so the placed area is never below the program.
  const lengthFt = program.lengthFt ?? Math.ceil(program.buildingSf / depthFt - 1e-9);
  return { lengthFt, depthFt };
}

export function buildingFrame(p: Pick<Placement, 'center' | 'rotationDeg'>): Frame {
  return { origin: p.center, angleDeg: p.rotationDeg };
}

/** Max dock doors on one dock wall: doors at `spacing` o.c., clear of each corner. */
export function maxDoorsPerSide(lengthFt: number, c: LayoutCriteria): number {
  return Math.max(0, Math.floor((lengthFt - 2 * c.dockCornerClearFt) / c.dockDoorSpacingFt));
}

export function makeBuilding(program: Program, placement: Placement, c: LayoutCriteria): Building {
  const { lengthFt, depthFt } = buildingDims(program, c);
  const f = buildingFrame(placement);
  const perSideMax = maxDoorsPerSide(lengthFt, c);
  const sides = placement.dockSides.length;
  const doorsPerSide = program.dockDoors === 'max' ? perSideMax : Math.min(perSideMax, Math.ceil(program.dockDoors / Math.max(1, sides)));
  const dockDoors = program.dockDoors === 'max' ? doorsPerSide * sides : Math.min(program.dockDoors, doorsPerSide * sides);
  return {
    id: 'bldg-1',
    name: `${program.buildingType === 'crossDock' ? 'Cross-dock' : 'Rear-load'} building`,
    auto: true,
    type: 'building',
    center: placement.center,
    rotationDeg: placement.rotationDeg,
    lengthFt,
    depthFt,
    areaSf: lengthFt * depthFt,
    buildingType: program.buildingType,
    dockSides: placement.dockSides,
    carSide: placement.carSide,
    clearHeightFt: program.clearHeightFt,
    heightFt: program.clearHeightFt + c.roofAllowanceFt,
    officeSf: program.officeSf,
    doorsPerSide,
    dockDoors,
    polygon: frameRect(f, -lengthFt / 2, -depthFt / 2, lengthFt / 2, depthFt / 2),
  };
}

export const SIDE_SIGN: Record<Side, 1 | -1> = { '+u': 1, '-u': -1, '+v': 1, '-v': -1 };
export const isVSide = (s: Side): boolean => s === '+v' || s === '-v';

/** Which building end the truck apron wraps (the end opposite the car side), or null. */
export function truckEnd(b: Pick<Building, 'carSide' | 'dockSides'>): 1 | -1 | null {
  if (b.carSide === '-u') return 1;
  if (b.carSide === '+u') return -1;
  return null;
}

export function courtDepth(c: LayoutCriteria, trailerRow: boolean): number {
  return c.dockApronFt + c.maneuverLaneFt + (trailerRow ? c.trailerStallLengthFt : 0);
}

export function makeCourts(b: Building, c: LayoutCriteria, opts: { trailerRow: boolean; trailerTarget: number | 'max' }): TruckCourt[] {
  const f = buildingFrame(b);
  const depth = courtDepth(c, opts.trailerRow);
  const perCourtMax = opts.trailerRow ? Math.floor(b.lengthFt / c.trailerStallWidthFt) : 0;
  const n = b.dockSides.length;
  const courts: TruckCourt[] = [];
  let remaining = opts.trailerTarget === 'max' ? Infinity : opts.trailerTarget;
  b.dockSides.forEach((side, i) => {
    const s = SIDE_SIGN[side];
    const v0 = (s * b.depthFt) / 2;
    const v1 = s * (b.depthFt / 2 + depth);
    const uv: [number, number, number, number] = [-b.lengthFt / 2, Math.min(v0, v1), b.lengthFt / 2, Math.max(v0, v1)];
    const share = opts.trailerTarget === 'max' ? perCourtMax : Math.min(perCourtMax, Math.ceil(remaining / (n - i)));
    remaining -= share;
    const tv0 = s * (b.depthFt / 2 + c.dockApronFt + c.maneuverLaneFt);
    courts.push({
      id: `court-${i + 1}`,
      name: `Truck court (${side === '+v' ? 'side A' : 'side B'})`,
      auto: true,
      type: 'truckCourt',
      buildingId: b.id,
      side,
      depthFt: depth,
      apronFt: c.dockApronFt,
      trailerRow: opts.trailerRow,
      trailerStalls: share,
      uv,
      polygon: frameRect(f, uv[0], uv[1], uv[2], uv[3]),
      trailerUv: opts.trailerRow ? [-b.lengthFt / 2, Math.min(tv0, v1), b.lengthFt / 2, Math.max(tv0, v1)] : undefined,
    });
  });
  return courts;
}

/** A place where a routed drive can join a destination: `outside` is clear of it, `inside` is on it. */
export type Port = { objectId: string; outside: Pt; inside: Pt };

/**
 * Truck aprons at court ends (no trailer stalls), plus the ports where drives connect.
 * Cross-dock: a C-shaped end drive wrapping the building end opposite the cars, linking both courts.
 * Single dock side: a rectangular apron at each court end.
 */
export function makeAprons(b: Building, courts: TruckCourt[], c: LayoutCriteria): { aprons: TruckApron[]; ports: Port[] } {
  const f = buildingFrame(b);
  const W = (u: number, v: number): Pt => toWorld(f, [u, v]);
  const aprons: TruckApron[] = [];
  const ports: Port[] = [];
  if (!courts.length) return { aprons, ports };
  const depth = courts[0].depthFt;
  const half = c.truckDriveWidthFt / 2;
  const out = half + 8; // port stand-off beyond the apron edge
  const L2 = b.lengthFt / 2;
  const D2 = b.depthFt / 2;
  const end = truckEnd(b);
  if (end !== null && b.dockSides.length === 2) {
    // C-shaped wrap: outer rectangle minus the clear strip next to the building end wall.
    const u0 = end * L2;
    const uIn = end * (L2 + c.endDriveOffsetFt);
    const uOut = end * (L2 + c.endDriveOffsetFt + c.truckDriveWidthFt);
    const vOut = D2 + depth;
    const ring: Ring = [W(u0, -vOut), W(uOut, -vOut), W(uOut, vOut), W(u0, vOut), W(u0, D2), W(uIn, D2), W(uIn, -D2), W(u0, -D2)];
    aprons.push({ id: 'apron-1', name: 'Truck end drive', auto: true, type: 'truckApron', buildingId: b.id, polygon: end === 1 ? ring : ring.slice().reverse() });
    const uMid = end * (L2 + c.endDriveOffsetFt + half);
    for (const v of [0, D2 + depth / 2, -(D2 + depth / 2)]) ports.push({ objectId: 'apron-1', outside: W(uOut + end * out, v), inside: W(uMid, v) });
    for (const s of [1, -1]) ports.push({ objectId: 'apron-1', outside: W(uMid, s * (vOut + out)), inside: W(uMid, s * (vOut - half)) });
  } else {
    // One apron per court end.
    const len = c.truckDriveWidthFt + 8;
    let k = 0;
    for (const court of courts) {
      const s = SIDE_SIGN[court.side];
      const vA = s * D2;
      const vB = s * (D2 + depth);
      const vMid = s * (D2 + c.dockApronFt + c.maneuverLaneFt / 2);
      for (const e of [1, -1] as const) {
        const id = `apron-${++k}`;
        aprons.push({ id, name: `Truck court end apron ${k}`, auto: true, type: 'truckApron', buildingId: b.id, polygon: frameRect(f, e * L2, Math.min(vA, vB), e * (L2 + len), Math.max(vA, vB)) });
        ports.push({ objectId: id, outside: W(e * (L2 + len + out), vMid), inside: W(e * (L2 + len / 2), vMid) });
        ports.push({ objectId: id, outside: W(e * (L2 + len / 2), vB + s * out), inside: W(e * (L2 + len / 2), vB - s * half) });
      }
    }
  }
  return { aprons, ports };
}

// ---------------------------------------------------------------------------------------------
// Car parking
// ---------------------------------------------------------------------------------------------

/** Stalls on one side of a module of `lengthFt` with no islands (hand calc T9). */
export function stallsPerRowNoIslands(lengthFt: number, stallWidthFt: number): number {
  return Math.floor(lengthFt / stallWidthFt + 1e-9);
}
export function moduleDepthFt(c: Pick<LayoutCriteria, 'carStallLengthFt' | 'carAisleFt'>): number {
  return 2 * c.carStallLengthFt + c.carAisleFt;
}

/** Stall positions and islands in one row of a field of `lengthFt` (cross aisles + end islands removed). */
export function rowCapacity(lengthFt: number, c: LayoutCriteria): { positions: number; islands: number; stalls: number; zoneStartFt: number } {
  const zoneStartFt = c.carAisleFt + c.parkingEndIslandFt;
  const zone = lengthFt - 2 * zoneStartFt;
  const positions = Math.max(0, Math.floor(zone / c.carStallWidthFt + 1e-9));
  const islands = Math.floor(positions / (c.parkingIslandEveryStalls + 1));
  return { positions, islands, stalls: positions - islands, zoneStartFt };
}

/** Field depth for a number of rows: full modules (stall-aisle-stall) plus a single-loaded row if odd. */
export function fieldDepthFt(rows: number, c: LayoutCriteria): number {
  const modules = Math.floor(rows / 2);
  return modules * moduleDepthFt(c) + (rows % 2 ? c.carStallLengthFt + c.carAisleFt : 0);
}
export function rowsForDepth(depthFt: number, c: LayoutCriteria): number {
  let rows = 0;
  while (fieldDepthFt(rows + 1, c) <= depthFt + 1e-6) rows++;
  return rows;
}

/** Length of row frontage consumed by accessible stalls and their access aisles. */
export function adaZoneFt(ada: number, van: number, c: LayoutCriteria): number {
  const cars = Math.max(0, ada - van);
  // Two spaces may share an aisle (2010 ADA § 502.3.4).
  return ada * c.carStallWidthFt + Math.ceil(van / 2) * c.adaVanAisleFt + Math.ceil(cars / 2) * c.adaAisleFt;
}

export type FieldSpec = { origin: Pt; angleDeg: number; lengthFt: number; rows: number; attachedTo?: { buildingId: string; side: Side }; id: string; name: string; auto: boolean; slopePct: number };

export function makeParkingField(spec: FieldSpec, c: LayoutCriteria): ParkingField {
  const cap = rowCapacity(spec.lengthFt, c);
  const depthFt = fieldDepthFt(spec.rows, c);
  const totalPositions = cap.stalls * spec.rows;
  // Table 208.2 on the facility total (using the positions count is conservative: it can only round up).
  const ada = totalPositions > 0 ? Math.min(adaRequiredStalls(totalPositions), cap.stalls) : 0;
  const van = adaRequiredVanStalls(ada);
  const displaced = ada > 0 ? Math.ceil(adaZoneFt(ada, van, c) / c.carStallWidthFt) : 0;
  const rows: ParkingRow[] = [];
  let v = 0;
  for (let r = 0; r < spec.rows; r++) {
    const first = r % 2 === 0;
    // Module: row (stalls open toward +v) | aisle | row (stalls open toward -v).
    const row: ParkingRow = { v0: first ? v : v + c.carStallLengthFt + c.carAisleFt, aisleSide: first ? 1 : -1, stalls: cap.stalls, ada: 0, van: 0 };
    if (r === 0 && ada > 0) {
      row.stalls = Math.max(0, cap.stalls - displaced);
      row.ada = ada;
      row.van = van;
    }
    rows.push(row);
    if (!first) v += moduleDepthFt(c);
  }
  const stallsStd = rows.reduce((s, r) => s + r.stalls, 0);
  const f: Frame = { origin: spec.origin, angleDeg: spec.angleDeg };
  const polygon = frameRect(f, 0, 0, spec.lengthFt, depthFt);
  const islandSf = spec.rows * (2 * c.parkingEndIslandFt + cap.islands * c.carStallWidthFt) * c.carStallLengthFt;
  return {
    id: spec.id,
    name: spec.name,
    auto: spec.auto,
    type: 'parkingField',
    origin: spec.origin,
    angleDeg: spec.angleDeg,
    lengthFt: spec.lengthFt,
    depthFt,
    modules: Math.ceil(spec.rows / 2),
    rows,
    stallsStd,
    stallsAda: ada,
    stallsVan: van,
    stallsTotal: stallsStd + ada,
    islandSf,
    attachedTo: spec.attachedTo,
    slopePct: spec.slopePct,
    polygon,
  };
}

/** Frame of a parking field attached to a building side: u along the wall, v away from the building. */
export function attachedFieldFrame(b: Building, side: Side, offsetFt: number): { origin: Pt; angleDeg: number; lengthFt: number } {
  const f = buildingFrame(b);
  const L2 = b.lengthFt / 2;
  const D2 = b.depthFt / 2;
  switch (side) {
    case '-u':
      return { origin: toWorld(f, [-L2 - offsetFt, -D2]), angleDeg: b.rotationDeg + 90, lengthFt: b.depthFt };
    case '+u':
      return { origin: toWorld(f, [L2 + offsetFt, D2]), angleDeg: b.rotationDeg - 90, lengthFt: b.depthFt };
    case '+v':
      return { origin: toWorld(f, [-L2, D2 + offsetFt]), angleDeg: b.rotationDeg, lengthFt: b.lengthFt };
    case '-v':
      return { origin: toWorld(f, [L2, -D2 - offsetFt]), angleDeg: b.rotationDeg + 180, lengthFt: b.lengthFt };
  }
}

/** Ports where a car drive can join a parking field (ends of its two cross aisles, and their outer sides). */
export function fieldPorts(field: ParkingField, c: LayoutCriteria): Port[] {
  const f: Frame = { origin: field.origin, angleDeg: field.angleDeg };
  const half = c.carDriveWidthFt / 2;
  const out = half + 8;
  const W = (u: number, v: number): Pt => toWorld(f, [u, v]);
  const ports: Port[] = [];
  const a = c.carAisleFt / 2;
  for (const u of [a, field.lengthFt - a]) ports.push({ objectId: field.id, outside: W(u, field.depthFt + out), inside: W(u, field.depthFt - half) });
  const vMid = Math.max(half, field.depthFt / 2);
  ports.push({ objectId: field.id, outside: W(-out, vMid), inside: W(a, vMid) });
  ports.push({ objectId: field.id, outside: W(field.lengthFt + out, vMid), inside: W(field.lengthFt - a, vMid) });
  return ports;
}

export type StallGeometry = { lines: [Pt, Pt][]; adaAisles: Ring[]; adaStalls: Ring[]; islands: Ring[]; aisles: Ring[] };

/** Striping, islands and accessible stalls of a field, for drawing and DXF export. */
export function parkingStallGeometry(field: ParkingField, c: LayoutCriteria): StallGeometry {
  const f: Frame = { origin: field.origin, angleDeg: field.angleDeg };
  const cap = rowCapacity(field.lengthFt, c);
  const W = (u: number, v: number): Pt => toWorld(f, [u, v]);
  const g: StallGeometry = { lines: [], adaAisles: [], adaStalls: [], islands: [], aisles: [] };
  const sl = c.carStallLengthFt;
  const sw = c.carStallWidthFt;
  for (const row of field.rows) {
    const v0 = row.v0;
    const v1 = row.v0 + sl;
    // End islands.
    g.islands.push(frameRect(f, c.carAisleFt, v0, cap.zoneStartFt, v1), frameRect(f, field.lengthFt - cap.zoneStartFt, v0, field.lengthFt - c.carAisleFt, v1));
    let u = cap.zoneStartFt;
    const zoneEnd = field.lengthFt - cap.zoneStartFt;
    // Back-of-stall line.
    const back = row.aisleSide === 1 ? v0 : v1;
    g.lines.push([W(cap.zoneStartFt, back), W(zoneEnd, back)]);
    if (row.ada > 0) {
      // Accessible stalls first (nearest the office corner): [stall][shared aisle][stall] …
      let left = row.ada;
      let vans = row.van;
      while (left > 0) {
        const pair = Math.min(2, left);
        const aisle = vans > 0 ? c.adaVanAisleFt : c.adaAisleFt;
        g.adaStalls.push(frameRect(f, u, v0, u + sw, v1));
        g.adaAisles.push(frameRect(f, u + sw, v0, u + sw + aisle, v1));
        if (pair === 2) g.adaStalls.push(frameRect(f, u + sw + aisle, v0, u + 2 * sw + aisle, v1));
        g.lines.push([W(u, v0), W(u, v1)]);
        u += pair * sw + aisle;
        left -= pair;
        vans -= pair;
      }
      g.lines.push([W(u, v0), W(u, v1)]);
      // Snap to the stall module so the remaining standard stalls fit in whole positions.
      u = cap.zoneStartFt + Math.ceil((u - cap.zoneStartFt) / sw - 1e-9) * sw;
    }
    let sinceIsland = 0;
    let placed = 0;
    while (placed < row.stalls && u + sw <= zoneEnd + 1e-6) {
      if (sinceIsland === c.parkingIslandEveryStalls) {
        g.islands.push(frameRect(f, u, v0, u + sw, v1));
        u += sw;
        sinceIsland = 0;
        continue;
      }
      g.lines.push([W(u, v0), W(u, v1)]);
      u += sw;
      placed++;
      sinceIsland++;
    }
    g.lines.push([W(u, v0), W(u, v1)]);
  }
  return g;
}

/** Office zone drawn at the car-side corner of the building (schematic). */
export function officeRing(b: Building): Ring {
  const f = buildingFrame(b);
  const L2 = b.lengthFt / 2;
  const D2 = b.depthFt / 2;
  const w = 60;
  const len = Math.min(b.officeSf / w, isVSide(b.carSide) ? b.lengthFt : b.depthFt);
  switch (b.carSide) {
    case '-u':
      return frameRect(f, -L2, -D2, -L2 + w, -D2 + len);
    case '+u':
      return frameRect(f, L2 - w, D2 - len, L2, D2);
    case '+v':
      return frameRect(f, -L2, D2 - w, -L2 + len, D2);
    case '-v':
      return frameRect(f, L2 - len, -D2, L2, -D2 + w);
  }
}

export function polygonAreaSf(r: Ring): number {
  return ringArea(r);
}
