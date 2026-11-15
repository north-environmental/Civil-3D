/**
 * Chat panel backend. Two engines, picked automatically:
 *
 *  - "claude": the Claude Code CLI on this computer, run headless (`claude -p`) with the Groundwork
 *    MCP server as its only tool source. It uses whatever login Claude Code already has, so no API
 *    key is involved and the app itself never calls the Anthropic API.
 *  - "builtin": a small pattern-matching interpreter (core `interpretRequest`) used when Claude Code
 *    is not installed. It handles common phrasings and says so when it does not understand.
 *
 * Either way the design only changes through the command layer.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { CHAT_EXAMPLES, CommandError, type Effect, interpretRequest } from '@groundwork/core';
import { DESIGNER_PROMPT } from '../../mcp/src/prompt';
import type { EffectRunner } from './effects';
import type { ProjectStore } from './store';

export type ChatStep = { label: string; summary: string; ok: boolean };
export type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  steps: ChatStep[];
  status: 'running' | 'done' | 'error';
  /** Things the browser should do once when this message completes (e.g. save the plan PNG). */
  clientActions?: string[];
};
export type ChatEngine = 'claude' | 'builtin';
export type ChatState = {
  engine: ChatEngine;
  engineLabel: string;
  engineNote: string;
  busy: boolean;
  examples: string[];
  messages: ChatMessage[];
};

export type ChatOptions = {
  store: ProjectStore;
  effects: EffectRunner;
  /** Repo root (to find the MCP server entry). */
  root: string;
  port: () => number;
  /** "auto" (default), "claude" or "builtin"; also read from GROUNDWORK_CHAT. */
  engine?: 'auto' | ChatEngine;
};

const CHAT_PROMPT = `${DESIGNER_PROMPT}

You are running inside the Groundwork app's own chat panel
- The person is looking at the plan view right next to this chat; it redraws after every tool call. They describe what they want to build in plain words and you make it appear on the plan.
- Act first, then report. When the request is clear enough, make the tool calls without asking for confirmation; ask one short question only when a choice would change the layout materially and cannot be guessed (for example no building size at all).
- If no site is loaded, load the demo site with load_site {"address": "1625 Heilmandale Rd"} unless they name another one.
- After generate_layout or any edit, call run_checks and tell them what fails and why, with the citation, in a sentence each.
- Keep replies short: under about 120 words, plain sentences or a few short "- " bullets, the numbers that matter with units, no headings, no tables unless they ask, no raw tool output. They can see the plan; do not describe it at length. Put caveats about data quality in one closing sentence, not a list.
- Do exactly what was asked. Do not create extra scenarios, move things or change the program on your own initiative; if you see a better option, say so in one sentence and let them decide.
- load_site already returns the frontages and the rule set status. Call get_site_context or get_zoning_rules only when you need a detail they hold (adjacent zoning, a specific limit), not as a routine first step.
- The current focus is the 2D test fit. Do not grade the site unless they ask about grading or earthwork.
- Do not call render_view unless they ask for an image. For a PNG of the plan, tell them to use Export ▾ → "Plan image PNG" in the top bar (it saves to their Downloads folder).
- You only have the Groundwork tools. If they ask for something the tools cannot do, say so plainly and suggest the nearest thing that can be done.`;

const TURN_TIMEOUT_MS = 6 * 60_000;
const MAX_MESSAGES = 80;

function findClaude(): { bin: string; version: string } | null {
  const bin = process.env.GROUNDWORK_CLAUDE_BIN || 'claude';
  try {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000, shell: process.platform === 'win32' });
    if (r.status === 0 && /claude/i.test(r.stdout)) return { bin, version: r.stdout.trim() };
  } catch {
    /* not installed */
  }
  return null;
}

export class ChatManager {
  private messages: ChatMessage[] = [];
  private nextId = 1;
  private busy = false;
  private child: ChildProcess | null = null;
  private sessionId: string | null = null;
  private claude: { bin: string; version: string } | null | undefined;
  private listeners = new Set<(s: ChatState) => void>();
  private workDir: string;

