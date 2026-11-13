/** Output commands: render_view (PNG via the host), export, cut_section. */
import { z } from 'zod';
import { activeScenario } from '../site/project';
import { requireSite } from './base';
import { CommandError, defineCommand } from './registry';

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
