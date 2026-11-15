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
  it('loads the real demo site from the UI: data badge, aerial underlay and LiDAR elevation under the cursor', async () => {
    const page = await openPage(browser, app.url);
    await page.click('[data-testid="load-demo-site"]');
    await page.waitForSelector('[data-testid="data-badge"]');
    expect(await page.locator('[data-testid="synthetic-badge"]').count()).toBe(0);
    await page.waitForFunction(() => (window as any).__gw?.contoursReady === true, undefined, { timeout: 30_000 });
    // The aerial is on by default and its chunks are served from the cached fixture (no internet).
    const st = await page.evaluate(() => {
      const s = (window as any).__gwState();
      return { imagery: s.layers.imagery, sets: s.project.site.imagery.sets.map((x: any) => x.id), file: s.project.site.imagery.sets[0].chunks[0].file };
    });
    expect(st.imagery).toBe(true);
    expect(st.sets).toEqual(['pema2018', 'naip']);
    const img = await page.request.get(`${app.url}/api/site/assets/${st.file}`);
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toMatch(/image\/jpeg/);
    await page.mouse.move(900, 520);
    await page.waitForFunction(() => /\d+\.\d ft/.test(document.querySelector('[data-testid="status-elev"]')?.textContent ?? ''));
    const elev = parseFloat((await page.locator('[data-testid="status-elev"]').innerText()).replace(' ft', ''));
    expect(elev).toBeGreaterThan(480); // real ground here is roughly 505–575 ft
    expect(elev).toBeLessThan(600);
    const x = parseFloat(await page.locator('[data-testid="status-x"]').innerText());
    expect(x).toBeGreaterThan(2_300_000); // EPSG:2272 easting, ftUS
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it('get_site_context reports area, frontages, adjacent zoning, terrain and constraints', async () => {
    const ctx = await app.cmd('get_site_context');
    expect(ctx.parcel.areaAc).toBeGreaterThan(104.5);
    expect(ctx.parcel.areaAc).toBeLessThan(115.5);
    expect(ctx.frontages.map((f: any) => f.road).sort()).toEqual(['Elias Ave', 'Heilmandale Rd', 'Orange Ln', 'Route 72']);
    expect(ctx.terrain.synthetic).toBe(false);
    expect(ctx.site.synthetic).toBe(false);
    expect(ctx.constraints.some((c: any) => c.kind === 'wetland')).toBe(true);
  });

  it('opens the "where the site data comes from" dialog with a source for every layer', async () => {
    const page = await openPage(browser, app.url);
    await page.click('[data-testid="data-badge"]');
    const text = await page.locator('[data-testid="data-dialog"]').innerText();
    for (const want of ['parcel', 'terrain', 'wetlands', 'districts', 'Lebanon County', 'USGS 3DEP', 'Zoning Map']) expect(text).toContain(want);
    expect(text).toMatch(/floodplain[\s\S]*NOT LOADED/); // the FEMA service was down when the fixture was built
    await page.close();
  });
});
