/** Design-object drawing: landscape, basins, truck/car pavement, parking striping, building, selection. */
import {
  type Building,
  type DesignObject,
  type Driveway,
  type ParkingField,
  type Pt,
  type Ring,
  type Scenario,
  type StallGeometry,
  type TruckCourt,
  buildingFrame,
  fmtInt,
  officeRing,
  parkingStallGeometry,
  ringCentroid,
  toWorld,
} from '@groundwork/core';
import type { AppState } from '../lib/app';
import { type LabelReq, type Overlay, type View, fillRegion, pathRing, strokeLine, textAngle, w2s } from './draw';
import { surfaces } from './surfaces';
import type { Palette } from './theme';

const stallCache = new WeakMap<ParkingField, StallGeometry>();

export function scenarioOf(s: AppState): Scenario | null {
  return s.project?.scenarios.find((x) => x.id === s.project!.activeScenarioId) ?? null;
}

/** Handle positions for the selected building (world coords), shared with interact.ts. */
export function buildingHandles(b: Building): { rotate: Pt; resize: { side: '+u' | '-u' | '+v' | '-v'; at: Pt }[] } {
  const f = buildingFrame(b);
  const L2 = b.lengthFt / 2;
  const D2 = b.depthFt / 2;
  return {
    rotate: toWorld(f, [L2 + 70, 0]),
    resize: [
      { side: '+u', at: toWorld(f, [L2, 0]) },
      { side: '-u', at: toWorld(f, [-L2, 0]) },
      { side: '+v', at: toWorld(f, [0, D2]) },
      { side: '-v', at: toWorld(f, [0, -D2]) },
    ],
  };
}

function drawTrailerStalls(ctx: CanvasRenderingContext2D, v: View, b: Building, c: TruckCourt, widthFt: number, pal: Palette): void {
  if (!c.trailerUv || !c.trailerStalls) return;
  const f = buildingFrame(b);
  const [u0, v0, u1, v1] = c.trailerUv;
  // Stalls fill from the middle of the court outward so a partial count stays centered.
  const total = Math.floor((u1 - u0) / widthFt);
  const start = u0 + ((total - c.trailerStalls) / 2) * widthFt;
  ctx.beginPath();
  for (let k = 0; k <= c.trailerStalls; k++) {
    const u = start + k * widthFt;
    const a = w2s(v, toWorld(f, [u, v0]));
    const bb = w2s(v, toWorld(f, [u, v1]));
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(bb[0], bb[1]);
  }
  ctx.strokeStyle = pal.stripe;
  ctx.lineWidth = 0.6;
  ctx.stroke();
  if (v.scale > 0.45) {
    // Trailers: light boxes in every stall.
    ctx.fillStyle = 'rgba(214,220,228,0.28)';
    for (let k = 0; k < c.trailerStalls; k++) {
      const u = start + k * widthFt;
      ctx.beginPath();
      pathRing(ctx, v, [toWorld(f, [u + 1.75, v0 + 1]), toWorld(f, [u + widthFt - 1.75, v0 + 1]), toWorld(f, [u + widthFt - 1.75, v1 - 1]), toWorld(f, [u + 1.75, v1 - 1])]);
      ctx.fill();
    }
  }
}

function drawDockDoors(ctx: CanvasRenderingContext2D, v: View, b: Building, spacingFt: number, pal: Palette): void {
  if (v.scale < 0.3 || !b.doorsPerSide) return;
  const f = buildingFrame(b);
  const span = (b.doorsPerSide - 1) * spacingFt;
  ctx.fillStyle = pal.truckNet;
  for (const side of b.dockSides) {
    const s = side === '+v' ? 1 : -1;
    const vv = (s * b.depthFt) / 2;
    for (let k = 0; k < b.doorsPerSide; k++) {
      const u = -span / 2 + k * spacingFt;
      ctx.beginPath();
      pathRing(ctx, v, [toWorld(f, [u - 4.5, vv - s * 3]), toWorld(f, [u + 4.5, vv - s * 3]), toWorld(f, [u + 4.5, vv + s * 1]), toWorld(f, [u - 4.5, vv + s * 1])]);
      ctx.fill();
    }
  }
}

function drawDrivewayFlare(ctx: CanvasRenderingContext2D, v: View, d: Driveway, color: string): void {
  // Simple flared apron from the right-of-way line out to the travel way (display only; inside the ROW).
  const along: Pt = [d.inward[1], -d.inward[0]];
  const h = d.widthFt / 2;
  const out = 22;
  const flare = Math.min(d.radiusFt, 45) * 0.6;
  const P = (a: number, o: number): Pt => [d.position[0] + along[0] * a - d.inward[0] * o, d.position[1] + along[1] * a - d.inward[1] * o];
  ctx.beginPath();
  pathRing(ctx, v, [P(-h, 0), P(h, 0), P(h + flare, out), P(-h - flare, out)]);
  ctx.fillStyle = color;
  ctx.fill();
}

