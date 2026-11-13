/** Shared e2e helpers: start the real server in-process on a free port, drive it with Chromium. */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { launchChromium, startServer } from '../packages/server/src/index';

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export type TestApp = {
  port: number;
  url: string;
  tmp: string;
  cmd: (name: string, input?: unknown, source?: string) => Promise<any>;
  close: () => Promise<void>;
};

export async function startTestApp(): Promise<TestApp> {
  const port = await freePort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-e2e-'));
  const srv = await startServer(['--port', String(port), '--fresh', '--projects-dir', path.join(tmp, 'projects'), '--exports-dir', path.join(tmp, 'exports')]);
  const url = `http://127.0.0.1:${port}`;
  return {
    port,
    url,
    tmp,
    async cmd(name, input = {}, source = 'script') {
      const res = await fetch(`${url}/api/commands/${name}?images=0`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-groundwork-source': source },
        body: JSON.stringify(input),
      });
      const json = (await res.json()) as any;
      if (!json.ok) throw new Error(`${name} failed: ${json.error}`);
      return json.result;
    },
    async close() {
      await srv.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

export async function openPage(browser: Browser, url: string, size = { width: 1920, height: 1080 }): Promise<Page> {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  (page as any).__errors = errors;
  await page.goto(url, { waitUntil: 'load' });
  return page;
}
export function pageErrors(page: Page): string[] {
  return ((page as any).__errors as string[]).filter((e) => !/WebGL|GPU|swiftshader/i.test(e));
}

export { launchChromium };
