/** Output commands: render_view (PNG via the host), export, cut_section. */
import { z } from 'zod';
import { buildDxf, buildGeoJson, buildXlsxSheets } from '../export/build';
import { activeScenario } from '../site/project';
import { requireSite } from './base';
import { CommandError, type Effect, defineCommand } from './registry';

export const RENDER_VIEWS = ['plan', '3d', 'cutfill', 'section'] as const;

defineCommand({
  name: 'render_view',
  group: 'Context',
  title: 'Render view (PNG)',
  description:
    'Render a PNG of the current design so you can visually sanity-check it (returned as an image). view: "plan" (2D plan ' +
    'with parcel, setbacks, objects, labels), "cutfill" (plan with the cut/fill heatmap: red = cut, blue = fill; requires ' +
    'grading), "3d" (perspective view of terrain, building, pavement and basin) or "section" (existing vs proposed profile ' +
    'along the last cut_section line or the given sectionLine). Optional bbox [minX, minY, maxX, maxY] in site CRS feet to ' +
    'zoom the plan; scenario id (defaults to the active one); layers to force on / hide by id (parcel, roads, setbacks, ' +
    'design, constraints, districts, existingContours, proposedContours, cutfill, asBuilt, imagery, labels). ' +
    'Default size 1600 × 1000. Use it after generate_layout and after grading to confirm the result looks right.',
  input: z.object({
    view: z.enum(RENDER_VIEWS).default('plan'),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    scenario: z.string().optional(),
    layers: z.array(z.string()).optional().describe('Layer ids to force on, e.g. ["asBuilt"].'),
    hide: z.array(z.string()).optional().describe('Layer ids to hide, e.g. ["existingContours"].'),
    sectionLine: z.tuple([z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number()])]).optional(),
    width: z.number().int().min(400).max(3200).default(1600),
    height: z.number().int().min(300).max(2400).default(1000),
  }),
  mutates: false,
  handler: (p, input) => {
    const site = requireSite(p);
    const sc = input.scenario ? p.scenarios.find((s) => s.id === input.scenario) : activeScenario(p);
    if (!sc) throw new CommandError(`Scenario "${input.scenario}" not found. Existing: ${p.scenarios.map((s) => s.id).join(', ')}.`, 'not_found');
    if (input.view === 'cutfill' && !sc.grading.graded) throw new CommandError('Cut/fill view needs a graded scenario. Run grade_site or optimize_ffe first.');
    if (input.view === 'section' && !input.sectionLine && !sc.results.earthwork) throw new CommandError('Section view needs a graded scenario and a sectionLine [[x1,y1],[x2,y2]].');
    return {
      result: {
        summary: `Rendered the ${input.view} view of scenario ${sc.id} (${input.width} × ${input.height} px)${site.synthetic ? '; note the site data is synthetic' : ''}.`,
        view: input.view,
        scenario: sc.id,
      },
      effects: [
        {
          type: 'render',
          view: input.view,
          params: { scenario: sc.id, bbox: input.bbox, layers: input.layers?.join(','), hide: input.hide?.join(','), line: input.sectionLine },
          width: input.width,
          height: input.height,
          as: 'image',
        },
      ],
    };
  },
});

defineCommand({
  name: 'export',
  group: 'Output',
  title: 'Export',
  description:
    'Export the active scenario (or the given one) to files and return their paths and download URLs. formats: "dxf" (AutoCAD ' +
    '2010 DXF in state plane feet with AIA-style layers: C-PROP, C-BLDG, C-PKNG-STRP, C-ROAD, C-TRCK, C-TOPO-EXST-MINR/MAJR, ' +
    'C-TOPO-PROP-MINR/MAJR, C-STRM-BSIN, C-SETB, C-ANNO), "geojson" (WGS84, all design objects), "png" (24 × 36 plan sheet with ' +
    'a title block and the yield, compliance and earthwork summary), "xlsx" (workbook: Yield, Compliance with citations, ' +
    'Earthwork, Assumptions). Defaults to all four. Every export carries the "Concept-level, not for construction" note.',
  input: z.object({ formats: z.array(z.enum(['dxf', 'geojson', 'png', 'xlsx'])).min(1).default(['dxf', 'geojson', 'png', 'xlsx']), scenario: z.string().optional() }),
  mutates: false,
  handler: (p, input, ctx) => {
    const site = requireSite(p);
    const sc = input.scenario ? p.scenarios.find((s) => s.id === input.scenario) : activeScenario(p);
    if (!sc) throw new CommandError(`Scenario "${input.scenario}" not found. Existing: ${p.scenarios.map((s) => s.id).join(', ')}.`, 'not_found');
    if (!sc.objects.length) throw new CommandError(`Scenario ${sc.id} has no layout to export. Run generate_layout first.`);
    const base = `groundwork-${site.id}-${sc.id}-r${p.revision}`;
    const effects: Effect[] = [];
    const parts: string[] = [];
    const formats = [...new Set(input.formats)];
    if (formats.includes('dxf')) {
      const dxf = buildDxf(p, sc, ctx.now);
      effects.push({ type: 'writeText', fileName: `${base}.dxf`, content: dxf.content, as: 'dxf' });
      parts.push(`DXF (${Object.keys(dxf.counts).length} layers, ${Object.values(dxf.counts).reduce((a, b) => a + b, 0)} entities)`);
    }
    if (formats.includes('geojson')) {
      const gj = buildGeoJson(p, sc, ctx.now);
      effects.push({ type: 'writeText', fileName: `${base}.geojson`, content: JSON.stringify(gj), as: 'geojson' });
      parts.push(`GeoJSON (${(gj.features as unknown[]).length} features, WGS84)`);
    }
    if (formats.includes('xlsx')) {
      effects.push({ type: 'writeXlsx', fileName: `${base}.xlsx`, sheets: buildXlsxSheets(p, sc, ctx.now), as: 'xlsx' });
      parts.push('XLSX (Yield, Compliance, Earthwork, Assumptions)');
    }
    if (formats.includes('png')) {
      effects.push({ type: 'render', view: 'sheet', params: { scenario: sc.id, theme: 'light', date: ctx.now.slice(0, 10) }, width: 2700, height: 1800, as: `file:${base}-sheet.png` });
      parts.push('PNG plan sheet (24 × 36, 2700 × 1800 px)');
    }
    const msg = `Exported scenario ${sc.id}: ${parts.join('; ')}. Concept-level, not for construction.`;
    return { result: { summary: msg, scenario: sc.id, formats }, log: msg, effects };
  },
});
