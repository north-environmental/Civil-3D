/**
 * Pointer interactions for the plan view: pan, zoom, select, drag/rotate/resize the building,
 * slide driveways along their frontage, draw a section line, hover tooltips.
 * Edits are previewed as a ghost and committed on release through commands (engine re-solves).
 */
import {
  type Building,
  type DesignObject,
  type Driveway,
  type Pt,
  type Ring,
  type Site,
  buildingFrame,
  closestOnPolyline,
  frontageFor,
  governingRuleAt,
  orientedRect,
  pointInRegion,
  pointInRing,
  toLocal,
  toWorld,
} from '@groundwork/core';
import { app, runCommand } from '../lib/app';
import { buildingHandles, scenarioOf } from './design';
import { s2w, w2s } from './draw';
import { envelopesOf } from './overlays';
import type { PlanHandle } from './PlanView';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number; moved: boolean }
  | { kind: 'move'; b: Building; start: Pt; moved: boolean }
  | { kind: 'rotate'; b: Building; moved: boolean }
  | { kind: 'resize'; b: Building; side: '+u' | '-u' | '+v' | '-v'; moved: boolean }
  | { kind: 'driveway'; d: Driveway; moved: boolean };

const HIT_ORDER: DesignObject['type'][] = ['driveway', 'building', 'parkingField', 'trailerField', 'truckCourt', 'truckApron', 'basin', 'drive', 'landscape'];

function hitObject(objs: DesignObject[], w: Pt): DesignObject | null {
  for (const type of HIT_ORDER) {
    for (const o of objs) {
      if (o.type !== type) continue;
      if (o.type === 'drive' ? pointInRegion(w, o.polygon) : pointInRing(w, o.polygon as Ring)) return o;
    }
  }
  return null;
}

