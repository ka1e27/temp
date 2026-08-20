// WHAT THE EMPIRE BUILDS BEHIND THE LINE.
//
// Split out of ./simplayer.js purely for the 400-line cap and re-exported from
// there, so `import { upgradeTurn } from './simplayer.js'` keeps working. The
// division of labour: that file spends the army every turn; this one is the
// one thing the bot does with its TREASURY — queuing the site-upgrade ladder
// a rear region builds behind the fighting.
import { goldOf } from '../src/battle/economy.js';
import { factionTrainCostPerSec } from '../src/battle/training.js';
import {
  SITE_UPGRADE, CENTIGOLD, SITES, BUILD_COSTS,
} from '../src/content/balance.js';
import { distance as hexDistance } from '../src/core/hex.js';
import { buildBlocker } from '../src/battle/commands.js';
import { gridHexes } from '../src/battle/mapgen.js';

/**
 * Candidate hexes for a build, cached per battle.
 *
 * `gridHexes` allocates the whole board, and `constructTurn` runs on every think
 * of every battle in a 240-run sweep — so this is the difference between a
 * harness that measures construction and one that spends its time rebuilding an
 * array that cannot change. The grid is fixed for a battle's whole life, which
 * is what makes caching it safe; a WeakMap keyed on the grid object means a
 * second battle in the same process misses and rebuilds.
 */
const HEX_CACHE = new WeakMap();
export function buildHexes(state) {
  let hexes = HEX_CACHE.get(state.grid);
  if (!hexes) {
    hexes = gridHexes(state.grid.cols, state.grid.rows);
    HEX_CACHE.set(state.grid, hexes);
  }
  return hexes;
}

/**
 * Which owned sites count as "behind the line", RELATIVE to the rest.
 *
 * An absolute threshold does not survive this game's own map shapes: the player
 * lands on a beachhead of three or four sites packed together inside enemy
 * country, so at any fixed number of hexes either every site is the front (and
 * the bot never builds anything) or none is (and it builds on the line). Both
 * were measured — at 4 hexes, all four of gallowmoor's player sites scored as
 * front and `upgradeTurn` did nothing at all.
 *
 * So it is relative: the sites nearest the fighting are the line, and whatever
 * is further back is where you build. That always leaves somewhere to build
 * unless every site is equally exposed, which is a beachhead that has bigger
 * problems. The floor keeps a site with a hostile neighbour off the list however
 * the rest of the map looks.
 */
export function rearOf(front, ids) {
  const vals = ids.map((id) => front[id]).filter(Number.isFinite);
  if (!vals.length) return () => false;
  const line = Math.max(1, Math.min(...vals));
  return (id) => front[id] > line;
}

/**
 * WHAT AN ORDINARY PLAYER BUILDS, AND WHEN.
 *
 * The harness used to issue no `UPGRADE` command at all, so `SITE_LEVELS` and
 * every `SITE_UPGRADE` step were unexercised by every balance number this
 * project had ever taken — while the enemy got the same ladder free at mapgen
 * via each region's `develop`. Levelling was tuned in for the defender and
 * tuned out for the attacker, and the gap was worth 27-38 points of win rate.
 *
 * Turning it on required a design decision, not just a flag, because
 * max-levelling every safe site is OPTIMAL play and the harness is supposed to
 * measure an ORDINARY one. These five rules are that decision. Each is a thing
 * a real player does at the site panel, and each is a place a perfect player
 * would do better:
 *
 *   1. REAR SITES ONLY. You build where you feel safe. `frontDistance` 0 means
 *      the site borders something you do not hold, and nobody sinks 400 gold
 *      into a wall the enemy is walking at. (It is also genuinely safe: sends
 *      are adjacency-only, so a site whose neighbours are all yours cannot be
 *      attacked directly at all.)
 *   2. ONE AT A TIME. You click the button, watch the bar, come back. This is
 *      also what keeps the spend rate honest — the empire cannot convert its
 *      whole treasury into levels in one tick.
 *   3. OUT OF VISIBLE SURPLUS ONLY. You upgrade when gold is piling up, never
 *      out of the money your strongholds are about to spend. The reserve is
 *      `RESERVE_SEC` seconds of the empire's ACTUAL training bill (read from
 *      the sim's own `factionTrainCostPerSec`, not guessed), so it scales with
 *      how much army is being run rather than with a magic number.
 *   4. CHEAPEST STEP FIRST. You buy what is affordable now. The emergent shape
 *      is the ordinary one: everything goes to L2 before anything goes to L3.
 *   5. IT STOPS SHORT OF THE TOP STEP. L4 -> L5 costs 2200 gold and 65 seconds
 *      — a whole-battle commitment that an ordinary player, mid-fight, does not
 *      make. This is the single clearest line between ordinary and optimal, so
 *      it is the one that is drawn explicitly rather than fallen into.
 *
 * `MAX_LEVEL` is expressed against `SITE_UPGRADE.length` rather than written as
 * 4, because balance.js has already extended this ladder once and a hardcoded
 * rung here would silently stop meaning "all but the last step".
 */
