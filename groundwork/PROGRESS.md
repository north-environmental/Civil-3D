# PROGRESS

_Update after every meaningful step. Newest status at the top._

## Summary for the owner (read this first)

**Status: Phases 0–7 are complete and green.** `npm run verify` passes from a fresh clone (typecheck, lint, 57 unit
tests incl. hand calcs T1–T13, build, 13 browser e2e tests, 5 MCP tests, 15 QA screenshots). Four stretch items were
added after that (see "Stretch" below); verify is green with them: 66 unit tests.

What you have: a working web app (2D plan, 3D view, checks / yield / earthwork / program / zoning / activity panels,
section tool, exports), a command layer with 33 commands, and an MCP server that exposes all of them to Claude Desktop
/ Claude Code. The headline scenario runs end to end through MCP: 410,400 SF cross-dock parallel to Heilmandale Rd,
110 doors, 126 trailer stalls, 357 car stalls, trucks from Route 72 + Heilmandale Rd, cars only from Orange Ln, networks
separate, all hard checks pass, balanced at FFE 497.4 ft (148k CY cut / 133k CY fill, net +802 CY), no walls, no offsite
grading. Scenario B (rotated 90°) balances but fails § 27-1304.1.B.3.b, and the tool says why.

**Three things to know before you demo it:**

1. **The site data is synthetic.** This build ran in a cloud sandbox whose network policy blocked every data host
   (PASDA, USGS, OSM, FEMA, USFWS, eCode360, township site; all 403). I did not route around it. Per the spec's fallback
   chain the fixture is a generated ~110 ac parcel / roads / districts / wetland / terrain, labelled SYNTHETIC in the UI
   and on every export. The zoning values and section numbers are the real extracts from your reference doc.
2. **`npm run fetch-site-data` is untested against the live services.** Run it on your laptop; expect to fix small
   things (field names, layer ids) the first time. It leaves the fixture alone if the parcel or DEM fetch fails.
3. **The DXF was validated by parsing it back, not by opening it in AutoCAD / Civil 3D.** Please open one.

Everything else that is approximate or missing is in `docs/LIMITATIONS.md`. Choices I made on your behalf are in
`DECISIONS.md` (the ones most worth a second look: the 3 ft basin depth for the 9%-of-site reservation, the solver
weights, and scenario B being a deliberately failing rotation).

### Run the demo on your laptop

From the `groundwork` folder (Node 20+):

```bash
npm ci
```

```bash
npx playwright install chromium
```

```bash
npm run build
```

```bash
npm run dev
```

Open <http://localhost:4310>, click **Load demo site**, then **▶ Demo** for a 40-second replay of the headline scenario.

### Connect Claude Desktop

1. In the `groundwork` folder run `pwd` and copy the path (call it `<ABS>`).
2. Claude Desktop → Settings → Developer → Edit Config, and add:

```json
{
  "mcpServers": {
    "groundwork": {
      "command": "node",
      "args": ["<ABS>/packages/mcp/dist/index.js"]
    }
  }
}
```

3. Quit and reopen Claude Desktop; "groundwork" should list 33 tools. Keep `npm run dev` running.
4. Type: *"Load 1625 Heilmandale Rd in Groundwork and summarize the site."* Then follow `docs/DEMO.md`.

Claude Code instead: `claude mcp add groundwork -- node <ABS>/packages/mcp/dist/index.js`. Details and troubleshooting:
`docs/MCP_SETUP.md`.

### To get real site data

```bash
npm run fetch-site-data
```

Then restart the app and load the site again. Check `data/sites/heilmandale/provenance.json` and the terrain note
(the script warns if the DEM post-dates construction).

## Current phase
Stretch list (after Phase 7)

