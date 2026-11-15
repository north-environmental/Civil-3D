# Limitations (honest list)

Groundwork is a concept-level planning demo. Nothing it produces is for construction, permitting or bidding.

## Data in this build

The demo site now uses real public GIS data (fetched 2026-11-15, cached in `data/sites/heilmandale/`; sources in
`provenance.json` and in the app's "where the site data comes from" dialog). What that data is not:

- **The parcel is county tax-map linework, not a boundary survey.** It is the 2017 county snapshot of the 110.35 ac
  tract (before development), simplified from 434 to 47 vertices with a 1 ft tolerance.
- **Right-of-way widths are assumed** (60 ft state route, 50 ft local street). Along Heilmandale Rd the lot runs to
  the road centerline, so every street setback there is measured from a right-of-way line assumed 30 ft inside the
  lot line. A recorded or ultimate right-of-way wider than 60 ft would move the front yard further in.
- **Lot area is the gross deeded area**, including the part inside the Heilmandale Rd right-of-way. Coverage and
  landscaping percentages use it. The ordinance's definition of lot area was not checked.
- **Orange Ln runs just inside the east lot line** in the county data; it is treated as frontage. Whether it is a
  public street, and its right-of-way, were not verified.
- **Wetlands are NWI planning-level mapping**, not a field delineation. The 25 ft buffer is an EFCG assumption.
- **No floodplain layer.** The FEMA flood hazard service timed out when the fixture was built. The township zoning
  map shows flood zone A along streams away from the lot, but that was not checked against FEMA.
- **Zoning districts were digitized from the township's 2023 zoning map PDF** by colour classification and matched to
  the parcel (`scripts/digitize-zoning-map.py`): about ±10 ft plus the map's own generalization. Neighbouring
  districts are stretched up to 30 ft to meet the lot line. The map labels the district "I"; the rule set calls it I-1.
- **Roads come from the county centerline layer**, because OpenStreetMap was unreachable. There is therefore no
  as-built building outline; the as-built comparison is the latest aerial photo.
- **Terrain is USGS 3DEP resampled to 5 ft cells.** It was judged pre-construction by looking at a hillshade (no
  building pad); the collection date was not read from metadata.
- **The aerials are cached at 1 ft (2018–2020) and 2 ft (latest) per pixel** for the lot plus 800 ft. Outside that
  the plan background is blank. Aerial dates are the service's collection range, not an exact flight date.
- **Only this one site can be loaded.** The fetch script is written for Lebanon County, PA sources and one address.
- **Ordinance text is an extract.** `get_ordinance_text` returns the reference document's extracts (flagged
  `verbatim: false`), not the official eCode360 wording (eCode360 refuses automated access). Values were not
  reconciled against the official code or later amendments (e.g. Ord. 2-2023). The definition of "lot coverage"
  (§ 27-102) is unresolved; both readings are shown.
- **SALDO and the stormwater ordinance were not mined.** Driveway landing grades, drive grades and curb standards are
  EFCG defaults marked "verify vs SALDO".

## Chat panel

- With Claude Code installed the chat is Claude; without it, a pattern-matching parser that handles common phrasings
  only (see `docs/CHAT.md`). The parser does not guess: unknown requests get a "here is what I understand" reply.
- The Claude engine was tested end to end on Linux only. Starting `claude` on Windows goes through the shell and is
  untested.
- Claude's replies are not checked by the app. The numbers it quotes come from tool results, but its wording and any
  advice are its own.
- The plan image PNG is drawn by the browser at 3,600 px wide; it is a picture of the plan, not a scaled drawing.

## Layout on the real lot

- The solver was tuned on the synthetic site. On the real lot it places the stormwater reservation by lowest free
  ground without regard to tree cover, and the building footprint (760 × 540 ft) is squarer than the built facility.
- Grading on the real terrain runs (about 200,000 CY of cut for the headline scenario, balanced) but was not reviewed
  in this pass. About 3,700 SF of grading falls outside the lot line along the road frontage and is reported as a
  warning.
- The "Zoning" tab lists Orange Ln as 527 ft of frontage (all edges on the road); commands report the longest
  continuous run, 402 ft.

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
- The 24 × 36 PNG sheet is a screenshot at 75 dpi, not a plotted drawing, and needs a local Chromium.

## App and MCP

- Single project, single user, no authentication: run it on localhost only.
- `render_view`, section images and the PNG sheet need a local Chromium (`npx playwright install chromium`).
- The server recomputes yields, checks and grading after every change; very large sites or 1 ft grids will be slow.
- Tool results are kept compact; geometry is available through exports, not tool calls.

## Stretch items: what was built and what was not

Built after Phase 7 (each with caveats):

- **WB-67 swept path** (`checks/sweptPath.ts`, layer "WB-67 swept path"): kinematic tractor–semitrailer model along each
  truck drive, in and out, reported as a pass / warn check. The vehicle dimensions (4.0 + 19.5 + 45.5 + 4.5 = 73.5 ft,
  8.5 ft wide) were entered from memory of the AASHTO table and **not verified**. The turn from the street into the
  driveway and the turns inside the truck court are not modeled (the last ~85 ft at the court is excluded).
- **Runoff-based basin sizing** (`stormwater.method = "tr55"`): NRCS curve-number runoff increase for a 24-hour design
  storm. The storm depth default (3.0 in) is a **placeholder**; supply the NOAA Atlas 14 value. Curve numbers (71 / 74 / 98,
  HSG C) are from memory of TR-55 Table 2-2 and unverified. It sizes volume only: no routing, peak-rate control or
  water-quality volume. The rational method is not implemented.
- **Accessible-route check** (`check_accessible_route`, command / MCP only): running and cross slopes along a drawn
  route with ramp and 30 in rise classification. Check only: no "fix" that solves spot elevations, no landing layout,
  no UI drawing tool.
- **Second jurisdiction**: demonstrated by a unit test that loads a site with no built-in rule set, proposes a fictional
  rule set through `set_zoning_rules`, confirms it and gets envelopes and checks from it. No second real ordinance was
  ingested (no network).

Not built: multi-building layouts, residential subdivision mode, the rational method, the accessible-route "fix".
