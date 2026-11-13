/** Export builders: DXF (state plane ft, AIA layers), GeoJSON (WGS84), XLSX sheet models. */
import { buildAssumptions } from '../checks/assumptions';
import type { XlsxSheet } from '../commands/registry';
import { type Pt, type Ring, bboxOf, expandBBox, pointInRing, radToDeg, ringCentroid, simplifyPolyline, toWorld } from '../geometry/basic';
import { toLonLat } from '../geometry/crs';
import { type ContourSet, contours, gridSpecForBBox, resampleGrid } from '../geometry/grid';
import { gradeScenario, gradingDisplay } from '../grading/scenario';
import { buildingFrame, officeRing, parkingStallGeometry } from '../layout/building';
import type { Site } from '../site/model';
import type { Building, Project, Scenario } from '../site/project';
import { fmtInt } from '../site/units';
import { buildEnvelopes } from '../zoning/envelopes';
import { DXF_LAYERS, DxfWriter } from './dxf';

export const DISCLAIMER = 'Concept-level, not for construction.';

function header(p: Project, s: Scenario, now: string): string[] {
  const site = p.site!;
  return [
    `Groundwork (EFCG demo) - ${site.name} - Scenario ${s.id}: ${s.name}`,
    `Exported ${now.slice(0, 10)} - revision ${p.revision} - ${site.crs.name} (EPSG:${site.crs.epsg}), US survey feet, elevations in ft NAVD88`,
    `${DISCLAIMER}${site.synthetic ? ' SYNTHETIC site data (generated placeholder).' : ''}`,
  ];
}

function contourLayers(w: DxfWriter, sets: ContourSet[], minor: string, major: string, keep?: (p: Pt) => boolean): void {
  for (const c of sets) {
    for (const line of c.lines) {
      const pts = simplifyPolyline(line, 0.4);
      if (pts.length < 2) continue;
      if (keep && !keep(pts[Math.floor(pts.length / 2)])) continue;
      w.polyline(c.index ? major : minor, pts, false, c.levelFt);
    }
  }
}

