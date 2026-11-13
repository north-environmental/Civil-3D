/** Yield table. Filled in with the layout engine (Phase 3). */
import type { Site } from '../site/model';
import type { Scenario, YieldRow } from '../site/project';
import type { ZoningRuleSet } from '../zoning/rules';

export function buildYield(_site: Site, _rules: ZoningRuleSet, _s: Scenario): YieldRow[] {
  return [];
}
