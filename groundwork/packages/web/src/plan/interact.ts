/** Pointer interactions for the plan view: pan, zoom, cursor readout. (Editing handles: Phase 3.) */
import type { Pt } from '@groundwork/core';
import { app } from '../lib/app';
import { s2w } from './draw';
import type { PlanHandle } from './PlanView';

export function attachInteractions(canvas: HTMLCanvasElement, h: PlanHandle): () => void {
  let panning: { sx: number; sy: number; cx: number; cy: number } | null = null;

  const local = (ev: MouseEvent): Pt => {
    const r = canvas.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  };
  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const p = local(ev);
    const before = s2w(h.view, p);
    const factor = Math.exp(-ev.deltaY * 0.0015);
    h.view.scale = Math.min(20, Math.max(0.01, h.view.scale * factor));
    const after = s2w(h.view, p);
    h.view.cx += before[0] - after[0];
    h.view.cy += before[1] - after[1];
    h.redraw();
  };
  const onDown = (ev: MouseEvent) => {
    const p = local(ev);
    panning = { sx: p[0], sy: p[1], cx: h.view.cx, cy: h.view.cy };
    canvas.style.cursor = 'grabbing';
  };
  const onMove = (ev: MouseEvent) => {
    const p = local(ev);
    if (panning) {
      h.view.cx = panning.cx - (p[0] - panning.sx) / h.view.scale;
      h.view.cy = panning.cy + (p[1] - panning.sy) / h.view.scale;
      h.redraw();
    }
    const w = s2w(h.view, p);
    app.set({ cursor: { x: w[0], y: w[1] } });
  };
  const onUp = () => {
    panning = null;
    canvas.style.cursor = '';
  };
  const onLeave = () => app.set({ cursor: null });
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