export function drawDesign(s: AppState, pal: Palette): Overlay {
  return (ctx, v, labels) => {
    const sc = scenarioOf(s);
    if (!sc || !sc.objects.length) return;
    const objs = sc.objects;
    const c = sc.layoutCriteria;
    const building = objs.find((o): o is Building => o.type === 'building');
    const showLabels = s.layers.labels;
    // With the cut/fill map on, draw pavement and the building as outlines so the heatmap reads through.
    const heat = s.layers.cutfill && !!surfaces.get().cutfill;
    if (heat) ctx.globalAlpha = 0.16;
    const label = (text: string, at: Pt, priority: number, o: Partial<LabelReq> = {}) => {
      if (!showLabels) return;
      const p = w2s(v, at);
      if (p[0] < -50 || p[1] < -50 || p[0] > v.w + 50 || p[1] > v.h + 50) return;
      labels.push({ text, x: p[0], y: p[1], priority, ...o });
    };

    // Landscape --------------------------------------------------------------------------------
    for (const o of objs) {
      if (o.type !== 'landscape') continue;
      ctx.globalAlpha = (heat ? 0.2 : 1) * (o.kind === 'buffer' ? 0.5 : 0.8);
      fillRegion(ctx, v, [o.polygon], pal.landscape);
      ctx.globalAlpha = heat ? 0.16 : 1;
    }
    // Basins -----------------------------------------------------------------------------------
    for (const o of objs) {
      if (o.type !== 'basin') continue;
      fillRegion(ctx, v, [o.polygon], pal.basin, pal.basinStroke, 1.2);
      // Bottom outline (3:1 side slopes down the total depth).
      const inset = o.sideSlopeHtoV * (o.depthFt + o.freeboardFt);
      const cx = ringCentroid(o.polygon);
      const inner: Ring = o.polygon.map((p) => {
        const dx = p[0] - cx[0];
        const dy = p[1] - cx[1];
        const l = Math.hypot(dx, dy);
        const k = Math.max(0.2, (l - inset * Math.SQRT2) / l);
        return [cx[0] + dx * k, cx[1] + dy * k] as Pt;
      });
      ctx.setLineDash([4, 4]);
      fillRegion(ctx, v, [inner], null, pal.basinStroke, 0.8);
      ctx.setLineDash([]);
      label(`${o.name.toUpperCase()}\n${(o.areaSf / 43560).toFixed(1)} ac · planning reservation`, cx, 6, { color: '#a9d0f5', size: 10.5 });
    }
    // Truck pavement ---------------------------------------------------------------------------
    for (const o of objs) {
      if (o.type === 'drive' && o.network === 'truck') fillRegion(ctx, v, o.polygon, pal.truck);
      else if (o.type === 'truckApron' || o.type === 'trailerField') fillRegion(ctx, v, [o.polygon], pal.truck);
      else if (o.type === 'driveway' && o.network === 'truck') {
        fillRegion(ctx, v, [o.polygon], pal.truck);
        drawDrivewayFlare(ctx, v, o, pal.truck);
      }
    }
    for (const o of objs) {
      if (o.type !== 'truckCourt' || !building) continue;
      fillRegion(ctx, v, [o.polygon], pal.truck);
      // Concrete dock apron band next to the dock wall.
      const f = buildingFrame(building);
      const sgn = o.side === '+v' ? 1 : -1;
      const d2 = building.depthFt / 2;
      fillRegion(ctx, v, [[toWorld(f, [o.uv[0], sgn * d2]), toWorld(f, [o.uv[2], sgn * d2]), toWorld(f, [o.uv[2], sgn * (d2 + o.apronFt)]), toWorld(f, [o.uv[0], sgn * (d2 + o.apronFt)])]], pal.apron);
      drawTrailerStalls(ctx, v, building, o, c.trailerStallWidthFt, pal);
      label(`TRUCK COURT · ${o.depthFt} ft${o.trailerStalls ? ` · ${o.trailerStalls} trailer stalls` : ''}`, toWorld(f, [0, sgn * (d2 + o.apronFt + c.maneuverLaneFt / 2)]), 5, { color: pal.text, size: 10.5, angle: textAngle([Math.cos((building.rotationDeg * Math.PI) / 180), Math.sin((building.rotationDeg * Math.PI) / 180)]) });
    }
    for (const o of objs) {
      if (o.type !== 'trailerField') continue;
      label(`TRAILER FIELD · ${o.stalls} stalls`, o.center, 5, { size: 10.5 });
    }
    // Car pavement -----------------------------------------------------------------------------
    for (const o of objs) {
      if (o.type === 'drive' && o.network !== 'truck') fillRegion(ctx, v, o.polygon, pal.car);
      else if (o.type === 'driveway' && o.network !== 'truck') {
        fillRegion(ctx, v, [o.polygon], pal.car);
        drawDrivewayFlare(ctx, v, o, pal.car);
      }
    }
    for (const o of objs) {
      if (o.type !== 'parkingField') continue;
      fillRegion(ctx, v, [o.polygon], pal.car);
      let g = stallCache.get(o);
      if (!g) stallCache.set(o, (g = parkingStallGeometry(o, c)));
      for (const isl of g.islands) fillRegion(ctx, v, [isl], pal.landscape);
      for (const a of g.adaStalls) fillRegion(ctx, v, [a], pal.ada);
      if (v.scale > 0.28) {
        ctx.beginPath();
        for (const [a, b] of g.lines) {
          const p = w2s(v, a);
          const q = w2s(v, b);
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(q[0], q[1]);
        }
        ctx.strokeStyle = pal.stripe;
        ctx.lineWidth = 0.6;
        ctx.stroke();
        for (const a of g.adaAisles) {
          ctx.setLineDash([2, 2]);
          fillRegion(ctx, v, [a], 'rgba(76,141,255,0.25)', pal.ada, 0.6);
          ctx.setLineDash([]);
        }
      }
      label(`${o.name.toUpperCase()}\n${o.stallsTotal} stalls · ${o.stallsAda} ADA (${o.stallsVan} van)`, ringCentroid(o.polygon), 6, { size: 10.5 });
    }
    ctx.globalAlpha = 1;
    // Drive centerlines (network colors) ---------------------------------------------------------
    for (const o of objs) {
      if (o.type !== 'drive') continue;
      strokeLine(ctx, v, o.centerline, o.network === 'truck' ? pal.truckNet : o.network === 'car' ? pal.carNet : '#e5534b', 1.1, [10, 7]);
    }
    for (const o of objs) {
      if (o.type !== 'driveway') continue;
      const p: Pt = [o.position[0] - o.inward[0] * 58, o.position[1] - o.inward[1] * 58];
      label(`${o.network === 'truck' ? 'TRUCKS' : o.network === 'car' ? 'CARS' : 'EMERGENCY'}`, p, 7, { color: o.network === 'truck' ? pal.truckNet : pal.carNet, size: 10, bold: true });
    }
    // Building ---------------------------------------------------------------------------------
    if (building) {
      if (heat) fillRegion(ctx, v, [building.polygon], 'rgba(201,206,214,0.12)', pal.buildingStroke, 1.6);
      else fillRegion(ctx, v, [building.polygon], pal.building, pal.buildingStroke, 1.4);
      fillRegion(ctx, v, [officeRing(building)], 'rgba(76,141,255,0.22)', 'rgba(76,141,255,0.8)', 0.8);
      drawDockDoors(ctx, v, building, c.dockDoorSpacingFt, pal);
      const ffe = sc.grading.ffeFt;
      const dir: Pt = [Math.cos((building.rotationDeg * Math.PI) / 180), Math.sin((building.rotationDeg * Math.PI) / 180)];
      label(
        `${fmtInt(building.areaSf)} SF ${building.buildingType === 'crossDock' ? 'CROSS-DOCK' : 'REAR-LOAD'}\n${fmtInt(building.lengthFt)} × ${fmtInt(building.depthFt)} ft · ${building.clearHeightFt} ft clear · ${building.dockDoors} doors${ffe !== null && sc.grading.graded ? `\nFFE ${ffe.toFixed(1)}` : ''}`,
        building.center,
        10,
        heat ? { color: pal.text, size: 12, bold: true, angle: textAngle(dir) } : { color: s.theme === 'light' ? '#ffffff' : '#15181d', halo: s.theme === 'light' ? 'rgba(143,151,163,0.9)' : 'rgba(201,206,214,0.9)', size: 12, bold: true, angle: textAngle(dir) },
      );
    }

    // Selection --------------------------------------------------------------------------------
    const sel = s.selection ? objs.find((o) => o.id === s.selection) : null;
    if (sel) drawSelection(ctx, v, sel, pal);
  };
}

function drawSelection(ctx: CanvasRenderingContext2D, v: View, o: DesignObject, pal: Palette): void {
  const region = o.type === 'drive' ? o.polygon : [o.polygon];
  ctx.setLineDash([]);
  fillRegion(ctx, v, region, 'rgba(76,194,255,0.10)', pal.selection, 2);
  const dot = (p: Pt, round: boolean) => {
    const s = w2s(v, p);
    ctx.beginPath();
    if (round) ctx.arc(s[0], s[1], 6, 0, Math.PI * 2);
    else ctx.rect(s[0] - 5, s[1] - 5, 10, 10);
    ctx.fillStyle = pal.bg;
    ctx.fill();
    ctx.strokeStyle = pal.selection;
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  if (o.type === 'building') {
    const h = buildingHandles(o);
    const f = buildingFrame(o);
    strokeLine(ctx, v, [toWorld(f, [o.lengthFt / 2, 0]), h.rotate], pal.selection, 1);
    dot(h.rotate, true);
    for (const r of h.resize) dot(r.at, false);
  } else if (o.type === 'driveway') {
    dot(o.position, false);
  }
}
