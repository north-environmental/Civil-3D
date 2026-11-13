/**
 * Industrial layout design defaults. Source for every value: docs/reference/engineering-criteria.md
 * ("Industrial layout defaults"). "EFCG default" = industry-typical planning assumption chosen for
 * this demo; each appears in the Assumptions list and is editable per scenario.
 */
export type CriterionMeta = { label: string; units: string; source: string };

export const LAYOUT_DEFAULTS = {
  /** EFCG default (industry typical 500–620 ft for 400k+ SF cross-docks). */
  crossDockDepthFt: 540,
  /** EFCG default (industry typical 300–400 ft). */
  rearLoadDepthFt: 340,
  /** EFCG default. Building height ≈ clear + 6 ft (≤ 75 ft per § 27-1003). */
  clearHeightFt: 40,
  /** EFCG default: roof structure + parapet above clear height. */
  roofAllowanceFt: 6,
  /** EFCG default (12–14 ft o.c. typical). */
  dockDoorSpacingFt: 12,
  /** EFCG default: keep ~50 ft clear of doors at each building corner. */
  dockCornerClearFt: 50,
  /** EFCG default: office area total, at the car-side corner(s). */
  officeSf: 10000,
  /** EFCG default: concrete dock apron depth. */
  dockApronFt: 60,
  /** EFCG default: truck maneuvering lane depth. */
  maneuverLaneFt: 70,
  /** Matches the § 27-1408 berth size (12 × 55 ft). */
  trailerStallWidthFt: 12,
  /** Matches the § 27-1408 berth size (12 × 55 ft). */
  trailerStallLengthFt: 55,
  /** EFCG default: two-way truck drive aisle (30–40 ft typical). */
  truckDriveWidthFt: 32,
  /** EFCG default: truck entrance curb return (≥ 50 ft for WB-67). */
  truckCurbReturnFt: 60,
  /**
   * EFCG default: truck entrance width at the street line. § 27-1407 caps a 3-lane driveway at 40 ft
   * and a 2-lane at 28 ft (tight for WB-67), so truck entrances use a 3-lane, 36 ft throat.
   */
  truckDrivewayWidthFt: 36,
  truckDrivewayLanes: 3,
  /** EFCG default: design stall 10 × 20 ft; equals the § 27-1402 minimum, which governs. */
  carStallWidthFt: 10,
  carStallLengthFt: 20,
  /** EFCG default: two-way 90° aisle 24 ft (≥ 20 ft per § 27-1407). */
  carAisleFt: 24,
  /** EFCG default: car drive aisle width. */
  carDriveWidthFt: 24,
  /** EFCG default: car entrance curb return (≥ 15 ft per § 27-1407). */
  carCurbReturnFt: 25,
  /** EFCG default: car entrance width at the street line, 2 lanes (20–28 ft per § 27-1407). */
  carDrivewayWidthFt: 24,
  carDrivewayLanes: 2,
  /** EFCG default: sidewalk along the office face, inside the 20 ft parking-to-building strip. */
  sidewalkFt: 6,
  /** EFCG default: landscape end island width at each end of a parking row (≥ 5 ft per § 27-1302). */
  parkingEndIslandFt: 10,
  /** EFCG default: one interior island per this many consecutive stalls (ordinance gives no spacing). */
  parkingIslandEveryStalls: 15,
  /** EFCG default: ADA access aisle width (≥ 60 in per 2010 ADA § 502.3). */
  adaAisleFt: 5,
  /** EFCG default: van access aisle width (96 in aisle with a 96 in+ space, 2010 ADA § 502.2). */
  adaVanAisleFt: 8,
  /**
   * EFCG default: clear strip between the building end wall and a truck drive that wraps the
   * building (10 ft pad overbuild + 12 ft for the 4 ft dock-height drop at 3:1 + 3 ft shoulder).
   */
  endDriveOffsetFt: 25,
  /** EFCG default: landscape separation kept between truck pavement and car pavement. */
  networkSeparationFt: 20,
  /** EFCG default: clearance kept between routed drives and the building wall. */
  buildingClearanceFt: 15,
} as const;

export type LayoutCriteria = { -readonly [K in keyof typeof LAYOUT_DEFAULTS]: number };