// Exported: `playerTurn` in ./simplayer.js reads the same reserve to decide
// whether the treasury is outrunning the yards (PRIORITY vs PRIORITY_FLUSH),
// and it has to be the SAME reserve rather than a second guess at it.
export const RESERVE_SEC = 25;
export const RESERVE_FLOOR = 120;   // ...and never less than this, early on
const MAX_LEVEL = SITE_UPGRADE.length; // every step but the last
/** Ties are broken by role, and cheap steps tie constantly (every L1 site costs
 *  150). Farms first: the L1->L2 gold jump is the biggest single multiplier on
 *  the table (x1.75) and income compounds. Then the YARD, because a level is
 *  x1.35 training throughput and the thing you are short of mid-battle is
 *  bodies; the WALL is last of the three, since levelling ground you already
 *  hold is the least urgent thing a level buys. */
// watchtower is last: it buys sight, and this bot never plays for it.
const BUILD_ORDER = {
  farm: 0, trainingGround: 1, camp: 2, stronghold: 3, castle: 4, watchtower: 5,
};

/**
 * Queue at most one site upgrade. `front` is `frontDistance(state)`, passed in
 * rather than recomputed because the caller already has it.
 */
export function upgradeTurn(state, front) {
  // Rule 2: one build in flight across the whole empire.
  if (state.sites.some((s) => s.owner === 'player' && s.upgradeTicksLeft > 0)) return;

  const gold = goldOf(state.factions.player) / CENTIGOLD;
  // Rule 3: what is left after the army's running costs are covered.
  const reserve = Math.max(RESERVE_FLOOR, factionTrainCostPerSec(state, 'player') * RESERVE_SEC);

  const mine = state.sites.filter((s) => s.owner === 'player');
  const isRear = rearOf(front, mine.map((s) => s.id));

  let best = null;
  let bestScore = Infinity;
  for (const s of state.sites) {
    if (s.owner !== 'player' || s.siege) continue;
    if (s.level >= MAX_LEVEL) continue;             // rule 5
    if (!isRear(s.id)) continue;                    // rule 1 — on the line
    const spec = SITE_UPGRADE[s.level - 1];
    if (!spec || gold < spec.gold + reserve) continue;
    const score = spec.gold * 10 + BUILD_ORDER[s.kind]; // rule 4, then role
    if (score < bestScore) { bestScore = score; best = s; }
  }
  if (best) state.commands.push({ t: 'UPGRADE', site: best.id });
}

