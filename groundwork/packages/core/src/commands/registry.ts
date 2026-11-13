/**
 * THE command layer. Every mutation or query is a named command with a zod input schema.
 * UI, MCP server, scripts and tests all call `executeCommand`; nothing else mutates a Project.
 *
 * Commands are pure over project state. Host-side I/O (reading a site fixture, rendering a PNG,
 * writing export files) is expressed as `services` (sync lookups provided by the host) and
 * `effects` (work the host performs after the command returns).
 */
import { z } from 'zod';
import { GRADING_DEFAULTS } from '../criteria/grading';
import { LAYOUT_DEFAULTS } from '../criteria/layout';
import { STORMWATER_DEFAULTS, STORMWATER_DEFAULT_METHOD } from '../criteria/stormwater';
import type { Site } from '../site/model';
import type { DesignLogEntry, Project, Scenario, Snapshot } from '../site/project';

export type CommandSource = 'ui' | 'mcp' | 'script' | 'system';

export type Effect =
  | { type: 'render'; view: string; params: Record<string, unknown>; width: number; height: number; as: string }
  | { type: 'writeText'; fileName: string; content: string; as: string }
  | { type: 'writeXlsx'; fileName: string; sheets: XlsxSheet[]; as: string };
export type XlsxSheet = { name: string; columns: { header: string; width?: number; numFmt?: string }[]; rows: (string | number | null)[][]; notes?: string[] };

export type HostServices = {
  /** Resolve a site by id / address / parcel id from the fixture store. Sync; fixture-first. */
  resolveSite?: (query: { siteId?: string; address?: string; parcelId?: string }) => Site | null;
  /** Cached ordinance text by section number. */
  ordinanceText?: (section: string) => { section: string; title: string; text: string; source: string; verbatim: boolean } | null;
  listOrdinanceSections?: () => string[];
};

export type CommandContext = { source: CommandSource; now: string; services: HostServices };

export type CommandOutput = {
  /** New project state (omit when nothing changed). */
  project?: Project;
  /** Compact, decision-useful result. Always includes `summary`. */
  result: { summary: string; [k: string]: unknown };
  /** Human-readable design-log line (for mutating commands and notes). */
  log?: string;
  logKind?: 'action' | 'note';
  changedIds?: string[];
  effects?: Effect[];
};

export type CommandDef<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  group: 'Context' | 'Site' | 'Program/layout' | 'Scenarios' | 'Grading' | 'Output';
  title: string;
  /** LLM-facing description: what it does, when to use it, units, what the result contains. */
  description: string;
  input: S;
  mutates: boolean;
  handler: (project: Project, input: z.infer<S>, ctx: CommandContext) => CommandOutput;
};

