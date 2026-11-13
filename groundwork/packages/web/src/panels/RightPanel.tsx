import { useEffect, useRef, useState } from 'react';
import { type Check, type Program, buildAssumptions, fmtInt } from '@groundwork/core';
import { type RightTab, app, runCommand, useApp, useScenario } from '../lib/app';

const TABS: { id: RightTab; label: string }[] = [
  { id: 'checks', label: 'Checks' },
  { id: 'yield', label: 'Yield' },
  { id: 'earthwork', label: 'Earthwork' },
  { id: 'program', label: 'Program' },
  { id: 'zoning', label: 'Zoning' },
  { id: 'activity', label: 'Activity' },
];

export function RightPanel() {
  const tab = useApp((s) => s.rightTab);
  const scenario = useScenario();
  const fails = scenario?.checks.filter((c) => c.status === 'fail').length ?? 0;
  const logLen = useApp((s) => s.project?.log.length ?? 0);
  return (
    <div className="right" data-testid="right-panel">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => app.set({ rightTab: t.id })} data-testid={`tab-${t.id}`}>
            {t.label}
            {t.id === 'checks' && scenario && scenario.checks.length > 0 && <span className={`badge ${fails ? '' : 'ok'}`}>{fails || '✓'}</span>}
            {t.id === 'activity' && logLen > 0 && <span className="badge ok" style={{ background: 'var(--panel-3)', color: 'var(--text-dim)' }}>{logLen}</span>}
          </button>
        ))}
      </div>
      <div className="tab-body" data-testid={`body-${tab}`}>
        {tab === 'checks' && <ChecksTab />}
        {tab === 'yield' && <YieldTab />}
        {tab === 'earthwork' && <EarthworkTab />}
        {tab === 'program' && <ProgramTab />}
        {tab === 'zoning' && <ZoningTab />}
        {tab === 'activity' && <ActivityTab />}
      </div>
    </div>
  );
}

const ORDER: Record<string, number> = { fail: 0, warn: 1, pass: 2, 'n/a': 3 };
function fmtVal(c: Check): string {
  if (c.value === null) return '';
  const v = Math.abs(c.value) >= 1000 ? fmtInt(c.value) : String(Math.round(c.value * 100) / 100);
  const l = c.limit === null ? '' : ` / ${Math.abs(c.limit) >= 1000 ? fmtInt(c.limit) : Math.round(c.limit * 100) / 100}`;
  return `${v}${l} ${c.units}`;
}

