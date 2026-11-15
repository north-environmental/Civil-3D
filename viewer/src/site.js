/* site.js: read a site package (SITE_PACKAGE_FORMAT.md v1.x) into the viewer's site model. */
'use strict';
(function () {
  const G = LD.geom, Grid = LD.grid;

  function fail(msg) {
    const e = new Error(msg);
    e.userMessage = msg;
    throw e;
  }

  /** base64 -> Uint8Array without blowing the stack on big strings. */
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function decodeTerrain(t) {
    if (t.encoding !== 'uint16-scaled-base64') fail('Unknown terrain encoding "' + t.encoding + '".');
    const bytes = b64ToBytes(t.data);
    const n = t.rows * t.cols;
    if (bytes.length !== 2 * n) fail('The terrain grid is damaged: expected ' + n + ' values, found ' + bytes.length / 2 + '.');
    const dv = new DataView(bytes.buffer);
    const data = new Float32Array(n);
    let sum = 0, cnt = 0, missing = 0;
    for (let i = 0; i < n; i++) {
      const q = dv.getUint16(2 * i, true);
      if (q === t.noData) { data[i] = NaN; missing++; continue; }
      const z = t.offsetFt + q * t.scaleFt;
      data[i] = z; sum += z; cnt++;
    }
    if (missing) {
      // Fill gaps (usually off-site edges) with the mean so grading math never sees NaN.
      const mean = sum / Math.max(cnt, 1);
      for (let i = 0; i < n; i++) if (Number.isNaN(data[i])) data[i] = mean;
    }
    return { x0: t.x0Ft, y0: t.y0Ft, cellFt: t.cellSizeFt, nx: t.cols, ny: t.rows, data, missing };
  }

  function load(pkg) {
    if (!pkg || typeof pkg !== 'object') fail('That file is not a site package.');
    if (pkg.format !== 'efcg-site-package') fail('That file is not an EFCG site package (format is "' + (pkg.format || 'missing') + '").');
    if (!String(pkg.version || '').startsWith('1.')) fail('This viewer reads site package version 1.x; the file is version ' + pkg.version + '.');
    if (!pkg.crs || pkg.crs.epsg !== 2272) fail('The package must use PA South State Plane feet (EPSG:2272).');
    for (const k of ['metadata', 'parcel', 'terrain', 'features', 'zoning', 'derived'])
      if (!pkg[k]) fail('The package is missing its "' + k + '" section.');

    const terrain = decodeTerrain(pkg.terrain);
    const ring = G.ensureCCW(pkg.parcel.polygon.outer);
    const parcelPoly = { outer: ring, holes: pkg.parcel.polygon.holes || [] };
    const lines = pkg.derived.setbackLines || [];
    const edges = ring.map((a, i) => {
      const e = (pkg.parcel.edges || [])[i] || {};
      const sl = lines.find((l) => l.edgeIndex === i) || {};
      return {
        index: i, a, b: ring[(i + 1) % ring.length], type: e.type || 'side', road: e.road || null,
        rowInsetFt: e.rowInsetFt || 0, lengthFt: e.lengthFt,
        buildingSetbackFt: sl.buildingSetbackFt, parkingSetbackFt: sl.parkingSetbackFt,
        section: sl.section, parkingSection: sl.parkingSection,
      };
    });
    const zvals = (pkg.zoning && pkg.zoning.values) || {};
    const zv = (k) => (zvals[k] && zvals[k].value != null ? zvals[k].value : null);
    const zsec = (k) => (zvals[k] && zvals[k].section) || null;

    const bEnv = pkg.derived.buildingEnvelope || [];
    const pEnv = pkg.derived.parkingEnvelope || [];
    const largest = (list) => list.slice().sort((p, q) => G.polyArea(q) - G.polyArea(p))[0];
    const bBig = largest(bEnv), pBig = largest(pEnv);

    let pmin = Infinity, pmax = -Infinity;
    Grid.forEachCellInRegion(terrain, [ring], (i, j) => {
      const v = terrain.data[j * terrain.nx + i];
      if (v < pmin) pmin = v;
      if (v > pmax) pmax = v;
    });

    const site = {
      pkg, meta: pkg.metadata, zoning: pkg.zoning, features: pkg.features, imagery: pkg.imagery || null,
      terrain, parcelRing: ring, parcelPoly, parcelAreaSf: G.polyArea(parcelPoly), edges,
      buildingEnvelope: bEnv, parkingEnvelope: pEnv,
      buildingCenter: bBig ? G.innerPoint(bBig) : G.innerPoint(parcelPoly),
      parkingCenter: pBig ? G.innerPoint(pBig) : G.innerPoint(parcelPoly),
      parcelBBox: G.bbox([ring]),
      elevMinFt: pmin, elevMaxFt: pmax,
      zv, zsec,
      extent: {
        xMin: terrain.x0, yMin: terrain.y0,
        xMax: terrain.x0 + terrain.nx * terrain.cellFt, yMax: terrain.y0 + terrain.ny * terrain.cellFt,
      },
    };
    return site;
  }

  /** Short plain-text description of a parcel edge, e.g. "front lot line on Heilmandale Rd (north side)". */
  function edgeLabel(e) {
    const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1];
    // The ring is counter-clockwise, so the outward normal is (dy, -dx); its angle names the side.
    const ang = (Math.atan2(-dx, dy) * 180) / Math.PI;
    const dirs = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
    const face = dirs[Math.round(((ang + 360) % 360) / 45) % 8];
    return e.type + ' lot line' + (e.road ? ' on ' + e.road : '') + ' (' + face + ' side)';
  }

  LD.site = { load, decodeTerrain, edgeLabel };
})();
