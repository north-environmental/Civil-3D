/** Grading-dependent engineering checks. Filled in with the grading engine (Phase 5). */
import type { Site } from '../site/model';
import type { Check, Scenario } from '../site/project';
import type { Envelopes } from '../zoning/envelopes';
import type { ZoningRuleSet } from '../zoning/rules';

export function evaluateGradingChecks(_site: Site, _rules: ZoningRuleSet, _s: Scenario, _env: Envelopes): Check[] {
  return [];
}
