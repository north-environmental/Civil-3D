# PROGRESS

_Update after every meaningful step. Newest status at the top._

## Summary for the owner (read this first)

**Update 2026-11-15: real site data, a chat panel and a working PNG export.** `npm run verify` is green
(typecheck, lint, 94 unit tests, build, 18 browser tests, 5 MCP tests, 16 screenshots).

What changed in this pass, in response to your feedback:

1. **The lot is now the real 1625 Heilmandale Rd.** The network was open this time, so the fixture was rebuilt from
   public GIS services and cached in the repo (the app still runs offline):
   - Lebanon County tax parcel, 110.35 ac (the tract before development), matched by address
   - an aerial photo from 2018–2020 (farm fields) and the latest aerial (the facility as built), both exported in the
     site's coordinate system so they line up with the boundary and the roads
   - USGS 3DEP LiDAR terrain (507–575 ft on the lot), NWI wetlands (4.8 ac on the south side, matching the minutes)
   - county road centerlines and neighbouring lot lines
   - zoning districts digitized from the township's 2023 zoning map (Rural Residential to the north and west,
     Agricultural south and northeast, General Commercial across Route 72)
   - Click the green badge on the plan for the source of every layer.
2. **Chat panel** (first tab on the right). Type what you want to build; the plan redraws and the reply reports
   the result and any failing checks. It uses Claude through Claude Code on your computer when that is installed
   (no API key), and a simple built-in parser otherwise. Setup: `docs/CHAT.md`.
3. **PNG export.** Export ▾ → **Plan image PNG** is now drawn in the browser and lands in your Downloads folder,
   with the aerial. (The old export needed a server-side Chromium that was not installed on your laptop, and failed
   without telling you; it is still there as "Plan sheet PNG" and now says what it needs.)
4. **Plan view defaults**: aerial on, LiDAR contours off (toggle in Layers), neighbouring lots and zoning districts
   drawn over the photo.

Things the real data exposed, which you should know:

- **The lot is deeded to the Heilmandale Rd centerline.** Front yards are therefore measured from the right-of-way
  line, which I assumed 30 ft inside the lot line (60 ft state road, SR 4006). Confirm the right-of-way width.
- **A truck driveway on Route 72 does not work**: the lot touches Route 72 for only 147 ft, next to the Orange Ln
  intersection, so the 150 ft spacing in § 27-1407 cannot be met. The headline scenario now brings trucks in from
  Heilmandale Rd only. The tool reports the failure if you ask for Route 72 anyway.
- **Headline result on the real lot:** 410,400 SF cross-dock parallel to Heilmandale Rd, 110 doors, 126 trailer
  stalls, 357 car stalls, trucks from Heilmandale Rd, cars from Orange Ln, no failing checks. Grading still runs
  (balanced at FFE 551.6 ft, about 200,000 CY cut), but I did not review grading in this pass, as you asked.

Not done or not verified:

- **Floodplain did not load** (the FEMA service timed out). There is no floodplain constraint on the plan.
- **Claude in the chat was tested on Linux only.** On Windows the `claude` command starts differently and is untested.
- **`docs/DEMO.md` step-by-step numbers are still the old synthetic ones**; a note at the top says so. Current
  numbers are in `docs/demo-summary.md`.
- **Only this site can be loaded.** Typing another address will not fetch it.
- Still open from before: the DXF has not been opened in AutoCAD / Civil 3D; WB-67 dimensions and TR-55 inputs are
  unverified; the zoning rules are extracts, not the official eCode360 text.

Everything else that is approximate or missing is in `docs/LIMITATIONS.md`. Choices made on your behalf are in
`DECISIONS.md`.

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

Open <http://localhost:4310> and click **Load demo site**. Then type in the **Chat** tab on the right, for example
"Fit a 410,000 SF cross-dock parallel to Heilmandale Rd with 350 parking spaces, trucks from Heilmandale Rd and cars
only from Orange Ln", or click **▶ Demo** for a replay of the headline scenario. To have Claude answer the chat
instead of the built-in parser, follow `docs/CHAT.md` (install Claude Code, sign in, restart Groundwork).

`npx playwright install chromium` and `npm run build` are optional for day-to-day use: `npm run dev` alone runs the
app, the chat and the Plan image PNG export.

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
  - [x] Screenshot of the app shell looks like a real product (`docs/screens/00-shell-empty.jpg`)
- [x] Phase 1: Site data + plan view
  - [x] Parcel area within ±5% of ~110 ac (synthetic parcel 109.6 ac; flagged SYNTHETIC)
  - [x] DEM pre-development: synthetic terrain, persistent "SYNTHETIC SITE DATA · SYNTHETIC TERRAIN" badge
  - [x] Screenshot (`01-site-plan.jpg`, `01-site-plan-asbuilt.jpg`)
- [x] Phase 2: Zoning engine
  - [x] Unit tests: envelopes on rectangular (T12), L-shaped and corner-lot parcels; residential 150 ft building / 100 ft parking setbacks only on the right edges
  - [x] Rule schema, pre-loaded confirmed I-1 rule set with citations + interpretation flags; propose/confirm flow; ordinance text cache + `get_ordinance_text`
  - [x] Screenshot with envelopes and a citation tooltip (`02-zoning-envelopes.jpg`)
