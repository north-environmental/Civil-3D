import fs from 'node:fs';
import DxfParser from 'dxf-parser';
import ExcelJS from 'exceljs';
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

describe('phase 6: full demo run and exports', () => {
  it('the Demo button replays the whole headline scenario in the browser', async () => {
    const page = await openPage(browser, `${app.url}/?demoDelay=40`);
    await page.waitForSelector('[data-testid="demo-btn"]');
    await page.click('[data-testid="demo-btn"]');
    await page.waitForFunction(() => (window as any).__gw?.demoDone === true, undefined, { timeout: 120_000 });
    const state = await page.evaluate(() => {
      const p = (window as any).__gwState().project;
      return {
        active: p.activeScenarioId,
        scenarios: p.scenarios.map((s: any) => ({ id: s.id, graded: s.grading.graded, fails: s.checks.filter((c: any) => c.status === 'fail').map((c: any) => c.id), net: s.results.earthwork?.netCy, moved: s.results.earthwork ? s.results.earthwork.cutCy + s.results.earthwork.fillCy : 0 })),
        log: p.log.length,
      };
    });
    expect(state.active).toBe('A');
    expect(state.scenarios.map((s: any) => s.id)).toEqual(['A', 'B']);
    const a = state.scenarios[0];
    expect(a.graded).toBe(true);
    expect(a.fails).toEqual([]);
    expect(Math.abs(a.net)).toBeLessThanOrEqual(0.02 * a.moved);
    // Scenario B (rotated 90°) fails exactly one ordinance check, and says why.
    expect(state.scenarios[1].fails).toEqual(['z.landscape.westWallScreen']);
    expect(state.log).toBeGreaterThanOrEqual(15);
    // The log panel shows the narrative; the as-built reference is on at the end.
    await page.click('[data-testid="tab-activity"]');
    const log = await page.locator('[data-testid="activity-log"]').innerText();
    expect(log).toMatch(/Exported scenario A/);
    expect(log).toMatch(/As-built comparison/);
    expect(pageErrors(page)).toEqual([]);
    // Compare dialog from the top bar.
    await page.click('[data-testid="compare-btn"]');
    await page.waitForSelector('[data-testid="compare-dialog"]');
    expect(await page.locator('[data-testid="compare-dialog"]').innerText()).toMatch(/Retaining wall length/);
    await page.close();
  });

  it('exports DXF, GeoJSON, XLSX (4 sheets) and a 24 × 36 PNG sheet that open', async () => {
    const res = await fetch(`${app.url}/api/commands/export`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ formats: ['dxf', 'geojson', 'xlsx', 'png'] }) });
    const json = (await res.json()) as any;
    expect(json.ok, json.error).toBe(true);
    expect(json.result.imageError).toBeUndefined();
    const files = Object.fromEntries((json.result.files as { kind: string; path: string; url: string }[]).map((f) => [f.kind, f]));
    expect(Object.keys(files).sort()).toEqual(['dxf', 'geojson', 'png', 'xlsx']);

    const dxf = new DxfParser().parseSync(fs.readFileSync(files.dxf.path, 'utf8'))!;
    expect(dxf.header.$ACADVER).toBe('AC1024');
    expect(Object.keys(dxf.tables.layer.layers)).toEqual(expect.arrayContaining(['C-PROP', 'C-BLDG', 'C-TRCK', 'C-STRM-BSIN', 'C-TOPO-PROP-MAJR']));
    expect(dxf.entities.length).toBeGreaterThan(500);

    const gj = JSON.parse(fs.readFileSync(files.geojson.path, 'utf8'));
    expect(gj.features.length).toBeGreaterThan(10);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(files.xlsx.path);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Yield', 'Compliance', 'Earthwork', 'Assumptions']);
    expect(wb.getWorksheet('Yield')!.rowCount).toBeGreaterThan(10);
    expect(String(wb.getWorksheet('Compliance')!.getRow(1).getCell(7).value)).toBe('Citation');
    let disclaimer = false;
    wb.getWorksheet('Earthwork')!.eachRow((row) => {
      if (/not for construction/i.test(String(row.getCell(1).value))) disclaimer = true;
    });
    expect(disclaimer).toBe(true);

    const png = fs.readFileSync(files.png.path);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(2700);
    expect(png.readUInt32BE(20)).toBe(1800); // 36 : 24
    // Files are downloadable from the app.
    const dl = await fetch(`${app.url}${files.xlsx.url}`);
    expect(dl.status).toBe(200);
  });
});
