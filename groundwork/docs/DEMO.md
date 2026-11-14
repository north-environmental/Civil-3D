# Client demo script

A 12–15 minute walkthrough for AEC executives: Claude on one side of the screen, Groundwork in a browser on the other.
Everything runs offline from the cached fixture.

> **Say this up front.** The site data in this build is **synthetic** (the build sandbox had no access to the public
> data services). The parcel, roads, wetland and terrain are stand-ins shaped like the real 1625 Heilmandale Rd site;
> the zoning rules and citations are real extracts of the township code. With `npm run fetch-site-data` on a networked
> machine the same demo runs on real parcel, LiDAR and wetland data. Results are concept-level, not for construction.

## Before the audience arrives

1. `npm run dev` in the `groundwork` folder; open <http://localhost:4310> (dark theme, full screen, ~60% of the display).
2. Claude Desktop (or Claude Code) with the **groundwork** MCP server connected (`docs/MCP_SETUP.md`). Check that the tools appear.
3. Start clean: `npm run dev -- --fresh`, or just let step 1 below reload the site.
4. Optional dry run: click **▶ Demo** in the app. It replays this whole script through the same commands in about 40 seconds.

Tip: start the Claude conversation with the built-in prompt **groundwork_designer** so Claude follows the workflow and
cites sections.

## The script

Numbers below are what the committed synthetic fixture produces (they are asserted by the test suite). They will
change when real site data is fetched.

### 1. Load and read the site

> Load 1625 Heilmandale Rd in Groundwork and summarize the site: area, frontages, what's across each road, terrain and constraints.

**What happens:** the parcel, roads, zoning districts, wetland and contours appear; the Activity tab logs "Loaded 1625
Heilmandale Rd…". Claude should report **109.6 ac** in **I-1**; frontage on **Route 72** (east, 1,870 ft, commercial
across), **Heilmandale Rd** (north, 2,511 ft, residential across) and **Orange Ln** (west, 1,761 ft, residential
across); terrain **470–515 ft**, about 45 ft of relief, average slope ~1.9%, falling to the south; a **4.8 ac wetland**
on the south side; and that the data is synthetic.

### 2. Zoning, with citations

> Show me the I-1 rules that will shape this plan, with section numbers. Point out anything driven by the residential districts and any interpretation calls you had to make.

**What happens:** Claude calls `get_zoning_rules` (and may read `get_ordinance_text 27-1003`). Expect: 100 ft front yard,
**150 ft when across the street from residential** (Heilmandale Rd and Orange Ln), 20 ft side, 30 ft rear, **150 ft
building / 100 ft parking separation from a residential district** (§ 27-1003, § 27-1404.G), 50% coverage, 75 ft height,
loading berths per § 27-1408, driveway spacing 150 ft (§ 27-1407), 15% landscaping (§ 27-1304.1.A.1). Flags to listen for:
the "lot coverage" definition, the parking ratio for an unlisted warehouse use (items S / V / W of § 27-1405), and
rounding of loading berths (13 vs 12). In the browser: hover a dashed amber setback line to see the governing rule and
citation; open the **Zoning** tab.

### 3–5. Program, access and the test fit (the headline prompt)

> Fit a 410,000 SF cross-dock, 40 ft clear, with the long side parallel to Heilmandale Rd. Max out dock doors and get me at least 100 trailer stalls. Assume 300 employees on the largest shift and 520 across the two largest shifts, and log that as an assumption. Trucks come in from Route 72 and Heilmandale Rd, employee cars only from Orange Lane, and don't connect truck and car circulation.

**What happens:** `log_note`, `set_program`, three `set_access` calls, then `generate_layout` (well under a second). The plan
fills in: a **410,400 SF, 760 × 540 ft** building rotated **5.5°** to parallel Heilmandale Rd, truck courts north and south
(**110 dock doors, 126 trailer stalls**), **357 car stalls** (8 accessible, 2 van) on the west end by the office, a truck
drive from Route 72 and one from Heilmandale Rd, a separate car drive from Orange Ln, a **10.0 ac** stormwater reservation
and buffer plantings along the residential frontages. Claude should explain the solver's rationale (flat ground under the
pad, route lengths, the north truck court sits about 585 ft back from the Heilmandale Rd frontage, which has residential zoning across the street).

### 6. Checks

> Run all the checks. Fix anything that fails and tell me what's left.

