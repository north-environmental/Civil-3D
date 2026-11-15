/**
 * Writes the SYNTHETIC test fixture to data/sites/synthetic/ (site.json, dem.f32, ordinance.json,
 * provenance.json). Deterministic. Used when no live source is reachable (SPEC §6.3).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ringArea } from '@groundwork/core';
import { buildSyntheticHeilmandale } from '../packages/data/src/synthetic';
import { writeFixture } from '../packages/data/src/fixtures';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data', 'sites', 'synthetic');

// A fixed timestamp keeps the committed fixture byte-stable across regenerations.
const now = process.argv.includes('--now') ? new Date().toISOString() : '2026-11-13T00:00:00.000Z';
const { fixture, dem, ordinance } = buildSyntheticHeilmandale(now);
writeFixture(dir, fixture, dem, ordinance);
const mb = (fs.statSync(path.join(dir, 'dem.f32')).size / 1e6).toFixed(2);
console.log(`Wrote synthetic fixture to ${path.relative(root, dir)}: parcel ${(ringArea(fixture.parcel.ring) / 43560).toFixed(1)} ac, DEM ${dem.nx} × ${dem.ny} @ ${dem.cellFt} ft (${mb} MB), ${ordinance.length} ordinance sections.`);
