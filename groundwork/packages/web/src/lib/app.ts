/** Client state: project (from the server over WebSocket), UI state, command API. */
import type { Grid, Project, Pt, Region, Scenario } from '@groundwork/core';
import { createStore, useStore } from './store';

export type ClientProject = Omit<Project, 'history'> & { history: { undoDepth: number; redoDepth: number } };

export type LayerId =
  | 'parcel'
  | 'roads'
  | 'setbacks'
  | 'imagery'
  | 'existingContours'
  | 'proposedContours'
  | 'cutfill'
  | 'constraints'
  | 'asBuilt'
  | 'neighbors'
  | 'districts'
  | 'design'
  | 'sweptPath'
  | 'labels';

export const LAYERS: { id: LayerId; label: string; swatch: string; defaultOn: boolean }[] = [
  { id: 'imagery', label: 'Aerial photo', swatch: '#6b7a52', defaultOn: true },
  { id: 'asBuilt', label: 'Aerial, as built', swatch: '#d67ad2', defaultOn: false },
  { id: 'parcel', label: 'Property boundary', swatch: '#ffffff', defaultOn: true },
  { id: 'neighbors', label: 'Neighbouring lots', swatch: '#9aa7b5', defaultOn: true },
  { id: 'roads', label: 'Roads', swatch: '#ffd666', defaultOn: true },
  { id: 'setbacks', label: 'Setbacks / envelopes', swatch: '#e8a33d', defaultOn: true },
  { id: 'design', label: 'Design objects', swatch: '#c9ced6', defaultOn: true },
  { id: 'constraints', label: 'Constraints', swatch: '#3fb6a8', defaultOn: true },
  { id: 'districts', label: 'Zoning districts', swatch: '#b48ead', defaultOn: true },
  { id: 'existingContours', label: 'Existing contours (LiDAR)', swatch: '#b0926a', defaultOn: false },
  { id: 'proposedContours', label: 'Proposed contours', swatch: '#e6e1d6', defaultOn: true },
  { id: 'cutfill', label: 'Cut / fill', swatch: 'linear-gradient(90deg,#d0453a,#2f6fd0)', defaultOn: false },
  { id: 'sweptPath', label: 'WB-67 swept path', swatch: '#f0b35a', defaultOn: false },
  { id: 'labels', label: 'Labels', swatch: '#9aa7b5', defaultOn: true },
];

export type RightTab = 'chat' | 'checks' | 'yield' | 'earthwork' | 'program' | 'zoning' | 'activity';
export type Tool = 'select' | 'section';

export type ChatStep = { label: string; summary: string; ok: boolean };
export type ChatMessage = { id: number; role: 'user' | 'assistant'; text: string; steps: ChatStep[]; status: 'running' | 'done' | 'error'; clientActions?: string[] };
/** Chat panel state, owned by the server and pushed over the WebSocket. */
export type ChatState = { engine: 'claude' | 'builtin'; engineLabel: string; engineNote: string; busy: boolean; examples: string[]; messages: ChatMessage[] };

export type ConsoleLine = { kind: 'in' | 'out' | 'err'; text: string };

export type AppState = {
  project: ClientProject | null;
  connected: boolean;
  dem: Grid | null;
  demSiteKey: string;
  layers: Record<LayerId, boolean>;
  selection: string | null;
  hoverTip: { x: number; y: number; text: string } | null;
  view: '2d' | '3d';
  theme: 'dark' | 'light';
  rightTab: RightTab;
  tool: Tool;
  sectionLine: [Pt, Pt] | null;
  /** Outline of an in-progress drag edit (plan view). */
  ghost: Region | null;
  cursor: { x: number; y: number } | null;
  console: ConsoleLine[];
  busy: string | null;
  toast: string | null;
  helpOpen: boolean;
  compareOpen: boolean;
  /** "Where the site data comes from" dialog. */
  dataOpen: boolean;
  chat: ChatState | null;
  zoomTo: { ids: string[]; nonce: number } | null;
  surface3d: 'existing' | 'proposed';
  drape3d: 'plain' | 'cutfill';
  demo: { running: boolean; step: number; total: number; label: string } | null;
};

