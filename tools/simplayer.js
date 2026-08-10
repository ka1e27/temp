// The harness's scripted player, and the one-battle driver.
//
// Split out of tools/simrunner.js so it can be IMPORTED without running the
// CLI. tests/aidefence.test.js drives real battles through this exact bot, so
// an AI assertion is made against the same ordinary opponent the balance table
// is measured with — not against a hand-built fixture.
import { startBattle, step } from '../src/battle/sim.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { createState } from '../src/core/store.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { recalcIncome, incomePerSec } from '../src/meta/idle.js';
import { shopListing, buy } from '../src/meta/upgrades.js';
import { breachSeconds, total, resolveField } from '../src/battle/combat.js';
import { groundOf, siteDefMultOf } from '../src/battle/terrain.js';
import { siteControlFraction } from '../src/battle/state.js';
import { factionTrainCostPerSec } from '../src/battle/training.js';
import { goldOf } from '../src/battle/economy.js';
import { UNIT_IDS, SITE_UPGRADE, CENTIGOLD } from '../src/content/balance.js';
import { assaultFilter, riderTurn, COLUMN_FILTER } from './simtactics.js';

/** Farms first (economy wins fights), then the war machine, then the prize. */
const PRIORITY = { farm: 0, stronghold: 1, castle: 2, camp: 3 };
// Keep a real home guard, but not so large that the opening push never fires —
// the expedition exists to be spent, and the first minute is when enemy sites
// are still thinly held.
const HOME_FLOOR = 5;
const ATTACK_MARGIN = 1.5; // overkill to survive the defender's reinforcement

/** Hops from each owned site to the nearest one bordering an enemy/neutral. */
export function frontDistance(state) {
  const dist = {};
  const queue = [];
  for (const s of state.sites) {
    if (s.owner !== 'player') continue;
    if (s.adj.some((id) => {
      const t = state.sites.find((x) => x.id === id);
      return t && t.owner !== 'player';
    })) { dist[s.id] = 0; queue.push(s); }
  }
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const id of cur.adj) {
      const n = state.sites.find((x) => x.id === id);
      if (!n || n.owner !== 'player' || dist[id] !== undefined) continue;
      dist[id] = dist[cur.id] + 1;
      queue.push(n);
    }
  }
  return dist;
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
const RESERVE_SEC = 25;
const RESERVE_FLOOR = 120;   // ...and never less than this, early on
const MAX_LEVEL = SITE_UPGRADE.length; // every step but the last
/** Ties are broken by role, and cheap steps tie constantly (every L1 site costs
 *  150). Farms first: the L1->L2 gold jump is the biggest single multiplier on
 *  the table (x1.75) and income compounds, which is the same reasoning that
 *  puts farms at the top of PRIORITY above. */
const BUILD_ORDER = { farm: 0, camp: 1, stronghold: 2, castle: 3 };

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

  let best = null;
  let bestScore = Infinity;
  for (const s of state.sites) {
    if (s.owner !== 'player' || s.siege) continue;
    if (s.level >= MAX_LEVEL) continue;             // rule 5
    if (front[s.id] === 0) continue;                // rule 1 — on the line
    const spec = SITE_UPGRADE[s.level - 1];
    if (!spec || gold < spec.gold + reserve) continue;
    const score = spec.gold * 10 + BUILD_ORDER[s.kind]; // rule 4, then role
    if (score < bestScore) { bestScore = score; best = s; }
  }
  if (best) state.commands.push({ t: 'UPGRADE', site: best.id });
}

/**
 * A deliberately ordinary player: expands toward soft targets, keeps a home
 * garrison, builds up the country behind the line, and only commits when it can
 * actually BREACH — which is the lesson the siege rules exist to teach. If a
 * competent-but-unremarkable player cannot clear a region, that region is
 * mis-tuned.
 *
 * `opts.upgrades: false` reverts to the pre-upgrade bot. That exists so the
 * cost of the mechanic stays MEASURABLE after it is switched on — the delta in
 * CLAUDE.md was taken with `--noupgrades`, and re-taking it is one flag rather
 * than a fork of this file.
 */
