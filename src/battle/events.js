// Battle events.
//
// The simulation NEVER emits on the bus: a listener firing mid-tick could
// mutate state the sim is iterating. sim.js pushes plain objects onto
// state.events[] and main.js drains them AFTER the tick completes.
// Event names are declared here, per domain, rather than in one shared
// registry that every agent would conflict on.
// PURE.

export const EVENTS = Object.freeze({
  COMMAND_REJECTED: 'command-rejected',
  SQUAD_SENT: 'squad-sent',
  SQUAD_ARRIVED: 'squad-arrived',
  SQUAD_RETREATED: 'squad-retreated',
  /** An army reached open ground and is holding it. Distinct from ARRIVED,
   *  which means a building changed hands or a fight started — a camp resolves
   *  nothing, so a HUD that treated the two alike would announce a capture
   *  every time somebody took up a position. */
  SQUAD_CAMPED: 'squad-camped',
  FIELD_BATTLE: 'field-battle',
  // Carries `kind` as well as `siteId`, because the HUD banner reads
  // "UNDER SIEGE — stronghold" and read "— undefined" for as long as it
  // existed: SITE_CAPTURED below carried a kind and this one did not. A payload
  // nobody asserts on is exactly where that hides — tests/sim.test.js now does.
  SIEGE_BEGUN: 'siege-begun',
  SIEGE_REINFORCED: 'siege-reinforced',
  SIEGE_LIFTED: 'siege-lifted',
  SIEGE_ABANDONED: 'siege-abandoned',
  SITE_CAPTURED: 'site-captured',
  SITE_UPGRADED: 'site-upgraded',
  /** A building the player RAISED has finished going up. Carries `kind`, like
   *  SITE_CAPTURED and (since it was found missing one) SIEGE_BEGUN — the whole
   *  point of the event is which building it was. */
  SITE_BUILT: 'site-built',
  /** ...and one that was taken while it was still scaffolding. It is struck from
   *  the board rather than changing hands, so this is NOT a capture and must not
   *  be reported as one: nobody holds it afterwards. Carries `from`/`to` all the
   *  same, because "who took it off you" is the interesting half. */
  SITE_RAZED: 'site-razed',
  UNITS_TRAINED: 'units-trained',
  GARRISON_RETREATED: 'garrison-retreated',
  SKIRMISH_ESCAPE: 'skirmish-escape',
  BOOSTER_USED: 'booster-used',
  ATTRITION_STAGE: 'attrition-stage',
  BATTLE_ENDED: 'battle-ended',
});

/** Append a notification. Always carries the tick it happened on, so a
 *  consumer that drains late can still order things correctly. */
export function pushEvent(state, type, data = {}) {
  state.events.push({ type, tick: state.tick, ...data });
}

/** Take everything queued and leave the array empty. main.js calls this once
 *  per tick and emits each entry on the bus. */
export function drainEvents(state) {
  const out = state.events;
  state.events = [];
  return out;
}
