/**
 * MCP end-to-end: spawn the built MCP server with the official client SDK over stdio, list tools,
 * run the headline scenario through MCP and get a PNG back from render_view.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headlineSteps } from '@groundwork/core';
import { type TestApp, freePort, startTestApp } from './helpers';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mcpEntry = path.join(root, 'packages', 'mcp', 'dist', 'index.js');

let app: TestApp;
let client: Client;

async function connect(url: string): Promise<Client> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [mcpEntry], env: { ...(process.env as Record<string, string>), GROUNDWORK_URL: url }, stderr: 'pipe' });
  const c = new Client({ name: 'groundwork-test', version: '0.0.0' });
  await c.connect(transport);
  return c;
}
const text = (r: any): string => r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');

beforeAll(async () => {
  app = await startTestApp();
  client = await connect(app.url);
});
afterAll(async () => {
  await client?.close();
  await app?.close();
});

describe('MCP server', () => {
  it('lists every command as a tool with a real description and an object schema', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const required of [
      'get_project_summary', 'get_site_context', 'get_zoning_rules', 'get_ordinance_text', 'render_view', 'run_checks',
      'load_site', 'set_zoning_rules', 'confirm_zoning_rules', 'add_constraint',
      'set_program', 'place_building', 'set_access', 'generate_layout', 'edit_object', 'delete_object', 'add_parking_field', 'add_trailer_field', 'add_basin',
      'create_scenario', 'switch_scenario', 'compare_scenarios',
      'set_grading_criteria', 'grade_site', 'optimize_ffe', 'get_earthwork_report', 'cut_section',
      'log_note', 'undo', 'redo',
    ])
      expect(names, required).toContain(required);
    for (const t of tools) {
      expect(t.description!.length, t.name).toBeGreaterThan(60);
      expect(t.inputSchema.type).toBe('object');
    }
    expect(client.getInstructions()).toMatch(/concept-level/i);
  });

  it('ships the groundwork_designer prompt', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain('groundwork_designer');
    const p = await client.getPrompt({ name: 'groundwork_designer', arguments: { request: 'Fit a 410,000 SF cross-dock.' } });
    const body = (p.messages[0].content as any).text as string;
    expect(body).toMatch(/load_site/);
    expect(body).toMatch(/Never invent a section/);
    expect(body).toMatch(/Fit a 410,000 SF cross-dock\./);
  });

  it('runs the headline scenario through MCP and the design log records it', async () => {
    for (const st of headlineSteps()) {
      const r: any = await client.callTool({ name: st.command, arguments: st.input });
      expect(r.isError, `${st.command}: ${text(r)}`).toBeFalsy();
      expect(text(r).length).toBeGreaterThan(20);
    }
    const summary: any = await client.callTool({ name: 'get_project_summary', arguments: {} });
    const body = text(summary);
    expect(body).toMatch(/410,400 SF/);
    const state = (await (await fetch(`${app.url}/api/state`)).json()) as any;
    const a = state.scenarios.find((s: any) => s.id === 'A');
    expect(a.checks.filter((c: any) => c.status === 'fail')).toEqual([]);
    expect(state.log.filter((e: any) => e.source === 'mcp').length).toBeGreaterThanOrEqual(8);
    expect(state.scenarios.map((s: any) => s.id)).toEqual(['A', 'B']);
  });

  it('render_view returns a PNG image content block', async () => {
    const r: any = await client.callTool({ name: 'render_view', arguments: { view: 'plan', width: 1600, height: 1000 } });
    expect(r.isError).toBeFalsy();
    const img = r.content.find((c: any) => c.type === 'image');
    expect(img.mimeType).toBe('image/png');
    const png = Buffer.from(img.data, 'base64');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1600);
    expect(png.readUInt32BE(20)).toBe(1000);
  });

  it('returns readable errors: bad input, unknown object, and app not running', async () => {
    const bad: any = await client.callTool({ name: 'set_access', arguments: { network: 'truck', road: 'Main St' } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/no frontage on "Main St"\. Frontages: .*Route 72/);
    const invalid: any = await client.callTool({ name: 'set_program', arguments: { buildingSf: -5 } });
    expect(invalid.isError).toBe(true);
    expect(text(invalid)).toMatch(/Invalid input for set_program/);

    const dead = await connect(`http://127.0.0.1:${await freePort()}`);
    try {
      const r: any = await dead.callTool({ name: 'get_project_summary', arguments: {} });
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/Start the app with `npm run dev`/);
    } finally {
      await dead.close();
    }
  });
});
