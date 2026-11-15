# Architecture

```
            Claude Desktop / Claude Code                         Browser (React)
                      │ MCP (stdio)                                   ▲   │
                      ▼                                     WebSocket │   │ POST /api/commands/:name
        packages/mcp  (thin forwarder) ── HTTP ──▶  packages/server  ─┘   ▼
                                                     owns Project state, runs commands,
                                                     performs effects (PNG render, file writes)
                                                              │
                                                              ▼
                                                     packages/core  (pure TypeScript)
                                 geometry · site · zoning · layout · grading · checks · export · commands
                                                              ▲
                                     packages/data (fixtures, synthetic site, live adapters)
```

## Principles

1. **One command layer.** Every mutation and query is a named command with a zod input schema
   (`packages/core/src/commands`). The UI, the MCP server, the scripts and the tests all call
   `executeCommand(project, name, input)`. There is no business logic in React components or MCP handlers.
2. **Pure core.** `packages/core` has no DOM, no network, no filesystem and no unseeded randomness (enforced by ESLint).
   Commands are pure functions `(project, input) → { project, result, log, effects }`.
3. **Fixture-first data.** The app reads only `data/sites/<id>/`. Live fetching lives in `scripts/fetch-site-data.ts`.
4. **Deterministic engine, LLM on top.** Claude never produces coordinates. It chooses commands; the engine does geometry and math
   and returns compact, decision-useful results (summaries, counts, check failures with reasons and options, object ids).

## Project state

`Project = { site, rules, scenarios[], activeScenarioId, log[], revision, history }` (`core/src/site/project.ts`).

- `Site`: parcel ring, roads (centerline + ROW width), district polygons, constraints, as-built reference, DEM grid, classified
  parcel edges (front / side / rear, residential adjacency), provenance. Coordinates are the site CRS in US survey feet
  (EPSG:2272 for the demo); elevations in feet. Units live in names (`areaSf`, `lengthFt`, `volumeCy`, `slopePct`, `elevFt`).
- `Scenario`: program, access assignments, preferences, placement, **design objects**, layout / stormwater / grading
  criteria, FFE, and derived results (yield, checks, earthwork).
- Design objects are parametric (`building`, `truckCourt`, `truckApron`, `trailerField`, `parkingField`, `driveway`,
  `drive`, `basin`, `landscape`). `auto` objects are regenerated from the building placement; manual objects persist.
- **Derived results are never inputs.** After each mutating command `core/src/derive.ts` recomputes the active scenario's
  yield table, zoning + engineering checks and (if graded) the earthwork report.
- **Undo/redo** are snapshots with structural sharing (the site and the DEM are shared, never copied).
  **Scenarios** are branches of the same state.
- The server persists `projects/current.json` plus a Float32 DEM sidecar; `load_site` starts a new project.

## Command flow

```
POST /api/commands/generate_layout  { "alignToRoad": "Heilmandale Rd" }      (header x-groundwork-source: ui | mcp | script)
  → zod validation (readable errors)
  → handler(project, input, ctx)            pure
  → derive (yield, checks, earthwork)       pure
  → history push, revision + 1, design-log entry
  → effects (optional): render PNG via headless Chromium, write DXF / GeoJSON / XLSX
  → WebSocket broadcast { revision, changedIds, designLogEntry, project }
  ← { ok, revision, result: { summary, … } }
```

Host services (`resolveSite`, `ordinanceText`) and effects are how pure commands reach the outside world; the server
implements them (`packages/server/src/effects.ts`, `packages/data/src/fixtures.ts`).

## Engines (packages/core)

