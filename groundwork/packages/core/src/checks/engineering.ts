/** Engineering checks besides zoning (SPEC §5.4). Grading-dependent checks read the earthwork report. */
import { regionToRingDist } from '../geometry/basic';
import { ADA_CITATION, adaRequiredStalls, adaRequiredVanStalls } from '../criteria/ada';
import { networkOverlapSf } from '../layout/access';
import type { Site } from '../site/model';
import type { Check, CheckStatus, DesignObject, Drive, Driveway, ParkingField, Scenario } from '../site/project';
import { fmtInt } from '../site/units';
import type { Envelopes } from '../zoning/envelopes';
import type { ZoningRuleSet } from '../zoning/rules';
import { evaluateGradingChecks } from './grading';
import type { Region } from '../geometry/basic';

function pavementOf(objs: DesignObject[], network: 'truck' | 'car'): { regions: Region[]; ids: string[] } {
  const regions: Region[] = [];
  const ids: string[] = [];
  for (const o of objs) {
    const truck = o.type === 'truckCourt' || o.type === 'truckApron' || o.type === 'trailerField' || ((o.type === 'drive' || o.type === 'driveway') && o.network === 'truck');
    const car = o.type === 'parkingField' || ((o.type === 'drive' || o.type === 'driveway') && o.network === 'car');
    if ((network === 'truck' && truck) || (network === 'car' && car)) {
      regions.push(o.type === 'drive' ? o.polygon : [(o as any).polygon]);
      ids.push(o.id);
    }
  }
  return { regions, ids };
}

export function evaluateEngineeringChecks(site: Site, rules: ZoningRuleSet, s: Scenario, env: Envelopes): Check[] {
  const out: Check[] = [];
  const add = (id: string, title: string, status: CheckStatus, message: string, o: Partial<Check> = {}) =>
    out.push({ id: `e.${id}`, ruleId: id, group: o.group ?? 'engineering', category: o.category ?? 'engineering', title, status, value: o.value ?? null, limit: o.limit ?? null, units: o.units ?? '', citation: o.citation ?? '', objectIds: o.objectIds ?? [], message });
  const objs = s.objects;
  if (!objs.some((o) => o.type === 'building')) return out;

  // Accessible parking counts, per facility (Table 208.2) ------------------------------------
  const fields = objs.filter((o): o is ParkingField => o.type === 'parkingField');
  for (const f of fields) {
    const need = adaRequiredStalls(f.stallsTotal);
    const needVan = adaRequiredVanStalls(need);
    const ok = f.stallsAda >= need && f.stallsVan >= needVan;
    add(`ada.count.${f.id}`, `Accessible stalls, ${f.name}`, ok ? 'pass' : 'fail', `${f.stallsAda} accessible (${f.stallsVan} van) provided for ${f.stallsTotal} stalls; ${need} (${needVan} van) required. Placed in the row nearest the office entrance.`, {
      value: f.stallsAda,
      limit: need,
      units: 'stalls',
      citation: ADA_CITATION,
      objectIds: [f.id],
    });
  }

  // Truck / car network separation -----------------------------------------------------------
  const truck = pavementOf(objs, 'truck');
  const car = pavementOf(objs, 'car');
  if (truck.regions.length && car.regions.length) {
    const overlap = networkOverlapSf(truck.regions, car.regions);
    let gap = Infinity;
    for (const t of truck.regions) for (const c of car.regions) for (const ring of c) gap = Math.min(gap, regionToRingDist(t, ring));
    const emergency = objs.filter((o) => o.type === 'drive' && o.network === 'emergency');
    add(
      'network.separation',
      'Truck / car circulation separated',
      overlap < 1 ? 'pass' : 'fail',
      overlap < 1
        ? `Truck and car pavement do not touch (closest approach ${fmtInt(gap)} ft).${emergency.length ? ` ${emergency.length} gated emergency link(s) excluded.` : ' No shared pavement or connection.'}`
        : `Truck and car pavement overlap by ${fmtInt(overlap)} SF. Move the car driveway or the parking field so the networks do not share pavement.`,
      { value: Math.round(overlap), limit: 0, units: 'SF', citation: 'Program requirement; EFCG check', objectIds: overlap < 1 ? [] : [...truck.ids.slice(0, 2), ...car.ids.slice(0, 2)] },
    );
  }

  // Every driveway reaches its destination ---------------------------------------------------
  const driveways = objs.filter((o): o is Driveway => o.type === 'driveway');
  const drives = objs.filter((o): o is Drive => o.type === 'drive');
  for (const d of driveways) {
    const routed = drives.some((r) => r.drivewayId === d.id);
    if (!routed) add(`route.${d.id}`, `Drive connection, ${d.name}`, 'fail', `No drive could be routed from ${d.name} to its destination inside the allowed pavement area. Move the driveway along the frontage (edit_object stationFt) or shift the building.`, { objectIds: [d.id], citation: 'EFCG check' });
  }
  if (driveways.length && driveways.every((d) => drives.some((r) => r.drivewayId === d.id)))
    add('route.all', 'Drive connections', 'pass', `All ${driveways.length} driveway(s) connect to their destination: ${drives.map((r) => `${r.name} ${fmtInt(r.lengthFt)} ft`).join('; ')}.`, { citation: 'EFCG check', objectIds: drives.map((r) => r.id) });

  add('fire.access', 'Fire apparatus access', 'n/a', 'Not evaluated at concept level. If the fire marshal requires a second approach to the car side, add a gated emergency link with set_access {network: "emergency"} and log it.', { citation: 'Outside concept scope' });

  out.push(...evaluateGradingChecks(site, rules, s, env));
  return out;
}
