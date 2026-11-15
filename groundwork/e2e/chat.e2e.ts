/** Chat panel (built-in parser) and the in-browser PNG export. */
import fs from 'node:fs';
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

describe('chat panel: plain-text request to plan', () => {
  it('the Chat tab is the default right-hand tab and says which engine is answering', async () => {
    const page = await openPage(browser, app.url);
    await page.waitForSelector('[data-testid="chat-panel"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="chat-engine"]')?.textContent?.includes('Built-in parser'));
    expect(await page.locator('.chat-note').innerText()).toMatch(/Claude Code was not found/);
    await page.close();
  });

  it('typing a description loads the site, draws the layout and reports the checks', async () => {
    const page = await openPage(browser, app.url);
    await page.fill('[data-testid="chat-input"]', 'Load 1625 Heilmandale Rd and fit a 410,000 SF cross-dock parallel to Heilmandale Rd with 350 parking spaces, trucks from Heilmandale Rd and cars only from Orange Ln');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => {
        const c = (window as any).__gwState().chat;
        return c && !c.busy && c.messages.length === 2 && c.messages[1].status !== 'running';
      },
      undefined,
      { timeout: 60_000 },
    );
    const st = await page.evaluate(() => {
      const s = (window as any).__gwState();
      const sc = s.project.scenarios[0];
      return {
        reply: s.chat.messages[1],
        site: s.project.site?.id,
        building: sc.objects.find((o: any) => o.type === 'building')?.areaSf,
        driveways: sc.objects.filter((o: any) => o.type === 'driveway').map((o: any) => `${o.network}:${o.roadName}`).sort(),
        carStalls: sc.results.yield.find((y: any) => y.key === 'carStalls')?.value,
        fails: sc.checks.filter((c: any) => c.status === 'fail').length,
      };
    });
    expect(st.site).toBe('heilmandale');
    expect(st.building).toBeGreaterThanOrEqual(410000);
    expect(st.driveways).toEqual(['car:Orange Ln', 'truck:Heilmandale Rd']);
    expect(st.carStalls).toBeGreaterThanOrEqual(350);
    expect(st.fails).toBe(0);
    expect(st.reply.status).toBe('done');
    expect(st.reply.steps.map((x: any) => x.ok)).not.toContain(false);
    expect(st.reply.text).toMatch(/Understood: .*410,000 SF building/);
    expect(st.reply.text).toMatch(/No failing checks/);
    // The transcript is on screen, with one line per command that ran.
    expect(await page.locator('[data-testid="chat-assistant"] .chat-step').count()).toBeGreaterThanOrEqual(6);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it('says so when it does not understand, and changes nothing', async () => {
    const before = (await app.cmd('get_project_summary')).revision;
    const res = await fetch(`${app.url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'make it nicer' }) });
    expect(res.status).toBe(200);
    const chat = (await (await fetch(`${app.url}/api/chat`)).json()) as any;
    const last = chat.messages[chat.messages.length - 1];
    expect(last.steps).toEqual([]);
    expect(last.text).toMatch(/I can read plain descriptions/);
    expect((await app.cmd('get_project_summary')).revision).toBe(before);
  });
});

describe('plan image export (in the browser)', () => {
  it('Export ▸ Plan image PNG downloads a large PNG that includes the aerial', async () => {
    const page = await openPage(browser, app.url);
    await page.waitForFunction(() => (window as any).__gwState().project?.site && (window as any).__gw?.contoursReady === true, undefined, { timeout: 30_000 });
    await page.click('[data-testid="export-btn"]');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.click('[data-testid="export-png"]')]);
    expect(download.suggestedFilename()).toMatch(/^groundwork-heilmandale-plan-a-\d{8}-\d{4}\.png$/);
    const file = await download.path();
    const png = fs.readFileSync(file!);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(3600); // width in pixels
    expect(png.readUInt32BE(20)).toBeGreaterThan(1500);
    // Linework alone compresses to a few hundred KB; with the aerial drawn in it is several MB.
    expect(png.byteLength).toBeGreaterThan(1_500_000);
    await page.waitForFunction(() => /Saved groundwork-heilmandale-plan/.test(document.querySelector('.toast')?.textContent ?? ''));
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });
});
