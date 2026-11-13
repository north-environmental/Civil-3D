import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { executeCommand, frontages, newProject, sampleGrid, terrainStats } from '@groundwork/core';
import { createHostServices, loadSiteFixture, resolveSiteId } from './fixtures';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/sites');

describe('heilmandale fixture', () => {
  const site = loadSiteFixture(dataDir, 'heilmandale');

  it('resolves by address fragments', () => {
    expect(resolveSiteId(dataDir, { address: '1625 Heilmandale Rd' })).toBe('heilmandale');
    expect(resolveSiteId(dataDir, { address: '1625 heilmandale road, lebanon pa' })).toBe('heilmandale');
    expect(resolveSiteId(dataDir, { address: '10 Nowhere St' })).toBeNull();
  });

  it('parcel area is within ±5% of ~110 ac', () => {
    const ac = site.areaSf / 43560;
    expect(ac).toBeGreaterThan(110 * 0.95);
    expect(ac).toBeLessThan(110 * 1.05);
  });

  it('classifies frontages and residential adjacency', () => {
    const fr = frontages(site.edges);
    expect(fr.map((f) => f.roadName).sort()).toEqual(['Heilmandale Rd', 'Orange Ln', 'Route 72']);
    const by = Object.fromEntries(fr.map((f) => [f.roadName, f]));
    expect(by['Heilmandale Rd'].acrossStreetFromResidential).toBe(true);
    expect(by['Orange Ln'].acrossStreetFromResidential).toBe(true);
    expect(by['Route 72'].acrossStreetFromResidential).toBe(false);
    const rear = site.edges.filter((e) => e.edgeClass === 'rear');
    expect(rear.length).toBe(3);
    expect(rear.every((e) => e.adjacentDistrictKind === 'agricultural' && !e.abutsResidential)).toBe(true);
  });

  it('terrain is ~40 ft of relief falling south, and is flagged synthetic + pre-development', () => {
    const st = terrainStats(site.dem, [site.parcel.ring]);
    expect(st.reliefFt).toBeGreaterThan(28);
    expect(st.reliefFt).toBeLessThan(55);
    expect(['S', 'SE', 'SW']).toContain(st.fallDirection);
    expect(site.terrain.synthetic).toBe(true);
    expect(site.terrain.preDevelopment).toBe(true);
    // The as-built pad must NOT be visible in the DEM (std-dev well above 0.5 ft under the footprint).
    const pad = terrainStats(site.dem, [site.asBuilt[0].ring]);
    expect(pad.stdElevFt).toBeGreaterThan(0.5);
    const c = site.parcel.ring[0];
    expect(Number.isFinite(sampleGrid(site.dem, c[0], c[1]))).toBe(true);
  });

  it('load_site + get_site_context through the command layer', () => {
    const services = createHostServices(dataDir);
    let p = newProject();
    const r = executeCommand(p, 'load_site', { address: '1625 Heilmandale Rd' }, { services, source: 'mcp' });
    p = r.project;
    expect(p.site?.id).toBe('heilmandale');
    expect(p.rules?.district).toBe('I-1');
    expect(r.result.summary).toMatch(/SYNTHETIC/);
    const ctx = executeCommand(p, 'get_site_context', {}, { services }).result as any;
    expect(ctx.frontages).toHaveLength(3);
    expect(ctx.constraints[0].kind).toBe('wetland');
    expect(ctx.terrain.generalFall).toMatch(/toward the S/);
    expect(JSON.stringify(ctx).length).toBeLessThan(6000); // compact, no geometry dumps
    expect(services.ordinanceText!('§ 27-1003')?.text).toMatch(/150 ft/);
    expect(services.ordinanceText!('1408')?.section).toBe('27-1408');
    expect(() => executeCommand(p, 'load_site', { address: 'nowhere' }, { services })).toThrow(/No cached site/);
  });
});
