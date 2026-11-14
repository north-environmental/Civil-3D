/**
 * Design vehicles for swept-path checks.
 *
 * WB-67 (interstate semitrailer, 53 ft trailer): dimensions as tabulated for the AASHTO "Green Book" WB-67
 * design vehicle. They were entered from memory of that table during an offline build and were NOT
 * checked against the publication: treat them as an EFCG assumption until verified (listed in
 * docs/LIMITATIONS.md). The sum 4.0 + 19.5 + 45.5 + 4.5 = 73.5 ft matches the vehicle's overall length.
 */
export type DesignVehicle = {
  name: string;
  widthFt: number;
  /** Front bumper to steering axle. */
  frontOverhangFt: number;
  /** Steering axle to the center of the drive tandem (kingpin assumed over it). */
  tractorWheelbaseFt: number;
  /** Kingpin to the center of the trailer's rear tandem. */
  kingpinToRearAxleFt: number;
  /** Rear tandem center to the trailer's rear bumper. */
  rearOverhangFt: number;
  /** Trailer nose ahead of the kingpin. EFCG assumption. */
  trailerNoseFt: number;
  /** Minimum design turning radius of the steering path used to fillet drive centerlines. EFCG assumption (≥ 45 ft typical for WB-67). */
  minTurnRadiusFt: number;
  source: string;
};

export const WB67: DesignVehicle = {
  name: 'WB-67',
  widthFt: 8.5,
  frontOverhangFt: 4.0,
  tractorWheelbaseFt: 19.5,
  kingpinToRearAxleFt: 45.5,
  rearOverhangFt: 4.5,
  trailerNoseFt: 3.0,
  minTurnRadiusFt: 50,
  source: 'AASHTO WB-67 design vehicle (dimensions unverified, entered from memory; EFCG assumption)',
};
