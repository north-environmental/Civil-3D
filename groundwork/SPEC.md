# Groundwork: AI-driven site test fit and grading (build spec)

> Working name. Rename freely. Internal EFCG demo, not a commercial product.

## 1. What we are building

A browser-based, Civil 3D-flavored site design tool for **industrial/warehouse land development**. It works in one loop:

1. **Load a site.** Pull the parcel boundary, adjacent roads, existing terrain (LiDAR DEM), aerial imagery, constraint layers and the parcel's zoning district.
2. **Apply zoning.** Read the local zoning ordinance and turn it into a structured, cited rule set (setbacks, coverage, height, parking/loading ratios, landscaping, driveway spacing). Draw the resulting envelopes on the plan.
3. **Test fit.** Generate a building + truck courts + trailer parking + car parking + circulation + stormwater reservation that satisfies the rules, with a live yield table and a compliance table.
4. **Grade.** Build a concept-level proposed surface (pad, dock-height truck courts, parking planes, drives, basin, 3:1 tie-in slopes), compute cut/fill, flag retaining walls and offsite grading, and optimize the finished floor elevation (FFE) to balance earthwork.
5. **Converse.** Every action above is a **tool** exposed over **MCP**, so a user can sit in Claude Desktop or Claude Code beside the app and say:

> "Fit a 410,000 SF cross-dock with the long side parallel to Heilmandale Rd. Trucks come in from Route 72 and Heilmandale Rd, employee cars only from Orange Lane, and don't connect truck and car circulation. Then grade it and balance the earthwork."

Claude (in the chat) decides and explains; the **deterministic engine** in this app does the geometry and the math. The app never asks an LLM to draw coordinates freehand.

**Audience:** AEC firm executives and EFCG's Technology & Innovation team. The demo has to look credible to a civil engineer: correct units, real ordinance citations, sensible industrial design defaults, numbers that match hand calcs.

**Not in scope:** construction documents, pipe networks, structural design, detailed stormwater routing, permitting. The UI must say "Concept-level, not for construction" somewhere visible.

## 2. Demo site (build everything against this first)

**1625 Heilmandale Rd, North Lebanon Township, Lebanon County, PA.** It's the ~110-acre former Hershey Bare tract, now a ~411,840 SF Walmart distribution center designed by Kimley-Horn (2020–2021). Facts and data sources are in `docs/reference/site-heilmandale.md`. Zoning numbers with citations are in `docs/reference/zoning-north-lebanon-I1.md`.

Because the site is already built, the demo has a built-in comparison: **Claude's test fit vs. the as-built layout** (as-built footprint from OpenStreetMap or aerial imagery, shown as a toggleable reference layer). The **existing terrain must be pre-development** (see §6.3).

The architecture must still be **jurisdiction-agnostic**: site data and zoning come through adapters and a rule schema, so a second site/township can be added later without touching the engines.

## 3. Architecture

```
groundwork/
  packages/
    core/        # Pure TypeScript. No DOM, no network. All engineering logic. 100% unit-testable.
      geometry/  #   polygons, offsets, booleans, distance transforms, CRS helpers
      site/      #   site model types (zod schemas), units
      zoning/    #   rule schema, rule evaluation, envelope builder, compliance checks
      layout/    #   building, truck court, parking, circulation, basin generators + auto-solver
      grading/   #   surfaces, grading objects, daylighting, earthwork, FFE optimizer, contours, sections
      checks/    #   engineering checks (ADA counts, slopes, driveway spacing, offsite grading, walls)
      commands/  #   THE command layer: every mutation/query is a named command with a zod schema
      criteria/  #   design defaults + code tables (each value has a source comment)
    data/        # Adapters: parcels, roads, DEM, imagery, constraints, zoning text. Node-only. Fixture-first.
    server/      # Node (Fastify or Express) + WebSocket. Owns project state. Serves web app. REST: POST /api/commands/:name
    mcp/         # MCP server (stdio). Thin: each MCP tool = one command, forwarded to the server's REST API.
    web/         # React + Vite + TypeScript. 2D plan (canvas/SVG), 3D view (Three.js), panels. Subscribes to state over WS.
  data/sites/heilmandale/   # Cached fixtures + provenance.json (committed, so demos never need the network)
  docs/                     # reference/, screens/ (QA screenshots), DEMO.md, ARCHITECTURE.md
  scripts/                  # fetch-site-data.ts, demo-scenario.ts, render-screens.ts
```