/**
 * WHERE AN ORDINARY PLAYER RAISES A BUILDING, AND WHAT.
 *
 * The same lesson as `upgradeTurn`, one release later and with the receipts
 * already in: a mechanic the harness cannot play is a mechanic nobody has
 * measured, and every region priced against a bot that never built one would be
 * priced against a player who ignores the headline verb. Construction is a
 * bigger version of that gap, because the yard/wall split put every enemy
 * training ground in the ring around its throne — five or six on a whole map,
 * all at the far end — so a bot that cannot build is a bot whose production is
 * capped at what it landed with.
 *
 * Four rules, and each is a thing a real player does at the board:
 *
 *   1. THE YARD FIRST, AND ONLY WHEN SHORT OF ONE. Bodies are what you run out
 *      of; a farm you can capture. So it builds a training ground while it holds
 *      fewer than `WANT_YARDS`, and otherwise a farm — and it never builds a
 *      stronghold at all, because levelling ground you already hold is cheaper
 *      per point of defence than raising a wall from nothing. That is a claim
 *      about ordinary play, not about optimal play, and it is the line this
 *      function is here to draw.
 *   2. BEHIND THE LINE, on the same `rearOf` gradient the upgrade ladder uses.
 *      A site goes up at 1 HP and stays there for the whole build — see
 *      battle/construct.js — so raising one where the fighting is means paying
 *      for a building the enemy razes before it opens. `buildBlocker`'s ground
 *      rule is now the player's TERRITORY rather than a radius from one site
 *      (same file), so a legal hex no longer implies proximity to any
 *      particular site of mine — the anchor below is whichever of my sites is
 *      actually NEAREST the candidate hex, and rule 2 asks whether THAT one is
 *      a rear site, not whether some rear site happens to be close enough.
 *   3. OUT OF THE SAME SURPLUS `upgradeTurn` reasons about, and never in the
 *      same turn as an upgrade. One treasury, one decision, and the reserve is
 *      the empire's ACTUAL training bill rather than a magic number.
 *   4. NEAREST THE FRONT OF THE REAR. Among the legal hexes it takes the one
 *      closest to the throne, so the country grows toward the war instead of
 *      backfilling ground already three sites deep.
 *
 * DELIBERATELY STILL ONE BUILD AT A TIME, even though the engine now allows
 * `BUILD_MAX_CONCURRENT` (2) — rule 3 already models an ordinary player as
 * someone who queues one thing, watches it, and comes back, and spending both
 * slots every time it can afford to is the OPTIMAL play this file exists to
 * NOT measure (same argument `upgradeTurn`'s rule 5 makes about the top rung
 * of the upgrade ladder). Teaching the bot to fill both slots is a balance
 * pass — it would move every region's construction throughput at once — not
 * a consequence of the engine change above.
 */
const WANT_YARDS = 3;

/**
 * RULE 4: three yards is a beachhead's answer and the bot kept playing it with
 * fifty sites. Measured on thanescar at minute fifteen — 41 farms, 8 yards, nine
 * places in the world to turn gold into a body, and 118,303 unspent gold against
 * an 11.7/s training bill, which is 2.8 HOURS of training banked in a battle
 * with fifteen minutes left on its cap. What rule 1 implies and then caps: if
 * you cannot spend your income, what you are short of is somewhere to spend it.
 * `RICH_SEC` is generous on purpose; at one minute this is a strategy, not a
 * correction.
 *
 * **IT SHIPS ON, AND `--norichyards` REVERTS IT.** It shipped OFF at first, not
 * out of doubt but because the effect was too big to land mid-search: every
 * number in `regions.data.js` was measured without it. Re-measured at n=24 with
 * matched seeds across four rows spanning tiers 3-6 (the recorded figure was n=8
 * and overstated it, exactly as this project's sample-size rule predicts):
 *
 *     region        band     off    on     delta
 *     gallowmoor   50-72     38%    75%     +37
 *     thanescar    34-56     29%    58%     +29
 *     ravensmarch  22-42     17%    54%     +37
 *     widowsgate   18-36      4%    50%     +46
 *
 * Unanimous, large, and it CHANGES THE SHAPE OF THE PROBLEM rather than the
 * level: those four rows go from 5-14 points BELOW their floors to 2-14 above
 * their ceilings. A campaign tuned against the old default was tuned to
 * compensate for a bot that could not spend its own money, which is exactly the
 * work CLAUDE.md warns about — "a session would have been spent moving dials to
 * compensate for defenders silently dropping half the orders given to them, and
 * then spent again undoing it".
 *
 * Correcting downward from a competent bot is a dial job. Correcting upward from
 * an incompetent one was the structural search the re-tune had been stuck in.
 */
