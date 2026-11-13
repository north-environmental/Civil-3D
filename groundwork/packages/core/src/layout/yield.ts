/** Yield table: areas, coverage, stalls, doors, berths, basin, FAR — each with its limit and citation. */
import { regionArea, ringArea } from '../geometry/basic';
import { unionSolids } from '../geometry/clip';
import type { Site } from '../site/model';
import type { Building, ParkingField, Scenario, YieldRow } from '../site/project';
import { fmtAc, fmtInt, fmtPct, fmtSf } from '../site/units';
import { imperviousRegion, parkingIslandSf, parkingRequired } from '../zoning/checks';
import { type ZoningRuleSet, citationOf, loadingBerthsRequired, ruleNumber, ruleTable } from '../zoning/rules';
import { requiredBasinAreaSf } from './basin';

export function buildYield(site: Site, rules: ZoningRuleSet, s: Scenario): YieldRow[] {
  const objs = s.objects;
  const b = objs.find((o): o is Building => o.type === 'building');
  if (!b) return [];
  const rows: YieldRow[] = [];
  const row = (key: string, label: string, value: number, units: string, display: string, limit?: string, citation?: string) => rows.push({ key, label, value, units, display, limit, citation });
  const fields = objs.filter((o): o is ParkingField => o.type === 'parkingField');
  const impervSf = regionArea(imperviousRegion(objs)) - parkingIslandSf(objs);
  const basins = objs.filter((o) => o.type === 'basin');
  const basinSf = basins.reduce((a, o) => a + (o as any).areaSf, 0);
  const wetSf = site.constraints.filter((c) => c.kind === 'wetland').reduce((a, c) => a + ringArea(c.ring), 0);
  const truckSf = regionArea(unionSolids(objs.filter((o) => o.type === 'truckCourt' || o.type === 'truckApron' || o.type === 'trailerField' || (o.type === 'drive' && o.network === 'truck') || (o.type === 'driveway' && o.network === 'truck')).map((o) => (o.type === 'drive' ? o.polygon : [(o as any).polygon]))));
  const carSf = regionArea(unionSolids(objs.filter((o) => o.type === 'parkingField' || (o.type === 'drive' && o.network !== 'truck') || (o.type === 'driveway' && o.network !== 'truck')).map((o) => (o.type === 'drive' ? o.polygon : [(o as any).polygon])))) - parkingIslandSf(objs);

  const maxCov = ruleNumber(rules, 'lot.maxCoveragePct', NaN);
  const minLs = ruleNumber(rules, 'landscape.minPct', NaN);
  row('siteArea', 'Site area', site.areaSf, 'SF', `${fmtAc(site.areaSf, 1)}`, fmtSf(site.areaSf));
  row('buildingSf', 'Building area', b.areaSf, 'SF', fmtSf(b.areaSf), `${fmtInt(b.lengthFt)} × ${fmtInt(b.depthFt)} ft ${b.buildingType === 'crossDock' ? 'cross-dock' : 'rear-load'}${s.program ? `; program ${fmtInt(s.program.buildingSf)} SF` : ''}`);
  row('coveragePct', 'Lot coverage (building)', (b.areaSf / site.areaSf) * 100, '%', fmtPct((b.areaSf / site.areaSf) * 100), Number.isNaN(maxCov) ? undefined : `≤ ${maxCov}%`, citationOf(rules, 'lot.maxCoveragePct'));
  row('far', 'Floor area ratio', b.areaSf / site.areaSf, 'ratio', (b.areaSf / site.areaSf).toFixed(3), 'single story');
  row('imperviousSf', 'Impervious area', impervSf, 'SF', `${fmtAc(impervSf, 1)}`, fmtSf(impervSf));
  row('imperviousPct', 'Impervious cover', (impervSf / site.areaSf) * 100, '%', fmtPct((impervSf / site.areaSf) * 100), 'see coverage flag', citationOf(rules, 'lot.maxCoveragePct'));
  row('truckPavementSf', 'Truck pavement', truckSf, 'SF', fmtSf(truckSf));
  row('carPavementSf', 'Car pavement', carSf, 'SF', fmtSf(carSf));
  const lsPct = ((site.areaSf - impervSf - basinSf - wetSf) / site.areaSf) * 100;
  row('landscapedPct', 'Landscaped area', lsPct, '%', fmtPct(lsPct), Number.isNaN(minLs) ? undefined : `≥ ${minLs}%`, citationOf(rules, 'landscape.minPct'));

  const std = fields.reduce((a, f) => a + f.stallsStd, 0);
  const ada = fields.reduce((a, f) => a + f.stallsAda, 0);
  const van = fields.reduce((a, f) => a + f.stallsVan, 0);
  const req = parkingRequired(s, rules);
  const reqText = req.storageReading !== null ? `≥ ${req.storageReading} (item S + W)${req.manufacturingReading !== null ? `; ${req.manufacturingReading} under item V + W` : ''}` : 'employees per shift not given';
  row('carStalls', 'Car stalls', std + ada, 'stalls', `${fmtInt(std + ada)}`, reqText, citationOf(rules, 'parking.ratio.perEmployeeTwoShifts'));
  row('carStallsAda', 'Accessible stalls (incl. van)', ada, 'stalls', `${ada} (${van} van)`, 'per facility', '2010 ADA Standards Table 208.2; § 208.2.4');
  const trailers = objs.reduce((a, o) => (o.type === 'truckCourt' ? a + o.trailerStalls : o.type === 'trailerField' ? a + o.stalls : a), 0);
  row('trailerStalls', 'Trailer stalls', trailers, 'stalls', fmtInt(trailers), s.program ? `program: ${s.program.trailerStalls}` : undefined);
  row('dockDoors', 'Dock doors', b.dockDoors, 'doors', fmtInt(b.dockDoors), `${b.doorsPerSide} per dock wall × ${b.dockSides.length}`);
  const table = ruleTable(rules, 'loading.berthsRequired');
  if (table) {
    const need = loadingBerthsRequired(b.areaSf, table);
    row('loadingBerths', 'Loading berths', b.dockDoors, 'berths', `${fmtInt(b.dockDoors)} provided`, `≥ ${need.conservative} (${need.roundedDown} if rounded down)`, citationOf(rules, 'loading.berthsRequired'));
  }
  const reqBasin = requiredBasinAreaSf(s.stormwater, site.areaSf, impervSf);
  row('basinArea', `Stormwater reservation (${basins.length} basin${basins.length === 1 ? '' : 's'})`, basinSf, 'SF', fmtAc(basinSf, 2), `${fmtAc(reqBasin.areaSf, 2)} planning reservation: ${reqBasin.basis}`, 'EFCG default; not a hydrologic design');
  return rows;
}
