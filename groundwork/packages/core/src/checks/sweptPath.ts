/**
 * WB-67 swept path along truck drives (stretch item, SPEC §5.4).
 * Kinematic tractor–semitrailer model: the steering axle follows the (filleted) drive centerline, the
 * drive axle trails it at the tractor wheelbase, and the trailer's rear tandem trails the kingpin.
 * The union of the body outlines is the swept envelope; anything outside truck pavement is reported.
 * Concept-level: constant low speed, no steering-angle limit beyond the path's fillet radius.
 */
import { type Pt, type Region, type Ring, dist, distToRegionBoundary, distToSegment, lerp, norm, pointInRegion, regionArea, sub } from '../geometry/basic';
import { difference, offsetRegion, unionSolids } from '../geometry/clip';
import { type DesignVehicle, WB67 } from '../criteria/vehicles';
import type { DesignObject, Drive, Driveway } from '../site/project';

/** Replace sharp corners of a polyline with circular arcs of (at most) `radiusFt`; returns points every ~`stepFt`. */
export function filletPath(line: Pt[], radiusFt: number, stepFt = 2): Pt[] {
  if (line.length < 2) return line.slice();
  const pts: Pt[] = [line[0]];
  for (let i = 1; i < line.length - 1; i++) {
    const a = line[i - 1];
    const b = line[i];
    const c = line[i + 1];
    const u = norm(sub(a, b));
    const v = norm(sub(c, b));
    const cos = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]));
    const inner = Math.acos(cos); // angle between the two legs at b
    const turn = Math.PI - inner;
    if (turn < 0.03) {
      pts.push(b);
      continue;
    }
    // Tangent length t = R / tan(inner / 2), limited to 45 % of each leg.
    const maxT = 0.45 * Math.min(dist(a, b), dist(b, c));
    let t = radiusFt / Math.tan(inner / 2);
    let r = radiusFt;
    if (t > maxT) {
      t = maxT;
      r = t * Math.tan(inner / 2);
    }
    const p1: Pt = [b[0] + u[0] * t, b[1] + u[1] * t];
    const p2: Pt = [b[0] + v[0] * t, b[1] + v[1] * t];
    // Arc center lies on the bisector at distance r / sin(inner / 2).
    const bis = norm([u[0] + v[0], u[1] + v[1]]);
    const cd = r / Math.sin(inner / 2);
    const center: Pt = [b[0] + bis[0] * cd, b[1] + bis[1] * cd];
    const a1 = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
    let a2 = Math.atan2(p2[1] - center[1], p2[0] - center[0]);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    a2 = a1 + d;
    const n = Math.max(2, Math.ceil((Math.abs(d) * r) / stepFt));
    for (let k = 0; k <= n; k++) {
      const ang = a1 + (d * k) / n;
      pts.push([center[0] + Math.cos(ang) * r, center[1] + Math.sin(ang) * r]);
    }
  }
  pts.push(line[line.length - 1]);
  // Densify straight runs.
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const l = dist(a, b);
    const n = Math.max(1, Math.ceil(l / stepFt));
    for (let k = 1; k <= n; k++) out.push(lerp(a, b, k / n));
  }
  return out;
}

function rect(front: Pt, dir: Pt, ahead: number, behind: number, half: number): Ring {
  const nx = -dir[1];
  const ny = dir[0];
  const f: Pt = [front[0] + dir[0] * ahead, front[1] + dir[1] * ahead];
  const b: Pt = [front[0] - dir[0] * behind, front[1] - dir[1] * behind];
  return [
    [b[0] - nx * half, b[1] - ny * half],
    [f[0] - nx * half, f[1] - ny * half],
    [f[0] + nx * half, f[1] + ny * half],
    [b[0] + nx * half, b[1] + ny * half],
  ];
}

/** Swept envelope of a tractor–semitrailer whose steering axle follows `path` (points a few feet apart). */
export function sweptEnvelope(path: Pt[], v: DesignVehicle = WB67): { envelope: Region; maxOffTrackingFt: number } {
  if (path.length < 2) return { envelope: [], maxOffTrackingFt: 0 };
  const d0 = norm(sub(path[1], path[0]));
  let drive: Pt = [path[0][0] - d0[0] * v.tractorWheelbaseFt, path[0][1] - d0[1] * v.tractorWheelbaseFt];
  let rear: Pt = [drive[0] - d0[0] * v.kingpinToRearAxleFt, drive[1] - d0[1] * v.kingpinToRearAxleFt];
  const half = v.widthFt / 2;
  const quads: Region[] = [];
  let maxOff = 0;
  for (let i = 0; i < path.length; i++) {
    const f = path[i];
    // Drive axle trails the steering axle at the tractor wheelbase; rear tandem trails the kingpin.
    const td = norm(sub(f, drive));
    drive = [f[0] - td[0] * v.tractorWheelbaseFt, f[1] - td[1] * v.tractorWheelbaseFt];
    const tr = norm(sub(drive, rear));
    rear = [drive[0] - tr[0] * v.kingpinToRearAxleFt, drive[1] - tr[1] * v.kingpinToRearAxleFt];
    if (i % 2 === 0 || i === path.length - 1) {
      quads.push([rect(f, td, v.frontOverhangFt, v.tractorWheelbaseFt + 2, half)]);
      quads.push([rect(drive, tr, v.trailerNoseFt, v.kingpinToRearAxleFt + v.rearOverhangFt, half)]);
    }
    // Off-tracking: how far the rear tandem runs inside the steering path.
    let best = Infinity;
    for (let k = Math.max(0, i - 60); k < i; k++) best = Math.min(best, distToSegment(rear, path[k], path[k + 1]));
    if (i > 40 && best > maxOff) maxOff = best;
  }
  return { envelope: unionSolids(quads), maxOffTrackingFt: maxOff };
}

