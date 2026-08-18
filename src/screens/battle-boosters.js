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
import { boosterBlocker } from '../battle/commands.js';

/**
 * @param {{view:object, canvas:?object, bus?:object, getState:Function,
 *          push:Function, cmd:object}} o
 * @returns {{armBooster, cancelBooster, fireBooster}}
 */
export function createArmedBoosters(o) {
  const { view, canvas, bus, getState, push, cmd } = o;

  function syncArm() {
    canvas?.classList.toggle('is-targeting', !!view.armedBooster);
    bus?.emit('ui:armed-booster', view.armedBooster);
  }

  /** @returns {boolean} true when the booster is now armed and waiting. */
  function armBooster(id) {
    // A BOOSTER YOU HAVE NONE OF MUST NOT ARM, and this was the first thing a
    // new player touched that lied to them. A fresh save brings no charges (they
    // are bought with relics, and relics are only paid for a region you have
    // BEATEN), so battle one shows five live controls reading `-`; pressing one
    // armed it and answered `AIMING RALLY - click a site`, and the refusal
    // arrived on the second click, after the player had done as they were told.
    //
    // The command is still PUSHED rather than refused here, so the message, the
    // shake and the alert all come from the simulation through the path they
    // always did — one click, the sim's own words, and no instruction to follow
    // that cannot be followed. `boosterBlocker` is the same predicate
    // `cmdBooster` runs, not a copy of it.
    if (boosterBlocker(getState?.(), id)) {
      view.armedBooster = null;
      syncArm();
      push(cmd.booster(id, null));
      return false;
    }
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
