import { describe, expect, it } from 'vitest';
import { newProject } from '../commands/registry';
import { makeTestSite, rectRing } from '../testing/fixtures';
import { interpretRequest } from './interpret';

function projectWithSite() {
  const site = makeTestSite({
    ring: rectRing(0, 0, 2400, 1800),
    cellFt: 20,
    roads: [
      { name: 'Heilmandale Rd', centerline: [[-400, 1825], [2800, 1825]] },
      { name: 'Route 72', ref: '72', roadClass: 'state', centerline: [[2430, -400], [2430, 2200]] },
      { name: 'Orange Ln', centerline: [[-25, -400], [-25, 2200]] },
    ],
  });
  return { ...newProject(), site };
}
const names = (r: ReturnType<typeof interpretRequest>) => r.calls.map((c) => c.name);

describe('built-in chat interpreter', () => {
  it('reads the headline request: size, type, orientation and access', () => {
    const r = interpretRequest('Fit a 410,000 SF cross-dock parallel to Heilmandale Rd with trucks from Route 72 and Heilmandale Rd, cars only from Orange Ln', projectWithSite());
    expect(names(r)).toEqual(['set_program', 'set_access', 'set_access', 'set_access', 'generate_layout', 'run_checks']);
    expect(r.calls[0].input).toMatchObject({ buildingSf: 410000, buildingType: 'crossDock' });
    expect(r.calls[1].input).toMatchObject({ network: 'truck', road: 'Route 72', exclusive: true });
    expect(r.calls[2].input).toMatchObject({ network: 'truck', road: 'Heilmandale Rd', exclusive: false });
    expect(r.calls[3].input).toMatchObject({ network: 'car', road: 'Orange Ln', exclusive: true });
    expect(r.calls[4].input).toMatchObject({ alignToRoad: 'Heilmandale Rd' });
  });

  it('reads counts, "k" sizes, dimensions and clear height', () => {
    const r = interpretRequest('300k sq ft rear-load, 36 ft clear, 60 dock doors, 80 trailer stalls and 250 parking spaces', projectWithSite());
    expect(r.calls[0].input).toEqual({ buildingSf: 300000, buildingType: 'rearLoad', clearHeightFt: 36, dockDoors: 60, trailerStalls: 80, carStalls: 250 });
    const d = interpretRequest('make the building 900 x 400 ft', projectWithSite());
    expect(d.calls[0].input).toMatchObject({ lengthFt: 900, depthFt: 400, buildingSf: 360000 });
    const m = interpretRequest('max dock doors and as many trailer stalls as possible', projectWithSite());
    expect(m.calls[0].input).toEqual({ dockDoors: 'max', trailerStalls: 'max' });
  });

  it('understands road aliases ("rt 72", "heilmandale")', () => {
    const r = interpretRequest('trucks enter off rt 72; employees use heilmandale', projectWithSite());
    expect(r.calls.filter((c) => c.name === 'set_access').map((c) => [c.input.network, c.input.road])).toEqual([
      ['truck', 'Route 72'],
      ['car', 'Heilmandale Rd'],
    ]);
  });

  it('adds a driveway instead of replacing when asked to add one', () => {
    const r = interpretRequest('also add a truck entrance on Route 72', projectWithSite());
    expect(r.calls[0].input).toMatchObject({ network: 'truck', road: 'Route 72', exclusive: false });
  });

  it('handles simple actions', () => {
    expect(names(interpretRequest('undo', projectWithSite()))).toEqual(['undo']);
    expect(names(interpretRequest('run the checks', projectWithSite()))).toEqual(['run_checks']);
    expect(names(interpretRequest('rotate the building 90 degrees', projectWithSite()))).toEqual(['generate_layout', 'run_checks']);
    expect(names(interpretRequest('grade the site and balance it', projectWithSite()))).toEqual(['grade_site', 'optimize_ffe']);
    expect(names(interpretRequest('export the dxf and excel', projectWithSite()))).toEqual(['export']);
    expect(interpretRequest('save the plan as a png', projectWithSite()).clientActions).toEqual(['exportPng']);
  });

  it('asks for a site first, and loads the demo site when named', () => {
    expect(interpretRequest('build a 400,000 SF warehouse', newProject()).help).toMatch(/No site is loaded/);
    expect(interpretRequest('load 1625 Heilmandale Rd', newProject()).calls[0]).toMatchObject({ name: 'load_site', input: { address: '1625 Heilmandale Rd' } });
  });

  it('says what it can do when it understands nothing (never guesses)', () => {
    const r = interpretRequest('what is the meaning of life', projectWithSite());
    expect(r.calls).toEqual([]);
    expect(r.help).toMatch(/plain descriptions/);
  });
});
