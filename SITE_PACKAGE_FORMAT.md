# Site package format, version 1.0

A **site package** is everything the viewer needs to show one property: where it is, its boundary, its ground shape, what's around it, and what zoning allows. The **packager** writes it and the **viewer** reads it. Both follow this document exactly.

## 1. What's in a package folder

Each site gets its own folder: `sites/<site-name>/`. The site name is lower case with dashes, for example `sites/1625-heilmandale-rd/`.

| File | Who uses it | What it is |
|---|---|---|
| `<site-name>.sitepkg.json` | **Viewer** (this is the file you load) | The whole package in one file. **Must be under 15 MB** (15,000,000 bytes). |
| `summary.md` | People | A plain-English summary: what was found, what's missing, key numbers. |
| `fetch-report.json` | People and troubleshooting | Each data source tried: success or failure, how long it took, the error if any. |
| `preview.svg` | People | A quick map of the parcel, setback lines, contours and features. Opens in any browser. |

Raw downloads used to build the package (elevation rasters, GIS responses, photos) are kept in `data/raw/<site-name>/`. They are **not** part of the package and are never pushed to GitHub.

## 2. Ground rules for all data

- **Coordinate system:** EPSG:2272, which is NAD83 / Pennsylvania State Plane South Zone, in **US survey feet**.
  - Every x and y in the package is in this system.
  - x is the easting (grows to the east) and y is the northing (grows to the north).
  - The packager checked that this is the correct zone for Lebanon County, PA.
- **Elevations:** NAVD88, in **US survey feet**. Source data in metres is converted once, with 1 m = 3937/1200 ftUS.
- **Units in names:** every number's units are in its field name (`areaSf`, `lengthFt`, `heightFt`, `slopePct`). If they aren't, its object has a `units` field.
- **Dates:** ISO 8601. Use `"2026-11-15"` for a date and `"2026-11-15T15:03:00Z"` for a time. A data collection period can be a year or range, like `"2018-2020"`.
- **Shapes:**
  - **Point** = `[x, y]`.
  - **Line** = a list of points: `[[x, y], [x, y], ...]`.
  - **Ring** = a closed outline written as a list of points, with the first point **not** repeated at the end.
  - **Polygon** = `{"outer": Ring, "holes": [Ring, ...]}`. The outer ring is counter-clockwise; holes are clockwise. `holes` may be empty.
  - **MultiPolygon** = a list of Polygons.
- **Missing values** are `null`, never a made-up number. Say why in a nearby `note` or in `metadata.warnings`.

## 3. The `.sitepkg.json` file

It's one JSON object with these top-level parts:

```json
{
  "format": "efcg-site-package",
  "version": "1.0",
  "metadata": { ... },
  "crs": { ... },
  "parcel": { ... },
  "terrain": { ... },
  "features": { ... },
  "zoning": { ... },
  "derived": { ... },
  "imagery": { ... }
}
```

`imagery` is optional; every other part is required.

### 3.1 `metadata`: what this site is and where the data came from

| Field | Example | Meaning |
|---|---|---|
| `siteId` | `"1625-heilmandale-rd"` | Same as the folder name. |
| `siteName` | `"1625 Heilmandale Rd"` | Display name. |
| `address` | `"1625 Heilmandale Rd, Lebanon, PA 17046"` | Address as found. |
| `municipality` | `"North Lebanon Township"` | |
| `county` | `"Lebanon"` | |
| `state` | `"PA"` | |
| `parcelId` | `"27-2325148-379540-0000"` | County tax map number. |
| `createdAt` | `"2026-11-15T15:03:00Z"` | When the package was made. |
| `packagerVersion` | `"1.0.0"` | |
| `bufferFt` | `500` | How far beyond the parcel the data reaches. |
| `extent` | `{"xMinFt":..., "yMinFt":..., "xMaxFt":..., "yMaxFt":...}` | The rectangle the package covers: the parcel plus the buffer. |
| `sources` | list (below) | Every data source used. |
| `warnings` | list of strings | Plain-English caveats, e.g. "Zoning values are from an unofficial copy of the code. Verify with the township." |

Each entry in `sources` looks like this:

```json
{
  "id": "usgs-3dep",
  "name": "USGS 3D Elevation Program (3DEP) bare-earth DEM, LiDAR-derived",
  "url": "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer",
  "retrievedAt": "2026-11-15T15:01:00Z",
  "dataDate": "2017-2018",
  "notes": "Native 1 m resolution, resampled to 5 ft."
}
```

`dataDate` is when the data was **collected** (or last updated, for maps), if the source says. Otherwise it is `null`, with a note.

### 3.2 `crs`: coordinate system (fixed values in version 1.0)

```json
{
  "epsg": 2272,
  "name": "NAD83 / Pennsylvania South (ftUS)",
  "horizontalUnits": "US survey foot",
  "verticalDatum": "NAVD88",
  "verticalUnits": "US survey foot"
}
```

### 3.3 `parcel`: the property boundary

