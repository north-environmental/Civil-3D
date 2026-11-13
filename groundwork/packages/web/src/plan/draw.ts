/** 2D plan renderer (Canvas 2D). Pure drawing: takes a view + scene, draws layers back to front. */
import {
  type ContourSet,
  type Pt,
  type Region,
  type Ring,
  type Scenario,
  bboxOf,
  polylineLength,
  pointAlong,
  ringCentroid,
} from '@groundwork/core';
import type { ClientProject, LayerId } from '../lib/app';
import type { Palette } from './theme';

export type View = { scale: number; cx: number; cy: number; w: number; h: number };
export type LabelReq = { text: string; x: number; y: number; priority: number; color?: string; size?: number; bold?: boolean; angle?: number; mono?: boolean };
export type Overlay = (ctx: CanvasRenderingContext2D, view: View, labels: LabelReq[]) => void;

export type Scene = {
  project: ClientProject | null;
  scenario: Scenario | null;
  layers: Record<LayerId, boolean>;
  palette: Palette;
  selection: string | null;
  existingContours: ContourSet[] | null;
  /** Extra layers drawn between the site base and the labels (design objects, envelopes, grading). */
  overlays: Overlay[];
  /** Render-mode extras */
  showChrome: boolean;
};

export const FONT_SANS = 'Inter, "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
export const FONT_MONO = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", monospace';

export function w2s(v: View, p: Pt): Pt {
  return [(p[0] - v.cx) * v.scale + v.w / 2, v.h / 2 - (p[1] - v.cy) * v.scale];
}
export function s2w(v: View, p: Pt): Pt {
  return [(p[0] - v.w / 2) / v.scale + v.cx, (v.h / 2 - p[1]) / v.scale + v.cy];
}
export function fitView(points: Pt[], w: number, h: number, padPx = 60): View {
  const b = bboxOf(points);
  const scale = Math.min((w - 2 * padPx) / Math.max(1, b.maxX - b.minX), (h - 2 * padPx) / Math.max(1, b.maxY - b.minY));
  return { scale: Math.max(scale, 1e-4), cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, w, h };
}

