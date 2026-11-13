/**
 * Grading defaults. Source for every value: docs/reference/engineering-criteria.md ("Grading defaults").
 */
import type { CriterionMeta } from './layout';

export const GRADING_DEFAULTS = {
  /** Tie-in (daylight) slope, horizontal:1 vertical. 3:1 max. */
  tieInSlopeHtoV: 3,
  /** Warn when lawn slopes are steeper than this H:V (4:1 preferred for mowing). */
  preferredTieInSlopeHtoV: 4,
  /** FFE to truck court at the dock face (48 in typical). */
  dockHeightFt: 4.0,
  /** Building pad overbuild beyond the footprint. */
  padOverbuildFt: 10,
  /** Truck court slope away from the building (apron 1.0–2.0 %, maneuvering ≤ 3.0 %). */
  truckCourtSlopePct: 1.5,
  truckCourtMinSlopePct: 1.0,
  truckApronMaxSlopePct: 2.0,
  truckCourtMaxSlopePct: 3.0,
  /** Parking field design slope. Kept ≤ 1.5 % so ADA stalls pass with construction tolerance. */
  parkingSlopePct: 1.5,
  /** Min 1.0 % for asphalt drainage (EFCG default). */
  parkingMinSlopePct: 1.0,
  /** Max 4 % per § 27-1410. */
  parkingMaxSlopePct: 4.0,
  /** Code max 1:48 = 2.0833 % (2010 ADA Standards § 502.4). */
  adaMaxSlopePct: 100 / 48,
  /** Design target for ADA stalls and aisles. */
  adaDesignSlopePct: 2.0,
  /** Parking anchor at the building: sidewalk elevation = FFE − 0.5 ft (SPEC §5.3). */
  parkingAnchorBelowFfeFt: 0.5,
  /** Truck drive max grade (EFCG default; verify vs SALDO). */
  truckDriveMaxGradePct: 6,
  /** Car drive max grade (EFCG default; verify vs SALDO). */
  carDriveMaxGradePct: 8,
  /** Max grade within the landing at the ROW (EFCG default; verify vs SALDO). */
  landingMaxGradePct: 4,
  landingLengthFt: 50,
  /** Drive cross slope. */
  driveCrossSlopePct: 2,
  /** Minimum grass slope. */
  minGrassSlopePct: 2,
  /** Finished grade → subgrade: building slab (8 in concrete + 6 in stone). */
  sectionBuildingSlabFt: 1.17,
  /** Concrete dock apron section. */
  sectionDockApronFt: 1.33,
  /** Heavy-duty asphalt (truck) section. */
  sectionHeavyAsphaltFt: 1.5,
  /** Standard-duty asphalt (car) section. */
  sectionStandardAsphaltFt: 1.0,
  /** Sidewalk section. */
  sectionSidewalkFt: 0.67,
  /** Topsoil strip depth over the disturbed area; reported separately, assumed reused on site. */
  topsoilStripFt: 0.5,
  /** Shrink factor on cut, percent: net = cut × (1 − shrink) − fill. */
  shrinkPct: 10,
  /** Interactive grid cell. */
  gridCellFt: 5,
  /** Report grid cell. */
  reportGridCellFt: 2,
  /** |proposed − existing| beyond this outside the parcel counts as offsite grading. */
  offsiteToleranceFt: 0.1,
  /** Walls lower than this are ignored as curbs/kneewalls (EFCG default). */
  minWallHeightFt: 1.0,
  /** Basin interior side slope H:V (planning-level). */
  basinSideSlopeHtoV: 3,
} as const;

export type GradingCriteria = { -readonly [K in keyof typeof GRADING_DEFAULTS]: number };