| Field | Meaning |
|---|---|
| `id` | County parcel ID (same as `metadata.parcelId`). |
| `polygon` | The boundary as a Polygon (section 2). |
| `areaSf`, `areaAc` | Area computed from the polygon (1 ac = 43,560 SF). |
| `recordAreaAc` | Deeded area from the county record, if given; otherwise `null`. |
| `edges` | One entry per side of the outer ring (below). |
| `source` | Source `id` from `metadata.sources`. |

Each edge goes from outer-ring point `i` to point `i+1`, with the last edge wrapping back to point 0:

```json
{ "index": 0, "lengthFt": 412.6, "type": "front", "road": "Heilmandale Rd", "rowInsetFt": 30 }
```

- `type` is one of the following:
  - `"front"`: the edge faces a road. The packager decides this from the road centerlines in `features.roads`.
  - `"rear"`: the edge is roughly opposite the front.
  - `"side"`: anything else.
- `road` is the road's name for a front edge, otherwise `null`.
- `rowInsetFt` is the distance from the property line to the assumed road right-of-way line, for front edges only. When the deed runs to the road centerline, this is half the assumed right-of-way width. Otherwise it is `0`.

### 3.4 `terrain`: the ground surface as an elevation grid

The ground is a regular grid of elevations, made from the LiDAR-derived bare-earth elevation model. Raw LiDAR points are not included.

| Field | Example | Meaning |
|---|---|---|
| `cellSizeFt` | `5` | Grid spacing. The packager picks the finest of 2.5, 5 or 10 ft that keeps the file under 15 MB. |
| `cols`, `rows` | `810`, `640` | Grid size. `cols` runs west to east, `rows` south to north. |
| `x0Ft`, `y0Ft` | `2322620`, `377430` | The **south-west corner** of the grid (the outer corner of the first cell, not its centre). |
| `minElevFt`, `maxElevFt` | `471.7`, `603.3` | Lowest and highest elevation on the grid. |
| `encoding` | `"uint16-scaled-base64"` | How the numbers are stored (below). |
| `offsetFt`, `scaleFt` | `471.7`, `0.002` | Used to turn stored numbers back into elevations. |
| `noData` | `65535` | Stored value meaning "no elevation here". |
| `data` | `"AAEC..."` | The stored numbers, as base64 text. |
| `source` | `"usgs-3dep"` | Source `id`. |
| `nativeResolution` | `"1 m"` | Resolution of the original data. |
| `preDevelopment` | `true` / `false` / `null` | Whether the ground appears to be before current construction. `null` if unknown. |

**How the grid is stored**
- Cell `(col, row)` has its centre at:
  - x = `x0Ft + (col + 0.5) × cellSizeFt`
  - y = `y0Ft + (row + 0.5) × cellSizeFt`
- **Row 0 is the southern edge**, and rows run from south to north.
- The values are listed row by row: index = `row × cols + col`.
- Each value is a 16-bit unsigned integer `q`, little-endian. All `rows × cols` values are packed together and then base64-encoded into `data`.
- Elevation in feet = `offsetFt + q × scaleFt`, unless `q == 65535`, which means no data.
- `scaleFt` is at most 0.01 ft, so stored elevations are accurate to about 1/100 ft. If a site's elevation range is too big for that (over ~655 ft), the packager uses a larger `scaleFt`, records it, and adds a warning.

### 3.5 `features`: what's already there

Each feature type is an object with a status and a list of items:

```json
"wetlands": {
  "status": "found",
  "reason": null,
  "source": "usfws-nwi",
  "items": [ ... ]
}
```

- `status` is one of the following:
  - `"found"`: there is at least one item.
  - `"none_found"`: the source worked but has nothing here.
  - `"failed"`: the source could not be reached or returned an error. `reason` says why.
  - `"skipped"`: not attempted. `reason` says why.
- `items` is always a list, possibly empty.

| Feature | Each item has |
|---|---|
| `roads` | `id`, `name`, `ref` (route number or `null`), `roadClass` (`"state"`, `"local"` or `"private"`), `centerline` (Line), `rowWidthFt`, `rowAssumed` (true if the width is an assumption) |
| `buildings` | `id`, `footprint` (Polygon), `heightFt` (or `null`) |
| `streams` | `id`, `name` (or `null`), `kind` (e.g. `"perennial"`, `"intermittent"`), `line` (Line) |
| `wetlands` | `id`, `wetlandType` (e.g. NWI code `"PEM1C"`), `polygon` (Polygon), `areaAc` |
| `floodplain` | `id`, `zone` (e.g. `"AE"`), `polygon` (Polygon) |

Features are clipped to `metadata.extent`.

### 3.6 `zoning`: what the rules allow (manual entry is fine)

