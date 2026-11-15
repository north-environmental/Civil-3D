/**
 * Built-in plain-text interpreter for the chat panel: turns a short description ("410,000 SF
 * cross-dock parallel to Heilmandale Rd, trucks from Heilmandale Rd, cars from Orange Ln") into
 * command calls. Pure pattern matching, no model. It is the fallback when Claude is not connected,
 * so it is deliberately conservative: anything it does not recognise is reported back rather than
 * guessed at.
 */
import type { Project } from '../site/project';
import { frontages, normalizeRoadName } from '../zoning/edges';

export type ChatCall = { name: string; input: Record<string, unknown>; label: string };
export type Interpretation = {
  calls: ChatCall[];
  /** What was understood, in plain words (shown to the user before the results). */
  understood: string[];
  /** Set when nothing actionable was found. */
  help?: string;
  /** Things only the browser can do (e.g. save the plan image). */
  clientActions?: 'exportPng'[];
};

export const CHAT_EXAMPLES = [
  'Fit a 410,000 SF cross-dock parallel to Heilmandale Rd with 350 parking spaces, trucks from Heilmandale Rd and cars only from Orange Ln',
  'Make it a 300,000 SF rear-load building with 60 dock doors and 80 trailer stalls',
  'Rotate the building 90 degrees',
  'Run the checks',
];

const HELP =
  'I can read plain descriptions like: "' +
  CHAT_EXAMPLES.slice(0, 3).join('"; "') +
  '". I understand building size (SF or length × depth), cross-dock or rear-load, clear height, dock doors, trailer stalls, car stalls or employees, ' +
  'which road trucks and cars use, "parallel to <road>", "rotate N degrees", plus: run checks, grade the site, new scenario, compare, undo, redo, export.';

const num = (s: string): number => Number(s.replace(/,/g, ''));

/** "410,000", "410k", "0.41 million" followed by a square-foot unit. */
function parseSf(t: string): number | null {
  const m = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|m|million)?\s*-?\s*(?:sf|s\.f\.|sq\.?\s*-?\s*f(?:ee|oo)?t\.?|square\s*-?\s*f(?:ee|oo)t)\b/);
  if (!m) return null;
  let v = num(m[1]);
  if (m[2] === 'k' || m[2] === 'thousand') v *= 1e3;
  if (m[2] === 'm' || m[2] === 'million') v *= 1e6;
  return v >= 1000 ? Math.round(v) : null;
}

/** "760 x 540", "760 ft by 540 ft", "760' × 540'". */
function parseDims(t: string): [number, number] | null {
  const m = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:x|×|by)\s*(\d[\d,]*(?:\.\d+)?)\s*(?:ft|feet|foot|')?/);
  if (!m) return null;
  const a = num(m[1]);
  const b = num(m[2]);
  return a >= 40 && b >= 40 ? [Math.max(a, b), Math.min(a, b)] : null;
}

function countBefore(t: string, noun: RegExp): number | 'max' | null {
  const src = noun.source;
  const n = t.match(new RegExp(`(\\d[\\d,]*)\\s+(?:${src})`));
  if (n) return num(n[1]);
  if (new RegExp(`(?:max(?:imum|imize)?|as many|most)\\s+(?:the\\s+|number of\\s+)?(?:${src})|(?:${src})\\s+(?:as possible|maxed|max)`).test(t)) return 'max';
  return null;
}

type RoadRef = { name: string; aliases: string[] };

function roadRefs(p: Project): RoadRef[] {
  if (!p.site) return [];
  const names = new Set<string>([...frontages(p.site.edges).map((f) => f.roadName), ...p.site.roads.map((r) => r.name)]);
  return [...names].map((name) => {
    const n = normalizeRoadName(name); // e.g. "heilmandale rd", "route 72"
    const words = n.split(' ');
    const aliases = new Set<string>([n]);
    const digits = n.match(/\d+/)?.[0];
    if (digits) for (const pre of ['route', 'rt', 'rte', 'pa', 'sr', 'state route', 'highway', 'hwy']) aliases.add(`${pre} ${digits}`);
    // First word alone ("heilmandale", "orange") when it is distinctive enough.
    if (words.length > 1 && words[0].length >= 4 && !digits) aliases.add(words[0]);
    return { name, aliases: [...aliases].sort((a, b) => b.length - a.length) };
  });
}

/** Roads mentioned in a text fragment, in order of appearance. */
function roadsIn(fragment: string, refs: RoadRef[]): string[] {
  const text = ` ${normalizeRoadName(fragment)} `;
  const hits: { at: number; name: string }[] = [];
  for (const r of refs) {
    for (const a of r.aliases) {
      const at = text.indexOf(` ${a} `);
      if (at >= 0) {
        hits.push({ at, name: r.name });
        break;
      }
    }
  }
  return hits.sort((x, y) => x.at - y.at).map((h) => h.name);
}

