import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { type TestApp, launchChromium, openPage, pageErrors, startTestApp } from './helpers';

let app: TestApp;
let browser: Browser;
beforeAll(async () => {
  app = await startTestApp();
  browser = await launchChromium();
  await app.cmd('load_site', { address: '1625 Heilmandale Rd' });
});
afterAll(async () => {
  await browser?.close();
  await app?.close();
});

describe('phase 3: test fit in the UI', () => {
  it('generates a layout from the Program tab and shows yield + checks', async () => {
    const page = await openPage(browser, app.url);
    await page.waitForSelector('[data-testid="synthetic-badge"]');
    await page.click('[data-testid="tab-program"]');
    await page.fill('#pf-buildingSf', '410000');
    await page.click('[data-testid="btn-generate"]');
    await page.waitForFunction(() => document.querySelectorAll('.tree-item').length > 5, undefined, { timeout: 20_000 });
    await page.click('[data-testid="tab-yield"]');
    await page.waitForSelector('[data-testid="yield-table"]');
    expect(await page.locator('[data-testid="yield-table"]').innerText()).toMatch(/410,400 SF/);
    await page.click('[data-testid="tab-checks"]');
    expect(await page.locator('[data-testid="fail-count"]').innerText()).toBe('0');
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it('dragging the building re-solves the layout through a command', async () => {
    const page = await openPage(browser, app.url);
    await page.waitForFunction(() => (window as any).__gwState().project?.scenarios[0].objects.length > 5);
    const before = await page.evaluate(() => {
      const st = (window as any).__gwState();
      const b = st.project.scenarios[0].objects.find((o: any) => o.type === 'building');
      const v = (window as any).__plan.view;
      return { rev: st.project.revision, center: b.center as [number, number], sx: (b.center[0] - v.cx) * v.scale + v.w / 2, sy: v.h / 2 - (b.center[1] - v.cy) * v.scale, scale: v.scale as number };
    });
    const box = (await page.locator('[data-testid="plan-canvas"]').boundingBox())!;
    const x = box.x + before.sx;
    const y = box.y + before.sy;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 20, y + 10, { steps: 4 });
    await page.mouse.move(x - 40, y + 20, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction((rev) => (window as any).__gwState().project.revision > rev, before.rev, { timeout: 15_000 });
    const after = await page.evaluate(() => {
      const st = (window as any).__gwState();
      return st.project.scenarios[0].objects.find((o: any) => o.type === 'building').center as [number, number];
    });
    expect(after[0] - before.center[0]).toBeCloseTo(-40 / before.scale, 0);
    expect(after[1] - before.center[1]).toBeCloseTo(-20 / before.scale, 0);
    // Undo from the keyboard restores the placement.
    await page.keyboard.press('Control+z');
    await page.waitForFunction((c) => {
      const b = (window as any).__gwState().project.scenarios[0].objects.find((o: any) => o.type === 'building');
      return Math.abs(b.center[0] - c[0]) < 0.01;
    }, before.center);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it('render_view returns a PNG of the plan', async () => {
    const res = await fetch(`${app.url}/api/commands/render_view`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ view: 'plan', width: 1200, height: 800 }) });
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.result.image.mimeType).toBe('image/png');
    const png = Buffer.from(json.result.image.base64, 'base64');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.length).toBeGreaterThan(20_000);
  });
});
