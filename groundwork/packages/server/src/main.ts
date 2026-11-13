/**
 * Groundwork server entry.
 *   npm run dev    -> tsx packages/server/src/main.ts --dev   (Vite middleware, hot reload)
 *   npm start      -> node packages/server/dist/main.js       (serves packages/web/dist)
 * Flags: --port <n> (default 4310, or PORT) · --fresh (ignore the saved project) · --projects-dir <dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHostServices, siteAssetsDir } from '@groundwork/data';
import { createApp } from './app';
import { createEffectRunner } from './effects';
import { ProjectStore } from './store';

function findRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'SPEC.md')) || fs.existsSync(path.join(dir, 'data', 'sites'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export async function startServer(argv: string[] = process.argv.slice(2)) {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = findRoot();
  const dev = argv.includes('--dev');
  const port = Number(arg('--port') ?? process.env.PORT ?? 4310);
  const projectsDir = path.resolve(arg('--projects-dir') ?? path.join(root, 'projects'));
  const exportsDir = path.resolve(arg('--exports-dir') ?? path.join(root, 'exports'));
  const dataDir = path.join(root, 'data', 'sites');

  const services = createHostServices(dataDir);
  const store = new ProjectStore(projectsDir, services, { fresh: argv.includes('--fresh') });
  const effects = createEffectRunner({ baseUrl: () => `http://127.0.0.1:${port}`, exportsDir });

  let viteMiddleware: any;
  let viteServer: any;
  if (dev) {
    const { createServer } = await import('vite');
    viteServer = await createServer({
      root: path.join(root, 'packages', 'web'),
      configFile: path.join(root, 'packages', 'web', 'vite.config.ts'),
      server: { middlewareMode: true, hmr: { port: port + 1 } },
      appType: 'spa',
    });
    viteMiddleware = viteServer.middlewares;
  }

  const { server } = createApp({
    store,
    effects,
    exportsDir,
    webDist: path.join(root, 'packages', 'web', 'dist'),
    viteMiddleware,
    siteAssetsDir: (id) => siteAssetsDir(dataDir, id),
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Is Groundwork already running? (Use --port <n> to pick another port.)`);
      }
      reject(err);
    });
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`Groundwork ${dev ? '(dev)' : ''} listening on http://localhost:${port}`);

  const close = async () => {
    store.save();
    await effects.close();
    if (viteServer) await viteServer.close();
    await new Promise<void>((r) => server.close(() => r()));
  };
  return { port, store, close };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer()
    .then(({ close }) => {
      const stop = () => close().finally(() => process.exit(0));
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch((err) => {
      console.error(err.message ?? err);
      process.exit(1);
    });
}
