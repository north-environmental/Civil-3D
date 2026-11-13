import { describe, expect, it } from 'vitest';
import { CommandError, executeCommand, listCommands, newProject } from './index';

describe('command registry', () => {
  it('lists commands with descriptions and schemas', () => {
    const cmds = listCommands();
    expect(cmds.length).toBeGreaterThan(3);
    for (const c of cmds) {
      expect(c.description.length, c.name).toBeGreaterThan(40);
      expect(c.input).toBeDefined();
    }
  });

  it('rejects unknown commands and invalid input with readable errors', () => {
    const p = newProject();
    expect(() => executeCommand(p, 'nope', {})).toThrow(CommandError);
    expect(() => executeCommand(p, 'switch_scenario', {})).toThrow(/Invalid input for switch_scenario: scenarioId/);
  });

  it('creates and switches scenarios, bumping the revision and logging', () => {
    let p = newProject();
    const r1 = executeCommand(p, 'create_scenario', { name: 'B: test' }, { source: 'mcp' });
    p = r1.project;
    expect(p.scenarios.map((s) => s.id)).toEqual(['A', 'B']);
    expect(p.activeScenarioId).toBe('B');
    expect(p.revision).toBe(1);
    expect(r1.entry?.source).toBe('mcp');
    expect(p.log).toHaveLength(1);
    p = executeCommand(p, 'switch_scenario', { scenarioId: 'A' }).project;
    expect(p.activeScenarioId).toBe('A');
    expect(p.revision).toBe(2);
  });

  it('undo / redo walk the history', () => {
    let p = newProject();
    p = executeCommand(p, 'create_scenario', {}).project;
    p = executeCommand(p, 'create_scenario', {}).project;
    expect(p.scenarios).toHaveLength(3);
    p = executeCommand(p, 'undo', {}).project;
    expect(p.scenarios).toHaveLength(2);
    expect(p.activeScenarioId).toBe('B');
    p = executeCommand(p, 'undo', {}).project;
    expect(p.scenarios).toHaveLength(1);
    const none = executeCommand(p, 'undo', {});
    expect(none.result.done).toBe(false);
    p = executeCommand(p, 'redo', {}).project;
    p = executeCommand(p, 'redo', {}).project;
    expect(p.scenarios).toHaveLength(3);
    expect(executeCommand(p, 'redo', {}).result.done).toBe(false);
    // a new mutation clears the redo stack
    p = executeCommand(p, 'undo', {}).project;
    p = executeCommand(p, 'create_scenario', { name: 'X' }).project;
    expect(p.history.future).toHaveLength(0);
  });

  it('log_note appends a note without touching history', () => {
    const p = newProject();
    const r = executeCommand(p, 'log_note', { note: 'Assumed 300 employees on the largest shift.' }, { source: 'mcp' });
    expect(r.project.log[0].kind).toBe('note');
    expect(r.project.history.past).toHaveLength(0);
    expect(r.project.revision).toBe(1);
  });

  it('get_project_summary works on an empty project', () => {
    const r = executeCommand(newProject(), 'get_project_summary', {});
    expect(r.result.summary).toMatch(/No site loaded/);
    expect(r.mutated).toBe(false);
  });
});