**What happens:** `run_checks`: **0 failures**. One advisory warning (§ 27-1407 prefers one-way operation with multiple
driveways). Open the **Checks** tab; click a check to zoom to the object. Open **Yield**: coverage 8.6% (≤ 50%),
impervious 19.2%, landscaped 67%, 357 stalls vs 310 required (item S + W) and 350 under the stricter reading, 110 berths
vs 13 required. Good moment to ask Claude: *"Are truck and car circulation actually separate?"* (the check reports
0 SF of shared pavement).

### 7. Grade and balance

> Grade it and balance the earthwork. What's the finished floor, how much dirt moves, and are there any walls or offsite grading?

**What happens:** `grade_site` then `optimize_ffe`. Press **C** in the browser for the cut/fill map (red cut, blue fill)
and open the **Earthwork** tab. Expect **FFE 497.4 ft**, **cut ≈ 148,000 CY, fill ≈ 133,000 CY, net ≈ +800 CY** (0.3% of
the volume moved, inside the ±2% balance tolerance), feasible FFE **488.5–514.1 ft** set by the 6% limit on the Route 72
truck drive, **no retaining walls** (only the four dock wing walls at the building corners) and **no offsite grading**.
Follow-ups that show depth:

> Cut a section north–south through the building and show me.

> What happens to the balance if we can import 20,000 CY?

Press **S** and click two points to draw your own section; press **3** for the 3D view.

### 8. A second scenario

> Create scenario B with the building rotated 90° so it's parallel to Route 72, balance it, and compare A and B in a table.

**What happens:** `create_scenario`, `generate_layout {alignToRoad: "Route 72"}`, `optimize_ffe`, `compare_scenarios`.
B fits and balances (**FFE 499.4 ft**, ~320,000 CY moved vs ~281,000 CY for A) but **fails one zoning check**:
§ 27-1304.1.B.3.b requires a screen planting within 50 ft of any wall over 75 ft that faces west, and B's 760 ft
west-facing wall is a dock wall with a truck court in front of it. Claude should say that and offer options (rotate back,
or a rear-load building). Click **Compare** in the top bar for the side-by-side table.

Alternative B if you want a clean pass: *"Make scenario B a rear-load building instead and compare."*

### 9. Against the as-built

> Switch back to A, turn on the as-built reference and tell me how the test fit compares with what was built.

**What happens:** `switch_scenario`, `render_view` with the as-built layer (or press **B** in the browser). Talking points:
the built facility is 411,840 SF with about 10 ac of basins and the same three access points; the test fit lands within
0.4% of the building area and reserves a similar stormwater area. (The as-built outline in the synthetic fixture is
illustrative.)

### 10. Deliverables

> Export the DXF and the Excel summary, and list the assumptions behind these numbers.

**What happens:** `export` writes files to `exports/` (also under **Export ▾** in the app): an AutoCAD 2010 DXF in state
plane feet with AIA layers, and a workbook with Yield, Compliance (with citations), Earthwork and Assumptions sheets.
Try the 24 × 36 **plan sheet PNG** too.

## If something goes wrong

| Symptom | What to do |
|---|---|
| Claude says the app is not reachable | `npm run dev` is not running, or it is on another port (`GROUNDWORK_URL`). |
| The browser shows "offline" | The server stopped; restart it. The project is saved in `projects/` and restored. |
| A layout looks wrong | Ctrl+Z, or ask Claude to "undo that". Every change is a command with undo. |
| You want to start over | Click **▶ Demo**, or tell Claude "load the site again" (`load_site` starts a new project). |
| No image from `render_view` | `npx playwright install chromium` once. |

## Prompts for a longer session

- "Trailer parking is short for this tenant. Get me to 200 trailer stalls." (limiting factor + `add_trailer_field`)
- "Move the Heilmandale driveway 300 ft west and tell me what changes." (`edit_object stationFt`)
- "What if the tie-in slopes are 4:1 instead of 3:1?" (`set_grading_criteria`, then `optimize_ffe`)
- "Add a 60 ft utility easement along the south line and refit." (`add_constraint`, `generate_layout`)
- "Read § 27-1408 and check my loading berth count." (`get_ordinance_text`, `run_checks`)
- "Can a WB-67 make it in from Heilmandale Rd?" (`run_checks`: the swept-path check; turn on the **WB-67 swept path** layer)
- "Size the basin from runoff instead: assume a 3.2 inch design storm." (`set_program {stormwater: {method: "tr55", designStormIn: 3.2}}`; say that the storm depth is the user's number)
- "Check an accessible route from the ADA stalls to the office door." (`check_accessible_route`)