export function pathRing(ctx: CanvasRenderingContext2D, v: View, ring: Ring, close = true): void {
  if (!ring.length) return;
  const p0 = w2s(v, ring[0]);
  ctx.moveTo(p0[0], p0[1]);
  for (let i = 1; i < ring.length; i++) {
    const p = w2s(v, ring[i]);
    ctx.lineTo(p[0], p[1]);
  }
  if (close) ctx.closePath();
}
export function fillRegion(ctx: CanvasRenderingContext2D, v: View, region: Region, fill: string | CanvasPattern | null, stroke?: string, lineWidth = 1): void {
  ctx.beginPath();
  for (const r of region) pathRing(ctx, v, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill('evenodd');
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}
export function strokeLine(ctx: CanvasRenderingContext2D, v: View, line: Pt[], stroke: string, lineWidth = 1, dash: number[] = []): void {
  if (line.length < 2) return;
  ctx.beginPath();
  pathRing(ctx, v, line, false);
  ctx.setLineDash(dash);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.setLineDash([]);
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

function drawGrid(ctx: CanvasRenderingContext2D, v: View, pal: Palette): void {
  const step = niceStep(90 / v.scale);
  const tl = s2w(v, [0, 0]);
  const br = s2w(v, [v.w, v.h]);
  ctx.lineWidth = 1;
  for (const [st, color] of [
    [step, pal.grid],
    [step * 5, pal.gridMajor],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (let x = Math.ceil(tl[0] / st) * st; x <= br[0]; x += st) {
      const sx = Math.round(w2s(v, [x, 0])[0]) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, v.h);
    }
    for (let y = Math.ceil(br[1] / st) * st; y <= tl[1]; y += st) {
      const sy = Math.round(w2s(v, [0, y])[1]) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(v.w, sy);
    }
    ctx.stroke();
  }
}

/** Offset a centerline to a closed ROW band ring (simple miter-less offset; good enough for display). */
function roadBand(line: Pt[], half: number): Ring {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    left.push([line[i][0] + nx * half, line[i][1] + ny * half]);
    right.push([line[i][0] - nx * half, line[i][1] - ny * half]);
  }
  return [...left, ...right.reverse()];
}

export function placeLabels(ctx: CanvasRenderingContext2D, labels: LabelReq[], pal: Palette, reserved: { x: number; y: number; w: number; h: number }[] = []): void {
  const placed = reserved.slice();
  labels.sort((a, b) => b.priority - a.priority);
  for (const l of labels) {
    const size = l.size ?? 11;
    ctx.font = `${l.bold ? '600 ' : ''}${size}px ${l.mono ? FONT_MONO : FONT_SANS}`;
    const lines = l.text.split('\n');
    const tw = Math.max(...lines.map((t) => ctx.measureText(t).width));
    const th = lines.length * (size + 3);
    // Rotated labels reserve their bounding circle-ish box.
    const ang = l.angle ?? 0;
    const bw = Math.abs(Math.cos(ang)) * tw + Math.abs(Math.sin(ang)) * th + 8;
    const bh = Math.abs(Math.sin(ang)) * tw + Math.abs(Math.cos(ang)) * th + 6;
    const box = { x: l.x - bw / 2, y: l.y - bh / 2, w: bw, h: bh };
    if (placed.some((p) => p.x < box.x + box.w && p.x + p.w > box.x && p.y < box.y + box.h && p.y + p.h > box.y)) continue;
    placed.push(box);
    ctx.save();
    ctx.translate(l.x, l.y);
    if (ang) ctx.rotate(ang);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = pal.halo;
    ctx.lineWidth = 3.5;
    ctx.fillStyle = l.color ?? pal.text;
    lines.forEach((t, i) => {
      const y = (i - (lines.length - 1) / 2) * (size + 3);
      ctx.strokeText(t, 0, y);
      ctx.fillText(t, 0, y);
    });
    ctx.restore();
  }
}

/** Screen angle for text running along a world-space direction, kept upright. */
export function textAngle(dir: Pt): number {
  let a = -Math.atan2(dir[1], dir[0]);
  if (a > Math.PI / 2) a -= Math.PI;
  if (a < -Math.PI / 2) a += Math.PI;
  return a;
}

function drawContours(ctx: CanvasRenderingContext2D, v: View, sets: ContourSet[], minor: string, index: string, labels: LabelReq[] | null, labelColor: string, minorEvery: number): void {
  // Thin out minor contours when zoomed out so the plan stays readable.
  const showMinor = v.scale > 0.22;
  for (const pass of [0, 1]) {
    ctx.beginPath();
    for (const c of sets) {
      if ((pass === 1) !== c.index) continue;
      if (!c.index && (!showMinor || Math.round(c.levelFt) % minorEvery !== 0)) continue;
      for (const line of c.lines) pathRing(ctx, v, line, false);
    }
    ctx.strokeStyle = pass === 1 ? index : minor;
    ctx.lineWidth = pass === 1 ? 1.1 : 0.6;
    ctx.stroke();
  }
  if (labels) {
    for (const c of sets) {
      if (!c.index) continue;
      for (const line of c.lines) {
        const L = polylineLength(line);
        if (L * v.scale < 220) continue;
        const { pt, dir } = pointAlong(line, L * 0.5);
        const s = w2s(v, pt);
        if (s[0] < 20 || s[1] < 20 || s[0] > v.w - 20 || s[1] > v.h - 20) continue;
        labels.push({ text: String(Math.round(c.levelFt)), x: s[0], y: s[1], priority: 2, color: labelColor, size: 10, angle: textAngle(dir), mono: true });
      }
    }
  }
}

export function drawNorthArrow(ctx: CanvasRenderingContext2D, x: number, y: number, pal: Palette): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, 19, 0, Math.PI * 2);
  ctx.fillStyle = pal.halo;
  ctx.fill();
  ctx.strokeStyle = pal.textDim;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(6, 8);
  ctx.lineTo(0, 4);
  ctx.closePath();
  ctx.fillStyle = pal.text;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(-6, 8);
  ctx.lineTo(0, 4);
  ctx.closePath();
  ctx.strokeStyle = pal.text;
  ctx.stroke();
  ctx.font = `600 10px ${FONT_SANS}`;
  ctx.fillStyle = pal.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('N', 0, -21);
  ctx.restore();
}

export function drawScaleBar(ctx: CanvasRenderingContext2D, v: View, x: number, y: number, pal: Palette): void {
  const lenFt = niceStep(140 / v.scale);
  const px = lenFt * v.scale;
  ctx.save();
  ctx.fillStyle = pal.halo;
  ctx.fillRect(x - 8, y - 20, px + 16, 30);
  ctx.strokeStyle = pal.text;
  ctx.fillStyle = pal.text;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y - 4.5, px, 5);
  ctx.fillRect(x, y - 4, px / 2, 4);
  ctx.font = `10px ${FONT_MONO}`;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.fillText('0', x, y - 7);
  ctx.textAlign = 'right';
  ctx.fillText(`${lenFt.toLocaleString('en-US')} ft`, x + px, y - 7);
  ctx.restore();
}

