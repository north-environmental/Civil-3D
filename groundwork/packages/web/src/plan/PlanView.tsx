import { useEffect, useRef } from 'react';
import type { Pt } from '@groundwork/core';
import { app, useApp } from '../lib/app';
import { derived, ensureExistingContours } from './derived';
import { type View, drawPlan, fitView, s2w } from './draw';
import { drawImagery } from './imagery';
import { buildOverlays } from './overlays';
import { DARK, LIGHT } from './theme';
import { attachInteractions } from './interact';

export type PlanHandle = { view: View; fit: () => void; redraw: () => void };

/** Shared by the interactive view and render mode. */
export function PlanView({ renderMode = false, onDrawn }: { renderMode?: boolean; onDrawn?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const handle = useRef<PlanHandle | null>(null);
  const siteId = useApp((s) => s.project?.site?.id ?? null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    const h: PlanHandle = {
      view: { scale: 0.25, cx: 0, cy: 0, w: 100, h: 100 },
      fit: () => undefined,
      redraw: () => undefined,
    };
    handle.current = h;
    let raf = 0;
    let fittedFor: string | null = null;

    const draw = () => {
      raf = 0;
      const s = app.get();
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const hh = wrap.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(hh * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${hh}px`;
      }
      h.view.w = w;
      h.view.h = hh;
      const site = s.project?.site;
      const key = site ? `${site.id}:${w > 0}` : null;
      if (site && fittedFor !== key && w > 0) {
        h.fit();
        fittedFor = key;
      }
      ensureExistingContours(s.dem);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPlan(ctx, h.view, {
        project: s.project,
        scenario: s.project?.scenarios.find((x) => x.id === s.project!.activeScenarioId) ?? null,
        layers: s.layers,
        palette: s.theme === 'light' ? LIGHT : DARK,
        selection: s.selection,
        existingContours: derived.get().existingContours,
        underlays: site && s.layers.imagery ? [(c, vw) => drawImagery(c, vw, site, h.redraw)] : [],
        overlays: buildOverlays(s),
        showChrome: true,
      });
      onDrawn?.();
    };
    h.redraw = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    h.fit = () => {
      const site = app.get().project?.site;
      if (!site) return;
      const pts: Pt[] = site.parcel.ring.slice();
      // Include a margin of context (roads / neighbors) around the parcel.
      const v = fitView(pts, h.view.w, h.view.h, renderMode ? 70 : 90);
      h.view.scale = v.scale;
      h.view.cx = v.cx;
      h.view.cy = v.cy;
      h.redraw();
    };

    const unsubA = app.subscribe(h.redraw);
    const unsubD = derived.subscribe(h.redraw);
    const ro = new ResizeObserver(h.redraw);
    ro.observe(wrap);
    const detach = renderMode ? () => undefined : attachInteractions(canvas, h);
    h.redraw();
    (window as any).__plan = { s2w: (p: Pt) => s2w(h.view, p), view: h.view, fit: h.fit };
    return () => {
      unsubA();
      unsubD();
      ro.disconnect();
      detach();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [renderMode]);

  // Zoom-to requests from panels.
  const zoomTo = useApp((s) => s.zoomTo);
  useEffect(() => {
    if (!zoomTo || !handle.current) return;
    const s = app.get();
    const sc = s.project?.scenarios.find((x) => x.id === s.project!.activeScenarioId);
    const pts: Pt[] = [];
    for (const o of sc?.objects ?? []) {
      if (!zoomTo.ids.includes(o.id)) continue;
      const poly: any = (o as any).polygon;
      if (!poly?.length) continue;
      if (typeof poly[0][0] === 'number') pts.push(...(poly as Pt[]));
      else for (const r of poly as Pt[][]) pts.push(...r);
    }
    if (!pts.length) return;
    const v = fitView(pts, handle.current.view.w, handle.current.view.h, 160);
    handle.current.view.scale = Math.min(v.scale, 1.2);
    handle.current.view.cx = v.cx;
    handle.current.view.cy = v.cy;
    handle.current.redraw();
  }, [zoomTo]);

  return (
    <div className="plan-wrap" ref={wrapRef} data-site={siteId ?? ''}>
      <canvas ref={canvasRef} className="plan-canvas" data-testid="plan-canvas" />
    </div>
  );
}
