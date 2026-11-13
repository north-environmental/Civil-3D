import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { type TestApp, launchChromium, openPage, pageErrors, startTestApp } from './helpers';

let app: TestApp;
let browser: Browser;

beforeAll(async () => {
  app = await startTestApp();
  browser = await launchChromium();
});
afterAll(async () => {
  await browser?.close();
  await app?.close();
});

describe('smoke', () => {
  it('serves health, state and the command catalog', async () => {
    const health = await (await fetch(`${app.url}/api/health`)).json();
    expect(health.ok).toBe(true);
    const cmds = (await (await fetch(`${app.url}/api/commands`)).json()) as any[];
    expect(cmds.map((c) => c.name)).toEqual(expect.arrayContaining(['get_project_summary', 'undo', 'redo', 'create_scenario']));
    for (const c of cmds) expect(c.inputSchema.type).toBe('object');
  });

  it('returns a readable error for a bad command', async () => {
    const res = await fetch(`${app.url}/api/commands/not_a_command`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/Unknown command/);
  });

  it('renders the app shell and reflects server state live', async () => {
    const page = await openPage(browser, app.url);
    await page.waitForSelector('[data-testid="topbar"]');
    await expect(page.locator('[data-testid="concept-tag"]').innerText()).resolves.toMatch(/concept-level/i);
    await page.waitForSelector('[data-testid="plan-canvas"]');
    // A command issued over REST (as MCP would) shows up in the browser over WebSocket.
    await app.cmd('log_note', { note: 'Smoke test note from the API.' }, 'mcp');
    await page.click('[data-testid="tab-activity"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="activity-log"]')?.textContent?.includes('Smoke test note'));
    // The CAD-style command line runs commands too.
    await page.fill('[data-testid="cmd-input"]', 'create_scenario name="B: smoke"');
    await page.press('[data-testid="cmd-input"]', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="scenario-tabs"] .scenario-tab').length === 3);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });
});