export function buildDxf(p: Project, s: Scenario, now: string): { content: string; counts: Record<string, number> } {
  const site = p.site as Site;
  const w = new DxfWriter(DXF_LAYERS);
  const c = s.layoutCriteria;
  w.polyline('C-PROP', site.parcel.ring, true);
  if (p.rules) {
    const env = buildEnvelopes(site, p.rules);
    for (const r of env.building) w.polyline('C-SETB', r, true);
    for (const r of env.parking) w.polyline('C-SETB', r, true);
  }
  for (const r of site.roads) {
    w.polyline('C-ROAD-EXST', r.centerline, false);
    const mid = r.centerline[Math.floor(r.centerline.length / 2) - (r.centerline.length > 2 ? 0 : 1)] ?? r.centerline[0];
    const a = r.centerline[0];
    const b = r.centerline[r.centerline.length - 1];
    const at: Pt = r.centerline.length > 2 ? mid : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let ang = radToDeg(Math.atan2(b[1] - a[1], b[0] - a[0]));
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    w.text('C-ANNO', at, 14, r.name.toUpperCase(), ang);
  }
  for (const k of site.constraints) {
    w.polyline(k.kind === 'wetland' ? 'C-WETL' : 'C-ANNO', k.ring, true);
    w.text('C-ANNO', ringCentroid(k.ring), 10, k.name);
  }
  for (const o of s.objects) {
    switch (o.type) {
      case 'building': {
        w.polyline('C-BLDG', o.polygon, true);
        w.polyline('C-BLDG', officeRing(o), true);
        const f = buildingFrame(o);
        w.text('C-ANNO', toWorld(f, [-o.lengthFt / 2 + 30, 14]), 18, `${fmtInt(o.areaSf)} SF ${o.buildingType === 'crossDock' ? 'CROSS-DOCK' : 'REAR-LOAD'} ${fmtInt(o.lengthFt)} x ${fmtInt(o.depthFt)} FT`, o.rotationDeg);
        if (s.grading.graded && s.grading.ffeFt !== null) w.text('C-ANNO', toWorld(f, [-o.lengthFt / 2 + 30, -18]), 18, `FFE ${s.grading.ffeFt.toFixed(1)}`, o.rotationDeg);
        break;
      }
      case 'truckCourt': {
        w.polyline('C-TRCK', o.polygon, true);
        const b = s.objects.find((x): x is Building => x.type === 'building');
        if (b && o.trailerUv && o.trailerStalls) {
          const f = buildingFrame(b);
          const [u0, v0, u1, v1] = o.trailerUv;
          const total = Math.floor((u1 - u0) / c.trailerStallWidthFt);
          const start = u0 + ((total - o.trailerStalls) / 2) * c.trailerStallWidthFt;
          for (let k = 0; k <= o.trailerStalls; k++) w.line('C-TRCK', toWorld(f, [start + k * c.trailerStallWidthFt, v0]), toWorld(f, [start + k * c.trailerStallWidthFt, v1]));
        }
        break;
      }
      case 'truckApron':
      case 'trailerField':
        w.polyline('C-TRCK', o.polygon, true);
        break;
      case 'parkingField': {
        w.polyline('C-PKNG', o.polygon, true);
        const g = parkingStallGeometry(o, c);
        for (const [a, b] of g.lines) w.line('C-PKNG-STRP', a, b);
        for (const r of [...g.islands, ...g.adaAisles]) w.polyline('C-PKNG', r, true);
        w.text('C-ANNO', ringCentroid(o.polygon), 10, `${o.stallsTotal} STALLS (${o.stallsAda} ADA, ${o.stallsVan} VAN)`, o.angleDeg);
        break;
      }
      case 'driveway':
        w.polyline(o.network === 'truck' ? 'C-TRCK' : 'C-ROAD', o.polygon, true);
        break;
      case 'drive':
        for (const r of o.polygon) w.polyline(o.network === 'truck' ? 'C-TRCK' : 'C-ROAD', r, true);
        break;
      case 'basin': {
        w.polyline('C-STRM-BSIN', o.polygon, true);
        const cx = ringCentroid(o.polygon);
        const inset = o.sideSlopeHtoV * (o.depthFt + o.freeboardFt);
        w.polyline(
          'C-STRM-BSIN',
          o.polygon.map((q): Pt => {
            const dx = q[0] - cx[0];
            const dy = q[1] - cx[1];
            const l = Math.hypot(dx, dy);
            const k = Math.max(0.2, (l - inset * Math.SQRT2) / l);
            return [cx[0] + dx * k, cx[1] + dy * k];
          }),
          true,
        );
        w.text('C-ANNO', cx, 12, `${o.name.toUpperCase()} ${(o.areaSf / 43560).toFixed(2)} AC (PLANNING RESERVATION)`);
        break;
      }
      case 'landscape':
        w.polyline('C-LSCP', o.polygon, true);
        break;
    }
  }

  // Contours inside the parcel + 100 ft.
  const box = expandBBox(bboxOf(site.parcel.ring), 100);
  const near = (q: Pt) => q[0] >= box.minX && q[0] <= box.maxX && q[1] >= box.minY && q[1] <= box.maxY;
  const existing = resampleGrid(site.dem, gridSpecForBBox(box, 5));
  contourLayers(w, contours(existing, 1, 5), 'C-TOPO-EXST-MINR', 'C-TOPO-EXST-MAJR', near);
  if (s.grading.graded && s.grading.ffeFt !== null && s.objects.some((o) => o.type === 'building')) {
    const out = gradeScenario(site, s, s.grading.ffeFt);
    const disp = gradingDisplay(out);
    contourLayers(w, disp.contours, 'C-TOPO-PROP-MINR', 'C-TOPO-PROP-MAJR');
    for (const sp of out.report.spots) w.text('C-ANNO', [sp.at[0] + 4, sp.at[1] + 4], 6, sp.elevFt.toFixed(1));
    for (const wall of out.report.walls) w.text('C-WALL', wall.at, 8, `WALL ${Math.round(wall.lengthFt)} FT x ${wall.maxHeightFt.toFixed(1)} FT`);
  }

  // Title lines below the parcel.
  const b = bboxOf(site.parcel.ring);
  header(p, s, now).forEach((line, i) => w.text('C-ANNO', [b.minX, b.minY - 60 - i * 34], 20, line));
  return { content: w.toString(), counts: { ...w.counts } };
}

function closeRing(ring: Ring, site: Site): number[][] {
  // RFC 7946: [lon, lat], rings closed, exterior counter-clockwise.
  const ll = ring.map((q) => toLonLat(site.crs, q).map((v) => Math.round(v * 1e7) / 1e7));
  ll.push(ll[0]);
  return ll;
}

