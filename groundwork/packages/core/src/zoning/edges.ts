/**
 * Parcel edge classification: front (on a road ROW), side, rear; plus residential adjacency flags.
 * Uses road adjacency and the zoning-district polygons; manual overrides are applied on top.
 */
import {
  type Pt,
  type Ring,
  axisAngleDiffDeg,
  azimuthDeg,
  closestOnPolyline,
  dist,
  dot,
  ensureCCW,
  lerp,
  norm,
  pointInRing,
  radToDeg,
  ringArea,
  sub,
} from '../geometry/basic';
import type { District, EdgeClass, ParcelEdge, Road, Site, SiteFixture } from '../site/model';
import { compass8 } from '../site/units';
import type { Grid } from '../geometry/grid';

/** Digitizing tolerance when matching a parcel edge to a road right-of-way line, ft. */
const ROW_MATCH_TOL_FT = 20;
/** Max angle between an edge and the road for the edge to count as frontage, degrees. */
const FRONTAGE_ANGLE_TOL_DEG = 30;
/**
 * How far a road centerline may sit on the lot side of a frontage edge, ft: lots deeded to the
 * centerline wander a few feet either side of it, and a lane can run just inside the lot line
 * (then up to half its ROW width is accepted).
 */
const CENTERLINE_SIDE_TOL_FT = 15;

export type EdgeOverride = { index: number; edgeClass?: EdgeClass; abutsResidential?: boolean; acrossStreetFromResidential?: boolean };

function outwardNormal(a: Pt, b: Pt): Pt {
  // Ring is CCW, so the interior is on the left and the outward normal is on the right.
  const d = norm(sub(b, a));
  return [d[1], -d[0]];
}

function districtAt(p: Pt, districts: District[]): District | undefined {
  // Smallest containing polygon wins (so an enclave beats the surrounding district).
  let best: District | undefined;
  let bestArea = Infinity;
  for (const d of districts) {
    if (pointInRing(p, d.ring)) {
      const a = ringArea(d.ring);
      if (a < bestArea) {
        best = d;
        bestArea = a;
      }
    }
  }
  return best;
}

export function classifyEdges(
  parcelRing: Ring,
  roads: Road[],
  districts: District[],
  opts: { addressRoadName?: string; overrides?: EdgeOverride[] } = {},
): ParcelEdge[] {
  const ring = ensureCCW(parcelRing);
  const n = ring.length;
  const edges: ParcelEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const lengthFt = dist(a, b);
    const out = outwardNormal(a, b);
    const edgeAngle = radToDeg(Math.atan2(b[1] - a[1], b[0] - a[0]));
    let road: Road | undefined;
    let bestScore = 0;
    let roadDist = 0;
    for (const r of roads) {
      let hits = 0;
      let dSum = 0;
      for (const t of [0.2, 0.5, 0.8]) {
        const p = lerp(a, b, t);
        const c = closestOnPolyline(p, r.centerline);
        const seg = [r.centerline[c.segIndex], r.centerline[c.segIndex + 1]];
        const roadAngle = radToDeg(Math.atan2(seg[1][1] - seg[0][1], seg[1][0] - seg[0][0]));
        // The road must be on the OUTSIDE of the edge and roughly parallel to it.
        const toRoad = sub(c.pt, p);
        // A lot deeded to the road centerline can sit a few feet either side of the digitized line.
        if (
          c.d <= r.rowWidthFt / 2 + ROW_MATCH_TOL_FT &&
          axisAngleDiffDeg(edgeAngle, roadAngle) <= FRONTAGE_ANGLE_TOL_DEG &&
          dot(toRoad, out) > -Math.max(CENTERLINE_SIDE_TOL_FT, r.rowWidthFt / 2)
        ) {
          hits++;
          dSum += dot(toRoad, out);
        }
      }
      // Prefer more hits, then the closer centerline (two roads can both pass near a corner edge).
      const score = hits >= 2 ? hits * 1000 - dSum / hits : 0;
      if (score > bestScore) {
        bestScore = score;
        road = r;
        roadDist = dSum / hits; // signed: negative when the centerline runs inside the lot line
      }
    }
    const mid = lerp(a, b, 0.5);
    const probeDist = road ? road.rowWidthFt + ROW_MATCH_TOL_FT + 10 : 15;
    const probe: Pt = [mid[0] + out[0] * probeDist, mid[1] + out[1] * probeDist];
    const adj = districtAt(probe, districts);
    const residential = adj?.kind === 'residential';
    edges.push({
      index: i,
      a,
      b,
      lengthFt,
      facing: compass8(azimuthDeg(out)),
      edgeClass: road ? 'front' : 'side',
      roadId: road?.id,
      roadName: road?.name,
      adjacentDistrictCode: adj?.code,
      adjacentDistrictKind: adj?.kind,
      abutsResidential: !road && residential,
      acrossStreetFromResidential: !!road && residential,
      rowInsetFt: road ? Math.max(0, Math.round((road.rowWidthFt / 2 - roadDist) * 10) / 10) : 0,
      overridden: false,
    });
  }

  // Rear = non-front edges facing away from the primary frontage (address road, else the longest frontage).
  const fronts = edges.filter((e) => e.edgeClass === 'front');
  if (fronts.length) {
    const byRoad = new Map<string, number>();
    for (const e of fronts) byRoad.set(e.roadId!, (byRoad.get(e.roadId!) ?? 0) + e.lengthFt);
    let primaryRoadId = [...byRoad.entries()].sort((x, y) => y[1] - x[1])[0][0];
    if (opts.addressRoadName) {
      const want = normalizeRoadName(opts.addressRoadName);
      const m = roads.find((r) => byRoad.has(r.id) && normalizeRoadName(r.name) === want);
      if (m) primaryRoadId = m.id;
    }
    let nx = 0;
    let ny = 0;
    for (const e of fronts) {
      if (e.roadId !== primaryRoadId) continue;
      const o = outwardNormal(e.a, e.b);
      nx += o[0] * e.lengthFt;
      ny += o[1] * e.lengthFt;
    }
    const primary = norm([nx, ny]);
    for (const e of edges) {
      if (e.edgeClass === 'front') continue;
      const o = outwardNormal(e.a, e.b);
      e.edgeClass = dot(o, [-primary[0], -primary[1]]) > Math.SQRT1_2 ? 'rear' : 'side';
    }
  }

  for (const ov of opts.overrides ?? []) {
    const e = edges[ov.index];
    if (!e) continue;
    if (ov.edgeClass) e.edgeClass = ov.edgeClass;
    if (ov.abutsResidential !== undefined) e.abutsResidential = ov.abutsResidential;
    if (ov.acrossStreetFromResidential !== undefined) e.acrossStreetFromResidential = ov.acrossStreetFromResidential;
    e.overridden = true;
  }
  return edges;
}

