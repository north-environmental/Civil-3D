/* parking.js: car parking field layout and accessible-stall counts.
 * Ported from groundwork/packages/core/src/layout/building.ts and criteria/ada.ts.
 *
 * A field is laid out in its own frame: u runs along the rows (lengthFt), v across them (depthFt).
 * Rows come in modules: stall row | aisle | stall row. Each row loses an end island at each end
 * plus the cross aisle, and gets an interior landscape island every N stalls.
 */
'use strict';
(function () {
  const G = LD.geom;

  /** Defaults (EFCG); stall size and minimum aisle are overridden by the site's zoning values. */
  const DEFAULTS = {
    carStallWidthFt: 10,         // equals the North Lebanon 27-1402 minimum (10 x 20 ft)
    carStallLengthFt: 20,
    carAisleFt: 24,              // two-way 90-degree aisle (zoning minimum is 20 ft, 27-1407)
    parkingEndIslandFt: 10,      // landscape island at each end of a row (>= 5 ft per 27-1302)
    parkingIslandEveryStalls: 15,// one interior island per this many stalls (ordinance gives no spacing)
    adaAisleFt: 5,               // ADA access aisle (>= 60 in, 2010 ADA 502.3)
    adaVanAisleFt: 8,            // van access aisle (96 in, 2010 ADA 502.2)
  };

  /** 2010 ADA Standards Table 208.2: [max total spaces, min accessible spaces]. */
  const TABLE_208_2 = [[25, 1], [50, 2], [75, 3], [100, 4], [150, 5], [200, 6], [300, 7], [400, 8], [500, 9]];
  function adaRequired(total) {
    if (total <= 0) return 0;
    for (const [max, req] of TABLE_208_2) if (total <= max) return req;
    if (total <= 1000) return Math.ceil(total * 0.02);
    return 20 + Math.ceil((total - 1000) / 100);
  }
  /** 2010 ADA 208.2.4: one van space for every six accessible spaces, or fraction. */
  const adaVanRequired = (ada) => (ada <= 0 ? 0 : Math.ceil(ada / 6));

  function criteriaFor(site) {
    const c = Object.assign({}, DEFAULTS);
    if (site) {
      const w = site.zv('stallWidthFt'), l = site.zv('stallLengthFt'), a = site.zv('aisleWidthFt');
      if (w) c.carStallWidthFt = Math.max(c.carStallWidthFt, w);
      if (l) c.carStallLengthFt = Math.max(c.carStallLengthFt, l);
      if (a) c.carAisleFt = Math.max(c.carAisleFt, a);
    }
    return c;
  }

  const moduleDepthFt = (c) => 2 * c.carStallLengthFt + c.carAisleFt;
  function rowCapacity(lengthFt, c) {
    const zoneStartFt = c.carAisleFt + c.parkingEndIslandFt;
    const zone = lengthFt - 2 * zoneStartFt;
    const positions = Math.max(0, Math.floor(zone / c.carStallWidthFt + 1e-9));
    const islands = Math.floor(positions / (c.parkingIslandEveryStalls + 1));
    return { positions, islands, stalls: positions - islands, zoneStartFt };
  }
  function fieldDepthFt(rows, c) {
    const modules = Math.floor(rows / 2);
    return modules * moduleDepthFt(c) + (rows % 2 ? c.carStallLengthFt + c.carAisleFt : 0);
  }
  function adaZoneFt(ada, van, c) {
    const cars = Math.max(0, ada - van);
    return ada * c.carStallWidthFt + Math.ceil(van / 2) * c.adaVanAisleFt + Math.ceil(cars / 2) * c.adaAisleFt;
  }

  /** spec: {origin, angleDeg, lengthFt, rows}. Returns the field with counts and its outline. */
  function makeField(spec, c) {
    const cap = rowCapacity(spec.lengthFt, c);
    const depthFt = fieldDepthFt(spec.rows, c);
    const totalPositions = cap.stalls * spec.rows;
    const ada = totalPositions > 0 ? Math.min(adaRequired(totalPositions), cap.stalls) : 0;
    const van = adaVanRequired(ada);
    const displaced = ada > 0 ? Math.ceil(adaZoneFt(ada, van, c) / c.carStallWidthFt) : 0;
    const rows = [];
    let v = 0;
    for (let r = 0; r < spec.rows; r++) {
      const first = r % 2 === 0;
      const row = { v0: first ? v : v + c.carStallLengthFt + c.carAisleFt, aisleSide: first ? 1 : -1, stalls: cap.stalls, ada: 0, van: 0 };
      if (r === 0 && ada > 0) { row.stalls = Math.max(0, cap.stalls - displaced); row.ada = ada; row.van = van; }
      rows.push(row);
      if (!first) v += moduleDepthFt(c);
    }
    const stallsStd = rows.reduce((s, r) => s + r.stalls, 0);
    const f = { origin: spec.origin, angleDeg: spec.angleDeg };
    return {
      origin: spec.origin, angleDeg: spec.angleDeg, lengthFt: spec.lengthFt, depthFt, rows,
      stallsStd, stallsAda: ada, stallsVan: van, stallsTotal: stallsStd + ada,
      adaRequired: adaRequired(stallsStd + ada),
      islandSf: spec.rows * (2 * c.parkingEndIslandFt + cap.islands * c.carStallWidthFt) * c.carStallLengthFt,
      polygon: G.frameRect(f, 0, 0, spec.lengthFt, depthFt),
    };
  }

  /** Striping, islands and accessible stalls, for drawing. */
  function stallGeometry(field, c) {
    const f = { origin: field.origin, angleDeg: field.angleDeg };
    const cap = rowCapacity(field.lengthFt, c);
    const W = (u, v) => G.toWorld(f, [u, v]);
    const g = { lines: [], adaAisles: [], adaStalls: [], islands: [] };
    const sl = c.carStallLengthFt, sw = c.carStallWidthFt;
    for (const row of field.rows) {
      const v0 = row.v0, v1 = row.v0 + sl;
      g.islands.push(G.frameRect(f, c.carAisleFt, v0, cap.zoneStartFt, v1), G.frameRect(f, field.lengthFt - cap.zoneStartFt, v0, field.lengthFt - c.carAisleFt, v1));
      let u = cap.zoneStartFt;
      const zoneEnd = field.lengthFt - cap.zoneStartFt;
      const back = row.aisleSide === 1 ? v0 : v1;
      g.lines.push([W(cap.zoneStartFt, back), W(zoneEnd, back)]);
      if (row.ada > 0) {
        let left = row.ada, vans = row.van;
        while (left > 0) {
          const pair = Math.min(2, left), aisle = vans > 0 ? c.adaVanAisleFt : c.adaAisleFt;
          g.adaStalls.push(G.frameRect(f, u, v0, u + sw, v1));
          g.adaAisles.push(G.frameRect(f, u + sw, v0, u + sw + aisle, v1));
          if (pair === 2) g.adaStalls.push(G.frameRect(f, u + sw + aisle, v0, u + 2 * sw + aisle, v1));
          g.lines.push([W(u, v0), W(u, v1)]);
          u += pair * sw + aisle; left -= pair; vans -= pair;
        }
        g.lines.push([W(u, v0), W(u, v1)]);
        u = cap.zoneStartFt + Math.ceil((u - cap.zoneStartFt) / sw - 1e-9) * sw;
      }
      let sinceIsland = 0, placed = 0;
      while (placed < row.stalls && u + sw <= zoneEnd + 1e-6) {
        if (sinceIsland === c.parkingIslandEveryStalls) { g.islands.push(G.frameRect(f, u, v0, u + sw, v1)); u += sw; sinceIsland = 0; continue; }
        g.lines.push([W(u, v0), W(u, v1)]);
        u += sw; placed++; sinceIsland++;
      }
      g.lines.push([W(u, v0), W(u, v1)]);
    }
    return g;
  }

  /** Smallest field (rows fixed) whose total stalls reach `stalls`. Returns lengthFt. */
  function lengthForStalls(stalls, rows, c) {
    for (let L = 2 * (c.carAisleFt + c.parkingEndIslandFt) + c.carStallWidthFt; L < 5000; L += c.carStallWidthFt) {
      const f = makeField({ origin: [0, 0], angleDeg: 0, lengthFt: L, rows }, c);
      if (f.stallsTotal >= stalls) return L;
    }
    return null;
  }

  LD.parking = { DEFAULTS, criteriaFor, adaRequired, adaVanRequired, rowCapacity, moduleDepthFt, fieldDepthFt, makeField, stallGeometry, lengthForStalls };
})();
