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
