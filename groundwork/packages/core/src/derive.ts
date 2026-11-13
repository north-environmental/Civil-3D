/**
 * Derived results. After every mutating command the active scenario's yield table, checks and
 * (when graded) earthwork report are recomputed from the design objects. Nothing here is stored
 * input; it can always be rebuilt.
 */
import { setDeriveHook } from './commands/registry';
import { evaluateEngineeringChecks } from './checks/engineering';
import { gradeScenario } from './grading/scenario';
import { buildYield } from './layout/yield';
import { type Project, type Scenario, activeScenario, replaceScenario } from './site/project';
import { evaluateZoningChecks } from './zoning/checks';
import { buildEnvelopes } from './zoning/envelopes';

export function deriveScenario(p: Project, s: Scenario): Scenario {
  if (!p.site || !p.rules) return { ...s, checks: [], results: { ...s.results, yield: [], earthwork: null } };
  const env = buildEnvelopes(p.site, p.rules);
  const earthwork = s.grading.graded && s.grading.ffeFt !== null && s.objects.some((o) => o.type === 'building') ? gradeScenario(p.site, s, s.grading.ffeFt).report : null;
  const withEw: Scenario = { ...s, results: { ...s.results, earthwork: earthwork ? { ...earthwork, balance: s.results.earthwork?.balance && s.grading.balanceTargetCy !== null ? s.results.earthwork.balance : undefined } : null } };
  const checks = [...evaluateZoningChecks(p.site, p.rules, withEw, env), ...evaluateEngineeringChecks(p.site, p.rules, withEw, env)];
  return { ...withEw, checks, results: { ...withEw.results, yield: buildYield(p.site, p.rules, withEw) } };
}

export function deriveProject(p: Project): Project {
  const s = activeScenario(p);
  return replaceScenario(p, deriveScenario(p, s));
}

setDeriveHook((p) => deriveProject(p));
