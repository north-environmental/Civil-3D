/** Render mode (/?render=plan|...): chrome-less views for server-side screenshots (render_view, exports). */
import { useEffect, useState } from 'react';
import { app, loadStateOnce, useApp } from '../lib/app';
import { Suspense, lazy } from 'react';
import type { Pt } from '@groundwork/core';
import { CutFillLegend } from '../panels/CenterView';
import { SectionChart } from '../panels/SectionPanel';
import { PlanView } from '../plan/PlanView';
import { derived } from '../plan/derived';
import { ensureSurfaces, surfaces } from '../plan/surfaces';
import { useStore } from '../lib/store';

const View3D = lazy(() => import('../view3d/View3D'));

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

  const surfKey = useStore(surfaces, (s) => s.key);
  const lineParam = params.get('line');
  const line = lineParam ? (JSON.parse(lineParam) as [Pt, Pt]) : null;
  const ve = Number(params.get('ve') ?? 5);
  const gradedScenario = (() => {
    const p = app.get().project;
    const sc = p?.scenarios.find((x) => x.id === p.activeScenarioId);
    return !!sc?.grading.graded && sc.objects.some((o) => o.type === 'building');
  })();
  const ready = () => requestAnimationFrame(() => requestAnimationFrame(() => ((window as any).__renderReady = true)));
  const onDrawn = () => {
    if (!loaded) return;
    const s = app.get();
    // Ready once the DEM-derived contours exist and, for a graded scenario, the proposed surface is in.
    if (!s.project?.site) return ready();
    if (!derived.get().existingContours) return;
    if (gradedScenario && !surfaces.get().key) return;
    ready();
  };
  useEffect(() => {
    if (!loaded || view !== 'section') return;
    const s = app.get();
    ensureSurfaces(s);
    if (!gradedScenario || surfKey) ready();
  }, [loaded, view, surfKey]);
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
      {loaded && (view === 'plan' || view === 'cutfill') && <PlanView renderMode onDrawn={onDrawn} bbox={bbox} />}
      {loaded && view === 'cutfill' && <CutFillLegend />}
      {loaded && view === 'section' && line && (
        <div style={{ marginTop: 70, padding: '0 10px' }}>
          <SectionChart line={line} ve={ve} width={window.innerWidth - 20} height={window.innerHeight - 90} />
        </div>
      )}
      {loaded && view === '3d' && (
        <Suspense fallback={null}>
          <View3D renderMode onReady={ready} />
        </Suspense>
      )}
    </div>
  );
}
