/**
 * Accessible-route check (stretch, partial): slopes along a drawn route on the proposed surface against
 * the 2010 ADA Standards values listed in docs/reference/engineering-criteria.md. Check only; it does
 * not regrade ("fix" is not built).
 */
import { z } from 'zod';
import { type Pt, polylineLength } from '../geometry/basic';
import { type Grid, sampleGrid } from '../geometry/grid';
import { gradeScenario } from '../grading/scenario';
import { activeScenario } from '../site/project';
import { requireSite } from './base';
import { relativePosition } from './site';
import { defineCommand } from './registry';

/** 2010 ADA Standards: walking surface running slope ≤ 1:20; ramps ≤ 1:12 with ≤ 30 in rise per run; cross slope ≤ 1:48. */
export const ADA_ROUTE = { walkMaxPct: 5, rampMaxPct: 100 / 12, rampMaxRiseFt: 2.5, crossMaxPct: 100 / 48, landingFt: 5 } as const;

export type RouteRun = { fromFt: number; toFt: number; kind: 'walk' | 'ramp' | 'tooSteep'; slopePct: number; riseFt: number };

/** Classify a route into runs by running slope, measured over `stepFt` intervals on `surface`. */
export function analyzeRoute(surface: (x: number, y: number) => number, points: Pt[], stepFt = 5): { runs: RouteRun[]; maxRunningPct: number; maxCrossPct: number; lengthFt: number } {
  const len = polylineLength(points);
  const samples: { s: number; p: Pt; dir: Pt }[] = [];
  let acc = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-6) continue;
    const dir: Pt = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    const n = Math.max(1, Math.round(l / stepFt));
    for (let k = 0; k < n; k++) samples.push({ s: acc + (l * k) / n, p: [a[0] + (b[0] - a[0]) * (k / n), a[1] + (b[1] - a[1]) * (k / n)], dir });
    acc += l;
  }
  const last = points[points.length - 1];
  samples.push({ s: len, p: last, dir: samples[samples.length - 1]?.dir ?? [1, 0] });
  const runs: RouteRun[] = [];
  let maxRun = 0;
  let maxCross = 0;
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const ds = b.s - a.s;
    if (ds < 1e-6) continue;
    const dz = surface(b.p[0], b.p[1]) - surface(a.p[0], a.p[1]);
    const slope = Math.abs(dz / ds) * 100;
    const nx = -a.dir[1];
    const ny = a.dir[0];
    const cross = (Math.abs(surface(a.p[0] + nx * 2.5, a.p[1] + ny * 2.5) - surface(a.p[0] - nx * 2.5, a.p[1] - ny * 2.5)) / 5) * 100;
    maxRun = Math.max(maxRun, slope);
    maxCross = Math.max(maxCross, cross);
    const kind: RouteRun['kind'] = slope <= ADA_ROUTE.walkMaxPct + 1e-6 ? 'walk' : slope <= ADA_ROUTE.rampMaxPct + 1e-6 ? 'ramp' : 'tooSteep';
    const prev = runs[runs.length - 1];
    if (prev && prev.kind === kind) {
      prev.toFt = b.s;
      prev.riseFt += Math.abs(dz);
      prev.slopePct = Math.max(prev.slopePct, slope);
    } else runs.push({ fromFt: a.s, toFt: b.s, kind, slopePct: slope, riseFt: Math.abs(dz) });
  }
  return { runs, maxRunningPct: maxRun, maxCrossPct: maxCross, lengthFt: len };
}