const savedTheme = (() => {
  try {
    return localStorage.getItem('gw-theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
})() as 'dark' | 'light';

export const app = createStore<AppState>({
  project: null,
  connected: false,
  dem: null,
  demSiteKey: '',
  layers: Object.fromEntries(LAYERS.map((l) => [l.id, l.defaultOn])) as Record<LayerId, boolean>,
  selection: null,
  hoverTip: null,
  view: '2d',
  theme: savedTheme,
  rightTab: 'chat',
  tool: 'select',
  sectionLine: null,
  ghost: null,
  cursor: null,
  console: [],
  busy: null,
  toast: null,
  helpOpen: false,
  compareOpen: false,
  dataOpen: false,
  chat: null,
  zoomTo: null,
  surface3d: 'proposed',
  drape3d: 'plain',
  demo: null,
});

export function useApp<U>(selector: (s: AppState) => U): U {
  return useStore(app, selector);
}
export function activeScenarioOf(p: ClientProject | null): Scenario | null {
  return p ? (p.scenarios.find((s) => s.id === p.activeScenarioId) ?? null) : null;
}
export function useScenario(): Scenario | null {
  return useApp((s) => activeScenarioOf(s.project));
}

export type CommandResponse = { ok: true; revision: number; result: { summary: string; [k: string]: any } } | { ok: false; error: string; code?: string };

/** Run a command on the server. All UI mutations go through here (no logic in components). */
export async function runCommand(name: string, input: unknown = {}, opts: { quiet?: boolean; busy?: string; images?: boolean } = {}): Promise<CommandResponse> {
  if (opts.busy) app.set({ busy: opts.busy });
  try {
    const res = await fetch(`/api/commands/${encodeURIComponent(name)}${opts.images === false ? '?images=0' : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-groundwork-source': 'ui' },
      body: JSON.stringify(input ?? {}),
    });
    const json = (await res.json()) as CommandResponse;
    if (!json.ok && !opts.quiet) toast(json.error);
    return json;
  } catch (err) {
    const error = `Server not reachable: ${(err as Error).message}`;
    if (!opts.quiet) toast(error);
    return { ok: false, error };
  } finally {
    if (opts.busy) app.set({ busy: null });
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string): void {
  if (!text) return;
  app.set({ toast: text });
  clearTimeout(toastTimer);
  // Long messages (export results, errors with a fix) stay up long enough to read.
  toastTimer = setTimeout(() => app.set({ toast: null }), Math.min(15000, 6000 + text.length * 40));
}

async function fetchDem(siteKey: string): Promise<void> {
  try {
    const res = await fetch('/api/site/dem');
    if (!res.ok) return;
    const spec = JSON.parse(res.headers.get('x-grid') ?? '{}');
    const data = new Float32Array(await res.arrayBuffer());
    if (data.length !== spec.nx * spec.ny) return;
    app.set({ dem: { ...spec, data }, demSiteKey: siteKey });
  } catch {
    /* DEM stays null; views degrade gracefully */
  }
}

function onProject(project: ClientProject): Promise<void> {
  let pending: Promise<void> = Promise.resolve();
  const prev = app.get();
  const siteKey = project.site ? `${project.site.id}:${project.site.terrain.nx}x${project.site.terrain.ny}:${project.site.terrain.source}` : '';
  app.set({ project });
  if (siteKey !== prev.demSiteKey) {
    if (!siteKey) app.set({ dem: null, demSiteKey: '' });
    else pending = fetchDem(siteKey);
  }
  const sel = prev.selection;
  if (sel) {
    const sc = activeScenarioOf(project);
    if (!sc?.objects.some((o) => o.id === sel)) app.set({ selection: null });
  }
  return pending;
}

let socket: WebSocket | null = null;
export function connect(): void {
  if (socket) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  socket = ws;
  ws.onopen = () => app.set({ connected: true });
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'state' && msg.project) void onProject(msg.project as ClientProject);
      else if (msg.type === 'chat' && msg.chat) app.set({ chat: msg.chat as ChatState });
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onclose = () => {
    socket = null;
    app.set({ connected: false });
    setTimeout(connect, 1500);
  };
  ws.onerror = () => ws.close();
}

/** Send a plain-text request to the chat backend. Progress arrives over the WebSocket. */
export async function sendChat(message: string): Promise<void> {
  try {
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }) });
    const json = (await res.json()) as { ok: boolean; error?: string };
    // Errors that belong to the conversation are already in the transcript; only surface the rest.
    if (!json.ok && json.error && !app.get().chat?.messages.some((m) => m.status === 'error' && m.text === json.error)) toast(json.error);
  } catch (err) {
    toast(`Server not reachable: ${(err as Error).message}`);
  }
}
export async function chatAction(action: 'stop' | 'reset'): Promise<void> {
  try {
    await fetch(`/api/chat/${action}`, { method: 'POST' });
  } catch {
    /* the socket reconnect will resync */
  }
}

/** One-shot state fetch (used by render mode, which does not need a socket). */
export async function loadStateOnce(): Promise<void> {
  const res = await fetch('/api/state');
  await onProject((await res.json()) as ClientProject);
}

export function setTheme(theme: 'dark' | 'light'): void {
  app.set({ theme });
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('gw-theme', theme);
  } catch {
    /* ignore */
  }
}

// Test / screenshot hook (read-only view of the client state).
(window as any).__gwState = () => app.get();