export function drawPlan(ctx: CanvasRenderingContext2D, v: View, scene: Scene): void {
  const pal = scene.palette;
  const site = scene.project?.site ?? null;
  const L = scene.layers;
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, v.w, v.h);
  drawGrid(ctx, v, pal);
  const labels: LabelReq[] = [];

  if (site) {
    if (L.districts) {
      for (const d of site.districts) {
        const color = pal.district[d.kind] ?? pal.district.other;
        ctx.globalAlpha = 0.1;
        fillRegion(ctx, v, [d.ring], color);
        ctx.globalAlpha = 0.55;
        ctx.setLineDash([10, 5, 2, 5]);
        fillRegion(ctx, v, [d.ring], null, color, 1);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }
    if (L.existingContours && scene.existingContours) {
      drawContours(ctx, v, scene.existingContours, pal.contourMinor, pal.contourIndex, L.labels ? labels : null, pal.contourIndex, v.scale > 0.6 ? 1 : 2);
    }
    if (L.roads) {
      for (const r of site.roads) {
        fillRegion(ctx, v, [roadBand(r.centerline, r.rowWidthFt / 2)], pal.road, pal.roadEdge, 1);
        strokeLine(ctx, v, r.centerline, pal.roadEdge, 1, [14, 10]);
      }
    }
    if (L.constraints) {
      for (const c of site.constraints) {
        const fill = c.kind === 'wetland' ? pal.wetland : c.kind === 'floodplain' ? pal.flood : 'rgba(63,182,168,0.12)';
        ctx.setLineDash(c.informational ? [3, 4] : [6, 4]);
        fillRegion(ctx, v, [c.ring], fill, pal.constraint, 1);
        ctx.setLineDash([]);
        if (L.labels) {
          const s = w2s(v, ringCentroid(c.ring));
          labels.push({ text: c.name, x: s[0], y: s[1], priority: 5, color: pal.constraint, size: 10.5 });
        }
      }
    }
    if (L.asBuilt) {
      for (const a of site.asBuilt) {
        ctx.setLineDash([8, 5]);
        fillRegion(ctx, v, [a.ring], 'rgba(214,122,210,0.07)', pal.asBuilt, 1.25);
        ctx.setLineDash([]);
        if (L.labels) {
          const s = w2s(v, ringCentroid(a.ring));
          labels.push({ text: a.name, x: s[0], y: s[1] + 26, priority: 4, color: pal.asBuilt, size: 10.5 });
        }
      }
    }
  }

  for (const ov of scene.overlays) ov(ctx, v, labels);

  if (site) {
    if (L.parcel) {
      ctx.lineJoin = 'miter';
      fillRegion(ctx, v, [site.parcel.ring], null, pal.parcel, 1.6);
    }
    if (L.labels) {
      if (L.roads) {
        for (const r of site.roads) {
          // Label each road where it is on screen (try a few stations).
          const len = polylineLength(r.centerline);
          for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
            const { pt, dir } = pointAlong(r.centerline, len * t);
            const s = w2s(v, pt);
            if (s[0] > 60 && s[0] < v.w - 60 && s[1] > 30 && s[1] < v.h - 30) {
              labels.push({ text: r.name.toUpperCase(), x: s[0], y: s[1], priority: 8, color: pal.roadLabel, size: 11, bold: true, angle: textAngle(dir) });
              break;
            }
          }
        }
      }
      if (L.districts) {
        const view = { x0: 70, y0: 50, x1: v.w - 70, y1: v.h - 50 };
        for (const d of site.districts) {
          if (d.code === site.zoningDistrictCode) continue;
          // Put the label at the on-screen vertex-centroid sample nearest the district's centroid.
          const c = w2s(v, ringCentroid(d.ring));
          const x = Math.min(view.x1, Math.max(view.x0, c[0]));
          const y = Math.min(view.y1, Math.max(view.y0, c[1]));
          labels.push({ text: `${d.code} · ${d.name}`, x, y, priority: 3, color: pal.district[d.kind] ?? pal.textDim, size: 10.5 });
        }
      }
    }
  }

  placeLabels(ctx, labels, pal, scene.showChrome ? [{ x: v.w - 70, y: 0, w: 70, h: 80 }, { x: 0, y: v.h - 50, w: 260, h: 50 }] : []);

  if (scene.showChrome) {
    drawNorthArrow(ctx, v.w - 36, 44, pal);
    drawScaleBar(ctx, v, 18, v.h - 16, pal);
  }
}
