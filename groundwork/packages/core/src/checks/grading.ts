/** Grading-dependent engineering checks: slopes, drive grades, walls, offsite grading, balance. */
import { ADA_CITATION } from '../criteria/ada';
import type { Site } from '../site/model';
import type { Check, CheckStatus, ParkingField, Scenario } from '../site/project';
import { fmtInt } from '../site/units';
import type { Envelopes } from '../zoning/envelopes';
import { type ZoningRuleSet, citationOf, ruleNumber } from '../zoning/rules';

const EFCG = 'EFCG default (engineering-criteria.md)';

export function evaluateGradingChecks(_site: Site, rules: ZoningRuleSet, s: Scenario, _env: Envelopes): Check[] {
  const out: Check[] = [];
  const add = (id: string, title: string, status: CheckStatus, message: string, o: Partial<Check> = {}) =>
    out.push({ id: `g.${id}`, ruleId: id, group: 'grading', category: 'grade', title, status, value: o.value ?? null, limit: o.limit ?? null, units: o.units ?? '', citation: o.citation ?? EFCG, objectIds: o.objectIds ?? [], message });
  const c = s.grading.criteria;
  const ew = s.results.earthwork;
  const fields = s.objects.filter((o): o is ParkingField => o.type === 'parkingField');

  // Design slopes can be checked before grading.
  const maxPark = ruleNumber(rules, 'parking.maxGradePct', c.parkingMaxSlopePct);
  for (const f of fields) {
    const measured = ew?.slopes.find((x) => x.id === f.id && x.kind === 'parking')?.slopePct;
    const v = measured ?? f.slopePct;
    const ok = v <= maxPark + 0.01 && v >= c.parkingMinSlopePct - 0.01;
    add(`parking.slope.${f.id}`, `Parking slope, ${f.name}`, ok ? 'pass' : 'fail', `${v.toFixed(1)}% ${measured !== undefined ? 'on the proposed surface' : '(design value)'}; allowed ${c.parkingMinSlopePct}% (drainage) to ${maxPark}%.`, {
      value: +v.toFixed(2),
      limit: maxPark,
      units: '%',
      citation: `${citationOf(rules, 'parking.maxGradePct') || EFCG}; min ${c.parkingMinSlopePct}% ${EFCG}`,
      objectIds: [f.id],
    });
    if (f.stallsAda > 0) {
      const ada = ew?.slopes.find((x) => x.id === f.id && x.kind === 'ada')?.slopePct ?? f.slopePct;
      const pass = ada <= c.adaMaxSlopePct + 1e-6;
      add(
        `ada.slope.${f.id}`,
        `Accessible stall slope, ${f.name}`,
        !pass ? 'fail' : ada > c.adaDesignSlopePct + 1e-6 ? 'warn' : 'pass',
        `${ada.toFixed(2)}% across accessible stalls and aisles; maximum 1:48 (${c.adaMaxSlopePct.toFixed(2)}%), design target ≤ ${c.adaDesignSlopePct}%.${!pass ? ' Flatten the field (edit_object slopePct) or regrade the accessible stalls.' : ''}`,
        { value: +ada.toFixed(2), limit: +c.adaMaxSlopePct.toFixed(2), units: '%', citation: ADA_CITATION, objectIds: [f.id] },
      );
    }
  }
  if (s.objects.some((o) => o.type === 'truckCourt')) {
    const v = c.truckCourtSlopePct;
    const ok = v >= c.truckCourtMinSlopePct && v <= c.truckApronMaxSlopePct;
    add('truckCourt.slope', 'Truck court slope', ok ? 'pass' : v <= c.truckCourtMaxSlopePct && v >= c.truckCourtMinSlopePct ? 'warn' : 'fail', `${v}% away from the building; dock apron ${c.truckCourtMinSlopePct}–${c.truckApronMaxSlopePct}%, maneuvering area ≤ ${c.truckCourtMaxSlopePct}%.`, {
      value: v,
      limit: c.truckApronMaxSlopePct,
      units: '%',
      objectIds: s.objects.filter((o) => o.type === 'truckCourt').map((o) => o.id),
    });
  }

  if (!ew) {
    if (s.objects.some((o) => o.type === 'building')) add('notGraded', 'Grading', 'n/a', 'Not graded yet. Run grade_site or optimize_ffe to check drive grades, walls, offsite grading and earthwork.');
    return out;
  }

  for (const d of ew.drives) {
    const g = Math.abs(d.gradePct);
    const dir = d.gradePct >= 0 ? 'up' : 'down';
    const st: CheckStatus = g > d.maxGradePct + 1e-6 ? 'fail' : g > c.landingMaxGradePct + 1e-6 ? 'warn' : 'pass';
    add(
      `drive.grade.${d.id}`,
      `Drive grade, ${d.name}`,
      st,
      `${g.toFixed(1)}% ${dir} from the ${d.startElevFt.toFixed(1)} ft tie-in to ${d.endElevFt.toFixed(1)} ft over ${fmtInt(d.lengthFt)} ft; maximum ${d.maxGradePct}%.` +
        (st === 'fail' ? ' Change the FFE (see the feasible range), lengthen the drive or move the driveway.' : st === 'warn' ? ` Steeper than the ${c.landingMaxGradePct}% landing grade wanted within ${c.landingLengthFt} ft of the right-of-way: needs a vertical curve in design.` : ''),
      { value: +g.toFixed(2), limit: d.maxGradePct, units: '%', citation: `${EFCG}; verify against the SALDO`, objectIds: [d.id] },
    );
  }

  const tall = ew.walls;
  add(
    'walls',
    'Retaining walls',
    tall.length ? 'warn' : 'pass',
    tall.length
      ? `${tall.length} wall(s) required, ${fmtInt(ew.wallTotalLengthFt)} ft total, up to ${ew.wallMaxHeightFt.toFixed(1)} ft exposed (${tall.slice(0, 3).map((w) => `${w.id}: ${fmtInt(w.lengthFt)} ft × ${w.maxHeightFt.toFixed(1)} ft between ${w.betweenObjectIds.join(' and ') || 'objects'}`).join('; ')}). Objects are too close to tie together at ${c.tieInSlopeHtoV}:1; add separation or accept the walls.`
      : `No retaining walls needed: every object ties in to its neighbors and to existing ground at ${c.tieInSlopeHtoV}:1 (walls under ${c.minWallHeightFt} ft are treated as curbs).` +
        (ew.dockWingWalls.length ? ` ${ew.dockWingWalls.length} short dock wing wall(s) at the building corners (${fmtInt(ew.dockWingWalls.reduce((a, w) => a + w.lengthFt, 0))} ft total) are expected with ${c.dockHeightFt} ft docks.` : ''),
    { value: Math.round(ew.wallTotalLengthFt), limit: 0, units: 'ft', objectIds: tall.flatMap((w) => w.betweenObjectIds).slice(0, 6) },
  );
  add(
    'offsite',
    'Offsite grading',
    ew.offsiteAreaSf > 0 ? 'warn' : 'pass',
    ew.offsiteAreaSf > 0
      ? `${fmtInt(ew.offsiteAreaSf)} SF outside the parcel changes by more than ${c.offsiteToleranceFt} ft (up to ${ew.offsiteMaxDeltaFt.toFixed(1)} ft): needs a grading easement or a wall at the property line.`
      : `Grading stays inside the parcel (tolerance ${c.offsiteToleranceFt} ft).`,
    { value: Math.round(ew.offsiteAreaSf), limit: 0, units: 'SF' },
  );
  const st = ew.steepTieInSf;
  add(
    'tieIn.slope',
    'Tie-in slopes in landscape areas',
    st.overMax > 200 ? 'fail' : st.overPreferred > 0 ? 'warn' : 'pass',
    st.overMax > 200
      ? `${fmtInt(st.overMax)} SF of slope is steeper than ${c.tieInSlopeHtoV}:1.`
      : st.overPreferred > 0
        ? `${(st.overPreferred / 43560).toFixed(2)} ac of tie-in slope is steeper than the ${c.preferredTieInSlopeHtoV}:1 preferred for mowing (none steeper than the ${c.tieInSlopeHtoV}:1 maximum).`
        : `All tie-in slopes are ${c.preferredTieInSlopeHtoV}:1 or flatter.`,
    { value: Math.round(st.overPreferred), units: 'SF' },
  );
  if (ew.balance)
    add('balance', ew.balance.targetNetCy === 0 ? 'Earthwork balance' : 'Earthwork target', ew.balance.achieved ? 'pass' : 'warn', ew.balance.note, { value: Math.round(ew.netCy), limit: ew.balance.targetNetCy, units: 'CY' });
  return out;
}