### 3.1 The command layer (most important design decision)

- Every user or AI action is a **command**: `{ name, input (zod-validated), handler(state, input) => { state, result } }`.
- The **UI, the MCP server, the scripts and the tests all call the same commands.** No logic is duplicated in the UI.
- Commands are pure over the project state (I/O commands like `load_site` call adapters first, then a pure command). This gives free **undo/redo**, **scenarios** (branches of state) and **replayable demo scripts**.
- Every command result is **compact and decision-useful for an LLM**. Results return summaries, counts, pass/fail checks with reasons and the IDs of what changed, never raw geometry dumps. Example: `"Requested 120 trailer stalls; placed 96. Limiting factor: truck court length (building length 763 ft). Options: lengthen building, add a trailer storage field west of the east truck court."`
- State has a monotonically increasing `revision`. The server broadcasts `{revision, changedIds, designLogEntry}` over WebSocket, and the web app re-renders.

### 3.2 Talking to Claude (MCP, no API key)

The app does **not** call the Anthropic API. Instead `packages/mcp` is an MCP server (official `@modelcontextprotocol/sdk`, stdio transport) that the user registers in Claude Desktop or Claude Code. Claude chats in its own window; the browser beside it updates live.

- MCP server → HTTP → `server` (default `http://localhost:4310`). If the server isn't running, tools return a clear error: "Start the app with `npm run dev`."
- **Design log:** every command invoked via MCP appends a human-readable entry to an in-app "Claude activity" panel ("Placed 411,840 SF cross-dock, 760 × 542 ft, rotated 12° to parallel Heilmandale Rd"). Clients watching the browser see what Claude is doing even if they can't see the chat.
- **Claude can see the plan:** a `render_view` tool returns a PNG (MCP image content). It's rendered server-side with headless Playwright loading the same web app at `/?render=plan|3d|cutfill&scenario=…`. Claude uses this to visually sanity-check its own layouts.
- Ship `docs/MCP_SETUP.md` with copy-paste config for:
  - Claude Desktop (`claude_desktop_config.json` → `mcpServers.groundwork = { command: "node", args: ["<abs>/packages/mcp/dist/index.js"] }`)
  - Claude Code (`claude mcp add groundwork -- node <abs>/packages/mcp/dist/index.js`)
- Write good **tool descriptions**. They are the prompt. Each says what the tool does, when to use it, units, and what the result contains. Also ship an MCP **prompt** (`groundwork_designer`) that primes Claude with the workflow: load site → confirm zoning → program → layout → check → grade → iterate → export.

### 3.3 Tool list (MCP ⇄ commands)

| Group | Tool | Purpose |
|---|---|---|
| Context | `get_project_summary` | Scenario, program, yields, open check failures, revision |
| | `get_site_context` | Parcel area/frontages, named roads + which parcel edges they front, adjacent zoning districts by edge, constraints, terrain stats (high/low points, general fall direction, average slope) |
| | `get_zoning_rules` | Active rule set with citations + confirmed/unconfirmed status + interpretation flags |
| | `get_ordinance_text` | Return cached ordinance text for a section number (so Claude can read and cite) |
| | `render_view` | PNG of plan / 3D / cut-fill / section, optional bbox |
| | `run_checks` | All zoning + engineering checks: pass/fail/warn, value vs limit, citation, object IDs |
| Site | `load_site` | By address or parcel ID → adapters → site model (fixture-first) |
| | `set_zoning_rules` / `confirm_zoning_rules` | Claude proposes rules (with citations) → user/Claude confirms |
| | `add_constraint` | Manual exclusion polygon (easement, wetland buffer, "keep out") |
| Program/layout | `set_program` | Building SF, type (cross-dock / rear-load), clear height, dock doors, trailer stalls, car stalls or employees per shift |
| | `place_building` | Explicit placement: anchor/centroid, rotation or `alignTo: {road}`, length/depth, dock sides |
| | `set_access` | Driveway: network (truck/car/emergency), road, position along frontage or "auto", lanes |
| | `generate_layout` | Auto-solver honoring all of the above + soft preferences (e.g., docks away from residential) |
| | `edit_object` / `delete_object` | Parametric edits by ID |
| | `add_parking_field` / `add_trailer_field` / `add_basin` | Explicit placements |
| Scenarios | `create_scenario` / `switch_scenario` / `compare_scenarios` | Branch, switch, side-by-side table of yields, checks, earthwork |
| Grading | `set_grading_criteria` | Slopes, dock height, pavement sections, shrink, tie-in slope ratio |
| | `grade_site` | Build proposed surface at given or current FFE |
| | `optimize_ffe` | Target balance (or import/export CY); returns FFE, feasible FFE range, binding constraints |
| | `get_earthwork_report` | Cut, fill, net, strip, subgrade adjustments, by area (pad, truck court, parking, basin) |
| | `cut_section` | Section along a line: existing vs proposed profile (data + image) |
| Output | `export` | DXF, GeoJSON, PNG plan sheet, XLSX summary (yield + compliance + earthwork) |
| | `log_note` | Claude adds a narrative note to the design log (assumptions, rationale) |
| | `undo` / `redo` | |

