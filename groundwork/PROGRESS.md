# PROGRESS

_Update after every meaningful step. Newest status at the top._

## Current phase
Phase 3: Layout engine (in progress)

## Last verify result
2026-11-13 — `npm run verify` green (typecheck, lint, 22 unit tests, build, 5 e2e tests, 4 screenshots).

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
- [ ] Phase 3: Layout engine (test fit)
- [ ] Phase 4: MCP server
- [ ] Phase 5: Grading + earthwork
- [ ] Phase 6: Checks, exports, scenarios, polish
- [ ] Phase 7: Docs and hardening

## Next 3 steps
1. Layout generators: driveways, routed truck/car drives, basin, landscape; yield table
2. Auto-solver + layout commands + direct manipulation in the plan view
3. `scripts/demo-scenario.ts` headline scenario through commands

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
| 02-zoning-envelopes.png | 2026-11-13 | Envelope label landed on the wetland hole instead of the envelope body. Tooltip shows rule + § 27-1003; Zoning tab lists rules, citations and flags. | Yes: label now uses the largest ring by area |

## Known issues
- Live data fetch script (`npm run fetch-site-data`) cannot be exercised in this sandbox (all hosts denied); it is untested against the live services.
- Imagery layer code path is untested (no cached tiles in the synthetic fixture).

## Blocked
(nothing)
