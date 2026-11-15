# Packager: how to make a site package

The packager gathers free public data for one property and saves it as a **site package** that the 3D viewer can open. What's inside a package is described in [SITE_PACKAGE_FORMAT.md](../SITE_PACKAGE_FORMAT.md).

## One-time setup

In the project folder, run:

```
setup.cmd
```

This creates a private Python environment for this project (the `.venv` folder, about 75 MB) and installs three free add-ons:

- **numpy**: grid math
- **shapely**: property lines and setbacks
- **tifffile**: reads the USGS elevation file

Nothing else on your computer changes.

## Make a package

From the project folder (in PowerShell, put `.\` in front: `.\package ...`):

```
package "1625 Heilmandale Rd, North Lebanon Township, PA"
```

Or use a short name saved in `packager/sites.json`:

```
package heilmandale
```

It takes about a minute. When it finishes, it prints a plain-English summary and saves:

| File | What it is |
|---|---|
| `sites/<site-name>/<site-name>.sitepkg.json` | The package. Open this in the viewer. |
| `sites/<site-name>/summary.md` | The same summary that was printed. |
| `sites/<site-name>/preview.svg` | A quick map. Double-click it to open it in a browser. |
| `sites/<site-name>/fetch-report.json` | Each data source tried, whether it worked, and how long it took. |
| `data/raw/<site-name>/` | The raw downloads. This folder is never pushed to GitHub. |

Running it again for the same site replaces the old package.

### Options

| Option | What it does |
|---|---|
| `--name heilmandale` | Choose the folder name. By default it comes from the street address, e.g. `1625-heilmandale-rd`. |
| `--buffer-ft 800` | Gather data farther beyond the property line. The default is 500 ft. |
| `--district I-1` | Set the zoning district by hand, when the zoning map can't tell. |
| `--imagery naip` | Use the newer USDA aerial photo instead of the 2018–2020 PEMA one. `--imagery none` leaves the photo out. |
| `--max-mb 10` | Aim for a smaller package. The default target is 14 MB; the hard limit is 15 MB. |

## What it does, step by step

1. **Finds the address** with the US Census geocoder. This also gives the county and township.
2. **Gets the property boundary** from the county's public parcel map, matched by street address. If that fails, it uses the parcel under the address point.
3. **Downloads and clips** everything to the parcel plus the buffer. Every server is asked to return PA State Plane South coordinates in US survey feet (EPSG:2272):
   - **Ground surface:** USGS 3DEP elevation, made from LiDAR. Also the USGS index of which LiDAR surveys cover the site, and when they were flown.
   - **Roads:** the county's road centerlines. OpenStreetMap is the fallback.
   - **Existing buildings:** OpenStreetMap.
   - **Streams:** the USGS National Hydrography Dataset.
   - **Wetlands:** the USFWS National Wetlands Inventory.
   - **Floodplain:** the FEMA flood map.
   - **Aerial photo:** PEMA 2018–2020 or USDA NAIP.
4. **Makes the terrain grid.** It picks the finest of 3, 5 or 10 ft spacing that keeps the package small, and fills tiny gaps.
5. **Adds zoning.** It looks up the district on the township's zoning map, then reads the values entered by hand in `packager/zoning/<township>.json`. It works out which lot lines are front, side and rear, and draws the setback lines.
6. **Checks** the package against every rule in SITE_PACKAGE_FORMAT.md. It refuses to save a package that fails.
7. **Prints a summary**, including anything it couldn't find.

Each source is tried **once**, with a time limit. If one doesn't answer, the package is still made, and the summary says what's missing. Only two things stop the run: no property boundary, or no ground surface.

## Known limits

- **Parcels:** only Lebanon County, PA is set up so far. To add a county, find its public ArcGIS parcel layer and add an entry to `COUNTIES` in `packager/sources.py`. The Lebanon entry is the example. Without one, the packager stops with "no parcel data source is set up for … County".
- **Zoning:**
  - Values are always **entered by hand**. Only North Lebanon Township district I-1 is filled in so far, from an unofficial copy of the code, and is marked "not verified".
  - For a new township, copy `packager/zoning/north-lebanon-township.json`, rename it after the township (e.g. `south-lebanon-township.json`), and fill in the values with their ordinance sections. Leave anything unknown as `null`; never guess.
- **Setbacks:** the buildable area subtracts only lot-line setbacks. Wetlands, floodplain and the 150 ft residential separation are listed as warnings, not cut out.
- **Right-of-way:** road right-of-way widths are assumed (state 60 ft, local 50 ft).
- **Terrain date:** when two LiDAR surveys cover a site, USGS doesn't say which one its combined surface used.
  - Heilmandale has surveys from 2017 and 2024.
  - Its ground shows **no building pad**, and it matches the elevation grid the earlier prototype downloaded. That suggests the pre-construction survey.
- **Unreliable sources** (on their side, not ours):
  - **FEMA flood map:** timed out on every attempt on 2026-11-15.
  - **OpenStreetMap:** answers slowly or not at all at times, and has few buildings mapped around Heilmandale.

  Run the packager again later to pick them up.

## For developers

- **Code layout:**
  - `__main__.py` runs the steps.
  - `sources.py` has one function per data source.
  - `geometry.py` holds lot-line types and setback areas.
  - `terrain.py` makes the grid and stores it compactly.
  - `zoning_rules.py` finds the district and reads its values.
  - `validate.py` checks a package against the format.
  - `summary.py` writes the plain-English summary.
  - `preview.py` draws the SVG map.
  - `projection.py` converts longitude/latitude to state-plane feet. Only OpenStreetMap needs it.
- **Test a failing source:** `package heilmandale --name test --simulate-failure streams,wetlands` pretends those sources failed. Delete `sites/test` afterwards.
