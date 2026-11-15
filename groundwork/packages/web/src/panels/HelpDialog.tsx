import { useEffect, useState } from 'react';
import { app, runCommand, useApp } from '../lib/app';

const KEYS: [string, string][] = [
  ['Drag / wheel', 'Pan / zoom the plan (double-click: fit site)'],
  ['Click', 'Select an object; drag the building to move it'],
  ['Handles', 'Round handle rotates the building; square handles resize; drag a driveway along its frontage'],
  ['2 / 3', '2D plan / 3D view'],
  ['S', 'Section tool: click two points to cut a profile'],
  ['C', 'Toggle cut/fill map'],
  ['B', 'Toggle as-built reference'],
  ['I', 'Toggle imagery'],
  ['T', 'Light / dark theme'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
  ['Delete', 'Delete the selected object'],
  [': or /', 'Focus the command line (e.g. optimize_ffe, place_building rotationDeg=95)'],
  ['Esc', 'Clear selection / close dialogs'],
  ['?', 'This help'],
];

export function HelpDialog() {
  const open = useApp((s) => s.helpOpen);
  if (!open) return null;
  return (
    <div className="overlay" onClick={() => app.set({ helpOpen: false })}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <div className="keys">
          {KEYS.map(([k, d]) => (
            <div key={k} style={{ display: 'contents' }}>
              <div>
                <kbd>{k}</kbd>
              </div>
              <div className="dim">{d}</div>
            </div>
          ))}
        </div>
        <p className="dim" style={{ marginTop: 16 }}>
          Every action here is a command. Claude drives the same commands through the Groundwork MCP server; watch the “Activity” tab while it works.
          Concept-level planning tool, not for construction.
        </p>
      </div>
    </div>
  );
}

type CompareResult = { scenarios: { id: string; name: string }[]; rows: { metric: string; values: Record<string, string> }[] };

/** Side-by-side scenario table (compare_scenarios). */
export function CompareDialog() {
  const open = useApp((s) => s.compareOpen);
  const revision = useApp((s) => s.project?.revision ?? 0);
  const [data, setData] = useState<CompareResult | null>(null);
  useEffect(() => {
    if (!open) return;
    void runCommand('compare_scenarios', {}, { quiet: true }).then((r) => {
      if (r.ok) setData(r.result as unknown as CompareResult);
    });
  }, [open, revision]);
  if (!open || !data) return null;
  return (
    <div className="overlay" onClick={() => app.set({ compareOpen: false })}>
      <div className="dialog" style={{ width: 860 }} onClick={(e) => e.stopPropagation()} data-testid="compare-dialog">
        <h2>Scenario comparison</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Metric</th>
              {data.scenarios.map((s) => (
                <th key={s.id}>
                  {s.id} · {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.metric}>
                <td>{r.metric}</td>
                {data.scenarios.map((s) => (
                  <td key={s.id} className="mono" style={{ width: 'auto' }}>
                    {r.values[s.id]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="dim" style={{ marginTop: 12 }}>
          Concept-level, not for construction. Earthwork is to subgrade after shrink; + net = surplus (export), − net = deficit (import).
        </p>
      </div>
    </div>
  );
}

/** Where each layer of the site came from, and what is assumed or missing. */
export function DataDialog() {
  const open = useApp((s) => s.dataOpen);
  const site = useApp((s) => s.project?.site ?? null);
  if (!open) return null;
  const host = (u: string) => u.replace(/^[a-z]+:\/\//, '').split(/[/?]/)[0];
  return (
    <div className="overlay" onClick={() => app.set({ dataOpen: false })}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()} data-testid="data-dialog">
        <h2>Where the site data comes from</h2>
        {!site && <p className="dim">No site is loaded.</p>}
        {site && (
          <>
            <p className="dim">
              {site.address} · {site.jurisdiction} · {(site.areaSf / 43560).toFixed(2)} ac · coordinates in EPSG:{site.crs.epsg} (US survey feet).{' '}
              {site.synthetic ? 'This is a generated test site, not a real place.' : 'Public GIS data cached with the app, so it works offline. Planning-level: not a survey, a wetland delineation or a zoning determination.'}
            </p>
            <table className="data-table">
              <tbody>
                {site.provenance.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <span className={`dot ${p.synthetic ? 'warn' : 'ok'}`} title={p.synthetic ? 'Not loaded, or assumed' : 'Loaded from the source'} />
                      {p.layer}
                    </td>
                    <td>
                      {p.notes}
                      <div className="src">
                        {host(p.sourceUrl)} · {p.fetchedAt.slice(0, 10)} · {p.license}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <div style={{ textAlign: 'right', marginTop: 14 }}>
          <button className="btn" onClick={() => app.set({ dataOpen: false })}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
