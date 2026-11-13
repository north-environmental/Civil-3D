import { useRef, useState } from 'react';
import { sampleGrid } from '@groundwork/core';
import { app, runCommand, useApp } from '../lib/app';
import { proposedAt } from '../plan/surfaces';

/** "name {json}" or "name key=value key2=[1,2]" -> { name, input }. */
export function parseCommandLine(line: string): { name: string; input: unknown } {
  const trimmed = line.trim();
  const m = trimmed.match(/^(\S+)\s*(.*)$/s);
  if (!m) return { name: '', input: {} };
  const name = m[1];
  const rest = m[2].trim();
  if (!rest) return { name, input: {} };
  if (rest.startsWith('{')) return { name, input: JSON.parse(rest) };
  const input: Record<string, unknown> = {};
  for (const tok of rest.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
    const i = tok.indexOf('=');
    if (i < 0) continue;
    const k = tok.slice(0, i);
    const raw = tok.slice(i + 1).replace(/^"(.*)"$/, '$1');
    try {
      input[k] = JSON.parse(raw);
    } catch {
      input[k] = raw;
    }
  }
  return { name, input };
}

export function BottomBar() {
  const cursor = useApp((s) => s.cursor);
  const dem = useApp((s) => s.dem);
  const connected = useApp((s) => s.connected);
  const revision = useApp((s) => s.project?.revision ?? 0);
  const crs = useApp((s) => s.project?.site?.crs.epsg ?? null);
  const last = useApp((s) => s.console[s.console.length - 1] ?? null);
  const [value, setValue] = useState('');
  const hist = useRef<string[]>([]);
  const histIdx = useRef(-1);

  const existing = cursor && dem ? sampleGrid(dem, cursor.x, cursor.y) : null;
  const inDem = cursor && dem && cursor.x >= dem.x0 && cursor.y >= dem.y0 && cursor.x <= dem.x0 + dem.nx * dem.cellFt && cursor.y <= dem.y0 + dem.ny * dem.cellFt;
  const proposed = cursor ? proposedAt(cursor.x, cursor.y) : null;
  const delta = proposed !== null && existing !== null && inDem ? proposed - existing : null;

  const submit = async () => {
    const line = value.trim();
    if (!line) return;
    hist.current.push(line);
    histIdx.current = -1;
    setValue('');
    const log = (kind: 'in' | 'out' | 'err', text: string) => app.set((s) => ({ console: [...s.console, { kind, text }].slice(-50) }));
    log('in', line);
    try {
      const { name, input } = parseCommandLine(line);
      const r = await runCommand(name, input, { quiet: true, images: false });
      if (r.ok) log('out', String(r.result.summary ?? 'ok'));
      else log('err', r.error);
    } catch (err) {
      log('err', `Could not parse: ${(err as Error).message}`);
    }
  };

  return (
    <div className="bottom">
      <div className="status" data-testid="status-bar">
        <span title={connected ? 'Connected to the Groundwork server' : 'Disconnected'}>
          <span className={`dot ${connected ? 'ok' : ''}`} />
          {connected ? 'live' : 'offline'}
        </span>
        <span>
          <span className="k">X</span>
          <b data-testid="status-x">{cursor ? cursor.x.toFixed(1) : '—'}</b>
        </span>
        <span>
          <span className="k">Y</span>
          <b>{cursor ? cursor.y.toFixed(1) : '—'}</b>
        </span>
        <span>
          <span className="k">EXIST</span>
          <b data-testid="status-elev">{existing !== null && inDem ? `${existing.toFixed(1)} ft` : '—'}</b>
        </span>
        <span>
          <span className="k">PROP</span>
          <b>{proposed !== null ? `${proposed.toFixed(1)} ft` : '—'}</b>
        </span>
        <span>
          <span className="k">{delta !== null && delta < 0 ? 'CUT' : 'FILL'}</span>
          <b style={{ color: delta === null || Math.abs(delta) < 0.05 ? undefined : delta < 0 ? 'var(--cut)' : '#6a9bea' }}>{delta !== null ? `${Math.abs(delta).toFixed(1)} ft` : '—'}</b>
        </span>
        <span className="spacer" />
        <span>{crs ? `EPSG:${crs} ftUS · NAVD88 ft` : ''}</span>
        <span>
          <span className="k">REV</span>
          <b>{revision}</b>
        </span>
      </div>
      <div className="cmd">
        <span className="prompt">›</span>
        <input
          id="cmd-input"
          data-testid="cmd-input"
          spellCheck={false}
          placeholder='Command, e.g.  get_site_context   or   place_building rotationDeg=6 carSide="-u"   (press / to focus)'
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
            else if (e.key === 'ArrowUp') {
              const h = hist.current;
              if (!h.length) return;
              histIdx.current = histIdx.current < 0 ? h.length - 1 : Math.max(0, histIdx.current - 1);
              setValue(h[histIdx.current]);
            } else if (e.key === 'ArrowDown') {
              const h = hist.current;
              if (histIdx.current < 0) return;
              histIdx.current = histIdx.current + 1;
              if (histIdx.current >= h.length) {
                histIdx.current = -1;
                setValue('');
              } else setValue(h[histIdx.current]);
            }
          }}
        />
        {last && last.kind !== 'in' && (
          <span className={`last ${last.kind === 'err' ? 'err' : ''}`} title={last.text} data-testid="cmd-output">
            {last.text}
          </span>
        )}
      </div>
    </div>
  );
}