export const RICH_SEC = 120;
export const cannotSpendIt = (state) => {
  const gold = goldOf(state.factions.player) / CENTIGOLD;
  const bill = factionTrainCostPerSec(state, 'player');
  return bill <= 0 ? gold > RESERVE_FLOOR : gold > bill * RICH_SEC;   // no bill: purest case
};

/**
 * RULE 5: UNDER PRESSURE YOU BUILD A WALL, NOT A FARM — BUILT, MEASURED, AND
 * REFUTED. It ships OFF (`--wall` opts in) and the code stays so the delta is
 * re-takeable rather than remembered.
 *
 * Rule 1 says the bot never builds a stronghold, on the argument that levelling
 * ground you already hold is cheaper per point of defence than raising one from
 * nothing. That was an assertion; this is what happened when it was tested.
 * Measured on obsidian, a run the bot LOST: seven farms raised and seven razed
 * while its army collapsed, which reads exactly like a player who should have
 * put up a wall. So the rule was written and measured, n=16, matched seeds:
 *
 *     region        --wall off   on     delta
 *     gallowmoor        50%      25%     -25
 *     thanescar         25%      13%     -12
 *
 * **AND THE MECHANISM IS THE INTERESTING PART, because it is not "walls are
 * bad".** Instrumented over a whole gallowmoor battle: `underPressure` is true
 * on **57% of thinks** (654 of 1,140). It is not an emergency signal, it is the
 * NORMAL STATE of a mid-campaign battle — CLAUDE.md's own census records the
 * enemy launching ~106 columns a minute and about one field battle a second, so
 * "something of mine is being attacked right now" is nearly always true.
 *
 * The rule does not spam walls — `WANT_WALLS` caps it, and the same battle
 * issued 2 strongholds against 56 farms. What it does is spend the OPENING on
 * them: pressure arrives early, a stronghold is 500g/50s against a farm's
 * 200g/25s, and `constructTurn` builds one thing at a time. So the first two
 * builds of the battle cost 2.5x the gold and 2x the slot time and produce
 * nothing, in the window where construction compounds hardest. That is the
 * whole -18 average, from two buildings.
 *
 * WHAT WOULD MAKE IT CORRECT, if anyone tries again: a signal that separates
 * "being poked" from "being overrun". The observation that motivated this rule
 * was a bot that was LOSING, and losing needs a memory of ground lost that the
 * harness does not keep. Do not re-spend the version below.
 *
 * PRESSURE HERE IS "SOMETHING OF MINE IS BEING ATTACKED RIGHT NOW": a siege on
 * my ground, a melee at one of my sites, or an enemy column inbound to one.
 *
 * A CAMPED enemy column is deliberately NOT pressure. It is exactly the
 * "parked next door and threatening nothing" case `aihome.js encroachment`
 * exists to catch for the AI, and reading it as an attack here would make the
 * rule fire on ground nobody has moved against — a wall raised at 1 HP against
 * a force that never comes is worse than the farm it replaced.
 */
const underPressure = (state) => {
  for (const s of state.sites) {
    if (s.owner !== 'player') continue;
    if (s.siege?.owner === 'enemy' || s.melee) return true;
  }
  for (const sq of state.squads) {
    if (sq.owner !== 'enemy' || sq.camped || !sq.to) continue;
    const target = state.sites.find((s) => s.id === sq.to);
    if (target?.owner === 'player') return true;
  }
  return false;
};

/** How many walls an ordinary player raises before deciding the answer is
 *  troops rather than masonry. Two, because a third is a builder's answer to a
 *  problem that is plainly not being solved by building. */
const WANT_WALLS = 2;

