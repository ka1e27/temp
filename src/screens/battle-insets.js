// Where the HUD's own furniture is sitting, in screen pixels.
//
// The site panel is anchored to a site on the board, so on a site near the top
// left it would happily park itself on top of the treasury readout, and on one
// near the bottom it would cover the dock — and a covered dock is an unclickable
// dock, which is the exact failure this project has shipped before.
//
// So the dock's height and the two corner stacks are measured and handed to
// battle-anchor.js as bounds and blockers. Measured, not hardcoded: the dock
// WRAPS to two rows on a narrow viewport, and a constant would be wrong there
// in the direction that hides controls.
//
// Layout reads are the expensive thing in a per-frame path, so this happens at
// most every `everyMs` and the same object is handed back in between — nothing
// here allocates per frame.
import { WEIGHT } from './battle-anchor.js';

/**
 * @param {{dock:HTMLElement, plates?:HTMLElement[], everyMs?:number,
 *          margin?:number}} o
 */
export function createHudInsets(o) {
  const { dock, plates = [], everyMs = 500, margin = 10 } = o;
  const out = { left: 8, right: 8, top: 8, bottom: 96, plates: [] };
  let at = -1e9;

  return {
    /** @param {number} now ms @returns {object} the shared insets object */
    get(now) {
      if (now - at < everyMs) return out;
      at = now;
      // The dock's own box is NOT its visual extent: every group label floats
      // above it on a transform, so measuring only offsetHeight leaves a panel
      // sitting across the word BOOSTERS. The overhang is measured rather than
      // guessed, so a type-scale change cannot quietly reintroduce it.
      const box = dock?.getBoundingClientRect?.();
      let overhang = 0;
      for (const l of dock?.querySelectorAll?.('.hud-group-label') ?? []) {
        // ALL of them, not the first: the groups are bottom-aligned and are
        // different heights, so the label that floats highest is not the one
        // that happens to come first in the DOM.
        overhang = Math.max(overhang, box.top - l.getBoundingClientRect().top);
      }
      out.bottom = Math.max(48, (dock?.offsetHeight ?? 0) + overhang + margin * 2);
      out.plates.length = 0;
      for (const el of plates) {
        const r = el?.getBoundingClientRect?.();
        if (!r || r.width <= 0 || r.height <= 0) continue;
        out.plates.push({
          left: r.left - margin, top: r.top - margin,
          right: r.right + margin, bottom: r.bottom + margin, w: WEIGHT.plate,
        });
      }
      return out;
    },
    /** Force a re-measure on the next get() — after a resize, say. */
    invalidate() { at = -1e9; },
  };
}
