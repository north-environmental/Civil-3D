/** Context, scenario and log commands. */
import { z } from 'zod';
import { buildAssumptions } from '../checks/assumptions';
import { fmtAc, fmtCy, fmtInt } from '../site/units';
import { activeScenario, type Project, type Scenario } from '../site/project';
import { CommandError, defineCommand, newScenario } from './registry';

export function requireSite(p: Project) {
  if (!p.site) throw new CommandError('No site is loaded. Call load_site first (e.g. {"address": "1625 Heilmandale Rd"}).');
  return p.site;
}
export function requireRules(p: Project) {
  if (!p.rules) throw new CommandError('No zoning rule set is loaded. Call load_site or set_zoning_rules first.');
  return p.rules;
}

export function scenarioHeadline(s: Scenario): Record<string, unknown> {
  const y = (key: string) => s.results.yield.find((r) => r.key === key)?.value ?? null;
  const fails = s.checks.filter((c) => c.status === 'fail');
  const warns = s.checks.filter((c) => c.status === 'warn');
  const ew = s.results.earthwork;
  return {
    id: s.id,
    name: s.name,
    buildingSf: y('buildingSf'),
    dockDoors: y('dockDoors'),
    trailerStalls: y('trailerStalls'),
    carStalls: y('carStalls'),
    coveragePct: y('coveragePct'),
    imperviousPct: y('imperviousPct'),
    checks: { pass: s.checks.filter((c) => c.status === 'pass').length, warn: warns.length, fail: fails.length },
    earthwork: ew
      ? { ffeFt: ew.ffeFt, cutCy: Math.round(ew.cutCy), fillCy: Math.round(ew.fillCy), netCy: Math.round(ew.netCy), wallLengthFt: Math.round(ew.wallTotalLengthFt) }
      : null,
  };
}

defineCommand({
  name: 'get_project_summary',
  group: 'Context',
  title: 'Get project summary',
  description:
    'Start here. Returns the current state in one compact object: loaded site, active scenario, program, yields ' +
    '(building SF, stalls, doors, coverage %), open check failures and warnings (with reasons), earthwork headline ' +
    '(FFE ft, cut/fill/net CY) if graded, the list of scenarios, the assumptions in force and the state revision. ' +
    'Use it before and after a batch of changes to see what is still failing.',
  input: z.object({ includeAssumptions: z.boolean().default(false).describe('Include the full assumptions list (long).') }),
  mutates: false,
  handler: (p, input) => {
    const s = activeScenario(p);
    const fails = s.checks.filter((c) => c.status === 'fail');
    const warns = s.checks.filter((c) => c.status === 'warn');
    const site = p.site;
    const assumptions = buildAssumptions(p, s);
    const summaryParts = [
      site ? `${site.name}${site.synthetic ? ' (SYNTHETIC fixture)' : ''}, ${fmtAc(site.areaSf, 1)}` : 'No site loaded',
      `scenario ${s.id}`,
      s.objects.length ? `${s.objects.length} objects` : 'no layout yet',
      s.checks.length ? `${fails.length} failing / ${warns.length} warning checks` : 'checks not run',
      s.results.earthwork ? `FFE ${s.results.earthwork.ffeFt.toFixed(1)} ft, net ${fmtCy(s.results.earthwork.netCy)}` : 'not graded',
    ];
    return {
      result: {
        summary: summaryParts.join('; ') + '.',
        revision: p.revision,
        site: site
          ? { id: site.id, name: site.name, address: site.address, areaAc: +(site.areaSf / 43560).toFixed(2), district: site.zoningDistrictCode, synthetic: site.synthetic }
          : null,
        activeScenario: s.id,
        scenarios: p.scenarios.map((x) => ({ id: x.id, name: x.name, objects: x.objects.length, graded: x.grading.graded })),
        program: s.program,
        access: s.access,
        yield: s.results.yield.map((r) => ({ key: r.key, label: r.label, value: r.display, limit: r.limit, citation: r.citation })),
        failingChecks: fails.map((c) => ({ id: c.id, title: c.title, message: c.message, citation: c.citation, objectIds: c.objectIds })),
        warnings: warns.map((c) => ({ id: c.id, title: c.title, message: c.message })),
        earthwork: scenarioHeadline(s).earthwork,
        layoutNotes: s.results.layoutNotes,
        assumptionsChanged: assumptions.filter((a) => a.changed).map((a) => `${a.label}: ${a.value}`),
        assumptionCount: assumptions.length,
        ...(input.includeAssumptions ? { assumptions } : {}),
        disclaimer: 'Concept-level, not for construction.',
      },
    };
  },
});

