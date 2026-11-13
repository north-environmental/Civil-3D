/** Zoning commands: read rules and ordinance text, propose/confirm rules, run checks, override edge classes. */
import { z } from 'zod';
import { activeScenario } from '../site/project';
import { fmtAc } from '../site/units';
import { assembleSite, frontages } from '../zoning/edges';
import { buildEnvelopes } from '../zoning/envelopes';
import { RULE_KEYS, RuleSchema, type ZoningRule, type ZoningRuleSet } from '../zoning/rules';
import { requireRules, requireSite } from './base';
import { CommandError, defineCommand } from './registry';

function ruleBrief(r: ZoningRule) {
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    value: r.value,
    units: r.units,
    operator: r.operator,
    appliesTo: r.appliesTo,
    edgeCondition: r.edgeCondition,
    citation: r.citation.section,
    quote: r.citation.quote,
    source: r.citation.source,
    status: r.confirmed ? 'confirmed' : 'proposed (unconfirmed)',
    ...(r.interpretationFlags?.length ? { interpretationFlags: r.interpretationFlags } : {}),
  };
}

defineCommand({
  name: 'get_zoning_rules',
  group: 'Context',
  title: 'Get zoning rules',
  description:
    'Return the active zoning rule set: each rule with its value and units, the ordinance section it comes from, a short ' +
    'quote/extract, confirmed vs proposed status, and interpretation flags (ambiguities and the conservative choice made). ' +
    'Also returns the resulting envelope areas (building / parking / loading, in acres) and the setback applied to each ' +
    'frontage. Cite sections exactly as returned; do not invent section numbers. Optional category filter: setback, ' +
    'coverage, height, lot, parking, loading, landscape, access, grade, use.',
  input: z.object({ category: z.string().optional().describe('Filter by rule category.') }),
  mutates: false,
  handler: (p, input) => {
    const site = requireSite(p);
    const rules = requireRules(p);
    const env = buildEnvelopes(site, rules);
    const list = rules.rules.filter((r) => !input.category || r.category === input.category);
    const flags = rules.rules.flatMap((r) => (r.interpretationFlags ?? []).map((f) => `${r.citation.section}: ${f}`));
    const fr = frontages(site.edges).map((f) => {
      const sb = env.edgeSetbacks[f.edgeIndexes[0]];
      return { road: f.roadName, buildingSetbackFt: sb.buildingFt, parkingSetbackFt: sb.parkingFt, acrossStreetFromResidential: f.acrossStreetFromResidential };
    });
    const unconfirmed = rules.rules.filter((r) => !r.confirmed).length;
    return {
      result: {
        summary:
          `${rules.districtName} (${rules.jurisdiction}): ${rules.rules.length} rules, ${unconfirmed ? `${unconfirmed} proposed/unconfirmed` : 'all confirmed'}, ${flags.length} interpretation flags. ` +
          `Building envelope ${fmtAc(env.areas.buildingSf, 1)}, parking envelope ${fmtAc(env.areas.parkingSf, 1)}, loading envelope ${fmtAc(env.areas.loadingSf, 1)}. ` +
          fr.map((f) => `${f.road}: building ${f.buildingSetbackFt} ft${f.acrossStreetFromResidential ? ' (across from residential)' : ''}, parking ${f.parkingSetbackFt} ft`).join('; ') +
          `. Residential district: buildings ${env.residentialBuildingSepFt} ft, parking ${env.residentialParkingSepFt} ft.`,
        district: rules.district,
        jurisdiction: rules.jurisdiction,
        sourceNote: rules.sourceNote,
        frontageSetbacks: fr,
        residentialSeparation: { buildingFt: env.residentialBuildingSepFt, parkingFt: env.residentialParkingSepFt },
        envelopes: { buildingAc: +(env.areas.buildingSf / 43560).toFixed(2), parkingAc: +(env.areas.parkingSf / 43560).toFixed(2), loadingAc: +(env.areas.loadingSf / 43560).toFixed(2) },
        rules: list.map(ruleBrief),
        interpretationFlags: flags,
      },
    };
  },
});

