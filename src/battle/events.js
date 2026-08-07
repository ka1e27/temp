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
  FIELD_BATTLE: 'field-battle',
  SIEGE_BEGUN: 'siege-begun',
  SIEGE_REINFORCED: 'siege-reinforced',
  SIEGE_LIFTED: 'siege-lifted',
  SIEGE_ABANDONED: 'siege-abandoned',
  SITE_CAPTURED: 'site-captured',
  SITE_UPGRADED: 'site-upgraded',
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
