# CLAUDE.md: working rules for the Groundwork build

You're building **Groundwork**, a site test-fit + grading web app driven by Claude over MCP. Read `SPEC.md` fully before writing code. Reference data:
- `docs/reference/zoning-north-lebanon-I1.md`: zoning rules with citations
- `docs/reference/engineering-criteria.md`: design defaults and hand-calc tests
- `docs/reference/site-heilmandale.md`: demo site facts and data sources

## You are working unattended
- The owner is away. **Don't stop to ask questions.** When something is ambiguous, pick the most reasonable option, record it in `DECISIONS.md` (date, decision, alternatives, why) and keep going.
- Work through the phases in `SPEC.md` §9 **in order**. Don't start a phase until the previous one is green.
- Keep going until every phase through Phase 7 is complete. Then do stretch items. Only stop if you're truly blocked on something that can't be worked around; if so, write exactly what's needed in `PROGRESS.md` under "Blocked".

## Session start and end ritual
1. At the start of every session (and after any context reset): read `PROGRESS.md`, `DECISIONS.md` and the current phase in `SPEC.md`. Run `git log --oneline -20` and `npm run verify` to see the real state.
2. After every meaningful step (and always at the end of a phase), update `PROGRESS.md`:
   - current phase
   - done
   - next 3 steps
   - known issues
   - last verify result
   - screenshots reviewed
3. Commit at every green checkpoint with a clear message (`phase-3: truck/car network separation + check`). Initialize git in Phase 0 if needed. Never commit secrets or `node_modules`.

## Definition of done (per phase)
A phase is done only when all of these hold:
- `npm run verify` passes (typecheck, lint, unit tests, e2e smoke, screenshot capture).
- The phase's acceptance criteria in `SPEC.md` are met. Tick them off in `PROGRESS.md`.
- You **looked at the screenshots**: open the PNGs in `docs/screens/` with the Read tool and critique them. Check for overlapping labels, unreadable text, ugly defaults, empty panels, wrong scale and broken 3D framing. Fix what you see. "The test passed" is not the same as "it looks right".
- Engineering results are sanity-checked against hand calcs or common sense: a 410k SF building is ~9.4 ac, a 110 ac site should hold it easily, and earthwork for a site like this is typically tens to a few hundred thousand CY, not millions or single digits. If a number looks off, investigate before moving on.

## Engineering correctness rules
- `packages/core` is pure TypeScript: no DOM, no network, no randomness without a seed. Every engine function has unit tests. Write the hand-calc tests in `engineering-criteria.md` **before** implementing the grading engine (test-first).
- Units in names (`areaSf`, `lengthFt`, `volumeCy`, `slopePct`, `elevFt`). Never mix meters and feet. Convert DEM meters to ftUS once, at the adapter boundary.
- Every engineering constant lives in `packages/core/src/criteria/` with a source comment. No magic numbers in engines.
- Never invent ordinance sections or values. If a value isn't in the reference doc or the cached ordinance text, mark it as an EFCG default/assumption.
- Results must be explainable: every check returns value, limit, units, citation and a one-line message a client could read.

## Architecture rules
- **All mutations go through the command layer** (`packages/core/src/commands`). UI, MCP, scripts and tests call commands. No business logic in React components or MCP handlers.
- MCP tool handlers are thin forwarders. Tool descriptions are prompts: write them carefully, with units, when to use, and what's returned. Keep tool results compact (summaries + IDs + check failures), never raw geometry dumps.
- The app must run with **no network** using `data/sites/heilmandale/` fixtures. Live fetching happens only in `scripts/fetch-site-data.ts`.
- Heavy computation (grading, solver) runs in a web worker on the client. The server runs the same core code in-process for MCP calls.
- Keep `npm run dev` working at all times. Never leave the main branch broken at a commit.

## Network and environment
- You might be on the owner's laptop (full internet) or in a cloud sandbox (restricted egress). Try live data sources once each, with timeouts (~20 s). If one fails, record it in `PROGRESS.md` and use the fallback chain in `SPEC.md` §6. **Never loop on retries.**
- If npm install of a dependency fails, pick an alternative library and log it in `DECISIONS.md`.
- Playwright: if browsers aren't installed, run `npx playwright install chromium` once. If that fails, check whether a system Chromium exists and point Playwright at it.
- Don't call the Anthropic API from the app (the owner has no API key for it). Claude reaches the app only via the MCP server.

## Pacing and scope control
- Build vertical slices that work end to end, then deepen. A simple building + truck court + parking that renders, checks and grades correctly beats ten half-done features.
- Time-box: if a sub-problem (e.g., circulation routing, polygon offset robustness) eats ~3 failed approaches, pick a simpler approach that meets the acceptance criteria and log the trade-off in `DECISIONS.md`, with a TODO in `docs/LIMITATIONS.md`.
- UI polish matters for this demo (client executives will see it), but correctness of the numbers matters more. Polish in Phase 6, not before Phase 3 is correct.
- Don't add features outside `SPEC.md` until Phase 7 is done.

## Visual style
- Dark CAD-like theme by default: near-black background (#111418), muted grid, crisp 1 px linework, a restrained palette:
  - parcel: white
  - setbacks: dashed amber
  - building: light gray fill
  - truck pavement: darker gray
  - car pavement: mid gray
  - landscape: muted green
  - basin: blue
  - cut: red / fill: blue (diverging, symmetric)
- Typography: one clean sans (Inter or system UI) + a monospace for coordinates/numbers. Right-align numbers in tables. Thousands separators. Units always shown.
- Text labels must never overlap at the default zoom. Do label collision avoidance or hide low-priority labels.
- Add a small "Concept-level, not for construction" tag in the top bar and on exports.

## Files you maintain
- `PROGRESS.md`: live status (template provided).
- `DECISIONS.md`: decision log (template provided).
- `docs/LIMITATIONS.md`: honest limitations list.
- `docs/DEMO.md`, `docs/MCP_SETUP.md`, `docs/ARCHITECTURE.md`, `README.md`: written in Phases 4–7.
