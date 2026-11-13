/** Host-side effects requested by commands: PNG renders (headless Chromium), file writes, XLSX. */
import fs from 'node:fs';
import path from 'node:path';
import type { Effect, XlsxSheet } from '@groundwork/core';

export type RenderRequest = { view: string; params: Record<string, unknown>; width: number; height: number };
export type EffectRunner = {
  run(effects: Effect[], opts: { includeImages: boolean }): Promise<Record<string, unknown>>;
  render(req: RenderRequest): Promise<Buffer>;
  close(): Promise<void>;
};

const CHROMIUM_FALLBACKS = [process.env.GROUNDWORK_CHROMIUM, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];

export async function launchChromium(): Promise<import('playwright').Browser> {
  const { chromium } = await import('playwright');
  const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  try {
    return await chromium.launch({ args });
  } catch (first) {
    for (const p of CHROMIUM_FALLBACKS) {
      if (!p || !fs.existsSync(p)) continue;
      let exe = p;
      if (fs.statSync(p).isDirectory()) {
        const cands = ['chrome', 'chrome-linux/chrome', 'chromium'].map((c) => path.join(p, c)).filter((c) => fs.existsSync(c));
        if (!cands.length) continue;
        exe = cands[0];
      }
      try {
        return await chromium.launch({ executablePath: exe, args: [...args, '--no-sandbox'] });
      } catch {
        /* try next */
      }
    }
    throw new Error(
      `Could not launch Chromium for rendering (${(first as Error).message.split('\n')[0]}). Run \`npx playwright install chromium\` once.`,
    );
  }
}

export function createEffectRunner(opts: { baseUrl: () => string; exportsDir: string }): EffectRunner {
  let browserP: Promise<import('playwright').Browser> | null = null;
  fs.mkdirSync(opts.exportsDir, { recursive: true });

  async function render(req: RenderRequest): Promise<Buffer> {
    browserP ??= launchChromium();
    let browser: import('playwright').Browser;
    try {
      browser = await browserP;
    } catch (err) {
      browserP = null;
      throw err;
    }
    const page = await browser.newPage({ viewport: { width: req.width, height: req.height }, deviceScaleFactor: 1 });
    try {
      const q = new URLSearchParams({ render: req.view });
      for (const [k, v] of Object.entries(req.params)) {
        if (v === undefined || v === null) continue;
        q.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      }
      await page.goto(`${opts.baseUrl()}/?${q.toString()}`, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForFunction(() => (window as any).__renderReady === true, undefined, { timeout: 45_000 });
      return await page.screenshot({ type: 'png' });
    } finally {
      await page.close();
    }
  }

  async function writeXlsx(file: string, sheets: XlsxSheet[]): Promise<void> {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Groundwork (EFCG demo)';
    for (const s of sheets) {
      const ws = wb.addWorksheet(s.name);
      ws.columns = s.columns.map((c) => ({ header: c.header, width: c.width ?? 18, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
      ws.getRow(1).font = { bold: true };
      for (const row of s.rows) ws.addRow(row);
      if (s.notes?.length) {
        ws.addRow([]);
        for (const n of s.notes) ws.addRow([n]).font = { italic: true, color: { argb: 'FF666666' } };
      }
    }
    await wb.xlsx.writeFile(file);
  }

  return {
    render,
    async run(effects, { includeImages }) {
      const out: Record<string, unknown> = {};
      const files: { kind: string; path: string; url: string }[] = [];
      for (const e of effects) {
        if (e.type === 'writeText') {
          const file = path.join(opts.exportsDir, e.fileName);
          fs.writeFileSync(file, e.content);
          files.push({ kind: e.as, path: file, url: `/exports/${e.fileName}` });
        } else if (e.type === 'writeXlsx') {
          const file = path.join(opts.exportsDir, e.fileName);
          await writeXlsx(file, e.sheets);
          files.push({ kind: e.as, path: file, url: `/exports/${e.fileName}` });
        } else if (e.type === 'render') {
          try {
            const png = await render(e);
            if (e.as.startsWith('file:')) {
              const fileName = e.as.slice(5);
              const file = path.join(opts.exportsDir, fileName);
              fs.writeFileSync(file, png);
              files.push({ kind: 'png', path: file, url: `/exports/${fileName}` });
            } else if (includeImages) {
              out.image = { mimeType: 'image/png', base64: png.toString('base64'), width: e.width, height: e.height };
            }
          } catch (err) {
            out.imageError = (err as Error).message;
          }
        }
      }
      if (files.length) out.files = files;
      return out;
    },
    async close() {
      if (browserP) {
        try {
          await (await browserP).close();
        } catch {
          /* ignore */
        }
        browserP = null;
      }
    },
  };
}
