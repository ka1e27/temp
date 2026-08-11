// WHAT THE EMPIRE BUILDS BEHIND THE LINE.
//
// Split out of ./simplayer.js purely for the 400-line cap and re-exported from
// there, so `import { upgradeTurn } from './simplayer.js'` keeps working. The
// division of labour: that file spends the army every turn; this one is the
// one thing the bot does with its TREASURY — queuing the site-upgrade ladder
// a rear region builds behind the fighting.
import { goldOf } from '../src/battle/economy.js';
import { factionTrainCostPerSec } from '../src/battle/training.js';
import { SITE_UPGRADE, CENTIGOLD } from '../src/content/balance.js';

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
const BUILD_ORDER = { farm: 0, trainingGround: 1, camp: 2, stronghold: 3, castle: 4 };

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
