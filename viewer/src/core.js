/* core.js: shared geometry, grid and formatting helpers. Plain JavaScript, no libraries.
 * Coordinates are EPSG:2272 (PA South State Plane, US survey feet). A "ring" is [[x,y],...] with the
 * first point not repeated; outer rings are counter-clockwise. A "region" is a list of rings (even-odd).
 * Ported from groundwork/packages/core/src/geometry (basic.ts, grid.ts).
 */
'use strict';
var LD = (window.LD = window.LD || {});

(function () {
  const G = {};

  G.signedArea = function (r) {
    let a = 0;
    for (let i = 0, n = r.length; i < n; i++) {
      const p = r[i], q = r[(i + 1) % n];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  };
  G.area = (r) => Math.abs(G.signedArea(r));
  G.ensureCCW = (r) => (G.signedArea(r) < 0 ? r.slice().reverse() : r);
  G.polyArea = (poly) => G.area(poly.outer) - (poly.holes || []).reduce((s, h) => s + G.area(h), 0);

  G.centroid = function (r) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = r.length; i < n; i++) {
      const p = r[i], q = r[(i + 1) % n];
      const k = p[0] * q[1] - q[0] * p[1];
      a += k; cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k;
    }
    if (Math.abs(a) < 1e-9) return r[0].slice();
    return [cx / (3 * a), cy / (3 * a)];
  };

  G.pointInRing = function (p, r) {
    let inside = false;
    for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) {
      const a = r[i], b = r[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  G.pointInRegion = function (p, region) {
    let inside = false;
    for (const r of region) if (G.pointInRing(p, r)) inside = !inside;
    return inside;
  };
  G.pointInPoly = (p, poly) => G.pointInRegion(p, [poly.outer, ...(poly.holes || [])]);

  /** Distance from point p to segment ab. */
  G.segDist = function (p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
  };
  function orient(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }
  G.segsCross = function (a, b, c, d) {
    const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
    return o1 * o2 < 0 && o3 * o4 < 0;
  };
  G.segSegDist = function (a, b, c, d) {
    if (G.segsCross(a, b, c, d)) return 0;
    return Math.min(G.segDist(a, c, d), G.segDist(b, c, d), G.segDist(c, a, b), G.segDist(d, a, b));
  };
  /** Shortest distance between a closed ring and a segment (0 if they touch or cross). */
  G.ringSegDist = function (r, a, b) {
    let best = Infinity;
    for (let i = 0, n = r.length; i < n; i++) best = Math.min(best, G.segSegDist(r[i], r[(i + 1) % n], a, b));
    return best;
  };
  G.ringsTouch = function (r1, r2) {
    for (let i = 0; i < r1.length; i++)
      for (let j = 0; j < r2.length; j++)
        if (G.segsCross(r1[i], r1[(i + 1) % r1.length], r2[j], r2[(j + 1) % r2.length])) return true;
    return G.pointInRing(r1[0], r2) || G.pointInRing(r2[0], r1);
  };
  /** True when every vertex of `inner` is inside the polygon and no edges cross. */
  G.ringInsidePoly = function (inner, poly) {
    const rings = [poly.outer, ...(poly.holes || [])];
    for (const p of inner) if (!G.pointInRegion(p, rings)) return false;
    for (const r of rings)
      for (let i = 0; i < inner.length; i++)
        for (let j = 0; j < r.length; j++)
          if (G.segsCross(inner[i], inner[(i + 1) % inner.length], r[j], r[(j + 1) % r.length])) return false;
    return true;
  };

  /** Local frame: u along angleDeg (CCW from east), v 90 deg to its left. */
  G.toWorld = (f, uv) => {
    const c = Math.cos((f.angleDeg * Math.PI) / 180), s = Math.sin((f.angleDeg * Math.PI) / 180);
    return [f.origin[0] + uv[0] * c - uv[1] * s, f.origin[1] + uv[0] * s + uv[1] * c];
  };
  G.frameRect = (f, u0, v0, u1, v1) => [G.toWorld(f, [u0, v0]), G.toWorld(f, [u1, v0]), G.toWorld(f, [u1, v1]), G.toWorld(f, [u0, v1])];
  /** Rectangle centred on (cx, cy): widthFt along the rotated x axis, depthFt across it. CCW. */
  G.rectRing = (cx, cy, widthFt, depthFt, rotDeg) =>
    G.frameRect({ origin: [cx, cy], angleDeg: rotDeg || 0 }, -widthFt / 2, -depthFt / 2, widthFt / 2, depthFt / 2);

  G.bbox = function (rings) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rings) for (const p of r) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    return { minX, minY, maxX, maxY };
  };

  /** Distance from p to the nearest edge of a polygon (outer + holes). */
  G.distToBoundary = function (p, poly) {
    let d = Infinity;
    for (const r of [poly.outer, ...(poly.holes || [])])
      for (let i = 0; i < r.length; i++) d = Math.min(d, G.segDist(p, r[i], r[(i + 1) % r.length]));
    return d;
  };
  /** A point well inside a polygon (approximate pole of inaccessibility, coarse-to-fine grid search). */
  G.innerPoint = function (poly) {
    const b = G.bbox([poly.outer]);
    let best = null, bestD = -1;
    let step = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 40;
    let cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, half = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2;
    for (let pass = 0; pass < 4; pass++) {
      for (let x = cx - half; x <= cx + half; x += step)
        for (let y = cy - half; y <= cy + half; y += step) {
          const p = [x, y];
          if (!G.pointInPoly(p, poly)) continue;
          const d = G.distToBoundary(p, poly);
          if (d > bestD) { bestD = d; best = p; }
        }
      if (!best) break;
      cx = best[0]; cy = best[1]; half = step * 2; step = step / 5;
    }
    return best || G.centroid(poly.outer);
  };

  LD.geom = G;

  // ------------------------------------------------------------------------------------------------
  // Grids: cell (i, j) centre at (x0 + (i + 0.5)·cellFt, y0 + (j + 0.5)·cellFt); j grows to the north.
  // ------------------------------------------------------------------------------------------------
  const Grid = {};
  Grid.sample = function (g, x, y) {
    const fx = (x - g.x0) / g.cellFt - 0.5, fy = (y - g.y0) / g.cellFt - 0.5;
    let i0 = Math.floor(fx), j0 = Math.floor(fy), tx = fx - i0, ty = fy - j0;
    if (i0 < 0) { i0 = 0; tx = 0; } else if (i0 >= g.nx - 1) { i0 = Math.max(0, g.nx - 2); tx = g.nx > 1 ? 1 : 0; }
    if (j0 < 0) { j0 = 0; ty = 0; } else if (j0 >= g.ny - 1) { j0 = Math.max(0, g.ny - 2); ty = g.ny > 1 ? 1 : 0; }
    const i1 = Math.min(g.nx - 1, i0 + 1), j1 = Math.min(g.ny - 1, j0 + 1), d = g.data;
    return d[j0 * g.nx + i0] * (1 - tx) * (1 - ty) + d[j0 * g.nx + i1] * tx * (1 - ty) + d[j1 * g.nx + i0] * (1 - tx) * ty + d[j1 * g.nx + i1] * tx * ty;
  };
  Grid.make = (spec) => Object.assign({}, spec, { data: new Float32Array(spec.nx * spec.ny) });
  Grid.specForBBox = function (b, cellFt) {
    const x0 = Math.floor(b.minX / cellFt) * cellFt, y0 = Math.floor(b.minY / cellFt) * cellFt;
    return { x0, y0, cellFt, nx: Math.max(1, Math.ceil((b.maxX - x0) / cellFt)), ny: Math.max(1, Math.ceil((b.maxY - y0) / cellFt)) };
  };
  Grid.resample = function (src, spec) {
    const out = Grid.make(spec);
    for (let j = 0; j < spec.ny; j++) {
      const y = spec.y0 + (j + 0.5) * spec.cellFt;
      for (let i = 0; i < spec.nx; i++) out.data[j * spec.nx + i] = Grid.sample(src, spec.x0 + (i + 0.5) * spec.cellFt, y);
    }
    return out;
  };
  /** Calls visit(i, j) for every cell whose CENTRE is inside the region (even-odd scanline). */
  Grid.forEachCellInRegion = function (g, region, visit) {
    if (!region.length) return;
    let minY = Infinity, maxY = -Infinity;
    for (const r of region) for (const p of r) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
    const j0 = Math.max(0, Math.floor((minY - g.y0) / g.cellFt - 0.5));
    const j1 = Math.min(g.ny - 1, Math.ceil((maxY - g.y0) / g.cellFt - 0.5));
    const xs = [];
    for (let j = j0; j <= j1; j++) {
      const y = g.y0 + (j + 0.5) * g.cellFt;
      xs.length = 0;
      for (const r of region)
        for (let k = 0, n = r.length, m = n - 1; k < n; m = k++) {
          const a = r[k], b = r[m];
          if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const ia = Math.max(0, Math.ceil((xs[k] - g.x0) / g.cellFt - 0.5));
        const ib = Math.min(g.nx - 1, Math.floor((xs[k + 1] - g.x0) / g.cellFt - 0.5 - 1e-9));
        for (let i = ia; i <= ib; i++) visit(i, j);
      }
    }
  };
  Grid.rasterize = function (g, region) {
    const mask = new Uint8Array(g.nx * g.ny);
    Grid.forEachCellInRegion(g, region, (i, j) => { mask[j * g.nx + i] = 1; });
    return mask;
  };
  /** Mean of grid values over the cells inside a ring. */
  Grid.meanInRing = function (g, ring) {
    let s = 0, n = 0;
    Grid.forEachCellInRegion(g, [ring], (i, j) => {
      const v = g.data[j * g.nx + i];
      if (Number.isFinite(v)) { s += v; n++; }
    });
    if (!n) { const c = G.centroid(ring); return Grid.sample(g, c[0], c[1]); }
    return s / n;
  };
  LD.grid = Grid;

  LD.units = { CF_PER_CY: 27, SF_PER_AC: 43560, FTUS_PER_M: 3937 / 1200 };

  const nf = (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  LD.fmt = {
    n: (v, d = 0) => (v == null || !Number.isFinite(v) ? 'n/a' : nf(d).format(v)),
    ft: (v, d = 1) => LD.fmt.n(v, d) + ' ft',
    sf: (v) => LD.fmt.n(v, 0) + ' SF',
    ac: (v, d = 2) => LD.fmt.n(v, d) + ' ac',
    cy: (v) => LD.fmt.n(v, 0) + ' CY',
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
  };
  LD.round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
})();