export function playerTurn(state, opts = {}) {
  const mine = state.sites.filter((s) => s.owner === 'player');
  const inFlight = new Set(state.squads.filter((q) => q.owner === 'player').map((q) => q.from));
  const front = frontDistance(state);

  // THE RIDERS GET FIRST REFUSAL, and the ordering is the whole tactic.
  //
  // `movement.js slowestSpeed` is a MIN over the stack, so one militia drops a
  // 165-speed outrider to 55 and the unit's reason to exist is gone before it
  // leaves the gate — the old bot sent `filter: UNIT_IDS` every time and so
  // never once moved an outrider at outrider speed. Going first is what lets a
  // detachment that CAN act alone do so; whatever this pass turns down is picked
  // up by the column below rather than left standing, because a benched body is
  // worth nothing at any exchange rate.
  //
  // Queues nothing whatsoever when no garrison holds a rider, which is every
  // default run and therefore every tuned number in regions.data.js.
  for (const src of mine) riderTurn(state, src, front);

  for (const src of mine) {
    const garrison = total(src.garrison);
    const floor = src.kind === 'camp' ? HOME_FLOOR : 3;
    if (garrison <= floor + 3) continue;
    // A wave already left here — only send a second if we are still strong.
    // Sitting on an unused army is the classic way to lose a winnable map.
    if (inFlight.has(src.id) && garrison < floor + 15) continue;

    // Commit only what we can spare above the floor.
    const fraction = Math.min(0.75, (garrison - floor) / garrison);
    // Everyone but the riders, who are making their own way at three times this
    // pace. The send is built from the filter it will actually be dispatched
    // with — evaluating one army and marching a different one is how a harness
    // reports a number about a battle it never fought.
    const filter = assaultFilter(state, src);
    const send = {};
    for (const u of UNIT_IDS) {
      send[u] = filter.includes(u) ? Math.floor((src.garrison[u] || 0) * fraction) : 0;
    }
    if (total(send) < 5) continue;

    let best = null;
    let bestScore = Infinity;
    for (const id of src.adj) {
      const t = state.sites.find((x) => x.id === id);
      if (!t || t.owner === 'player' || t.siege?.owner === 'player') continue;
      // The castle gate is VISIBLE (see screens/battle-panel.js) precisely so a
      // competent player does not commit an army to a siege that cannot
      // finish — a sealed castle would otherwise soak up a wave every turn and
      // starve every other front while it sits there doing nothing. A real
      // player reads "SEALED" and goes to take the countryside instead; this
      // bot does the same read directly off the territory fraction.
      if (t.kind === 'castle'
        && siteControlFraction(state, 'player') < (state.rules.castleGateFrac ?? 0)) continue;

      // Terrain through the sim's own functions, not a hardcoded table: the
      // game shows the player an EXACT preview, so a competent player reads the
      // mountains around a fort. A harness that could not would systematically
      // throw armies at walls and report the region as too hard.
      const ground = groundOf(state, t);
      const field = resolveField(send, t.garrison, {
        siteDefMult: siteDefMultOf(state, t), ground,
      });
      // Demand a real margin, not a bare win. The defender reinforces while our
      // squad is in transit, so a coin-flip on paper is a loss on arrival —
      // this is the "if unreinforced" caveat the HUD warns about.
      if (!field.win || field.attPower < field.defPower * ATTACK_MARGIN) continue;
      const secs = breachSeconds(field.attSurvivors, t.hp, t.kind, t.level, 1, 1, ground);
      if (!Number.isFinite(secs) || secs > 90) continue; // a siege we cannot finish

      const score = secs + PRIORITY[t.kind] * 25 - (t.kind === 'castle' ? 120 : 0);
      if (score < bestScore) { bestScore = score; best = t; }
    }

    if (best) state.commands.push({ t: 'SEND', from: src.id, to: best.id, fraction, filter });
  }

  // Push the rear army forward.
  //
  // Sends are adjacency-only, so a camp ringed by your own sites accumulates an
  // army it can never use — 80 units sitting at cap while the front line holds
  // with 4. This is what rally points automate for a human player, and it is
  // the single biggest difference between a stalled game and a won one.
  for (const src of mine) {
    const d = front[src.id];
    if (d === undefined || d === 0) continue; // already on the line
    const garrison = total(src.garrison);
    const floor = src.kind === 'camp' ? HOME_FLOOR : 3;
    if (garrison <= floor + 3) continue;

    const forward = src.adj
      .map((id) => state.sites.find((x) => x.id === id))
      .filter((n) => n && n.owner === 'player' && front[n.id] < d)
      .sort((a, b) => total(a.garrison) - total(b.garrison))[0];
    if (!forward) continue;
    // The column carries everyone, riders included. A specialist that never
    // reaches the line is worth exactly as much as one you did not buy, and
    // adding a FASTER unit to a slow stack cannot slow it — `slowestSpeed` is a
    // MIN, so this is free.
    state.commands.push({
      t: 'SEND', from: src.id, to: forward.id,
      fraction: Math.min(0.75, (garrison - floor) / garrison), filter: COLUMN_FILTER,
    });
  }

  // Train rams once something nearby is too tough to crack with bodies alone.
  for (const s of mine) {
    if (s.kind !== 'stronghold' && s.kind !== 'camp') continue;
    const wantsSiege = s.adj.some((id) => {
      const t = state.sites.find((x) => x.id === id);
      return t && t.owner !== 'player' && t.hpMax > 200;
    });
    const want = wantsSiege && state.mods.player.unlockedUnits.includes('rams')
      ? 'rams' : 'militia';
    if (s.trainType !== want) state.commands.push({ t: 'TRAIN', site: s.id, unit: want });
  }

  // Build the country behind the line. Last, so the treasury it reads has
  // already been reasoned about by everything that spends from it.
  if (opts.upgrades !== false) upgradeTurn(state, front);
}

