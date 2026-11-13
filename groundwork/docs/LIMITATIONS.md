# Limitations (honest list)

Groundwork is a concept-level planning demo. Nothing it produces is for construction, permitting or bidding.

## Data in this build

- **The committed site fixture is synthetic.** The build sandbox's network policy refused every data host (HTTP 403 at
  the egress proxy; each was tried once). Parcel shape, road layout, district polygons, wetland and terrain are generated
  stand-ins (see `data/sites/heilmandale/provenance.json`). Do not present them as the real site.
- **The live fetch (`npm run fetch-site-data`) has never run against the real services.** The adapters in
  `packages/data/src/live.ts` follow the endpoints in the spec and standard ArcGIS REST / Overpass conventions, but
  field names, layer ids (e.g. NFHL layer 28, NWI layer 0) and response shapes are unverified. Expect to fix small things
  the first time it runs.
- **Pre-development terrain check is only a warning.** If the 3DEP DEM is flat under the as-built footprint the script
  flags it and marks the terrain as not pre-development; it does not automatically select a pre-2020 LiDAR collection
  (PAMAP 2006–2008 or the 2017/2018 QL2 projects). That selection is manual.
- **Zoning districts are not digitized from the township map.** They follow the 2020 Planning Commission minutes
  (residential N and W, agricultural S, commercial across Route 72) with generic codes (RES / AG / COM). District
  boundaries along streets are assumed at the centerline.
- **Ordinance text is an extract.** `get_ordinance_text` returns the reference document's extracts (flagged
  `verbatim: false`), not the official eCode360 wording. Values were not reconciled against the official code or later
  amendments (e.g. Ord. 2-2023). The definition of "lot coverage" (§ 27-102) is unresolved; both readings are shown.
- **SALDO and the stormwater ordinance were not mined.** Driveway landing grades, drive grades and curb standards are
  EFCG defaults marked "verify vs SALDO".
- **Imagery is absent** in the synthetic fixture; the tile-drawing code path is untested.
- **Right-of-way widths** are class defaults (60 ft state, 50 ft local), flagged as assumed.

## Zoning engine

- Yard strips use square caps, which is slightly conservative at reflex (inside) corners.
- Front / side / rear classification is heuristic on unusual lots; `set_edge_class` overrides it.
- Checks for buffer plant material, tree counts, signage, lighting, noise and use conditions are not modeled.
- No fire-code or fire-apparatus access check (no code section was provided). The emergency network exists but nothing
  requires it.
- Proposed (unconfirmed) rules never override confirmed rules with the same key.

## Layout engine

- One rectangular building per scenario (no multi-building, L-shapes, mezzanines or building steps).
- Truck courts are rectangles the length of the building; cross-dock courts dead-end at the car side and are linked by
  one end drive. There is no perimeter truck loop, guard house, scale or queuing analysis.
- Drives are routed by grid A* (10 ft cells) and buffered; there are no design-vehicle swept paths (WB-67 is a stretch
  item), no curb-return geometry beyond a drawn flare, and no sight-distance or turn-lane warrants.
- Car parking is a single field of 90° rows on the car side (plus manual fields). ADA stalls are sized and counted;
  the accessible route to the entrance is not designed.
- The stormwater reservation is an area rule (9% of the parcel by default) placed as up to three rectangles on the
  lowest free ground. It is **not** a hydrologic or hydraulic design; no outfall, infiltration or water-quality check.
- The solver is a scored search, not an optimizer; weights are EFCG judgment (see DECISIONS.md).
- Landscape areas are strips reserved for planting; no plant schedule.

## Grading engine

- Raster, concept-level: planar objects on a 5 ft (interactive) or 2 ft (report) grid. No curb and gutter, inlets,
  swales, spot-grade design, vertical curves or ADA route grading.
- Drives have a single linear profile from the road tie-in to the object they serve; the 4% landing near the
  right-of-way is checked as a warning, not designed.
- Parking planes fall away from the building at one slope; the stretch item "optimize parking offsets" is not built.
- The tie-in reach assumes natural ground flatter than about 14% beside graded objects; on steeper ground long catch
  slopes can be under-reported.
- Retaining walls are detected and measured (length ≈ half the contact length), not designed. Dock wing walls at
  building corners are reported separately.
- Basins are graded as a rectangle with 3:1 interior slopes; the berm top defaults to median existing ground. Berm top
  width, spillways and embankment design are not modeled.
- Earthwork is cut/fill to subgrade with a single shrink factor. No rock, no unsuitable soils, no phasing, no haul.
  Topsoil stripping is reported separately and not included in the net.
- "Balanced" means net within ±2% of total movement at an FFE rounded to 0.1 ft.

## Exports

- The DXF (AutoCAD 2010, AC1024) is validated by parsing it back with `dxf-parser`. It has **not** been opened in
  AutoCAD or Civil 3D in this sandbox. It omits LAYOUT objects; if AutoCAD refuses it, use `RECOVER` or import through
  a DXF-tolerant tool. Text is single-line ASCII.
- GeoJSON is reprojected with proj4 from EPSG:2272; no datum grid shifts.
- The PNG sheet is a screenshot at 75 dpi, not a plotted drawing.

## App and MCP

- Single project, single user, no authentication: run it on localhost only.
- `render_view`, section images and the PNG sheet need a local Chromium (`npx playwright install chromium`).
- The server recomputes yields, checks and grading after every change; very large sites or 1 ft grids will be slow.
- Tool results are kept compact; geometry is available through exports, not tool calls.

## Not built (stretch list)

Rational-method / TR-55 runoff sizing, WB-67 swept paths, multi-building layouts, a second jurisdiction through the
ordinance-ingestion flow, residential subdivision mode, and the ADA accessible-route tool. Anything completed after
Phase 7 is listed in PROGRESS.md.
