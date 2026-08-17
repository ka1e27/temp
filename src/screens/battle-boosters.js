// Armed boosters: arm one of the five one-shot troop actions, resolve the
// next site click to a target, push the BOOSTER command.
//
// Split out of ./battle-orders.js at the 400-line cap and called from inside
// createOrders() there, which is why every parameter here is something that
// file already had in scope rather than something this module goes looking
// for on its own — the same shape ./battle-build.js already uses, and for the
// same reason: arm, aim, fire-or-cancel is one mechanism, wanted in two places.
//
// Rally, Bombard and Fortify all answer 'needs-target', and every input path
// in the game sent `site: null` — three of five boosters were unreachable
// through the keyboard AND the HUD. Pressing one now ARMS it, and the next
// site click fires it there; march and tithe act on what you already have and
// fire at once.
import { needsTarget } from './battle-keys.js';

/**
 * @param {{view:object, canvas:?object, bus?:object, push:Function, cmd:object}} o
 * @returns {{armBooster, cancelBooster, fireBooster}}
 */
export function createArmedBoosters(o) {
  const { view, canvas, bus, push, cmd } = o;

  function syncArm() {
    canvas?.classList.toggle('is-targeting', !!view.armedBooster);
    bus?.emit('ui:armed-booster', view.armedBooster);
  }

  /** @returns {boolean} true when the booster is now armed and waiting. */
  function armBooster(id) {
    if (!needsTarget(id)) {           // march and tithe act on what you already have
      view.armedBooster = null;
      syncArm();
      push(cmd.booster(id, null));
      return false;
    }
    view.armedBooster = view.armedBooster === id ? null : id;  // press again to cancel
    syncArm();
    return !!view.armedBooster;
  }

  function cancelBooster() {
    if (!view.armedBooster) return false;
    view.armedBooster = null;
    syncArm();
    return true;
  }

  function fireBooster(siteId) {
    const id = view.armedBooster;
    if (!id) return false;
    view.armedBooster = null;
    syncArm();
    push(cmd.booster(id, siteId));
    return true;
  }

  return { armBooster, cancelBooster, fireBooster };
}
