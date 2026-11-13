/**
 * Units and conversions. Units live in names: lengthFt, areaSf, areaAc, volumeCy, volumeCf, slopePct, elevFt.
 * Horizontal: US survey feet. Vertical: feet (NAVD88).
 */

/** 1 m = 3937/1200 ftUS exactly (US survey foot). Source: NIST / engineering-criteria.md "Units". */
export const FTUS_PER_M = 3937 / 1200; // 3.280833...
/** 1 ac = 43,560 SF. Source: engineering-criteria.md "Units". */
export const SF_PER_AC = 43560;
/** 1 CY = 27 CF. Source: engineering-criteria.md "Units". */
export const CF_PER_CY = 27;

export const metersToFtUS = (m: number): number => m * FTUS_PER_M;
export const ftUSToMeters = (ft: number): number => ft / FTUS_PER_M;
export const sfToAc = (sf: number): number => sf / SF_PER_AC;
export const acToSf = (ac: number): number => ac * SF_PER_AC;
export const cfToCy = (cf: number): number => cf / CF_PER_CY;
export const cyToCf = (cy: number): number => cy * CF_PER_CY;
/** Percent slope (2.0 = 2%) <-> fraction. Percent at every boundary; fractions only inside math. */
export const pctToFraction = (slopePct: number): number => slopePct / 100;
export const fractionToPct = (slopeFraction: number): number => slopeFraction * 100;

export function fmtInt(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}
export function fmtNum(v: number, digits = 1): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export const fmtSf = (areaSf: number): string => `${fmtInt(areaSf)} SF`;
export const fmtAc = (areaSf: number, digits = 2): string => `${fmtNum(sfToAc(areaSf), digits)} ac`;
export const fmtFt = (lengthFt: number, digits = 0): string => `${fmtNum(lengthFt, digits)} ft`;
export const fmtCy = (volumeCy: number): string => `${fmtInt(volumeCy)} CY`;
export const fmtPct = (pct: number, digits = 1): string => `${fmtNum(pct, digits)}%`;
export const fmtElev = (elevFt: number): string => fmtNum(elevFt, 1);

/** Compass name for an azimuth (degrees clockwise from north). */
export function compass8(azimuthDeg: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((azimuthDeg % 360) + 360) % 360) / 45) % 8];
}
