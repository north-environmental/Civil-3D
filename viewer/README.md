# Viewer: 3D site view with design commands

The viewer opens a site package (made by the packager) and shows it in 3D: ground, aerial photo, property line, setbacks, roads, streams and wetlands. You can place buildings and parking, set pad elevations, run grading, and check setbacks.

All the engineering math is done by the viewer's own code, whether you use the Test-mode buttons or chat with Claude.

## Open it

- **On this computer:** double-click `viewer/dist/land-viewer.html`. It opens in your browser and needs no internet.
- **Open a site:** click **Load site package** and choose a `.sitepkg.json` file from `sites/<site-name>/`.
- **Test mode:** tick **Test mode** (top right) to get a **Test** tab with:
  - one button and form for each command, pre-filled with sensible values;
  - **Run self-checks**, which checks the math against hand calculations.

### Moving around in 3D

- **Drag** to orbit.
- **Right-drag** or **Shift-drag** to pan.
- **Mouse wheel** to zoom.
- **Reset view** and **Top view** buttons are at the top left.
- **Aerial photo / Shaded relief** switches what's drawn on the ground.
- **Height x** exaggerates the hills so slopes are easier to see. Numbers are never exaggerated.

## The commands

These are exactly the tools Claude gets in the chat panel (Phase 4).

| Command | What it does | Main inputs |
|---|---|---|
| `addBuilding` | Adds a rectangular building, in the middle of the buildable area unless you give a position. Its floor starts at the average ground under it. | width, depth, height (ft), optional centre and rotation |
| `moveElement` | Moves or rotates a building or parking field. | id, shift east/north (ft) or a new centre, rotation |
| `setPadElevation` | Sets a building's finished floor, or a parking field's surface elevation at its centre. | id, elevation (ft, NAVD88) |
| `addParking` | Lays out a car parking field: 10 × 20 ft stalls, 24 ft aisles, landscape islands, and accessible stalls per the 2010 ADA table. | target stalls, next to a building (side), or rows / length / centre |
| `runGrading` | Works out earthwork on a 5 ft grid: cut, fill, net (CY), side slopes back to existing ground, retaining walls where slopes don't fit, and grading that crosses the property line. It can also find the floor elevation that balances cut and fill. | slope ratio (3:1), shrink (10%), optional building to balance |
| `checkSetbacks` | For every building and parking field, checks distance to each property line against the required setback, plus height and lot coverage, each with its ordinance section. | none |
| `getSiteSummary`, `listElements` | Read-only summaries; Claude uses these to see the current design. | none |

Every change appears under **Design → History** with an **Undo** button. Undoing a step also undoes the steps after it, and the viewer asks first.

### Where the math comes from

The grading engine, parking layout and accessible-stall table are ported from the earlier prototype (`groundwork/`), which was checked against hand calculations. Test mode's **Run self-checks** re-runs those checks in the browser:

| Check | What it tests |
|---|---|
| T1–T3 | Pad volumes |
| T4 | Retaining wall height |
| T5–T6 | Balancing the finished floor |
| T7 | Accessible stall counts |
| T9 | Parking module |
| S1–S2 | Setback distances |
| T13 | Unit conversion |

Grading assumptions (EFCG defaults, concept level):

| Assumption | Value |
|---|---|
| Building pad | 10 ft beyond the footprint |
| Slab section | 1.17 ft |
| Parking | 1.5% slope, with a 1.0 ft pavement section |
| Side slopes | 3:1 |
| Shrink | 10% |

## Build it (after changing the code)

The source files are in `viewer/src/`. To combine them into the single file:

```
.venv\Scripts\python.exe viewer\build.py
```

The build stops with an error if anything would load from another website. To build a site package into the page, so the published demo opens ready to go:

```
.venv\Scripts\python.exe viewer\build.py --embed sites\1625-heilmandale-rd\1625-heilmandale-rd.sitepkg.json
```

### Source files

| File | What it holds |
|---|---|
| `core.js` | Geometry and grid helpers |
| `grading.js` | Earthwork engine |
| `parking.js` | Parking layout and the ADA table |
| `site.js` | Reads a site package |
| `commands.js` | The command layer, setback checks and undo |
| `selfcheck.js` | Hand-calculation checks |
| `view3d.js` | 3D view (WebGL, no libraries) |
| `ui.js` | Page and test mode |
| `chat.js` | Claude chat panel (Phase 4) |

### Local testing tip

With the project's local web server running (`.claude/launch.json`, "local-files"), you can open a package directly:

`http://localhost:8765/viewer/dist/land-viewer.html?pkg=/sites/1625-heilmandale-rd/1625-heilmandale-rd.sitepkg.json`

## Limits (concept level)

- Buildings are rectangles. Parking fields are rectangular with 90° stalls.
- Grading is a single surface per pad or field. There are no drives, truck courts or stormwater basins yet.
- Setbacks are checked against property lines only. Wetlands are flagged, not enforced, and residential-district separation isn't checked.
- Results are only as good as the package data. See the Site tab's "Things to know".
