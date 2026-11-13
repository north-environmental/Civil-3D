#!/usr/bin/env node
/**
 * Groundwork MCP server (stdio). Thin by design: every MCP tool is one Groundwork command, forwarded to
 * the app's REST API (POST /api/commands/:name). The app owns all state and logic; this process holds none.
 *
 * Register in Claude Desktop / Claude Code (see docs/MCP_SETUP.md):
 *   node <abs path>/packages/mcp/dist/index.js
 * Env: GROUNDWORK_URL (default http://localhost:4310)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ENGINE_COMMANDS, listCommands } from '@groundwork/core';
import { DESIGNER_PROMPT, SERVER_INSTRUCTIONS } from './prompt';

const BASE_URL = (process.env.GROUNDWORK_URL ?? 'http://localhost:4310').replace(/\/$/, '');
const NOT_RUNNING =
  `The Groundwork app is not reachable at ${BASE_URL}. Start the app with \`npm run dev\` in the groundwork folder ` +
  '(then open the URL it prints in a browser to watch the design update), and try again.';

const catalog = [...listCommands(), ...ENGINE_COMMANDS].map((c) => ({
  name: c.name,
  title: c.title,
  description: `${c.description}${c.mutates ? '' : ' Read-only.'}`,
  inputSchema: zodToJsonSchema(c.input, { $refStrategy: 'none', target: 'jsonSchema7' }) as Record<string, unknown>,
  mutates: c.mutates,
}));

const server = new Server({ name: 'groundwork', version: '0.1.0' }, { capabilities: { tools: {}, prompts: {} }, instructions: SERVER_INSTRUCTIONS });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: catalog.map((c) => ({
    name: c.name,
    title: c.title,
    description: c.description,
    inputSchema: { type: 'object', ...c.inputSchema },
    annotations: { title: c.title, readOnlyHint: !c.mutates, destructiveHint: false, openWorldHint: false },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  if (!catalog.some((c) => c.name === name)) {
    return { isError: true, content: [{ type: 'text', text: `Unknown tool "${name}". Available: ${catalog.map((c) => c.name).join(', ')}.` }] };
  }
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/commands/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-groundwork-source': 'mcp' },
      body: JSON.stringify(req.params.arguments ?? {}),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return { isError: true, content: [{ type: 'text', text: NOT_RUNNING }] };
  }
  let json: any;
  try {
    json = await res.json();
  } catch {
    return { isError: true, content: [{ type: 'text', text: `${NOT_RUNNING} (Unexpected non-JSON reply, HTTP ${res.status}.)` }] };
  }
  if (!json.ok) return { isError: true, content: [{ type: 'text', text: String(json.error ?? `HTTP ${res.status}`) }] };

  const { summary, image, imageError, ...rest } = json.result as { summary: string; image?: { mimeType: string; base64: string }; imageError?: string; [k: string]: unknown };
  const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [];
  const detail = Object.keys(rest).length ? `\n\n${JSON.stringify(rest, null, 1)}` : '';
  content.push({ type: 'text', text: `${summary}${imageError ? `\n(Image not available: ${imageError})` : ''}${detail}` });
  if (image) content.push({ type: 'image', data: image.base64, mimeType: image.mimeType });
  return { content };
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'groundwork_designer',
      title: 'Groundwork site designer',
      description: 'Primes Claude to run an industrial site test fit and grading study in Groundwork: load site → confirm zoning → program → layout → check → grade → iterate → export.',
      arguments: [{ name: 'request', description: 'What to design, e.g. "Fit a 410,000 SF cross-dock at 1625 Heilmandale Rd".', required: false }],
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (req) => {
  if (req.params.name !== 'groundwork_designer') throw new Error(`Unknown prompt "${req.params.name}"`);
  const request = req.params.arguments?.request;
  return {
    description: 'Groundwork site designer workflow',
    messages: [{ role: 'user', content: { type: 'text', text: `${DESIGNER_PROMPT}${request ? `\n\nThe request: ${request}` : ''}` } }],
  };
});

await server.connect(new StdioServerTransport());
// stdout is the MCP channel; diagnostics go to stderr only.
console.error(`[groundwork-mcp] ready: ${catalog.length} tools → ${BASE_URL}`);
