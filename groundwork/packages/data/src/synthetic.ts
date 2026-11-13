/**
 * Synthetic fallback fixture for 1625 Heilmandale Rd (SPEC §6.3, docs/reference/site-heilmandale.md).
 * Used only when no live source is reachable. Everything it produces is labelled SYNTHETIC:
 * the road layout is a guess, the terrain is generated, the district polygons follow the 2020
 * Planning Commission minutes ("residential to the north and west, agricultural to the south and
 * along Route 72, commercial across Route 72"). Deterministic (seeded).
 */
import {
  EPSG_2272,
  type Grid,
  type Pt,
  type Ring,
  type SiteFixture,
  fromLonLat,
  lineIntersection,
  makeRng,
  norm,
  orientedRect,
  ringArea,
  sub,
} from '@groundwork/core';
import type { OrdinanceSection } from './fixtures';

/** Approximate location of the Route 72 / Heilmandale Rd area north of Lebanon, PA (not geocoded). */
const APPROX_LON_LAT: Pt = [-76.442, 40.3745];

const SYN = 'SYNTHETIC (generated; no network during the build)';

export function buildSyntheticHeilmandale(now: string): { fixture: SiteFixture; dem: Grid; ordinance: OrdinanceSection[] } {
  const o = fromLonLat(EPSG_2272, APPROX_LON_LAT);
  // Local design coordinates (ft) -> state plane, anchored so the parcel sits near the approximate location.
  const ox = Math.round(o[0] / 10) * 10 - 1250;
  const oy = Math.round(o[1] / 10) * 10 - 1050;
  const W = (p: Pt): Pt => [ox + p[0], oy + p[1]];
  const WR = (r: Pt[]): Pt[] => r.map(W);

  // ~110 ac irregular parcel, CCW from the SW corner. Area 4,774,800 SF = 109.6 ac.
  const P: Pt[] = [
    [60, 160],
    [880, 110],
    [1560, 0],
    [2520, 290],
    [2500, 2160],
    [0, 1920],
  ];
  const [SW, , , SE, NE, NW] = P;

  const offsetLine = (a: Pt, b: Pt, d: number, extA: number, extB: number): Pt[] => {
    const dir = norm(sub(b, a));
    const out: Pt = [dir[1], -dir[0]]; // right of a->b = outward for a CCW ring
    return [
      [a[0] + out[0] * d - dir[0] * extA, a[1] + out[1] * d - dir[1] * extA],
      [b[0] + out[0] * d + dir[0] * extB, b[1] + out[1] * d + dir[1] * extB],
    ];
  };
  // Right-of-way widths are class defaults (SPEC §6.2): state route 60 ft, local road 50 ft.
  const rt72 = offsetLine(SE, NE, 30, 900, 900); // south -> north along the east edge
  const heil = offsetLine(NE, NW, 25, 900, 900); // east -> west along the north edge
  const orange = offsetLine(NW, SW, 25, 500, 700); // north -> south along the west edge

  // District polygons run to street centerlines.
  const X = (l1: Pt[], l2: Pt[]): Pt => lineIntersection(l1[0], l1[1], l2[0], l2[1])!;
  const cNE = X(rt72, heil);
  const cNW = X(heil, orange);
  const south = -1400;
  const far = 1500;
  const dirHeil = norm(sub(heil[0], heil[1])); // pointing east
  const northOf = (p: Pt, d: number): Pt => [p[0] - dirHeil[1] * d, p[1] + dirHeil[0] * d];
  const heilW: Pt = [cNW[0] - dirHeil[0] * far, cNW[1] - dirHeil[1] * far];
  const heilE: Pt = [cNE[0] + dirHeil[0] * far, cNE[1] + dirHeil[1] * far];
  // Points where the parcel's south line meets the Orange Ln and Route 72 centerlines (approx.).
  const swC: Pt = [SW[0] - 25, SW[1]];
  const seC: Pt = [SE[0] + 30, SE[1]];
  const orangeS: Pt = [orange[1][0] - 0, south];
  const rt72S: Pt = [rt72[0][0], south];

  const districts: SiteFixture['districts'] = [
    { id: 'dist-i1', code: 'I-1', name: 'Industrial', kind: 'industrial', ring: WR([swC, P[1], P[2], seC, cNE, cNW]) },
    { id: 'dist-res-n', code: 'RES', name: 'Residential (north)', kind: 'residential', ring: WR([heilW, heilE, northOf(heilE, 1300), northOf(heilW, 1300)]) },
    { id: 'dist-res-w', code: 'RES', name: 'Residential (west)', kind: 'residential', ring: WR([[heilW[0], south], orangeS, swC, cNW, heilW]) },
    { id: 'dist-ag-s', code: 'AG', name: 'Agricultural', kind: 'agricultural', ring: WR([orangeS, rt72S, seC, P[2], P[1], swC]) },
    { id: 'dist-com-e', code: 'COM', name: 'Commercial', kind: 'commercial', ring: WR([rt72S, [heilE[0], south], heilE, cNE, seC]) },
  ];

  // ~4.8 ac wetland in the south-central low area (minutes: ~4.5–5 ac on the south side).
  const rng = makeRng(1625);
  const wet: Pt[] = [];
  const phases = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
  for (let k = 0; k < 40; k++) {
    const t = (k / 40) * Math.PI * 2;
    const wob = 1 + 0.09 * Math.sin(2 * t + phases[0]) + 0.06 * Math.sin(3 * t + phases[1]) + 0.04 * Math.sin(5 * t + phases[2]);
    wet.push([1300 + Math.cos(t) * 352 * wob, 335 + Math.sin(t) * 190 * wob]);
  }

  // As-built reference: 1,056 × 390 ft = 411,840 SF (area from the minutes; shape and position illustrative).
  const rot = (Math.atan2(NE[1] - NW[1], NE[0] - NW[0]) * 180) / Math.PI;
  const asBuilt: SiteFixture['asBuilt'] = [
    { id: 'asbuilt-bldg', name: 'As-built distribution center (411,840 SF)', kind: 'building', ring: WR(orientedRect([1290, 1230], 1056, 390, rot)), note: `${SYN}: area from the 2020 minutes; footprint shape and position are illustrative.` },
    { id: 'asbuilt-basin-w', name: 'As-built basin (west)', kind: 'basin', ring: WR(orientedRect([330, 900], 300, 620, rot)), note: `${SYN}: illustrative.` },
    { id: 'asbuilt-basin-s', name: 'As-built basin (south)', kind: 'basin', ring: WR(orientedRect([2010, 520], 560, 250, rot + 14)), note: `${SYN}: illustrative.` },
    { id: 'asbuilt-basin-e', name: 'As-built basin (east)', kind: 'basin', ring: WR(orientedRect([2290, 1560], 230, 420, rot)), note: `${SYN}: illustrative.` },
  ];

  // Terrain: ~40 ft of relief, a gentle valley draining south toward the wetland. 5 ft cells.
  const cellFt = 5;
  const buf = 500;
  const x0 = ox - buf;
  const y0 = oy - buf;
  const nx = Math.ceil((2520 + 2 * buf) / cellFt);
  const ny = Math.ceil((2160 + 2 * buf) / cellFt);
  const data = new Float32Array(nx * ny);
  const bumps = Array.from({ length: 14 }, () => ({ x: rng() * 3200 - 350, y: rng() * 2900 - 350, r: 260 + rng() * 420, a: (rng() - 0.5) * 3.4 }));
  const elev = (x: number, y: number): number => {
    let z = 476 + 0.0172 * y + 0.0016 * (x - 1250);
    // Swale running north -> south through the middle, deepening toward the south.
    const swaleX = 1300 + 90 * Math.sin(y / 700);
    z -= (6.5 - 0.0018 * y) * Math.exp(-(((x - swaleX) / 620) ** 2));
    // Shallow depression at the wetland.
    z -= 2.2 * Math.exp(-(((x - 1300) / 420) ** 2 + ((y - 335) / 260) ** 2));
    for (const b of bumps) z += b.a * Math.exp(-(((x - b.x) / b.r) ** 2 + ((y - b.y) / b.r) ** 2));
    return z;
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      data[j * nx + i] = elev((i + 0.5) * cellFt - buf, (j + 0.5) * cellFt - buf);
    }
  }
  const dem: Grid = { x0, y0, cellFt, nx, ny, data };

  const prov = (layer: string, notes: string): SiteFixture['provenance'][number] => ({
    layer,
    sourceUrl: 'synthetic://groundwork/make-synthetic-fixture',
    fetchedAt: now,
    license: 'Generated by Groundwork (no third-party data)',
    notes,
    synthetic: true,
  });

  const parcelRing: Ring = WR(P);
  const fixture: SiteFixture = {
    id: 'heilmandale',
    name: '1625 Heilmandale Rd (synthetic fixture)',
    address: '1625 Heilmandale Rd, Lebanon, PA 17046 (North Lebanon Township, Lebanon County)',
    jurisdiction: 'North Lebanon Township, Lebanon County, PA',
    crs: EPSG_2272,
    synthetic: true,
    parcel: { id: 'synthetic-parcel-1', ring: parcelRing, recordAreaAc: 110 },
    zoningDistrictCode: 'I-1',
    addressRoadName: 'Heilmandale Rd',
    roads: [
      { id: 'road-rt72', name: 'Route 72', ref: 'PA 72', roadClass: 'state', centerline: WR(rt72), rowWidthFt: 60, rowAssumed: true },
      { id: 'road-heilmandale', name: 'Heilmandale Rd', roadClass: 'local', centerline: WR(heil), rowWidthFt: 50, rowAssumed: true },
      { id: 'road-orange', name: 'Orange Ln', roadClass: 'local', centerline: WR(orange), rowWidthFt: 50, rowAssumed: true },
    ],
    districts,
    constraints: [
      {
        id: 'wetland-1',
        kind: 'wetland',
        name: `Wetland ≈ ${(ringArea(wet) / 43560).toFixed(1)} ac`,
        ring: WR(wet),
        bufferFt: 25,
        informational: false,
        source: `${SYN}; size per the 2020 Planning Commission minutes (~4.5–5 ac, south side, not to be disturbed). 25 ft no-disturb buffer is an EFCG assumption.`,
      },
    ],
    asBuilt,
    terrain: { x0, y0, cellFt, nx, ny, source: `${SYN}: ~40 ft of relief draining south toward the wetland`, synthetic: true, preDevelopment: true, verticalDatum: 'NAVD88 (nominal)', file: 'dem.f32' },
    imagery: { available: false, attribution: '' },
    provenance: [
      prov('parcel', 'Approximate, digitized-style placeholder: ~110 ac irregular parcel (109.6 ac). Not the recorded parcel boundary.'),
      prov('roads', 'Route 72 along the east edge, Heilmandale Rd along the north edge, Orange Ln along the west edge. Layout is a guess; ROW widths are class defaults.'),
      prov('districts', 'From the 2020 Planning Commission minutes: residential N and W, agricultural S, commercial across Route 72. Generic codes (RES/AG/COM); verify against the 2023 zoning map.'),
      prov('wetlands', '~4.8 ac polygon on the south side, per the 2020 minutes. Not NWI data.'),
      prov('floodplain', 'No floodplain layer (FEMA NFHL not reachable).'),
      prov('terrain', 'Generated surface, ~40 ft relief, draining south. Not LiDAR. Pre-development by construction.'),
      prov('asBuilt', '411,840 SF footprint (area from the minutes) and three basins totalling ~10 ac; shapes and positions illustrative.'),
      prov('imagery', 'None cached (USGS imagery service not reachable).'),
      prov('location', `Anchored near lon ${APPROX_LON_LAT[0]}, lat ${APPROX_LON_LAT[1]} (approximate; not geocoded).`),
    ],
  };

  return { fixture, dem, ordinance: referenceOrdinance() };
}

