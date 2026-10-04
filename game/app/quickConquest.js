// Quick Conquest (PLAN-PHASE5 §5D), integration side: the region card's button state and the headless battle, time-sliced across animation frames
// so the page never freezes. meta/quick.js owns every rule and all the bookkeeping (finishQuickConquest); this file runs the job, drives the
// overlay (ui/quickOverlay.js) and hands the outcome to the world scene.
//
//   const quick = createQuickConquest({ getState, getWorld, ui, services });
//   quick.cardData(regionId, commander) // null (no button) | { can, reason, label }
//   quick.start(regionId, commander, { onDone(out, ctx) })
//
// meta/quick.js is loaded lazily: until it is there the button simply never shows (the rest of the game does not depend on it).
import { QUICK } from '../config/legacy.js';
import { edictMods } from '../meta/edicts.js';

const STEP_BUDGET = 600; // sim steps per frame (600 x TICK_SEC = 30 simulated seconds, a few ms; docs/briefs/phase5-hookup.md §6)
const MIN_SHOW_MS = 1100; // the overlay is read, not flashed: the bar fills over at least this long
const REDUCED_MIN_MS = 500;
// one slice per animation frame; a hidden tab gets no frames, so it falls back to a timer (the job still finishes behind another tab)
const nextSlice = (fn) => (typeof document !== 'undefined' && document.hidden ? setTimeout(fn, 16) : requestAnimationFrame(fn));

export function createQuickConquest({ getState, getWorld, ui, services }) {
  let mod = null;
  import('../meta/quick.js').then((m) => { mod = m; services.onQuickReady?.(); }).catch(() => { mod = null; });
  let running = null;

  const busySet = () => { try { return services.battles.busy().regions; } catch { return new Set(); } };

  /** The card's button: null when Quick Conquest is not unlocked or the region is not an Easy one; else whether it can go now. */
  function cardData(regionId, commander = null) {
    if (!mod) return null;
    const state = getState();
    if (!edictMods(state).quickConquest) return null;
    let res;
    try { res = mod.canQuickConquer(state, getWorld(), regionId, { busy: busySet(), commander }); } catch (err) { console.warn('[quick] canQuickConquer failed:', err); return null; }
    if (res.ok) return { can: !running, reason: running ? 'Another Quick Conquest is under way' : '', label: QUICK.copy.button };
    // an Easy region that is merely busy keeps its (greyed) button; anything else has none
    if (res.reason === 'busy') return { can: false, reason: QUICK.copy.refusals.busy, label: QUICK.copy.button };
    return null;
  }

  /**
   * @param {number} regionId
   * @param {string|null} commander
   * @param {{ commanderName: string, onDone: (out: object|null, ctx: object) => void }} opts
   */
  function start(regionId, commander, { commanderName, onDone }) {
    if (!mod || running) return false;
    const state = getState();
    const world = getWorld();
    const check = mod.canQuickConquer(state, world, regionId, { busy: busySet(), commander });
    if (!check.ok) return { ok: false, reason: QUICK.copy.refusals[check.reason] || 'Not now' };
    let job;
    try { job = mod.createQuickConquest(state, world, regionId, { commander, busy: busySet(), nowMs: Date.now() }); } catch (err) { console.warn('[quick] createQuickConquest failed:', err); return { ok: false, reason: 'Not now' }; }
    const region = world.regions[regionId].name;
    const t0 = performance.now();
    const minMs = state.settings.reduceMotion ? REDUCED_MIN_MS : MIN_SHOW_MS;
    const epoch = services.container ? services.container.epoch : 0;
    running = { regionId, job };
    ui.quick.update({ region, commander: commanderName, progress: 0 });
    ui.quick.el.hidden = false;
    let simDone = false;
    const frame = () => {
      if (!running) return;
      // a realm replaced mid-way (import, reset): the job belonged to the old one
      if (services.container && services.container.epoch !== epoch) { running = null; ui.quick.el.hidden = true; return; }
      let p = 1;
      if (!simDone) {
        try { const r = mod.stepQuickConquest(job, STEP_BUDGET); simDone = !!r.done; p = r.progress; } catch (err) { console.warn('[quick] step failed:', err); simDone = true; }
      }
      const shown = Math.min(simDone ? 1 : p, (performance.now() - t0) / minMs);
      ui.quick.update({ region, commander: commanderName, progress: shown });
      if (!simDone || shown < 1) { nextSlice(frame); return; }
      running = null;
      let out = null;
      try { out = mod.finishQuickConquest(getState(), getWorld(), job, Date.now()); } catch (err) { console.warn('[quick] finishQuickConquest failed:', err); }
      ui.quick.el.hidden = true;
      onDone?.(out, { regionId, region });
    };
    nextSlice(frame);
    return { ok: true };
  }

  return { cardData, start, get running() { return running; }, get ready() { return !!mod; } };
}
