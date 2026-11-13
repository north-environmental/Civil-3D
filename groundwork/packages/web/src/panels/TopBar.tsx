import { useState } from 'react';
import { app, runCommand, setTheme, toast, useApp } from '../lib/app';
import { startDemo } from '../lib/demo';

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="6" fill="#0c0e11" stroke="#2a313c" />
      <path d="M5 22 L12 15 L18 19 L27 9" stroke="#e8a33d" strokeWidth="2.5" fill="none" strokeLinejoin="round" />
      <path d="M5 26 H27" stroke="#8aa0b4" strokeWidth="2" />
    </svg>
  );
}

export function TopBar() {
  const project = useApp((s) => s.project);
  const view = useApp((s) => s.view);
  const theme = useApp((s) => s.theme);
  const tool = useApp((s) => s.tool);
  const demo = useApp((s) => s.demo);
  const [menu, setMenu] = useState(false);
  const site = project?.site ?? null;

  const doExport = async (formats: string[]) => {
    setMenu(false);
    const r = await runCommand('export', { formats }, { busy: 'Exporting…', images: false });
    if (r.ok) {
      const files = (r.result.files as { url: string; kind: string }[]) ?? [];
      for (const f of files) {
        const a = document.createElement('a');
        a.href = f.url;
        a.download = f.url.split('/').pop() ?? 'export';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      if (!files.length) toast(String(r.result.summary));
    }
  };

  return (
    <div className="topbar" data-testid="topbar">
      <div className="brand">
        <Logo />
        Groundwork <small>EFCG demo</small>
      </div>
      <div className="sep" />
      <div className="site-name" title={site?.address ?? ''}>
        {site ? site.name : 'No site loaded'}
      </div>
      <div className="sep" />
      <div className="scenario-tabs" data-testid="scenario-tabs">
        {(project?.scenarios ?? []).map((s) => (
          <button key={s.id} className={`scenario-tab ${s.id === project?.activeScenarioId ? 'on' : ''}`} title={s.name} onClick={() => runCommand('switch_scenario', { scenarioId: s.id })}>
            {s.id}
          </button>
        ))}
        <button className="scenario-tab" title="New scenario (copy of the active one)" onClick={() => runCommand('create_scenario', {})}>
          +
        </button>
      </div>
      <button className="btn icon" title="Undo (Ctrl+Z)" disabled={!project?.history.undoDepth} onClick={() => runCommand('undo')}>
        ↶
      </button>
      <button className="btn icon" title="Redo (Ctrl+Shift+Z)" disabled={!project?.history.redoDepth} onClick={() => runCommand('redo')}>
        ↷
      </button>
      <div className="spacer" />
      <span className="tag concept" data-testid="concept-tag">
        Concept-level · not for construction
      </span>
      <div className="spacer" />
      <div className="seg" role="tablist" aria-label="View">
        <button className={view === '2d' ? 'on' : ''} onClick={() => app.set({ view: '2d' })}>
          2D plan
        </button>
        <button className={view === '3d' ? 'on' : ''} onClick={() => app.set({ view: '3d' })} data-testid="view-3d">
          3D
        </button>
      </div>
      <button className={`btn ${tool === 'section' ? 'on' : ''}`} title="Draw a section line (S)" disabled={!site} onClick={() => app.set({ tool: tool === 'section' ? 'select' : 'section', view: '2d' })}>
        Section
      </button>
      <button className="btn primary" disabled={!!demo?.running} title="Replay the headline scenario with the design log animating" onClick={() => void startDemo()} data-testid="demo-btn">
        ▶ Demo
      </button>
      <div className="menu">
        <button className="btn" onClick={() => setMenu(!menu)} disabled={!site} data-testid="export-btn">
          Export ▾
        </button>
        {menu && (
          <div className="menu-pop" onMouseLeave={() => setMenu(false)}>
            <button onClick={() => doExport(['dxf'])}>
              DXF <span className="hint">state plane ft, AIA layers</span>
            </button>
            <button onClick={() => doExport(['geojson'])}>
              GeoJSON <span className="hint">WGS84</span>
            </button>
            <button onClick={() => doExport(['png'])}>
              Plan sheet PNG <span className="hint">24 × 36</span>
            </button>
            <button onClick={() => doExport(['xlsx'])}>
              XLSX summary <span className="hint">yield · compliance · earthwork</span>
            </button>
            <button onClick={() => doExport(['dxf', 'geojson', 'png', 'xlsx'])}>All formats</button>
          </div>
        )}
      </div>
      <button className="btn icon" title="Toggle light/dark (T)" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
        {theme === 'dark' ? '☾' : '☀'}
      </button>
      <button className="btn icon" title="Keyboard shortcuts (?)" onClick={() => app.set({ helpOpen: true })}>
        ?
      </button>
    </div>
  );
}