/**
 * Ordinance text cache built from docs/reference/zoning-north-lebanon-I1.md. These are the reference
 * document's EXTRACTS (verbatim: false), not the official wording; eCode360 and the Zoneomics mirror
 * were unreachable during the build.
 */
export function referenceOrdinance(): OrdinanceSection[] {
  const src = 'docs/reference/zoning-north-lebanon-I1.md (extract of the Zoneomics reproduction, 2026-11-13). Official code: https://ecode360.com/NO1608';
  const s = (section: string, title: string, text: string): OrdinanceSection => ({ section, title, text, source: src, verbatim: false });
  return [
    s('27-1002', 'I-1 Industrial: permitted uses', 'Permitted by right in I-1: warehousing, wholesaling, storage (not junk yards), and trucking/transit facilities. A distribution warehouse is a permitted use.'),
    s(
      '27-1003',
      'I-1 Industrial: lot, yard and height requirements',
      [
        'Min lot area: 2 ac.',
        'Min lot width: 200 ft.',
        'Max lot coverage: 50%. (The definition of "lot coverage" is in § 27-102, Part 1 Definitions; not cached.)',
        'Front yard: 100 ft min from any road right-of-way; 150 ft when across the street from a residential district.',
        'Side yard: 20 ft min each side.',
        'Rear yard: 30 ft min.',
        'No building within 150 ft of a residentially zoned district.',
        'Max height: 75 ft (principal or accessory). Chimneys, flagpoles, towers, water tanks, mechanical appurtenances up to 125 ft.',
        'Yards landscaped per Part 13.',
      ].join('\n'),
    ),
    s('27-1004', 'I-1 Industrial: parking and loading', 'Parking and loading per Part 14 (§§ 27-1401 to 27-1411).'),
    s('27-1007', 'I-1 Industrial: environmental improvements', 'Environmental improvements (landscaping, buffers, screening) per Part 13 (§§ 27-1301 to 27-1309).'),
    s(
      '27-1302',
      'Part 13 definitions (landscaping)',
      [
        'Dense screen planting: ≥ 80% coniferous trees/shrubs, hedges, mounding, walls or combination, ≥ 6 ft high, ≥ 5 ft wide.',
        'Interior islands: ≥ 50 SF and ≥ 5 ft wide; ≥ 1 shade tree per 40 LF of island.',
        'Perimeter planting: trees/shrubs ≤ 50 ft apart along a grass/ground-cover border.',
      ].join('\n'),
    ),
    s(
      '27-1303',
      'Part 13: where landscaping is required',
      ['§ 27-1303.1.D: dense screen plantings required within all specified buffer areas.', '§ 27-1303.1.E: parking lot landscaping: perimeter for lots ≥ 10 spaces; interior for lots ≥ 25 spaces.'].join('\n'),
    ),
    s(
      '27-1304',
      'Part 13: landscaping standards',
      [
        '§ 27-1304.1.A.1: min landscaped area 15% of each developed lot.',
        '§ 27-1304.1.A.4: trees ≥ 1.5 in caliper, disease resistant, salt tolerant, winter hardy.',
        '§ 27-1304.1.B.1: screen plantings separate non-residential uses from adjoining residential uses.',
        '§ 27-1304.1.B.3.a: parking lots of ≥ 10 spaces ≥ 20 ft from the building line of any principal building, with screen plantings in that 20 ft.',
        '§ 27-1304.1.B.3.b: walls > 75 ft long facing westerly/southwesterly/northwesterly need a parallel screen planting of equal length within 50 ft of the wall.',
      ].join('\n'),
    ),
    s('27-1402', 'Part 14: parking space size', 'Car stall size: ≥ 10 ft wide × 20 ft long, exclusive of drives, curbs, turning space.'),
    s(
      '27-1404',
      'Part 14: parking location and labeling',
      [
        '§ 27-1404.E: accessible ("handicapped") parking must be labeled; count and dimensions are not given in Part 14.',
        '§ 27-1404.G: parking setback from street ROW ≥ 25 ft; up to 50% of the required front yard may be used for parking if the 25 ft setback is kept.',
        '§ 27-1404.G: parking setback from side/rear property lines ≥ 10 ft.',
        '§ 27-1404.G: parking setback from a residential district boundary (Industrial) ≥ 100 ft.',
        '§ 27-1404.G (with § 27-1408): loading not in the required front yard.',
      ].join('\n'),
    ),
    s(
      '27-1405',
      'Part 14: parking ratios',
      [
        'Item S, service and storage establishments: 1 space per 2 employees on the combined two largest successive shifts.',
        'Item V, manufacturing / labs / "other manufacturing-district uses": 1 space per employee on the largest shift.',
        'Item W, executive/sales office, outlet: +1 space per 200 SF of office floor area.',
        'Item X, unlisted use: Zoning Administrator applies the most similar use. (There is no "warehouse" line.)',
      ].join('\n'),
    ),
    s(
      '27-1407',
      'Part 14: aisles and driveways',
      [
        'Aisle width where stalls face each other: ≥ 20 ft.',
        'Driveway width at street line: 1 lane 12–14 ft; 2 lanes 20–28 ft; 3 lanes 30–40 ft; max 3 lanes.',
        'Driveway spacing: centerline ≥ 150 ft from the ROW line of the nearest intersecting street, and from any other driveway.',
        'Driveway apron radius: ≥ 15 ft.',
        'Multiple driveways: one-way where possible.',
      ].join('\n'),
    ),
    s(
      '27-1408',
      'Part 14: off-street loading',
      [
        'Loading berth size: ≥ 12 ft × 55 ft (≥ 660 SF), ≥ 15 ft vertical clearance.',
        'Loading berths required by floor area: 0–2,000 SF: 0 (conditions); 2,001–10,000: 1; 10,001–50,000: 2; > 50,000: 3 + 1 per each additional 40,000 SF.',
        'Loading location: side or rear of principal structure, outside public ROW; not in the required front yard.',
      ].join('\n'),
    ),
    s('27-1410', 'Part 14: grade and surfacing', ['Max parking area grade: 4%.', 'Surfacing: hard-surfaced for non-residential.'].join('\n')),
  ];
}