export function normalizeRoadName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bpa\b|\bstate\b|\bsr\b/g, '')
    .replace(/\broute\b|\brte\b|\brt\b/g, 'route')
    .replace(/\broad\b/g, 'rd')
    .replace(/\blane\b/g, 'ln')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Find a road by (fuzzy) name or ref, e.g. "Route 72", "PA 72", "Heilmandale Road". */
export function findRoad(site: Pick<Site, 'roads'>, name: string): Road | undefined {
  const want = normalizeRoadName(name);
  const wantNum = want.match(/\d+/)?.[0];
  return (
    site.roads.find((r) => normalizeRoadName(r.name) === want || r.id === name) ??
    site.roads.find((r) => normalizeRoadName(r.name).includes(want) || want.includes(normalizeRoadName(r.name))) ??
    (wantNum ? site.roads.find((r) => (r.ref ?? '').includes(wantNum) || normalizeRoadName(r.name).includes(wantNum)) : undefined)
  );
}

export type Frontage = { roadId: string; roadName: string; line: Pt[]; lengthFt: number; edgeIndexes: number[]; acrossStreetFromResidential: boolean };

/** Contiguous frontage polyline for each road (edges chained in ring order). */
export function frontages(edges: ParcelEdge[]): Frontage[] {
  const out: Frontage[] = [];
  const n = edges.length;
  if (!n) return out;
  // Start at an edge whose predecessor is on a different road so runs don't wrap.
  let start = 0;
  for (let i = 0; i < n; i++) {
    const prev = edges[(i - 1 + n) % n];
    if (prev.roadId !== edges[i].roadId) {
      start = i;
      break;
    }
  }
  let cur: Frontage | null = null;
  for (let k = 0; k < n; k++) {
    const e = edges[(start + k) % n];
    if (e.edgeClass === 'front' && e.roadId) {
      if (cur && cur.roadId === e.roadId) {
        cur.line.push(e.b);
        cur.lengthFt += e.lengthFt;
        cur.edgeIndexes.push(e.index);
        cur.acrossStreetFromResidential ||= e.acrossStreetFromResidential;
      } else {
        cur = {
          roadId: e.roadId,
          roadName: e.roadName ?? e.roadId,
          line: [e.a, e.b],
          lengthFt: e.lengthFt,
          edgeIndexes: [e.index],
          acrossStreetFromResidential: e.acrossStreetFromResidential,
        };
        out.push(cur);
      }
    } else cur = null;
  }
  // Merge split runs of the same road (keep the longest as the main frontage).
  const merged = new Map<string, Frontage>();
  for (const f of out) {
    const m = merged.get(f.roadId);
    if (!m || f.lengthFt > m.lengthFt) merged.set(f.roadId, f);
  }
  return [...merged.values()];
}

/** Assemble the runtime Site from a fixture and its DEM grid. */
export function assembleSite(fixture: SiteFixture, dem: Grid, overrides: EdgeOverride[] = []): Site {
  const ring = ensureCCW(fixture.parcel.ring);
  const edges = classifyEdges(ring, fixture.roads, fixture.districts, { addressRoadName: fixture.addressRoadName, overrides });
  return { ...fixture, parcel: { ...fixture.parcel, ring }, areaSf: ringArea(ring), edges, dem };
}