/**
 * Spend a realistic idle budget the way a player would: cheapest useful thing
 * first. Without this the harness tests an unupgraded player against later
 * regions, which is not a case the design claims is winnable.
 */
export function spendCrowns(meta, crowns, fielded = null) {
  meta.crowns += crowns;
  const useless = pointlessUnlocks(fielded);

  // A unit you have DECIDED to field is bought before the generic power, and
  // that ordering is load-bearing rather than cosmetic. Cheapest-affordable-first
  // drains the treasury into the six endless lines, and an unlock only ever gets
  // taken on the tick it happens to be the cheapest thing left — so at gallowmoor
  // the 400-crown outriders and 1200-crown halberds were bought while the
  // 1800-crown sappers never were, and a `--weights=sappers` run silently landed
  // ZERO sappers and reported the default army's win rate under their name.
  // Nobody decides to bring a siege-repair detachment and then spends the money
  // on a treasury level instead.
  for (const unit of fielded ?? []) {
    const id = UNLOCK_FOR[unit];
    if (!id) continue;
    const item = shopListing(meta).flatMap((g) => g.items).find((i) => i.id === id);
    if (item && item.affordable && item.level < item.maxLevel) buy(meta, id, null);
  }

  for (let guard = 0; guard < 400; guard++) {
    const affordable = shopListing(meta)
      .flatMap((g) => g.items)
      .filter((i) => i.affordable && i.level < i.maxLevel && !useless.has(i.id))
      .sort((a, b) => a.cost - b.cost);
    if (!affordable.length) break;
    buy(meta, affordable[0].id, null);
  }
  recalcIncome(meta, null);
}

