// One new system at a time (PLAN-PHASE10 10A). Every system's FIRST appearance (a tutorial step marked `intro`, the streak chip, the first Deed toast,
// the Bounty Board opening...) asks `ready(name)`; when it shows it calls `introduce(name)`. A system may appear once PACING.introGapSec of play has
// passed since the previous introduction. Urgent systems (raids, world events, Vendettas) skip the wait but still `introduce`, so the next one waits
// behind them. In memory only: a reload restarts the clock, and what the save already holds counts as introduced (`restore`). No DOM.
import { PACING } from '../config/pacing.js';
import { firstRaidPlannedAt } from '../meta/frontier.js';

/**
 * PLAN-PHASE11b: the scheduled first raid keeps a slot of its own: no other system's first appearance within PACING.firstRaidReserveSec
 * (active seconds) before or after the moment it is planned to set out. Pure: reads the state only.
 */
export function firstRaidReserved(state, reserveSec = PACING.firstRaidReserveSec) {
  if (!state || !state.frontier) return false;
  const at = firstRaidPlannedAt(state);
  return at != null && Math.abs((Number(state.frontier.activeSec) || 0) - at) < reserveSec;
}

/** What a save already shows the player: these systems never wait again. */
export function systemsInState(state) {
  const out = [];
  if (!state) return out;
  const seen = (state.tutorial && state.tutorial.seen) || {};
  if ((state.renown && state.renown.earned > 0) || (state.stats && state.stats.battlesWon > 0)) out.push('renown');
  if (state.bounties && state.bounties.unlocked) out.push('board');
  if (state.boons2 && ((state.boons2.owned && state.boons2.owned.length) || state.boons2.draws > 0)) out.push('boons');
  const deeds = state.generals && state.generals.deeds;
  // a Deed earned and already told (its news drained): the Deeds are known; one still waiting in `news` is not
  if (deeds && deeds.earned && Object.values(deeds.earned).some((v) => Number(v) > 0) && !(Array.isArray(deeds.news) && deeds.news.length)) out.push('deeds');
  if (state.streak && state.streak.best >= 2) out.push('streak');
  if (state.unrest && state.unrest.toasted) out.push('unrest'); // PLAN-PHASE11b
  for (const [id, name] of Object.entries(INTRO_OF_SEEN)) if (seen[id]) out.push(name);
  return [...new Set(out)];
}
// tutorial steps whose having been seen means their system is known (the steps' own `intro` names, kept here so a save can be read without the table)
const INTRO_OF_SEEN = { M2: 'scout', M3: 'works', R1: 'festival', V1: 'variety', Q1: 'board', G2: 'generals', L1: 'relics', H1: 'codex', J1: 'challenges', F4: 'fortify' };

/**
 * @param {{ getState: () => object, gapSec?: number | (() => number), hold?: (name: string) => boolean }} deps  a function is read live (main.js: 0 under the checks'
 *   __HD_TEST_NO_PACING); `hold(name)` true keeps a new system waiting whatever the gap (main.js: the first raid's reserved slot)
 */
export function createPacer({ getState, gapSec = PACING.introGapSec, hold = null }) {
  const known = new Map(); // name -> play second it was introduced (-1: already in the save)
  let lastAt = -Infinity;
  const now = () => { const s = getState(); return (s && s.stats && Number(s.stats.playSec)) || 0; };
  const gap = () => (typeof gapSec === 'function' ? gapSec() : gapSec);
  const api = {
    /** May `name` make its first appearance now? (Always true once it has.) */
    ready(name) { return known.has(name) || (!(hold && hold(name)) && now() - lastAt >= gap()); },
    /** `name` has just appeared for the first time (no-op after that). */
    introduce(name) { if (known.has(name)) return; const t = now(); known.set(name, t); lastAt = t; },
    known: (name) => known.has(name),
    /** Seconds until the next introduction may happen (0 = now). */
    wait() { return Math.max(0, gap() - (now() - lastAt)); },
    /** A new realm, an import, a dynasty, a load: forget, then count what the save already shows. */
    reset() { known.clear(); lastAt = -Infinity; for (const n of systemsInState(getState())) known.set(n, -1); },
    list: () => [...known.entries()],
  };
  return api;
}