## 4. Site model (core types, sketch)

All coordinates in a **local projected CRS in US survey feet**: EPSG:2272, NAD83 / Pennsylvania South (ftUS). Confirm Lebanon County is in the PA South zone. Store the CRS in the site so other jurisdictions can use their own state plane. Elevations in feet (NAVD88). **Units live in names**: `lengthFt`, `areaSf`, `volumeCy`, `slopePct`, `elevFt`.

- `Site`: parcel polygon(s), roads (centerline + ROW polygon + name + class), adjacent parcels with zoning district, constraint polygons (wetlands, floodplain, steep slopes, manual), existing surface (grid), imagery tile source, provenance.
- `ZoningRuleSet`: rules[] (see `docs/reference/zoning-north-lebanon-I1.md` for the schema and the demo rules).
- `Program`: target building SF, type, dims or ratio, clear height, doors, trailer stalls, car stalls/employees, office SF.
- `DesignObjects`: Building, TruckCourt (per dock side), TrailerField, ParkingField (module rows), DriveAisle (centerline + width + network tag), Driveway (access point + network tag), Basin, LandscapeArea, RetainingWall (derived), each with ID, params, derived geometry and a grading spec.
- `GradingCriteria`, `ProposedSurface` (grid), `EarthworkReport`.
- `Scenario` = { program, objects, grading, results, checks }. `Project` = { site, rules, scenarios, activeScenarioId, history }.

Persist projects as JSON under `projects/` (server). Grids as binary sidecar files (Float32Array) to keep JSON small.

## 5. Engines (core)

### 5.1 Zoning engine
- Classify each parcel edge as **front (ROW)**, **side**, **rear**, and flag **abuts residential district** / **across street from residential**. Use the road adjacency and adjacent-parcel zoning; allow manual override.
- Build **envelopes** by offsetting per edge class with the rule values:
  - `buildingEnvelope`
  - `parkingEnvelope`
  - `loadingEnvelope` (not in required front yard)
  - `pavementEnvelope`
  Then subtract constraints. Use a robust polygon offset/boolean library (Clipper2 or equivalent); test on concave parcels.
- Evaluate every rule into a **check**: `{ruleId, status: pass|fail|warn|n/a, value, limit, units, citation, objectIds, message}`.
- Rules carry `interpretationFlags`, e.g., "§27-1408 'one for each additional 40,000 SF': partial increments rounded up (conservative)". Show these in the UI and expose them via `get_zoning_rules` so Claude can mention them.
- **Ordinance ingestion flow** (works for new jurisdictions): cached ordinance text by section → Claude reads via `get_ordinance_text` → proposes rules via `set_zoning_rules` with section + quote → UI shows "proposed (unconfirmed)" in amber → `confirm_zoning_rules` (by Claude when the user says so, or by clicking in the UI). For the demo site, **pre-populate** the confirmed I-1 rule set from the reference file so the demo works without this step.

### 5.2 Layout engine (test fit)
Use industrial defaults from `docs/reference/engineering-criteria.md`. Generators are parametric and deterministic:

