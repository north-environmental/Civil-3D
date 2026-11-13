# North Lebanon Township (Lebanon County, PA): I-1 Industrial rules for the demo

**Source status:** These were extracted on 2026-11-13 from a third-party reproduction of the code (Zoneomics: `https://www.zoneomics.com/code/north-lebanon-township-PA`). The **official** code is eCode360 `https://ecode360.com/NO1608` (Chapter 27, Zoning).

During the build:
- Try to fetch the official text and reconcile.
- Where they differ, the official text wins; log the difference in DECISIONS.md.
- Amendments after the mirror's snapshot (e.g., Ord. 2-2023) may change values.

Every rule below ships pre-loaded and **confirmed** for the demo. Keep the citation and quote fields so the UI and Claude can cite them.

## Rule schema (TypeScript sketch)

```ts
type ZoningRule = {
  id: string;                    // e.g. "I1.frontYard"
  district: string;              // "I-1"
  category: "setback" | "coverage" | "height" | "lot" | "parking" | "loading" | "landscape" | "access" | "grade" | "use";
  appliesTo: "building" | "parking" | "loading" | "pavement" | "lot" | "driveway" | "landscape";
  edgeCondition?: "front" | "side" | "rear" | "abutsResidential" | "acrossStreetFromResidential";
  value: number | Record<string, number> | string;
  units: "ft" | "pct" | "sf" | "ac" | "count" | "ratio" | "text";
  operator: "min" | "max" | "eq" | "table" | "text";
  citation: { section: string; source: "ecode360" | "zoneomics" | "reference-doc"; url?: string; quote: string };
  interpretationFlags?: string[];  // human-readable notes on ambiguity and the conservative choice made
  confirmed: boolean;
};
```

## Use (§ 27-1002)
- Permitted by right in I-1: warehousing, wholesaling, storage (not junk yards), and trucking/transit facilities. A distribution warehouse is a permitted use.

## Lot and yard (§ 27-1003)
| Rule | Value | Notes |
|---|---|---|
| Min lot area | 2 ac | |
| Min lot width | 200 ft | |
| Max lot coverage | 50% | **Flag:** check the definition of "lot coverage" in § 27-102 (Part 1, Definitions). If it covers buildings only, apply it to building footprint; if it includes impervious, apply it to impervious. Until resolved, compute both and evaluate the buildings-only reading, with a warn-level note on impervious. |
| Front yard | 100 ft min from any road right-of-way | 150 ft when across the street from a residential district |
| Side yard | 20 ft min each side | |
| Rear yard | 30 ft min | |
| Residential separation (buildings) | No building within 150 ft of a residentially zoned district | Applies to side and rear; treat as a building-only offset from the residential district boundary |
| Max height | 75 ft (principal or accessory) | Chimneys, flagpoles, towers, water tanks, mechanical appurtenances up to 125 ft |
| Yards landscaped | Per Part 13 | |

