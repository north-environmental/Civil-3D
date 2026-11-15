/* grading.js: concept-level earthwork engine (grid method). Pure, deterministic.
 * Ported line-for-line from groundwork/packages/core/src/grading/engine.ts, which is checked against
 * hand calculations T1-T6 (see selfcheck.js).
 *
 * - A grading object sets finished grade inside its footprint: z = z0(x,y) + k(x,y) * FFE.
 * - Overlaps resolve by priority (pad > truck court > drive > parking > basin).
 * - Outside all footprints the ground ties back to existing at H:V = s:1. For each outside cell, d is the
 *   distance from the cell centre to each object's boundary:
 *       L = max(z_i - d_i/s),  U = min(z_i + d_i/s),  proposed = clamp(existing, L, U)
 *   Where L > U the objects are too close to tie together: a retaining wall takes up the difference.
 * - Earthwork = sum over cells of (subgrade - existing) x cell area, split into cut and fill.
 */
'use strict';
(function () {
  const G = LD.geom, Grid = LD.grid;

  /** Grading defaults (EFCG). Source: groundwork/packages/core/src/criteria/grading.ts. */
  const CRITERIA = {
    tieInSlopeHtoV: 3,            // daylight slope back to existing ground, 3:1 max
    padOverbuildFt: 10,           // building pad beyond the footprint
    parkingSlopePct: 1.5,         // parking field design slope (1.0-4.0% allowed; ADA-friendly)
    sectionBuildingSlabFt: 1.17,  // finished floor -> subgrade: 8 in concrete + 6 in stone
    sectionStandardAsphaltFt: 1.0,// car parking pavement section
    shrinkPct: 10,                // cut shrink: net = cut x (1 - shrink) - fill
    gridCellFt: 5,                // grading grid cell
    offsiteToleranceFt: 0.1,      // |proposed - existing| beyond this outside the parcel = offsite grading
    minWallHeightFt: 1.0,         // walls lower than this are ignored (curbs / kneewalls)
  };
  const PRIORITY = { pad: 5, truckCourt: 4, drive: 3, parking: 2, basin: 1 };
  const CATEGORIES = ['pad', 'truckCourt', 'parking', 'drive', 'basin', 'tieIn'];
  const PIECE = 9;

  function flatPad(id, ring, o) {
    const fixed = o.elevFt !== undefined && o.elevFt !== null;
    const z0 = fixed ? o.elevFt : o.ffeOffsetFt || 0;
    const k = fixed ? 0 : 1;
    const sec = o.sectionFt || 0;
    return {
      id, name: o.name || id, category: o.category || 'pad', priority: o.priority || PRIORITY.pad,
      region: [G.ensureCCW(ring)],
      surface: (_x, _y, out) => { out[0] = z0; out[1] = k; },
      sectionFt: () => sec,
    };
  }

  /** A plane falling at slopePct in direction dirDeg (CCW from east) from origin. */
  function planarPad(id, ring, o) {
    const r = (o.dirDeg * Math.PI) / 180, dx = Math.cos(r), dy = Math.sin(r), g = o.slopePct / 100;
    const fixed = o.elevAtOriginFt !== undefined && o.elevAtOriginFt !== null;
    const base = fixed ? o.elevAtOriginFt : o.ffeOffsetFt || 0;
    const k = fixed ? 0 : 1;
    const sec = o.sectionFt || 0;
    return {
      id, name: o.name || id, category: o.category || 'parking', priority: o.priority || PRIORITY.parking,
      region: [G.ensureCCW(ring)],
      surface: (x, y, out) => { out[0] = base - g * ((x - o.origin[0]) * dx + (y - o.origin[1]) * dy); out[1] = k; },
      sectionFt: () => sec,
    };
  }

  function makeModel(opts) {
    const g = opts.existing;
    const spec = { x0: g.x0, y0: g.y0, cellFt: g.cellFt, nx: g.nx, ny: g.ny };
    const n = g.nx * g.ny;
    const owner = new Int16Array(n).fill(-1);
    const z0 = new Float32Array(n), k = new Float32Array(n), section = new Float32Array(n);
    const objects = opts.objects;
    const order = objects.map((_, i) => i).sort((a, b) => objects[a].priority - objects[b].priority);
    const out = new Float64Array(2);
    const sections = opts.sections !== undefined ? opts.sections : true;
    for (const idx of order) {
      const o = objects[idx];
      Grid.forEachCellInRegion(spec, o.region, (i, j) => {
        const c = j * g.nx + i;
        const x = g.x0 + (i + 0.5) * g.cellFt, y = g.y0 + (j + 0.5) * g.cellFt;
        o.surface(x, y, out);
        owner[c] = idx; z0[c] = out[0]; k[c] = out[1];
        section[c] = sections ? o.sectionFt(x, y) : 0;
      });
    }
    // Boundary pieces for the tie-in, skipping edges that face another object (interior joints).
    const daylight = opts.daylight !== undefined ? opts.daylight : true;
    const data = [];
    if (daylight) {
      const maxLen = Math.max(15, 3 * g.cellFt);
      const probe = Math.max(0.75, g.cellFt * 0.6);
      for (let oi = 0; oi < objects.length; oi++) {
        const o = objects[oi];
        for (const ring of o.region) {
          const m = ring.length;
          for (let e = 0; e < m; e++) {
            const a = ring[e], b = ring[(e + 1) % m];
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (len < 1e-6) continue;
            const parts = Math.max(1, Math.ceil(len / maxLen));
            const nx = (b[1] - a[1]) / len, ny = -(b[0] - a[0]) / len; // outward (right of travel on CCW)
            for (let p = 0; p < parts; p++) {
              const ax = a[0] + ((b[0] - a[0]) * p) / parts, ay = a[1] + ((b[1] - a[1]) * p) / parts;
              const bx = a[0] + ((b[0] - a[0]) * (p + 1)) / parts, by = a[1] + ((b[1] - a[1]) * (p + 1)) / parts;
              const mx = (ax + bx) / 2 + nx * probe, my = (ay + by) / 2 + ny * probe;
              let covered = false;
              for (let q = 0; q < objects.length && !covered; q++) if (q !== oi && G.pointInRegion([mx, my], objects[q].region)) covered = true;
              if (covered) continue;
              o.surface(ax, ay, out);
              const za = out[0], ka = out[1];
              o.surface(bx, by, out);
              const ci = Math.min(g.nx - 1, Math.max(0, Math.floor(((ax + bx) / 2 - g.x0) / g.cellFt)));
              const cj = Math.min(g.ny - 1, Math.max(0, Math.floor(((ay + by) / 2 - g.y0) / g.cellFt)));
              data.push(ax, ay, bx, by, za, ka, out[0], out[1], g.data[cj * g.nx + ci]);
            }
          }
        }
      }
    }
    return {
      spec, existing: g.data, objects, owner, z0, k, section,
      pieces: Float64Array.from(data), pieceCount: data.length / PIECE,
      inParcel: opts.parcel ? Grid.rasterize(spec, [opts.parcel]) : null,
      criteria: opts.criteria, daylight, sections,
    };
  }

  function evaluateModel(m, ffeFt, opts) {
    opts = opts || {};
    const { spec, existing, owner } = m;
    const { nx, ny, cellFt } = spec;
    const n = nx * ny;
    const s = m.criteria.tieInSlopeHtoV;
    const proposed = new Float32Array(n);
    for (let c = 0; c < n; c++) proposed[c] = owner[c] >= 0 ? m.z0[c] + m.k[c] * ffeFt : existing[c];

    let L = null, U = null;
    if (m.pieceCount) {
      L = new Float32Array(n).fill(-1e9);
      U = new Float32Array(n).fill(1e9);
      const P = m.pieces;
      let hMax = 0;
      for (let p = 0; p < m.pieceCount; p++) {
        const o = p * PIECE, e = P[o + 8];
        hMax = Math.max(hMax, Math.abs(P[o + 4] + P[o + 5] * ffeFt - e), Math.abs(P[o + 6] + P[o + 7] * ffeFt - e));
      }
      const reach = Math.min(500, s * hMax * 1.75 + 15 + 2 * cellFt);
      for (let p = 0; p < m.pieceCount; p++) {
        const o = p * PIECE;
        const ax = P[o], ay = P[o + 1], bx = P[o + 2], by = P[o + 3];
        const za = P[o + 4] + P[o + 5] * ffeFt, zb = P[o + 6] + P[o + 7] * ffeFt;
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - spec.x0) / cellFt));
        const i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx) + reach - spec.x0) / cellFt));
        const j0 = Math.max(0, Math.floor((Math.min(ay, by) - reach - spec.y0) / cellFt));
        const j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by) + reach - spec.y0) / cellFt));
        const abx = bx - ax, aby = by - ay, l2 = abx * abx + aby * aby;
        for (let j = j0; j <= j1; j++) {
          const y = spec.y0 + (j + 0.5) * cellFt, row = j * nx;
          for (let i = i0; i <= i1; i++) {
            const c = row + i;
            if (owner[c] >= 0) continue;
            const x = spec.x0 + (i + 0.5) * cellFt;
            let t = ((x - ax) * abx + (y - ay) * aby) / l2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = ax + abx * t - x, qy = ay + aby * t - y;
            const d = Math.sqrt(qx * qx + qy * qy);
            if (d > reach) continue;
            const z = za + (zb - za) * t;
            const lo = z - d / s, hi = z + d / s;
            if (lo > L[c]) L[c] = lo;
            if (hi < U[c]) U[c] = hi;
          }
        }
      }
    }

    const cut = new Float64Array(CATEGORIES.length), fill = new Float64Array(CATEGORIES.length), area = new Float64Array(CATEGORIES.length);
    const catIndex = m.objects.map((o) => CATEGORIES.indexOf(o.category));
    const tie = CATEGORIES.indexOf('tieIn');
    const cellArea = cellFt * cellFt;
    const wallHeight = opts.quick ? null : new Float32Array(n);
    let sectionCf = 0, disturbed = 0, offsite = 0, offsiteMax = 0, maxCut = 0, maxFill = 0, anyWall = false;
    const tol = m.criteria.offsiteToleranceFt;
    for (let c = 0; c < n; c++) {
      const e = existing[c];
      let diff, cat;
      if (owner[c] >= 0) {
        const sec = m.section[c];
        diff = proposed[c] - sec - e;
        sectionCf += sec * cellArea;
        cat = catIndex[owner[c]];
        disturbed += cellArea;
        area[cat] += cellArea;
      } else {
        if (!L || L[c] < -1e8) continue;
        const lo = L[c], hi = U[c];
        let z;
        if (lo > hi + 1e-4) {
          z = e < hi ? hi : e > lo ? lo : e;
          if (wallHeight) { wallHeight[c] = lo - hi; anyWall = true; }
        } else z = e < lo ? lo : e > hi ? hi : e;
        proposed[c] = z;
        diff = z - e;
        if (Math.abs(diff) < 0.005) continue;
        cat = tie;
        disturbed += cellArea;
        area[cat] += cellArea;
      }
      if (diff > 0) {
        fill[cat] += diff * cellArea;
        if (proposed[c] - e > maxFill) maxFill = proposed[c] - e;
      } else {
        cut[cat] -= diff * cellArea;
        if (e - proposed[c] > maxCut) maxCut = e - proposed[c];
      }
      if (m.inParcel && !m.inParcel[c]) {
        const dz = Math.abs(proposed[c] - e);
        if (dz > tol) { offsite += cellArea; if (dz > offsiteMax) offsiteMax = dz; }
      }
    }
    let cutCf = 0, fillCf = 0;
    for (let i = 0; i < CATEGORIES.length; i++) { cutCf += cut[i]; fillCf += fill[i]; }
    const walls = wallHeight && anyWall ? groupWalls(m, wallHeight) : [];
    return {
      ffeFt, proposed, wallHeight, cutCf, fillCf,
      netCf: cutCf * (1 - m.criteria.shrinkPct / 100) - fillCf,
      sectionCf, disturbedSf: disturbed,
      byCategory: CATEGORIES.map((category, i) => ({ category, cutCf: cut[i], fillCf: fill[i], areaSf: area[i] })).filter((r) => r.areaSf > 0),
      walls, offsiteAreaSf: offsite, offsiteMaxDeltaFt: offsiteMax, maxCutFt: maxCut, maxFillFt: maxFill,
    };
  }

  function groupWalls(m, wallHeight) {
    const { nx, ny, cellFt, x0, y0 } = m.spec;
    const minH = m.criteria.minWallHeightFt;
    const seen = new Uint8Array(nx * ny);
    const out = [];
    const stack = [];
    for (let start = 0; start < wallHeight.length; start++) {
      if (seen[start] || wallHeight[start] <= 0.05) continue;
      stack.length = 0; stack.push(start); seen[start] = 1;
      let cells = 0, sumH = 0, maxH = 0, sx = 0, sy = 0, adj = 0;
      const neighbors = new Set();
      while (stack.length) {
        const c = stack.pop();
        const i = c % nx, j = (c - i) / nx, h = wallHeight[c];
        cells++; sumH += h; if (h > maxH) maxH = h; sx += i; sy += j;
        const nb = [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, j > 0 ? c - nx : -1, j < ny - 1 ? c + nx : -1];
        for (const q of nb) {
          if (q < 0) continue;
          if (m.owner[q] >= 0) { adj++; neighbors.add(m.owner[q]); }
          else if (!seen[q] && wallHeight[q] > 0.05) { seen[q] = 1; stack.push(q); }
        }
      }
      if (maxH < minH) continue;
      const lengthFt = Math.max((adj * cellFt) / 2, Math.sqrt(cells) * cellFt);
      out.push({
        lengthFt, maxHeightFt: maxH, avgHeightFt: sumH / cells,
        at: [x0 + (sx / cells + 0.5) * cellFt, y0 + (sy / cells + 0.5) * cellFt],
        betweenObjectIds: [...neighbors].map((i) => m.objects[i].id),
      });
    }
    return out.sort((a, b) => b.maxHeightFt * b.lengthFt - a.maxHeightFt * a.lengthFt).map((w, i) => Object.assign(w, { id: 'wall-' + (i + 1) }));
  }

  /** Solve net(FFE) = target by bisection in [minFt, maxFt]. Net falls monotonically as FFE rises. */
  function solveFfe(m, o) {
    const f = (ffe) => evaluateModel(m, ffe, { quick: true }).netCf - o.targetNetCf;
    let lo = o.minFt, hi = o.maxFt, flo = f(lo), fhi = f(hi), iterations = 2;
    if (flo <= 0) return { ffeFt: lo, achieved: Math.abs(flo) < 1, netCf: flo + o.targetNetCf, iterations, bound: 'min' };
    if (fhi >= 0) return { ffeFt: hi, achieved: Math.abs(fhi) < 1, netCf: fhi + o.targetNetCf, iterations, bound: 'max' };
    const tol = o.tolFt || 0.002;
    while (hi - lo > tol && iterations < 60) {
      const mid = (lo + hi) / 2, fm = f(mid);
      iterations++;
      if (fm > 0) { lo = mid; flo = fm; } else { hi = mid; fhi = fm; }
    }
    const ffe = flo === fhi ? (lo + hi) / 2 : lo + ((hi - lo) * flo) / (flo - fhi);
    return { ffeFt: ffe, achieved: true, netCf: f(ffe) + o.targetNetCf, iterations: iterations + 1, bound: 'none' };
  }

  /** Max and mean slope (%) of a surface over the cells inside a ring (central differences). */
  function surfaceSlopePct(m, surface, ring) {
    const { nx, ny, cellFt } = m.spec;
    let max = 0, sum = 0, cells = 0;
    Grid.forEachCellInRegion(m.spec, [ring], (i, j) => {
      if (i < 1 || j < 1 || i >= nx - 1 || j >= ny - 1) return;
      const c = j * nx + i, o = m.owner[c];
      if (m.owner[c - 1] !== o || m.owner[c + 1] !== o || m.owner[c - nx] !== o || m.owner[c + nx] !== o) return;
      const gx = (surface[c + 1] - surface[c - 1]) / (2 * cellFt), gy = (surface[c + nx] - surface[c - nx]) / (2 * cellFt);
      const sl = Math.hypot(gx, gy) * 100;
      if (sl > max) max = sl;
      sum += sl; cells++;
    });
    return { maxPct: max, avgPct: cells ? sum / cells : 0, cells };
  }

  LD.grading = { CRITERIA, PRIORITY, flatPad, planarPad, makeModel, evaluateModel, solveFfe, surfaceSlopePct };
})();