export const LAYOUT_META: Record<keyof LayoutCriteria, CriterionMeta> = {
  crossDockDepthFt: { label: 'Cross-dock building depth', units: 'ft', source: 'EFCG default (500–620 typical)' },
  rearLoadDepthFt: { label: 'Rear-load building depth', units: 'ft', source: 'EFCG default (300–400 typical)' },
  clearHeightFt: { label: 'Clear height', units: 'ft', source: 'EFCG default' },
  roofAllowanceFt: { label: 'Roof allowance above clear height', units: 'ft', source: 'EFCG default' },
  dockDoorSpacingFt: { label: 'Dock door spacing', units: 'ft o.c.', source: 'EFCG default (12–14 typical)' },
  dockCornerClearFt: { label: 'Door-free zone at building corners', units: 'ft', source: 'EFCG default' },
  officeSf: { label: 'Office area', units: 'SF', source: 'EFCG default' },
  dockApronFt: { label: 'Concrete dock apron', units: 'ft', source: 'EFCG default' },
  maneuverLaneFt: { label: 'Truck maneuvering lane', units: 'ft', source: 'EFCG default' },
  trailerStallWidthFt: { label: 'Trailer stall width', units: 'ft', source: 'Matches § 27-1408 berth (12 × 55 ft)' },
  trailerStallLengthFt: { label: 'Trailer stall length', units: 'ft', source: 'Matches § 27-1408 berth (12 × 55 ft)' },
  truckDriveWidthFt: { label: 'Truck drive aisle (two-way)', units: 'ft', source: 'EFCG default (30–40 typical)' },
  truckCurbReturnFt: { label: 'Truck entrance curb return', units: 'ft', source: 'EFCG default (≥ 50 ft for WB-67)' },
  truckDrivewayWidthFt: { label: 'Truck entrance width at street line', units: 'ft', source: 'EFCG default within § 27-1407 3-lane range (30–40 ft)' },
  truckDrivewayLanes: { label: 'Truck entrance lanes', units: 'lanes', source: 'EFCG default; § 27-1407 max 3 lanes' },
  carStallWidthFt: { label: 'Car stall width', units: 'ft', source: '§ 27-1402 minimum governs' },
  carStallLengthFt: { label: 'Car stall length', units: 'ft', source: '§ 27-1402 minimum governs' },
  carAisleFt: { label: 'Car aisle (two-way, 90°)', units: 'ft', source: 'EFCG default (≥ 20 ft per § 27-1407)' },
  carDriveWidthFt: { label: 'Car drive aisle', units: 'ft', source: 'EFCG default' },
  carCurbReturnFt: { label: 'Car entrance curb return', units: 'ft', source: 'EFCG default (≥ 15 ft per § 27-1407)' },
  carDrivewayWidthFt: { label: 'Car entrance width at street line', units: 'ft', source: 'EFCG default within § 27-1407 2-lane range (20–28 ft)' },
  carDrivewayLanes: { label: 'Car entrance lanes', units: 'lanes', source: 'EFCG default' },
  sidewalkFt: { label: 'Sidewalk along office face', units: 'ft', source: 'EFCG default' },
  parkingEndIslandFt: { label: 'Parking row end island width', units: 'ft', source: 'EFCG default (≥ 5 ft per § 27-1302)' },
  parkingIslandEveryStalls: { label: 'Interior island every N stalls', units: 'stalls', source: 'EFCG default (ordinance gives no spacing)' },
  adaAisleFt: { label: 'ADA access aisle', units: 'ft', source: '2010 ADA Standards § 502.3 (≥ 60 in)' },
  adaVanAisleFt: { label: 'ADA van access aisle', units: 'ft', source: '2010 ADA Standards § 502.2 (96 in aisle option)' },
  endDriveOffsetFt: { label: 'Truck end-drive offset from building', units: 'ft', source: 'EFCG default (overbuild + dock drop at 3:1)' },
  networkSeparationFt: { label: 'Truck/car pavement separation', units: 'ft', source: 'EFCG default' },
  buildingClearanceFt: { label: 'Drive clearance to building', units: 'ft', source: 'EFCG default' },
};

/** Default right-of-way widths when the source has none (flagged as assumed). SPEC §6.2. */
export const ROW_DEFAULT_FT = {
  /** EFCG assumption per SPEC §6.2: state route 60 ft. */
  state: 60,
  /** EFCG assumption per SPEC §6.2: local road 50 ft. */
  local: 50,
  private: 40,
  other: 50,
} as const;
