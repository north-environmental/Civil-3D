/**
 * Accessible parking counts. Source: 2010 ADA Standards for Accessible Design, Table 208.2 and § 208.2.4
 * (as tabulated in docs/reference/engineering-criteria.md). Applied per parking facility.
 */

/** Table 208.2 rows: [maxTotal, minAccessible] for lots up to 500 spaces. */
const TABLE_208_2: [number, number][] = [
  [25, 1],
  [50, 2],
  [75, 3],
  [100, 4],
  [150, 5],
  [200, 6],
  [300, 7],
  [400, 8],
  [500, 9],
];

/** Minimum accessible spaces for a parking facility with `totalStalls` (Table 208.2). */
export function adaRequiredStalls(totalStalls: number): number {
  if (totalStalls <= 0) return 0;
  for (const [max, req] of TABLE_208_2) if (totalStalls <= max) return req;
  // 501–1000: 2 % of total (fractions round up).
  if (totalStalls <= 1000) return Math.ceil(totalStalls * 0.02);
  // 1001+: 20 plus 1 for each 100, or fraction thereof, over 1000.
  return 20 + Math.ceil((totalStalls - 1000) / 100);
}

/** § 208.2.4: one van space for every six accessible spaces, or fraction thereof. */
export function adaRequiredVanStalls(accessibleStalls: number): number {
  return accessibleStalls <= 0 ? 0 : Math.ceil(accessibleStalls / 6);
}
export const ADA_CITATION = '2010 ADA Standards Table 208.2; § 208.2.4 (van); § 502.4 (slope ≤ 1:48)';