1. **Building:** rectangle from SF + depth (cross-dock default 540 ft deep; rear-load 340 ft). Rotation from explicit angle, `alignTo` road edge, or solver. Dock walls: cross-dock = both long sides; rear-load = one long side. Door count from spacing (default 12 ft o.c., ~50 ft clear at each corner) unless specified. Office zone at one or two corners (where the car side is).
2. **Truck courts** on each dock side:
   - 60 ft concrete dock apron
   - 70 ft maneuvering lane
   - optional 55 ft trailer stall row opposite the docks (total depth 185 ft, or 130 ft without trailer parking)
   - 12 × 55 ft trailer stalls

   Must lie inside `loadingEnvelope`.
3. **Car parking fields:** 90° modules aligned to the building. Stall and aisle sizes come from the zoning rules; if the design default is larger than the zoning minimum, use the design default and note it. Rows fill the `parkingEnvelope` near the office corners. Accessible stalls per the 2010 ADA Standards Table 208.2 (+ van ratio), placed nearest the office entrance. Landscape islands per ordinance (end islands + interior islands as required).
4. **Circulation:** separate graphs per network (`truck`, `car`, optional `emergency`).
   - Truck drives: 32 ft two-way default, curb returns 60 ft at entrances.
   - Car drives: 24 ft, 15 ft min returns.
   - Route from each assigned driveway to its destination (truck courts / parking fields) inside the allowed pavement area, avoiding the building + clearance. Grid A* or visibility graph on the envelope, then simplify to orthogonal-ish polylines with fillets.
   - **Separation check:** truck and car pavement polygons must not intersect or share nodes, except an explicitly allowed gated emergency connection.
5. **Driveways:** on the assigned road frontage. Enforce spacing (≥150 ft from intersecting street ROW and other driveways, §27-1407) and width ranges. Prefer positions where existing road grade gives a feasible drive profile.
6. **Stormwater reservation (planning-level):** required storage from a configurable rule (default: inches of runoff over new impervious area; see criteria). Basin footprint = storage / design depth + 3:1 side slopes + freeboard. Auto-place at the **lowest feasible remaining area** using the DEM (outside wetlands, building envelope and pavement). It's a land-use reservation, not a hydrologic design, and the UI says so.
7. **Auto-solver (`generate_layout`):**
   - Enumerate orientations (explicit, road-aligned, plus 0–175° by 5°) × positions on a coarse grid inside `buildingEnvelope`.
   - For each candidate, generate the full layout and **score**:
     - hard constraints (all must pass)
     - program attainment (SF, trailer stalls, car stalls)
     - soft prefs (docks not facing residential, truck route length, user constraints)
     - **earthwork proxy** (std-dev of existing elevation under the pad + truck courts; prefer flatter ground)

     Keep the best N and return the best with a one-paragraph rationale and the runner-up deltas.
   - Must run in < 10 s for the demo site (use a worker on the web side; on the server just run it).
8. **Yield table:**
   - building SF, coverage %, impervious SF/%, landscaped %
   - car stalls (std / ADA / van), trailer stalls, dock doors, loading berths required vs provided
   - basin area, FAR
   - each with its limit and citation where applicable

### 5.3 Grading engine (concept-level)
Raster-based on a regular grid aligned to the site CRS (default 5 ft for interactive, 2 ft for reports).

- **Existing surface:** DEM resampled to the grid (bilinear). Provide elevation-under-cursor and existing contours (1 ft minor, 5 ft index) via marching squares.
- **Grading objects** define the proposed elevation inside their footprint:
  - Building pad: flat at FFE, overbuild 10 ft.
  - Truck court: starts at the dock face at `FFE − dockHeight` (default 4.0 ft) and slopes away from the building at 1.5% (range 1.0–2.0% apron, ≤3% maneuvering).
  - Parking field: plane anchored at a reference edge with slope vector (1.0–4.0% per ordinance; ADA stalls/aisles ≤ 2.0%). Anchor near the building at `FFE − 0.5 ft` (sidewalk).
  - Drive aisles: centerline profile linearly interpolated between anchors (driveway tie-in = existing road elevation at the ROW line; destination = adjacent object elevation), with cross-slope 2%; max grade truck 6%, car 8%.
  - Basin: bottom elevation, 3:1 interior side slopes, top-of-berm elevation.
  - Overlaps resolve by priority: pad > truck court > drive > parking > basin.
