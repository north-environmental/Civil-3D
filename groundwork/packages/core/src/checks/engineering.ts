/** Engineering checks besides zoning (SPEC §5.4). Filled in with the layout and grading engines. */
import type { Site } from '../site/model';
import type { Check, Scenario } from '../site/project';
import type { Envelopes } from '../zoning/envelopes';
import type { ZoningRuleSet } from '../zoning/rules';

export function evaluateEngineeringChecks(_site: Site, _rules: ZoningRuleSet, _s: Scenario, _env: Envelopes): Check[] {
  return [];
}