export function buildGeoJson(p: Project, s: Scenario, now: string): Record<string, unknown> {
  const site = p.site as Site;
  const features: Record<string, unknown>[] = [];
  const poly = (rings: Ring[], properties: Record<string, unknown>) => features.push({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: rings.map((r) => closeRing(r, site)) } });
  poly([site.parcel.ring], { layer: 'parcel', id: site.parcel.id, areaAc: +(site.areaSf / 43560).toFixed(2), district: site.zoningDistrictCode, synthetic: site.synthetic });
  for (const k of site.constraints) poly([k.ring], { layer: 'constraint', id: k.id, kind: k.kind, name: k.name, bufferFt: k.bufferFt });
  for (const o of s.objects) {
    const base: Record<string, unknown> = { layer: 'design', id: o.id, type: o.type, name: o.name, scenario: s.id };
    switch (o.type) {
      case 'building':
        poly([o.polygon], { ...base, areaSf: o.areaSf, lengthFt: o.lengthFt, depthFt: o.depthFt, rotationDeg: o.rotationDeg, dockDoors: o.dockDoors, heightFt: o.heightFt, ffeFt: s.grading.graded ? s.grading.ffeFt : null });
        break;
      case 'truckCourt':
        poly([o.polygon], { ...base, depthFt: o.depthFt, trailerStalls: o.trailerStalls });
        break;
      case 'parkingField':
        poly([o.polygon], { ...base, stalls: o.stallsTotal, ada: o.stallsAda, van: o.stallsVan, slopePct: o.slopePct });
        break;
      case 'trailerField':
        poly([o.polygon], { ...base, stalls: o.stalls });
        break;
      case 'driveway':
        poly([o.polygon], { ...base, network: o.network, road: o.roadName, widthFt: o.widthFt, lanes: o.lanes });
        break;
      case 'drive':
        // Outer rings are counter-clockwise; holes (if any) follow their outer ring.
        poly(o.polygon, { ...base, network: o.network, widthFt: o.widthFt, lengthFt: Math.round(o.lengthFt) });
        features.push({ type: 'Feature', properties: { ...base, layer: 'centerline', network: o.network }, geometry: { type: 'LineString', coordinates: o.centerline.map((q) => toLonLat(site.crs, q).map((v) => Math.round(v * 1e7) / 1e7)) } });
        break;
      case 'basin':
        poly([o.polygon], { ...base, areaAc: +(o.areaSf / 43560).toFixed(2), depthFt: o.depthFt, storageCf: Math.round(o.storageCf), note: 'Planning-level reservation, not a hydrologic design' });
        break;
      default:
        poly([(o as any).polygon as Ring], base);
    }
  }
  return {
    type: 'FeatureCollection',
    name: `groundwork-${site.id}-scenario-${s.id}`,
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
    metadata: { site: site.name, scenario: s.id, exportedAt: now, revision: p.revision, disclaimer: DISCLAIMER, synthetic: site.synthetic, sourceCrs: `EPSG:${site.crs.epsg}` },
    features,
  };
}

