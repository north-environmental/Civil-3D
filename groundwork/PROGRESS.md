# PROGRESS

_Update after every meaningful step. Newest status at the top._

## Current phase
Phase 7: Docs and hardening (in progress)

## Last verify result
2026-11-13 — `npm run verify` green (typecheck, lint, 57 unit tests, build, 13 e2e tests, 5 MCP tests, 14 screenshots).

## Done
- [x] Phase 0: Foundations
  - [x] verify passes
  - [x] Screenshot of the app shell looks like a real product (`docs/screens/00-shell-empty.png`)
- [x] Phase 1: Site data + plan view
  - [x] Parcel area within ±5% of ~110 ac (synthetic parcel 109.6 ac; flagged SYNTHETIC)
  - [x] DEM pre-development: synthetic terrain, persistent "SYNTHETIC SITE DATA · SYNTHETIC TERRAIN" badge
  - [x] Screenshot (`01-site-plan.png`, `01-site-plan-asbuilt.png`)
- [x] Phase 2: Zoning engine
  - [x] Unit tests: envelopes on rectangular (T12), L-shaped and corner-lot parcels; residential 150 ft building / 100 ft parking setbacks only on the right edges
  - [x] Rule schema, pre-loaded confirmed I-1 rule set with citations + interpretation flags; propose/confirm flow; ordinance text cache + `get_ordinance_text`
  - [x] Screenshot with envelopes and a citation tooltip (`02-zoning-envelopes.png`)
- [x] Phase 3: Layout engine (test fit)
  - [x] Headline scenario (steps 1–6): all hard checks pass (38 pass / 1 advisory warn / 0 fail). Scenario B (rotated 90°) fails § 27-1304.1.B.3.b with the reason and options stated
  - [x] Truck/car networks verified disconnected (overlap 0 SF, unit test + check `e.network.separation`)
  - [x] Solver < 10 s (0.35 s with a fixed orientation; 4.3 s for the full 0–175° search, 147k candidates)
  - [x] Screenshots of plan + yield (`03-layout-plan-checks.png`, `03-layout-yield.png`); `npm run demo` writes `docs/demo-summary.md` + `demo-headline-*.png`
  - [x] Direct manipulation: drag / rotate / resize the building, slide driveways; engine re-solves on release (e2e drag test)
- [x] Phase 4: MCP server
  - [x] `npm run test:mcp` spawns the built MCP server with the official client SDK, lists tools, runs the headline scenario through MCP and gets a 1600 × 1000 PNG back from `render_view`
  - [x] Tool descriptions reviewed as a context-free reader; added parcel bbox/centroid and object centers to context results so coordinate-taking tools are usable
  - [x] Design log ("Activity" tab), `groundwork_designer` prompt, server instructions, `docs/MCP_SETUP.md`
  - [x] Grading tools (`set_grading_criteria`, `grade_site`, `optimize_ffe`, `get_earthwork_report`, `cut_section`) wired in Phase 5; `export` lands in Phase 6
- [x] Phase 5: Grading + earthwork
  - [x] Hand-calc tests written FIRST (`grading/handcalc.test.ts` failed with "Cannot find module ./engine"), then the engine. All pass within the stated tolerances: T1, T2 (±0.5% at 1/2/5 ft), T3 (±0.5% at 1 ft, ±1% at 5 ft), T4 (3.33 ft ±0.3), T5 (FFE 109.89 ±0.02), T6 (110.00 ±0.02), T10, T13; T7/T9/T11 in `layout.test.ts`, T8 in `zoning.test.ts`, T12 in `envelopes.test.ts`
  - [x] Optimizer balances the demo site: scenario A FFE 497.4 ft, cut 148,155 CY, fill 132,537 CY, net +802 CY = 0.3% of movement (≤ 2%); feasible range 488.5–514.1 ft from the Route 72 truck drive
  - [x] Interactive regrade after a building move: ~0.4 s server-side (layout + grading), worker regrade < 1.5 s (e2e asserted) at the 5 ft grid
  - [x] Screenshots: `05-grading-contours-earthwork.png`, `05-grading-cutfill.png`, `05-grading-section.png`, `05-grading-3d.png`
- [x] Phase 6: Checks, exports, scenarios, polish
  - [x] DXF (AC1024, AIA layers) parses back with `dxf-parser` in unit and e2e tests
  - [x] XLSX opens with exceljs and has 4 sheets (Yield, Compliance, Earthwork, Assumptions)
  - [x] GeoJSON (WGS84) and a 2700 × 1800 (36 : 24) PNG plan sheet with title block
  - [x] Full e2e Playwright run of the demo (the Demo button replays all 20 headline steps in the browser)
  - [x] Engineering checks: ADA counts + slopes, parking / truck-court slopes, drive grades, driveway spacing + widths, walls, offsite grading, tie-in slopes, network separation, height; scenario compare dialog; keyboard help; light theme
