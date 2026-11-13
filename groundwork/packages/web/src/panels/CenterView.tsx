import { runCommand, useApp } from '../lib/app';
import { PlanView } from '../plan/PlanView';

export function CenterView() {
  const site = useApp((s) => s.project?.site ?? null);
  const connected = useApp((s) => s.connected);
  const toastText = useApp((s) => s.toast);
  const busy = useApp((s) => s.busy);
  const tip = useApp((s) => s.hoverTip);
  const demo = useApp((s) => s.demo);
  return (
    <div className="center" data-testid="center">
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
        <PlanView />
        {site?.synthetic && (
          <div className="badge-synth">
            <span className="tag synthetic" data-testid="synthetic-badge" title="No network during the build: parcel, roads, districts, wetland and terrain are generated placeholders. Run npm run fetch-site-data on a networked machine.">
              Synthetic site data · synthetic terrain
            </span>
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
              <p style={{ margin: '12px 0 0' }}>Or ask Claude (via the Groundwork MCP server): “Load 1625 Heilmandale Rd and summarize the site.”</p>
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
    </div>
  );
}
