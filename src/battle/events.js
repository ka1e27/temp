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
  /** A stronghold or watchtower shot an enemy column passing within its range.
   *  Carries the hex rather than only the site, because the casualties happen
   *  where the ARMY is standing, not at the building's feet — an effect drawn
   *  on the tower would point the player at the wrong half of the exchange. */
  TOWER_FIRED: 'tower-fired',
  /** An army reached open ground and is holding it. Distinct from ARRIVED,
   *  which means a building changed hands or a fight started — a camp resolves
   *  nothing, so a HUD that treated the two alike would announce a capture
   *  every time somebody took up a position. */
  SQUAD_CAMPED: 'squad-camped',
  FIELD_BATTLE: 'field-battle',
  /** ...AND THE SAME FIGHT SIX SECONDS LATER, which nothing reported.
   *
   *  `FIELD_BATTLE` fires when a fight OPENS or is reinforced. Its resolution
   *  fired an event only on the ONE outcome that starts a siege — so a column
   *  that beat a garrison was announced and a column that was wiped out was
   *  not, and neither was a garrison that held. Both silent outcomes are the
   *  ones a player would act on: your assault dying is what you would have
   *  relieved, and your farm holding is the only good news the melee layer can
   *  give you.
   *
   *  Carries a POSITION, one way or the other: `siteId` at a building, `hex`
   *  on open ground. It must have one — the fifth fog leak this project found
   *  was an event with no position being let through the gate as "not a
   *  positional claim", so it was inaudible-visible inverted. Note the two are
   *  NOT interchangeable: `fxVisible` reads `ev.hex.q`, an object, and returns
   *  on it before the site fallback, so handing it the `[q,r]` array off a site
   *  fogs the event away from the player it is for. */
  FIELD_BATTLE_ENDED: 'field-battle-ended',
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
