/**
 * Fetch live site data for the demo site into data/sites/heilmandale/ (SPEC §6).
 * Tries each source once (20 s timeout), never loops. If the parcel or DEM cannot be fetched, the
 * existing fixture is left untouched; if no fixture exists, the synthetic fallback is written.
 *
 *   npm run fetch-site-data            # live fetch, fall back to synthetic
 *   npm run fetch-site-data -- --dry   # report only, write nothing
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFixture } from '../packages/data/src/fixtures';
import { fetchLiveSite } from '../packages/data/src/live';
import { buildSyntheticHeilmandale } from '../packages/data/src/synthetic';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data', 'sites', 'heilmandale');
const dry = process.argv.includes('--dry');

async function main() {
  const synthetic = buildSyntheticHeilmandale(new Date().toISOString());
  const out = await fetchLiveSite({
    id: 'heilmandale',
    address: '1625 Heilmandale Rd, Lebanon, PA 17046',
    name: '1625 Heilmandale Rd',
    jurisdiction: 'North Lebanon Township, Lebanon County, PA',
    districtCode: 'I-1',
    addressRoadName: 'Heilmandale Rd',
    dir,
    fallback: synthetic,
  });
  console.log('\nData source report (each source tried once):');
  for (const r of out.reports) console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${r.layer.padEnd(11)} ${r.detail}\n       ${r.source.slice(0, 140)}`);

  if (dry) return;
  if (out.fixture && out.dem) {
    writeFixture(dir, out.fixture, out.dem, synthetic.ordinance);
    const ac = out.reports.find((r) => r.layer === 'parcel')?.detail;
    console.log(`\nWrote LIVE fixture to ${path.relative(root, dir)} (${ac}). Review provenance.json, then restart the app and load the site.`);
    if (!out.fixture.terrain.preDevelopment) console.log('WARNING: the DEM appears to post-date construction. See the terrain note in provenance.json.');
  } else if (!fs.existsSync(path.join(dir, 'site.json'))) {
    writeFixture(dir, synthetic.fixture, synthetic.dem, synthetic.ordinance);
    console.log(`\nLive fetch failed; wrote the SYNTHETIC fallback fixture to ${path.relative(root, dir)}.`);
  } else {
    console.log('\nLive fetch failed; the existing fixture was left untouched.');
  }
  fs.writeFileSync(path.join(dir, 'fetch-report.json'), JSON.stringify({ at: new Date().toISOString(), reports: out.reports }, null, 1));
}

main().catch((err) => {
  console.error('fetch-site-data failed:', err);
  process.exit(1);
});
