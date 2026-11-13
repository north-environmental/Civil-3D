# Kickoff prompt (paste into Claude Code)

Run Claude Code from the root of this folder (the one containing CLAUDE.md and SPEC.md). Then paste the text between the lines.

---

You're starting a long, unattended build. Read CLAUDE.md, SPEC.md and everything in docs/reference/ before writing any code.

Build Groundwork exactly as specified: an AI-driven industrial site test-fit + grading web app for the 1625 Heilmandale Rd demo site, with a command layer that a local MCP server exposes to Claude Desktop / Claude Code. Work through the phases in SPEC.md §9 in order. Each phase ends with `npm run verify` green, screenshots reviewed with the Read tool, PROGRESS.md updated and a git commit.

I'm away and can't answer questions. Make reasonable decisions, log them in DECISIONS.md, and keep going. Engineering correctness comes first: write the hand-calc tests from docs/reference/engineering-criteria.md before the grading engine, and never invent zoning values or code sections. The demo must run offline from the cached fixtures. Try each live data source once, then use the fallback chain.

Don't stop after a phase. Continue until Phase 7 is complete, then work the stretch list. When everything is done, leave PROGRESS.md with a short summary for me and the exact steps to run the demo on my laptop and connect it to Claude Desktop.

---

## Tips for the run
- Start it with a high effort setting and let it go. When you return, open `PROGRESS.md` first.
- If the session ends early, restart Claude Code in the same folder and paste: "Resume the Groundwork build. Follow the session-start ritual in CLAUDE.md."
- After it's built, on your laptop: `npm ci && npm run dev`, then follow `docs/MCP_SETUP.md` to register the MCP server in Claude Desktop, and try `docs/DEMO.md`.
