// Armed construction: arm a buildable kind, resolve the next click to a hex,
// push the BUILD command.
//
// Split out of ./battle-orders.js at the 400-line cap and called from inside
// createOrders() there, which is why every parameter here is something that
// file already had in scope rather than something this module goes looking
// for on its own.
//
// Same one-shot shape as an armed booster (battle-orders.js) — arm, aim,
// fire-or-cancel — but the target is a HEX, not a site: building means
// raising one on ground nothing already occupies, which `board.siteAt`
// cannot answer. `fromPixel` (core/hex.js, otherwise unused anywhere) can.
import { fromPixel } from '../core/hex.js';

/**
 * @param {{view:object, canvas:?object, bus?:object, board:object,
 *          cancelBooster:()=>boolean, pushBuild:(kind:string, hex:number[])=>void}} o
 *   `cancelBooster` is battle-orders.js's own, so arming a build can drop an
 *   armed booster the same way `setRallyMode` does — one aim at a time.
 * @returns {{armBuild, cancelBuild, fireBuild}}
 */
export function createArmedBuild(o) {
  const { view, canvas, bus, board, cancelBooster, pushBuild } = o;

  function sync() {
    canvas?.classList.toggle('is-targeting', !!view.armedBuild);
    bus?.emit('ui:armed-build', view.armedBuild);
  }

  /** @returns {boolean} true when `kind` is now armed and waiting for a hex. */
  function armBuild(kind) {
    view.armedBuild = view.armedBuild === kind ? null : kind;  // press again cancels
    if (view.armedBuild) cancelBooster();   // one aim at a time, same rule as setRallyMode
    sync();
    return !!view.armedBuild;
  }

  function cancelBuild() {
    if (!view.armedBuild) return false;
    view.armedBuild = null;
    sync();
    return true;
  }

  /** Resolve the world point under the pointer to a hex and fire. Legality is
   *  not re-checked here: `buildBlocker` already drove the preview the player
   *  was looking at, and `cmdBuild` is the single source of truth for whether
   *  the hex holds — a second opinion here could only disagree with it. */
  function fireBuild(wx, wy) {
    const kind = view.armedBuild;
    if (!kind) return false;
    view.armedBuild = null;
    sync();
    const h = fromPixel(wx, wy, board.hexSize);
    pushBuild(kind, [h.q, h.r]);
    return true;
  }

  return { armBuild, cancelBuild, fireBuild };
}