  constructor(private opts: ChatOptions) {
    this.workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-chat-'));
  }

  subscribe(fn: (s: ChatState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    const s = this.state();
    for (const fn of this.listeners) fn(s);
  }

  private engine(): ChatEngine {
    const want = (this.opts.engine ?? process.env.GROUNDWORK_CHAT ?? 'auto') as string;
    if (want === 'builtin') return 'builtin';
    if (this.claude === undefined) this.claude = findClaude();
    return this.claude ? 'claude' : 'builtin';
  }

  state(): ChatState {
    const engine = this.engine();
    return {
      engine,
      engineLabel: engine === 'claude' ? 'Claude' : 'Built-in parser',
      engineNote:
        engine === 'claude'
          ? `Connected to Claude through Claude Code on this computer (${this.claude?.version ?? 'version unknown'}). It uses your existing Claude login; the Groundwork tools are the only tools it has.`
          : 'Claude Code was not found on this computer, so a simple built-in parser is reading your text. It handles common phrasings only. Install Claude Code and sign in (see docs/CHAT.md), then restart Groundwork, to chat with Claude here.',
      busy: this.busy,
      examples: CHAT_EXAMPLES,
      messages: this.messages,
    };
  }

  reset(): void {
    this.stop();
    this.messages = [];
    this.sessionId = null;
    this.emit();
  }

  stop(): void {
    if (this.child && !this.child.killed) this.child.kill();
  }

  /** Start a turn. Resolves when the turn is finished (the UI follows progress over the WebSocket). */
  async send(text: string): Promise<{ ok: boolean; error?: string }> {
    const message = text.trim();
    if (!message) return { ok: false, error: 'Type what you want to build.' };
    if (message.length > 4000) return { ok: false, error: 'That message is too long (4,000 characters max).' };
    if (this.busy) return { ok: false, error: 'Still working on the previous message. Wait for it to finish or press Stop.' };
    this.busy = true;
    this.messages.push({ id: this.nextId++, role: 'user', text: message, steps: [], status: 'done' });
    const reply: ChatMessage = { id: this.nextId++, role: 'assistant', text: '', steps: [], status: 'running' };
    this.messages.push(reply);
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    this.emit();
    try {
      if (this.engine() === 'claude') await this.runClaude(message, reply);
      else await this.runBuiltin(message, reply);
      if (reply.status === 'running') reply.status = 'done';
    } catch (err) {
      reply.status = 'error';
      reply.text = [reply.text, (err as Error).message].filter(Boolean).join('\n\n');
    } finally {
      this.busy = false;
      this.child = null;
      this.emit();
    }
    return { ok: reply.status !== 'error', error: reply.status === 'error' ? reply.text : undefined };
  }

  // ---- built-in interpreter -------------------------------------------------------------------

  private async runBuiltin(message: string, reply: ChatMessage): Promise<void> {
    const { store } = this.opts;
    let plan = interpretRequest(message, store.project);
    if (plan.help && !plan.calls.length) {
      reply.text = plan.help;
      return;
    }
    const run = async (name: string, input: Record<string, unknown>, label: string): Promise<boolean> => {
      try {
        const { result, effects } = store.execute(name, input, 'ui');
        const extra = effects.length ? await this.opts.effects.run(effects as Effect[], { includeImages: false }) : {};
        const files = (extra as { files?: { url: string }[] }).files;
        reply.steps.push({ label, summary: String(result.summary ?? '') + (files?.length ? ` Files: ${files.map((f) => f.url).join(', ')}` : ''), ok: true });
        this.emit();
        return true;
      } catch (err) {
        reply.steps.push({ label, summary: err instanceof CommandError ? err.message : `Internal error: ${(err as Error).message}`, ok: false });
        this.emit();
        return false;
      }
    };
    // A site has to exist before road names can be matched: load first, then read the text again.
    if (plan.calls[0]?.name === 'load_site') {
      const first = plan.calls[0];
      if (!(await run(first.name, first.input, first.label))) {
        reply.status = 'error';
        reply.text = 'The site could not be loaded, so nothing else was done.';
        return;
      }
      const again = interpretRequest(message, store.project);
      plan = { ...again, calls: again.calls.filter((c) => c.name !== 'load_site'), understood: [...new Set([...plan.understood, ...again.understood])] };
    }
    let failed = 0;
    for (const c of plan.calls) if (!(await run(c.name, c.input, c.label))) failed++;
    if (plan.clientActions?.length) reply.clientActions = plan.clientActions;

    const last = (name: string) => [...reply.steps].reverse().find((s) => s.ok && s.label === plan.calls.find((c) => c.name === name)?.label)?.summary;
    const parts: string[] = [];
    if (plan.understood.length) parts.push(`Understood: ${plan.understood.join('; ')}.`);
    const headline = last('generate_layout') ?? last('optimize_ffe') ?? last('grade_site') ?? last('get_project_summary') ?? last('load_site');
    if (headline) parts.push(headline);
    const checks = last('run_checks');
    if (checks && checks !== headline) parts.push(checks);
    const sc = store.project.scenarios.find((x) => x.id === store.project.activeScenarioId);
    if (plan.calls.some((c) => c.name === 'generate_layout') && sc?.program && sc.program.carStalls === undefined && sc.program.employeesLargestShift === undefined && sc.program.employeesTwoLargestShifts === undefined)
      parts.push('Car parking is not sized yet because I do not know the headcount. Tell me, for example, "300 employees" or "350 parking spaces".');
    if (plan.clientActions?.includes('exportPng')) parts.push('Saving the plan as a PNG: look in your browser’s Downloads folder.');
    if (failed) parts.push(`${failed} step${failed > 1 ? 's' : ''} did not work: see the red line${failed > 1 ? 's' : ''} above.`);
    if (!parts.length) parts.push('Done.');
    reply.text = parts.join('\n\n');
    if (failed && failed === plan.calls.length) reply.status = 'error';
  }

  // ---- Claude Code (headless) -----------------------------------------------------------------

  /** MCP server entry: the built bundle if present, else the TypeScript source through tsx (dev). */
  private mcpServer(): { command: string; args: string[] } {
    const dist = path.join(this.opts.root, 'packages', 'mcp', 'dist', 'index.js');
    const src = path.join(this.opts.root, 'packages', 'mcp', 'src', 'index.ts');
    if (fs.existsSync(dist) && (!fs.existsSync(src) || fs.statSync(dist).mtimeMs >= fs.statSync(src).mtimeMs)) return { command: process.execPath, args: [dist] };
    try {
      const tsx = createRequire(path.join(this.opts.root, 'package.json')).resolve('tsx/cli');
      return { command: process.execPath, args: [tsx, src] };
    } catch {
      if (fs.existsSync(dist)) return { command: process.execPath, args: [dist] };
      throw new Error('The Groundwork MCP server is not built. Run "npm run build" once in the groundwork folder, then try again.');
    }
  }

  private runClaude(message: string, reply: ChatMessage): Promise<void> {
    const mcp = this.mcpServer();
    const configFile = path.join(this.workDir, 'mcp.json');
    const promptFile = path.join(this.workDir, 'system-prompt.txt');
    fs.writeFileSync(
      configFile,
      JSON.stringify({ mcpServers: { groundwork: { command: mcp.command, args: mcp.args, env: { GROUNDWORK_URL: `http://127.0.0.1:${this.opts.port()}` } } } }),
    );
    fs.writeFileSync(promptFile, CHAT_PROMPT);
    const win = process.platform === 'win32';
    const q = (s: string) => (win ? `"${s}"` : s); // paths may contain spaces; only quoted when a shell parses them
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--mcp-config', q(configFile),
      '--strict-mcp-config', // only the Groundwork server, not the user's other MCP servers
      '--tools', win ? '""' : '', // no built-in tools: no shell, no file access
      '--allowedTools', 'mcp__groundwork', // every Groundwork tool is pre-approved; nothing else is
      '--append-system-prompt-file', q(promptFile),
      '--setting-sources', win ? '""' : '', // ignore user/project settings, hooks and CLAUDE.md files
    ];
    if (process.env.GROUNDWORK_CLAUDE_MODEL) args.push('--model', process.env.GROUNDWORK_CLAUDE_MODEL);
    if (this.sessionId) args.push('--resume', this.sessionId);

    return new Promise<void>((resolve, reject) => {
      const child = spawn(this.claude!.bin, args, { cwd: this.workDir, shell: win, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
      this.child = child;
      const timer = setTimeout(() => child.kill(), TURN_TIMEOUT_MS);
      const pending = new Map<string, ChatStep>();
      let stderr = '';
      let buf = '';
      let finished = false;
      let texts: string[] = [];

      const onLine = (line: string) => {
        let ev: any;
        try {
          ev = JSON.parse(line);
        } catch {
          return;
        }
        if (ev.type === 'system' && ev.subtype === 'init') {
          this.sessionId = ev.session_id ?? this.sessionId;
          const srv = (ev.mcp_servers ?? []).find((s: any) => s.name === 'groundwork');
          if (srv && srv.status && srv.status !== 'connected') reply.steps.push({ label: 'Connect to Groundwork', summary: `The Groundwork tools did not connect (${srv.status}).`, ok: false });
        } else if (ev.type === 'assistant') {
          for (const block of ev.message?.content ?? []) {
            if (block.type === 'text' && block.text?.trim()) {
              texts.push(block.text.trim());
              reply.text = texts.join('\n\n');
            } else if (block.type === 'tool_use') {
              const name = String(block.name ?? '').replace(/^mcp__groundwork__/, '');
              const step: ChatStep = { label: name, summary: 'working…', ok: true };
              pending.set(block.id, step);
              reply.steps.push(step);
              // Text written before a tool call is narration; the final answer comes after the last call.
              texts = [];
            }
          }
          this.emit();
        } else if (ev.type === 'user') {
          for (const block of ev.message?.content ?? []) {
            if (block.type !== 'tool_result') continue;
            const step = pending.get(block.tool_use_id);
            if (!step) continue;
            const body = Array.isArray(block.content) ? block.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(' ') : String(block.content ?? '');
            // Tool results are "<summary>\n\n<json details>"; the first paragraph is the summary.
            let summary = body.split(/\n\s*\n/)[0];
            try {
              const j = JSON.parse(body);
              summary = j.summary ?? j.error ?? summary;
            } catch {
              /* plain text result */
            }
            step.summary = String(summary).slice(0, 600);
            step.ok = !block.is_error;
          }
          this.emit();
        } else if (ev.type === 'result') {
          finished = true;
          this.sessionId = ev.session_id ?? this.sessionId;
          if (ev.is_error) {
            reply.status = 'error';
            reply.text = [reply.text, `Claude stopped with an error: ${String(ev.result ?? ev.subtype ?? 'unknown')}`].filter(Boolean).join('\n\n');
          } else if (typeof ev.result === 'string' && ev.result.trim()) reply.text = ev.result.trim();
        }
      };

      child.stdout!.on('data', (d: Buffer) => {
        buf += d.toString('utf8');
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) onLine(line);
        }
      });
      child.stderr!.on('data', (d: Buffer) => {
        stderr = (stderr + d.toString('utf8')).slice(-2000);
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Could not start Claude Code (${err.message}).`));
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (buf.trim()) onLine(buf.trim());
        for (const s of pending.values()) if (s.summary === 'working…') s.summary = 'stopped';
        if (finished) return resolve();
        if (signal) return reject(new Error('Stopped.'));
        const hint = /log ?in|auth|credential|api key/i.test(stderr) ? ' Claude Code may not be signed in: run "claude" once in a terminal and log in.' : '';
        reject(new Error(`Claude Code exited before answering (code ${code}).${hint}${stderr ? ` Details: ${stderr.trim().slice(-400)}` : ''}`));
      });
      // The prompt goes in on stdin so no shell ever has to quote the user's text.
      child.stdin!.end(message);
    });
  }
}