- **Daylighting (tie-in to existing at H:V, default 3:1):** for each cell outside all footprints, compute distances `d_i` from the cell center to each object's **boundary** and the object edge elevation `z_i`. Don't use a naive cell-center-to-cell-center distance transform: it underestimates tie-in volumes by ~2% at 1 ft cells and ~8% at 5 ft cells. See the gotcha and test T3 in `engineering-criteria.md`. With `s` = horizontal ratio:
  `L = max_i(z_i − d_i/s)`, `U = min_i(z_i + d_i/s)`, `proposed = clamp(existing, L, U)`.
  - Where `L > U`, two objects are too close to tie together at 3:1. Mark the cells as **retaining wall required**, and report wall length and max exposed height.
  - Use the nearest edge elevation of each object for `z_i`. Planar objects have varying edge elevations, so store an edge-elevation raster per object from its own surface and propagate it with the distance transform (nearest-feature transform).
- **Offsite grading check:** cells outside the parcel where |proposed − existing| > 0.1 ft → warning with area, "needs grading easement or wall".
- **Earthwork:**
  - Grid method: `Σ (proposed − existing) × cellArea`, split into cut and fill.
  - Report to **subgrade**: subtract the pavement/slab section thickness per object type from the proposed finished grade before computing.
  - Topsoil strip over the disturbed area (default 6 in) as a separate line.
  - Shrink factor on cut (default 10%).
  - `net = cut × (1 − shrink) − fill` (+ import / − export).
  - Report by object category. CY = CF / 27.
- **FFE optimizer:**
  - All object elevations are parameterized off FFE except the driveway tie-ins (fixed to existing road).
  - Compute the **feasible FFE range** from drive-grade limits (e.g., truck drive ≤ 6% from the Route 72 tie-in to the truck court).
  - Solve `net(FFE) = target` by bisection or Brent's method within the feasible range (net is monotonic in FFE). Report FFE to 0.1 ft, cut/fill/net, binding constraints, and "balance not achievable within feasible range" when applicable.
  - Stretch: coordinate descent over independent parking-field offsets to minimize total movement.
- **Outputs:**
  - proposed contours (1/5 ft, bold)
  - cut/fill heatmap (diverging red cut / blue fill, symmetric scale, legend in ft)
  - spot elevations at building corners, dock faces and driveway tie-ins
  - sections along a user-drawn line (existing dashed, proposed solid, vertical exaggeration selectable)
- Grading runs in a **web worker** on the client for interactive edits and in-process on the server for MCP calls. Same core code.

### 5.4 Engineering checks (besides zoning)
- ADA accessible stall count and van count vs total stalls (Table 208.2).
- ADA stall/aisle surface slope ≤ 2.08% (1:48) on the proposed grid.
- Parking field max slope ≤ 4% (§27-1410) and min 1% (drainage).
- Truck court slopes within criteria. Truck drive grades ≤ 6%, car ≤ 8%.
- Driveway spacing and widths (§27-1407).
- Retaining walls required (length, max height). Offsite grading.
- Slopes steeper than 3:1 in landscape areas.
- Truck/car network separation.
- Building height ≤ 75 ft (§27-1003).
- Stretch: WB-67 swept path at truck entrances (kinematic tractor-trailer off-tracking along the drive centerline; check the envelope stays on pavement).

## 6. Data adapters (fixture-first)

Rule: **the demo must run with zero network access.** `scripts/fetch-site-data.ts` tries live sources and writes to `data/sites/heilmandale/` with `provenance.json` (`{layer, sourceUrl, fetchedAt, license, notes}`). The app reads only from the fixture folder. If a live fetch fails, log it in PROGRESS.md and move on. Don't retry in loops.

### 6.1 Parcels
- PASDA statewide parcels (ArcGIS REST, NAD83 geographic): `https://imagery.pasda.psu.edu/ArcGIS/rest/services/PA_Parcels/MapServer` (layer 1 "PA Parcels", fields include PIN). Also tried: `services.pasda.psu.edu/server/rest/services/PA_Parcels/MapServer`. Query by point (geocoded address) with `geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outSR=2272&f=geojson`. Also pull **adjacent parcels** within ~1,000 ft.
- Fallback: Lebanon County's public ArcGIS Online property viewer (`lebcogis.maps.arcgis.com`). Discover the parcel feature service from the web app's item JSON.
- Final fallback: digitize the parcel from imagery and the as-built footprint (~110 ac) and mark `provenance.notes = "approximate, digitized"`.