export function attachInteractions(canvas: HTMLCanvasElement, h: PlanHandle): () => void {
  let drag: Drag | null = null;
  let pending: { rotationDeg?: number; center?: Pt; lengthFt?: number; depthFt?: number; stationFt?: number } = {};

  const local = (ev: MouseEvent): Pt => {
    const r = canvas.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  };
  const near = (a: Pt, b: Pt, px = 9) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= px;

  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const p = local(ev);
    const before = s2w(h.view, p);
    h.view.scale = Math.min(20, Math.max(0.01, h.view.scale * Math.exp(-ev.deltaY * 0.0015)));
    const after = s2w(h.view, p);
    h.view.cx += before[0] - after[0];
    h.view.cy += before[1] - after[1];
    h.redraw();
  };

  const onDown = (ev: MouseEvent) => {
    if (ev.button !== 0 && ev.button !== 1) return;
    const p = local(ev);
    const w = s2w(h.view, p);
    const st = app.get();
    const pan: Drag = { kind: 'pan', sx: p[0], sy: p[1], cx: h.view.cx, cy: h.view.cy, moved: false };
    if (ev.button === 1 || ev.shiftKey || st.tool === 'section') {
      drag = pan;
      return;
    }
    const sc = scenarioOf(st);
    const objs = sc?.objects ?? [];
    const sel = st.selection ? objs.find((o) => o.id === st.selection) : null;
    if (sel?.type === 'building') {
      const hd = buildingHandles(sel);
      if (near(w2s(h.view, hd.rotate), p)) {
        drag = { kind: 'rotate', b: sel, moved: false };
        return;
      }
      for (const r of hd.resize) {
        if (near(w2s(h.view, r.at), p)) {
          drag = { kind: 'resize', b: sel, side: r.side, moved: false };
          return;
        }
      }
    }
    const hit = hitObject(objs, w);
    if (hit?.type === 'driveway') {
      app.set({ selection: hit.id });
      drag = { kind: 'driveway', d: hit, moved: false };
    } else if (hit?.type === 'building') {
      app.set({ selection: hit.id });
      drag = { kind: 'move', b: hit, start: w, moved: false };
    } else {
      drag = pan;
    }
    canvas.style.cursor = drag.kind === 'pan' ? 'grabbing' : 'move';
  };

  const onMove = (ev: MouseEvent) => {
    const p = local(ev);
    const w = s2w(h.view, p);
    const over = ev.target === canvas;
    if (!drag) {
      if (!over) {
        if (app.get().cursor) app.set({ cursor: null, hoverTip: null });
        return;
      }
      // Hover a setback line -> governing rule + citation.
      let hoverTip: { x: number; y: number; text: string } | null = null;
      const st = app.get();
      if (st.layers.setbacks && st.project?.site && st.project.rules) {
        const env = envelopesOf(st.project);
        const g = env ? governingRuleAt(st.project.site as unknown as Site, st.project.rules, env, w, 5 / h.view.scale) : null;
        if (g) hoverTip = { x: p[0], y: p[1], text: `${g.envelope === 'building' ? 'Building' : 'Parking'} setback: ${g.distanceFt} ft ${g.detail}\n${g.label}\n${g.citation}` };
      }
      app.set({ cursor: { x: w[0], y: w[1] }, hoverTip });
      return;
    }
    drag.moved = true;
    switch (drag.kind) {
      case 'pan':
        h.view.cx = drag.cx - (p[0] - drag.sx) / h.view.scale;
        h.view.cy = drag.cy + (p[1] - drag.sy) / h.view.scale;
        h.redraw();
        break;
      case 'move': {
        const c: Pt = [drag.b.center[0] + w[0] - drag.start[0], drag.b.center[1] + w[1] - drag.start[1]];
        pending = { center: c };
        app.set({ ghost: [orientedRect(c, drag.b.lengthFt, drag.b.depthFt, drag.b.rotationDeg)], cursor: { x: w[0], y: w[1] } });
        break;
      }
      case 'rotate': {
        let ang = (Math.atan2(w[1] - drag.b.center[1], w[0] - drag.b.center[0]) * 180) / Math.PI;
        if (!ev.altKey) ang = Math.round(ang); // snap to whole degrees (Alt = free)
        pending = { rotationDeg: ang };
        app.set({ ghost: [orientedRect(drag.b.center, drag.b.lengthFt, drag.b.depthFt, ang)], hoverTip: { x: p[0], y: p[1], text: `${ang.toFixed(ev.altKey ? 1 : 0)}°` } });
        break;
      }
      case 'resize': {
        const b = drag.b;
        const f = buildingFrame(b);
        const uv = toLocal(f, w);
        const alongU = drag.side === '+u' || drag.side === '-u';
        const sgn = drag.side === '+u' || drag.side === '+v' ? 1 : -1;
        const halfOld = alongU ? b.lengthFt / 2 : b.depthFt / 2;
        // The opposite wall stays put; snap the dimension to 10 ft.
        const size = Math.max(100, Math.round((sgn * (alongU ? uv[0] : uv[1]) + halfOld) / 10) * 10);
        const shift = (sgn * (size - 2 * halfOld)) / 2;
        const c = toWorld(f, alongU ? [shift, 0] : [0, shift]);
        const L = alongU ? size : b.lengthFt;
        const D = alongU ? b.depthFt : size;
        pending = { center: c, lengthFt: L, depthFt: D };
        app.set({ ghost: [orientedRect(c, L, D, b.rotationDeg)], hoverTip: { x: p[0], y: p[1], text: `${L} × ${D} ft · ${(L * D).toLocaleString()} SF` } });
        break;
      }
      case 'driveway': {
        const site = app.get().project?.site as unknown as Site | undefined;
        const fr = site ? frontageFor(site, drag.d.roadName) : null;
        if (!fr) break;
        const c = closestOnPolyline(w, fr.line);
        pending = { stationFt: Math.round(c.station) };
        const dw = drag.d;
        const along: Pt = [dw.inward[1], -dw.inward[0]];
        const hw = dw.widthFt / 2;
        const q = (a: number, o: number): Pt => [c.pt[0] + along[0] * a + dw.inward[0] * o, c.pt[1] + along[1] * a + dw.inward[1] * o];
        app.set({ ghost: [[q(-hw, 0), q(hw, 0), q(hw, 30), q(-hw, 30)]], hoverTip: { x: p[0], y: p[1], text: `station ${Math.round(c.station)} ft` } });
        break;
      }
    }
  };

  const onUp = (ev: MouseEvent) => {
    const d = drag;
    drag = null;
    canvas.style.cursor = '';
    if (!d) return;
    const p = local(ev);
    const w = s2w(h.view, p);
    const st = app.get();
    if (!d.moved) {
      // Plain click.
      if (st.tool === 'section') {
        const cur = st.sectionLine;
        if (!cur || cur[1] !== cur[0]) app.set({ sectionLine: [w, w] });
        else app.set({ sectionLine: [cur[0], w], tool: 'select' });
        return;
      }
      if (d.kind === 'pan') {
        const hit = hitObject(scenarioOf(st)?.objects ?? [], w);
        app.set({ selection: hit ? hit.id : null });
      }
      return;
    }
    app.set({ ghost: null, hoverTip: null });
    const edit = pending;
    pending = {};
    if (d.kind === 'move' && edit.center) void runCommand('edit_object', { id: d.b.id, center: edit.center }, { busy: 'Re-solving layout…' });
    else if (d.kind === 'rotate' && edit.rotationDeg !== undefined) void runCommand('edit_object', { id: d.b.id, rotationDeg: edit.rotationDeg }, { busy: 'Re-solving layout…' });
    else if (d.kind === 'resize' && edit.center) void runCommand('edit_object', { id: d.b.id, center: edit.center, lengthFt: edit.lengthFt, depthFt: edit.depthFt }, { busy: 'Re-solving layout…' });
    else if (d.kind === 'driveway' && edit.stationFt !== undefined) void runCommand('edit_object', { id: d.d.id, stationFt: edit.stationFt }, { busy: 'Re-routing drives…' });
  };

  const onLeave = () => {
    if (!drag) app.set({ cursor: null, hoverTip: null });
  };
  const onDbl = () => h.fit();

  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('dblclick', onDbl);
  return () => {
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('mousedown', onDown);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    canvas.removeEventListener('mouseleave', onLeave);
    canvas.removeEventListener('dblclick', onDbl);
  };
}
