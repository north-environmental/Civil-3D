# PROGRESS

_Update after every meaningful step. Newest status at the top._

## Current phase
Phase 1: Site data + plan view (in progress)

## Last verify result
2026-11-13 — `npm run verify` green (typecheck, lint, 6 unit tests, build, 3 e2e smoke tests, screenshots).

## Done
- [x] Phase 0: Foundations
  - [x] verify passes
  - [x] Screenshot of the app shell looks like a real product (`docs/screens/00-shell-empty.png`)
- [ ] Phase 1: Site data + plan view
- [ ] Phase 2: Zoning engine
- [ ] Phase 3: Layout engine (test fit)
- [ ] Phase 4: MCP server
- [ ] Phase 5: Grading + earthwork
- [ ] Phase 6: Checks, exports, scenarios, polish
- [ ] Phase 7: Docs and hardening

## Next 3 steps
1. Synthetic fixture generator + `scripts/fetch-site-data.ts` (live sources, untested here) + `load_site` / `get_site_context`
2. Plan view: parcel, roads, districts, constraints, contours, as-built; status bar elevation
3. Phase 2: envelopes + zoning checks

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

## Known issues
- Live data fetch script cannot be exercised in this sandbox (all hosts denied).

## Blocked
(nothing)