### 6.2 Roads
- OpenStreetMap via Overpass API (`https://overpass-api.de/api/interpreter`): ways with `highway=*` within the bbox, with names/refs (expect PA Route 72, Heilmandale Rd, Orange Ln). ROW width default by class if unknown (state route 60 ft, local 50 ft), flagged as assumed. Attribution: © OpenStreetMap contributors (ODbL).
- Also pull the as-built warehouse footprint (`building=*`) for the comparison layer.

### 6.3 Terrain (must be pre-development)
- USGS 3DEP elevation ImageServer: `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage`. Use `bbox` (+1,000 ft buffer), `bboxSR`, `imageSR=2272`, `format=tiff`, `pixelType=F32`, ~1 m resolution, `f=image`. Respect the service's max image size (tile if needed). Read with `geotiff`. Convert meters → feet.
- **Check for the built pad.** The warehouse was built ~2020–2021. Sample the DEM inside the as-built footprint. If it's suspiciously flat (std-dev < 0.5 ft over a 400k SF area), the data post-dates construction. Then use a **pre-2020 collection** instead: PA statewide LiDAR (PAMAP 2006–2008) or the USGS PA South Central 2017/2018 QL2 projects. These are available via PASDA downloads or a 3DEP `mosaicRule` that selects the collection; the 3DEP elevation index service lists collections and dates. Record which one you used in provenance.
- If no network: generate a **synthetic terrain** for the fixture (~40 ft of relief across the parcel with a gentle valley draining south toward the wetland area) and show a persistent "SYNTHETIC TERRAIN" badge.

### 6.4 Imagery
- USGS National Map imagery tiles (public domain): `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}`. Cache the tiles covering the site bbox at z15–z19 into the fixture. Note: these images may show the as-built warehouse. That's fine, and it's a feature, but allow toggling imagery off.

### 6.5 Constraints
- Wetlands (USFWS National Wetlands Inventory) and FEMA flood hazard zones (NFHL) via their public ArcGIS REST services. Verify the current endpoints. Wetlands exist on the south side (~4.5–5 ac per the 2020 Planning Commission minutes).
- Steep slopes > 25% derived from the DEM (informational).

### 6.6 Zoning
- District polygons: digitize the area around the site from the township's 2023 zoning map PDF (`https://northlebanontwppa.gov/wp-content/uploads/2023/06/NLT-Zoning-Map-2023.pdf`) into `zoning-districts.geojson` (site = I-1; residential to the north and west, agricultural to the south and along Route 72, commercial across Route 72, per the 2020 minutes; **verify against the map**). Mark as digitized/approximate in provenance.
- Ordinance text: official code is eCode360 `https://ecode360.com/NO1608` (Chapter 27 Zoning). A third-party mirror is at `https://www.zoneomics.com/code/north-lebanon-township-PA` (chapter_11 = Part 10 I-1, chapter_14 = Part 13 environmental, chapter_15 = Part 14 parking/loading, chapter_1 = definitions). Cache the relevant section texts as JSON keyed by section number for `get_ordinance_text`. If neither is reachable, use the extracts in `docs/reference/zoning-north-lebanon-I1.md`.
- Also on the township site:
  - SALDO 2024: `https://northlebanontwppa.gov/wp-content/uploads/2024/10/0.-SLDO-2024.pdf`
  - Stormwater ordinance 2022: `https://northlebanontwppa.gov/wp-content/uploads/2022/08/Ord-6-2022-SWM-Ordinance-FINAL.pdf`

  Mine the SALDO for parking-lot and driveway design standards if time allows (lower priority).

## 7. User interface

Civil 3D-inspired, but cleaner. Dark theme default (light toggle). Layout:

