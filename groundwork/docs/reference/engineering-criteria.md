# Engineering criteria, design defaults and hand-calc tests

Every value here becomes a constant in `packages/core/src/criteria/` with a source comment. "EFCG default" means an industry-typical planning assumption chosen for this demo. It must appear in the Assumptions list and be editable.

## Units and conversions
- Horizontal: US survey feet (EPSG:2272 for the demo). Vertical: feet, NAVD88. 3DEP DEMs are in meters, so convert with 1 m = 3.280833 ftUS; the difference vs. international feet is negligible at site scale, but be consistent.
- 1 ac = 43,560 SF. 1 CY = 27 CF. Percent slopes stored as percent numbers (2.0 = 2%), never as fractions, in UI and tool I/O. Internal math may use fractions; convert at the boundary and name variables accordingly.

## Industrial layout defaults (EFCG defaults unless cited)
| Item | Default | Range / notes |
|---|---|---|
| Cross-dock building depth | 540 ft | 500–620 typical for 400k+ SF |
| Rear-load building depth | 340 ft | 300–400 |
| Clear height | 40 ft | Building height ≈ clear + 6 ft → 46 ft (≤ 75 ft, § 27-1003) |
| Dock door spacing | 12 ft o.c. | 12–14; keep ~50 ft clear at each building corner |
| Dock height (FFE to truck court at dock face) | 4.0 ft | 48 in typical |
| Building pad overbuild | 10 ft | |
| Office area | 10,000 SF total | at car-side corner(s) |
| Truck court: concrete dock apron | 60 ft | |
| Truck court: maneuvering lane | 70 ft | |
| Trailer stall | 12 × 55 ft | matches § 27-1408 berth size |
| Truck court depth | 130 ft (no trailer row) / 185 ft (with trailer row opposite docks) | |
| Truck drive aisle (two-way) | 32 ft | 30–40 |
| Truck entrance curb return | 60 ft | ≥ 50 ft for WB-67 |
| Car stall | 10 × 20 ft | § 27-1402 minimum governs (larger than the common 9 × 18) |
| Car aisle (two-way, 90°) | 24 ft | ≥ 20 ft per § 27-1407 |
| Parking module (stall–aisle–stall) | 64 ft | 20 + 24 + 20 |
| Car drive aisle | 24 ft | |
| Car entrance curb return | 25 ft | ≥ 15 ft per § 27-1407 |
| Sidewalk along office face | 6 ft | inside the 20 ft parking-to-building strip (§ 27-1304.1.B.3.a) |
| Stormwater reservation method | `pctOfSite` = 9% of gross parcel area | Calibrated to the as-built (~10 ac of basins on ~110 ac per the 2020 Planning Commission minutes). Alt method `runoffDepth`: 3.0 in over new impervious, 6 ft basin depth, 1 ft freeboard, 3:1 interior slopes. Planning-level only. |

## Grading defaults
| Item | Default | Notes |
|---|---|---|
| Tie-in (daylight) slope | 3:1 (H:V) max | 4:1 preferred for mowing (warn if steeper than 4:1 in lawn areas, fail if steeper than 3:1) |
| Truck court slope away from building | 1.5% | apron 1.0–2.0%, maneuvering ≤ 3.0% |
| Parking field slope | 1.0–4.0% | max 4% per § 27-1410; min 1.0% for asphalt drainage |
| ADA stalls + access aisles | ≤ 2.0% design target | code max 1:48 = 2.08% (2010 ADA Standards § 502.4); design to ≤ 1.5% where possible for construction tolerance |
| Truck drive grade | ≤ 6% | ≤ 4% within 50 ft of the ROW (landing); verify vs SALDO |
| Car drive grade | ≤ 8% | ≤ 4% within 50 ft of the ROW (landing); verify vs SALDO |
| Drive cross slope | 2% | |
| Min grass slope | 2% | |
| Pavement/slab section (finished grade → subgrade) | building slab 1.17 ft (8 in concrete + 6 in stone); concrete dock apron 1.33 ft; heavy-duty asphalt (truck) 1.50 ft; standard-duty asphalt (car) 1.00 ft; sidewalk 0.67 ft | used for earthwork to subgrade |
| Topsoil strip | 0.5 ft over disturbed area | reported separately; assume reused on site (no import/export) unless told otherwise |
| Cut shrink factor | 10% | `net = cut × (1 − shrink) − fill` |
| Grid cell | 5 ft interactive / 2 ft report | |
| Offsite grading tolerance | 0.1 ft | |

## ADA (2010 ADA Standards for Accessible Design)
**Table 208.2, minimum accessible spaces by total spaces in the lot:**

| Total | Min accessible |
|---|---|
| 1–25 | 1 |
| 26–50 | 2 |
| 51–75 | 3 |
| 76–100 | 4 |
| 101–150 | 5 |
| 151–200 | 6 |
| 201–300 | 7 |
| 301–400 | 8 |
| 401–500 | 9 |
| 501–1000 | 2% of total (fractions round up) |
| 1001+ | 20 + 1 per each 100 (or fraction) over 1000 |