| Module | What it does |
|---|---|
| `geometry/` | Points, rings, regions; Clipper-based booleans and offsets (inputs shifted to a local origin, 0.001 ft integers); grids, bilinear sampling, scanline rasterization, marching-squares contours; CRS helpers (proj4) |
| `zoning/rules.ts` | Rule schema; the pre-loaded, cited North Lebanon I-1 rule set. Engines look rules up by semantic `key`, so another jurisdiction only supplies rules |
| `zoning/edges.ts` | Parcel edge classification from roads + district polygons, with manual overrides |
| `zoning/envelopes.ts` | Building / parking / loading / pavement envelopes: per-edge yard strips + residential district buffers − constraints |
| `zoning/checks.ts` | Every rule evaluated into a check `{status, value, limit, units, citation, objectIds, message}` |
| `layout/building.ts` | Building, truck courts, aprons (with drive ports), parking fields (modules, islands, ADA stalls) |
| `layout/access.ts` | Driveways on frontages (§ 27-1407 spacing), grid A* routing per network with line-of-sight simplification |
| `layout/basin.ts` | Stormwater reservation sizing and lowest-ground placement (summed-area tables) |
| `layout/generate.ts` | Orchestrates one full layout for a placement |
| `layout/solver.ts` | Two-stage search: cheap score over orientations × positions, full layout + re-score for the best few |
| `grading/engine.ts` | Raster grading model: objects define `z = z0 + k·FFE`; priority overlay; exact-distance 3:1 tie-in (`clamp(existing, L, U)`); wall detection where `L > U`; cut/fill to subgrade; bisection FFE solver |
| `grading/objects.ts` | Design objects → grading objects (pad, dock-height courts, parking planes, drive profiles, basin); feasible FFE range from drive grades |
| `grading/scenario.ts` | Scenario grading, optimizer, earthwork report, section profiles, display products |
| `checks/` | ADA counts and slopes, network separation, drive grades, walls, offsite grading, assumptions list |
| `export/` | DXF (AC1024, AIA layers), GeoJSON (WGS84), XLSX sheet models |
| `criteria/` | Every design default and code table, each with a source comment and assumption metadata |
| `demo/headline.ts` | The headline scenario as a list of commands (used by the script, the MCP test and the Demo button) |

## Web app (packages/web)

- State arrives over WebSocket; the client never mutates it. UI actions call `runCommand`.
- **Plan view** (`plan/`): Canvas 2D with layered overlays, label collision avoidance, setback tooltips
  (`governingRuleAt`), selection handles (move / rotate / resize the building, slide a driveway) that preview a ghost
  and commit through `edit_object` on release.
- **Worker** (`worker/`): existing contours and the proposed surface (same `gradeScenario` as the server) are computed
  off the UI thread; the server computes the numbers, the worker computes the pictures.
- **3D view** (`view3d/`): Three.js terrain mesh (existing / proposed, plain or cut/fill drape), building, dock doors,
  trailers, basin water.
- **Render mode** (`/?render=plan|cutfill|3d|section|sheet`): chrome-less views the server screenshots with headless
  Chromium for `render_view`, `cut_section` and the PNG sheet export.

## MCP server (packages/mcp)

`listCommands()` from core becomes the tool list (zod → JSON Schema); a tool call is one `fetch` to the app. Image
results become MCP image content. If the app is not running the tool returns: "Start the app with `npm run dev`".
The `groundwork_designer` prompt and the server instructions describe the workflow and the citation rules.

## Tests

- `packages/core/src/**/*.test.ts`: hand calcs T1–T13, envelopes on rectangular / L-shaped / corner lots, layout
  commands, exports (DXF parsed back).
- `packages/data/src/*.test.ts`: the fixture and the full headline scenario on it (acceptance for Phases 3–5).
- `e2e/*.e2e.ts`: real server + Chromium (shell, site, layout drag, grading, 3D, demo button, exports).
- `e2e/*.mcp.ts`: the built MCP server driven by the official client SDK over stdio.
- `scripts/render-screens.ts`: QA screenshots in `docs/screens/`.

## Adding a second site or jurisdiction

1. Put a fixture in `data/sites/<id>/` (`site.json`, `dem.f32`, optional `ordinance.json`); `scripts/fetch-site-data.ts`
   shows how to build one from public services.
2. If the district has no built-in rule set, `load_site` says so: read the ordinance with `get_ordinance_text`, propose
   rules with `set_zoning_rules` (same semantic keys), confirm with `confirm_zoning_rules`. No engine changes.

## Chat panel

`POST /api/chat {message}` starts a turn in `packages/server/src/chat.ts`; progress is pushed to the browser as
`{type: "chat"}` WebSocket messages carrying the whole (small) transcript. Two engines:

- **claude**: spawns the local Claude Code CLI headless (`claude -p --output-format stream-json`) with an MCP config
  that points at this app's own MCP server, no built-in tools, no user settings, and `mcp__groundwork` pre-approved.
  Tool calls come back into the app as ordinary `POST /api/commands/:name` requests from the MCP server. The app never
  talks to the Anthropic API.
- **builtin**: `interpretRequest` in `packages/core/src/chat/interpret.ts` (pure, unit-tested) maps text to command
  calls, which the server runs in order.

The plan image export (`packages/web/src/plan/exportPng.ts`) redraws the plan on an off-screen canvas in the browser.

