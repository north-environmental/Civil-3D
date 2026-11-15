/**
 * Fetch live site data for the demo site into data/sites/heilmandale/ (SPEC §6): county tax
 * parcel, road centerlines, USGS 3DEP LiDAR terrain, NWI wetlands, FEMA floodplain, neighbouring
 * lot lines, two aerials (pre-development and latest) and the digitized zoning districts.
 *
 * Each source is tried once, never in a loop. If the parcel or the terrain cannot be fetched the
 * existing fixture is left untouched.
 *
 *   npm run fetch-site-data                  # refresh the fixture
 *   npm run fetch-site-data -- --dry         # report only, write nothing
 *   npm run fetch-site-data -- --no-imagery  # skip the aerial download (keeps the cached aerials)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFixture } from '../packages/data/src/fixtures';
import { fetchLiveSite } from '../packages/data/src/live';
import { referenceOrdinance } from '../packages/data/src/synthetic';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data', 'sites', 'heilmandale');
const dry = process.argv.includes('--dry');
const noImagery = process.argv.includes('--no-imagery');

async function main() {
  // Download into a scratch folder first so a failed run never leaves a half-written fixture.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-fetch-'));
  const out = await fetchLiveSite({
    id: 'heilmandale',
    address: '1625 Heilmandale Rd, Lebanon, PA 17046',
    name: '1625 Heilmandale Rd',
    jurisdiction: 'North Lebanon Township, Lebanon County, PA',
    districtCode: 'I-1',
    addressRoadName: 'Heilmandale Rd',
    dir: work,
    marginFt: 800,
    zoningDistrictsFile: path.join(root, 'data', 'sources', 'north-lebanon-township', 'zoning-districts-2023.json'),
    skipImagery: noImagery || dry,
    // Reviewed by eye when the fixture was first built; re-check if the 3DEP mosaic is ever updated.
    terrainReviewNote:
      'Hillshade reviewed 2026-11-15: farm fields with the swale along the south side and no building pad, so this is the ground before the 2020–2021 construction.',
    notes: {
      'imagery:pema2018': 'Reviewed 2026-11-15: shows the tract as farm fields (before construction).',
      'imagery:naip': 'Reviewed 2026-11-15: shows the distribution center as built.',
    },
  });
  console.log('\nData source report (each source tried once):');
  for (const r of out.reports) console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${r.layer.padEnd(17)} ${r.detail}\n       ${r.source.slice(0, 150)}`);

  if (dry) return;
  if (out.fixture && out.dem) {
    const keepImagery = noImagery && fs.existsSync(path.join(dir, 'site.json'));
    if (keepImagery) {
      const prev = JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8'));
      out.fixture.imagery = prev.imagery;
      out.fixture.provenance.push(...(prev.provenance ?? []).filter((p: { layer: string }) => p.layer.startsWith('imagery')));
    } else {
      fs.rmSync(path.join(dir, 'imagery'), { recursive: true, force: true });
      if (fs.existsSync(path.join(work, 'imagery'))) fs.cpSync(path.join(work, 'imagery'), path.join(dir, 'imagery'), { recursive: true });
    }
    writeFixture(dir, out.fixture, out.dem, referenceOrdinance());
    console.log(`\nWrote the fixture to ${path.relative(root, dir)}. Review provenance.json, then restart the app and load the site.`);
    if (!out.fixture.terrain.preDevelopment) console.log('WARNING: the terrain may post-date construction. See the terrain note in provenance.json.');
    fs.writeFileSync(path.join(dir, 'fetch-report.json'), JSON.stringify({ at: new Date().toISOString(), reports: out.reports }, null, 1));
  } else {
    console.log('\nThe parcel or terrain could not be fetched; the existing fixture was left untouched.');
    process.exitCode = 1;
  }
  fs.rmSync(work, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('fetch-site-data failed:', err);
  process.exit(1);
});