- [x] Phase 3: Layout engine (test fit)
  - [x] Headline scenario (steps 1–6): all hard checks pass (38 pass / 1 advisory warn / 0 fail). Scenario B (rotated 90°) fails § 27-1304.1.B.3.b with the reason and options stated
  - [x] Truck/car networks verified disconnected (overlap 0 SF, unit test + check `e.network.separation`)
  - [x] Solver < 10 s (0.35 s with a fixed orientation; 4.3 s for the full 0–175° search, 147k candidates)
  - [x] Screenshots of plan + yield (`03-layout-plan-checks.jpg`, `03-layout-yield.jpg`); `npm run demo` writes `docs/demo-summary.md` + `demo-headline-*.png`
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
  - [x] Screenshots: `05-grading-contours-earthwork.jpg`, `05-grading-cutfill.jpg`, `05-grading-section.jpg`, `05-grading-3d.jpg`
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
- [x] WB-67 swept path at truck entrances: kinematic check per truck drive + plan layer (`07-swept-path.jpg`). Vehicle dimensions unverified (from memory); turns inside the court not modeled
- [x] Runoff-based basin sizing: `stormwater.method = "tr55"` (NRCS curve-number runoff increase). Storm depth is a placeholder to be replaced; rational method not built
- [x] Accessible-route check (`check_accessible_route`): slopes, ramp classification, 30 in rise. Partial: no "fix", no drawing tool in the UI
- [x] Second jurisdiction through the ordinance-ingestion flow: proven by a unit test with a fictional rule set (no second real ordinance ingested)
- [ ] Multi-building layouts: not built. The layout, checks and grading engines assume one building per scenario; doing this properly is a refactor of `layout/generate.ts`, the solver and `grading/objects.ts`, and I chose not to risk a green build for it. Recommended as the next piece of work
- [ ] Residential subdivision mode: not built. The reference data has no residential district rules (lot sizes, yards, street standards), and inventing them is off limits; it needs those inputs first

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
| 00-shell-empty.jpg | 2026-11-13 | None blocking. Shell reads as a product: top bar, layers, tabs, status bar, command line, empty state. | n/a |
| 01-site-plan-asbuilt.jpg | 2026-11-13 | Minor (1 ft) contours too faint to read at site zoom. Labels do not overlap; roads, districts, wetland, as-built reference, scale bar, north arrow, coordinates and elevation all read correctly. | Yes: raised minor-contour contrast |
| 07-swept-path.jpg | 2026-11-14 | None: the 8.5 ft envelope tracks inside the 32 ft truck drive and extends into the street approach; layer toggle and check entry present. | n/a |
| 03-chat-test-fit, 01-site-plan-asbuilt, 02-zoning-envelopes, 06-export-plan-sheet, 05-grading-3d, 06-light-theme-asbuilt-activity, 00-shell-empty | 2026-11-15 | Real aerial registers with the boundary, roads and neighbouring lots in both vintages; labels have halos and do not overlap; the tooltip explains the right-of-way line; the chat transcript and engine badge read clearly. Fixed during review: purple tint of the site district over the lot, off-lot steep-slope labels, monospace step labels in the chat. Left as is: outside the cached aerial (lot + 800 ft) the background is blank; the basin sits over the woodlot. | yes |
| 06-export-plan-sheet.jpg, 06-light-theme-asbuilt-activity.jpg, 06-compare.jpg, 06-scenario-b-checks.jpg | 2026-11-13 | Basin label unreadable on the light sheet (pale blue text with a light halo); SYNTHETIC badge washed out and the white parcel swatch invisible in the light theme. Sheet title block, yield, compliance and earthwork tables read correctly. | Yes: theme-aware basin label color; light-theme badge and swatch styles |
| 05-grading-cutfill.jpg, 05-grading-section.jpg, 05-grading-3d.jpg, 05-grading-contours-earthwork.jpg | 2026-11-13 | 3D camera cropped the site and the wetland was missing in 3D; section caption clipped at the panel bottom; tab focus ring looked like a selection. Cut/fill legend, proposed contours, FFE label, section profile (pad at FFE, courts 4 ft below, 3:1 tie-ins) all read correctly. Earthwork sanity: first pass had the 10 ac basin 7 ft deep = 195k CY of cut dominating everything (not credible) and the solver parked the building where a 145 ft truck drive forced the floor 7 ft above grade (76k CY import). | Yes: wider 3D framing + wetland color; chart height; focus style; basin depth 3 ft for the area-based method with berm at median ground; solver now scores drive-profile feasibility |
| 03-layout-plan-checks.jpg, 03-layout-yield.jpg, demo-headline-asbuilt.png | 2026-11-13 | Building label was unreadable (dark halo on a light fill); a basin corner crossed the lot line (raster cell overhang); solver pinned the building against the Route 72 setback leaving a 60 ft truck throat; yield label column wrapped. | Yes: light halo on the building label; basin free area eroded 15 ft; 300 ft preferred truck approach in the solver score; wider label column |
| 02-zoning-envelopes.jpg | 2026-11-13 | Envelope label landed on the wetland hole instead of the envelope body. Tooltip shows rule + § 27-1003; Zoning tab lists rules, citations and flags. | Yes: label now uses the largest ring by area |

## Known issues
- Live data fetch script (`npm run fetch-site-data`) cannot be exercised in this sandbox (all hosts denied); it is untested against the live services.
- Imagery layer code path is untested (no cached tiles in the synthetic fixture).

## Blocked
(nothing)
