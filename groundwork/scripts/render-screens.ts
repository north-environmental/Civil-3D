/**
 * Captures QA screenshots of the real app into docs/screens/ (part of `npm run verify`).
 * Starts the server in-process on a free port against the built web app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, openPage, startTestApp } from '../e2e/helpers';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'screens');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const app = await startTestApp();
  const browser = await launchChromium();
  const shots: string[] = [];
  try {
    const page = await openPage(browser, app.url);
    const shot = async (name: string) => {
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(outDir, name) });
      shots.push(name);
    };
    await page.waitForSelector('[data-testid="topbar"]');
    await shot('00-shell-empty.png');

    // Phase 1: site data + plan view
    await page.click('[data-testid="load-demo-site"]');
    await page.waitForSelector('[data-testid="synthetic-badge"]');
    await page.waitForFunction(() => (window as any).__gw?.contoursReady === true, undefined, { timeout: 30_000 });
    await page.mouse.move(900, 520);
    await shot('01-site-plan.png');
    await page.keyboard.press('b');
    await shot('01-site-plan-asbuilt.png');
    await page.keyboard.press('b');

    // Phase 2: zoning envelopes, citation tooltip, rules panel
    await page.click('[data-testid="tab-zoning"]');
    const tipAt = await page.evaluate(() => {
      const plan = (window as any).__plan;
      // Find a point on the building setback line along Heilmandale Rd: scan down from the parcel's north edge.
      const st = (window as any).__gwState();
      const ring = st.project.site.parcel.ring as [number, number][];
      const nw = ring[5];
      const ne = ring[4];
      const mid = [(nw[0] + ne[0]) / 2, (nw[1] + ne[1]) / 2];
      const d = [ne[0] - nw[0], ne[1] - nw[1]];
      const l = Math.hypot(d[0], d[1]);
      const inward = [d[1] / l, -d[0] / l];
      const w = [mid[0] + inward[0] * 150, mid[1] + inward[1] * 150];
      const v = plan.view;
      return [(w[0] - v.cx) * v.scale + v.w / 2, v.h / 2 - (w[1] - v.cy) * v.scale];
    });
    const box = (await page.locator('[data-testid="plan-canvas"]').boundingBox())!;
    await page.mouse.move(box.x + tipAt[0], box.y + tipAt[1]);
    await shot('02-zoning-envelopes.png');
    await page.click('[data-testid="tab-checks"]');

    // Phase 3: headline test fit (commands only, as Claude would issue them over MCP)
    await app.cmd('set_program', { buildingSf: 410000, buildingType: 'crossDock', clearHeightFt: 40, dockDoors: 'max', trailerStalls: 'max', employeesLargestShift: 300, employeesTwoLargestShifts: 520 }, 'mcp');
    await app.cmd('set_access', { network: 'truck', road: 'Route 72' }, 'mcp');
    await app.cmd('set_access', { network: 'truck', road: 'Heilmandale Rd' }, 'mcp');
    await app.cmd('set_access', { network: 'car', road: 'Orange Ln', exclusive: true }, 'mcp');
    await app.cmd('generate_layout', { alignToRoad: 'Heilmandale Rd' }, 'mcp');
    await page.waitForFunction(() => document.querySelectorAll('.tree-item').length > 5);
    await page.mouse.move(1500, 1000);
    await shot('03-layout-plan-checks.png');
    await page.click('[data-testid="tab-yield"]');
    await shot('03-layout-yield.png');
    await page.click('[data-testid="tab-checks"]');

    // Phase 5: grading + earthwork
    await app.cmd('optimize_ffe', { targetNetCy: 0 }, 'mcp');
    const graded = () => page.waitForFunction(() => {
      const st = (window as any).__gwState();
      const p = st.project;
      return (window as any).__gw?.gradedKey === `${p.site.id}:${p.activeScenarioId}:${p.revision}`;
    }, undefined, { timeout: 30_000 });
    await graded();
    await page.click('[data-testid="tab-earthwork"]');
    await shot('05-grading-contours-earthwork.png');
    await page.keyboard.press('c');
    await shot('05-grading-cutfill.png');
    // Section through the building, across its depth.
    const sec = await page.evaluate(() => {
      const st = (window as any).__gwState();
      const b = st.project.scenarios[0].objects.find((o: any) => o.type === 'building');
      const v = (window as any).__plan.view;
      const ang = (b.rotationDeg * Math.PI) / 180;
      const half = b.depthFt / 2 + 330;
      // (No nested named functions here: tsx's keepNames helper does not exist inside the page.)
      const ends = [
        [b.center[0] + Math.sin(ang) * half, b.center[1] - Math.cos(ang) * half],
        [b.center[0] - Math.sin(ang) * half, b.center[1] + Math.cos(ang) * half],
      ];
      return ends.map((w) => [(w[0] - v.cx) * v.scale + v.w / 2, v.h / 2 - (w[1] - v.cy) * v.scale]);
    });
    await page.keyboard.press('s');
    await page.mouse.click(box.x + sec[0][0], box.y + sec[0][1]);
    await page.mouse.click(box.x + sec[1][0], box.y + sec[1][1]);
    await page.waitForSelector('[data-testid="section-chart"]');
    await page.mouse.move(box.x + 30, box.y + 300);
    await shot('05-grading-section.png');
    await page.keyboard.press('c');
    await page.click('[data-testid="view-3d"]');
    await page.waitForFunction(() => (window as any).__gw?.view3dReady === true, undefined, { timeout: 30_000 });
    await page.waitForTimeout(600);
    await shot('05-grading-3d.png');
    await page.keyboard.press('2');

    // Phase 6: scenario B + compare, light theme, exported plan sheet
    await app.cmd('create_scenario', { name: 'B: long axis parallel to Route 72' }, 'mcp');
    await app.cmd('generate_layout', { alignToRoad: 'Route 72' }, 'mcp');
    await app.cmd('optimize_ffe', {}, 'mcp');
    await graded();
    await page.keyboard.press('Escape');
    await page.click('[data-testid="tab-checks"]');
    await shot('06-scenario-b-checks.png');
    await page.click('[data-testid="compare-btn"]');
    await page.waitForSelector('[data-testid="compare-dialog"]');
    await shot('06-compare.png');
    await page.keyboard.press('Escape');
    await app.cmd('switch_scenario', { scenarioId: 'A' }, 'mcp');
    await graded();
    await page.keyboard.press('t');
    await page.keyboard.press('b');
    await page.click('[data-testid="tab-activity"]');
    await shot('06-light-theme-asbuilt-activity.png');
    await page.keyboard.press('t');
    await page.keyboard.press('b');
    const exp = await app.cmd('export', { formats: ['png'] }, 'script');
    const sheet = (exp.files as { kind: string; path: string }[]).find((f) => f.kind === 'png');
    if (sheet) {
      fs.copyFileSync(sheet.path, path.join(outDir, '06-export-plan-sheet.png'));
      shots.push('06-export-plan-sheet.png');
    }
    await page.close();
  } finally {
    await browser.close();
    await app.close();
  }
  console.log(`Captured ${shots.length} screenshots in docs/screens/: ${shots.join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
