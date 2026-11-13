/**
 * Derived results. After every mutating command the active scenario's yield table, checks and
 * (when graded) earthwork report are recomputed from the design objects. Nothing here is stored
 * input; it can always be rebuilt.
 */
import { setDeriveHook } from './commands/registry';
import { evaluateEngineeringChecks } from './checks/engineering';
import { describeBalance, gradeScenario } from './grading/scenario';
import { buildYield } from './layout/yield';
import { type EarthworkReport, type Project, type Scenario, activeScenario, replaceScenario } from './site/project';
import { evaluateZoningChecks } from './zoning/checks';
import { buildEnvelopes } from './zoning/envelopes';

export function deriveScenario(p: Project, s: Scenario): Scenario {
  if (!p.site || !p.rules) return { ...s, checks: [], results: { ...s.results, yield: [], earthwork: null } };
  const env = buildEnvelopes(p.site, p.rules);
  let earthwork: EarthworkReport | null = null;
  if (s.grading.graded && s.grading.ffeFt !== null && s.objects.some((o) => o.type === 'building')) {
    earthwork = gradeScenario(p.site, s, s.grading.ffeFt).report;
    if (s.grading.balanceTargetCy !== null) earthwork.balance = describeBalance(earthwork, s.grading.balanceTargetCy);
  }
  const withEw: Scenario = { ...s, results: { ...s.results, earthwork } };
  const checks = [...evaluateZoningChecks(p.site, p.rules, withEw, env), ...evaluateEngineeringChecks(p.site, p.rules, withEw, env)];
  return { ...withEw, checks, results: { ...withEw.results, yield: buildYield(p.site, p.rules, withEw) } };
}

export function deriveProject(p: Project): Project {
  const s = activeScenario(p);
  return replaceScenario(p, deriveScenario(p, s));
}

setDeriveHook((p) => deriveProject(p));
