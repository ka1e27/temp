// Unrest's live loop (PLAN-PHASE11b): runs meta/unrest.js tickUnrest on ACTIVE play time (the same "active" as the raid clock), in chunks of
// UNREST_TICK_SEC so the frontier's labels are read a few times a minute, not every frame, and shows the first-time toast. It owns no rules.
//
//   const unrest = createUnrestLoop({ getState, getWorld, ui, isActive, onChange });
//   unrest.tick(dtSec)   // every frame from main.js (never in a challenge: main.js skips it in the sandbox, and tickUnrest itself refuses)
import { UNREST } from '../config/unrest.js';
import { tickUnrest, ensureUnrest } from '../meta/unrest.js';

const UNREST_TICK_SEC = 5;

/** @param {{ getState: () => object, getWorld: () => object, ui: object, isActive: () => boolean, onChange?: () => void, onFirst?: () => void }} deps */
export function createUnrestLoop({ getState, getWorld, ui, isActive, onChange, onFirst }) {
  let acc = 0;
  let lastKey = '';
  return {
    tick(dtSec) {
      if (!isActive()) return;
      acc += Math.max(0, Number(dtSec) || 0);
      if (acc < UNREST_TICK_SEC) return;
      const state = getState();
      const world = getWorld();
      const dt = acc;
      acc = 0;
      const { started } = tickUnrest(state, world, dt, Date.now());
      const u = ensureUnrest(state);
      if (started != null && !u.toasted && world.regions[started]) {
        u.toasted = true;
        ui.toasts.update({ id: 'unrest-first', type: 'info', icon: 'flag', message: UNREST.copy.toast.replace('{region}', world.regions[started].name), duration: 9000 });
        onFirst?.(); // main.js: the pacer counts it as introduced (urgent: it never waits; the next new system waits behind it)
      }
      // the map label and an open card follow the thinning (whole percents only, so a redraw is rare)
      const key = `${u.target}|${Object.entries(u.thin).map(([k, v]) => `${k}:${Math.round(v * 100)}`).join(',')}`;
      if (key !== lastKey) { lastKey = key; onChange?.(); }
    },
  };
}