## Parking and loading (§ 27-1004 → Part 14, §§ 27-1401 to 27-1411)
| Rule | Value | Section |
|---|---|---|
| Car stall size | ≥ 10 ft wide × 20 ft long, exclusive of drives, curbs, turning space | § 27-1402 |
| Aisle width where stalls face each other | ≥ 20 ft (design default 24 ft for two-way 90°; note that the default exceeds the minimum) | § 27-1407 |
| Parking ratio: manufacturing / labs / "other manufacturing-district uses" | 1 space per employee on the largest shift | § 27-1405 (item V) |
| Parking ratio: service and storage establishments | 1 space per 2 employees on the combined two largest successive shifts | § 27-1405 (item S) |
| Parking ratio: executive/sales office, outlet | +1 space per 200 SF of office floor area | § 27-1405 (item W) |
| Unlisted use | Zoning Administrator applies the most similar use | § 27-1405 (item X). **Flag:** there's no "warehouse" line. Default to "service and storage" (S) plus office (W), compute the manufacturing (V) reading too, and show both. |
| Loading berth size | ≥ 12 ft × 55 ft (≥ 660 SF), ≥ 15 ft vertical clearance | § 27-1408 |
| Loading berths required | 0–2,000 SF: 0 (conditions); 2,001–10,000: 1; 10,001–50,000: 2; > 50,000: 3 + 1 per each additional 40,000 SF | § 27-1408. **Flag:** partial 40,000 SF increments rounded **up** (conservative). 411,840 SF → 3 + ceil(361,840/40,000) = 3 + 10 = **13** (12 if rounded down). |
| Loading location | Side or rear of principal structure, outside public ROW; not in the required front yard | § 27-1408, § 27-1404.G |
| Parking setback from street ROW | ≥ 25 ft. Up to 50% of the required front yard may be used for parking if the 25 ft setback is kept. | § 27-1404.G |
| Parking setback, side/rear property lines | ≥ 10 ft | § 27-1404.G |
| Parking setback from residential district boundary (Industrial) | ≥ 100 ft | § 27-1404.G |
| Driveway width at street line | 1 lane 12–14 ft; 2 lanes 20–28 ft; 3 lanes 30–40 ft; max 3 lanes | § 27-1407. **Flag:** 28 ft max for two lanes is tight for WB-67 trucks. Keep the throat ≤ 28 ft at the street line and flare beyond, or use a 3-lane (≤ 40 ft) truck entrance, and log the choice. |
| Driveway spacing | Centerline ≥ 150 ft from the ROW line of the nearest intersecting street, and from any other driveway | § 27-1407 |
| Driveway apron radius | ≥ 15 ft | § 27-1407 |
| Multiple driveways | One-way where possible | § 27-1407 (advisory → warn) |
| Max parking area grade | 4% | § 27-1410 |
| Surfacing | Hard-surfaced for non-residential | § 27-1410 |
| Accessible ("handicapped") parking | Must be labeled; count and dimensions not given in Part 14 | § 27-1404.E. Use the 2010 ADA Standards (see engineering-criteria.md). |

## Environmental improvements (§ 27-1007 → Part 13, §§ 27-1301 to 27-1309)
| Rule | Value | Section |
|---|---|---|
| Min landscaped area | 15% of each developed lot | § 27-1304.1.A.1 |
| Buffer/screen plantings | Dense screen plantings required within all specified buffer areas. Dense screen = ≥ 80% coniferous trees/shrubs, hedges, mounding, walls or combination, ≥ 6 ft high, ≥ 5 ft wide. Separate non-residential uses from adjoining residential uses. | § 27-1302 (def.), § 27-1303.1.D, § 27-1304.1.B.1 |
| Parking lot landscaping | Perimeter for lots ≥ 10 spaces; interior for lots ≥ 25 spaces | § 27-1303.1.E |
| Interior islands | ≥ 50 SF and ≥ 5 ft wide; ≥ 1 shade tree per 40 LF of island | § 27-1302 (def.) |
| Perimeter planting | Trees/shrubs ≤ 50 ft apart along a grass/ground-cover border | § 27-1302 (def.) |
| Parking lot to building | Lots of ≥ 10 spaces ≥ 20 ft from the building line of any principal building, with screen plantings in that 20 ft | § 27-1304.1.B.3.a. **Flag:** this is a real constraint on employee parking near the office. Apply it. Sidewalk + plantings fit in the 20 ft. Whether trailer parking in truck courts counts as a "parking lot" is ambiguous; default: does not apply to truck courts (warn-level note). |
| Long walls facing W/SW/NW | Walls > 75 ft long facing westerly/southwesterly/northwesterly need a parallel screen planting of equal length within 50 ft of the wall | § 27-1304.1.B.3.b. Generate the planting strip automatically and include it in landscape area. |
| Planting standards | Trees ≥ 1.5 in caliper, disease resistant, salt tolerant, winter hardy | § 27-1304.1.A.4 (informational) |

## Other relevant documents (cache if reachable)
- Zoning map (2023): `https://northlebanontwppa.gov/wp-content/uploads/2023/06/NLT-Zoning-Map-2023.pdf`
- SALDO (2024): `https://northlebanontwppa.gov/wp-content/uploads/2024/10/0.-SLDO-2024.pdf`. Likely holds parking-lot geometry, driveway grade, curb and sidewalk standards. If you extract rules from it, add them with citations as `confirmed: false` and surface them for confirmation.
- Stormwater ordinance (Ord. 6-2022): `https://northlebanontwppa.gov/wp-content/uploads/2022/08/Ord-6-2022-SWM-Ordinance-FINAL.pdf`. Informational for the basin-reservation assumption.
- Township ordinance page: `https://northlebanontwppa.gov/ordinance/`. Note that zoning district confirmation is handled by the Lebanon County Planning Department.