export type SweptPathResult = {
  driveId: string;
  driveName: string;
  /** Envelope of the inbound and outbound movements. */
  envelope: Region;
  /** Part of the envelope outside truck pavement. */
  overflow: Region;
  overflowSf: number;
  maxOverflowFt: number;
  maxOffTrackingFt: number;
};

/** Radius around a drive's destination end excluded from the check (about one vehicle length), ft. */
const DESTINATION_ZONE_FT = 85;

const cache = new WeakMap<Drive, SweptPathResult>();

/** Swept path of the design vehicle along every truck drive, in and out, against truck pavement. */
export function sweptPaths(objects: DesignObject[], vehicle: DesignVehicle = WB67): SweptPathResult[] {
  const out: SweptPathResult[] = [];
  const truckSolid: Region[] = [];
  for (const o of objects) {
    if (o.type === 'truckCourt' || o.type === 'truckApron' || o.type === 'trailerField') truckSolid.push([o.polygon]);
    else if (o.type === 'drive' && o.network === 'truck') truckSolid.push(o.polygon);
    else if (o.type === 'driveway' && o.network === 'truck') {
      truckSolid.push([o.polygon]);
      // The apron inside the right-of-way (curb returns) is pavement too.
      const along: Pt = [o.inward[1], -o.inward[0]];
      const w = o.widthFt / 2 + o.radiusFt;
      const P = (a: number, d: number): Pt => [o.position[0] + along[0] * a + o.inward[0] * d, o.position[1] + along[1] * a + o.inward[1] * d];
      truckSolid.push([[P(-w, -260), P(w, -260), P(w, 0), P(-w, 0)]]);
    }
  }
  const pavement = unionSolids(truckSolid);
  for (const d of objects) {
    if (d.type !== 'drive' || d.network !== 'truck') continue;
    const hit = cache.get(d);
    if (hit) {
      out.push(hit);
      continue;
    }
    const dw = objects.find((o): o is Driveway => o.type === 'driveway' && o.id === d.drivewayId);
    // Extend the path straight out into the street approach so the whole rig starts on the road side.
    const start = d.centerline[0];
    const line: Pt[] = dw ? [[start[0] - dw.inward[0] * 110, start[1] - dw.inward[1] * 110], ...d.centerline] : d.centerline.slice();
    const pathIn = filletPath(line, vehicle.minTurnRadiusFt);
    const pathOut = pathIn.slice().reverse();
    const a = sweptEnvelope(pathIn, vehicle);
    const b = sweptEnvelope(pathOut, vehicle);
    const envelope = unionSolids([a.envelope, b.envelope]);
    // Ignore slivers under 1 ft (fillet noise), and the last vehicle length at the destination: the turn
    // from the drive into the truck court is not modeled (the rig is simply parked along the drive axis there).
    const end = d.centerline[d.centerline.length - 1];
    const disc: Ring = [];
    for (let k = 0; k < 24; k++) disc.push([end[0] + Math.cos((k / 24) * 2 * Math.PI) * DESTINATION_ZONE_FT, end[1] + Math.sin((k / 24) * 2 * Math.PI) * DESTINATION_ZONE_FT]);
    const overflow = difference(difference(envelope, offsetRegion(pavement, 1, 'miter')), [disc]);
    let maxOver = 0;
    for (const ring of overflow) for (const p of ring) if (!pointInRegion(p, pavement)) maxOver = Math.max(maxOver, distToRegionBoundary(p, pavement));
    const res: SweptPathResult = { driveId: d.id, driveName: d.name, envelope, overflow, overflowSf: regionArea(overflow), maxOverflowFt: maxOver, maxOffTrackingFt: Math.max(a.maxOffTrackingFt, b.maxOffTrackingFt) };
    cache.set(d, res);
    out.push(res);
  }
  return out;
}