defineCommand({
  name: 'log_note',
  group: 'Output',
  title: 'Log a design note',
  description:
    'Add a narrative note to the in-app design log ("Claude activity" panel) so people watching the browser see your ' +
    'assumptions and rationale. Use it for assumptions you made (e.g. employee counts), trade-offs and anything the ' +
    'user should confirm. Plain text, one or two sentences.',
  input: z.object({ note: z.string().min(1).max(1200).describe('The note text.') }),
  mutates: false,
  handler: (_p, input) => ({
    result: { summary: 'Note added to the design log.' },
    log: input.note,
    logKind: 'note',
  }),
});

defineCommand({
  name: 'create_scenario',
  group: 'Scenarios',
  title: 'Create scenario',
  description:
    'Branch the design into a new scenario (A, B, C…). By default it copies the active scenario (program, access, ' +
    'layout, grading criteria) and switches to the copy, so you can change one thing (e.g. rotate the building 90°) ' +
    'and compare. Returns the new scenario id.',
  input: z.object({
    name: z.string().max(60).optional().describe('Display name, e.g. "B: rear-load".'),
    copyFrom: z.string().optional().describe('Scenario id to copy. Defaults to the active scenario. Use "empty" for a blank scenario.'),
    switchTo: z.boolean().default(true),
  }),
  mutates: true,
  handler: (p, input) => {
    const used = new Set(p.scenarios.map((s) => s.id));
    let id = '';
    for (let i = 0; i < 26; i++) {
      const c = String.fromCharCode(65 + i);
      if (!used.has(c)) {
        id = c;
        break;
      }
    }
    if (!id) throw new CommandError('Scenario limit reached (26).');
    let scenario: Scenario;
    if (input.copyFrom === 'empty') {
      scenario = newScenario(id, input.name ?? `Scenario ${id}`);
    } else {
      const src = p.scenarios.find((s) => s.id === (input.copyFrom ?? p.activeScenarioId));
      if (!src) throw new CommandError(`Scenario "${input.copyFrom}" not found. Existing: ${[...used].join(', ')}`, 'not_found');
      scenario = { ...src, id, name: input.name ?? `Scenario ${id}` };
    }
    const project: Project = {
      ...p,
      scenarios: [...p.scenarios, scenario],
      activeScenarioId: input.switchTo ? id : p.activeScenarioId,
    };
    const msg = `Created scenario ${id}${input.copyFrom === 'empty' ? ' (empty)' : ` as a copy of ${input.copyFrom ?? p.activeScenarioId}`}${input.switchTo ? ' and switched to it' : ''}.`;
    return { project, result: { summary: msg, scenarioId: id, activeScenario: project.activeScenarioId }, log: msg };
  },
});

