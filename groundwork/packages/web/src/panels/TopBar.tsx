import { useState } from 'react';
import { app, runCommand, setTheme, toast, useApp } from '../lib/app';
import { startDemo, stopDemo } from '../lib/demo';
import { exportPlanPng } from '../plan/exportPng';

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
    const saved: string[] = [];
    const problems: string[] = [];
    app.set({ busy: 'Exporting…' });
    try {
      // The plan image is drawn in the browser, so it needs no server-side renderer.
      if (formats.includes('png')) {
        try {
          saved.push(await exportPlanPng());
        } catch (err) {
          problems.push(`PNG: ${(err as Error).message}`);
        }
      }
      const serverFormats = formats.filter((f) => f !== 'png').map((f) => (f === 'sheet' ? 'png' : f));
      if (serverFormats.length) {
        const r = await runCommand('export', { formats: serverFormats }, { images: false, quiet: true });
        if (r.ok) {
          const files = (r.result.files as { url: string; kind: string }[]) ?? [];
          for (const f of files) {
            const name = f.url.split('/').pop() ?? 'export';
            const a = document.createElement('a');
            a.href = f.url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            saved.push(name);
          }
          if (r.result.imageError) problems.push('24 × 36 sheet: the server-side renderer is not installed. Run "npx playwright install chromium" once in the groundwork folder, or use "Plan image PNG".');
        } else problems.push(r.error);
      }
    } finally {
      app.set({ busy: null });
    }
    const where = 'Look in your browser’s Downloads folder.';
    toast([saved.length ? `Saved ${saved.join(', ')}. ${where}` : '', ...problems].filter(Boolean).join(' '));
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
      <button className="btn" title="Compare scenarios side by side" disabled={(project?.scenarios.length ?? 0) < 2} onClick={() => app.set({ compareOpen: true })} data-testid="compare-btn">
        Compare
      </button>
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
      {demo?.running ? (
        <button className="btn" title="Stop the demo after the current step" onClick={() => stopDemo()}>
          ■ Stop
        </button>
      ) : (
        <button className="btn primary" title="Replay the headline scenario with the design log animating (starts a new project)" onClick={() => void startDemo()} data-testid="demo-btn">
          ▶ Demo
        </button>
      )}
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
            <button onClick={() => doExport(['png'])} data-testid="export-png">
              Plan image PNG <span className="hint">what you see, with the aerial</span>
            </button>
            <button onClick={() => doExport(['sheet'])}>
              Plan sheet PNG <span className="hint">24 × 36, needs Chromium</span>
            </button>
            <button onClick={() => doExport(['xlsx'])}>
              XLSX summary <span className="hint">yield · compliance · earthwork</span>
            </button>
            <button onClick={() => doExport(['png', 'dxf', 'geojson', 'xlsx'])}>All of the above except the sheet</button>
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