- **Top bar:** project / scenario switcher (A, B, C…), undo/redo, "Concept-level, not for construction" tag, export menu.
- **Left panel:** Layers (parcel, setbacks/envelopes, imagery, existing contours, proposed contours, cut/fill, constraints, as-built reference, zoning districts, labels) and an **object tree** (building, truck courts, fields, drives, basin, walls).
- **Center:** **2D plan view** (default) with smooth pan/zoom, CAD-like layer colors, dimension and area labels, north arrow, scale bar, and hover tooltips showing the governing rule and citation on setback lines. Selection handles: move, rotate, resize the building, drag driveways along the frontage. Engine re-solves on release. Toggle to **3D view** (Three.js):
  - terrain mesh (existing/proposed toggle, imagery drape or cut/fill color)
  - extruded building with dock doors
  - pavement
  - trailers as instanced boxes
  - basin
  - orbit camera with good default framing
- **Right panel tabs:** **Checks** (zoning + engineering, grouped, pass/fail/warn chips, click to zoom to object), **Yield**, **Earthwork** (cut/fill/net bars, FFE, feasible range), **Program** (editable form), **Claude activity** (design log feed with timestamps).
- **Bottom:** status bar (x, y in state plane ft; existing/proposed elevation under cursor; cut/fill depth) and a small **command line**, CAD style, that accepts command names with JSON or simple args. It's handy for power users and tests.
- **Section tool:** draw a line → a resizable profile panel.
- Every view must look good in a 1920×1080 screenshot and in the `render_view` 1600×1000 output.

## 8. Exports
- **DXF** (R2010+) in state plane feet with AIA-style layers:
  - `C-PROP` (parcel), `C-BLDG`
  - `C-PKNG-STRP`, `C-ROAD`, `C-TRCK`
  - `C-TOPO-EXST-MINR/MAJR`, `C-TOPO-PROP-MINR/MAJR`
  - `C-STRM-BSIN`, `C-SETB` (setbacks), `C-ANNO`
- **GeoJSON** (WGS84) of all design objects.
- **PNG plan sheet:** 24×36 aspect with a simple title block (project, scenario, date, "Concept, not for construction", yield + compliance summary).
- **XLSX summary:** sheets for Yield, Compliance (with citations), Earthwork, Assumptions.

## 9. Phases, priorities and acceptance criteria

Work in vertical slices. **Each phase ends with `npm run verify` green, screenshots reviewed, PROGRESS.md updated, and a git commit.** If time runs short, finish phases in order. A polished Phase 5 beats a broken Phase 7.

**Phase 0: Foundations**
- npm workspaces monorepo, TypeScript strict, ESLint, Prettier, Vitest, Playwright.
- `npm run dev` (server + web concurrently), `npm run verify` (typecheck + lint + unit + e2e smoke + screenshot capture to `docs/screens/`).
- Core types (zod), units helpers, command registry with undo/redo and scenarios, server with REST + WS, web shell with panels and an empty plan view.
- ✅ verify passes. ✅ Screenshot of the app shell looks like a real product, not a template.

**Phase 1: Site data + plan view**
- Adapters + `scripts/fetch-site-data.ts` + committed fixture with provenance, including the synthetic fallback.
- Plan view renders the parcel, roads (named), imagery, zoning districts, constraints, existing contours, and the as-built reference.
- Status bar shows coordinates and elevation.
- ✅ Parcel area within ±5% of ~110 ac (or flagged if the parcel source differs). ✅ DEM is pre-development (or a synthetic badge is shown). ✅ Screenshot.

**Phase 2: Zoning engine**
- Rule schema; I-1 rule set pre-loaded from the reference doc with citations and interpretation flags.
- Edge classification (front/side/rear/residential-adjacent), envelopes, checks framework, Checks panel, setback lines with citation tooltips.
- Ordinance text cache + `get_ordinance_text`.
- ✅ Unit tests: envelopes on rectangular, L-shaped and corner-lot parcels; residential-adjacent 150 ft building and 100 ft parking setbacks applied only to the right edges. ✅ Screenshot with envelopes.

**Phase 3: Layout engine (test fit)**
- Building, truck courts, trailer rows, parking fields with ADA stalls and islands, driveways, separated circulation networks, basin reservation, landscape area, yield table.
- Direct manipulation in the UI; auto-solver.
- `scripts/demo-scenario.ts` runs the headline scenario (§10) through commands only and writes a summary + screenshot.
- ✅ Headline scenario produces a layout where all hard checks pass (or each failure is explained with a reason and an option). ✅ Truck/car networks verified disconnected. ✅ Solver < 10 s. ✅ Screenshots of plan + yield.

