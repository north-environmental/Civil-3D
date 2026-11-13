/**
 * CRS helpers. The demo site uses EPSG:2272 (NAD83 / Pennsylvania South, ftUS).
 * Lebanon County is in the PA South zone (PA South covers the southern tier of counties
 * including Lebanon, Lancaster, Dauphin, Berks). Other jurisdictions store their own proj4 string.
 */
import proj4 from 'proj4';
import type { Pt } from './basic';

export type Crs = { epsg: number; name: string; units: 'ftUS'; proj4: string };

export const EPSG_2272: Crs = {
  epsg: 2272,
  name: 'NAD83 / Pennsylvania South (ftUS)',
  units: 'ftUS',
  // Source: EPSG registry definition for 2272 (Lambert Conformal Conic 2SP, US survey foot).
  proj4:
    '+proj=lcc +lat_1=40.96666666666667 +lat_2=39.93333333333333 +lat_0=39.33333333333334 +lon_0=-77.75 ' +
    '+x_0=600000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=us-ft +no_defs',
};

const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

/** Projected (ftUS) -> [lon, lat] WGS84. */
export function toLonLat(crs: Crs, p: Pt): Pt {
  const r = proj4(crs.proj4, WGS84, [p[0], p[1]]);
  return [r[0], r[1]];
}
/** [lon, lat] WGS84 -> projected (ftUS). */
export function fromLonLat(crs: Crs, lonLat: Pt): Pt {
  const r = proj4(WGS84, crs.proj4, [lonLat[0], lonLat[1]]);
  return [r[0], r[1]];
}
