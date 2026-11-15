"""Longitude/latitude <-> PA State Plane South (EPSG:2272, US survey feet).

Used only where a data source cannot give us EPSG:2272 directly (OpenStreetMap). Every ArcGIS
service is asked to reproject on its own server instead.

Lambert Conformal Conic (2 standard parallels) on the GRS80 ellipsoid, per Snyder, "Map Projections:
A Working Manual" (USGS PP 1395), eqs. 15-1 to 15-11. EPSG:2272 parameters:
  standard parallels 40 deg 58' N and 39 deg 56' N, origin latitude 39 deg 20' N,
  central meridian 77 deg 45' W, false easting 600,000 m (1,968,500 ftUS), false northing 0.
NAD83 is treated as identical to WGS84 here (difference ~1-2 m, far below what a concept
site plan needs and smaller than OpenStreetMap's own accuracy).
"""

import math

FTUS_PER_M = 3937 / 1200
_A = 6378137.0                      # GRS80 semi-major axis, m
_F = 1 / 298.257222101              # GRS80 flattening
_E = math.sqrt(2 * _F - _F * _F)    # eccentricity

_LAT1 = math.radians(40 + 58 / 60)
_LAT2 = math.radians(39 + 56 / 60)
_LAT0 = math.radians(39 + 20 / 60)
_LON0 = math.radians(-77.75)
_X0_M = 600000.0
_Y0_M = 0.0


def _m(phi):
    return math.cos(phi) / math.sqrt(1 - (_E * math.sin(phi)) ** 2)


def _t(phi):
    es = _E * math.sin(phi)
    return math.tan(math.pi / 4 - phi / 2) / ((1 - es) / (1 + es)) ** (_E / 2)


_N = (math.log(_m(_LAT1)) - math.log(_m(_LAT2))) / (math.log(_t(_LAT1)) - math.log(_t(_LAT2)))
_BIGF = _m(_LAT1) / (_N * _t(_LAT1) ** _N)
_RHO0 = _A * _BIGF * _t(_LAT0) ** _N


def lonlat_to_ft(lon, lat):
    """(longitude, latitude) in degrees -> (x, y) in EPSG:2272 US survey feet."""
    phi = math.radians(lat)
    rho = _A * _BIGF * _t(phi) ** _N
    theta = _N * (math.radians(lon) - _LON0)
    x_m = _X0_M + rho * math.sin(theta)
    y_m = _Y0_M + _RHO0 - rho * math.cos(theta)
    return x_m * FTUS_PER_M, y_m * FTUS_PER_M


def ft_to_lonlat(x_ft, y_ft):
    """(x, y) in EPSG:2272 US survey feet -> (longitude, latitude) in degrees."""
    x = x_ft / FTUS_PER_M - _X0_M
    y = _RHO0 - (y_ft / FTUS_PER_M - _Y0_M)
    rho = math.copysign(math.hypot(x, y), _N)
    t = (rho / (_A * _BIGF)) ** (1 / _N)
    theta = math.atan2(x, y)
    lon = theta / _N + _LON0
    phi = math.pi / 2 - 2 * math.atan(t)
    for _ in range(15):
        es = _E * math.sin(phi)
        phi_new = math.pi / 2 - 2 * math.atan(t * ((1 - es) / (1 + es)) ** (_E / 2))
        if abs(phi_new - phi) < 1e-12:
            phi = phi_new
            break
        phi = phi_new
    return math.degrees(lon), math.degrees(phi)
