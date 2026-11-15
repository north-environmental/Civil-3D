/**
 * Plan image export, done entirely in the browser: the current plan (same layers, same extent) is
 * redrawn on a large off-screen canvas with a title strip and saved as a PNG download. No server
 * round trip and no headless browser, so it works on any machine.
 */
import { app, activeScenarioOf } from '../lib/app';
import { FONT_MONO, FONT_SANS, type View, drawPlan, fitView } from './draw';
import { imageryPending } from './imagery';
import { buildScene, currentPlanView } from './PlanView';
import { DARK, LIGHT } from './theme';

const EXPORT_WIDTH_PX = 3600;
const TITLE_STRIP_PX = 150;

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Render the plan to a PNG blob. Uses the on-screen extent when there is one, else fits the lot. */
export async function renderPlanPng(): Promise<{ blob: Blob; fileName: string; widthPx: number; heightPx: number }> {
  const s = app.get();
  const site = s.project?.site;
  if (!site) throw new Error('Load a site first.');
  const sc = activeScenarioOf(s.project);
  const live = currentPlanView();
  const aspect = live && live.w > 100 && live.h > 100 ? live.h / live.w : 2 / 3;
  const scaleUp = 2; // logical px → device px (crisp linework and text)
  const w = EXPORT_WIDTH_PX / scaleUp;
  const h = Math.round(w * Math.min(1.2, Math.max(0.45, aspect)));
  const strip = TITLE_STRIP_PX / scaleUp;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scaleUp);
  canvas.height = Math.round((h + strip) * scaleUp);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not create a drawing surface for the export.');

  let view: View;
  if (live && live.w > 100) view = { scale: live.scale * (w / live.w), cx: live.cx, cy: live.cy, w, h };
  else view = fitView(site.parcel.ring.slice(), w, h, 60);

  const pal = s.theme === 'light' ? LIGHT : DARK;
  const paint = () => {
    ctx.setTransform(scaleUp, 0, 0, scaleUp, 0, strip * scaleUp);
    drawPlan(ctx, view, { ...buildScene(app.get(), () => undefined), selection: null });
    // Title strip.
    ctx.setTransform(scaleUp, 0, 0, scaleUp, 0, 0);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, w, strip);
    ctx.fillStyle = pal.text;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = `600 22px ${FONT_SANS}`;
    ctx.fillText(site.name, 20, 32);
    ctx.font = `13px ${FONT_SANS}`;
    ctx.fillStyle = pal.textDim;
    const date = new Date().toISOString().slice(0, 10);
    ctx.fillText(`${site.jurisdiction} · ${(site.areaSf / 43560).toFixed(1)} ac · Scenario ${sc?.id ?? 'A'}${sc?.name ? `: ${sc.name}` : ''} · ${date}`, 20, 54);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#e8a33d';
    ctx.font = `600 13px ${FONT_SANS}`;
    ctx.fillText(`CONCEPT-LEVEL · NOT FOR CONSTRUCTION${site.synthetic ? ' · SYNTHETIC SITE DATA' : ''}`, w - 20, 30);
    ctx.fillStyle = pal.textDim;
    ctx.font = `11px ${FONT_MONO}`;
    const credit = s.layers.imagery || s.layers.asBuilt ? site.imagery.attribution : '';
    ctx.fillText(`Groundwork · EFCG demo${credit ? ` · Aerial: ${credit}` : ''}`.slice(0, 190), w - 20, 54);
    ctx.fillStyle = pal.gridMajor;
    ctx.fillRect(0, strip - 1, w, 1);
  };

  paint(); // first pass starts any aerial chunks loading
  for (let i = 0; i < 100 && imageryPending() > 0; i++) await wait(100);
  paint();

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('The browser could not encode the PNG.');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const fileName = `groundwork-${site.id}-plan-${(sc?.id ?? 'A').toLowerCase()}-${stamp}.png`;
  return { blob, fileName, widthPx: canvas.width, heightPx: canvas.height };
}

/** Render and save the plan PNG; returns the file name that was handed to the browser. */
export async function exportPlanPng(): Promise<string> {
  const { blob, fileName } = await renderPlanPng();
  downloadBlob(blob, fileName);
  return fileName;
}
