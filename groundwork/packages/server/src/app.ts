/** Express app: REST (POST /api/commands/:name), state, DEM, exports, WebSocket broadcast. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CommandError, ENGINE_COMMANDS, type CommandSource, listCommands } from '@groundwork/core';
import { type EffectRunner } from './effects';
import { ProjectStore, toClientProject } from './store';

export type AppOptions = {
  store: ProjectStore;
  effects: EffectRunner;
  exportsDir: string;
  webDist: string | null;
  /** Vite dev middleware (dev mode only). */
  viteMiddleware?: express.RequestHandler;
  siteAssetsDir: (siteId: string) => string | null;
};

export function commandCatalog() {
  const all = [...listCommands(), ...ENGINE_COMMANDS];
  return all.map((c) => ({
    name: c.name,
    group: c.group,
    title: c.title,
    description: c.description,
    mutates: c.mutates,
    inputSchema: zodToJsonSchema(c.input, { $refStrategy: 'none', target: 'jsonSchema7' }),
  }));
}

export function createApp(opts: AppOptions): { app: express.Express; server: http.Server } {
  const { store } = opts;
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, app: 'groundwork', revision: store.project.revision, site: store.project.site?.id ?? null });
  });
  app.get('/api/state', (_req, res) => {
    res.json(toClientProject(store.project));
  });
  app.get('/api/commands', (_req, res) => {
    res.json(commandCatalog());
  });

  app.post('/api/commands/:name', async (req, res) => {
    const name = req.params.name;
    const hdr = String(req.header('x-groundwork-source') ?? 'ui');
    const source: CommandSource = hdr === 'mcp' || hdr === 'script' || hdr === 'system' ? hdr : 'ui';
    try {
      const { result, effects, revision } = store.execute(name, req.body ?? {}, source);
      const extra = effects.length ? await opts.effects.run(effects, { includeImages: req.query.images !== '0' }) : {};
      res.json({ ok: true, revision, result: { ...result, ...extra } });
    } catch (err) {
      if (err instanceof CommandError) {
        res.status(err.code === 'unknown_command' ? 404 : 400).json({ ok: false, error: err.message, code: err.code });
      } else {
        console.error(`[command ${name}]`, err);
        res.status(500).json({ ok: false, error: `Internal error in ${name}: ${(err as Error).message}`, code: 'internal' });
      }
    }
  });

  // Existing-ground DEM as raw little-endian Float32 (row-major, j = south→north). Spec in headers.
  app.get('/api/site/dem', (_req, res) => {
    const site = store.project.site;
    if (!site) return res.status(404).json({ ok: false, error: 'No site loaded' });
    const d = site.dem;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('x-grid', JSON.stringify({ x0: d.x0, y0: d.y0, cellFt: d.cellFt, nx: d.nx, ny: d.ny }));
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(d.data.buffer, d.data.byteOffset, d.data.byteLength));
  });

  // Site fixture assets (cached imagery tiles etc.).
  app.get('/api/site/assets/*', (req, res) => {
    const site = store.project.site;
    const dir = site ? opts.siteAssetsDir(site.id) : null;
    if (!dir) return res.status(404).end();
    const rel = path.normalize((req.params as any)[0] as string);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return res.status(400).end();
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) return res.status(404).end();
    res.sendFile(file);
  });

  app.use('/exports', express.static(opts.exportsDir));

  if (opts.viteMiddleware) {
    app.use(opts.viteMiddleware);
  } else if (opts.webDist && fs.existsSync(path.join(opts.webDist, 'index.html'))) {
    app.use(express.static(opts.webDist));
    app.get('*', (_req, res) => res.sendFile(path.join(opts.webDist!, 'index.html')));
  } else {
    app.get('/', (_req, res) => {
      res
        .status(503)
        .type('text/plain')
        .send('Groundwork server is running, but the web app is not built. Run `npm run build` (or `npm run dev`).');
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/ws')) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    }
    // Other upgrade requests (e.g. Vite HMR on its own port) are left alone.
  });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'state', revision: store.project.revision, changedIds: [], entry: null, project: toClientProject(store.project) }));
  });
  store.subscribe((e) => {
    const msg = JSON.stringify({ type: 'state', revision: e.revision, changedIds: e.changedIds, designLogEntry: e.entry, command: e.command, project: toClientProject(store.project) });
    for (const client of wss.clients) if (client.readyState === 1) client.send(msg);
  });

  return { app, server };
}
