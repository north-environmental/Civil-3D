/**
 * Turns design objects into grading objects (SPEC §5.3). Every elevation is parameterized off the
 * finished floor elevation (FFE) except driveway tie-ins (existing road at the ROW line), basins and
 * free-standing manual fields, which follow existing ground.
 */
import { type Frame, type Pt, type Region, type Ring, closestOnPolyline, distToRing, polylineLength, ringCentroid, toLocal } from '../geometry/basic';
import { difference, offsetRegion, unionSolids } from '../geometry/clip';
import { type Grid, forEachCellInRegion, sampleGrid } from '../geometry/grid';
import type { GradingCriteria } from '../criteria/grading';
import type { Site } from '../site/model';
import type { Basin, Building, Drive, Driveway, ParkingField, Scenario, TrailerField, TruckApron, TruckCourt } from '../site/project';
import { type GradingObject, PRIORITY } from './engine';

export type DriveProfile = {
  id: string;
  name: string;
  network: Drive['network'];
  lengthFt: number;
  /** Existing road elevation at the ROW line (fixed tie-in). */
  startElevFt: number;
  /** End elevation = endZ0 + endK · FFE (the adjacent object's surface at the connection point). */
  endZ0: number;
  endK: number;
  maxGradePct: number;
};

export type GradingSetup = {
  objects: GradingObject[];
  drives: DriveProfile[];
  /** Mean existing elevation under the building footprint: the default FFE. */
  padMeanExistingFt: number;
  spots: { label: string; at: Pt; z0: number; k: number }[];
};

/** Mean existing elevation and mean gradient inside a ring. */
function groundUnder(dem: Grid, ring: Ring): { mean: number; gx: number; gy: number } {
  let sum = 0;
  let n = 0;
  let gx = 0;
  let gy = 0;
  const { nx, ny, data, cellFt } = dem;
  forEachCellInRegion(dem, [ring], (i, j) => {
    sum += data[j * nx + i];
    n++;
    if (i > 0 && i < nx - 1 && j > 0 && j < ny - 1) {
      gx += (data[j * nx + i + 1] - data[j * nx + i - 1]) / (2 * cellFt);
      gy += (data[(j + 1) * nx + i] - data[(j - 1) * nx + i]) / (2 * cellFt);
    }
  });
  if (!n) {
    const c = ringCentroid(ring);
    return { mean: sampleGrid(dem, c[0], c[1]), gx: 0, gy: 0 };
  }
  return { mean: sum / n, gx: gx / n, gy: gy / n };
}

/** A plane that follows existing ground (independent of FFE), with its slope clamped to [minPct, maxPct]. */
function groundPlane(dem: Grid, ring: Ring, minPct: number, maxPct: number): { surface: GradingObject['surface']; slopePct: number } {
  const g = groundUnder(dem, ring);
  const mag = Math.hypot(g.gx, g.gy);
  const slope = Math.min(maxPct, Math.max(minPct, mag * 100)) / 100;
  const ux = mag > 1e-6 ? g.gx / mag : 0;
  const uy = mag > 1e-6 ? g.gy / mag : -1;
  const c = ringCentroid(ring);
  return {
    slopePct: slope * 100,
    surface: (x, y, out) => {
      out[0] = g.mean + slope * ((x - c[0]) * ux + (y - c[1]) * uy);
      out[1] = 0;
    },
  };
}

