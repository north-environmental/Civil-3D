/** Overlays drawn above the site base: zoning envelopes, design objects, grading results. */
import { type Envelopes, type Site, buildEnvelopes, fmtAc, ringArea, ringCentroid } from '@groundwork/core';
import type { AppState, ClientProject } from '../lib/app';
import { type Overlay, fillRegion, strokeLine, w2s } from './draw';
import { drawDesign } from './design';
import { DARK, LIGHT } from './theme';

export function envelopesOf(project: ClientProject | null): Envelopes | null {
  if (!project?.site || !project.rules) return null;
  return buildEnvelopes(project.site as unknown as Site, project.rules);
}

export function buildOverlays(s: AppState): Overlay[] {
  const out: Overlay[] = [];
  const pal = s.theme === 'light' ? LIGHT : DARK;
  const env = envelopesOf(s.project);
  if (env && s.layers.setbacks) {
    out.push((ctx, v, labels) => {
      fillRegion(ctx, v, env.building, pal.envelopeFill);
      ctx.setLineDash([2, 5]);
      fillRegion(ctx, v, env.parking, null, pal.setback, 0.9);
      ctx.setLineDash([9, 6]);
      fillRegion(ctx, v, env.building, null, pal.setback, 1.25);
      ctx.setLineDash([]);
      const hasBuilding = s.project?.scenarios.find((x) => x.id === s.project!.activeScenarioId)?.objects.some((o) => o.type === 'building');
      if (s.layers.labels && !hasBuilding && env.building.length) {
        const big = env.building.slice().sort((a, b) => ringArea(b) - ringArea(a))[0];
        const c = w2s(v, ringCentroid(big));
        labels.push({ text: `BUILDING ENVELOPE · ${fmtAc(env.areas.buildingSf, 1)}`, x: c[0], y: c[1] - 60, priority: 6, color: pal.setback, size: 11, bold: true });
        labels.push({ text: 'dashed: building setbacks · dotted: parking setbacks (hover a line for the rule)', x: c[0], y: c[1] - 42, priority: 5, color: pal.textDim, size: 10 });
      }
    });
  }
  if (s.layers.design) out.push(drawDesign(s, pal));
  if (s.ghost) {
    const ghost = s.ghost;
    out.push((ctx, v) => {
      ctx.setLineDash([6, 4]);
      fillRegion(ctx, v, ghost, 'rgba(76,194,255,0.12)', pal.selection, 1.5);
      ctx.setLineDash([]);
    });
  }
  if (s.sectionLine) {
    const [a, b] = s.sectionLine;
    out.push((ctx, v, labels) => {
      strokeLine(ctx, v, [a, b], '#ff7ad9', 1.6, [8, 4]);
      for (const [pt, name] of [[a, 'A'], [b, "A'"]] as const) {
        const q = w2s(v, pt);
        ctx.beginPath();
        ctx.arc(q[0], q[1], 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ff7ad9';
        ctx.fill();
        if (a !== b) labels.push({ text: name, x: q[0] + 10, y: q[1] - 10, priority: 20, color: '#ff7ad9', bold: true, size: 12 });
      }
    });
  }
  return out;
}