defineCommand({
  name: 'check_accessible_route',
  group: 'Grading',
  title: 'Check accessible route',
  description:
    'Check a pedestrian route against accessible-route slopes on the proposed surface (existing ground where the scenario ' +
    'is not graded). points = [[x, y], …] in site CRS feet, e.g. from the accessible stalls to the office entrance. Reports ' +
    'running slope along the route (walking surface ≤ 5%; 5–8.33% counts as a ramp, which needs ≤ 30 in of rise per run and ' +
    '5 ft landings; steeper fails), cross slope (≤ 2.08%), and where each problem is. Check only: it does not regrade. ' +
    'Limits are the 2010 ADA Standards values in the engineering criteria.',
  input: z.object({ points: z.array(z.tuple([z.number(), z.number()])).min(2).max(60) }),
  mutates: false,
  handler: (p, input) => {
    const site = requireSite(p);
    const s = activeScenario(p);
    const graded = s.grading.graded && s.grading.ffeFt !== null && s.objects.some((o) => o.type === 'building');
    if (graded) {
      const out = gradeScenario(site, s, s.grading.ffeFt!);
      const g = out.prep.model.spec;
      const proposed: Grid = { ...g, data: out.result.proposed };
      const inside = (x: number, y: number) => x >= g.x0 && y >= g.y0 && x <= g.x0 + g.nx * g.cellFt && y <= g.y0 + g.ny * g.cellFt;
      return report((x, y) => (inside(x, y) ? sampleGrid(proposed, x, y) : sampleGrid(site.dem, x, y)));
    }
    return report((x, y) => sampleGrid(site.dem, x, y));

    function report(surface: (x: number, y: number) => number) {
      const pts = input.points as Pt[];
      const r = analyzeRoute(surface, pts);
      const issues: string[] = [];
      for (const run of r.runs) {
        const where = `${Math.round(run.fromFt)}–${Math.round(run.toFt)} ft`;
        if (run.kind === 'tooSteep') issues.push(`${where}: ${run.slopePct.toFixed(1)}% is steeper than the ${ADA_ROUTE.rampMaxPct.toFixed(2)}% ramp maximum`);
        else if (run.kind === 'ramp' && run.riseFt > ADA_ROUTE.rampMaxRiseFt + 1e-6) issues.push(`${where}: ramp at ${run.slopePct.toFixed(1)}% rises ${(run.riseFt * 12).toFixed(0)} in; max 30 in per run, add a ${ADA_ROUTE.landingFt} ft landing`);
      }
      if (r.maxCrossPct > ADA_ROUTE.crossMaxPct + 1e-6) issues.push(`cross slope reaches ${r.maxCrossPct.toFixed(1)}%; maximum ${ADA_ROUTE.crossMaxPct.toFixed(2)}%`);
      const ramps = r.runs.filter((x) => x.kind === 'ramp');
      const status = issues.length ? 'fail' : ramps.length ? 'warn' : 'pass';
      const summary =
        `Accessible route, ${Math.round(r.lengthFt)} ft from the ${relativePosition(site, pts[0])} (${graded ? 'proposed surface' : 'existing ground; scenario not graded'}): ` +
        `max running slope ${r.maxRunningPct.toFixed(1)}%, max cross slope ${r.maxCrossPct.toFixed(1)}%. ` +
        (status === 'pass'
          ? 'Passes as a walking surface (≤ 5% running, ≤ 2.08% cross).'
          : status === 'warn'
            ? `${ramps.length} segment(s) between 5% and 8.33% must be built as ramps with handrails and landings.`
            : `Fails: ${issues.join('; ')}.`);
      return {
        result: {
          summary,
          status,
          lengthFt: Math.round(r.lengthFt),
          maxRunningSlopePct: +r.maxRunningPct.toFixed(2),
          maxCrossSlopePct: +r.maxCrossPct.toFixed(2),
          limits: { walkPct: 5, rampPct: 8.33, rampRiseIn: 30, crossPct: 2.08, citation: '2010 ADA Standards (running slope 1:20, ramps 1:12 with 30 in max rise, cross slope 1:48), per engineering-criteria.md' },
          runs: r.runs.map((x) => ({ fromFt: Math.round(x.fromFt), toFt: Math.round(x.toFt), kind: x.kind, maxSlopePct: +x.slopePct.toFixed(1), riseIn: Math.round(x.riseFt * 12) })),
          issues,
        },
      };
    }
  },
});