defineCommand({
  name: 'get_ordinance_text',
  group: 'Context',
  title: 'Get ordinance text',
  description:
    'Return the cached ordinance text for a section number so you can read and cite it (e.g. "27-1003", "§ 27-1408", ' +
    '"1407"). The result says whether the text is verbatim official wording or an extract; when it is an extract, say so ' +
    'when quoting. Call with no section to list the cached sections. Works offline from the site fixture.',
  input: z.object({ section: z.string().optional().describe('Section number, e.g. "27-1003". Omit to list sections.') }),
  mutates: false,
  handler: (_p, input, ctx) => {
    const list = ctx.services.listOrdinanceSections?.() ?? [];
    if (!input.section) return { result: { summary: `${list.length} cached ordinance sections.`, sections: list } };
    const sec = ctx.services.ordinanceText?.(input.section);
    if (!sec) throw new CommandError(`No cached text for section "${input.section}". Cached: ${list.join('; ') || 'none'}.`, 'not_found');
    return {
      result: {
        summary: `§ ${sec.section} ${sec.title} (${sec.verbatim ? 'verbatim' : 'extract, not verbatim official wording'}).`,
        section: sec.section,
        title: sec.title,
        text: sec.text,
        verbatim: sec.verbatim,
        source: sec.source,
      },
    };
  },
});

const ProposedRule = RuleSchema.omit({ confirmed: true, district: true }).extend({
  district: z.string().optional(),
  key: z.string().describe(`Semantic key the engine evaluates. Known keys: ${Object.keys(RULE_KEYS).join(', ')}.`),
});

defineCommand({
  name: 'set_zoning_rules',
  group: 'Site',
  title: 'Propose zoning rules',
  description:
    'Propose zoning rules read from the ordinance (use get_ordinance_text first). Each rule needs: id, key (semantic key the ' +
    'engine understands), category, appliesTo, value, units, operator, label and a citation {section, source, quote}. ' +
    'Proposed rules are stored as UNCONFIRMED (amber in the UI) and are used by the engine only where no confirmed rule ' +
    'has the same key; call confirm_zoning_rules once the user agrees. mode "merge" (default) upserts by id; "replace" ' +
    'starts a new rule set (new jurisdiction). Never invent section numbers: cite what the cached text says. ' +
    'Returns the ids written and any keys the engine does not evaluate.',
  input: z.object({
    rules: z.array(ProposedRule).min(1),
    mode: z.enum(['merge', 'replace']).default('merge'),
    jurisdiction: z.string().optional(),
    district: z.string().optional(),
    districtName: z.string().optional(),
  }),
  mutates: true,
  handler: (p, input) => {
    const site = requireSite(p);
    const district = input.district ?? p.rules?.district ?? site.zoningDistrictCode;
    const base: ZoningRuleSet =
      input.mode === 'replace' || !p.rules
        ? { jurisdiction: input.jurisdiction ?? site.jurisdiction, district, districtName: input.districtName ?? district, sourceNote: 'Proposed via set_zoning_rules; confirm before use.', rules: [] }
        : p.rules;
    const incoming: ZoningRule[] = input.rules.map((r) => ({ ...r, district: r.district ?? district, confirmed: false }));
    const ids = new Set(incoming.map((r) => r.id));
    const rules: ZoningRuleSet = { ...base, rules: [...base.rules.filter((r) => !ids.has(r.id)), ...incoming] };
    const unknown = incoming.filter((r) => !(r.key in RULE_KEYS)).map((r) => r.key);
    const msg = `Proposed ${incoming.length} zoning rule(s) (${incoming.map((r) => `${r.label} [${r.citation.section}]`).slice(0, 4).join('; ')}${incoming.length > 4 ? '…' : ''}); awaiting confirmation.`;
    return {
      project: { ...p, rules },
      log: msg,
      result: {
        summary: msg + (unknown.length ? ` Keys not evaluated by the engine: ${unknown.join(', ')}.` : ''),
        proposedIds: incoming.map((r) => r.id),
        unknownKeys: unknown,
        next: 'Ask the user to review, then confirm_zoning_rules.',
      },
    };
  },
});