/**
 * Unlocks that buy this run nothing, and therefore must not be bought.
 *
 * The bot shops CHEAPEST-AFFORDABLE-FIRST, so a cheap unlock is taken almost
 * immediately — and a specialist it does not field is 3,400 crowns that would
 * otherwise have been Arms and Treasury levels. Measured at n=64 the moment the
 * three were added to the shop, obsidian fell 47% -> 33% and ironcrown 52% ->
 * 38% with no change to any region, any unit stat, or the army actually landed.
 * That is a MEASUREMENT ARTEFACT, not a difficulty change, so the fix belongs
 * here rather than in the balance table.
 *
 * The rule is "buy what you can use", and `fielded` is what makes it a rule
 * rather than a hardcoded list. A `--weights` run that names outriders MUST buy
 * their unlock: `fitComposition` drops any unit missing from `unlocked`, so
 * without this the loadout would be silently discarded and the run would report
 * the default army's win rate under a specialist's name — the exact class of
 * false measurement this whole pass exists to close.
 */
const UNLOCK_FOR = Object.freeze({
  outriders: 'unlockOutriders', halberds: 'unlockHalberds', sappers: 'unlockSappers',
});

function pointlessUnlocks(fielded) {
  const out = new Set(Object.values(UNLOCK_FOR));
  for (const u of fielded ?? []) out.delete(UNLOCK_FOR[u]);
  return out;
}

/** The units a loadout actually asks for — the shop's reason to unlock them. */
export const fieldedUnits = (weights) =>
  (weights ? UNIT_IDS.filter((u) => (weights[u] ?? 0) > 0) : []);

/** A meta state for a player who has taken `conquered` and idled `idleMinutes`. */
export function metaFor(conquered, idleMinutes = 0, seed = 1, fielded = null) {
  const state = createState({ seed, now: 0 });
  for (const id of conquered) markConquered(state.meta, id, { now: 0, durationMs: 0 });
  refreshUnlocks(state.meta, null);
  recalcIncome(state.meta, null);
  if (idleMinutes > 0) {
    spendCrowns(state.meta, incomePerSec(state.meta) * idleMinutes * 60, fielded);
  }
  return state;
}

/**
 * Start one battle for that player. Exposed so a test can drive it tick by
 * tick and watch what the AI does, rather than only reading the verdict.
 *
 * `opts.weights` is a LOADOUT, and until it existed the harness could only ever
 * field one army. `buildBattleConfig` runs `options.composition` through
 * `fitComposition`, which reads the counts as RATIOS against whatever budget the
 * empire granted — so a weights object is a legitimate composition here, and
 * passing one exercises the same seam the pre-battle screen does rather than a
 * parallel path. Omitted, `distributeExpedition` spreads by
 * DEFAULT_COMPOSITION_WEIGHTS exactly as before: every balance number in
 * regions.data.js is measured on that branch and must stay on it.
 */
export function startRun(regionId, seed, conquered, idleMinutes = 0, opts = {}) {
  const state = metaFor(conquered, idleMinutes, seed, fieldedUnits(opts.weights));
  const config = buildBattleConfig(state.meta, regionId, [], generateBattleMap, {
    seed, composition: opts.weights ?? null,
  });
  return startBattle(config);
}

/** Run one battle to its end with the scripted player at the wheel. */
export function playOne(regionId, seed, conquered, idleMinutes = 0, opts = {}) {
  const battle = startRun(regionId, seed, conquered, idleMinutes, opts);
  const cap = battle.rules.hardCapTicks;
  let nextThink = 0;
  while (battle.status === 'running' && battle.tick < cap) {
    if (battle.tick >= nextThink) { playerTurn(battle, opts); nextThink = battle.tick + 20; }
    step(battle);
  }
  const mine = battle.sites.filter((x) => x.owner === 'player');
  const foeN = battle.sites.filter((x) => x.owner === 'enemy').length;
  // `topLevel` is reported so a caller can SEE the upgrade ladder being
  // exercised rather than trust that it was — the whole reason this bot's
  // balance numbers were wrong for so long is that nobody could.
  const topLevel = Math.max(0, ...mine.map((x) => x.level));
  return { status: battle.status, ticks: battle.tick, cap, mineN: mine.length, foeN, topLevel };
}
