import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { HEADLINE_STEPS } from '@groundwork/core';
import { type TestApp, launchChromium, openPage, pageErrors, startTestApp } from './helpers';

let app: TestApp;
let browser: Browser;
beforeAll(async () => {
  app = await startTestApp();
  browser = await launchChromium();
  for (const st of HEADLINE_STEPS) await app.cmd(st.command, st.input, 'mcp');
});
afterAll(async () => {
  await browser?.close();
  await app?.close();
});

describe('phase 5: grading in the UI', () => {
  it('optimizes FFE from the Earthwork tab, regrades in the worker in < 1.5 s and shows proposed elevation', async () => {
    const page = await openPage(browser, app.url);
    await page.waitForFunction(() => (window as any).__gwState().project?.scenarios[0].objects.length > 5);
    await page.click('[data-testid="tab-earthwork"]');
    await page.click('[data-testid="btn-optimize"]');
    await page.waitForSelector('[data-testid="ffe-value"]', { timeout: 20_000 });
    await page.waitForFunction(() => {
      const p = (window as any).__gwState().project;
      return (window as any).__gw?.gradedKey === `${p.site.id}:${p.activeScenarioId}:${p.revision}`;
    }, undefined, { timeout: 30_000 });
    const ms = await page.evaluate(() => (window as any).__gw.gradeMs as number);
    expect(ms).toBeLessThan(1500);
    const info = await page.evaluate(() => {
      const st = (window as any).__gwState();
      const sc = st.project.scenarios[0];
      const b = sc.objects.find((o: any) => o.type === 'building');
      const v = (window as any).__plan.view;
      return { ffe: sc.grading.ffeFt as number, x: (b.center[0] - v.cx) * v.scale + v.w / 2, y: v.h / 2 - (b.center[1] - v.cy) * v.scale, net: sc.results.earthwork.netCy as number, cut: sc.results.earthwork.cutCy as number, fill: sc.results.earthwork.fillCy as number };
    });
    expect(Math.abs(info.net)).toBeLessThan(0.02 * (info.cut + info.fill));
    const box = (await page.locator('[data-testid="plan-canvas"]').boundingBox())!;
    await page.mouse.move(box.x + info.x, box.y + info.y);
    await page.waitForFunction((ffe) => document.querySelector('[data-testid="status-bar"]')?.textContent?.includes(`PROP${ffe.toFixed(1)} ft`), info.ffe);
    // Cut/fill legend appears with the layer.
    await page.keyboard.press('c');
    await page.waitForSelector('[data-testid="cutfill-legend"]');
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it('3D view renders the proposed surface', async () => {
    const page = await openPage(browser, app.url);
    await page.waitForFunction(() => (window as any).__gwState().project?.scenarios[0].grading.graded === true);
    await page.click('[data-testid="view-3d"]');
    await page.waitForFunction(() => (window as any).__gw?.view3dReady === true, undefined, { timeout: 40_000 });
    await page.waitForSelector('[data-testid="view3d-canvas"]');
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it('render_view returns cut/fill, 3D and section PNGs; cut_section returns data + image', async () => {
    const post = async (name: string, input: unknown) => (await (await fetch(`${app.url}/api/commands/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })).json()) as any;
    for (const view of ['cutfill', '3d']) {
      const r = await post('render_view', { view, width: 1000, height: 640 });
      expect(r.ok, `${view}: ${r.error ?? r.result?.imageError}`).toBe(true);
      expect(r.result.imageError, view).toBeUndefined();
      expect(Buffer.from(r.result.image.base64, 'base64').length, view).toBeGreaterThan(15_000);
    }
    const sec = await post('cut_section', {});
    expect(sec.ok).toBe(true);
    expect(sec.result.profile.length).toBe(60);
    expect(Buffer.from(sec.result.image.base64, 'base64').length).toBeGreaterThan(8_000);
  });
});
