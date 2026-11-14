/** Overlays drawn above the site base: zoning envelopes, design objects, grading results. */
import { type Envelopes, type Site, buildEnvelopes, fmtAc, ringArea, ringCentroid, sweptPaths } from '@groundwork/core';
import type { AppState, ClientProject } from '../lib/app';
import { type Overlay, drawContours, fillRegion, strokeLine, w2s } from './draw';
import { surfaces } from './surfaces';
import { drawDesign } from './design';
import { DARK, LIGHT } from './theme';

export function envelopesOf(project: ClientProject | null): Envelopes | null {
  if (!project?.site || !project.rules) return null;
  return buildEnvelopes(project.site as unknown as Site, project.rules);
}

/** Cut/fill raster drawn under the linework. */
export function buildUnderlays(s: AppState): Overlay[] {
  const sf = surfaces.get();
  if (!s.layers.cutfill || !sf.cutfill || !sf.spec) return [];
  const { spec, cutfill } = sf;
  return [
    (ctx, v) => {
      const tl = w2s(v, [spec.x0, spec.y0 + spec.ny * spec.cellFt]);
      const br = w2s(v, [spec.x0 + spec.nx * spec.cellFt, spec.y0]);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cutfill, tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);
    },
  ];
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
  const sf = surfaces.get();
  if (sf.spec && sf.contours && s.layers.proposedContours) {
    const sets = sf.contours;
    out.push((ctx, v, labels) => drawContours(ctx, v, sets, pal.propMinor, pal.propIndex, s.layers.labels ? labels : null, pal.propIndex, v.scale > 0.6 ? 1 : 2));
  }
  if (sf.spec && sf.wallHeight) {
    const { spec, wallHeight } = sf;
    const sc = s.project?.scenarios.find((x) => x.id === s.project!.activeScenarioId);
    const minH = sc?.grading.criteria.minWallHeightFt ?? 1;
    out.push((ctx, v) => {
      ctx.fillStyle = pal.wall;
      const px = Math.max(1.5, spec.cellFt * v.scale);
      for (let k = 0; k < wallHeight.length; k++) {
        if (wallHeight[k] < minH) continue;
        const i = k % spec.nx;
        const j = (k - i) / spec.nx;
        const q = w2s(v, [spec.x0 + i * spec.cellFt, spec.y0 + (j + 1) * spec.cellFt]);
        ctx.fillRect(q[0], q[1], px, px);
      }
    });
  }
  // Spot elevations (building corners, dock faces, driveway tie-ins) once zoomed in.
  const ew = s.project?.scenarios.find((x) => x.id === s.project!.activeScenarioId)?.results.earthwork;
  if (ew && s.layers.labels && s.layers.proposedContours) {
    out.push((_ctx, v, labels) => {
      if (v.scale < 0.55) return;
      for (const sp of ew.spots) {
        const q = w2s(v, sp.at);
        labels.push({ text: `× ${sp.elevFt.toFixed(1)}`, x: q[0] + 22, y: q[1] - 8, priority: 4, color: pal.propIndex, size: 10, mono: true });
      }
    });
  }
  if (s.layers.sweptPath) {
    const sc = s.project?.scenarios.find((x) => x.id === s.project!.activeScenarioId);
    const paths = sc ? sweptPaths(sc.objects) : [];
    out.push((ctx, v) => {
      for (const sp of paths) {
        fillRegion(ctx, v, sp.envelope, 'rgba(240,179,90,0.22)', '#f0b35a', 1);
        if (sp.overflow.length) fillRegion(ctx, v, sp.overflow, 'rgba(229,83,75,0.55)', '#e5534b', 1.2);
      }
    });
  }
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