- [ ] Phase 7: Docs and hardening

## Next 3 steps
1. README.md, docs/DEMO.md, docs/ARCHITECTURE.md, docs/LIMITATIONS.md
2. Fresh-clone test: `npm ci && npm run build && npm run verify` from a clean checkout
3. Stretch list (runoff-driven basin sizing, WB-67 swept path, …)

## Data source log
Build environment: cloud sandbox with restricted egress. Every data host below was tried **once** on 2026-11-13 and
was refused by the environment's network policy (HTTP 403 on CONNECT at the egress proxy). Nothing was retried.
The committed fixture is therefore the **synthetic fallback** (SPEC §6.3 / site-heilmandale.md), labelled SYNTHETIC in the UI.
Run `npm run fetch-site-data` on a machine with internet access to replace it with real data.

| Layer | Source tried | Result | Fixture file |
|---|---|---|---|
| Geocode | geocoding.geo.census.gov, nominatim.openstreetmap.org | 403 policy denial | synthetic (site.json) |
| Parcels | imagery.pasda.psu.edu, services.pasda.psu.edu, lebcogis.maps.arcgis.com | 403 policy denial | synthetic (site.json) |
| Roads / as-built | overpass-api.de | 403 policy denial | synthetic (site.json) |
| Terrain | elevation.nationalmap.gov | 403 policy denial | synthetic (dem.f32) |
| Imagery | basemap.nationalmap.gov | 403 policy denial | none (plain background) |
| Wetlands | fwspublicservices.wim.usgs.gov | 403 policy denial | synthetic (site.json) |
| Floodplain | hazards.fema.gov | 403 policy denial | none |
| Zoning map / SALDO / SWM | northlebanontwppa.gov | 403 policy denial | synthetic districts per the 2020 minutes |
| Ordinance text | ecode360.com, www.zoneomics.com | 403 policy denial | ordinance.json from docs/reference extracts |

## Screenshots reviewed
| File | Date | Issues found | Fixed? |
|---|---|---|---|
| 00-shell-empty.png | 2026-11-13 | None blocking. Shell reads as a product: top bar, layers, tabs, status bar, command line, empty state. | n/a |
| 01-site-plan-asbuilt.png | 2026-11-13 | Minor (1 ft) contours too faint to read at site zoom. Labels do not overlap; roads, districts, wetland, as-built reference, scale bar, north arrow, coordinates and elevation all read correctly. | Yes: raised minor-contour contrast |
| 06-export-plan-sheet.png, 06-light-theme-asbuilt-activity.png, 06-compare.png, 06-scenario-b-checks.png | 2026-11-13 | Basin label unreadable on the light sheet (pale blue text with a light halo); SYNTHETIC badge washed out and the white parcel swatch invisible in the light theme. Sheet title block, yield, compliance and earthwork tables read correctly. | Yes: theme-aware basin label color; light-theme badge and swatch styles |
| 05-grading-cutfill.png, 05-grading-section.png, 05-grading-3d.png, 05-grading-contours-earthwork.png | 2026-11-13 | 3D camera cropped the site and the wetland was missing in 3D; section caption clipped at the panel bottom; tab focus ring looked like a selection. Cut/fill legend, proposed contours, FFE label, section profile (pad at FFE, courts 4 ft below, 3:1 tie-ins) all read correctly. Earthwork sanity: first pass had the 10 ac basin 7 ft deep = 195k CY of cut dominating everything (not credible) and the solver parked the building where a 145 ft truck drive forced the floor 7 ft above grade (76k CY import). | Yes: wider 3D framing + wetland color; chart height; focus style; basin depth 3 ft for the area-based method with berm at median ground; solver now scores drive-profile feasibility |
| 03-layout-plan-checks.png, 03-layout-yield.png, demo-headline-asbuilt.png | 2026-11-13 | Building label was unreadable (dark halo on a light fill); a basin corner crossed the lot line (raster cell overhang); solver pinned the building against the Route 72 setback leaving a 60 ft truck throat; yield label column wrapped. | Yes: light halo on the building label; basin free area eroded 15 ft; 300 ft preferred truck approach in the solver score; wider label column |
| 02-zoning-envelopes.png | 2026-11-13 | Envelope label landed on the wetland hole instead of the envelope body. Tooltip shows rule + § 27-1003; Zoning tab lists rules, citations and flags. | Yes: label now uses the largest ring by area |

## Known issues
- Live data fetch script (`npm run fetch-site-data`) cannot be exercised in this sandbox (all hosts denied); it is untested against the live services.
- Imagery layer code path is untested (no cached tiles in the synthetic fixture).

## Blocked
(nothing)