export function buildGradingObjects(site: Site, s: Scenario): GradingSetup {
  const c: GradingCriteria = s.grading.criteria;
  const dem = site.dem;
  const objs = s.objects;
  const objects: GradingObject[] = [];
  const spots: GradingSetup['spots'] = [];
  const building = objs.find((o): o is Building => o.type === 'building');
  const courts = objs.filter((o): o is TruckCourt => o.type === 'truckCourt');
  const aprons = objs.filter((o): o is TruckApron => o.type === 'truckApron');
  const byId = new Map<string, GradingObject>();
  const push = (o: GradingObject) => {
    objects.push(o);
    byId.set(o.id, o);
  };
  let padMean = NaN;

  if (building) {
    const f: Frame = { origin: building.center, angleDeg: building.rotationDeg };
    const L2 = building.lengthFt / 2;
    const D2 = building.depthFt / 2;
    const inBuilding = (x: number, y: number): boolean => {
      const [u, v] = toLocal(f, [x, y]);
      return Math.abs(u) <= L2 && Math.abs(v) <= D2;
    };
    /** Distance from a point to the building rectangle (0 inside). */
    const toBuilding = (x: number, y: number): number => {
      const [u, v] = toLocal(f, [x, y]);
      return Math.hypot(Math.max(Math.abs(u) - L2, 0), Math.max(Math.abs(v) - D2, 0));
    };
    padMean = groundUnder(dem, building.polygon).mean;

    // Building pad: flat at FFE with overbuild, except where truck pavement meets the dock wall.
    const truckRegion: Region = unionSolids([...courts.map((x) => [x.polygon]), ...aprons.map((x) => [x.polygon])]);
    const padRegion = difference(offsetRegion([building.polygon], c.padOverbuildFt, 'miter'), truckRegion);
    push({
      id: building.id,
      name: 'Building pad',
      category: 'pad',
      priority: PRIORITY.pad,
      region: padRegion,
      surface: (_x, _y, out) => {
        out[0] = 0;
        out[1] = 1;
      },
      sectionFt: (x, y) => (inBuilding(x, y) ? c.sectionBuildingSlabFt : 0),
    });
    building.polygon.forEach((p, i) => spots.push({ label: `Building corner ${i + 1} (FFE)`, at: p, z0: 0, k: 1 }));

    // Truck courts and aprons: dock height below FFE at the dock face, falling away from the building.
    const g = c.truckCourtSlopePct / 100;
    const courtSurface: GradingObject['surface'] = (x, y, out) => {
      out[0] = -c.dockHeightFt - g * toBuilding(x, y);
      out[1] = 1;
    };
    for (const ct of courts) {
      push({
        id: ct.id,
        name: ct.name,
        category: 'truckCourt',
        priority: PRIORITY.truckCourt,
        region: [ct.polygon],
        surface: courtSurface,
        sectionFt: (x, y) => (toBuilding(x, y) <= ct.apronFt ? c.sectionDockApronFt : c.sectionHeavyAsphaltFt),
      });
      const sgn = ct.side === '+v' ? 1 : -1;
      const ang = (building.rotationDeg * Math.PI) / 180;
      const mid: Pt = [building.center[0] - Math.sin(ang) * sgn * D2, building.center[1] + Math.cos(ang) * sgn * D2];
      spots.push({ label: `Dock face, ${ct.name}`, at: mid, z0: -c.dockHeightFt, k: 1 });
    }
    for (const a of aprons) push({ id: a.id, name: a.name, category: 'truckCourt', priority: PRIORITY.truckCourt, region: [a.polygon], surface: courtSurface, sectionFt: () => c.sectionHeavyAsphaltFt });
  }

  // Trailer fields (manual): follow the ground at a truck-court slope.
  for (const t of objs.filter((o): o is TrailerField => o.type === 'trailerField')) {
    const plane = groundPlane(dem, t.polygon, c.truckCourtMinSlopePct, c.truckCourtMaxSlopePct);
    push({ id: t.id, name: t.name, category: 'truckCourt', priority: PRIORITY.truckCourt, region: [t.polygon], surface: plane.surface, sectionFt: () => c.sectionHeavyAsphaltFt });
  }

  // Parking fields: attached fields hang off FFE (sidewalk elevation at the building edge); others follow the ground.
  for (const p of objs.filter((o): o is ParkingField => o.type === 'parkingField')) {
    if (p.attachedTo && building) {
      const pf: Frame = { origin: p.origin, angleDeg: p.angleDeg };
      const g = p.slopePct / 100;
      push({
        id: p.id,
        name: p.name,
        category: 'parking',
        priority: PRIORITY.parking,
        region: [p.polygon],
        surface: (x, y, out) => {
          out[0] = -c.parkingAnchorBelowFfeFt - g * toLocal(pf, [x, y])[1];
          out[1] = 1;
        },
        sectionFt: () => c.sectionStandardAsphaltFt,
      });
    } else {
      const plane = groundPlane(dem, p.polygon, c.parkingMinSlopePct, Math.min(c.parkingMaxSlopePct, c.adaDesignSlopePct));
      push({ id: p.id, name: p.name, category: 'parking', priority: PRIORITY.parking, region: [p.polygon], surface: plane.surface, sectionFt: () => c.sectionStandardAsphaltFt });
    }
  }

  // Basins: top of berm from existing ground (or the user's elevation), 3:1 interior slopes to the bottom.
  for (const b of objs.filter((o): o is Basin => o.type === 'basin')) {
    let top = b.topElevFt;
    if (top === null) {
      // Median existing ground along the perimeter: cut on the uphill half, a berm on the downhill half.
      const samples: number[] = [];
      const ring = b.polygon;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const q = ring[(i + 1) % ring.length];
        const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
        const nSeg = Math.max(1, Math.round(len / 10));
        for (let k = 0; k < nSeg; k++) samples.push(sampleGrid(dem, a[0] + ((q[0] - a[0]) * k) / nSeg, a[1] + ((q[1] - a[1]) * k) / nSeg));
      }
      samples.sort((x, y) => x - y);
      top = samples[Math.floor(samples.length * 0.5)] ?? b.meanExistingElevFt;
    }
    const bottom = top - (b.depthFt + b.freeboardFt);
    const sl = b.sideSlopeHtoV;
    const topElev = top;
    push({
      id: b.id,
      name: b.name,
      category: 'basin',
      priority: PRIORITY.basin,
      region: [b.polygon],
      surface: (x, y, out) => {
        out[0] = Math.max(bottom, topElev - distToRing([x, y], b.polygon) / sl);
        out[1] = 0;
      },
      sectionFt: () => 0,
    });
    spots.push({ label: `${b.name} top of berm`, at: b.polygon[0], z0: topElev, k: 0 });
  }

  // Drives: linear profile from the existing road at the ROW line to the adjacent object, 2 % cross slope.
  const drives: DriveProfile[] = [];
  const tmp = new Float64Array(2);
  for (const d of objs.filter((o): o is Drive => o.type === 'drive')) {
    const dw = objs.find((o): o is Driveway => o.type === 'driveway' && o.id === d.drivewayId);
    const start = d.centerline[0];
    const end = d.centerline[d.centerline.length - 1];
    const zStart = sampleGrid(dem, start[0], start[1]);
    const dest = d.toObjectId ? byId.get(d.toObjectId) : undefined;
    let endZ0 = sampleGrid(dem, end[0], end[1]);
    let endK = 0;
    if (dest) {
      dest.surface(end[0], end[1], tmp);
      endZ0 = tmp[0];
      endK = tmp[1];
    }
    const len = polylineLength(d.centerline);
    const cross = c.driveCrossSlopePct / 100;
    const half = d.widthFt / 2;
    const line = d.centerline;
    const region: Region = dw ? unionSolids([d.polygon, [dw.polygon]]) : d.polygon;
    push({
      id: d.id,
      name: d.name,
      category: 'drive',
      priority: PRIORITY.drive,
      region,
      surface: (x, y, out) => {
        const cp = closestOnPolyline([x, y], line);
        const t = len > 0 ? cp.station / len : 0;
        const off = Math.min(cp.d, half);
        out[0] = (1 - t) * zStart + t * endZ0 - cross * off;
        out[1] = t * endK;
      },
      sectionFt: () => (d.network === 'truck' ? c.sectionHeavyAsphaltFt : c.sectionStandardAsphaltFt),
    });
    drives.push({ id: d.id, name: d.name, network: d.network, lengthFt: len, startElevFt: zStart, endZ0, endK, maxGradePct: d.network === 'truck' ? c.truckDriveMaxGradePct : c.carDriveMaxGradePct });
    spots.push({ label: `Tie-in, ${d.name}`, at: start, z0: zStart, k: 0 });
  }

  return { objects, drives, padMeanExistingFt: padMean, spots };
}

/** FFE range in which every drive stays within its maximum grade. */
export function feasibleFfeRange(drives: DriveProfile[]): { minFt: number; maxFt: number; binding: string[] } | null {
  let min = -Infinity;
  let max = Infinity;
  let minBy = '';
  let maxBy = '';
  for (const d of drives) {
    if (d.endK <= 1e-9 || d.lengthFt <= 0) continue;
    const rise = (d.maxGradePct / 100) * d.lengthFt;
    const lo = (d.startElevFt - rise - d.endZ0) / d.endK;
    const hi = (d.startElevFt + rise - d.endZ0) / d.endK;
    if (lo > min) {
      min = lo;
      minBy = `${d.name}: ${d.maxGradePct}% down from the ${d.startElevFt.toFixed(1)} ft tie-in over ${Math.round(d.lengthFt)} ft sets the lowest FFE`;
    }
    if (hi < max) {
      max = hi;
      maxBy = `${d.name}: ${d.maxGradePct}% up from the ${d.startElevFt.toFixed(1)} ft tie-in over ${Math.round(d.lengthFt)} ft sets the highest FFE`;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { minFt: min, maxFt: max, binding: [minBy, maxBy] };
}
