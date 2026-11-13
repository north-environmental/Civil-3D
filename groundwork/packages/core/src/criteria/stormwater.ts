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
  /** Method 'runoffDepth': inches of runoff captured over new impervious area. EFCG default. */
  runoffDepthIn: 3.0,
  /** Basin design (storage) depth, ft. EFCG default. */
  basinDepthFt: 6,
  /** Freeboard above the design water surface, ft. EFCG default. */
  freeboardFt: 1,
  /** Interior side slope H:V. EFCG default. */
  sideSlopeHtoV: 3,
  /** Maximum number of separate basins the solver may split the reservation into. EFCG default. */
  maxBasins: 3,
} as const;
export type StormwaterCriteria = { -readonly [K in keyof typeof STORMWATER_DEFAULTS]: number } & {
  method: 'pctOfSite' | 'runoffDepth';
};
export const STORMWATER_DEFAULT_METHOD: StormwaterCriteria['method'] = 'pctOfSite';

export const STORMWATER_META: Record<keyof typeof STORMWATER_DEFAULTS, CriterionMeta> = {
  pctOfSite: { label: 'Basin reservation (pctOfSite method)', units: '% of parcel', source: 'EFCG default calibrated to as-built (~10 ac on ~110 ac, 2020 PC minutes)' },
  runoffDepthIn: { label: 'Runoff depth over new impervious (runoffDepth method)', units: 'in', source: 'EFCG default' },
  basinDepthFt: { label: 'Basin design depth', units: 'ft', source: 'EFCG default' },
  freeboardFt: { label: 'Basin freeboard', units: 'ft', source: 'EFCG default' },
  sideSlopeHtoV: { label: 'Basin side slope', units: 'H:1V', source: 'EFCG default' },
  maxBasins: { label: 'Max basins', units: 'count', source: 'EFCG default' },
};
