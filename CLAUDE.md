# CLAUDE.md: project rules (read first, every session)

This repo holds a **land development demo app** for EFCG client executives. It has two tools:

- `packager/` (Python) gathers public data for one site and writes a **site package**.
- `viewer/` (plain JavaScript, built into one HTML file) shows a site package in 3D. It lets the user edit the layout with test buttons or by chatting with Claude.

`SITE_PACKAGE_FORMAT.md` is the contract between the two tools. Both must follow it exactly. If the format has to change, update that file first and bump its version.

`groundwork/` is an earlier TypeScript prototype that needs Node.js. It's kept **only as reference**: its data endpoints, ordinance extract, and the grading, setback and parking math we port from it. Don't edit it, and don't depend on it at runtime.

## Working with the owner
- The owner is not a programmer. Explain every decision and result in **plain English**, with short sentences and no jargon (or jargon explained).
- **Ask before installing any software**, including Python packages, browsers, Node.js and system tools. Name what it is, why it's needed and roughly how big it is.
- Work in phases. After each phase:
  1. Verify it yourself: run the packager, open the viewer, and test each command.
  2. Commit.
  3. Show the result in the preview browser and say what to check.
  4. Stop and wait.
- Only call a phase "done" once you have actually run and checked it. If something failed or was skipped, say so.

## Saving rules
- Save everything in this local folder.
- Raw downloads (LiDAR or elevation rasters, GIS responses, imagery) go in `data/raw/<site-name>/`. That folder is in `.gitignore` and is **never pushed**, because it's too big.
- Finished site packages go in `sites/<site-name>/` and are committed. Each `.sitepkg.json` must stay under ~15 MB.
- Commit after each phase works, on branch `land-dev-app`. **Only push to GitHub when the owner says so.**

## Engineering rules
- **All engineering math is done by the app's own code**: areas, setbacks, grading cut and fill, parking counts, slopes. It is never estimated or guessed by Claude. In chat, Claude calls app commands and reports the app's numbers.
- Units go in names: `areaSf`, `lengthFt`, `elevFt`, `volumeCy`, `slopePct`.
- One coordinate system everywhere: **EPSG:2272**, NAD83 / Pennsylvania South, in US survey feet. Elevations are NAVD88 feet.
  - Convert metres to feet once, where the data comes in, using 1 m = 3937/1200 ftUS.
- **Never invent ordinance values.** Every zoning value carries its section and source. A value that isn't known stays empty and is listed as missing. Values from unofficial copies are marked `verified: false`.
- Every check result shows the value, the limit, the units, the ordinance section and a one-line plain-English message.
- Concept-level only. The viewer shows "Concept-level, not for construction".

## Data-fetching rules (packager)
- Try each public source **once**, with a timeout. Never loop on retries.
- A missing or failed source is reported in the summary and `fetch-report.json`; it doesn't crash the run. Exceptions are a missing parcel or missing terrain, without which there is no package.
- Ask the server to return EPSG:2272 directly wherever the service supports it.

## Viewer rules
- **Self-contained:** the built file `viewer/dist/land-viewer.html` loads nothing from other websites. That means no CDNs, web fonts or remote images.
- All changes to the design go through the command layer (`viewer/src/commands.js`). Test-mode buttons and chat tools call the same commands.
- Chat uses the Claude artifact **`sample`** capability, with the commands passed as `tools`. There is **no API key** anywhere in this project. Chat only works once the viewer is published as an artifact; test mode must always work locally.

## Handy commands
- Set up Python (one time, after the owner approves the installs): `setup.cmd`
- Make a package: `package "1625 Heilmandale Rd, North Lebanon Township, PA"`
- Build the viewer: `.venv\Scripts\python.exe viewer\build.py`
- Build the publish version: `.venv\Scripts\python.exe viewer\build.py --artifact --embed sites\1625-heilmandale-rd\1625-heilmandale-rd.sitepkg.json --out viewer\dist\land-viewer-published.html`
- Published viewer (private Claude artifact, capability `sample`): https://claude.ai/artifact/MnZnaVtaaEC33CiXJbL8Ek. Always republish to this same link; don't create a new one.
- Published pages can't use `alert()`/`confirm()`/`prompt()`. Use in-page messages (`LD.ui.toast`) and two-click confirmations instead.
