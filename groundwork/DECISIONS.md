# DECISIONS

_Log every non-obvious choice. Format: date | decision | alternatives considered | why._

| Date | Decision | Alternatives | Why |
|---|---|---|---|
| 2026-11-13 | Claude talks to the app via MCP (stdio), not the Anthropic API | In-app chat with API key | Owner's choice; no API key needed; works from Claude Desktop and Claude Code |
| 2026-11-13 | Demo site = 1625 Heilmandale Rd, North Lebanon Twp, PA (I-1) | Humboldt Industrial Park, Hazleton; generic US parcel | Owner's choice; real Kimley-Horn project with public minutes; enables as-built comparison |
| 2026-11-13 | Committed fixture is the **synthetic fallback** (parcel, roads, districts, wetland, terrain), labelled SYNTHETIC everywhere | Route around the sandbox's network policy; wait for access | Every live data host returned 403 from the build sandbox's egress policy. SPEC §6 and site-heilmandale.md define this fallback. `npm run fetch-site-data` replaces it on a networked machine |
| 2026-11-13 | Express 4 + `ws` for the server | Fastify | Vite's dev middleware plugs straight into Express/connect, so `npm run dev` is ONE process and ONE URL (http://localhost:4310) with hot reload |
| 2026-11-13 | `clipper-lib` (Clipper 6.4.2 JS port) for polygon offsets/booleans, wrapped in `core/geometry/clip.ts` | Clipper2 WASM, clipper2-js, polygon-clipping | Pure JS (no async WASM init, works in Node, browser and worker), integer-robust, mature. Inputs are translated to a local origin and scaled to 0.001 ft |
| 2026-11-13 | Playwright **library** pinned to 1.63.0, e2e tests run under Vitest | `@playwright/test` runner | The sandbox ships Chromium for exactly 1.63.0; one test runner for unit + e2e + MCP. On a laptop run `npx playwright install chromium` once |
| 2026-11-13 | zod 3, Vite 7, ESLint 9, React 19 | zod 4, Vite 8, ESLint 10 | Newest majors had unresolved peer-dependency conflicts at install time |
| 2026-11-13 | Zoning rules carry a semantic `key` (e.g. `setback.building.front`) besides the district `id` | Engines keyed on district-specific ids | Keeps engines jurisdiction-agnostic: a second township supplies rules with the same keys via `set_zoning_rules` |
| 2026-11-13 | Required yards are built by subtracting a per-edge strip (square-capped, depth = that edge's setback) from the parcel, plus a buffer of residential district polygons | Uniform polygon inset; half-plane intersection | Works on concave parcels with different setbacks per edge; reproduces hand-calc T12 exactly |
| 2026-11-13 | Residential district boundary along a street is assumed at the street **centerline**; the 150 ft building / 100 ft parking separations are measured from the district polygon | Measure from the ROW line; ignore across-street case | District maps conventionally run to centerlines. Surfaced as an interpretation flag on the rules and in the Assumptions list |
| 2026-11-13 | Workspace packages export TypeScript source (`main: src/index.ts`); Node entry points are bundled with esbuild (`packages/server/dist/main.js`, `packages/mcp/dist/index.js`) | Per-package tsc builds with project references | No build step between packages in dev; MCP config still points at a single built JS file as SPEC §3.2 requires |
| 2026-11-13 | The server owns state and recomputes yields/checks/earthwork after every mutating command; the browser recomputes display surfaces (contours, cut/fill) in a web worker with the same core code | Ship grids over WebSocket | Keeps WS messages small; one source of truth for numbers; same engine both sides |
