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

describe('phase 1: site data + plan view', () => {
  it('loads the demo site from the UI, shows the synthetic badge and elevation under the cursor', async () => {
    const page = await openPage(browser, app.url);
    await page.click('[data-testid="load-demo-site"]');
    await page.waitForSelector('[data-testid="synthetic-badge"]');
    await page.waitForFunction(() => (window as any).__gw?.contoursReady === true, undefined, { timeout: 30_000 });
    await page.mouse.move(900, 520);
    await page.waitForFunction(() => /\d+\.\d ft/.test(document.querySelector('[data-testid="status-elev"]')?.textContent ?? ''));
    const elev = parseFloat((await page.locator('[data-testid="status-elev"]').innerText()).replace(' ft', ''));
    expect(elev).toBeGreaterThan(460);
    expect(elev).toBeLessThan(520);
    const x = parseFloat(await page.locator('[data-testid="status-x"]').innerText());
    expect(x).toBeGreaterThan(2_300_000); // EPSG:2272 easting, ftUS
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it('get_site_context reports area, frontages, adjacent zoning, terrain and constraints', async () => {
    const ctx = await app.cmd('get_site_context');
    expect(ctx.parcel.areaAc).toBeGreaterThan(104.5);
    expect(ctx.parcel.areaAc).toBeLessThan(115.5);
    expect(ctx.frontages.map((f: any) => f.road).sort()).toEqual(['Heilmandale Rd', 'Orange Ln', 'Route 72']);
    expect(ctx.terrain.synthetic).toBe(true);
    expect(ctx.constraints.some((c: any) => c.kind === 'wetland')).toBe(true);
  });
});
