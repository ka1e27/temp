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
  SITE_UPGRADE, CENTIGOLD, SITES, BUILD_COSTS, VISION_RADIUS,
} from '../src/content/balance.js';
import { distance as hexDistance } from '../src/core/hex.js';
import { buildBlocker } from '../src/battle/commands.js';
import { gridHexes } from '../src/battle/mapgen.js';
import { canSee } from '../src/battle/vision.js';

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

export function constructTurn(state, front, hexes) {
  if (state.sites.some((s) => s.owner === 'player'
    && (s.buildTicksLeft > 0 || s.upgradeTicksLeft > 0))) return;

  const mine = state.sites.filter((s) => s.owner === 'player');
  const yards = mine.filter((s) => SITES[s.kind].train > 0).length;
  const kind = yards < WANT_YARDS ? 'trainingGround' : 'farm';
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
    const score = nearestAdvance(state, h);
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

/** Hexes from this hex to the enemy throne — rule 4's "toward the war". */
function nearestAdvance(state, h) {
  const goal = state.sites.find((s) => s.kind === 'castle' && s.owner !== 'player');
  return goal ? hexDistance({ q: goal.hex[0], r: goal.hex[1] }, h) : 0;
}

/**
 * SIGHT OF THE OBJECTIVE, WHEN THE BOT HAS NONE OF ITS OWN.
 *
 * CLAUDE.md's most-repeated lesson, applied to fog: a mechanic the harness
 * cannot play is a mechanic nobody has measured. `beliefFor` can hand the bot
 * an accurate throne OWNER now (belief.js), but everything else about that
 * castle — garrison, level, hp — stays a presumption for as long as nothing
 * of the player's ever sees it, and a presumption is not a plan. The
 * watchtower is the game's own answer to "I cannot see the throne and need
 * to" — `BUILD_COSTS` prices it as the cheapest thing on the menu FOR this
 * reason ("an ordinary player has to be able to afford it on a whim rather
 * than save for it") — so this is that whim, scripted.
 *
 * THE RULE IS THE SMALLEST ONE THAT IS STILL HONEST PLAY: no vision of the
 * castle, nothing already being built or upgraded (the same one-at-a-time
 * convention `upgradeTurn`/`constructTurn` already keep), afford 120 gold
 * outright, raise a tower at the legal hex nearest the castle that would
 * actually reveal it. Nothing more elaborate, and nothing that nudges any
 * other decision this file makes — a real player who cannot see the throne
 * reaches for the cheapest fix, not a scouting doctrine.
 *
 * DOES NOT SHARE `upgradeTurn`'s reserve, ON PURPOSE. 120 gold is a rounding
 * error against a battle treasury (300 starting, 10-80/s), so gating this
 * behind the same `RESERVE_SEC`-scaled reserve the upgrade ladder protects
 * would make the one thing that answers fog compete for budget with a
 * mechanic that has nothing to do with it. "Can afford it outright" is the
 * whole gate, and it is why this is checked ahead of `upgradeTurn` below
 * rather than after: seeing the win condition is not one more spending
 * decision to queue behind the ladder.
 *
 * CHECKED AGAINST CURRENT VISION ONLY (`canSee`), not `state.seen`'s
 * last-known memory — a stale sighting answers "have I ever", and the
 * question this function exists to ask is "can I RIGHT NOW".
 *
 * PICKS THE SAFEST LEGAL HEX, NOT THE NEAREST ONE — and conflating those two
 * was a real, measured bug, not a style choice. `VISION_RADIUS.watchtower` is
 * a flat 4; any legal hex inside it sees the castle exactly as well as any
 * other, so "nearest to the castle" bought nothing and cost everything: on a
 * region where the enemy's remaining holdouts ring their own throne (mapgen's
 * `holdBandFrac`), the nearest legal hex is reliably the most exposed one on
 * the board. `construct.js` prices that fragility on purpose — 1 HP, no
 * regen, `razedByCapture` — for a farm behind the line that is a real risk; at
 * the front it is a certainty. Measured on nightharrow: the same hex razed
 * and rebuilt every 20-60 ticks for a THOUSAND-PLUS TICKS STRAIGHT, never
 * once surviving its own 150-tick build timer, `canSee` never once true. Zero
 * of those builds is a `site-built` event — the scaffolding never survives
 * long enough to fire it — so `--noscout`'s own guard test could not have
 * caught this: it counts completions, and there were none to miscount either
 * way. Maximise distance from the nearest non-player site instead, among the
 * hexes already legal and in range — the same notion of exposure
 * `frontDistance` uses elsewhere in this file, aimed at a hex instead of a
 * site because nothing is owned yet.
 */
function distToNearestFoe(state, h) {
  let best = Infinity;
  for (const s of state.sites) {
    if (s.owner === 'player') continue;
    const d = hexDistance({ q: s.hex[0], r: s.hex[1] }, h);
    if (d < best) best = d;
  }
  return best;
}

// On the map this measured against, the SAFEST legal hex was still reachable
// by the enemy's own nearby holdings inside the 15-second build window — the
// razing recurred every 20-90 ticks regardless of which of the five-to-seven
// candidates got picked, because a fresh scaffold has 1 HP and no garrison of
// its own (see the file header) and nothing short of vision-of-the-approach
// (the very thing missing) can tell a genuinely quiet hex from a contested
// one in advance. So this cannot be fixed by choosing better; it can only be
// fixed by not repeating a purchase the last attempt already answered — an
// ordinary player who watches a scout post fall does not rebuild it two
// seconds later, at the same spot, forever.
//
// TWO SEPARATE THROTTLES were tried and only one survived measurement.
// Reusing `upgradeTurn`/`constructTurn`'s shared "anything in flight" gate
// starves this on exactly the boards where it matters most: a mature,
// thirty-plus-site empire has SOMETHING mid-upgrade almost continuously, so
// the shared gate was closed on 4 of 6 sampled thinks even mid-battle, before
// a single razing had happened. A per-tick modulo window measured worse
// still — closed by that same shared gate often enough that the eligible
// window could be missed for the length of a whole battle. Neither belongs
// here: they answer "is the CONSTRUCTION LADDER busy", and a burned scout
// post has nothing to do with a farm upgrading three sites away.
//
// So the cooldown is scoped to watchtowers alone (never blocked by an
// unrelated upgrade) and timed from the harness's OWN last attempt, not from
// the tick clock. `lastScoutAttempt` is a WeakMap keyed by `state.grid` —
// the SAME key `HEX_CACHE` above uses, and for the same reason spelled out
// there: `state` here is `beliefFor`'s OUTPUT, a fresh object built new on
// every single think, so keying on it directly would never see its own
// previous entry — every think would find the map empty and the cooldown
// would silently do nothing (measured: this was the actual first cut, and it
// did not throttle a single retry). `grid` is the one sub-object `beliefFor`
// passes through BY REFERENCE rather than rebuilding, so it is the same
// object every time for one battle and a different one for the next. This
// is the harness DRIVER's own scratch memory, never part of a save file or a
// resumed battle (only `state.ai` is, because only the enemy's memory has to
// survive one), so it needs no JSON shape and cannot desynchronise a
// replay — the same seed reaches the same tick with the same board and
// makes the same decision every time, which is all determinism ever
// required.
const lastScoutAttempt = new WeakMap();
const SCOUT_RETRY_TICKS = 300; // roughly a real player's "try again later"

const watchtowerBuilding = (state) => state.sites
  .some((s) => s.owner === 'player' && s.kind === 'watchtower' && s.buildTicksLeft > 0);

export function scoutTurn(state, hexes) {
  if (watchtowerBuilding(state)) return;
  if (state.tick - (lastScoutAttempt.get(state.grid) ?? -Infinity) < SCOUT_RETRY_TICKS) return;

  const castle = state.sites.find((s) => s.kind === 'castle');
  if (!castle) return;
  const at = { q: castle.hex[0], r: castle.hex[1] };
  if (canSee(state, 'player', at.q, at.r)) return; // already answered

  const gold = goldOf(state.factions.player) / CENTIGOLD;
  if (gold < BUILD_COSTS.watchtower.gold) return;

  let best = null;
  let bestSafety = -Infinity;
  for (const h of hexes) {
    if (hexDistance(h, at) > VISION_RADIUS.watchtower) continue; // must actually SEE it
    if (buildBlocker(state, 'player', h)) continue;
    const safety = distToNearestFoe(state, h);
    if (safety > bestSafety) { bestSafety = safety; best = h; }
  }
  if (best) {
    state.commands.push({ t: 'BUILD', kind: 'watchtower', hex: [best.q, best.r] });
    lastScoutAttempt.set(state.grid, state.tick);
  }
}
