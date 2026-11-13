/** Section profile: existing (dashed) vs proposed (solid) along the drawn line, selectable vertical exaggeration. */
import { useMemo, useState } from 'react';
import { type Pt, type Site, sectionProfile } from '@groundwork/core';
import { app, useApp } from '../lib/app';
import { useStore } from '../lib/store';
import { surfaces } from '../plan/surfaces';

export function SectionChart({ line, ve, width, height }: { line: [Pt, Pt]; ve: number; width: number; height: number }) {
  const dem = useApp((s) => s.dem);
  const proposed = useStore(surfaces, (s) => s.proposed);
  const prof = useMemo(() => (dem ? sectionProfile({ dem } as unknown as Site, line[0], line[1], proposed, 320) : null), [dem, proposed, line]);
  if (!prof) return null;
  const pad = { l: 52, r: 16, t: 14, b: 26 };
  const W = Math.max(50, width - pad.l - pad.r);
  const H = Math.max(40, height - pad.t - pad.b);
  const zPad = 2;
  const z0 = Math.floor(prof.minElevFt - zPad);
  const z1 = Math.ceil(prof.maxElevFt + zPad);
  // Horizontal scale fills the width unless the exaggerated vertical range would overflow the height.
  const sx = Math.min(W / prof.lengthFt, H / ((z1 - z0) * ve));
  const sy = sx * ve;
  const plotW = prof.lengthFt * sx;
  const plotH = (z1 - z0) * sy;
  const X = (st: number) => pad.l + st * sx;
  const Y = (z: number) => pad.t + (H - plotH) / 2 + plotH - (z - z0) * sy;
  const path = (zs: number[]) => zs.map((z, i) => `${i ? 'L' : 'M'}${X(prof.stationFt[i]).toFixed(1)},${Y(z).toFixed(1)}`).join('');
  // Cut (red) and fill (blue) areas between the two profiles.
  const areas: { d: string; cut: boolean }[] = [];
  for (let i = 0; i + 1 < prof.stationFt.length; i++) {
    const dz = (prof.proposedFt[i] + prof.proposedFt[i + 1]) / 2 - (prof.existingFt[i] + prof.existingFt[i + 1]) / 2;
    if (Math.abs(dz) < 0.05) continue;
    const xa = X(prof.stationFt[i]);
    const xb = X(prof.stationFt[i + 1]);
    areas.push({ cut: dz < 0, d: `M${xa},${Y(prof.existingFt[i])}L${xb},${Y(prof.existingFt[i + 1])}L${xb},${Y(prof.proposedFt[i + 1])}L${xa},${Y(prof.proposedFt[i])}Z` });
  }
  const zStep = [1, 2, 5, 10, 20].find((s) => (z1 - z0) / s <= 8) ?? 20;
  const zTicks: number[] = [];
  for (let z = Math.ceil(z0 / zStep) * zStep; z <= z1; z += zStep) zTicks.push(z);
  const sStep = [50, 100, 200, 250, 500, 1000].find((s) => prof.lengthFt / s <= 10) ?? 1000;
  const sTicks: number[] = [];
  for (let st = 0; st <= prof.lengthFt; st += sStep) sTicks.push(st);
  return (
    <svg width={width} height={height} data-testid="section-chart" style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 10 }}>
      <rect x={pad.l} y={Y(z1)} width={plotW} height={plotH} fill="none" stroke="var(--border)" />
      {zTicks.map((z) => (
        <g key={z}>
          <line x1={pad.l} x2={pad.l + plotW} y1={Y(z)} y2={Y(z)} stroke="var(--border-soft)" />
          <text x={pad.l - 6} y={Y(z) + 3} textAnchor="end" fill="var(--text-dim)">
            {z}
          </text>
        </g>
      ))}
      {sTicks.map((st) => (
        <g key={st}>
          <line x1={X(st)} x2={X(st)} y1={Y(z0)} y2={Y(z0) + 4} stroke="var(--text-faint)" />
          <text x={X(st)} y={Y(z0) + 15} textAnchor="middle" fill="var(--text-dim)">
            {st}
          </text>
        </g>
      ))}
      {areas.map((a, i) => (
        <path key={i} d={a.d} fill={a.cut ? 'rgba(208,69,58,0.45)' : 'rgba(47,111,208,0.45)'} />
      ))}
      <path d={path(prof.existingFt)} fill="none" stroke="#b0926a" strokeWidth={1.3} strokeDasharray="6 4" />
      <path d={path(prof.proposedFt)} fill="none" stroke="var(--text)" strokeWidth={1.6} />
      <text x={pad.l + 4} y={Y(z1) + 12} fill="#ff7ad9" fontWeight={700}>
        A
      </text>
      <text x={pad.l + plotW - 4} y={Y(z1) + 12} fill="#ff7ad9" fontWeight={700} textAnchor="end">
        A′
      </text>
      <text x={pad.l + plotW / 2} y={height - 2} textAnchor="middle" fill="var(--text-faint)">
        station (ft) · elevation (ft) · {ve}× vertical exaggeration · max cut {prof.maxCutFt.toFixed(1)} ft · max fill {prof.maxFillFt.toFixed(1)} ft
      </text>
    </svg>
  );
}

export function SectionPanel({ width }: { width: number }) {
  const line = useApp((s) => s.sectionLine);
  const [ve, setVe] = useState(5);
  const [height, setHeight] = useState(230);
  if (!line || line[0] === line[1]) return null;
  return (
    <div className="section-panel" style={{ height }} data-testid="section-panel">
      <div
        style={{ position: 'absolute', left: 0, right: 0, top: -3, height: 6, cursor: 'ns-resize', zIndex: 2 }}
        onMouseDown={(e) => {
          const y0 = e.clientY;
          const h0 = height;
          const move = (ev: MouseEvent) => setHeight(Math.max(140, Math.min(600, h0 - (ev.clientY - y0))));
          const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
          };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        }}
      />
      <div className="section-head">
        <b>Section A–A′</b>
        <span className="dim">existing dashed · proposed solid</span>
        <span className="spacer" />
        <span className="dim">Vertical exaggeration</span>
        <div className="seg">
          {[1, 2, 5, 10].map((v) => (
            <button key={v} className={ve === v ? 'on' : ''} onClick={() => setVe(v)}>
              {v}×
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => app.set({ tool: 'section', sectionLine: null })}>
          Redraw
        </button>
        <button className="btn icon" title="Close" onClick={() => app.set({ sectionLine: null, tool: 'select' })}>
          ×
        </button>
      </div>
      <SectionChart line={line} ve={ve} width={width} height={height - 46} />
    </div>
  );
}