- § 208.2.4: **van spaces** = 1 per 6 accessible spaces (or fraction), i.e., `ceil(accessible / 6)`.
- § 502.2: car space ≥ 96 in wide; van space ≥ 132 in wide (or 96 in with a 96 in aisle). Access aisle ≥ 60 in wide, full length of the space; two spaces may share an aisle.
- § 502.4: slopes in spaces and access aisles ≤ 1:48 in all directions.
- § 208.3.1: accessible spaces on the shortest accessible route to an accessible entrance.
- Stretch (accessible route tool): running slope ≤ 1:20 (5%); ramps ≤ 1:12 (8.33%) with ≤ 30 in rise per run and 60 in landings; cross slope ≤ 1:48.

Apply Table 208.2 **per parking facility** (each separate lot). Since the 2010 Standards say so, show the count per field and in total.

## Hand-calc unit tests (must pass)

**Important implementation gotcha (verified numerically):** daylight distance must be measured from each cell center to the object's **boundary** (geometric distance, or EDT minus half a cell). A naive Euclidean distance transform between cell centers (inside cell → outside cell) underestimates the tie-in slope volume by ~1.9% at 1 ft cells and ~8% at 5 ft cells (test T3).

| # | Test | Setup | Expected | Tolerance |
|---|---|---|---|---|
| T1 | Flat pad fill | Existing flat at 100.00; 100 × 100 ft pad at 102.00; volume inside the pad only; no sections, no shrink | Fill 20,000 CF = **740.74 CY**; cut 0 | ±0.5% at 1, 2 and 5 ft grids |
| T2 | Pad on a tilted plane | Existing z = 100 + 0.02·x; pad x ∈ [0, 200], y ∈ [0, 100] at 102.00; pad only | Fill 10,000 CF (**370.37 CY**), cut 10,000 CF, net 0 | ±0.5% |
| T3 | Pad + 3:1 daylight on flat ground | Existing flat at 100.00; 100 × 100 ft pad at 102.00; 3:1 tie-in, no other objects | Pad 20,000 + side wedges 2·a·b·h = 2,400 + corner quarter-cones π·b²·h/3 = 75.40 (b = 3h = 6 ft) → **22,475.40 CF = 832.42 CY** | ±0.5% at 1 ft; ±1% at 5 ft |
| T4 | Retaining wall detection | Existing flat at 100; pad A at 100.00 for x ∈ [0, 100]; pad B at 120.00 for x ∈ [150, 250] (50 ft gap), both 100 ft wide in y; 3:1 | Wall flagged between the pads. Exposed height at pad A's edge = 120 − 50/3 − 100 = **3.33 ft** | ±0.3 ft at 1 ft grid |
| T5 | FFE balance with shrink | Existing z = 100 + 0.02·x; pad x ∈ [300, 700], y ∈ [0, 300]; pad only, no daylight, shrink 10%, no sections | **FFE = 109.89** (closed form 110 + 4(√0.9 − 1)/(√0.9 + 1)); at balance fill ≈ 4,213 CY, cut ≈ 4,682 CY | FFE ±0.02 ft |
| T6 | FFE balance without shrink | Same as T5, shrink 0 | **FFE = 110.00** | ±0.02 ft |
| T7 | ADA count | totals → accessible (van) | 10→1(1); 25→1(1); 26→2(1); 300→7(2); 301→8(2); 500→9(2); 501→11(2); 600→12(2); 1,000→20(4); 1,001→21(4); 1,200→22(4) | exact |
| T8 | Loading berths § 27-1408 | GFA 411,840 SF | **13** with conservative rounding (12 if rounded down; expose both via the interpretation flag) | exact |
| T9 | Parking module count | One 300 ft long double-loaded module, 10 × 20 ft stalls, 24 ft aisle, no islands | 30 stalls per side = **60**; module depth 64 ft | exact |
| T10 | ADA slope check | Planar parking field at 2.5% containing ADA stalls; then at 1.5% | 2.5% → fail (> 2.08%); 1.5% → pass | exact |
| T11 | Driveway spacing § 27-1407 | Driveway centerline 120 ft from the intersecting street's ROW line; then 160 ft | 120 → fail; 160 → pass | exact |
| T12 | Envelope offsets | 1,000 × 800 ft rectangle; front edge on ROW; rear edge abutting residential district; two sides plain | Building envelope = 1,000 − 2·20 = 960 ft wide × 800 − 100 − 150 = 550 ft deep; parking envelope = 980 wide (10 ft sides) × 800 − 25 − 100 = 675 ft deep | ±0.01 ft |
| T13 | Unit conversion | 3DEP value 150.000 m | 492.125 ftUS (150 × 3.280833…) | ±0.001 ft |

In T12, the rear edge abuts residential, so the building setback there is max(30 ft rear yard, 150 ft residential separation) = 150 ft and the parking setback there is 100 ft. Front: building 100 ft (not across the street from residential in this test), parking 25 ft.
