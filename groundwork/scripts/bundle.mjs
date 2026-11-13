// Bundles the Node entry points (server, mcp) into single ESM files with esbuild.
import { build } from 'esbuild';

const target = process.argv[2];
const entries = {
  server: { in: 'packages/server/src/main.ts', out: 'packages/server/dist/main.js' },
  mcp: { in: 'packages/mcp/src/index.ts', out: 'packages/mcp/dist/index.js' },
};
const e = entries[target];
if (!e) {
  console.error('usage: node scripts/bundle.mjs server|mcp');
  process.exit(1);
}
await build({
  entryPoints: [e.in],
  outfile: e.out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  // Keep heavyweight / native-ish deps external; they resolve from node_modules at runtime.
  external: ['playwright', 'vite', 'exceljs', 'express', 'ws', 'geotiff'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