```json
{
  "jurisdiction": "North Lebanon Township, Lebanon County, PA",
  "district": "I-1",
  "districtName": "Industrial",
  "codeName": "North Lebanon Township Code, Chapter 27 Zoning",
  "officialUrl": "https://ecode360.com/NO1608",
  "enteredFrom": "Zoneomics reproduction of the code, extract taken 2026-11-13",
  "verified": false,
  "values": {
    "frontSetbackFt":            { "value": 100, "section": "27-1003", "note": "From road right-of-way. 150 ft when across the street from a residential district." },
    "sideSetbackFt":             { "value": 20,  "section": "27-1003" },
    "rearSetbackFt":             { "value": 30,  "section": "27-1003" },
    "residentialSeparationFt":   { "value": 150, "section": "27-1003" },
    "maxHeightFt":               { "value": 75,  "section": "27-1003" },
    "maxLotCoveragePct":         { "value": 50,  "section": "27-1003" },
    "minLotAreaAc":              { "value": 2,   "section": "27-1003" },
    "minLotWidthFt":             { "value": 200, "section": "27-1003" },
    "minLandscapedPct":          { "value": 15,  "section": "27-1304" },
    "parkingSetbackFromRowFt":   { "value": 25,  "section": "27-1404" },
    "parkingSetbackSideRearFt":  { "value": 10,  "section": "27-1404" },
    "stallWidthFt":              { "value": 10,  "section": "27-1402" },
    "stallLengthFt":             { "value": 20,  "section": "27-1402" },
    "aisleWidthFt":              { "value": 20,  "section": "27-1407" },
    "maxParkingGradePct":        { "value": 4,   "section": "27-1410" }
  },
  "parkingRatios": [
    { "use": "Manufacturing / other industrial", "rule": "1 space per employee on the largest shift", "section": "27-1405 V" },
    { "use": "Office", "rule": "1 space per 200 SF of office floor area", "section": "27-1405 W" }
  ]
}
```

- **Required keys in `values`:**
  - `frontSetbackFt`, `sideSetbackFt` and `rearSetbackFt`
  - `maxHeightFt` and `maxLotCoveragePct`
  - `stallWidthFt` and `stallLengthFt`

  Any of them may have `"value": null` if unknown, but the key must be there. The others are optional.
- **Each value** is `{"value", "section", "note"?, "source"?}`. `section` is the ordinance section, or `null` for an EFCG default; in that case `note` must say "EFCG default assumption".
- `verified` is `true` only when someone has checked the values against the official adopted code.

### 3.7 `derived`: computed by the packager so the viewer doesn't have to

| Field | Meaning |
|---|---|
| `buildingEnvelope` | MultiPolygon: where a building may go. This is the parcel minus each edge's yard setback, measured from the right-of-way line for front edges. |
| `parkingEnvelope` | MultiPolygon: where parking may go. This is the parcel minus the parking setbacks. |
| `buildingEnvelopeAreaAc`, `parkingEnvelopeAreaAc` | Their areas. |
| `setbackLines` | One entry per parcel edge: `{edgeIndex, type, buildingSetbackFt, parkingSetbackFt, section}`. This lets the viewer explain each line. |
| `method` | A one-sentence description of how the envelopes were made. |

Version 1.0 envelopes use only parcel-edge setbacks. Wetland buffers and residential-district separations aren't subtracted; they are listed in `metadata.warnings`.

### 3.8 `imagery` (optional): one aerial photo laid over the ground

```json
{
  "mime": "image/jpeg",
  "xMinFt": 2322620, "yMinFt": 377430, "xMaxFt": 2326670, "yMaxFt": 380630,
  "widthPx": 2025, "heightPx": 1600,
  "source": "pema-2018",
  "dataDate": "2018-2020",
  "data": "/9j/4AAQ..."
}
```

- The photo is north-up and exactly covers the rectangle given.
- `data` is the JPEG, base64-encoded.
- The packager only includes it if the whole file still fits under 15 MB. Otherwise it is left out, with a warning.

## 4. Validation: a package is valid only if

1. `format` is `"efcg-site-package"` and `version` starts with `"1."`.
2. All required parts and fields listed above are present.
3. `crs.epsg` is 2272.
4. The parcel's outer ring has at least 3 points, a non-zero area, and doesn't cross itself. `areaAc` matches the polygon within 0.1%.
5. Every x and y (parcel, features, envelopes) falls inside `metadata.extent`. The extent itself must be plausible for PA South: x between 1,100,000 and 2,900,000, y between 100,000 and 600,000.
6. Terrain:
   - `data` decodes to exactly `rows × cols` values.
   - `cellSizeFt` is greater than 0.
   - The grid covers the whole parcel.
   - At least 95% of the cells inside the parcel have data.
   - Elevations are between -100 and 4,000 ft.
7. Each feature type has a valid `status`. If the status is `"found"`, `items` is not empty.
8. Every zoning value has a `section` or a `note`.
9. The `.sitepkg.json` file is under 15,000,000 bytes.

The packager checks all of this before saving and refuses to save an invalid package. The viewer re-checks rules 1–3, 6 (decoding) and 9 when loading. It shows a plain-English message if the package is invalid.

## 5. Changing the format later

- **Adding an optional field** doesn't break anything: bump the minor version (1.0 → 1.1). The viewer ignores fields it doesn't know.
- **Renaming, removing or changing** the meaning of a field is a breaking change: bump the major version (1.x → 2.0). Update the packager and viewer together.
- Always update this document first.
