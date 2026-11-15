"""Terrain grid: pick a cell size that fits the size budget, encode as scaled 16-bit numbers.

Encoding (SITE_PACKAGE_FORMAT.md section 3.4):
  elevation_ft = offsetFt + q * scaleFt, q = uint16 little-endian, 65535 = no data,
  row 0 = southern edge, index = row * cols + col, base64 text.
"""

import base64
import math

import numpy as np

# Finest first. 3 ft is about the native 1 m spacing of the LiDAR-derived 3DEP surface;
# anything finer would only interpolate, not add detail.
CELL_CHOICES_FT = (3, 5, 10)
NO_DATA = 65535
MAX_SCALE_FT = 0.01


def grid_shape(extent, cell_ft):
    """Snap the extent outward to whole cells. Returns x0, y0, cols, rows."""
    x0 = math.floor(extent[0] / cell_ft) * cell_ft
    y0 = math.floor(extent[1] / cell_ft) * cell_ft
    cols = int(math.ceil((extent[2] - x0) / cell_ft))
    rows = int(math.ceil((extent[3] - y0) / cell_ft))
    return x0, y0, cols, rows


def encoded_bytes(cols, rows):
    return math.ceil(cols * rows * 2 / 3) * 4  # uint16, then base64


def choose_cell_size(extent, budget_bytes):
    for c in CELL_CHOICES_FT:
        x0, y0, cols, rows = grid_shape(extent, c)
        if encoded_bytes(cols, rows) <= budget_bytes and cols <= 8000 and rows <= 8000:
            return c
    return CELL_CHOICES_FT[-1]


def encode(ft):
    """float32 array (rows, cols), NaN = no data -> dict of encoding fields."""
    valid = np.isfinite(ft)
    if not valid.any():
        raise ValueError("the elevation grid has no data at all")
    zmin, zmax = float(np.nanmin(ft)), float(np.nanmax(ft))
    span = zmax - zmin
    scale = max(span / (NO_DATA - 1), 1e-4) if span > 0 else 0.01
    warn = None
    if scale > MAX_SCALE_FT:
        warn = f"Elevation range is large ({span:.0f} ft); terrain stored to {scale:.3f} ft precision."
    q = np.full(ft.shape, NO_DATA, dtype="<u2")
    q[valid] = np.clip(np.rint((ft[valid] - zmin) / scale), 0, NO_DATA - 1).astype("<u2")
    return {
        "minElevFt": round(zmin, 2),
        "maxElevFt": round(zmax, 2),
        "encoding": "uint16-scaled-base64",
        "offsetFt": zmin,
        "scaleFt": scale,
        "noData": NO_DATA,
        "data": base64.b64encode(q.tobytes()).decode("ascii"),
    }, warn


def decode(t):
    q = np.frombuffer(base64.b64decode(t["data"]), dtype="<u2")
    if q.size != t["rows"] * t["cols"]:
        raise ValueError(f"terrain has {q.size} values, expected {t['rows'] * t['cols']}")
    ft = t["offsetFt"] + q.astype(np.float64) * t["scaleFt"]
    ft[q == t["noData"]] = np.nan
    return ft.reshape(t["rows"], t["cols"])


def cell_mask(polygon, x0, y0, cell_ft, cols, rows):
    """Boolean grid: True where the cell centre is inside the polygon."""
    from shapely import contains_xy
    xs = x0 + (np.arange(cols) + 0.5) * cell_ft
    ys = y0 + (np.arange(rows) + 0.5) * cell_ft
    gx, gy = np.meshgrid(xs, ys)
    return contains_xy(polygon, gx, gy)


def fill_small_holes(ft, max_passes=3):
    """Fill isolated no-data cells from their neighbours (a few passes only). Returns count filled."""
    filled = 0
    for _ in range(max_passes):
        bad = ~np.isfinite(ft)
        if not bad.any():
            break
        pad = np.pad(ft, 1, constant_values=np.nan)
        neigh = np.stack([pad[1 + dy:pad.shape[0] - 1 + dy, 1 + dx:pad.shape[1] - 1 + dx]
                          for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx])
        cnt = np.isfinite(neigh).sum(0)
        mean = np.nansum(np.where(np.isfinite(neigh), neigh, 0), 0) / np.maximum(cnt, 1)
        fix = bad & (cnt >= 3)
        ft[fix] = mean[fix]
        filled += int(fix.sum())
    return filled
