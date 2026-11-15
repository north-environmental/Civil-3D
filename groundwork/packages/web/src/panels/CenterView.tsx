import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { app, runCommand, useApp, useScenario } from '../lib/app';
import { useStore } from '../lib/store';
import { PlanView } from '../plan/PlanView';
import { surfaces } from '../plan/surfaces';
import { SectionPanel } from './SectionPanel';

const View3D = lazy(() => import('../view3d/View3D'));

export function CutFillLegend() {
  const scale = useStore(surfaces, (s) => s.scaleFt);
  const has = useStore(surfaces, (s) => !!s.cutfill);
  const on = useApp((s) => s.layers.cutfill);
  if (!has || !on) return null;
  return (
    <div className="legend" data-testid="cutfill-legend">
      <div>
        <b>Cut / fill depth</b> <span className="dim">(proposed − existing, ft)</span>
      </div>
      <div className="ramp" />
      <div className="ticks">
        <span>−{scale} cut</span>
        <span>0</span>
        <span>+{scale} fill</span>
      </div>
    </div>
  );
}

export function CenterView() {
  const site = useApp((s) => s.project?.site ?? null);
  const connected = useApp((s) => s.connected);
  const toastText = useApp((s) => s.toast);
  const busy = useApp((s) => s.busy);
  const tip = useApp((s) => s.hoverTip);
  const demo = useApp((s) => s.demo);
  const view = useApp((s) => s.view);
  const tool = useApp((s) => s.tool);
  const surface3d = useApp((s) => s.surface3d);
  const drape3d = useApp((s) => s.drape3d);
  const graded = useScenario()?.grading.graded ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(() => setWidth(ref.current?.clientWidth ?? 1000));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="center" data-testid="center" ref={ref}>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
        {view === '2d' ? (
          <PlanView />
        ) : (
          <Suspense fallback={<div className="empty">Loading 3D view…</div>}>
            <View3D />
          </Suspense>
        )}
        {view === '3d' && site && (
          <div className="view-toolbar">
            <div className="seg">
              <button className={surface3d === 'existing' ? 'on' : ''} onClick={() => app.set({ surface3d: 'existing' })}>
                Existing
              </button>
              <button className={surface3d === 'proposed' ? 'on' : ''} disabled={!graded} onClick={() => app.set({ surface3d: 'proposed' })}>
                Proposed
              </button>
            </div>
            <div className="seg">
              <button className={drape3d === 'plain' ? 'on' : ''} onClick={() => app.set({ drape3d: 'plain' })}>
                Surface
              </button>
              <button className={drape3d === 'cutfill' ? 'on' : ''} disabled={!graded} onClick={() => app.set({ drape3d: 'cutfill' })}>
                Cut / fill
              </button>
            </div>
          </div>
        )}
        {view === '2d' && tool === 'section' && <div className="busy" style={{ right: 'auto', left: 12 }}>Section tool: click the start point, then the end point (Esc to cancel)</div>}
        {view === '2d' && <CutFillLegend />}
        {site?.synthetic && (
          <div className="badge-synth">
            <span className="tag synthetic" data-testid="synthetic-badge" title="No network during the build: parcel, roads, districts, wetland and terrain are generated placeholders. Run npm run fetch-site-data on a networked machine.">
              Synthetic site data · synthetic terrain
            </span>
          </div>
        )}
        {site && !site.synthetic && view === '2d' && (
          <div className="badge-synth">
            <button className="tag data" onClick={() => app.set({ dataOpen: true })} data-testid="data-badge" title="Click for the source of every layer">
              Real site data · county parcel · USGS LiDAR · NWI wetlands · township zoning map ⓘ
            </button>
          </div>
        )}
        {!site && (
          <div className="empty-state">
            <div className="empty-card" data-testid="empty-state">
              <h2>No site loaded</h2>
              <p>Groundwork fits an industrial building, truck courts, parking and a stormwater reservation to a parcel, checks it against zoning, then grades it and balances the earthwork.</p>
              <ol>
                <li>Load a site (parcel, roads, terrain, zoning).</li>
                <li>Set a program and generate a test fit.</li>
                <li>Grade it and optimize the finished floor elevation.</li>
              </ol>
              <button className="btn primary" disabled={!connected} onClick={() => runCommand('load_site', { address: '1625 Heilmandale Rd' }, { busy: 'Loading site…' })} data-testid="load-demo-site">
                Load demo site · 1625 Heilmandale Rd
              </button>
              {!connected && <p style={{ marginTop: 10 }}>Waiting for the Groundwork server…</p>}
              <p style={{ margin: '12px 0 0' }}>Or type in the Chat panel on the right: “Load 1625 Heilmandale Rd”, then describe what to build.</p>
            </div>
          </div>
        )}
        {tip && (
          <div className="tooltip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
            {tip.text}
          </div>
        )}
        {busy && <div className="busy">{busy}</div>}
        {demo && (
          <div className="demo-banner">
            <div className="step">
              DEMO · STEP {demo.step} / {demo.total}
            </div>
            <div>{demo.label}</div>
          </div>
        )}
        {toastText && <div className="toast">{toastText}</div>}
      </div>
      {view === '2d' && <SectionPanel width={width} />}
    </div>
  );
}