export class CommandError extends Error {
  constructor(
    message: string,
    public code: 'unknown_command' | 'invalid_input' | 'precondition' | 'not_found' = 'precondition',
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

const registry = new Map<string, CommandDef>();

export function defineCommand<S extends z.ZodTypeAny>(def: CommandDef<S>): CommandDef<S> {
  if (registry.has(def.name)) throw new Error(`Duplicate command ${def.name}`);
  registry.set(def.name, def as unknown as CommandDef);
  return def;
}
export function listCommands(): CommandDef[] {
  return [...registry.values()];
}
export function getCommand(name: string): CommandDef | undefined {
  return registry.get(name);
}

/** Post-mutation hook: recompute derived results (yield, checks, earthwork). Set by ../derive. */
let deriveHook: (p: Project, changed: { command: string }) => Project = (p) => p;
export function setDeriveHook(fn: typeof deriveHook): void {
  deriveHook = fn;
}

const HISTORY_LIMIT = 60;

export function snapshotOf(p: Project): Snapshot {
  return { site: p.site, rules: p.rules, scenarios: p.scenarios, activeScenarioId: p.activeScenarioId };
}

export function newScenario(id: string, name: string): Scenario {
  return {
    id,
    name,
    program: null,
    access: [],
    prefs: { docksAwayFromResidential: true, trailerRowInCourts: true },
    placement: null,
    objects: [],
    layoutCriteria: { ...LAYOUT_DEFAULTS },
    stormwater: { ...STORMWATER_DEFAULTS, method: STORMWATER_DEFAULT_METHOD },
    grading: { criteria: { ...GRADING_DEFAULTS }, ffeFt: null, graded: false, balanceTargetCy: null },
    results: { yield: [], earthwork: null, layoutNotes: [] },
    checks: [],
    nextId: 1,
  };
}

export function newProject(name = 'Untitled project'): Project {
  return {
    id: 'project',
    name,
    revision: 0,
    site: null,
    rules: null,
    scenarios: [newScenario('A', 'Scenario A')],
    activeScenarioId: 'A',
    log: [],
    history: { past: [], future: [] },
  };
}

export type ExecuteResult = {
  project: Project;
  result: { summary: string; [k: string]: unknown };
  entry: DesignLogEntry | null;
  changedIds: string[];
  effects: Effect[];
  mutated: boolean;
};

function formatZodError(name: string, err: z.ZodError): string {
  const issues = err.issues.map((i) => `${i.path.join('.') || '(input)'}: ${i.message}`).join('; ');
  return `Invalid input for ${name}: ${issues}`;
}

export function executeCommand(
  project: Project,
  name: string,
  rawInput: unknown,
  ctxIn: Partial<CommandContext> = {},
): ExecuteResult {
  const ctx: CommandContext = {
    source: ctxIn.source ?? 'system',
    now: ctxIn.now ?? new Date().toISOString(),
    services: ctxIn.services ?? {},
  };

  // undo / redo are history operations handled by the engine itself.
  if (name === 'undo' || name === 'redo') return undoRedo(project, name, ctx);

  const def = registry.get(name);
  if (!def) {
    throw new CommandError(
      `Unknown command "${name}". Available: ${[...registry.keys(), 'undo', 'redo'].sort().join(', ')}`,
      'unknown_command',
    );
  }
  const parsed = def.input.safeParse(rawInput ?? {});
  if (!parsed.success) throw new CommandError(formatZodError(name, parsed.error), 'invalid_input');

  const out = def.handler(project, parsed.data, ctx);
  let next = out.project ?? project;
  const mutated = def.mutates && next !== project;
  let entry: DesignLogEntry | null = null;

  if (mutated) {
    next = deriveHook(next, { command: name });
    const past = [...project.history.past, snapshotOf(project)].slice(-HISTORY_LIMIT);
    next = { ...next, revision: project.revision + 1, history: { past, future: [] } };
  }
  if (out.log) {
    entry = {
      seq: (next.log[next.log.length - 1]?.seq ?? 0) + 1,
      at: ctx.now,
      source: ctx.source,
      command: name,
      message: out.log,
      kind: out.logKind ?? 'action',
      revision: mutated ? next.revision : project.revision,
    };
    next = { ...next, log: [...next.log, entry].slice(-500) };
    if (!mutated) next = { ...next, revision: project.revision + 1 };
  }
  return {
    project: next,
    result: out.result,
    entry,
    changedIds: out.changedIds ?? [],
    effects: out.effects ?? [],
    mutated: mutated || !!entry,
  };
}

function undoRedo(project: Project, name: 'undo' | 'redo', ctx: CommandContext): ExecuteResult {
  const { past, future } = project.history;
  const from = name === 'undo' ? past : future;
  if (!from.length) {
    return {
      project,
      result: { summary: `Nothing to ${name}.`, done: false },
      entry: null,
      changedIds: [],
      effects: [],
      mutated: false,
    };
  }
  const snap = from[from.length - 1];
  const current = snapshotOf(project);
  const history =
    name === 'undo'
      ? { past: past.slice(0, -1), future: [...future, current] }
      : { past: [...past, current], future: future.slice(0, -1) };
  const message = name === 'undo' ? 'Undid the last change.' : 'Redid the last undone change.';
  const entry: DesignLogEntry = {
    seq: (project.log[project.log.length - 1]?.seq ?? 0) + 1,
    at: ctx.now,
    source: ctx.source,
    command: name,
    message,
    kind: 'action',
    revision: project.revision + 1,
  };
  const next: Project = { ...project, ...snap, revision: project.revision + 1, history, log: [...project.log, entry].slice(-500) };
  return {
    project: next,
    result: { summary: message, done: true, revision: next.revision, undoDepth: history.past.length, redoDepth: history.future.length },
    entry,
    changedIds: [],
    effects: [],
    mutated: true,
  };
}

/** Metadata for the two engine-level commands so hosts (MCP, UI) can list them with the rest. */
export const ENGINE_COMMANDS = [
  {
    name: 'undo',
    group: 'Output' as const,
    title: 'Undo',
    description:
      'Undo the last state-changing command (layout, zoning, grading, scenario changes). Returns whether anything was undone and the remaining undo/redo depth.',
    input: z.object({}),
    mutates: true,
  },
  {
    name: 'redo',
    group: 'Output' as const,
    title: 'Redo',
    description: 'Redo the most recently undone command. Returns whether anything was redone.',
    input: z.object({}),
    mutates: true,
  },
];