defineCommand({
  name: 'switch_scenario',
  group: 'Scenarios',
  title: 'Switch scenario',
  description: 'Make another scenario active. All layout/grading commands act on the active scenario. Returns its headline numbers.',
  input: z.object({ scenarioId: z.string().describe('Scenario id, e.g. "A".') }),
  mutates: true,
  handler: (p, input) => {
    const s = p.scenarios.find((x) => x.id === input.scenarioId);
    if (!s) throw new CommandError(`Scenario "${input.scenarioId}" not found. Existing: ${p.scenarios.map((x) => x.id).join(', ')}`, 'not_found');
    if (p.activeScenarioId === s.id) return { result: { summary: `Scenario ${s.id} is already active.`, ...scenarioHeadline(s) } };
    return {
      project: { ...p, activeScenarioId: s.id },
      result: { summary: `Switched to scenario ${s.id} (${s.name}).`, ...scenarioHeadline(s) },
      log: `Switched to scenario ${s.id} (${s.name}).`,
    };
  },
});

defineCommand({
  name: 'compare_scenarios',
  group: 'Scenarios',
  title: 'Compare scenarios',
  description:
    'Side-by-side table of scenarios: building SF, dock doors, trailer stalls, car stalls, coverage %, impervious %, ' +
    'check counts (pass/warn/fail), and earthwork (FFE ft, cut/fill/net CY, wall length ft) when graded. ' +
    'Use after create_scenario to explain trade-offs. Returns rows keyed by metric with one column per scenario.',
  input: z.object({ scenarioIds: z.array(z.string()).optional().describe('Defaults to all scenarios.') }),
  mutates: false,
  handler: (p, input) => {
    const list = input.scenarioIds?.length ? p.scenarios.filter((s) => input.scenarioIds!.includes(s.id)) : p.scenarios;
    if (!list.length) throw new CommandError('No matching scenarios.', 'not_found');
    const heads = list.map(scenarioHeadline) as any[];
    const fmt = (v: unknown, unit = '') => (v === null || v === undefined ? '—' : typeof v === 'number' ? `${fmtInt(v)}${unit}` : String(v));
    const rows: { metric: string; values: Record<string, string> }[] = [];
    const add = (metric: string, get: (h: any, s: Scenario) => string) => {
      const values: Record<string, string> = {};
      list.forEach((s, i) => (values[s.id] = get(heads[i], s)));
      rows.push({ metric, values });
    };
    add('Building', (h, s) => {
      const b = s.objects.find((o) => o.type === 'building') as any;
      return b ? `${fmtInt(b.areaSf)} SF, ${fmtInt(b.lengthFt)} × ${fmtInt(b.depthFt)} ft ${b.buildingType === 'crossDock' ? 'cross-dock' : 'rear-load'}, rot ${b.rotationDeg.toFixed(1)}°` : '—';
    });
    add('Dock doors', (h) => fmt(h.dockDoors));
    add('Trailer stalls', (h) => fmt(h.trailerStalls));
    add('Car stalls', (h) => fmt(h.carStalls));
    add('Building coverage', (h) => (h.coveragePct === null ? '—' : `${(h.coveragePct as number).toFixed(1)}%`));
    add('Impervious', (h) => (h.imperviousPct === null ? '—' : `${(h.imperviousPct as number).toFixed(1)}%`));
    add('Checks (pass / warn / fail)', (h) => `${h.checks.pass} / ${h.checks.warn} / ${h.checks.fail}`);
    add('FFE', (h) => (h.earthwork ? `${h.earthwork.ffeFt.toFixed(1)} ft` : 'not graded'));
    add('Cut', (h) => (h.earthwork ? fmt(h.earthwork.cutCy, ' CY') : '—'));
    add('Fill', (h) => (h.earthwork ? fmt(h.earthwork.fillCy, ' CY') : '—'));
    add('Net (+export / −import)', (h) => (h.earthwork ? fmt(h.earthwork.netCy, ' CY') : '—'));
    add('Retaining wall length', (h) => (h.earthwork ? fmt(h.earthwork.wallLengthFt, ' ft') : '—'));
    return {
      result: {
        summary: `Compared ${list.length} scenario(s): ${list.map((s) => s.id).join(', ')}.`,
        scenarios: list.map((s) => ({ id: s.id, name: s.name })),
        rows,
      },
    };
  },
});
