/**
 * Owns the project state. Every change goes through core `executeCommand`.
 * Persists to <projectsDir>/current.json (+ a Float32 DEM sidecar) and notifies listeners.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  type CommandSource,
  type DesignLogEntry,
  type Effect,
  type HostServices,
  type Project,
  executeCommand,
  newProject,
} from '@groundwork/core';

export type StoreEvent = { revision: number; changedIds: string[]; entry: DesignLogEntry | null; command: string };
export type ClientProject = Omit<Project, 'history'> & { history: { undoDepth: number; redoDepth: number } };

/** Strip non-JSON / bulky fields for clients: DEM samples and history snapshots. */
export function toClientProject(p: Project): ClientProject {
  const site = p.site ? { ...p.site, dem: { ...p.site.dem, data: undefined as any } } : null;
  return { ...p, site, history: { undoDepth: p.history.past.length, redoDepth: p.history.future.length } };
}

export class ProjectStore {
  project: Project;
  private listeners = new Set<(e: StoreEvent) => void>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(
    private projectsDir: string,
    public services: HostServices,
    opts: { fresh?: boolean } = {},
  ) {
    fs.mkdirSync(projectsDir, { recursive: true });
    this.project = (!opts.fresh && this.load()) || newProject('Groundwork demo');
  }

  subscribe(fn: (e: StoreEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  execute(name: string, input: unknown, source: CommandSource): { result: Record<string, unknown>; effects: Effect[]; revision: number } {
    const before = this.project;
    const r = executeCommand(before, name, input, { source, services: this.services });
    this.project = r.project;
    if (r.project !== before) {
      const e: StoreEvent = { revision: r.project.revision, changedIds: r.changedIds, entry: r.entry, command: name };
      for (const fn of this.listeners) fn(e);
      this.scheduleSave();
    }
    return { result: r.result, effects: r.effects, revision: r.project.revision };
  }

  private file(): string {
    return path.join(this.projectsDir, 'current.json');
  }
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 400);
  }
  save(): void {
    try {
      const p = this.project;
      // History is not persisted (snapshots share structure in memory but would balloon on disk).
      const json = { ...toClientProject(p), history: undefined };
      fs.writeFileSync(this.file(), JSON.stringify(json));
      if (p.site) fs.writeFileSync(path.join(this.projectsDir, 'current.dem.f32'), Buffer.from(p.site.dem.data.buffer, p.site.dem.data.byteOffset, p.site.dem.data.byteLength));
    } catch (err) {
      console.error('[store] save failed:', (err as Error).message);
    }
  }
  private load(): Project | null {
    try {
      if (!fs.existsSync(this.file())) return null;
      const json = JSON.parse(fs.readFileSync(this.file(), 'utf8'));
      if (json.site) {
        const buf = fs.readFileSync(path.join(this.projectsDir, 'current.dem.f32'));
        const data = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        if (data.length !== json.site.dem.nx * json.site.dem.ny) throw new Error('DEM sidecar size mismatch');
        json.site.dem.data = data;
      }
      return { ...json, history: { past: [], future: [] } } as Project;
    } catch (err) {
      console.error('[store] could not restore the saved project, starting fresh:', (err as Error).message);
      return null;
    }
  }
}
