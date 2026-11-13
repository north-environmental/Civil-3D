/** 24 × 36 plan sheet (PNG export): plan on the left, title block with yield / compliance / earthwork on the right. */
import { fmtInt } from '@groundwork/core';
import { useApp, useScenario } from '../lib/app';
import { PlanView } from '../plan/PlanView';

export function SheetRoot({ onDrawn, date }: { onDrawn: () => void; date: string }) {
  const project = useApp((s) => s.project);
  const sc = useScenario();
  const site = project?.site;
  if (!site || !sc) return null;
  const ew = sc.results.earthwork;
  const n = (st: string) => sc.checks.filter((c) => c.status === st).length;
  const issues = sc.checks.filter((c) => c.status === 'fail' || c.status === 'warn');
  const keys = ['siteArea', 'buildingSf', 'coveragePct', 'imperviousPct', 'landscapedPct', 'carStalls', 'carStallsAda', 'trailerStalls', 'dockDoors', 'loadingBerths', 'basinArea'];
  const rows = keys.map((k) => sc.results.yield.find((y) => y.key === k)).filter((y): y is NonNullable<typeof y> => !!y);
  return (
    <div className="sheet" data-testid="sheet">
      <div className="sheet-plan">
        <PlanView renderMode onDrawn={onDrawn} />
      </div>
      <div className="sheet-block">
        <div className="sheet-brand">GROUNDWORK</div>
        <div className="sheet-sub">Site test fit + concept grading · EFCG demo</div>
        <h1>{site.name}</h1>
        <div className="sheet-meta">{site.address}</div>
        <div className="sheet-meta">
          Scenario {sc.id}: {sc.name} · {date} · rev {project!.revision}
        </div>
        <div className="sheet-warn">CONCEPT-LEVEL · NOT FOR CONSTRUCTION{site.synthetic ? ' · SYNTHETIC SITE DATA' : ''}</div>

        <h2>Yield</h2>
        <table>
          <tbody>
            {rows.map((y) => (
              <tr key={y.key}>
                <td>{y.label}</td>
                <td className="num">{y.display}</td>
                <td className="lim">{[y.limit, y.citation].filter(Boolean).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>
          Compliance: {n('pass')} pass · {n('warn')} warn · {n('fail')} fail
        </h2>
        {issues.length === 0 && <div className="sheet-note">All zoning and engineering checks pass.</div>}
        {issues.slice(0, 7).map((c) => (
          <div key={c.id} className="sheet-issue">
            <b className={c.status}>{c.status.toUpperCase()}</b> {c.title}
            {c.citation ? ` (${c.citation})` : ''}: {c.message}
          </div>
        ))}

        <h2>Earthwork (to subgrade)</h2>
        {ew ? (
          <table>
            <tbody>
              <tr>
                <td>Finished floor elevation</td>
                <td className="num">{ew.ffeFt.toFixed(1)} ft</td>
                <td className="lim">{ew.feasibleFfe ? `feasible ${ew.feasibleFfe.minFt.toFixed(1)}–${ew.feasibleFfe.maxFt.toFixed(1)} ft (drive grades)` : ''}</td>
              </tr>
              <tr>
                <td>Cut</td>
                <td className="num">{fmtInt(ew.cutCy)} CY</td>
                <td className="lim">max depth {ew.maxCutFt.toFixed(1)} ft</td>
              </tr>
              <tr>
                <td>Fill</td>
                <td className="num">{fmtInt(ew.fillCy)} CY</td>
                <td className="lim">max depth {ew.maxFillFt.toFixed(1)} ft</td>
              </tr>
              <tr>
                <td>Net after {ew.shrinkPct}% shrink</td>
                <td className="num">{fmtInt(ew.netCy)} CY</td>
                <td className="lim">{ew.netCy >= 0 ? 'surplus (export)' : 'deficit (import)'}</td>
              </tr>
              <tr>
                <td>Retaining walls</td>
                <td className="num">{fmtInt(ew.wallTotalLengthFt)} ft</td>
                <td className="lim">{ew.walls.length ? `max ${ew.wallMaxHeightFt.toFixed(1)} ft exposed` : 'none required'}</td>
              </tr>
              <tr>
                <td>Offsite grading</td>
                <td className="num">{ew.offsiteAreaSf > 0 ? `${fmtInt(ew.offsiteAreaSf)} SF` : 'none'}</td>
                <td className="lim">{ew.gridCellFt} ft grid</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div className="sheet-note">Not graded.</div>
        )}
        <div className="sheet-foot">
          {site.crs.name} (EPSG:{site.crs.epsg}), US survey feet; elevations in feet. Zoning: {project!.rules?.districtName ?? '—'}, {site.jurisdiction}. Stormwater area is a planning-level land reservation, not a hydrologic
          design. Parking, loading and landscape counts follow the cited ordinance sections; design values labelled EFCG default are assumptions (see the XLSX Assumptions sheet).
        </div>
      </div>
    </div>
  );
}