export function buildXlsxSheets(p: Project, s: Scenario, now: string): XlsxSheet[] {
  const notes = header(p, s, now);
  const ew = s.results.earthwork;
  const yieldSheet: XlsxSheet = {
    name: 'Yield',
    columns: [{ header: 'Item', width: 38 }, { header: 'Value', width: 16 }, { header: 'Units', width: 10 }, { header: 'Display', width: 22 }, { header: 'Limit / basis', width: 60 }, { header: 'Citation', width: 40 }],
    rows: s.results.yield.map((y) => [y.label, Math.round(y.value * 1000) / 1000, y.units, y.display, y.limit ?? '', y.citation ?? '']),
    notes: [...notes, ...s.results.layoutNotes.map((n) => `Layout note: ${n}`)],
  };
  const compliance: XlsxSheet = {
    name: 'Compliance',
    columns: [{ header: 'Group', width: 13 }, { header: 'Status', width: 9 }, { header: 'Check', width: 44 }, { header: 'Value', width: 12 }, { header: 'Limit', width: 12 }, { header: 'Units', width: 9 }, { header: 'Citation', width: 44 }, { header: 'Finding', width: 110 }, { header: 'Objects', width: 24 }],
    rows: s.checks
      .slice()
      .sort((a, b) => a.group.localeCompare(b.group) || ['fail', 'warn', 'pass', 'n/a'].indexOf(a.status) - ['fail', 'warn', 'pass', 'n/a'].indexOf(b.status))
      .map((k) => [k.group, k.status.toUpperCase(), k.title, k.value, k.limit, k.units, k.citation, k.message, k.objectIds.join(', ')]),
    notes,
  };
  const earth: XlsxSheet = {
    name: 'Earthwork',
    columns: [{ header: 'Item', width: 52 }, { header: 'Cut (CY)', width: 14, numFmt: '#,##0' }, { header: 'Fill (CY)', width: 14, numFmt: '#,##0' }, { header: 'Value', width: 18 }, { header: 'Units', width: 12 }, { header: 'Note', width: 90 }],
    rows: ew
      ? [
          ['Finished floor elevation (FFE)', null, null, ew.ffeFt, 'ft', ew.balance?.note ?? ''],
          ...ew.byCategory.map((b): (string | number | null)[] => [`By area: ${b.category}`, Math.round(b.cutCy), Math.round(b.fillCy), +(b.areaSf / 43560).toFixed(2), 'ac', '']),
          ['Total to subgrade', Math.round(ew.cutCy), Math.round(ew.fillCy), null, '', 'Pavement and slab sections subtracted from finished grade'],
          [`Net = cut x (1 - ${ew.shrinkPct}% shrink) - fill`, null, null, Math.round(ew.netCy), 'CY', ew.netCy >= 0 ? 'Surplus (export)' : 'Deficit (import)'],
          ['Topsoil strip', null, null, Math.round(ew.topsoilStripCy), 'CY', 'Reported separately; assumed reused on site'],
          ['Pavement / slab sections', null, null, Math.round(ew.sectionAdjustmentCy), 'CY', 'Volume of sections between finished grade and subgrade'],
          ['Disturbed area', null, null, +(ew.disturbedAreaSf / 43560).toFixed(2), 'ac', ''],
          ['Max cut depth', null, null, +ew.maxCutFt.toFixed(1), 'ft', ''],
          ['Max fill depth', null, null, +ew.maxFillFt.toFixed(1), 'ft', ''],
          ['Feasible FFE range (drive grades)', null, null, ew.feasibleFfe ? `${ew.feasibleFfe.minFt.toFixed(1)} - ${ew.feasibleFfe.maxFt.toFixed(1)}` : 'n/a', 'ft', ew.feasibleFfe?.binding.join(' | ') ?? ''],
          ['Retaining walls', null, null, Math.round(ew.wallTotalLengthFt), 'ft', ew.walls.length ? ew.walls.map((w) => `${w.id}: ${Math.round(w.lengthFt)} ft x ${w.maxHeightFt.toFixed(1)} ft`).join('; ') : `None (${ew.dockWingWalls.length} dock wing walls at building corners)`],
          ['Offsite grading', null, null, Math.round(ew.offsiteAreaSf), 'SF', ew.offsiteAreaSf > 0 ? 'Needs a grading easement or a wall' : 'None'],
          ...ew.drives.map((d): (string | number | null)[] => [`Drive grade: ${d.name}`, null, null, +d.gradePct.toFixed(2), '%', `max ${d.maxGradePct}%; ${d.startElevFt.toFixed(1)} ft to ${d.endElevFt.toFixed(1)} ft over ${Math.round(d.lengthFt)} ft`]),
          ...ew.spots.map((sp): (string | number | null)[] => [`Spot elevation: ${sp.label}`, null, null, +sp.elevFt.toFixed(1), 'ft', '']),
          ['Grid cell', null, null, ew.gridCellFt, 'ft', 'Grid method; concept-level volumes'],
        ]
      : [['Not graded', null, null, null, '', 'Run grade_site or optimize_ffe']],
    notes,
  };
  const assumptions: XlsxSheet = {
    name: 'Assumptions',
    columns: [{ header: 'Assumption', width: 48 }, { header: 'Value', width: 44 }, { header: 'Source', width: 80 }, { header: 'Changed from default', width: 20 }],
    rows: [
      ...buildAssumptions(p, s).map((a): (string | number | null)[] => [a.label, a.value, a.source, a.changed ? 'yes' : '']),
      ...(p.rules?.rules.flatMap((r) => (r.interpretationFlags ?? []).map((f): (string | number | null)[] => [`Zoning interpretation: ${r.label}`, f, r.citation.section, ''])) ?? []),
    ],
    notes: [...notes, p.rules?.sourceNote ?? ''],
  };
  return [yieldSheet, compliance, earth, assumptions];
}

/** Helper for tests / callers: is a point inside the parcel. */
export function insideParcel(site: Site, q: Pt): boolean {
  return pointInRing(q, site.parcel.ring);
}
