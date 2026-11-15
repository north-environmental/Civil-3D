/* selfcheck.js: hand-calculation checks of the app's engineering math (run from Test mode).
 * Expected values come from groundwork/docs/reference/engineering-criteria.md (T1-T9, T13) and simple
 * geometry worked out by hand. Each check states the hand calc in plain English.
 */
'use strict';
(function () {
  const GR = LD.grading, P = LD.parking, G = LD.geom, Grid = LD.grid;
  const C = Object.assign({}, GR.CRITERIA);

  function gridFrom(x0, y0, w, h, cell, f) {
    const g = Grid.make({ x0, y0, cellFt: cell, nx: Math.round(w / cell), ny: Math.round(h / cell) });
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) g.data[j * g.nx + i] = f(x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell);
    return g;
  }
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const within = (actual, expected, tol) => Math.abs(actual - expected) <= tol;

  const checks = [
    {
      id: 'T1', title: 'Flat pad fill',
      handCalc: '100 x 100 ft pad at 102.00 on flat ground at 100.00: 100 x 100 x 2 = 20,000 CF = 740.74 CY',
      run() {
        const ex = gridFrom(-50, -50, 200, 200, 1, () => 100);
        const r = GR.evaluateModel(GR.makeModel({ existing: ex, objects: [GR.flatPad('pad', rect(0, 0, 100, 100), { elevFt: 102 })], criteria: C, daylight: false, sections: false }), 0);
        return { got: `${LD.fmt.n(r.fillCf / 27, 2)} CY fill, ${LD.fmt.n(r.cutCf / 27, 2)} CY cut`, pass: within(r.fillCf, 20000, 100) && r.cutCf === 0 };
      },
    },
    {
      id: 'T2', title: 'Pad on a tilted plane',
      handCalc: 'Ground z = 100 + 0.02x; 200 x 100 ft pad at 102: half in fill, half in cut, 10,000 CF (370.37 CY) each',
      run() {
        const ex = gridFrom(-50, -50, 300, 200, 2, (x) => 100 + 0.02 * x);
        const r = GR.evaluateModel(GR.makeModel({ existing: ex, objects: [GR.flatPad('pad', rect(0, 0, 200, 100), { elevFt: 102 })], criteria: Object.assign({}, C, { shrinkPct: 0 }), daylight: false, sections: false }), 0);
        return { got: `${LD.fmt.n(r.fillCf / 27, 2)} CY fill, ${LD.fmt.n(r.cutCf / 27, 2)} CY cut`, pass: within(r.fillCf, 10000, 50) && within(r.cutCf, 10000, 50) };
      },
    },
    {
      id: 'T3', title: 'Pad with 3:1 side slopes',
      handCalc: '20,000 CF pad + 4 side wedges (2,400 CF) + 4 corner cones (75.40 CF) = 22,475.40 CF = 832.42 CY',
      run() {
        const ex = gridFrom(-50, -50, 200, 200, 1, () => 100);
        const r = GR.evaluateModel(GR.makeModel({ existing: ex, objects: [GR.flatPad('pad', rect(0, 0, 100, 100), { elevFt: 102 })], criteria: C, daylight: true, sections: false }), 0);
        return { got: `${LD.fmt.n(r.fillCf / 27, 2)} CY fill, ${r.walls.length} walls`, pass: within(r.fillCf, 22475.4, 22475.4 * 0.005) && r.cutCf === 0 && r.walls.length === 0 };
      },
    },
    {
      id: 'T4', title: 'Retaining wall where slopes do not fit',
      handCalc: 'Pads at 100 and 120 ft, 50 ft apart: a 3:1 slope only drops 50/3 = 16.67 ft, so a 120 - 16.67 - 100 = 3.33 ft wall is needed',
      run() {
        const ex = gridFrom(-60, -60, 370, 220, 1, () => 100);
        const objs = [GR.flatPad('A', rect(0, 0, 100, 100), { elevFt: 100 }), GR.flatPad('B', rect(150, 0, 250, 100), { elevFt: 120 })];
        const r = GR.evaluateModel(GR.makeModel({ existing: ex, objects: objs, criteria: C, daylight: true, sections: false }), 0);
        const w = r.walls.slice().sort((a, b) => b.maxHeightFt - a.maxHeightFt)[0];
        return { got: w ? `wall ${LD.fmt.n(w.maxHeightFt, 2)} ft high, ${LD.fmt.n(w.lengthFt, 0)} ft long` : 'no wall', pass: !!w && within(w.maxHeightFt, 3.33, 0.3) && w.lengthFt > 90 && w.lengthFt < 125 };
      },
    },
    {
      id: 'T5', title: 'Balance finished floor (10% shrink)',
      handCalc: 'Ground z = 100 + 0.02x, 400 x 300 ft pad: balance with 10% shrink at FFE = 110 + 4(sqrt(0.9) - 1)/(sqrt(0.9) + 1) = 109.89 ft',
      run() {
        const ex = gridFrom(200, -50, 600, 400, 2, (x) => 100 + 0.02 * x);
        const m = GR.makeModel({ existing: ex, objects: [GR.flatPad('pad', rect(300, 0, 700, 300), { ffeOffsetFt: 0 })], criteria: Object.assign({}, C, { shrinkPct: 10 }), daylight: false, sections: false });
        const s = GR.solveFfe(m, { targetNetCf: 0, minFt: 100, maxFt: 120 });
        return { got: `FFE ${LD.fmt.n(s.ffeFt, 3)} ft`, pass: s.achieved && within(s.ffeFt, 109.89, 0.02) };
      },
    },
    {
      id: 'T6', title: 'Balance finished floor (no shrink)',
      handCalc: 'Same pad without shrink: cut equals fill when the floor is at the average ground, 100 + 0.02 x 500 = 110.00 ft',
      run() {
        const ex = gridFrom(200, -50, 600, 400, 2, (x) => 100 + 0.02 * x);
        const m = GR.makeModel({ existing: ex, objects: [GR.flatPad('pad', rect(300, 0, 700, 300), { ffeOffsetFt: 0 })], criteria: Object.assign({}, C, { shrinkPct: 0 }), daylight: false, sections: false });
        const s = GR.solveFfe(m, { targetNetCf: 0, minFt: 100, maxFt: 120 });
        return { got: `FFE ${LD.fmt.n(s.ffeFt, 3)} ft`, pass: within(s.ffeFt, 110, 0.02) };
      },
    },
    {
      id: 'T7', title: 'Accessible stall counts (ADA Table 208.2)',
      handCalc: '25 stalls -> 1, 100 -> 4, 150 -> 5, 501 -> 11 (2%), 1,200 -> 22 (20 + 1 per 100 over 1,000); vans: 1 per 6 accessible',
      run() {
        const got = [25, 100, 150, 501, 1200].map(P.adaRequired);
        const vans = [1, 6, 7].map(P.adaVanRequired);
        return { got: got.join(', ') + '; vans ' + vans.join(', '), pass: got.join() === '1,4,5,11,22' && vans.join() === '1,1,2' };
      },
    },
    {
      id: 'T9', title: 'Parking module',
      handCalc: 'Two rows of 10 x 20 ft stalls on a 24 ft aisle = 64 ft deep; 300 ft of row with no islands holds 30 stalls per side = 60',
      run() {
        const c = P.DEFAULTS;
        const depth = P.moduleDepthFt(c);
        const perSide = Math.floor(300 / c.carStallWidthFt + 1e-9);
        return { got: `${depth} ft deep, ${2 * perSide} stalls`, pass: depth === 64 && 2 * perSide === 60 };
      },
    },
    {
      id: 'S1', title: 'Setback distance to a lot line',
      handCalc: 'Lot line y = 0; 200 x 100 ft building centred at y = 150 has its south face at y = 100: 100 ft away. Required 100 ft: passes. Moved to y = 140: 90 ft, fails by 10 ft',
      run() {
        const line = [[0, 0], [1000, 0]];
        const d1 = G.ringSegDist(G.rectRing(500, 150, 200, 100, 0), line[0], line[1]);
        const d2 = G.ringSegDist(G.rectRing(500, 140, 200, 100, 0), line[0], line[1]);
        const d3 = G.ringSegDist(G.rectRing(500, 300, 200, 100, 45), line[0], line[1]);
        const exp3 = 300 - Math.hypot(100, 50) * Math.sin((45 + Math.atan2(50, 100) * 180 / Math.PI) * Math.PI / 180);
        return { got: `${LD.fmt.n(d1, 2)} ft, ${LD.fmt.n(d2, 2)} ft; rotated 45 deg: ${LD.fmt.n(d3, 2)} ft (hand calc ${LD.fmt.n(exp3, 2)})`, pass: within(d1, 100, 1e-6) && within(d2, 90, 1e-6) && within(d3, exp3, 1e-6) };
      },
    },
    {
      id: 'S2', title: 'Building inside / outside a buildable area',
      handCalc: 'Buildable area 1,000 x 600 ft: a 600 x 400 ft building at its centre fits; shifted 250 ft east it crosses the edge',
      run() {
        const env = { outer: rect(0, 0, 1000, 600), holes: [] };
        const a = G.ringInsidePoly(G.rectRing(500, 300, 600, 400, 0), env);
        const b = G.ringInsidePoly(G.rectRing(750, 300, 600, 400, 0), env);
        return { got: `centred: ${a ? 'fits' : 'does not fit'}; shifted: ${b ? 'fits' : 'does not fit'}`, pass: a && !b };
      },
    },
    {
      id: 'T13', title: 'Metres to US survey feet',
      handCalc: '150.000 m x 3937/1200 = 492.125 ft',
      run() { const v = 150 * LD.units.FTUS_PER_M; return { got: LD.fmt.n(v, 4) + ' ft', pass: within(v, 492.125, 0.001) }; },
    },
  ];

  function runAll() {
    return checks.map((c) => {
      const t0 = performance.now();
      try {
        const r = c.run();
        return { id: c.id, title: c.title, handCalc: c.handCalc, got: r.got, pass: !!r.pass, ms: Math.round(performance.now() - t0) };
      } catch (e) {
        return { id: c.id, title: c.title, handCalc: c.handCalc, got: 'error: ' + e.message, pass: false, ms: 0 };
      }
    });
  }

  LD.selfcheck = { checks, runAll };
})();