function ChecksTab() {
  const scenario = useScenario();
  const checks = scenario?.checks ?? [];
  if (!checks.length) return <div className="empty">Checks run automatically once a site is loaded and a layout exists. Zoning and engineering checks appear here with value, limit and citation.</div>;
  const groups: { id: Check['group']; label: string }[] = [
    { id: 'zoning', label: 'Zoning' },
    { id: 'engineering', label: 'Engineering' },
    { id: 'grading', label: 'Grading' },
  ];
  const count = (s: string) => checks.filter((c) => c.status === s).length;
  return (
    <>
      <div className="summary-strip">
        <div className="stat">
          <div className="k">Pass</div>
          <div className="v" style={{ color: 'var(--pass)' }}>{count('pass')}</div>
        </div>
        <div className="stat">
          <div className="k">Warn</div>
          <div className="v" style={{ color: 'var(--warn)' }}>{count('warn')}</div>
        </div>
        <div className="stat">
          <div className="k">Fail</div>
          <div className="v" style={{ color: 'var(--fail)' }} data-testid="fail-count">{count('fail')}</div>
        </div>
      </div>
      {groups.map((g) => {
        const list = checks.filter((c) => c.group === g.id).sort((a, b) => ORDER[a.status] - ORDER[b.status]);
        if (!list.length) return null;
        return (
          <div key={g.id}>
            <div className="group-head">
              <span>{g.label}</span>
              <span className="mono">{list.length}</span>
            </div>
            {list.map((c) => (
              <div key={c.id} className="check" onClick={() => c.objectIds.length && app.set({ zoomTo: { ids: c.objectIds, nonce: Date.now() }, selection: c.objectIds[0], view: '2d' })}>
                <div className="check-head">
                  <span className={`chip ${c.status === 'n/a' ? 'na' : c.status}`}>{c.status}</span>
                  <span className="check-title">{c.title}</span>
                  <span className="check-val">{fmtVal(c)}</span>
                </div>
                <div className="check-msg">{c.message}</div>
                {c.citation && <div className="check-cite">{c.citation}</div>}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function YieldTab() {
  const scenario = useScenario();
  const rows = scenario?.results.yield ?? [];
  if (!rows.length) return <div className="empty">The yield table fills in once a building is placed: building SF, coverage, impervious, stalls, doors, loading berths, basin area and FAR, each with its limit and citation.</div>;
  return (
    <>
      <table className="data" data-testid="yield-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Value</th>
            <th>Limit / basis</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td className="num">{r.display}</td>
              <td className="cite">
                {r.limit ?? ''}
                {r.citation ? <div>{r.citation}</div> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {scenario!.results.layoutNotes.length > 0 && (
        <>
          <div className="group-head">Layout notes</div>
          {scenario!.results.layoutNotes.map((n, i) => (
            <div key={i} className="check-msg" style={{ padding: '3px 12px' }}>
              • {n}
            </div>
          ))}
        </>
      )}
    </>
  );
}

function EarthworkTab() {
  const scenario = useScenario();
  const hasSite = useApp((s) => !!s.project?.site);
  const [ffe, setFfe] = useState('');
  const ew = scenario?.results.earthwork ?? null;
  const hasLayout = !!scenario?.objects.some((o) => o.type === 'building');
  const actions = (
    <div className="form-actions">
      <button className="btn primary" disabled={!hasLayout} onClick={() => runCommand('optimize_ffe', {}, { busy: 'Balancing earthwork…' })} data-testid="btn-optimize">
        Optimize FFE (balance)
      </button>
      <input className="mono" style={{ width: 76, height: 26, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '0 6px' }} placeholder="FFE ft" value={ffe} onChange={(e) => setFfe(e.target.value)} />
      <button className="btn" disabled={!hasLayout} onClick={() => runCommand('grade_site', ffe ? { ffeFt: Number(ffe) } : {}, { busy: 'Grading…' })} data-testid="btn-grade">
        Grade
      </button>
    </div>
  );
  if (!ew)
    return (
      <>
        <div className="empty">
          {hasSite ? 'Not graded yet. Grading builds a concept-level proposed surface (pad, dock-height truck courts, parking planes, drives, basin, 3:1 tie-ins) and reports cut/fill to subgrade.' : 'Load a site first.'}
        </div>
        {actions}
      </>
    );
  const max = Math.max(ew.cutCy, ew.fillCy, 1);
  const fr = ew.feasibleFfe;
  const lo = fr ? Math.min(fr.minFt, ew.ffeFt) - 2 : ew.ffeFt - 5;
  const hi = fr ? Math.max(fr.maxFt, ew.ffeFt) + 2 : ew.ffeFt + 5;
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <>
      <div className="summary-strip">
        <div className="stat">
          <div className="k">FFE</div>
          <div className="v" data-testid="ffe-value">
            {ew.ffeFt.toFixed(1)}
            <span className="u">ft</span>
          </div>
        </div>
        <div className="stat">
          <div className="k">Net {ew.netCy >= 0 ? '(export)' : '(import)'}</div>
          <div className="v" data-testid="net-value">
            {fmtInt(Math.abs(ew.netCy))}
            <span className="u">CY</span>
          </div>
        </div>
        <div className="stat">
          <div className="k">Walls</div>
          <div className="v">
            {fmtInt(ew.wallTotalLengthFt)}
            <span className="u">ft</span>
          </div>
        </div>
      </div>
      <div className="bars">
        <div className="bar-row">
          <span style={{ color: 'var(--cut)' }}>Cut</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(ew.cutCy / max) * 100}%`, background: 'var(--cut)' }} />
          </div>
          <span className="num">{fmtInt(ew.cutCy)} CY</span>
        </div>
        <div className="bar-row">
          <span style={{ color: '#6a9bea' }}>Fill</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(ew.fillCy / max) * 100}%`, background: 'var(--fill)' }} />
          </div>
          <span className="num">{fmtInt(ew.fillCy)} CY</span>
        </div>
      </div>
      {ew.balance && <div className="check-msg" style={{ padding: '0 12px 6px' }}>{ew.balance.note}</div>}
      {fr && (
        <>
          <div className="group-head">
            <span>Feasible FFE range (drive grades)</span>
            <span className="mono">
              {fr.minFt.toFixed(1)} – {fr.maxFt.toFixed(1)} ft
            </span>
          </div>
          <div className="ffe-range">
            <div className="track" />
            <div className="feasible" style={{ left: pos(fr.minFt), width: `calc(${pos(fr.maxFt)} - ${pos(fr.minFt)})` }} />
            <div className="marker" style={{ left: pos(ew.ffeFt) }} />
            <div className="lbl" style={{ left: pos(ew.ffeFt) }}>
              FFE {ew.ffeFt.toFixed(1)}
            </div>
          </div>
          {fr.binding.map((b, i) => (
            <div key={i} className="check-cite" style={{ padding: '0 12px' }}>
              {b}
            </div>
          ))}
        </>
      )}
      {actions}
      <table className="data">
        <thead>
          <tr>
            <th>Area</th>
            <th className="num">Cut CY</th>
            <th className="num">Fill CY</th>
          </tr>
        </thead>
        <tbody>
          {ew.byCategory.map((c) => (
            <tr key={c.category}>
              <td>{CAT_LABEL[c.category] ?? c.category}</td>
              <td className="num">{fmtInt(c.cutCy)}</td>
              <td className="num">{fmtInt(c.fillCy)}</td>
            </tr>
          ))}
          <tr>
            <td>
              <b>Total to subgrade</b>
            </td>
            <td className="num">
              <b>{fmtInt(ew.cutCy)}</b>
            </td>
            <td className="num">
              <b>{fmtInt(ew.fillCy)}</b>
            </td>
          </tr>
        </tbody>
      </table>
      <table className="data" style={{ marginTop: 8 }}>
        <tbody>
          <tr>
            <td>Net = cut × (1 − {ew.shrinkPct}% shrink) − fill</td>
            <td className="num">{fmtInt(ew.netCy)} CY</td>
          </tr>
          <tr>
            <td>Topsoil strip (reused on site)</td>
            <td className="num">{fmtInt(ew.topsoilStripCy)} CY</td>
          </tr>
          <tr>
            <td>Pavement/slab sections (subgrade adj.)</td>
            <td className="num">{fmtInt(ew.sectionAdjustmentCy)} CY</td>
          </tr>
          <tr>
            <td>Disturbed area</td>
            <td className="num">{(ew.disturbedAreaSf / 43560).toFixed(1)} ac</td>
          </tr>
          <tr>
            <td>Max cut / max fill depth</td>
            <td className="num">
              {ew.maxCutFt.toFixed(1)} / {ew.maxFillFt.toFixed(1)} ft
            </td>
          </tr>
          <tr>
            <td>Retaining walls</td>
            <td className="num">
              {ew.walls.length} · {fmtInt(ew.wallTotalLengthFt)} ft · max {ew.wallMaxHeightFt.toFixed(1)} ft
            </td>
          </tr>
          <tr>
            <td>Offsite grading</td>
            <td className="num">{ew.offsiteAreaSf > 0 ? `${fmtInt(ew.offsiteAreaSf)} SF` : 'none'}</td>
          </tr>
          <tr>
            <td>Grid</td>
            <td className="num">{ew.gridCellFt} ft cells</td>
          </tr>
        </tbody>
      </table>
      {ew.drives.length > 0 && (
        <table className="data" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Drive</th>
              <th className="num">Grade</th>
              <th className="num">Max</th>
            </tr>
          </thead>
          <tbody>
            {ew.drives.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td className="num" style={{ color: Math.abs(d.gradePct) > d.maxGradePct + 1e-6 ? 'var(--fail)' : undefined }}>
                  {d.gradePct.toFixed(1)}%
                </td>
                <td className="num">{d.maxGradePct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
const CAT_LABEL: Record<string, string> = { pad: 'Building pad', truckCourt: 'Truck courts', parking: 'Car parking', drive: 'Drives', basin: 'Basins', tieIn: 'Tie-in slopes' };

function ProgramTab() {
  const scenario = useScenario();
  const site = useApp((s) => s.project?.site ?? null);
  const p = scenario?.program;
  const [f, setF] = useState<Record<string, string>>({});
  const key = `${scenario?.id}:${JSON.stringify(p)}`;
  useEffect(() => {
    setF({
      buildingSf: String(p?.buildingSf ?? 410000),
      buildingType: p?.buildingType ?? 'crossDock',
      clearHeightFt: String(p?.clearHeightFt ?? 40),
      dockDoors: String(p?.dockDoors ?? 'max'),
      trailerStalls: String(p?.trailerStalls ?? 'max'),
      employeesLargestShift: String(p?.employeesLargestShift ?? 300),
      employeesTwoLargestShifts: String(p?.employeesTwoLargestShifts ?? 520),
      officeSf: String(p?.officeSf ?? 10000),
    });
  }, [key]);
  if (!site) return <div className="empty">Load a site to set a program.</div>;
  const num = (v: string) => (v === 'max' || v === '' ? 'max' : Number(v));
  const input = (): Partial<Program> => ({
    buildingSf: Number(f.buildingSf),
    buildingType: f.buildingType as Program['buildingType'],
    clearHeightFt: Number(f.clearHeightFt),
    dockDoors: num(f.dockDoors) as Program['dockDoors'],
    trailerStalls: num(f.trailerStalls) as Program['trailerStalls'],
    employeesLargestShift: Number(f.employeesLargestShift),
    employeesTwoLargestShifts: Number(f.employeesTwoLargestShifts),
    officeSf: Number(f.officeSf),
  });
  const fld = (k: string, label: string, unit = '') => (
    <>
      <label htmlFor={`pf-${k}`}>
        {label} {unit && <span className="dim">({unit})</span>}
      </label>
      <input id={`pf-${k}`} className="mono" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </>
  );
  return (
    <>
      <div className="form">
        {fld('buildingSf', 'Building area', 'SF')}
        <label htmlFor="pf-type">Building type</label>
        <select id="pf-type" value={f.buildingType} onChange={(e) => setF({ ...f, buildingType: e.target.value })}>
          <option value="crossDock">Cross-dock</option>
          <option value="rearLoad">Rear-load</option>
        </select>
        {fld('clearHeightFt', 'Clear height', 'ft')}
        {fld('dockDoors', 'Dock doors', 'count or max')}
        {fld('trailerStalls', 'Trailer stalls', 'count or max')}
        {fld('employeesLargestShift', 'Employees, largest shift')}
        {fld('employeesTwoLargestShifts', 'Employees, two largest shifts')}
        {fld('officeSf', 'Office area', 'SF')}
      </div>
      <div className="form-actions">
        <button className="btn" onClick={() => runCommand('set_program', input())} data-testid="btn-set-program">
          Apply program
        </button>
        <button className="btn primary" onClick={async () => { const r = await runCommand('set_program', input()); if (r.ok) await runCommand('generate_layout', {}, { busy: 'Solving layout…' }); }} data-testid="btn-generate">
          Generate layout
        </button>
      </div>
      <div className="group-head">Access</div>
      {(scenario?.access ?? []).length === 0 && <div className="empty">No driveways assigned. The solver will pick frontages; or use set_access (e.g. trucks from Route 72, cars from Orange Ln).</div>}
      {(scenario?.access ?? []).map((a) => (
        <div key={a.id} className="check-msg" style={{ padding: '3px 12px' }}>
          <span className={`chip src ${a.network === 'truck' ? 'mcp' : ''}`}>{a.network}</span> {a.road} <span className="dim">· {a.position === 'auto' ? 'auto position' : `${a.position} ft`}</span>
        </div>
      ))}
      <div className="form-actions" style={{ marginTop: 8 }}>
        {site.roads.map((r) => (
          <span key={r.id} style={{ display: 'inline-flex', gap: 4 }}>
            <button className="btn" title={`Add truck access on ${r.name}`} onClick={() => runCommand('set_access', { network: 'truck', road: r.name })}>
              + truck · {r.name}
            </button>
            <button className="btn" title={`Add car access on ${r.name}`} onClick={() => runCommand('set_access', { network: 'car', road: r.name })}>
              + car
            </button>
          </span>
        ))}
      </div>
    </>
  );
}

function ruleValue(v: unknown, units: string): string {
  if (typeof v === 'number') return `${v} ${units === 'pct' ? '%' : units === 'ratio' ? '' : units}`;
  if (typeof v === 'string') return '';
  return Object.entries(v as Record<string, number>)
    .map(([k, x]) => `${k} ${x}`)
    .join(' · ');
}

function ZoningTab() {
  const project = useApp((s) => s.project);
  const scenario = useScenario();
  const [showAssumptions, setShowAssumptions] = useState(false);
  const rules = project?.rules;
  if (!project?.site || !rules) return <div className="empty">Zoning rules load with the site: setbacks, coverage, height, parking/loading ratios, landscaping and driveway spacing, each with its ordinance citation.</div>;
  const unconfirmed = rules.rules.filter((r) => !r.confirmed).length;
  const fronts = new Map<string, { len: number; res: boolean }>();
  for (const e of project.site.edges) {
    if (e.edgeClass !== 'front' || !e.roadName) continue;
    const f = fronts.get(e.roadName) ?? { len: 0, res: false };
    f.len += e.lengthFt;
    f.res ||= e.acrossStreetFromResidential;
    fronts.set(e.roadName, f);
  }
  const assumptions = scenario ? buildAssumptions(project as any, scenario) : [];
  return (
    <>
      <div className="summary-strip">
        <div className="stat" style={{ flex: 2 }}>
          <div className="k">District</div>
          <div className="v" style={{ fontSize: 13 }}>
            {rules.districtName}
          </div>
        </div>
        <div className="stat">
          <div className="k">Rules</div>
          <div className="v">{rules.rules.length}</div>
        </div>
      </div>
      <div className="check-cite" style={{ padding: '6px 12px' }}>
        {rules.jurisdiction}. {rules.sourceNote}
      </div>
      {unconfirmed > 0 && (
        <div className="form-actions">
          <span className="chip amber">{unconfirmed} proposed (unconfirmed)</span>
          <button className="btn" onClick={() => runCommand('confirm_zoning_rules', {})}>
            Confirm all
          </button>
        </div>
      )}
      <div className="group-head">Frontages</div>
      {[...fronts.entries()].map(([name, f]) => (
        <div key={name} className="check-msg" style={{ padding: '2px 12px' }}>
          {name} <span className="mono dim">{fmtInt(f.len)} ft</span> {f.res && <span className="chip warn">across from residential</span>}
        </div>
      ))}
      <div className="group-head">Rules</div>
      {rules.rules.map((r) => (
        <div key={r.id} className="rule">
          <div className="rule-head">
            <span>
              {r.label} {!r.confirmed && <span className="chip amber">proposed</span>}
            </span>
            <span className="rule-val">{ruleValue(r.value, r.units)}</span>
          </div>
          <div className="check-cite">
            {r.citation.section} · {r.citation.quote}
          </div>
          {r.interpretationFlags?.map((fl, i) => (
            <div key={i} className="rule-flag">
              ⚑ {fl}
            </div>
          ))}
        </div>
      ))}
      <div className="group-head" style={{ cursor: 'pointer' }} onClick={() => setShowAssumptions(!showAssumptions)}>
        <span>Assumptions ({assumptions.length})</span>
        <span>{showAssumptions ? '▾' : '▸'}</span>
      </div>
      {showAssumptions && (
        <table className="data">
          <tbody>
            {assumptions.map((a) => (
              <tr key={a.key}>
                <td>
                  {a.label} {a.changed && <span className="chip amber">set</span>}
                  <div className="check-cite">{a.source}</div>
                </td>
                <td className="num">{a.value.length > 28 ? <span style={{ whiteSpace: 'normal', textAlign: 'right', display: 'block' }}>{a.value}</span> : a.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function ActivityTab() {
  const log = useApp((s) => s.project?.log ?? []);
  const lastSeen = useRef(0);
  const freshFrom = lastSeen.current;
  useEffect(() => {
    lastSeen.current = log[log.length - 1]?.seq ?? 0;
  }, [log]);
  if (!log.length)
    return (
      <div className="empty">
        The design log is empty. Commands run by Claude over MCP appear here in plain language as they happen, so people watching the browser can follow along.
      </div>
    );
  return (
    <div data-testid="activity-log">
      {[...log].reverse().map((e) => (
        <div key={e.seq} className={`log-entry ${e.kind} ${e.seq > freshFrom && freshFrom > 0 ? 'fresh' : ''}`}>
          <div className="log-meta">
            <span className={`chip src ${e.source}`}>{e.source === 'mcp' ? 'Claude' : e.source}</span>
            <span className="cmd-name">{e.kind === 'note' ? 'note' : e.command}</span>
            <span className="spacer" />
            <span className="mono">{new Date(e.at).toLocaleTimeString()}</span>
          </div>
          <div>{e.message}</div>
        </div>
      ))}
    </div>
  );
}
