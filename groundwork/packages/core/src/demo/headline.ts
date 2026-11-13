/**
 * The headline demo scenario (SPEC §10) as a list of commands. One source for
 * scripts/demo-scenario.ts, the MCP end-to-end test and the in-app "Demo" button.
 */
export type DemoStep = {
  /** SPEC §10 step number. */
  step: number;
  /** What a presenter would say / what Claude is doing. */
  label: string;
  command: string;
  input: Record<string, unknown>;
};

export const HEADLINE_ADDRESS = '1625 Heilmandale Rd';

export const HEADLINE_STEPS: DemoStep[] = [
  { step: 1, label: 'Load 1625 Heilmandale Rd', command: 'load_site', input: { address: HEADLINE_ADDRESS } },
  { step: 1, label: 'Summarize the site: area, frontages, adjacent zoning, terrain, constraints', command: 'get_site_context', input: {} },
  { step: 2, label: 'Show the I-1 rules with citations and interpretation flags', command: 'get_zoning_rules', input: {} },
  {
    step: 3,
    label: 'Log the staffing assumption',
    command: 'log_note',
    input: { note: 'Assumption (not from the tenant): 300 employees on the largest shift and 520 across the two largest successive shifts. Parking is sized to the stricter § 27-1405 reading (item V + office = 350 spaces).' },
  },
  {
    step: 3,
    label: 'Program: ~410,000 SF cross-dock, 40 ft clear, max doors, max trailer stalls',
    command: 'set_program',
    input: { buildingSf: 410000, buildingType: 'crossDock', clearHeightFt: 40, dockDoors: 'max', trailerStalls: 'max', employeesLargestShift: 300, employeesTwoLargestShifts: 520 },
  },
  { step: 5, label: 'Truck access from Route 72', command: 'set_access', input: { network: 'truck', road: 'Route 72', position: 'auto' } },
  { step: 5, label: 'Truck access from Heilmandale Rd', command: 'set_access', input: { network: 'truck', road: 'Heilmandale Rd', position: 'auto' } },
  { step: 5, label: 'Employee cars only from Orange Ln', command: 'set_access', input: { network: 'car', road: 'Orange Ln', position: 'auto', exclusive: true } },
  { step: 4, label: 'Fit the building with its long axis parallel to Heilmandale Rd', command: 'generate_layout', input: { alignToRoad: 'Heilmandale Rd', docksAwayFromResidential: true } },
  { step: 6, label: 'Run checks and report anything that needs attention', command: 'run_checks', input: { statusFilter: ['fail', 'warn'] } },
];

/** Steps 7–10: grading, scenario B, comparison, exports. */
export const HEADLINE_STEPS_GRADING: DemoStep[] = [
  { step: 7, label: 'Grade the site at the default finished floor elevation', command: 'grade_site', input: {} },
  { step: 7, label: 'Optimize the FFE to balance cut and fill', command: 'optimize_ffe', input: { targetNetCy: 0 } },
  { step: 7, label: 'Report cut / fill / net, walls and offsite grading', command: 'get_earthwork_report', input: {} },
];
export const HEADLINE_STEPS_SCENARIO_B: DemoStep[] = [
  { step: 8, label: 'Scenario B: branch the design', command: 'create_scenario', input: { name: 'B: long axis parallel to Route 72' } },
  { step: 8, label: 'Scenario B: rotate the building 90° (parallel to Route 72)', command: 'generate_layout', input: { alignToRoad: 'Route 72' } },
];
export const HEADLINE_STEPS_COMPARE: DemoStep[] = [
  { step: 8, label: 'Compare A vs B', command: 'compare_scenarios', input: {} },
  { step: 9, label: 'Back to scenario A', command: 'switch_scenario', input: { scenarioId: 'A' } },
];
export const HEADLINE_STEPS_EXPORT: DemoStep[] = [];

/** Grading of scenario B (same commands as A, run while B is active). */
export const HEADLINE_STEPS_GRADING_B: DemoStep[] = [{ step: 8, label: 'Scenario B: balance the earthwork', command: 'optimize_ffe', input: { targetNetCy: 0 } }];

export function headlineSteps(): DemoStep[] {
  return [...HEADLINE_STEPS, ...HEADLINE_STEPS_GRADING, ...HEADLINE_STEPS_SCENARIO_B, ...HEADLINE_STEPS_GRADING_B, ...HEADLINE_STEPS_COMPARE, ...HEADLINE_STEPS_EXPORT];
}
