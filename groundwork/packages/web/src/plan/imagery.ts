/**
 * Cached aerial imagery drawn under the plan. Each chunk was exported by the map service already
 * in the site CRS (north up), so it is simply drawn into its world rectangle and registers with
 * the parcel, roads and terrain. Nothing is fetched from the internet at run time.
 */
import type { Site } from '@groundwork/core';
import { type View, w2s } from './draw';

type ImagerySet = Site['imagery']['sets'][number];
const images = new Map<string, HTMLImageElement | 'loading' | 'error'>();
let pending = 0;

/** Images still loading (render mode waits for this to reach zero before a screenshot). */
export function imageryPending(): number {
  return pending;
}

export function imagerySet(site: Pick<Site, 'imagery'> | null | undefined, which: 'base' | 'latest'): ImagerySet | null {
  const sets = site?.imagery?.sets ?? [];
  if (!sets.length) return null;
  return which === 'base' ? sets[0] : (sets[1] ?? null);
}

export function drawImagery(ctx: CanvasRenderingContext2D, v: View, siteId: string, set: ImagerySet, redraw: () => void, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const c of set.chunks) {
    const a = w2s(v, [c.x0, c.y1]); // top-left on screen
    const b = w2s(v, [c.x1, c.y0]); // bottom-right on screen
    if (b[0] < 0 || b[1] < 0 || a[0] > v.w || a[1] > v.h) continue;
    const key = `${siteId}/${c.file}`;
    let img = images.get(key);
    if (!img) {
      const el = new Image();
      images.set(key, 'loading');
      pending++;
      el.onload = () => {
        images.set(key, el);
        pending--;
        redraw();
      };
      el.onerror = () => {
        images.set(key, 'error');
        pending--;
        redraw();
      };
      el.src = `/api/site/assets/${c.file}`;
      img = 'loading';
    }
    if (typeof img === 'string') continue;
    // Overdraw by a hair so adjacent chunks never show a seam.
    ctx.drawImage(img, a[0], a[1], b[0] - a[0] + 0.5, b[1] - a[1] + 0.5);
  }
  ctx.restore();
}