defineCommand({
  name: 'confirm_zoning_rules',
  group: 'Site',
  title: 'Confirm zoning rules',
  description:
    'Mark proposed zoning rules as confirmed so the engine relies on them. Only call when the user has agreed to the ' +
    'proposed values. With no ids, confirms every proposed rule. Returns how many were confirmed.',
  input: z.object({ ruleIds: z.array(z.string()).optional().describe('Rule ids to confirm; default all proposed rules.') }),
  mutates: true,
  handler: (p, input) => {
    const rules = requireRules(p);
    const target = rules.rules.filter((r) => !r.confirmed && (!input.ruleIds || input.ruleIds.includes(r.id)));
    if (!target.length) return { result: { summary: 'No proposed rules to confirm; all rules are already confirmed.', confirmed: 0 } };
    const ids = new Set(target.map((r) => r.id));
    const next: ZoningRuleSet = { ...rules, rules: rules.rules.map((r) => (ids.has(r.id) ? { ...r, confirmed: true } : r)) };
    const msg = `Confirmed ${target.length} zoning rule(s): ${target.map((r) => r.label).slice(0, 5).join('; ')}${target.length > 5 ? '…' : ''}.`;
    return { project: { ...p, rules: next }, log: msg, result: { summary: msg, confirmed: target.length } };
  },
});

defineCommand({
  name: 'run_checks',
  group: 'Context',
  title: 'Run checks',
  description:
    'Run all zoning and engineering checks on the active scenario and return them: status (pass / fail / warn / n/a), ' +
    'value vs limit with units, ordinance or standard citation, the object ids involved and a one-line message a client ' +
    'could read. Failures say what to change. Use after layout or grading changes; use statusFilter ["fail","warn"] to ' +
    'see only what needs attention.',
  input: z.object({
    statusFilter: z.array(z.enum(['pass', 'fail', 'warn', 'n/a'])).optional(),
    group: z.enum(['zoning', 'engineering', 'grading']).optional(),
  }),
  mutates: false,
  handler: (p, input) => {
    requireSite(p);
    const s = activeScenario(p);
    const all = s.checks;
    const list = all.filter((c) => (!input.statusFilter || input.statusFilter.includes(c.status)) && (!input.group || c.group === input.group));
    const n = (st: string) => all.filter((c) => c.status === st).length;
    const fails = all.filter((c) => c.status === 'fail');
    return {
      result: {
        summary:
          `Scenario ${s.id}: ${n('pass')} pass, ${n('warn')} warn, ${n('fail')} fail, ${n('n/a')} n/a.` +
          (fails.length ? ` Failing: ${fails.map((c) => `${c.title} (${c.message})`).join(' | ')}` : s.objects.length ? ' No failing checks.' : ' No layout yet: most checks are n/a.'),
        counts: { pass: n('pass'), warn: n('warn'), fail: n('fail'), na: n('n/a') },
        checks: list.map((c) => ({ id: c.id, group: c.group, title: c.title, status: c.status, value: c.value, limit: c.limit, units: c.units, citation: c.citation, objectIds: c.objectIds, message: c.message })),
      },
    };
  },
});

defineCommand({
  name: 'set_edge_class',
  group: 'Site',
  title: 'Override a parcel edge class',
  description:
    'Manual override of the automatic parcel-edge classification (front / side / rear) or its residential-adjacency flags, ' +
    'when the automatic reading of the roads and district map is wrong. Edge indexes come from the Zoning tab or ' +
    'get_site_context order (counter-clockwise from the first parcel vertex). Envelopes and checks update.',
  input: z.object({
    edgeIndex: z.number().int().min(0),
    edgeClass: z.enum(['front', 'side', 'rear']).optional(),
    abutsResidential: z.boolean().optional(),
    acrossStreetFromResidential: z.boolean().optional(),
  }),
  mutates: true,
  handler: (p, input) => {
    const site = requireSite(p);
    if (input.edgeIndex >= site.edges.length) throw new CommandError(`Edge ${input.edgeIndex} does not exist; the parcel has ${site.edges.length} edges (0–${site.edges.length - 1}).`, 'not_found');
    const prior = site.edges.filter((e) => e.overridden && e.index !== input.edgeIndex).map((e) => ({ index: e.index, edgeClass: e.edgeClass, abutsResidential: e.abutsResidential, acrossStreetFromResidential: e.acrossStreetFromResidential }));
    const next = assembleSite(site, site.dem, [...prior, { index: input.edgeIndex, edgeClass: input.edgeClass, abutsResidential: input.abutsResidential, acrossStreetFromResidential: input.acrossStreetFromResidential }]);
    const e = next.edges[input.edgeIndex];
    const msg = `Edge ${e.index} (${e.facing}, ${Math.round(e.lengthFt)} ft) set to ${e.edgeClass}${e.abutsResidential ? ', abuts residential' : ''}${e.acrossStreetFromResidential ? ', across the street from residential' : ''} (manual override).`;
    return { project: { ...p, site: next }, log: msg, result: { summary: msg } };
  },
});
