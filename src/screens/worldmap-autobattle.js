// Short-session lever: hand a RAID to the same bot tools/simplayer.js
// measures every region with, instead of playing it out. Split out of
// worldmap.js purely for the line budget and imported ONLY from there — the
// same "front door" convention worldmap-pan.js already uses.
//
// Two things live here. `runAutoResolve` spreads the resolve across animation
// frames so the tab never blocks (see its own header for the measured
// timings). `createAutoResolveUI` owns the rest: the eligibility check, the
// DOM this swaps into the world map's detail panel while it runs, and the one
// bit of state (whether a resolve is in flight). worldmap.js supplies the DOM
// primitives it already imports — so this file does not invent a second
// contract for them — and two callbacks for the state it does NOT own: locking
// the rest of the screen, and what to draw once a cancelled resolve hands the
// panel back.
import { startAutoResolve, canAutoResolve } from '../meta/autobattle.js';
import { TICK_MS } from '../core/loop.js';
import { WORLD } from '../content/strings.js';

/** Wall-clock budget per animation frame, and the tick batch checked against
 *  it. Small enough that even the slowest single tick this project has
 *  measured (~1.6ms, a dense tier-6 stalemate) cannot overshoot the budget by
 *  more than one batch's worth. */
const FRAME_BUDGET_MS = 8;
const MICRO_TICKS = 10;

// The copy moved to content/strings.js WORLD, where this file's own comment
// always said it belonged. It also stopped naming "the difficulty table" —
// that is `npm run sim` and `WIN_BAND`, a description of how the game is
// tested, shipped to the player as though it were a fact about the war.
const COPY = Object.freeze({
  button: WORLD.autoButton,
  hint: WORLD.autoHint,
  cancel: WORLD.autoCancel,
});

/**
 * @param {object} io
 * @param {object} io.rootState  ctx.state — see meta/autobattle.js for why
 *   the root and not the meta slice
 * @param {string} io.regionId
 * @param {number} io.now
 * @param {(p:{tick:number, capTicks:number})=>void} io.onProgress
 * @param {(r:{outcome:object, config:object})=>void} io.onDone
 * @param {(cb:()=>void)=>number} [io.raf]
 * @param {(id:number)=>void} [io.cancelRaf]
 * @param {()=>number} [io.clock]  monotonic ms
 * @returns {()=>void} cancel — stops the loop; safe to call after it finishes
 */
export function runAutoResolve({
  rootState, regionId, now, onProgress, onDone,
  raf = (cb) => requestAnimationFrame(cb),
  cancelRaf = (id) => cancelAnimationFrame(id),
  clock = () => performance.now(),
}) {
  const run = startAutoResolve(rootState, regionId, now);
  let cancelled = false;
  let rafId = 0;

  function frame() {
    if (cancelled) return;
    const t0 = clock();
    let result;
    // At least one batch always runs, even on a slow tick, so a single frame
    // still makes forward progress — the budget only decides how many MORE
    // batches this callback attempts before yielding to the next one.
    do {
      result = run.advanceOrFinish(MICRO_TICKS);
    } while (!result.done && clock() - t0 < FRAME_BUDGET_MS);

    if (cancelled) return;
    onProgress({ tick: result.tick, capTicks: result.capTicks });
    if (result.done) onDone({ outcome: result.outcome, config: run.config });
    else rafId = raf(frame);
  }
  rafId = raf(frame);

  return () => {
    cancelled = true;
    if (rafId) cancelRaf(rafId);
  };
}

/**
 * @param {object} io
 * @param {object} io.ctx  the screen ctx (state, scenes, screens)
 * @param {{h:Function, clear:Function, mount:Function, bindText:Function}} io.dom
 * @param {(sec:number)=>string} io.duration
 * @param {(locked:boolean)=>void} io.lockNav
 * @param {(region:object)=>void} io.onCancelled  redraw the ordinary raid
 *   panel for this region once a resolve is cancelled
 */
export function createAutoResolveUI({
  ctx, dom: { h, clear, mount, bindText }, duration, lockNav, onCancelled,
}) {
  let active = null; // {regionId, cancel}

  function begin(region, detail) {
    if (active) return;
    const line = h('p.wm-hint', { 'aria-live': 'off' });
    const setLine = bindText(line);
    let cancelResolve;
    try {
      cancelResolve = runAutoResolve({
        rootState: ctx.state,
        regionId: region.id,
        now: Date.now(),
        onProgress: ({ tick, capTicks }) => setLine(
          `Resolving… ${duration((tick * TICK_MS) / 1000)} of up to `
          + `${duration((capTicks * TICK_MS) / 1000)}.`,
        ),
        onDone: ({ outcome, config }) => {
          active = null;
          // The SAME call site a played battle uses — screens/results.js pays
          // through meta/rewards.js applyOutcome itself. No second payout
          // path exists here for that one to drift from.
          ctx.scenes.replace(ctx.screens.results, { outcome, config, auto: true });
        },
      });
    } catch {
      return; // not eligible any more somehow — leave the panel as it was
    }
    active = { regionId: region.id, cancel: cancelResolve };
    setLine('Resolving the raid…');
    clear(detail);
    mount(detail,
      h('h2#wm-detail-h', { text: region.name }),
      line,
      h('button.btn.ghost.wm-go', {
        text: COPY.cancel, type: 'button',
        'aria-label': 'Cancel the automatic resolution',
        on: { click: () => cancel(region) },
      }));
    lockNav(true);
  }

  /** No reward, no mutation — nothing in meta was touched while this ran
   *  (see meta/autobattle.js). */
  function cancel(region) {
    if (!active) return;
    active.cancel();
    active = null;
    lockNav(false);
    onCancelled(region);
  }

  return {
    /**
     * The optional half of the raid panel: a hint plus the button, or
     * nothing at all when this region is not eligible right now.
     * `canAutoResolve` is the SAME predicate that decides eligibility, so
     * this can never drift out of step with why the button is offered.
     */
    raidExtras(meta, region, now, detail) {
      if (!canAutoResolve(meta, region.id, now)) return [];
      return [
        h('p.wm-hint.dim', { text: COPY.hint }),
        h('button.btn.ghost.wm-auto', {
          text: COPY.button, type: 'button',
          'aria-label': `Resolve a raid on ${region.name} automatically, without playing it out`,
          on: { click: () => begin(region, detail) },
        }),
      ];
    },
    get isActive() { return !!active; },
    dispose() { active?.cancel(); active = null; },
  };
}
