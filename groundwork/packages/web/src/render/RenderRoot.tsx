/** Render mode (/?render=plan|...): chrome-less views for server-side screenshots (render_view, exports). */
import { useEffect, useState } from 'react';
import { app, loadStateOnce, useApp } from '../lib/app';
import { PlanView } from '../plan/PlanView';
import { derived } from '../plan/derived';

export function RenderRoot({ view, params }: { view: string; params: URLSearchParams }) {
  const [loaded, setLoaded] = useState(false);
  const project = useApp((s) => s.project);
  useEffect(() => {
    void loadStateOnce().then(() => {
      const layers = { ...app.get().layers };
      if (view === 'cutfill') layers.cutfill = true;
      const on = params.get('layers');
      if (on) for (const id of on.split(',')) if (id in layers) (layers as any)[id] = true;
      const off = params.get('hide');
      if (off) for (const id of off.split(',')) if (id in layers) (layers as any)[id] = false;
      // Show a specific scenario (client-side only; the server's active scenario is untouched).
      const want = params.get('scenario');
      const proj = app.get().project;
      if (want && proj && proj.scenarios.some((x) => x.id === want)) app.set({ project: { ...proj, activeScenarioId: want } });
      app.set({ layers });
      setLoaded(true);
    });
  }, [view, params]);

  const onDrawn = () => {
    if (!loaded) return;
    const s = app.get();
    // Ready once the DEM-derived contours exist (or there is no site to draw).
    if (!s.project?.site || derived.get().existingContours) {
      requestAnimationFrame(() => ((window as any).__renderReady = true));
    }
  };
  const bboxParam = params.get('bbox');
  const bbox = bboxParam ? (JSON.parse(bboxParam) as [number, number, number, number]) : undefined;
  const site = project?.site;
  const sc = project?.scenarios.find((x) => x.id === project.activeScenarioId);
  return (
    <div className="render-root">
      <div className="render-title">
        <b>{site ? site.name : 'Groundwork'}</b>
        <div>
          {sc ? `Scenario ${sc.id} · ` : ''}
          {view} · Concept-level, not for construction{site?.synthetic ? ' · SYNTHETIC SITE DATA' : ''}
        </div>
      </div>
      {loaded && <PlanView renderMode onDrawn={onDrawn} bbox={bbox} />}
    </div>
  );
}
