/**
 * Stormwater reservation (planning-level land-use reservation, NOT a hydrologic design).
 * Source: docs/reference/engineering-criteria.md ("Stormwater reservation method").
 */
import type { CriterionMeta } from './layout';

export const STORMWATER_DEFAULTS = {
  /**
   * Method 'pctOfSite': basin surface area as a percent of gross parcel area. 9 % is calibrated to the
   * as-built (~10 ac of basins on ~110 ac per the 2020 Planning Commission minutes).
   */
  pctOfSite: 9,
  /**
   * Method 'pctOfSite': basin storage depth, ft. EFCG default. The ~10 ac as-built calibration implies wide,
   * shallow basins: 3 in of runoff over ~21 ac of impervious is only ~5 ac-ft, i.e. about 0.5 ft over 10 ac.
   * 3 ft + freeboard keeps the reservation's excavation from dominating the concept earthwork.
   */
  pctOfSiteDepthFt: 3,
  /** Method 'runoffDepth': inches of runoff captured over new impervious area. EFCG default. */
  runoffDepthIn: 3.0,
  /**
   * Method 'tr55': 24-hour design storm depth P, inches. PLACEHOLDER (EFCG assumption): replace with the
   * NOAA Atlas 14 depth for the governing storm at the site; no rainfall data was reachable during the build.
   */
  designStormIn: 3.0,
  /**
   * Method 'tr55' curve numbers (NRCS TR-55 Table 2-2, hydrologic soil group C assumed; entered from memory
   * during an offline build, verify): pre-development meadow 71, post-development open space in good
   * condition 74, impervious 98.
   */
  cnPre: 71,
  cnPostPervious: 74,
  cnImpervious: 98,
  /** Method 'runoffDepth' and 'tr55': basin design (storage) depth, ft. EFCG default. */
  basinDepthFt: 6,
  /** Freeboard above the design water surface, ft. EFCG default. */
  freeboardFt: 1,
  /** Interior side slope H:V. EFCG default. */
  sideSlopeHtoV: 3,
  /** Maximum number of separate basins the solver may split the reservation into. EFCG default. */
  maxBasins: 3,
} as const;
export type StormwaterCriteria = { -readonly [K in keyof typeof STORMWATER_DEFAULTS]: number } & {
  method: 'pctOfSite' | 'runoffDepth' | 'tr55';
};
export const STORMWATER_DEFAULT_METHOD: StormwaterCriteria['method'] = 'pctOfSite';

export const STORMWATER_META: Record<keyof typeof STORMWATER_DEFAULTS, CriterionMeta> = {
  pctOfSite: { label: 'Basin reservation (pctOfSite method)', units: '% of parcel', source: 'EFCG default calibrated to as-built (~10 ac on ~110 ac, 2020 PC minutes)' },
  pctOfSiteDepthFt: { label: 'Basin storage depth (pctOfSite method)', units: 'ft', source: 'EFCG default (wide, shallow basins implied by the as-built calibration)' },
  runoffDepthIn: { label: 'Runoff depth over new impervious (runoffDepth method)', units: 'in', source: 'EFCG default' },
  designStormIn: { label: 'Design storm depth, 24-hr (tr55 method)', units: 'in', source: 'PLACEHOLDER, EFCG assumption: replace with the NOAA Atlas 14 value for the site' },
  cnPre: { label: 'Curve number, pre-development (tr55 method)', units: 'CN', source: 'NRCS TR-55 Table 2-2, meadow, HSG C assumed (unverified)' },
  cnPostPervious: { label: 'Curve number, post-development pervious (tr55 method)', units: 'CN', source: 'NRCS TR-55 Table 2-2, open space good condition, HSG C assumed (unverified)' },
  cnImpervious: { label: 'Curve number, impervious (tr55 method)', units: 'CN', source: 'NRCS TR-55 Table 2-2 (unverified)' },
  basinDepthFt: { label: 'Basin storage depth (runoffDepth and tr55 methods)', units: 'ft', source: 'EFCG default' },
  freeboardFt: { label: 'Basin freeboard', units: 'ft', source: 'EFCG default' },
  sideSlopeHtoV: { label: 'Basin side slope', units: 'H:1V', source: 'EFCG default' },
  maxBasins: { label: 'Max basins', units: 'count', source: 'EFCG default' },
};