**Phase 4: MCP server**
- All tools in §3.3 (layout + context ones now; grading ones are wired as they land), design log panel, `render_view`, `groundwork_designer` prompt, `docs/MCP_SETUP.md`.
- ✅ `npm run test:mcp` spawns the MCP server with the official client SDK, lists tools, runs the headline scenario through MCP and gets a PNG back. ✅ Tool descriptions reviewed for clarity (read them as if you were Claude with no other context).

**Phase 5: Grading + earthwork**
- Grading objects, daylighting, walls, offsite check, earthwork to subgrade, FFE optimizer with feasible range, proposed contours, cut/fill map, sections, 3D proposed surface.
- ✅ All hand-calc tests in `docs/reference/engineering-criteria.md` pass within the stated tolerances. ✅ Optimizer balances the demo site within ±2% of total movement or reports why not. ✅ Interactive regrade after a building drag < 1.5 s at 5 ft grid. ✅ Screenshots: cut/fill, contours, section, 3D.

**Phase 6: Checks, exports, scenarios, polish**
- Remaining engineering checks, all exports, scenario compare, a 3D polish pass, empty/error states, a keyboard shortcuts help, and a guided "demo mode" button that replays the headline scenario with the design log animating.
- ✅ The DXF opens in a DXF viewer/validator (e.g., parse back with a DXF parser in tests). ✅ XLSX opens and has 4 sheets. ✅ Full e2e Playwright run of the demo.

**Phase 7: Docs and hardening**
- `README.md` (what it is, 5-minute quickstart on a laptop), `docs/DEMO.md` (a scripted client demo with the exact prompts to type into Claude Desktop and what should happen), `docs/ARCHITECTURE.md`, `docs/LIMITATIONS.md` (honest list).
- ✅ Fresh-clone test: `npm ci && npm run build && npm run verify` from a clean checkout passes.

**Stretch (only after Phase 7):**
- Rational-method / TR-55 runoff estimate driving basin size
- WB-67 swept path
- Multi-building layouts
- Second jurisdiction via the ordinance-ingestion flow
- Residential subdivision mode
- An ADA accessible-route tool (draw a route; check running slope ≤ 5% or ramp ≤ 8.33% with ≤ 30 in rise per run, landings, cross slope ≤ 2.08%; "fix" solves spot elevations)

## 10. Headline demo scenario (acceptance test for Phases 3–5)

Run as `scripts/demo-scenario.ts` (commands only) and documented in `docs/DEMO.md` as natural-language prompts:

1. Load 1625 Heilmandale Rd. Summarize the site: area, frontages and road names, adjacent zoning by edge, terrain fall, constraints.
2. Show the I-1 rules with citations. Point out the 150 ft building setback and 100 ft parking setback from the residential district, and the interpretation flags.
3. Program: ~410,000 SF cross-dock, 40 ft clear, max dock doors, as many trailer stalls as fit (target ≥ 100), employees 300 on the largest shift / 520 across the two largest successive shifts (assumption, logged).
4. Place the building with its long axis parallel to Heilmandale Rd. Docks face away from the residential districts where possible.
5. Truck access from Route 72 and Heilmandale Rd. Employee car access only from Orange Ln. Truck and car circulation not connected (a gated emergency link is allowed only if the fire-access check needs it; log it).
6. Run checks; fix failures; report the yield.
7. Grade it, optimize FFE for balance, report cut/fill/net, walls and offsite grading.
8. Scenario B: rotate 90° (or rear-load). Compare A vs B in a table.
9. Toggle the as-built reference and comment on the differences.
10. Export DXF + XLSX.

## 11. Non-negotiables
- Engineering numbers live in `packages/core/src/criteria/` with a source comment on every value (ordinance section, ADA section, or "industry default, EFCG assumption").
- No silent assumptions: every assumed value surfaces in the Assumptions list (UI + XLSX + `get_project_summary`).
- Zoning numbers in the demo come from the reference doc / cached ordinance text with section citations. Never invent a code section.
- The demo works offline from fixtures.
- Concept-level disclaimer visible in the UI and on every export.