const EC = 'engineering-criteria.md';
export const GRADING_META: Record<keyof GradingCriteria, CriterionMeta> = {
  tieInSlopeHtoV: { label: 'Tie-in (daylight) slope', units: 'H:1V', source: `EFCG default, 3:1 max (${EC})` },
  preferredTieInSlopeHtoV: { label: 'Preferred lawn slope', units: 'H:1V', source: `EFCG default, 4:1 for mowing (${EC})` },
  dockHeightFt: { label: 'Dock height (FFE to truck court)', units: 'ft', source: 'EFCG default (48 in typical)' },
  padOverbuildFt: { label: 'Building pad overbuild', units: 'ft', source: 'EFCG default' },
  truckCourtSlopePct: { label: 'Truck court slope away from building', units: '%', source: 'EFCG default (apron 1–2 %, maneuvering ≤ 3 %)' },
  truckCourtMinSlopePct: { label: 'Truck court min slope', units: '%', source: 'EFCG default' },
  truckApronMaxSlopePct: { label: 'Dock apron max slope', units: '%', source: 'EFCG default' },
  truckCourtMaxSlopePct: { label: 'Maneuvering area max slope', units: '%', source: 'EFCG default' },
  parkingSlopePct: { label: 'Parking field slope', units: '%', source: 'EFCG default (1.0–4.0 % allowed)' },
  parkingMinSlopePct: { label: 'Parking min slope', units: '%', source: 'EFCG default (asphalt drainage)' },
  parkingMaxSlopePct: { label: 'Parking max slope', units: '%', source: '§ 27-1410' },
  adaMaxSlopePct: { label: 'ADA stall/aisle max slope', units: '%', source: '2010 ADA Standards § 502.4 (1:48)' },
  adaDesignSlopePct: { label: 'ADA stall/aisle design slope', units: '%', source: 'EFCG default (≤ 2.0 % target)' },
  parkingAnchorBelowFfeFt: { label: 'Parking anchor below FFE (sidewalk)', units: 'ft', source: 'EFCG default (SPEC §5.3)' },
  truckDriveMaxGradePct: { label: 'Truck drive max grade', units: '%', source: 'EFCG default; verify vs SALDO' },
  carDriveMaxGradePct: { label: 'Car drive max grade', units: '%', source: 'EFCG default; verify vs SALDO' },
  landingMaxGradePct: { label: 'Driveway landing max grade', units: '%', source: 'EFCG default; verify vs SALDO' },
  landingLengthFt: { label: 'Driveway landing length at ROW', units: 'ft', source: 'EFCG default; verify vs SALDO' },
  driveCrossSlopePct: { label: 'Drive cross slope', units: '%', source: 'EFCG default' },
  minGrassSlopePct: { label: 'Min grass slope', units: '%', source: 'EFCG default' },
  sectionBuildingSlabFt: { label: 'Building slab section', units: 'ft', source: 'EFCG default (8 in concrete + 6 in stone)' },
  sectionDockApronFt: { label: 'Dock apron section', units: 'ft', source: 'EFCG default' },
  sectionHeavyAsphaltFt: { label: 'Heavy-duty asphalt section', units: 'ft', source: 'EFCG default' },
  sectionStandardAsphaltFt: { label: 'Standard asphalt section', units: 'ft', source: 'EFCG default' },
  sectionSidewalkFt: { label: 'Sidewalk section', units: 'ft', source: 'EFCG default' },
  topsoilStripFt: { label: 'Topsoil strip depth', units: 'ft', source: 'EFCG default (reused on site)' },
  shrinkPct: { label: 'Cut shrink factor', units: '%', source: 'EFCG default' },
  gridCellFt: { label: 'Grading grid cell (interactive)', units: 'ft', source: 'EFCG default' },
  reportGridCellFt: { label: 'Grading grid cell (report)', units: 'ft', source: 'EFCG default' },
  offsiteToleranceFt: { label: 'Offsite grading tolerance', units: 'ft', source: 'EFCG default' },
  minWallHeightFt: { label: 'Min reportable wall height', units: 'ft', source: 'EFCG default' },
  basinSideSlopeHtoV: { label: 'Basin interior side slope', units: 'H:1V', source: 'EFCG default (planning-level)' },
};