## Last verify result
2026-11-14 — `npm run verify` green on the working tree AND on a fresh clone (`npm ci && npm run build && npm run verify`):
typecheck, lint, 57 unit tests, build, 13 e2e tests, 5 MCP tests, 14 screenshots (at the Phase 7 commit). After the stretch items the working tree verifies green with 66 unit tests and 15 screenshots. `npm run dev` checked separately
(Vite middleware mode serves the app, HMR on, commands run, MCP server connects).

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
- [x] Phase 7: Docs and hardening
  - [x] `README.md` (what it is, 5-minute quickstart), `docs/DEMO.md` (scripted client demo with exact prompts and expected results), `docs/ARCHITECTURE.md`, `docs/LIMITATIONS.md`, `docs/MCP_SETUP.md`
  - [x] Fresh-clone test: `git clone` → `npm ci && npm run build && npm run verify` passes

## Stretch (after Phase 7)
- [x] WB-67 swept path at truck entrances: kinematic check per truck drive + plan layer (`07-swept-path.png`). Vehicle dimensions unverified (from memory); turns inside the court not modeled
- [x] Runoff-based basin sizing: `stormwater.method = "tr55"` (NRCS curve-number runoff increase). Storm depth is a placeholder to be replaced; rational method not built
- [x] Accessible-route check (`check_accessible_route`): slopes, ramp classification, 30 in rise. Partial: no "fix", no drawing tool in the UI
- [x] Second jurisdiction through the ordinance-ingestion flow: proven by a unit test with a fictional rule set (no second real ordinance ingested)
- [ ] Multi-building layouts (not built)
- [ ] Residential subdivision mode (not built)

## Next 3 steps
1. Owner: run `npm run fetch-site-data` on a networked machine and review `provenance.json`
2. Owner: open an exported DXF in Civil 3D / AutoCAD; verify the WB-67 dimensions and TR-55 curve numbers against the sources
3. Reconcile the I-1 rule set with the official eCode360 text (and Ord. 2-2023); resolve the "lot coverage" definition

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
| 07-swept-path.png | 2026-11-14 | None: the 8.5 ft envelope tracks inside the 32 ft truck drive and extends into the street approach; layer toggle and check entry present. | n/a |
| 06-export-plan-sheet.png, 06-light-theme-asbuilt-activity.png, 06-compare.png, 06-scenario-b-checks.png | 2026-11-13 | Basin label unreadable on the light sheet (pale blue text with a light halo); SYNTHETIC badge washed out and the white parcel swatch invisible in the light theme. Sheet title block, yield, compliance and earthwork tables read correctly. | Yes: theme-aware basin label color; light-theme badge and swatch styles |
| 05-grading-cutfill.png, 05-grading-section.png, 05-grading-3d.png, 05-grading-contours-earthwork.png | 2026-11-13 | 3D camera cropped the site and the wetland was missing in 3D; section caption clipped at the panel bottom; tab focus ring looked like a selection. Cut/fill legend, proposed contours, FFE label, section profile (pad at FFE, courts 4 ft below, 3:1 tie-ins) all read correctly. Earthwork sanity: first pass had the 10 ac basin 7 ft deep = 195k CY of cut dominating everything (not credible) and the solver parked the building where a 145 ft truck drive forced the floor 7 ft above grade (76k CY import). | Yes: wider 3D framing + wetland color; chart height; focus style; basin depth 3 ft for the area-based method with berm at median ground; solver now scores drive-profile feasibility |
| 03-layout-plan-checks.png, 03-layout-yield.png, demo-headline-asbuilt.png | 2026-11-13 | Building label was unreadable (dark halo on a light fill); a basin corner crossed the lot line (raster cell overhang); solver pinned the building against the Route 72 setback leaving a 60 ft truck throat; yield label column wrapped. | Yes: light halo on the building label; basin free area eroded 15 ft; 300 ft preferred truck approach in the solver score; wider label column |
| 02-zoning-envelopes.png | 2026-11-13 | Envelope label landed on the wetland hole instead of the envelope body. Tooltip shows rule + § 27-1003; Zoning tab lists rules, citations and flags. | Yes: label now uses the largest ring by area |

## Known issues
- Live data fetch script (`npm run fetch-site-data`) cannot be exercised in this sandbox (all hosts denied); it is untested against the live services.
- Imagery layer code path is untested (no cached tiles in the synthetic fixture).

## Blocked
(nothing)
