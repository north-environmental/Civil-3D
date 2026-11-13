# Demo site: 1625 Heilmandale Rd, North Lebanon Township, Lebanon County, PA

## Known facts (public record)
Source: North Lebanon Township Planning Commission minutes, August 10, 2020 (`https://northlebanontwppa.gov/wp-content/uploads/2021/12/2020-08-PC-Minutes.pdf`), and LebTown, 2021-08-31 (`https://lebtown.com/2021/08/31/readers-images-show-progress-of-new-walmart-warehouse-in-n-lebanon-twp/`).

- "Project TV (Heilmandale Project)", developer Transwestern, tenant later revealed as Walmart; civil engineer Kimley-Horn.
- About **110 acres**, the former Hershey Bare tract.
- **411,840 SF** distribution center, **40 ft** tall (minutes). LebTown reports 412,000 SF.
- Zoning: **Industrial (I-1)**. Surroundings per the minutes:
  - **residential to the north and west**
  - agricultural to the south and along Route 72
  - commercial across Route 72

  Verify with the 2023 zoning map.
- **Access:**
  - Trucks from **Route 72** and **Heilmandale Rd** (new traffic signal at Route 72 / Heilmandale Rd; PennDOT HOP applied).
  - **Employee-only drive off Orange Lane**; employees may also use Heilmandale Rd.
  - The Planning Commission chair asked the engineer to consider another truck entrance.
- **Stormwater:** ponds/basins on the west and south sides plus an east pond near employee parking, about **10 ac** of surface area in total. NPDES permit filed with PA DEP.
- **Wetlands:** about **4.5–5 ac on the south side**, not to be disturbed.
- Built 2020–2021; operating by ~end of 2021.

These facts make a good **as-built comparison** and calibration target. Note the parallels to the headline scenario: separate truck and employee access, residential to the N/W, wetlands to the S.

## Data plan (see SPEC §6)
| Layer | Primary source | Fallback |
|---|---|---|
| Parcel + neighbors | PASDA `PA_Parcels` MapServer layer 1 (statewide, PIN field) | Lebanon County ArcGIS Online property viewer services; then digitize (~110 ac) |
| Roads + names | OSM Overpass | Digitize from imagery |
| As-built footprint | OSM `building=*` | Digitize from imagery |
| Terrain | USGS 3DEP ImageServer (verify pre-2020 collection) | PASDA PA South Central 2017/2018 QL2 or PAMAP 2006–2008 DEM; then synthetic |
| Imagery | USGS National Map `USGSImageryOnly` tiles | none (plain background) |
| Wetlands | USFWS NWI REST | Manual polygon (~5 ac, south side), flagged |
| Floodplain | FEMA NFHL REST | Lebanon County floodplain viewer services |
| Zoning districts | Digitize from the 2023 township zoning map PDF | Use the minutes' description, flagged |
| Ordinance text | eCode360 NO1608 | Zoneomics mirror; then `zoning-north-lebanon-I1.md` |

## Geocoding
Use the US Census geocoder (`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=...&benchmark=Public_AR_Current&format=json`) or Nominatim (respect the usage policy, set a User-Agent). Cache the result in the fixture.

## Synthetic fallback (only if no network)
- ~110 ac irregular parcel (roughly 2,400 × 2,000 ft).
- Route 72 along the east edge, Heilmandale Rd along the north edge, Orange Ln along the west edge.
- Terrain with ~40 ft of relief draining south toward a ~5 ac wetland polygon.
- Label everything "SYNTHETIC". The road layout here is a guess for fallback purposes only. Replace it with real geometry as soon as any network source works.
