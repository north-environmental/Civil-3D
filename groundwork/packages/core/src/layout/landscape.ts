/** Landscape areas generated with the layout: building strips, wall screens, residential buffers. */
import { type Pt, type Ring, azimuthDeg, frameRect, outwardNormalOf, ringArea } from '../geometry/basic';
import type { LayoutCriteria } from '../criteria/layout';
import type { Site } from '../site/model';
import type { Building, LandscapeArea, ParkingField, Side } from '../site/project';
import { buildingFrame } from './building';

/** Width of the screen-planting strip reserved along residential-facing lot lines, ft (EFCG default; inside the 25 ft street parking setback). */
export const BUFFER_STRIP_FT = 20;
/** Width of a wall screen-planting strip, ft (EFCG default; § 27-1302 dense screen is ≥ 5 ft wide). */
export const WALL_SCREEN_FT = 12;

const SIDES: Side[] = ['-v', '+u', '+v', '-u']; // order of building.polygon edges

export function makeLandscape(site: Site, b: Building, fields: ParkingField[], c: LayoutCriteria, rule: { wallMinFt: number; withinFt: number } | null, parkingToBuildingFt: number): LandscapeArea[] {
  const out: LandscapeArea[] = [];
  const f = buildingFrame(b);
  const L2 = b.lengthFt / 2;
  const D2 = b.depthFt / 2;
  let k = 0;
  const add = (kind: LandscapeArea['kind'], name: string, polygon: Ring, note: string, wallSide?: Side) =>
    out.push({ id: `ls-${++k}`, name, auto: true, type: 'landscape', kind, polygon, areaSf: ringArea(polygon), note, wallSide });

  const stripFor = (side: Side, width: number, offset = 0): Ring => {
    switch (side) {
      case '-u':
        return frameRect(f, -L2 - offset - width, -D2, -L2 - offset, D2);
      case '+u':
        return frameRect(f, L2 + offset, -D2, L2 + offset + width, D2);
      case '+v':
        return frameRect(f, -L2, D2 + offset, L2, D2 + offset + width);
      case '-v':
        return frameRect(f, -L2, -D2 - offset - width, L2, -D2 - offset);
    }
  };

  // Strip between the car parking and the building (sidewalk + screen plantings, § 27-1304.1.B.3.a).
  const carSides = new Set(fields.filter((x) => x.attachedTo?.buildingId === b.id).map((x) => x.attachedTo!.side));
  for (const side of carSides) add('strip', 'Building frontage strip (sidewalk + screen planting)', stripFor(side, parkingToBuildingFt), `§ 27-1304.1.B.3.a: ${parkingToBuildingFt} ft between parking and the building; ${c.sidewalkFt} ft sidewalk inside it.`, side);

  // Screen planting for long walls facing W / SW / NW (§ 27-1304.1.B.3.b), where no truck court is in the way.
  if (rule) {
    for (let i = 0; i < 4; i++) {
      const side = SIDES[i];
      const a = b.polygon[i];
      const bb = b.polygon[(i + 1) % 4];
      const len = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
      if (len <= rule.wallMinFt) continue;
      const az = azimuthDeg(outwardNormalOf(b.polygon, i));
      if (az < 202.5 || az > 337.5) continue;
      if (carSides.has(side) || b.dockSides.includes(side)) continue;
      add('screen', 'Wall screen planting', stripFor(side, WALL_SCREEN_FT, 4), `§ 27-1304.1.B.3.b: parallel screen planting within ${rule.withinFt} ft of a wall facing W/SW/NW.`, side);
    }
  }

  // Dense screen planting strips along lot lines that face residential districts (§ 27-1303.1.D).
  for (const e of site.edges) {
    if (!(e.abutsResidential || e.acrossStreetFromResidential) || e.lengthFt < 60) continue;
    const dx = (e.b[0] - e.a[0]) / e.lengthFt;
    const dy = (e.b[1] - e.a[1]) / e.lengthFt;
    const inward: Pt = [-dy, dx];
    const t = Math.min(30, e.lengthFt / 4);
    const a: Pt = [e.a[0] + dx * t, e.a[1] + dy * t];
    const bEnd: Pt = [e.b[0] - dx * t, e.b[1] - dy * t];
    const off = 3;
    const ring: Ring = [
      [a[0] + inward[0] * off, a[1] + inward[1] * off],
      [bEnd[0] + inward[0] * off, bEnd[1] + inward[1] * off],
      [bEnd[0] + inward[0] * (off + BUFFER_STRIP_FT), bEnd[1] + inward[1] * (off + BUFFER_STRIP_FT)],
      [a[0] + inward[0] * (off + BUFFER_STRIP_FT), a[1] + inward[1] * (off + BUFFER_STRIP_FT)],
    ];
    add('buffer', `Buffer screen planting (${e.roadName ? `along ${e.roadName}` : `${e.facing} lot line`})`, ring, '§ 27-1303.1.D / § 27-1304.1.B.1: dense screen planting toward the residential district.');
  }
  return out;
}
