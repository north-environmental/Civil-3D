/** Scenario-level grading entry point. Implemented in Phase 5 (after the hand-calc tests). */
import type { Site } from '../site/model';
import type { EarthworkReport, Scenario } from '../site/project';

export function gradeScenario(_site: Site, _s: Scenario, _ffeFt: number): { report: EarthworkReport } {
  throw new Error('Grading engine not implemented yet');
}