export function constructTurn(state, front, hexes, opts = {}) {
  if (state.sites.some((s) => s.owner === 'player'
    && (s.buildTicksLeft > 0 || s.upgradeTicksLeft > 0))) return;

  const mine = state.sites.filter((s) => s.owner === 'player');
  const yards = mine.filter((s) => SITES[s.kind].train > 0).length;
  // Rule 4, ON by default since it was measured at +29 to +46 across tiers 3-6.
  // `--norichyards` reverts to the bot every number older than that pass was
  // taken with, so the delta stays re-takeable rather than remembered.
  const wantYard = yards < WANT_YARDS
    || (opts.richYards !== false && cannotSpendIt(state));
  // RULE 5, OPT-IN AND OFF BY DEFAULT — measured at -25 and -12 points, see the
  // docblock above for the mechanism. It outranks the farm but NOT the yard: a
  // bot with no way to make troops has a worse problem than a bot being shot at.
  const walls = mine.filter((s) => s.kind === 'stronghold').length;
  const wantWall = !wantYard && opts.walls === true
    && walls < WANT_WALLS && underPressure(state);
  const kind = wantWall ? 'stronghold' : wantYard ? 'trainingGround' : 'farm';
  const spec = BUILD_COSTS[kind];

  const gold = goldOf(state.factions.player) / CENTIGOLD;
  const reserve = Math.max(RESERVE_FLOOR, factionTrainCostPerSec(state, 'player') * RESERVE_SEC);
  if (gold < spec.gold + reserve) return;

  // Rule 2, expressed against the sites rather than the hexes: a candidate hex
  // is only as safe as the site that legitimises it, so it inherits that site's
  // place on the front gradient.
  const isRear = rearOf(front, mine.map((s) => s.id));
  if (!mine.some((s) => isRear(s.id))) return;

  let best = null;
  let bestScore = Infinity;
  for (const h of hexes) {
    if (buildBlocker(state, 'player', h)) continue;
    // Legality (buildBlocker) only ever says the hex is somewhere in MY
    // territory now, not whose. The nearest of my own sites is the one whose
    // safety the hex actually inherits.
    const anchor = nearestMine(mine, h);
    if (!anchor || !isRear(anchor.id)) continue;
    // A FARM GROWS TOWARD THE WAR AND A WALL STANDS BEHIND THE THREAT, which is
    // rule 4 and rule 5 wanting opposite things from the same scan. Scoring a
    // wall by distance to the throne would put it at the far end of the country
    // from whatever is being attacked — legal, useless, and exactly the shape of
    // "it built something while it was losing" this rule exists to fix.
    const score = wantWall ? nearestThreat(state, h) : nearestAdvance(state, h);
    if (score < bestScore) { bestScore = score; best = h; }
  }
  if (best) state.commands.push({ t: 'BUILD', kind, hex: [best.q, best.r] });
}

const hexDist = (site, h) => hexDistance({ q: site.hex[0], r: site.hex[1] }, h);

/** Closest of `mine` to hex `h` — see constructTurn's rule 2 above. */
function nearestMine(mine, h) {
  let best = null;
  let bestD = Infinity;
  for (const s of mine) {
    const d = hexDist(s, h);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

/**
 * Hexes from this hex to the nearest site of mine that is actually under
 * attack — rule 5's "behind the threat". Falls back to the throne so a wall
 * always has somewhere to go if the pressure lifts between the kind choice and
 * the scan; `Infinity` there would refuse every hex and silently build nothing.
 */
function nearestThreat(state, h) {
  let best = Infinity;
  for (const s of state.sites) {
    if (s.owner !== 'player' || !(s.siege?.owner === 'enemy' || s.melee)) continue;
    const d = hexDist(s, h);
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : nearestAdvance(state, h);
}

/** Hexes from this hex to the enemy throne — rule 4's "toward the war". */
function nearestAdvance(state, h) {
  const goal = state.sites.find((s) => s.kind === 'castle' && s.owner !== 'player');
  return goal ? hexDistance({ q: goal.hex[0], r: goal.hex[1] }, h) : 0;
}

// The watchtower answer to fog lives in tools/simscout.js — see the note at the
// top of that file. Re-exported so existing imports keep working.
export { scoutTurn } from './simscout.js';
