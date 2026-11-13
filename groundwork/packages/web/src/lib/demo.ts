/**
 * Guided demo mode: replays the headline scenario (SPEC §10) through the same commands Claude sends
 * over MCP, pacing the steps so the design log, plan and panels animate.
 */
import { type DemoStep, headlineSteps } from '@groundwork/core';
import { app, runCommand, toast } from './app';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Extra UI choreography after certain commands (pure presentation; no design logic). */
function present(st: DemoStep): void {
  const s = app.get();
  switch (st.command) {
    case 'load_site':
      app.set({ view: '2d', rightTab: 'activity', layers: { ...s.layers, cutfill: false, asBuilt: false }, sectionLine: null, selection: null });
      break;
    case 'get_zoning_rules':
      app.set({ rightTab: 'zoning' });
      break;
    case 'set_program':
      app.set({ rightTab: 'program' });
      break;
    case 'set_access':
      app.set({ rightTab: 'activity' });
      break;
    case 'generate_layout':
      app.set({ rightTab: 'yield' });
      break;
    case 'run_checks':
      app.set({ rightTab: 'checks' });
      break;
    case 'grade_site':
    case 'optimize_ffe':
      app.set({ rightTab: 'earthwork', layers: { ...app.get().layers, cutfill: true } });
      break;
    case 'compare_scenarios':
      app.set({ compareOpen: true });
      break;
    case 'switch_scenario':
      app.set({ compareOpen: false, layers: { ...app.get().layers, asBuilt: true, cutfill: false }, rightTab: 'activity' });
      break;
  }
}

let cancelled = false;
export function stopDemo(): void {
  cancelled = true;
}

export async function startDemo(delayMs?: number): Promise<void> {
  if (app.get().demo?.running) return;
  // ?demoDelay=<ms> speeds the replay up (used by the e2e test).
  const fromUrl = Number(new URLSearchParams(location.search).get('demoDelay'));
  const stepDelayMs = delayMs ?? (Number.isFinite(fromUrl) && fromUrl > 0 ? fromUrl : 1500);
  const steps = headlineSteps();
  cancelled = false;
  for (let i = 0; i < steps.length; i++) {
    if (cancelled) break;
    const st = steps[i];
    app.set({ demo: { running: true, step: i + 1, total: steps.length, label: `Step ${st.step}: ${st.label}` } });
    const r = await runCommand(st.command, st.input, { quiet: true, images: false });
    if (!r.ok) {
      toast(`Demo stopped at "${st.label}": ${r.error}`);
      break;
    }
    present(st);
    await sleep(st.command.startsWith('get_') || st.command === 'log_note' ? stepDelayMs * 0.6 : stepDelayMs);
  }
  app.set({ demo: null });
  ((window as any).__gw ??= {}).demoDone = true;
}
