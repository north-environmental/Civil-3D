/**
 * Cached aerial imagery (Web Mercator XYZ tiles) drawn under the plan. Each tile is placed with an
 * affine transform from its corner coordinates projected into the site CRS (fine at site scale).
 * Only active when the fixture has cached tiles (site.imagery.available).
 */
import { type Crs, type Pt, fromLonLat, toLonLat } from '@groundwork/core';
import { type View, s2w, w2s } from './draw';

type Tile = { z: number; x: number; y: number };
let manifest: { key: string; tiles: Set<string> } | null = null;
let manifestLoading = '';
const images = new Map<string, HTMLImageElement | 'loading' | 'error'>();

const tileLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
const lonToX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat: number, z: number) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);

export function drawImagery(
  ctx: CanvasRenderingContext2D,
  v: View,
  site: { id: string; crs: Crs; imagery: { available: boolean; tileUrl?: string; minZoom?: number; maxZoom?: number } },
  redraw: () => void,
): void {
  const im = site.imagery;
  if (!im.available || !im.tileUrl) return;
  if (!manifest || manifest.key !== site.id) {
    if (manifestLoading !== site.id) {
      manifestLoading = site.id;
      fetch('/api/site/assets/imagery/manifest.json')
        .then((r) => r.json())
        .then((j: { tiles: Tile[] }) => {
          manifest = { key: site.id, tiles: new Set(j.tiles.map((t) => `${t.z}/${t.x}/${t.y}`)) };
          redraw();
        })
        .catch(() => undefined);
    }
    return;
  }
  const corners: Pt[] = [s2w(v, [0, 0]), s2w(v, [v.w, 0]), s2w(v, [0, v.h]), s2w(v, [v.w, v.h])].map((p) => toLonLat(site.crs, p));
  const w = Math.min(...corners.map((c) => c[0]));
  const e = Math.max(...corners.map((c) => c[0]));
  const s = Math.min(...corners.map((c) => c[1]));
  const n = Math.max(...corners.map((c) => c[1]));
  const lat = (s + n) / 2;
  // Pick the zoom whose ground resolution is closest to (not much coarser than) the screen's.
  const ftPerPx = 1 / v.scale;
  let z = im.minZoom ?? 15;
  for (let k = im.minZoom ?? 15; k <= (im.maxZoom ?? 18); k++) {
    z = k;
    const resFt = ((156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** k) * 3.28084;
    if (resFt <= ftPerPx * 1.4) break;
  }
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  for (let tx = lonToX(w, z); tx <= lonToX(e, z); tx++) {
    for (let ty = latToY(n, z); ty <= latToY(s, z); ty++) {
      const key = `${z}/${tx}/${ty}`;
      if (!manifest.tiles.has(key)) continue;
      let img = images.get(key);
      if (!img) {
        const el = new Image();
        images.set(key, 'loading');
        el.onload = () => {
          images.set(key, el);
          redraw();
        };
        el.onerror = () => images.set(key, 'error');
        el.src = im.tileUrl.replace('{z}', String(z)).replace('{x}', String(tx)).replace('{y}', String(ty));
        img = 'loading';
      }
      if (typeof img === 'string') continue;
      const A = w2s(v, fromLonLat(site.crs, [tileLon(tx, z), tileLat(ty, z)]));
      const B = w2s(v, fromLonLat(site.crs, [tileLon(tx + 1, z), tileLat(ty, z)]));
      const C = w2s(v, fromLonLat(site.crs, [tileLon(tx, z), tileLat(ty + 1, z)]));
      ctx.setTransform(((B[0] - A[0]) / 256) * dpr, ((B[1] - A[1]) / 256) * dpr, ((C[0] - A[0]) / 256) * dpr, ((C[1] - A[1]) / 256) * dpr, A[0] * dpr, A[1] * dpr);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(img, 0, 0, 256.5, 256.5);
    }
  }
  ctx.restore();
}