export function interpretRequest(raw: string, p: Project): Interpretation {
  const t = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  const calls: ChatCall[] = [];
  const understood: string[] = [];
  if (!t) return { calls, understood, help: HELP };

  // ---- one-word actions ----------------------------------------------------------------------
  if (/^(undo|redo)\b/.test(t)) {
    const name = t.startsWith('undo') ? 'undo' : 'redo';
    return { calls: [{ name, input: {}, label: name === 'undo' ? 'Undo the last change' : 'Redo' }], understood: [name] };
  }

  // ---- site ----------------------------------------------------------------------------------
  const addr = raw.match(/\b(\d{1,6}\s+[A-Za-z][A-Za-z .'-]*?\s(?:rd|road|st|street|ave|avenue|ln|lane|dr|drive|blvd|hwy|highway|pike|way)\b\.?)/i);
  const wantsLoad = /\b(load|open|start with|use the site|site at|look at)\b/.test(t);
  if ((wantsLoad && addr) || (!p.site && addr)) {
    calls.push({ name: 'load_site', input: { address: addr![1].trim() }, label: `Load ${addr![1].trim()}` });
    understood.push(`site: ${addr![1].trim()}`);
  } else if (!p.site) {
    if (wantsLoad || /\b(demo|heilmandale)\b/.test(t)) {
      calls.push({ name: 'load_site', input: { address: '1625 Heilmandale Rd' }, label: 'Load 1625 Heilmandale Rd' });
      understood.push('site: 1625 Heilmandale Rd');
    } else {
      return { calls, understood, help: 'No site is loaded yet. Say "load 1625 Heilmandale Rd" (the demo site), then describe what to build.' };
    }
  }
  // Road names are only known once a site is loaded; the demo site is the only cached one.
  const refs = roadRefs(p);

  // ---- program -------------------------------------------------------------------------------
  const program: Record<string, unknown> = {};
  const sf = parseSf(t);
  const dims = parseDims(t);
  if (sf) {
    program.buildingSf = sf;
    understood.push(`${sf.toLocaleString('en-US')} SF building`);
  }
  if (dims) {
    program.lengthFt = dims[0];
    program.depthFt = dims[1];
    if (!sf) program.buildingSf = Math.round(dims[0] * dims[1]);
    understood.push(`${dims[0]} × ${dims[1]} ft footprint`);
  }
  if (/cross[\s-]?dock/.test(t)) {
    program.buildingType = 'crossDock';
    understood.push('cross-dock (docks on both long sides)');
  } else if (/rear[\s-]?load|single[\s-]?load|front[\s-]?load|one[\s-]?side/.test(t)) {
    program.buildingType = 'rearLoad';
    understood.push('rear-load (docks on one long side)');
  }
  const clear = t.match(/(\d{2,3})\s*(?:ft|feet|foot|')\s*-?\s*clear|clear\s*(?:height)?\s*(?:of\s*)?(\d{2,3})/);
  if (clear) {
    program.clearHeightFt = num(clear[1] ?? clear[2]);
    understood.push(`${program.clearHeightFt} ft clear`);
  }
  const doors = countBefore(t, /(?:dock\s+|loading\s+)?(?:doors|docks|dock positions)/);
  if (doors !== null) {
    program.dockDoors = doors;
    understood.push(doors === 'max' ? 'as many dock doors as fit' : `${doors} dock doors`);
  }
  const trailers = countBefore(t, /trailer\s+(?:stalls|spaces|spots|parking|positions|drops)/);
  if (trailers !== null) {
    program.trailerStalls = trailers;
    understood.push(trailers === 'max' ? 'as many trailer stalls as fit' : `${trailers} trailer stalls`);
  }
  const cars = t.match(/(\d[\d,]*)\s+(?:car|auto|employee|parking)\s*(?:parking\s*)?(?:stalls|spaces|spots)|(\d[\d,]*)\s+parking\s+(?:stalls|spaces|spots)/);
  if (cars) {
    program.carStalls = num(cars[1] ?? cars[2]);
    understood.push(`${program.carStalls} car stalls`);
  }
  const emp = t.match(/(\d[\d,]*)\s+employees/);
  if (emp) {
    program.employeesLargestShift = num(emp[1]);
    understood.push(`${program.employeesLargestShift} employees on the largest shift`);
  }
  if (Object.keys(program).length) calls.push({ name: 'set_program', input: program, label: 'Set the building program' });

  // ---- access --------------------------------------------------------------------------------
  // Split into clauses so "trucks from A and B, cars from C" assigns roads to the right network.
  let accessChanged = false;
  const clauses = t.split(/[,;.]|\bwith\b|\bwhile\b|\bbut\b/).map((c) => c.trim()).filter(Boolean);
  for (const c of clauses) {
    const isTruck = /\b(trucks?|trailers?|tractor|freight|semi)\b/.test(c);
    const isCar = /\b(cars?|employees?|staff|autos?|passenger|visitors?)\b/.test(c);
    if (!isTruck && !isCar) continue;
    if (!/\b(from|off|on|onto|via|use|uses|using|enter|entering|entrance|access|driveway|come|comes)\b/.test(c)) continue;
    const roads = roadsIn(c, refs);
    if (!roads.length) continue;
    // "trucks from A and cars from B" in one clause: split at the second network word.
    const parts = isTruck && isCar ? c.split(/\band\b/) : [c];
    for (const part of parts) {
      const net = /\b(trucks?|trailers?|tractor|freight|semi)\b/.test(part) ? 'truck' : /\b(cars?|employees?|staff|autos?|passenger|visitors?)\b/.test(part) ? 'car' : null;
      if (!net) continue;
      const only = /\bonly\b|\bexclusive(ly)?\b|\bjust\b/.test(part);
      const list = roadsIn(part, refs);
      list.forEach((road, i) => {
        // The first road of a clause replaces that network's driveways; further roads are added.
        const adding = /\b(add|also|another|additional|second|extra)\b/.test(part);
        calls.push({ name: 'set_access', input: { network: net, road, position: 'auto', exclusive: i === 0 && (only || !adding) }, label: `${net === 'truck' ? 'Truck' : 'Car'} access from ${road}` });
        accessChanged = true;
      });
      if (list.length) understood.push(`${net === 'truck' ? 'trucks' : 'cars'} from ${list.join(' and ')}`);
    }
  }

  // ---- orientation / layout ------------------------------------------------------------------
  const layout: Record<string, unknown> = {};
  const par = t.match(/(?:parallel(?:\s+to|\s+with)?|along|aligned?\s+(?:to|with)|facing)\s+([^,;.]+)/);
  if (par) {
    const road = roadsIn(par[1], refs)[0];
    if (road) {
      layout.alignToRoad = road;
      understood.push(`long axis parallel to ${road}`);
    }
  }
  const rot = t.match(/rotat\w*\s+(?:the\s+)?(?:building\s+|it\s+)?(?:by\s+)?(-?\d+(?:\.\d+)?)\s*(?:°|deg|degrees)?/);
  const building = p.scenarios.find((s) => s.id === p.activeScenarioId)?.objects.find((o) => o.type === 'building') as { rotationDeg?: number } | undefined;
  if (rot && !layout.alignToRoad) {
    const by = Number(rot[1]);
    layout.rotationDeg = (((building?.rotationDeg ?? 0) + by) % 360 + 360) % 360;
    understood.push(`rotate the building ${by}°`);
  }
  if (/away from (?:the\s+)?(?:houses|homes|residen\w+|neighbou?rs)/.test(t)) {
    layout.docksAwayFromResidential = true;
    understood.push('docks facing away from the residential side');
  }
  const wantsLayout =
    Object.keys(program).length > 0 || accessChanged || Object.keys(layout).length > 0 || /\b(fit|lay ?out|layout|place|build|design|generate|test[\s-]?fit|re-?fit|redo the layout)\b/.test(t);
  if (wantsLayout) calls.push({ name: 'generate_layout', input: layout, label: 'Fit the layout' });

  // ---- follow-up actions ---------------------------------------------------------------------
  if (/\b(new|another|second|create a?)\s+(scenario|option|alternative)\b/.test(t)) {
    // Branch first so the changes above land in the new scenario.
    calls.unshift({ name: 'create_scenario', input: {}, label: 'Create a new scenario' });
    understood.unshift('new scenario');
  }
  if (/\bgrad(e|ing)\b|\bearthwork\b|\bcut (and|\/|&) fill\b|\bbalance\b/.test(t)) {
    calls.push({ name: 'grade_site', input: {}, label: 'Grade the site' });
    if (/\bbalance|optimi[sz]e\b/.test(t)) calls.push({ name: 'optimize_ffe', input: { targetNetCy: 0 }, label: 'Balance cut and fill' });
    understood.push('grade the site');
  }
  if (/\bcompare\b/.test(t)) {
    calls.push({ name: 'compare_scenarios', input: {}, label: 'Compare scenarios' });
    understood.push('compare scenarios');
  }
  if (wantsLayout || /\b(checks?|compl(y|iance|iant)|zoning|violations?|problems?|issues?)\b/.test(t)) {
    calls.push({ name: 'run_checks', input: { statusFilter: ['fail', 'warn'] }, label: 'Run the checks' });
    if (!wantsLayout) understood.push('run the checks');
  }
  const formats = (['dxf', 'geojson', 'xlsx'] as const).filter((f) => t.includes(f) || (f === 'xlsx' && /\bexcel|spreadsheet\b/.test(t)));
  if (/\bexport|download|save\b/.test(t) && formats.length) {
    calls.push({ name: 'export', input: { formats }, label: `Export ${formats.join(', ').toUpperCase()}` });
    understood.push(`export ${formats.join(', ')}`);
  }
  const clientActions: 'exportPng'[] = [];
  if (/\b(export|download|save)\b/.test(t) && /\b(png|image|picture|screenshot|plan)\b/.test(t) && !formats.length) {
    clientActions.push('exportPng');
    understood.push('save the plan as a PNG image');
  }
  if (/\b(summary|summari[sz]e|status|what do we have|yield)\b/.test(t) && !calls.length) {
    calls.push({ name: 'get_project_summary', input: {}, label: 'Summarize the project' });
    understood.push('summary');
  }

  if (!calls.length && !clientActions.length) return { calls, understood, help: HELP };
  return { calls, understood, ...(clientActions.length ? { clientActions } : {}) };
}
