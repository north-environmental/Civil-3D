/* commands.js: the app's command layer. Every change to the design goes through here.
 * Test-mode buttons and Claude's chat tools call exactly the same commands, so every number
 * shown (areas, setbacks, earthwork, stall counts) comes from this code, never from Claude.
 *
 * A command = { name, title, description (written for Claude), inputSchema (JSON Schema),
 *               mutates, testInput (pre-filled values for test mode), run(ctx, input) -> result }.
 * Undo: before each change the design is snapshotted; undoing restores that snapshot.
 */
'use strict';
(function () {
  const G = LD.geom, Grid = LD.grid, P = LD.parking, GR = LD.grading, F = LD.fmt;

  // ----------------------------------------------------------------------------------------------
  // App state
  // ----------------------------------------------------------------------------------------------
  const app = (LD.app = {
    site: null,
    state: null,
    history: [],     // [{seq, name, input, summary, source, before}]
    seq: 0,
    display: { grading: null }, // big arrays for the 3D view (not part of undo snapshots)
    listeners: [],
    on(fn) { this.listeners.push(fn); },
    emit(kind, detail) { for (const fn of this.listeners) try { fn(kind, detail); } catch (e) { console.error(e); } },
  });

  const newState = () => ({ elements: [], counters: { B: 0, P: 0 }, grading: null, checks: null });

  app.setSite = function (site) {
    app.site = site;
    app.state = newState();
    app.history = [];
    app.display.grading = null;
    app.emit('site');
  };

  // ----------------------------------------------------------------------------------------------
  // Element geometry
  // ----------------------------------------------------------------------------------------------
  function parkingField(el) {
    const c = P.criteriaFor(app.site);
    const depth = P.fieldDepthFt(el.rows, c);
    const a = (el.angleDeg * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
    const origin = [el.cxFt - (el.lengthFt / 2) * ux + (depth / 2) * uy, el.cyFt - (el.lengthFt / 2) * uy - (depth / 2) * ux];
    return P.makeField({ origin, angleDeg: el.angleDeg, lengthFt: el.lengthFt, rows: el.rows }, c);
  }
  function elementRing(el) {
    if (el.type === 'building') return G.rectRing(el.cxFt, el.cyFt, el.widthFt, el.depthFt, el.rotationDeg);
    return parkingField(el).polygon;
  }
  const footprintSf = (el) => G.area(elementRing(el));
  const avgGround = (ring) => LD.round(Grid.meanInRing(app.site.terrain, ring), 1);
  const insideAny = (ring, polys) => polys.some((p) => G.ringInsidePoly(ring, p));

  function getEl(id) {
    const key = String(id || '').trim().toUpperCase();
    const el = app.state.elements.find((e) => e.id.toUpperCase() === key || (e.name || '').toUpperCase() === key);
    if (!el) {
      const ids = app.state.elements.map((e) => e.id + (e.name ? ' (' + e.name + ')' : '')).join(', ') || 'none yet';
      throw new Error('There is no element "' + id + '". Elements: ' + ids + '.');
    }
    return el;
  }
  function coverage() {
    const b = app.state.elements.filter((e) => e.type === 'building').reduce((s, e) => s + footprintSf(e), 0);
    return { buildingSf: b, pct: (100 * b) / app.site.parcelAreaSf, maxPct: app.site.zv('maxLotCoveragePct') };
  }
  function describeEl(el) {
    const ring = elementRing(el);
    const o = {
      id: el.id, type: el.type, name: el.name,
      centerXFt: LD.round(el.cxFt, 1), centerYFt: LD.round(el.cyFt, 1),
      footprintSf: Math.round(G.area(ring)),
      existingGroundAvgFt: avgGround(ring),
    };
    if (el.type === 'building') Object.assign(o, {
      widthFt: el.widthFt, depthFt: el.depthFt, heightFt: el.heightFt, rotationDeg: el.rotationDeg,
      padElevationFt: el.padElevFt, padElevationSource: el.padElevSource,
      insideBuildableArea: insideAny(ring, app.site.buildingEnvelope),
    });
    else {
      const f = parkingField(el);
      Object.assign(o, {
        lengthFt: el.lengthFt, depthFt: f.depthFt, rows: el.rows, angleDeg: el.angleDeg,
        stallsTotal: f.stallsTotal, stallsStandard: f.stallsStd, stallsAccessible: f.stallsAda, stallsVanAccessible: f.stallsVan,
        surfaceElevationAtCenterFt: el.elevFt, slopePct: GR.CRITERIA.parkingSlopePct,
        insideParkingArea: insideAny(ring, app.site.parkingEnvelope),
      });
    }
    return o;
  }

  function invalidateResults() {
    if (app.state.grading) app.state.grading.stale = true;
    if (app.state.checks) app.state.checks.stale = true;
    app.display.grading = null;
  }

  // ----------------------------------------------------------------------------------------------
  // Input checking (JSON Schema subset: type, minimum, maximum, enum, required)
  // ----------------------------------------------------------------------------------------------
  function cleanInput(schema, raw) {
    const out = {};
    const props = (schema && schema.properties) || {};
    raw = raw || {};
    for (const [k, s] of Object.entries(props)) {
      let v = raw[k];
      if (v === '' || v === undefined || v === null) {
        if (s.default !== undefined) out[k] = s.default;
        continue;
      }
      if (s.type === 'number' || s.type === 'integer') {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new Error(k + ' must be a number (got "' + v + '").');
        if (s.type === 'integer' && !Number.isInteger(n)) throw new Error(k + ' must be a whole number.');
        if (s.minimum !== undefined && n < s.minimum) throw new Error(k + ' must be at least ' + s.minimum + '.');
        if (s.maximum !== undefined && n > s.maximum) throw new Error(k + ' must be at most ' + s.maximum + '.');
        v = n;
      } else if (s.type === 'boolean') {
        v = v === true || v === 'true';
      } else {
        v = String(v).trim();
        if (s.enum && !s.enum.includes(v)) throw new Error(k + ' must be one of: ' + s.enum.join(', ') + '.');
      }
      out[k] = v;
    }
    for (const k of (schema && schema.required) || [])
      if (out[k] === undefined) throw new Error('Missing ' + k + ': ' + ((props[k] && props[k].description) || 'required') + (/[.!?]$/.test((props[k] && props[k].description) || '') ? '' : '.'));
    return out;
  }

  // ----------------------------------------------------------------------------------------------
  // Commands
  // ----------------------------------------------------------------------------------------------
  const ID = { type: 'string', description: 'Element id, e.g. "B1" (building) or "P1" (parking). See listElements.', 'x-ref': 'element' };
  const commands = [];
  const def = (c) => commands.push(c);

  def({
    name: 'addBuilding',
    title: 'Add building',
    description: 'Add a rectangular building. Omit the centre to place it in the middle of the buildable area (inside all setbacks). ' +
      'The finished floor (pad) elevation starts at the average existing ground under it. Returns the new id, area, ' +
      'whether it fits inside the buildable area, and lot coverage.',
    mutates: true,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Label, e.g. "Warehouse A".' },
        widthFt: { type: 'number', minimum: 20, maximum: 3000, description: 'Building length along its main axis, ft.' },
        depthFt: { type: 'number', minimum: 20, maximum: 2000, description: 'Building depth across its main axis, ft.' },
        heightFt: { type: 'number', minimum: 10, maximum: 250, default: 40, description: 'Building height above finished floor, ft (default 40).' },
        centerXFt: { type: 'number', description: 'Easting of the building centre, PA South State Plane ft. Omit to use the middle of the buildable area.' },
        centerYFt: { type: 'number', description: 'Northing of the building centre, PA South State Plane ft. Omit to use the middle of the buildable area.' },
        rotationDeg: { type: 'number', minimum: -360, maximum: 360, default: 0, description: 'Rotation of the main axis, degrees counter-clockwise from east (0 = long side runs east-west).' },
      },
      required: ['widthFt', 'depthFt'],
    },
    testInput: { name: 'Warehouse A', widthFt: 600, depthFt: 400, heightFt: 40, rotationDeg: 0 },
    run(ctx, i) {
      if ((i.centerXFt === undefined) !== (i.centerYFt === undefined)) throw new Error('Give both centerXFt and centerYFt, or neither.');
      const c = i.centerXFt !== undefined ? [i.centerXFt, i.centerYFt] : app.site.buildingCenter;
      const st = app.state;
      const id = 'B' + ++st.counters.B;
      const el = { id, type: 'building', name: i.name || 'Building ' + id.slice(1), cxFt: c[0], cyFt: c[1], widthFt: i.widthFt, depthFt: i.depthFt, heightFt: i.heightFt, rotationDeg: i.rotationDeg, padElevFt: null, padElevSource: 'auto' };
      const ring = elementRing(el);
      el.padElevFt = avgGround(ring);
      st.elements.push(el);
      const d = describeEl(el), cov = coverage();
      return {
        summary: `Added ${id} "${el.name}": ${F.n(i.widthFt)} x ${F.n(i.depthFt)} ft (${F.sf(d.footprintSf)}, ${F.ac(d.footprintSf / 43560)}), ` +
          `${F.ft(i.heightFt, 0)} tall. Finished floor ${F.ft(el.padElevFt)} (average existing ground). ` +
          (d.insideBuildableArea ? 'It fits inside the buildable area. ' : 'It does NOT fit inside the buildable area (crosses a setback line). ') +
          `Lot coverage now ${F.n(cov.pct, 1)}%` + (cov.maxPct != null ? ` (max ${cov.maxPct}%).` : '.'),
        data: { element: d, lotCoveragePct: LD.round(cov.pct, 2) },
        changedIds: [id],
      };
    },
  });

  def({
    name: 'moveElement',
    title: 'Move element',
    description: 'Move or rotate a building or parking field. Give dxFt/dyFt to shift it (east/north positive), or centerXFt/centerYFt ' +
      'for an exact position; optionally rotationDeg (absolute) or rotateByDeg. Returns the new position and whether it is still inside the setbacks.',
    mutates: true,
    inputSchema: {
      type: 'object',
      properties: {
        id: ID,
        dxFt: { type: 'number', description: 'Shift east (+) or west (-), ft.' },
        dyFt: { type: 'number', description: 'Shift north (+) or south (-), ft.' },
        centerXFt: { type: 'number', description: 'New easting of the centre, PA South State Plane ft.' },
        centerYFt: { type: 'number', description: 'New northing of the centre, PA South State Plane ft.' },
        rotationDeg: { type: 'number', minimum: -360, maximum: 360, description: 'New rotation, degrees counter-clockwise from east.' },
        rotateByDeg: { type: 'number', minimum: -360, maximum: 360, description: 'Rotate by this many degrees (counter-clockwise +).' },
      },
      required: ['id'],
    },
    testInput: { id: 'B1', dxFt: 100, dyFt: 0 },
    run(ctx, i) {
      const el = getEl(i.id);
      const shift = i.dxFt !== undefined || i.dyFt !== undefined;
      const abs = i.centerXFt !== undefined || i.centerYFt !== undefined;
      if (shift && abs) throw new Error('Give either dxFt/dyFt or centerXFt/centerYFt, not both.');
      if (abs && (i.centerXFt === undefined || i.centerYFt === undefined)) throw new Error('Give both centerXFt and centerYFt.');
      if (i.rotationDeg !== undefined && i.rotateByDeg !== undefined) throw new Error('Give rotationDeg or rotateByDeg, not both.');
      if (!shift && !abs && i.rotationDeg === undefined && i.rotateByDeg === undefined) throw new Error('Nothing to do: give a shift, a new centre or a rotation.');
      const from = [el.cxFt, el.cyFt];
      if (shift) { el.cxFt += i.dxFt || 0; el.cyFt += i.dyFt || 0; }
      if (abs) { el.cxFt = i.centerXFt; el.cyFt = i.centerYFt; }
      const key = el.type === 'building' ? 'rotationDeg' : 'angleDeg';
      if (i.rotationDeg !== undefined) el[key] = i.rotationDeg;
      if (i.rotateByDeg !== undefined) el[key] = (el[key] || 0) + i.rotateByDeg;
      const ring = elementRing(el);
      let elevNote = '';
      if (el.type === 'building' && el.padElevSource === 'auto') { el.padElevFt = avgGround(ring); elevNote = ` Finished floor follows the ground: now ${F.ft(el.padElevFt)}.`; }
      if (el.type === 'parking' && el.elevSource === 'auto') { el.elevFt = avgGround(ring); elevNote = ` Surface elevation follows the ground: now ${F.ft(el.elevFt)}.`; }
      const inside = insideAny(ring, el.type === 'building' ? app.site.buildingEnvelope : app.site.parkingEnvelope);
      const moved = Math.hypot(el.cxFt - from[0], el.cyFt - from[1]);
      return {
        summary: `Moved ${el.id} "${el.name}" ${F.ft(moved, 0)}` + (i.rotationDeg !== undefined || i.rotateByDeg !== undefined ? `, rotation now ${F.n(el[key], 1)} deg` : '') + '. ' +
          (inside ? 'It is inside the setbacks.' : 'It now crosses a setback line.') + elevNote,
        data: { element: describeEl(el), movedFt: LD.round(moved, 1) },
        changedIds: [el.id],
      };
    },
  });

  def({
    name: 'setPadElevation',
    title: 'Set pad elevation',
    description: 'Set the finished floor (pad) elevation of a building, or the surface elevation at the centre of a parking field, in feet (NAVD88). ' +
      'Returns the average existing ground under it and the resulting average cut or fill depth. Run runGrading afterwards for earthwork volumes.',
    mutates: true,
    inputSchema: {
      type: 'object',
      properties: { id: ID, elevationFt: { type: 'number', minimum: -100, maximum: 4000, description: 'Finished elevation, ft NAVD88.' } },
      required: ['id', 'elevationFt'],
    },
    testInput: { id: 'B1', elevationFt: null },
    run(ctx, i) {
      const el = getEl(i.id);
      const ground = avgGround(elementRing(el));
      if (Math.abs(i.elevationFt - ground) > 60)
        throw new Error(`${F.ft(i.elevationFt)} is more than 60 ft from the existing ground under ${el.id} (${F.ft(ground)}). Check the number.`);
      if (el.type === 'building') { el.padElevFt = LD.round(i.elevationFt, 2); el.padElevSource = 'set'; }
      else { el.elevFt = LD.round(i.elevationFt, 2); el.elevSource = 'set'; }
      const d = i.elevationFt - ground;
      return {
        summary: `${el.id} "${el.name}" ${el.type === 'building' ? 'finished floor' : 'surface (at centre)'} set to ${F.ft(i.elevationFt, 2)}. ` +
          `Existing ground under it averages ${F.ft(ground)}, so on average this is ${F.ft(Math.abs(d))} of ${d >= 0 ? 'fill' : 'cut'}. Run grading for volumes.`,
        data: { id: el.id, elevationFt: i.elevationFt, existingGroundAvgFt: ground, averageDepthFt: LD.round(d, 2), kind: d >= 0 ? 'fill' : 'cut' },
        changedIds: [el.id],
      };
    },
  });

  def({
    name: 'addParking',
    title: 'Add parking',
    description: 'Add a car parking field (10 x 20 ft stalls, 24 ft two-way aisles, landscape islands, ADA stalls per 2010 ADA Table 208.2). ' +
      'Either give nearBuildingId + side to put it alongside a building, or a centre point; give a target number of stalls, or rows and lengthFt. ' +
      'Returns the stall counts the app laid out (standard, accessible, van) and the field size.',
    mutates: true,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Label, e.g. "Employee parking".' },
        stalls: { type: 'integer', minimum: 1, maximum: 5000, description: 'Target number of stalls; the field is sized to reach at least this many.' },
        nearBuildingId: { type: 'string', description: 'Put the field alongside this building (e.g. "B1").', 'x-ref': 'building' },
        side: { type: 'string', enum: ['north', 'south', 'east', 'west'], description: 'Which side of the building (with nearBuildingId).' },
        gapFt: { type: 'number', minimum: 0, maximum: 500, default: 10, description: 'Space between building and parking (sidewalk), ft. Default 10.' },
        rows: { type: 'integer', minimum: 1, maximum: 40, description: 'Number of stall rows (2 rows share one aisle).' },
        lengthFt: { type: 'number', minimum: 60, maximum: 3000, description: 'Length of the rows, ft.' },
        centerXFt: { type: 'number', description: 'Easting of the field centre (when not next to a building).' },
        centerYFt: { type: 'number', description: 'Northing of the field centre (when not next to a building).' },
        angleDeg: { type: 'number', minimum: -360, maximum: 360, description: 'Direction the rows run, degrees counter-clockwise from east (when not next to a building).' },
      },
    },
    testInput: { name: 'Employee parking', stalls: 120, nearBuildingId: 'B1', side: 'south', gapFt: 10 },
    run(ctx, i) {
      const c = P.criteriaFor(app.site);
      let center, angle = i.angleDeg || 0, lengthFt = i.lengthFt, rows = i.rows;
      if (i.nearBuildingId) {
        const b = getEl(i.nearBuildingId);
        if (b.type !== 'building') throw new Error(i.nearBuildingId + ' is not a building.');
        if (!i.side) throw new Error('Say which side of the building: north, south, east or west.');
        const want = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] }[i.side];
        const r = (b.rotationDeg * Math.PI) / 180;
        const axes = [
          { n: [Math.cos(r), Math.sin(r)], half: b.widthFt / 2, along: b.depthFt },
          { n: [-Math.cos(r), -Math.sin(r)], half: b.widthFt / 2, along: b.depthFt },
          { n: [-Math.sin(r), Math.cos(r)], half: b.depthFt / 2, along: b.widthFt },
          { n: [Math.sin(r), -Math.cos(r)], half: b.depthFt / 2, along: b.widthFt },
        ];
        const ax = axes.sort((p, q) => q.n[0] * want[0] + q.n[1] * want[1] - (p.n[0] * want[0] + p.n[1] * want[1]))[0];
        lengthFt = lengthFt || ax.along;
        if (!rows) {
          rows = 2;
          if (i.stalls) {
            rows = 0;
            for (let r = 1; r <= 40; r++) if (P.makeField({ origin: [0, 0], angleDeg: 0, lengthFt, rows: r }, c).stallsTotal >= i.stalls) { rows = r; break; }
            if (!rows) throw new Error(`${i.stalls} stalls do not fit along the ${i.side} side of ${b.id} even with 40 rows.`);
          }
        }
        const depth = P.fieldDepthFt(rows, c);
        const off = ax.half + (i.gapFt || 0) + depth / 2;
        center = [b.cxFt + ax.n[0] * off, b.cyFt + ax.n[1] * off];
        angle = (Math.atan2(-ax.n[0], ax.n[1]) * 180) / Math.PI; // rows run along the building side
      } else {
        if ((i.centerXFt === undefined) !== (i.centerYFt === undefined)) throw new Error('Give both centerXFt and centerYFt, or neither.');
        center = i.centerXFt !== undefined ? [i.centerXFt, i.centerYFt] : app.site.parkingCenter;
        rows = rows || 2;
        if (!lengthFt) {
          if (!i.stalls) throw new Error('Give a number of stalls, or rows and lengthFt.');
          lengthFt = P.lengthForStalls(i.stalls, rows, c);
          if (!lengthFt) throw new Error('That many stalls needs rows longer than 5,000 ft; add more rows.');
        }
      }
      const st = app.state;
      const id = 'P' + ++st.counters.P;
      const el = { id, type: 'parking', name: i.name || 'Parking ' + id.slice(1), cxFt: center[0], cyFt: center[1], lengthFt: LD.round(lengthFt, 1), rows, angleDeg: LD.round(angle, 2), elevFt: null, elevSource: 'auto' };
      const f = parkingField(el);
      if (f.stallsTotal === 0) throw new Error(`A ${F.ft(lengthFt, 0)} row is too short for any stalls after the end islands and aisles.`);
      el.elevFt = avgGround(f.polygon);
      st.elements.push(el);
      const d = describeEl(el);
      return {
        summary: `Added ${id} "${el.name}": ${F.n(f.stallsTotal)} stalls (${F.n(f.stallsStd)} standard + ${F.n(f.stallsAda)} accessible, ${f.stallsVan} van), ` +
          `${F.n(el.lengthFt)} x ${F.n(f.depthFt)} ft, ${rows} rows. ` +
          (i.stalls && f.stallsTotal < i.stalls ? `Only ${f.stallsTotal} of the ${i.stalls} requested fit. ` : '') +
          (d.insideParkingArea ? 'Inside the parking setbacks.' : 'It crosses a parking setback line.'),
        data: { element: d },
        changedIds: [id],
      };
    },
  });

  def({
    name: 'runGrading',
    title: 'Run grading',
    description: 'Compute earthwork for the current layout on a 5 ft grid: building pads flat at their finished floor (less an 1.17 ft slab section), ' +
      'parking at 1.5% slope (less a 1.0 ft pavement section), and slopes tying back to existing ground at slopeRatio:1. ' +
      'Returns cut, fill and net in cubic yards, retaining walls where slopes do not fit, and grading that crosses the property line. ' +
      'Optional balanceBuildingId: first find that building\'s finished floor that makes cut and fill balance, and set it.',
    mutates: true,
    inputSchema: {
      type: 'object',
      properties: {
        slopeRatio: { type: 'number', minimum: 1.5, maximum: 10, default: 3, description: 'Side slope back to existing ground, horizontal:1 vertical (default 3).' },
        shrinkPct: { type: 'number', minimum: 0, maximum: 40, default: 10, description: 'Cut shrink factor, % (default 10): net = cut x (1 - shrink) - fill.' },
        balanceBuildingId: { type: 'string', description: 'Optional: building whose finished floor is adjusted so earthwork balances.', 'x-ref': 'building' },
      },
    },
    testInput: { slopeRatio: 3, shrinkPct: 10 },
    run(ctx, i) {
      const st = app.state, site = app.site;
      if (!st.elements.length) throw new Error('Nothing to grade yet: add a building or parking first.');
      const crit = Object.assign({}, GR.CRITERIA, { tieInSlopeHtoV: i.slopeRatio, shrinkPct: i.shrinkPct });
      const balance = i.balanceBuildingId ? getEl(i.balanceBuildingId) : null;
      if (balance && balance.type !== 'building') throw new Error(i.balanceBuildingId + ' is not a building.');
      const build = (balancing) => st.elements.map((el) => {
        if (el.type === 'building') {
          const ring = G.rectRing(el.cxFt, el.cyFt, el.widthFt + 2 * crit.padOverbuildFt, el.depthFt + 2 * crit.padOverbuildFt, el.rotationDeg);
          const free = balancing && el === balance;
          return GR.flatPad(el.id, ring, { name: el.name, elevFt: free ? null : el.padElevFt, ffeOffsetFt: 0, sectionFt: crit.sectionBuildingSlabFt });
        }
        const f = parkingField(el);
        return GR.planarPad(el.id, f.polygon, { name: el.name, origin: [el.cxFt, el.cyFt], dirDeg: el.angleDeg + 90, slopePct: crit.parkingSlopePct, elevAtOriginFt: el.elevFt, sectionFt: crit.sectionStandardAsphaltFt, category: 'parking' });
      });
      // Grid: all footprints plus room for the side slopes, clipped to the terrain.
      const rings = build(false).map((o) => o.region[0]);
      const bb = G.bbox(rings);
      const relief = Math.max(10, site.elevMaxFt - site.elevMinFt);
      const margin = Math.min(500, crit.tieInSlopeHtoV * relief + 50);
      const ext = site.extent;
      const box = { minX: Math.max(ext.xMin, bb.minX - margin), minY: Math.max(ext.yMin, bb.minY - margin), maxX: Math.min(ext.xMax, bb.maxX + margin), maxY: Math.min(ext.yMax, bb.maxY + margin) };
      let cell = crit.gridCellFt;
      while (((box.maxX - box.minX) / cell) * ((box.maxY - box.minY) / cell) > 1.5e6) cell += 1;
      const spec = Grid.specForBBox(box, cell);
      const existing = Grid.resample(site.terrain, spec);
      let note = '';
      if (balance) {
        const m0 = GR.makeModel({ existing, objects: build(true), criteria: crit, parcel: site.parcelRing });
        const ground = avgGround(elementRing(balance));
        const sol = GR.solveFfe(m0, { targetNetCf: 0, minFt: ground - 40, maxFt: ground + 40 });
        balance.padElevFt = LD.round(sol.ffeFt, 1);
        balance.padElevSource = 'balanced';
        note = sol.bound === 'none'
          ? `Finished floor of ${balance.id} set to ${F.ft(balance.padElevFt)} to balance cut and fill (rounded to 0.1 ft, so a small remainder is left). `
          : `Could not fully balance: ${balance.id} finished floor set to the limit of ${F.ft(balance.padElevFt)} (40 ft from existing ground). `;
      }
      const m = GR.makeModel({ existing, objects: build(false), criteria: crit, parcel: site.parcelRing });
      const r = GR.evaluateModel(m, 0);
      const cy = (cf) => Math.round(cf / 27);
      const cat = (name) => r.byCategory.find((c) => c.category === name) || { cutCf: 0, fillCf: 0, areaSf: 0 };
      const walls = r.walls.map((w) => ({ id: w.id, lengthFt: Math.round(w.lengthFt), maxHeightFt: LD.round(w.maxHeightFt, 1), between: w.betweenObjectIds }));
      const res = {
        cutCy: cy(r.cutCf), fillCy: cy(r.fillCf), netCy: cy(r.netCf),
        netMeaning: r.netCf >= 0 ? 'surplus (export)' : 'shortfall (import)',
        shrinkPct: crit.shrinkPct, slopeRatio: crit.tieInSlopeHtoV, gridCellFt: cell,
        byPart: {
          buildingPads: { cutCy: cy(cat('pad').cutCf), fillCy: cy(cat('pad').fillCf) },
          parking: { cutCy: cy(cat('parking').cutCf), fillCy: cy(cat('parking').fillCf) },
          sideSlopes: { cutCy: cy(cat('tieIn').cutCf), fillCy: cy(cat('tieIn').fillCf) },
        },
        maxCutFt: LD.round(r.maxCutFt, 1), maxFillFt: LD.round(r.maxFillFt, 1),
        disturbedAc: LD.round(r.disturbedSf / 43560, 2),
        walls, offsiteGradingSf: Math.round(r.offsiteAreaSf), offsiteMaxDepthFt: LD.round(r.offsiteMaxDeltaFt, 1),
        pads: st.elements.map((e) => ({ id: e.id, elevationFt: e.type === 'building' ? e.padElevFt : e.elevFt })),
        stale: false,
      };
      st.grading = res;
      st.checks && (st.checks.stale = true);
      app.display.grading = { spec, existing: existing.data, proposed: r.proposed, wallHeight: r.wallHeight };
      const wallTxt = walls.length ? `${walls.length} retaining wall${walls.length > 1 ? 's' : ''} needed (tallest ${F.ft(walls[0].maxHeightFt)}). ` : 'No retaining walls needed. ';
      const offTxt = r.offsiteAreaSf > 0 ? `Side slopes cross the property line over ${F.sf(r.offsiteAreaSf)} (up to ${F.ft(r.offsiteMaxDeltaFt)} deep): grading easement or a wall needed. ` : '';
      return {
        summary: note + `Cut ${F.cy(res.cutCy)}, fill ${F.cy(res.fillCy)}; net ${F.cy(Math.abs(res.netCy))} ${res.netMeaning} after ${crit.shrinkPct}% shrink. ` +
          `Deepest cut ${F.ft(res.maxCutFt)}, deepest fill ${F.ft(res.maxFillFt)}; ${F.ac(res.disturbedAc)} disturbed. ` + wallTxt + offTxt,
        data: res,
        changedIds: balance ? [balance.id] : [],
        keepResults: true,
      };
    },
  });

  def({
    name: 'checkSetbacks',
    title: 'Check setbacks',
    description: 'Check every building and parking field against the zoning: distance to each property line versus the required setback ' +
      '(front setbacks are measured from the assumed road right-of-way), building height versus the maximum, and lot coverage. ' +
      'Returns pass/fail per check with the ordinance section.',
    mutates: false,
    inputSchema: { type: 'object', properties: {} },
    testInput: {},
    run() {
      const site = app.site, st = app.state;
      if (!st.elements.length) throw new Error('Nothing to check yet: add a building or parking first.');
      const rows = [];
      for (const el of st.elements) {
        const ring = elementRing(el);
        const isB = el.type === 'building';
        const outside = !G.ringInsidePoly(ring, site.parcelPoly);
        if (outside) {
          rows.push({ id: el.id, check: 'Inside property', pass: false, valueFt: null, limitFt: null, section: null, message: `${el.id} "${el.name}" extends outside the property line.` });
        }
        let worst = null;
        for (const e of site.edges) {
          const req = isB ? e.buildingSetbackFt : e.parkingSetbackFt;
          if (req == null || req <= 0) continue;
          const d = outside && !G.ringsTouch(ring, site.parcelRing) ? 0 : G.ringSegDist(ring, e.a, e.b);
          const margin = d - req;
          if (!worst || margin < worst.margin) worst = { e, d, req, margin };
        }
        if (worst) {
          const e = worst.e, pass = worst.margin >= -0.05;
          const zoneReq = isB ? { front: site.zv('frontSetbackFt'), side: site.zv('sideSetbackFt'), rear: site.zv('rearSetbackFt') }[e.type] : (e.type === 'front' ? site.zv('parkingSetbackFromRowFt') : site.zv('parkingSetbackSideRearFt'));
          const how = e.type === 'front' && e.rowInsetFt > 0 ? ` (${F.ft(zoneReq, 0)} from the assumed road right-of-way + ${F.ft(e.rowInsetFt)} to the property line)` : '';
          rows.push({
            id: el.id, check: (isB ? 'Building' : 'Parking') + ' setback', pass,
            valueFt: LD.round(worst.d, 1), limitFt: LD.round(worst.req, 1), marginFt: LD.round(worst.margin, 1),
            section: isB ? e.section : e.parkingSection, edge: LD.site.edgeLabel(e),
            message: `${el.id} is ${F.ft(worst.d)} from the ${LD.site.edgeLabel(e)}; ${F.ft(worst.req)} required${how}. ` +
              (pass ? `Passes with ${F.ft(worst.margin)} to spare.` : `Fails by ${F.ft(-worst.margin)}.`),
          });
        }
        if (isB) {
          const maxH = site.zv('maxHeightFt');
          if (maxH != null) rows.push({
            id: el.id, check: 'Building height', pass: el.heightFt <= maxH, valueFt: el.heightFt, limitFt: maxH, section: site.zsec('maxHeightFt'),
            message: `${el.id} is ${F.ft(el.heightFt, 0)} tall; max ${F.ft(maxH, 0)}.`,
          });
        }
        for (const w of (site.features.wetlands && site.features.wetlands.items) || [])
          if (G.ringsTouch(ring, w.polygon.outer))
            rows.push({ id: el.id, check: 'Wetland (mapped)', pass: false, informational: true, section: null, message: `${el.id} overlaps a mapped NWI wetland (${w.wetlandType}). Planning-level mapping: a delineation is needed.` });
      }
      for (let a = 0; a < st.elements.length; a++)
        for (let b = a + 1; b < st.elements.length; b++)
          if (G.ringsTouch(elementRing(st.elements[a]), elementRing(st.elements[b])))
            rows.push({ id: st.elements[a].id + '/' + st.elements[b].id, check: 'Overlap', pass: false, section: null, message: `${st.elements[a].id} and ${st.elements[b].id} overlap.` });
      const cov = coverage();
      if (cov.maxPct != null && cov.buildingSf > 0) rows.push({
        id: 'site', check: 'Lot coverage', pass: cov.pct <= cov.maxPct, valuePct: LD.round(cov.pct, 2), limitPct: cov.maxPct, section: site.zsec('maxLotCoveragePct'),
        message: `Buildings cover ${F.n(cov.pct, 1)}% of the lot (${F.sf(cov.buildingSf)}); max ${cov.maxPct}%.`,
      });
      const failing = rows.filter((r) => !r.pass && !r.informational);
      st.checks = { rows, failing: failing.length, total: rows.filter((r) => !r.informational).length, stale: false, zoningVerified: !!site.zoning.verified };
      return {
        summary: (failing.length ? `${failing.length} of ${st.checks.total} checks FAIL: ` + failing.map((r) => r.message).join(' ') : `All ${st.checks.total} checks pass.`) +
          (site.zoning.verified ? '' : ' (Zoning values are unverified; confirm with the township.)'),
        data: st.checks,
        changedIds: [],
        keepResults: true,
      };
    },
  });

  def({
    name: 'getSiteSummary',
    title: 'Site summary',
    description: 'Read-only. The site, parcel, zoning limits, buildable area (with a suggested centre point), existing ground range, ' +
      'all current elements, and the latest grading and setback results. Coordinates are PA South State Plane feet (x = east, y = north).',
    mutates: false,
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    testInput: {},
    run() { return { summary: 'Site summary returned.', data: siteSummary() }; },
  });

  def({
    name: 'listElements',
    title: 'List elements',
    description: 'Read-only. Every building and parking field with id, size, position, elevation and stall counts.',
    mutates: false,
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    testInput: {},
    run() {
      const list = app.state.elements.map(describeEl);
      return { summary: list.length ? list.map((e) => `${e.id} ${e.name}`).join(', ') : 'No elements yet.', data: { elements: list } };
    },
  });

  function siteSummary() {
    const s = app.site, md = s.meta, z = s.zoning;
    const bb = s.parcelBBox;
    const envBB = s.buildingEnvelope.length ? G.bbox(s.buildingEnvelope.map((p) => p.outer)) : null;
    const vals = {};
    for (const [k, v] of Object.entries(z.values || {})) vals[k] = v.value;
    return {
      site: md.siteName, address: md.address, municipality: md.municipality, county: md.county, parcelId: md.parcelId,
      coordinateSystem: 'PA South State Plane (EPSG:2272), US survey feet; x = east, y = north; elevations NAVD88 ft',
      parcel: {
        areaAc: LD.round(s.parcelAreaSf / 43560, 2),
        bbox: { minX: Math.round(bb.minX), minY: Math.round(bb.minY), maxX: Math.round(bb.maxX), maxY: Math.round(bb.maxY) },
        frontage: [...new Set(s.edges.filter((e) => e.type === 'front').map((e) => e.road))],
      },
      buildableArea: {
        buildingAc: s.pkg.derived.buildingEnvelopeAreaAc, parkingAc: s.pkg.derived.parkingEnvelopeAreaAc,
        buildingBBox: envBB && { minX: Math.round(envBB.minX), minY: Math.round(envBB.minY), maxX: Math.round(envBB.maxX), maxY: Math.round(envBB.maxY) },
        suggestedBuildingCenter: s.buildingCenter.map((v) => Math.round(v)),
      },
      existingGroundFt: { min: LD.round(s.elevMinFt, 1), max: LD.round(s.elevMaxFt, 1) },
      zoning: { district: z.district, name: z.districtName, verified: !!z.verified, limits: vals },
      elements: app.state.elements.map(describeEl),
      lotCoveragePct: LD.round(coverage().pct, 2),
      lastGrading: app.state.grading,
      lastChecks: app.state.checks && { failing: app.state.checks.failing, total: app.state.checks.total, stale: app.state.checks.stale, failures: app.state.checks.rows.filter((r) => !r.pass).map((r) => r.message) },
      warnings: md.warnings,
    };
  }

  // ----------------------------------------------------------------------------------------------
  // Running commands, history and undo
  // ----------------------------------------------------------------------------------------------
  const byName = {};
  for (const c of commands) byName[c.name] = c;

  /** Run a command. Returns {ok, summary, data, entry} or {ok:false, error}. Never throws. */
  function execute(name, rawInput, source) {
    const cmd = byName[name];
    if (!cmd) return { ok: false, error: 'Unknown command "' + name + '".' };
    if (!app.site) return { ok: false, error: 'Load a site package first.' };
    const before = JSON.stringify(app.state);
    const beforeDisplay = app.display.grading;
    let input, res;
    try {
      input = cleanInput(cmd.inputSchema, rawInput);
      res = cmd.run({}, input);
    } catch (e) {
      app.state = JSON.parse(before); // nothing half-done survives an error
      app.display.grading = beforeDisplay;
      return { ok: false, error: e.message || String(e) };
    }
    let entry = null;
    if (cmd.mutates) {
      if (!res.keepResults) invalidateResults();
      entry = { seq: ++app.seq, name, title: cmd.title, input, summary: res.summary, source: source || 'test', before };
      app.history.push(entry);
    }
    app.emit('change', { name, result: res, entry });
    return { ok: true, summary: res.summary, data: res.data, entry };
  }

  /** Undo the step with this seq and every step after it. */
  function undoTo(seq) {
    const idx = app.history.findIndex((h) => h.seq === seq);
    if (idx < 0) return { ok: false, error: 'That step is no longer in the history.' };
    const undone = app.history.splice(idx);
    app.state = JSON.parse(undone[0].before);
    app.display.grading = null;
    if (app.state.grading) app.state.grading.stale = true;
    app.emit('change', { undo: undone.map((u) => u.seq) });
    return { ok: true, undone: undone.length };
  }

  LD.commands = { list: commands, byName, execute, undoTo, describeEl, elementRing, parkingField, siteSummary, cleanInput };
})();
