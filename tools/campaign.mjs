#!/usr/bin/env node
// Headless virtual player that plays a whole continent, end to end, against the real game
// systems (world generation, meta progression/economy/upgrades, and the full battle sim +
// enemy AI + player bot) — no shortcuts, no stubs. Used to measure and tune the campaign
// pacing targets in the balance engineer's brief (docs/DESIGN.md §2-§5) and to demonstrate
// that upgrades matter (the --no-army ablation).
//
// Deterministic per seed: world generation is seeded, the battle sim has no Math.random, and
// this file itself never calls Math.random/Date.now — the only "clock" is `wallSec`, a plain
// number this file advances itself. Fast: a full ~28-region continent is a few seconds of
// wall-clock Node time (battles are simulated at a fixed 0.05s timestep, capped at 8 simulated
// minutes each; idle waits are computed analytically — see below — not stepped second by
// second).
//
// ---------------------------------------------------------------------------------------
// THE BUYING POLICY (human-like, not optimal — this is what a reasonably engaged idle player
// does, not a min-maxed solver). At every decision point the player has ONE current savings
// target: the cheapest upgrade in its current "pool" (see activePool below). It buys that
// target the instant it's affordable, which — because buying shifts the pool's cheapest
// member — in practice means it greedily buys everything it can afford, cheapest first, each
// time it stops to shop.
//
//   - Pool always contains: Recruitment, Steel, Armour, Muster (the "core four") and Taxes.
//     Buying the single cheapest of these five keeps the four army stats roughly level with
//     each other (their base costs/growth rates are close enough that "cheapest next level"
//     tracks "lowest current level") while also buying Taxes whenever ITS next level happens
//     to be the cheapest thing around — exactly the brief's "buy Taxes whenever it is the
//     cheapest thing overall".
//   - Rally (owned from the start) is always in the pool too, so its levels compete on the
//     same footing as the core five.
//   - Firestorm is added to the pool (so it can be unlocked) once the 3rd region has been
//     conquered ("unlock Firestorm after the 3rd conquest").
//   - Levy/Bulwark/Forced March are in the pool from the start ("later when affordable"): each
//     is simply not the cheapest thing until its unlock price is, so they unlock one at a time
//     in price order instead of as a lump.
//   - Once a power is UNLOCKED (level >= 1), further levels of it are only bought when they
//     are still cheaper than the core pool even after being penalised by POWER_SOFT_MULT
//     (2.2x). This is what makes "level powers occasionally" true: a power level only wins
//     the cheapest-target race when the core army/taxes options have gotten comparatively
//     expensive, not every cycle.
//   - `--no-army` removes Recruitment/Steel/Armour/Muster from the pool entirely (the
//     ablation the lead asked for: prove upgrades matter by starving the ones that move the
//     difficulty ratio's `power` term).
//
// TUTORIAL RULE: the very first conquest is always fought, never taken by surrender (the real
// tutorial teaches the fight; DESIGN §6 wants ~a minute of battle before the first victory).
//
// LEARNING FROM LOSSES: a region that beat us is not attacked again until its card ratio is
// RETRY_MARGIN (1.25x) better than it was at the loss - a person who lost at "Fair" waits for
// "Easy", they do not feed it the same army every minute.
//
// ATTACK POLICY: among frontier regions (meta's `frontier()`) whose current `difficulty()`
// label is Easy or Fair, attack the best VALUE target: regionIncome(region) / strength, with
// a preference bump for a region whose perk the player does not already hold any copy of
// (PERK_PREFERENCE_MULT) — "prefer perks the player lacks". A surrender-eligible target
// (ratio >= ECONOMY.surrenderRatio, and only once a first battle has been won) is conquered
// instantly with no battle. If nothing is
// Easy/Fair, the player waits: the wall clock jumps analytically to the moment the current
// savings target becomes affordable (income is constant across a wait, so this is exact, not
// an approximation), then shops again. A lost or timed-out battle never triggers an immediate
// identical retry: the loop always forces at least one more buy-or-wait step first ("the
// virtual player retries after buying more upgrades").
//
// Usage:
//   node tools/campaign.mjs [--seeds=1,2,3,4,5] [--verbose] [--json] [--no-army]
//                           [--maxRegions=N] [--offlineAt=N --offlineHours=H [--offlineDynasty=D]] [--intel=finisher|heavy]
//                           [--dynasties=N]   (plays N dynasties per seed with the stars earned; prints D1..DN times and waits)
//                           [--checkinHours=H] (a player who, whenever nothing is readable, leaves for H hours: the game's offline cap
//                                               pays them and they buy Treasury too; the report says how many check-ins a dynasty took)
// --offlineAt/--offlineHours is the welcome-back experiment: the player closes the game after conquest N and
// returns H hours later. The game's own offlineEarnings pays it (capped at ECONOMY.offlineCapHours + Treasury, at the
// prosperity levels held on leaving), everything affordable is bought at once, and the report says how far that got them.
// --intel=finisher|heavy adds the Scout and Sabotage policy (DESIGN §5.7): when no frontier region reads Easy or Fair,
// scout and sabotage one into Fair instead of buying the next upgrade. `finisher` only when that costs at most
// INTEL_FINISHER_FACTOR x the cheapest upgrade (a top-up); `heavy` whenever it works. The dominance check
// (docs/briefs/intel-hookup.md §8.7): finisher within about +-10% of the plain run, heavy clearly slower.
// The clock integrates income across prosperity level changes (DESIGN §5.6) and every battle feeds the crown
// tracker exactly as the battle scene does, so Swift / Unbroken rates and the bounty table come out of the same run.
// Scratch tools can set hooks.onConquest(state, world, timelineRow) to inspect the state after each conquest.
import { generateWorld } from '../game/world/generate.js';
import { hash32 } from '../game/core/rng.js';
import { createGame } from '../game/meta/state.js';
import { tickIncome, incomePerSec, regionIncome, offlineEarnings } from '../game/meta/economy.js';
import {
  playerBattleStats, enemyBattleStats, frontier, difficulty, conquer, perkTotals, foundDynasty,
} from '../game/meta/progression.js';
import { updateProsperity, nextProsperityChangeAt } from '../game/meta/prosperity.js';
import {
  trackerOf, trackBattle, evaluateBattle, awardCrowns, crownsForSurrender, parBandOf, crownCount,
} from '../game/meta/crowns.js';
import * as Intel from '../game/meta/intel.js';
import { INTEL } from '../game/config/intel.js';
import {
  UPGRADES, levelOf, upgradeCost, canBuy, buy,
} from '../game/meta/upgrades.js';
import { buildArena } from '../game/battle/arena.js';
import { createBattle, step, issue } from '../game/battle/sim.js';
import { think } from '../game/battle/ai.js';
import { decide } from '../game/battle/bot.js';
import { TICK_SEC } from '../game/config/battle.js';
import { ECONOMY } from '../game/config/meta.js';
import { formatDuration } from '../game/core/format.js';
import { pathToFileURL } from 'node:url';

// --- Tuning knobs for the VIRTUAL PLAYER (not game balance — see file header) -------------
const CORE_ARMY = ['recruitment', 'steel', 'armour', 'muster'];
const LATE_POWERS = ['bulwark', 'march', 'levy'];
const FIRESTORM_GATE_CONQUESTS = 3;
const POWER_SOFT_MULT = 2.2; // re-leveling an unlocked power must look this much cheaper to
                              // compete with the core pool — see "level powers occasionally"
const PERK_PREFERENCE_MULT = 1.3; // value bump for a perk the player holds zero copies of
const RETRY_MARGIN = 1.25; // after a loss, retry only once the ratio is this much better than at the loss
const CAP_SEC = 8 * 60; // battle timeout (spec: 8 simulated minutes = a loss)
const INTEL_FINISHER_FACTOR = 6; // --intel=finisher: buy scout+sabotage only when it costs at most this many of the cheapest upgrade
// A "wait" for the next affordable purchase can legitimately take a long time near the edge
// of what the player can reach — that's still forward progress, not a stall, as long as the
// wait eventually pays off. NO_PROGRESS_STALL_LIMIT is generous so those slow-but-working
// stretches get to finish; MAX_WALL_SEC (24h, well past the 4-7h whole-continent target) is a
// second, time-based backstop for the same "still working, just slow" case. A TRUE stall (the
// --no-army ablation, where nothing left in the pool ever moves the difficulty ratio again)
// ends when the pool has nothing left to buy or the 24 h backstop trips.
const NO_PROGRESS_STALL_LIMIT = 400;

/** Debug hook for scratch tools: called with (battle, region, timedOut) after every fought battle. */
export const hooks = { onBattleEnd: null, onConquest: null };
const MAX_WALL_SEC = 24 * 3600;
const MAX_LOOP_ITERATIONS = 4000; // absolute backstop so a broken policy can't hang forever

function bandFor(region) {
  if (region.isCapital) return 'capital';
  if (region.tier <= 2) return 'tier1-2';
  return 'mid';
}

// --- CLI -----------------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); // --no-army -> noArmy
  for (const a of argv) {
    const kv = a.match(/^--([\w-]+)=(.*)$/);
    if (kv) { out[camel(kv[1])] = kv[2]; continue; }
    const flag = a.match(/^--([\w-]+)$/);
    if (flag) out[camel(flag[1])] = true;
  }
  return out;
}

// --- Buying policy ---------------------------------------------------------------------------
function activePool(conquestCount, flags) {
  const ids = [];
  if (!flags.noArmy) ids.push(...CORE_ARMY);
  ids.push('taxes', 'rally');
  if (conquestCount >= FIRESTORM_GATE_CONQUESTS) ids.push('firestorm');
  ids.push(...LATE_POWERS); // no conquest gate: they simply are not the cheapest thing until they are affordable
  if (flags.checkinHours) ids.push('treasury'); // a player who leaves for hours buys the offline cap too
  return ids;
}

const POWER_ID_SET = new Set(['rally', 'firestorm', 'bulwark', 'march', 'levy']);

/** The single upgrade id the virtual player is currently saving toward. */
function cheapestTargetId(state, conquestCount, flags) {
  let best = null;
  let bestWeighted = Infinity;
  for (const id of activePool(conquestCount, flags)) {
    const def = UPGRADES[id];
    const level = levelOf(state, id);
    if (def.max != null && level >= def.max) continue;
    let weighted = upgradeCost(id, level);
    if (POWER_ID_SET.has(id) && level >= 1) weighted *= POWER_SOFT_MULT;
    if (weighted < bestWeighted - 1e-9) { bestWeighted = weighted; best = id; }
  }
  return best;
}

/** Buys the cheapest target repeatedly while affordable. Returns the purchases made. */
function buyingPass(state, conquestCount, flags, goldSpent) {
  const bought = [];
  for (;;) {
    const id = cheapestTargetId(state, conquestCount, flags);
    if (!id || !canBuy(state, id)) break;
    const cost = upgradeCost(id, levelOf(state, id));
    const level = buy(state, id);
    bought.push({ id, level, cost });
    goldSpent[id] = (goldSpent[id] || 0) + cost;
  }
  return bought;
}

/**
 * Advances the simulated clock by `sec`, integrating income across prosperity level changes (DESIGN §5.6):
 * income steps up mid-wait when a region reaches its next level, so the jump is split at each one.
 * Tenure runs on this same clock (`conquer` stamps `conqueredAt` with wallSec x 1000).
 */
function advanceClock(state, world, wallSecRef, sec) {
  let left = sec;
  for (let guard = 0; left > 1e-9 && guard < 256; guard++) {
    const nowMs = wallSecRef.sec * 1000;
    updateProsperity(state, world, nowMs);
    const change = nextProsperityChangeAt(state, world, nowMs); // ms, or null
    const step = change == null ? left : Math.min(left, Math.max(1e-6, (change - nowMs) / 1000));
    tickIncome(state, world, step);
    wallSecRef.sec += step;
    left -= step;
  }
  updateProsperity(state, world, wallSecRef.sec * 1000);
}

/** Waits (analytically, exactly) until `cost` gold is in hand. False when income is zero and gold is short. */
function waitUntilAffordable(state, world, wallSecRef, cost) {
  for (let guard = 0; guard < 256 && state.gold < cost - 1e-9; guard++) {
    const inc = incomePerSec(state, world);
    if (inc <= 1e-9) return false;
    const need = (cost - state.gold) / inc; // seconds at today's rate
    const nowMs = wallSecRef.sec * 1000;
    const change = nextProsperityChangeAt(state, world, nowMs);
    advanceClock(state, world, wallSecRef, change == null ? need : Math.min(need, Math.max(1e-6, (change - nowMs) / 1000)));
  }
  if (state.gold < cost && state.gold >= cost - 1e-6) state.gold = cost; // float dust from the analytic jump
  return state.gold >= cost - 1e-6;
}

/** Jumps the wall clock forward to the moment the current savings target is affordable, and
 * buys everything that then unlocks. No-ops (returns false) if nothing is left to buy for, or if
 * income is zero (both are stall conditions the caller handles). */
function waitForNextPurchase(state, world, conquestCount, flags, goldSpent, log, wallSecRef) {
  const id = cheapestTargetId(state, conquestCount, flags);
  if (!id) return false;
  const cost = upgradeCost(id, levelOf(state, id));
  const before = wallSecRef.sec;
  if (!waitUntilAffordable(state, world, wallSecRef, cost)) return false;
  const waitSec = wallSecRef.sec - before;
  if (waitSec > 0) log.push({ t: wallSecRef.sec, kind: 'wait', forId: id, waitSec });
  for (const b of buyingPass(state, conquestCount, flags, goldSpent)) {
    log.push({ t: wallSecRef.sec, kind: 'buy', ...b });
  }
  return true;
}

// --- Scout and Sabotage policy (DESIGN §5.7; docs/briefs/intel-hookup.md §8.6) -----------------------
/** Price and outcome of scouting `regionId` and sabotaging it `levels` times, on a clone of the state. */
function planIntel(state, world, regionId, levels) {
  const c = structuredClone(state);
  c.gold = 1e15;
  let spent = 0;
  if (!Intel.isScouted(c, regionId)) {
    spent += Intel.scoutCost(c, world, regionId);
    Intel.ensureIntel(c)[regionId] = { scouted: true, sabotage: 0 };
  }
  for (let l = Intel.sabotageLevel(c, regionId); l < levels; l += 1) {
    spent += Intel.sabotageCost(c, world, regionId);
    Intel.ensureIntel(c)[regionId] = { scouted: true, sabotage: l + 1 };
  }
  return { spent, diff: difficulty(c, world, regionId) };
}

/**
 * Intel is a WAIT-time decision (never an every-turn one): with no Easy/Fair frontier region, pick the cheapest
 * scout + sabotage plan that makes one readable. `finisher` only spends up to INTEL_FINISHER_FACTOR x the price
 * of the cheapest upgrade in the pool (a top-up for a region just past Fair); `heavy` always does.
 */
function pickIntelPlan(state, world, conquestCount, flags, lossRatio) {
  const fin = flags.intel === 'heavy' ? Infinity : INTEL_FINISHER_FACTOR;
  const tid = cheapestTargetId(state, conquestCount, flags);
  const upgradeNow = tid ? upgradeCost(tid, levelOf(state, tid)) : 0;
  let best = null;
  for (const regionId of frontier(state, world)) {
    const lost = lossRatio.get(regionId);
    for (let levels = 1; levels <= INTEL.sabotage.maxLevel; levels++) {
      if (levels <= Intel.sabotageLevel(state, regionId)) continue;
      const plan = planIntel(state, world, regionId, levels);
      if (plan.diff.label !== 'Easy' && plan.diff.label !== 'Fair') continue;
      if (lost !== undefined && plan.diff.ratio < lost * RETRY_MARGIN) continue;
      if (plan.spent > fin * upgradeNow) continue;
      if (!best || plan.spent < best.spent) best = { regionId, levels, spent: plan.spent };
      break; // the smaller number of steps that works is enough for this region
    }
  }
  return best;
}

/** Buys the plan with the real intel functions (gold is already in hand). */
function applyIntelPlan(state, world, plan, goldSpent) {
  const before = state.gold;
  if (!Intel.isScouted(state, plan.regionId)) Intel.scout(state, world, plan.regionId);
  while (Intel.sabotageLevel(state, plan.regionId) < plan.levels) {
    if (!Intel.sabotage(state, world, plan.regionId)) break;
  }
  goldSpent.intel = (goldSpent.intel || 0) + (before - state.gold);
}

// --- Attack target selection -----------------------------------------------------------------
// Ranks every Easy/Fair candidate best-value-first (income/strength, perk-lacking bump);
// the caller walks the list because the single best pick can occasionally be topologically
// unattackable (see attemptConquest's `unattackable` case) and needs a fallback.
function rankTargets(candidates, state, world) {
  const perkCounts = perkTotals(state, world).counts;
  const scored = candidates.map((c) => {
    const region = world.regions[c.regionId];
    const income = regionIncome(region);
    const strength = Math.max(1e-6, c.diff.strength);
    let score = income / strength;
    if (!perkCounts[region.perk]) score *= PERK_PREFERENCE_MULT;
    return { ...c, score };
  });
  scored.sort((a, b) => b.score - a.score || a.regionId - b.regionId);
  return scored;
}

// --- One battle attempt (or instant surrender) ------------------------------------------------
function attemptConquest(state, world, regionId, wallSecRef, battleDurations, forceBattle = false) {
  const diffAtAttack = difficulty(state, world, regionId);
  const region = world.regions[regionId];

  if (diffAtAttack.surrender && !forceBattle) {
    const { bounty } = conquer(state, world, regionId, wallSecRef.sec * 1000);
    const crowns = crownsForSurrender(); // a surrender earns Victory only (DESIGN §4.8)
    const award = awardCrowns(state, world, regionId, crowns, bounty);
    state.stats.surrenders += 1;
    return {
      won: true, surrendered: true, battleSec: 0, bounty, crowns, crownBonus: award.bonusGold, diffAtAttack, region,
      personality: world.factions[region.faction].personality,
    };
  }

  const player = playerBattleStats(state, world);
  const enemy = enemyBattleStats(world, state, regionId);
  let arena;
  try {
    arena = buildArena(world, state.owner, regionId, player, enemy);
  } catch {
    // Rare world-generation edge case (mirrors tools/balance.mjs's own real-world sweep):
    // `frontier()` treats two regions as adjacent whenever their graph-neighbour list says
    // so, but buildArena additionally needs an actual PASSABLE player-owned tile bordering
    // the target (e.g. two regions can be "neighbors" across an all-mountain edge). Never a
    // battle outcome — just try the next-best candidate this round.
    return { unattackable: true, region, regionId };
  }
  const battle = createBattle(arena, player, enemy);
  const tracker = trackerOf(battle); // crowns (DESIGN §4.8): fed after EVERY step, exactly as the battle scene does
  const botMemo = {};
  while (!battle.result && battle.t < CAP_SEC) {
    for (const cmd of think(battle, battle.t)) issue(battle, cmd);
    for (const cmd of decide(battle, battle.t, botMemo)) issue(battle, cmd);
    step(battle, TICK_SEC);
    trackBattle(tracker, battle);
  }
  const timedOut = !battle.result;
  if (hooks.onBattleEnd) hooks.onBattleEnd(battle, region, timedOut);
  const battleSec = timedOut ? CAP_SEC : battle.stats.durationSec;
  advanceClock(state, world, wallSecRef, battleSec);
  battleDurations.push({
    band: bandFor(region), sec: battleSec, timedOut, won: battle.result === 'win',
    ratio: diffAtAttack.ratio, label: diffAtAttack.label, tier: region.tier, personality: enemy.personality,
    capital: region.isCapital, sites: region.settlements.length, regionId,
  });

  if (!timedOut && battle.result === 'win') {
    const { bounty } = conquer(state, world, regionId, wallSecRef.sec * 1000);
    const { crowns } = evaluateBattle(tracker, battle, world, regionId, state);
    const award = awardCrowns(state, world, regionId, crowns, bounty); // pays the bonus, never the base bounty twice
    state.stats.battlesWon += 1; // unlocks surrender offers (DESIGN §5.3), as the game's own results screen does
    return {
      won: true, surrendered: false, battleSec, bounty, crowns, crownBonus: award.bonusGold, diffAtAttack, region, timedOut: false,
      personality: enemy.personality,
    };
  }
  return {
    won: false, surrendered: false, battleSec, diffAtAttack, region, timedOut,
  };
}

/** How many frontier regions the card shows as Easy/Fair right now, and how many are Deadly. */
function frontierReadout(state, world) {
  const out = { easyFair: 0, deadly: 0, total: 0, ratios: [] };
  for (const regionId of frontier(state, world)) {
    const d = difficulty(state, world, regionId);
    const label = d.label;
    out.ratios.push(d.ratio);
    out.total += 1;
    if (label === 'Easy' || label === 'Fair') out.easyFair += 1;
    if (label === 'Deadly') out.deadly += 1;
  }
  return out;
}

// --- Per-seed campaign ------------------------------------------------------------------------
/**
 * Plays one continent. `carry` = { state, world } continues a realm that already exists (a later dynasty, see
 * runDynasties); without it a fresh game starts on `generateWorld(seed)`. The simulated clock always starts at 0.
 */
export function runCampaign(seed, flags = {}, carry = null) {
  const world = carry ? carry.world : generateWorld(seed);
  const totalToConquer = Math.min(
    world.regions.length - 1,
    flags.maxRegions ? Number(flags.maxRegions) : Infinity,
  );
  const state = carry ? carry.state : createGame(seed, world, 0);
  const goldSpent = {};
  const timeline = [];
  const log = [];
  const battleDurations = [];
  const wallSecRef = { sec: 0 };
  let conquestCount = 0;
  let battlesWon = 0;
  let battlesLost = 0;
  let lastConquestWall = 0;
  let noProgress = 0;
  let stallReason = null;
  let offline = null;
  let checkins = 0;
  const lossRatio = new Map(); // region id -> the ratio the card showed when we last lost to it

  for (let iter = 0; iter < MAX_LOOP_ITERATIONS && conquestCount < totalToConquer; iter++) {
    if (wallSecRef.sec > (flags.checkinHours ? 90 * MAX_WALL_SEC : MAX_WALL_SEC)) {
      stallReason = `stalled: exceeded ${fmtSec(MAX_WALL_SEC)} of simulated wall-clock (well past the 4-7h whole-continent target) without finishing`;
      break;
    }
    for (const b of buyingPass(state, conquestCount, flags, goldSpent)) {
      log.push({ t: wallSecRef.sec, kind: 'buy', ...b });
    }

    const candidates = [];
    for (const regionId of frontier(state, world)) {
      const d = difficulty(state, world, regionId);
      if (d.label !== 'Easy' && d.label !== 'Fair') continue;
      // A region that just beat us is tougher than its card says: wait until it reads clearly
      // better than it did when we lost, instead of feeding it the same army again.
      const lost = lossRatio.get(regionId);
      if (lost !== undefined && d.ratio < lost * RETRY_MARGIN) continue;
      candidates.push({ regionId, diff: d });
    }

    let ranked;
    if (candidates.length > 0) {
      ranked = rankTargets(candidates, state, world);
    } else if (flags.checkinHours) {
      // A check-in player: nothing readable, so they close the game and come back in `checkinHours`. The game's own
      // offlineEarnings pays them up to the cap (ECONOMY.offlineCapHours + Treasury); everything affordable is bought on return.
      const awaySec = Number(flags.checkinHours) * 3600;
      state.lastSeen = wallSecRef.sec * 1000;
      offlineEarnings(state, world, state.lastSeen + awaySec * 1000);
      wallSecRef.sec += awaySec;
      updateProsperity(state, world, wallSecRef.sec * 1000);
      checkins += 1;
      continue;
    } else {
      // Nothing readable: with --intel, scout and sabotage a region into Fair instead of buying the next upgrade.
      const plan = flags.intel ? pickIntelPlan(state, world, conquestCount, flags, lossRatio) : null;
      if (plan && waitUntilAffordable(state, world, wallSecRef, plan.spent)) {
        applyIntelPlan(state, world, plan, goldSpent);
        log.push({ t: wallSecRef.sec, kind: 'intel', region: world.regions[plan.regionId].name, levels: plan.levels, cost: plan.spent });
        ranked = [{ regionId: plan.regionId }];
      } else {
        const progressed = waitForNextPurchase(state, world, conquestCount, flags, goldSpent, log, wallSecRef);
        noProgress += 1;
        if (!progressed || noProgress > NO_PROGRESS_STALL_LIMIT) {
          stallReason = !progressed
            ? 'no attackable frontier region and nothing left affordable to buy'
            : `stalled: ${noProgress} buy/wait iterations without a conquest`;
          break;
        }
        continue;
      }
    }
    let result = null;
    for (const cand of ranked) {
      const attempt = attemptConquest(state, world, cand.regionId, wallSecRef, battleDurations, conquestCount === 0 && state.stats.battlesWon === 0); // the tutorial fight: only ever the first battle
      if (attempt.unattackable) continue; // try the next-best candidate instead
      result = attempt;
      break;
    }
    if (!result) {
      // Every Easy/Fair candidate this round was topologically unattackable (see
      // attemptConquest) — treat exactly like "nothing attackable" and wait/shop instead.
      const progressed = waitForNextPurchase(state, world, conquestCount, flags, goldSpent, log, wallSecRef);
      noProgress += 1;
      if (!progressed || noProgress > NO_PROGRESS_STALL_LIMIT) {
        stallReason = !progressed
          ? 'no attackable frontier region and nothing left affordable to buy'
          : `stalled: ${noProgress} buy/wait iterations without a conquest`;
        break;
      }
      continue;
    }
    log.push({
      t: wallSecRef.sec,
      kind: result.won ? (result.surrendered ? 'surrender' : 'win') : (result.timedOut ? 'timeout' : 'lose'),
      region: result.region.name,
      label: result.diffAtAttack.label,
      ratio: result.diffAtAttack.ratio,
      battleSec: result.battleSec,
    });

    if (result.won) {
      battlesWon += result.surrendered ? 0 : 1;
      conquestCount += 1;
      noProgress = 0;
      const waitSec = Math.max(0, wallSecRef.sec - result.battleSec - lastConquestWall);
      timeline.push({
        n: conquestCount,
        region: result.region.name,
        tier: result.region.tier,
        faction: world.factions[result.region.faction].name,
        label: result.diffAtAttack.label,
        ratio: result.diffAtAttack.ratio,
        result: result.surrendered ? 'surrender' : 'win',
        battleSec: result.battleSec,
        wallSec: wallSecRef.sec,
        waitSec,
        // what the win paid and what a crown is worth against the next purchase (bounty table in the aggregate)
        bounty: result.bounty,
        crowns: result.crowns,
        crownsEarned: crownCount(result.crowns),
        crownBonus: result.crownBonus,
        parBand: parBandOf(world, result.region.id),
        personality: result.personality ?? world.factions[result.region.faction].personality,
        income: incomePerSec(state, world),
        nextUpgradeCost: (() => { const tid = cheapestTargetId(state, conquestCount, flags); return tid ? upgradeCost(tid, levelOf(state, tid)) : null; })(),
      });
      // The player's view at the moment of victory (before shopping) and once the bounty and a
      // pass through the shop are spent: what the world screen would show right after the win.
      const before = frontierReadout(state, world);
      for (const b of buyingPass(state, conquestCount, flags, goldSpent)) log.push({ t: wallSecRef.sec, kind: 'buy', ...b });
      const after = frontierReadout(state, world);
      Object.assign(timeline[timeline.length - 1], {
        frontier: before.total, easyFairBefore: before.easyFair, easyFairAfter: after.easyFair, deadlyAfter: after.deadly,
        // the three best frontier ratios once the shopping is done (how far the next fight is from Fair)
        nextRatios: after.ratios.sort((a, b) => b - a).slice(0, 3).map((r) => +r.toFixed(2)),
      });
      if (hooks.onConquest) hooks.onConquest(state, world, timeline[timeline.length - 1]);
      if (flags.offlineAt && Number(flags.offlineAt) === conquestCount && state.dynasty.level === Number(flags.offlineDynasty || 1)) {
        // Welcome-back experiment: the player closes the game here and returns after `offlineHours`. The game's own
        // rule pays it: offlineEarnings caps the gold at ECONOMY.offlineCapHours (+ Treasury) and uses the prosperity
        // levels at departure; the levels gained while away are credited after (DESIGN §5.6).
        const awaySec = Number(flags.offlineHours || 3) * 3600;
        state.lastSeen = wallSecRef.sec * 1000;
        const off = offlineEarnings(state, world, state.lastSeen + awaySec * 1000);
        wallSecRef.sec += awaySec;
        updateProsperity(state, world, wallSecRef.sec * 1000);
        const spent = buyingPass(state, conquestCount, flags, goldSpent);
        offline = { atConquest: conquestCount, awaySec, paidSec: off.seconds, goldGained: off.gold, purchases: spent.length, returnedAtSec: wallSecRef.sec, easyFairOnReturn: frontierReadout(state, world).easyFair };
        for (const b of spent) log.push({ t: wallSecRef.sec, kind: 'buy', ...b });
        lastConquestWall = wallSecRef.sec;
      }
      lastConquestWall = wallSecRef.sec;
    } else {
      battlesLost += 1;
      noProgress += 1;
      lossRatio.set(result.region.id, result.diffAtAttack.ratio);
      // Forced progress: never let the next loop iteration re-attack the same unchanged
      // fight — buy (or wait-then-buy) at least once first.
      waitForNextPurchase(state, world, conquestCount, flags, goldSpent, log, wallSecRef);
      if (noProgress > NO_PROGRESS_STALL_LIMIT) {
        stallReason = `stalled: ${noProgress} buy/wait/attempt iterations without a conquest`;
        break;
      }
    }
  }

  const summary = summarize({
    world, timeline, log, battleDurations, goldSpent, battlesWon, battlesLost,
    conquestCount, totalToConquer, wallSec: wallSecRef.sec, stallReason,
  });
  const result = {
    seed, timeline, log, summary, stallReason, conquestCount, totalToConquer, battleDurations, offline,
    dynasty: state.dynasty.level, stars: state.dynasty.stars, checkins,
  };
  Object.defineProperty(result, 'endState', { value: { state, world }, enumerable: false }); // for runDynasties; not in --json
  return result;
}

/**
 * Plays `count` dynasties in a row exactly as the game does (DESIGN §5.4): when the continent is whole, foundDynasty
 * with a freshly generated, larger world (regionsPerDynasty), the stars earned so far, tougher enemies
 * (enemyMultPerDynasty), upgrades and gold reset, lifetime stats kept (so surrender is open from the first minute).
 * Returns one runCampaign result per dynasty; a dynasty that stalls ends the run.
 */
export function runDynasties(seed, count, flags = {}) {
  const out = [];
  let carry = null;
  for (let level = 1; level <= count; level++) {
    const r = runCampaign(seed, flags, carry);
    out.push(r);
    if (r.stallReason || level === count) break;
    const { state } = r.endState;
    const newSeed = hash32(seed, 'dynasty', level + 1);
    const world = generateWorld(newSeed, { dynasty: state.dynasty.level + 1 });
    const next = foundDynasty(state, newSeed, world);
    if (!next) break;
    carry = { state: next, world };
  }
  return out;
}

// --- Summary ------------------------------------------------------------------------------
function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function milestoneWall(timeline, n, totalToConquer) {
  const target = n === 'all' ? totalToConquer : n;
  const row = timeline.find((r) => r.n === target);
  return row ? row.wallSec : null;
}

/** Victory / Swift / Unbroken rates over the regions won in battle (surrenders earn Victory only and are counted apart). */
function crownStats(timeline) {
  const blank = () => ({ n: 0, swift: 0, unbroken: 0 });
  const out = { overall: blank(), byBand: {}, byPersonality: {}, surrenders: 0 };
  for (const r of timeline) {
    if (r.result === 'surrender') { out.surrenders += 1; continue; }
    const rows = [out.overall, (out.byBand[r.parBand] = out.byBand[r.parBand] || blank()), (out.byPersonality[r.personality] = out.byPersonality[r.personality] || blank())];
    for (const row of rows) {
      row.n += 1;
      if (r.crowns.swift) row.swift += 1;
      if (r.crowns.unbroken) row.unbroken += 1;
    }
  }
  return out;
}

function summarize({
  timeline, log, battleDurations, goldSpent, battlesWon, battlesLost, conquestCount, totalToConquer, wallSec, stallReason,
}) {
  const bands = ['tier1-2', 'mid', 'capital'];
  const byBand = {};
  for (const band of bands) {
    const secs = battleDurations.filter((d) => d.band === band && !d.timedOut).map((d) => d.sec);
    byBand[band] = { medianSec: median(secs), n: secs.length };
  }
  const longestWait = timeline.reduce((max, r) => Math.max(max, r.waitSec), 0);
  // The feel of the upgrade drip: seconds between consecutive purchases (a stretch with nothing
  // to buy AND nothing to conquer is the dead time the pacing brief forbids).
  const early = timeline.filter((r) => r.n <= 5 && r.frontier > 0);
  const allDeadlyEarly = early.filter((r) => r.easyFairAfter === 0).map((r) => r.n);
  const buyTimes = log.filter((e) => e.kind === 'buy').map((e) => e.t);
  let longestPurchaseGap = 0;
  for (let i = 1; i < buyTimes.length; i++) longestPurchaseGap = Math.max(longestPurchaseGap, buyTimes[i] - buyTimes[i - 1]);
  const purchases = buyTimes.length;
  // Outcome by the label the card showed when the fight started (the calibration check).
  const byLabel = {};
  for (const e of log) {
    if (e.kind !== 'win' && e.kind !== 'lose' && e.kind !== 'timeout') continue;
    const row = (byLabel[e.label] = byLabel[e.label] || { n: 0, won: 0 });
    row.n += 1;
    if (e.kind === 'win') row.won += 1;
  }
  const timeouts = battleDurations.filter((d) => d.timedOut).length;
  const totalBattles = battlesWon + battlesLost;

  return {
    milestones: {
      first: milestoneWall(timeline, 1, totalToConquer),
      five: milestoneWall(timeline, 5, totalToConquer),
      ten: milestoneWall(timeline, 10, totalToConquer),
      twenty: milestoneWall(timeline, 20, totalToConquer),
      all: conquestCount >= totalToConquer ? milestoneWall(timeline, 'all', totalToConquer) : null,
    },
    conquestCount,
    totalToConquer,
    finalWallSec: wallSec,
    winRate: totalBattles > 0 ? battlesWon / totalBattles : null,
    battlesWon,
    battlesLost,
    timeouts,
    longestWait,
    longestPurchaseGap,
    earlyNoReachable: allDeadlyEarly,
    purchases,
    byLabel,
    byBand,
    crowns: crownStats(timeline),
    goldSpent,
    stallReason,
  };
}

// --- Printing --------------------------------------------------------------------------------
function fmtSec(sec) {
  return sec == null ? 'n/a' : formatDuration(sec);
}

function printLogEntry(e) {
  if (e.kind === 'buy') {
    console.log(`  [${fmtSec(e.t)}] buy ${e.id} -> level ${e.level} (${e.cost.toFixed(0)}g)`);
  } else if (e.kind === 'wait') {
    console.log(`  [${fmtSec(e.t)}] wait ${fmtSec(e.waitSec)} for ${e.forId}`);
  } else {
    console.log(`  [${fmtSec(e.t)}] ${e.kind} ${e.region ?? ''} label=${e.label ?? ''} ratio=${(e.ratio ?? 0).toFixed(2)} battleSec=${(e.battleSec ?? 0).toFixed(0)}`);
  }
}

function printSeedReport(r, flags) {
  console.log(`\n=== seed ${r.seed}: ${r.conquestCount}/${r.totalToConquer} regions conquered ===`);
  if (r.stallReason) console.log(`STALLED: ${r.stallReason}`);

  if (flags.verbose) {
    console.log('\n-- log --');
    for (const e of r.log) printLogEntry(e);
  }

  console.log('\n-- timeline --');
  console.log('   n  region                 tier  faction           label     ratio  result      battleSec  wallClock   wait  frontier E/F (win, after shop)');
  for (const row of r.timeline) {
    console.log(
      `${String(row.n).padStart(4)}  ${row.region.padEnd(22)} ${String(row.tier).padStart(3)}   `
      + `${row.faction.padEnd(16)}  ${row.label.padEnd(8)}  ${row.ratio.toFixed(2).padStart(5)}  `
      + `${row.result.padEnd(10)}  ${fmtSec(row.battleSec).padStart(9)}  ${fmtSec(row.wallSec).padStart(9)}  ${fmtSec(row.waitSec).padEnd(7)}  ${row.easyFairBefore}/${row.easyFairAfter} of ${row.frontier}`,
    );
  }

  const s = r.summary;
  console.log('\n-- summary --');
  console.log(`  time to 1st conquest:  ${fmtSec(s.milestones.first)}`);
  console.log(`  time to 5 regions:     ${fmtSec(s.milestones.five)}`);
  console.log(`  time to 10 regions:    ${fmtSec(s.milestones.ten)}`);
  console.log(`  time to 20 regions:    ${fmtSec(s.milestones.twenty)}`);
  console.log(`  time to whole continent: ${fmtSec(s.milestones.all)}`);
  console.log(`  battle win rate: ${s.winRate == null ? 'n/a' : `${(s.winRate * 100).toFixed(0)}%`} (${s.battlesWon}W/${s.battlesLost}L, ${s.timeouts} timeouts)`);
  console.log(`  longest wait between conquests: ${fmtSec(s.longestWait)}; longest gap between purchases: ${fmtSec(s.longestPurchaseGap)} (${s.purchases} purchases)`);
  console.log('  median battle length by band:');
  for (const band of ['tier1-2', 'mid', 'capital']) {
    const b = s.byBand[band];
    console.log(`    ${band.padEnd(8)}: ${fmtSec(b.medianSec)} (n=${b.n})`);
  }
  console.log('  gold spent by upgrade:');
  for (const [id, gold] of Object.entries(s.goldSpent).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${id.padEnd(12)}: ${gold.toFixed(0)}g`);
  }
}

function aggregate(results) {
  // A milestone a seed never reached counts as "never" (Infinity) so a stalled seed drags the
  // median honestly instead of vanishing from it.
  const pick = (fn) => median(results.map((r) => fn(r) ?? Infinity));
  const range = (fn) => {
    const xs = results.map((r) => fn(r) ?? Infinity);
    return { min: Math.min(...xs), max: Math.max(...xs) };
  };
  let totalWon = 0;
  let totalLost = 0;
  const pooled = { 'tier1-2': [], mid: [], capital: [] };
  const byLabel = {};
  for (const r of results) {
    totalWon += r.summary.battlesWon;
    totalLost += r.summary.battlesLost;
    for (const d of r.battleDurations) if (d.won && !d.timedOut) pooled[d.band].push(d.sec);
    for (const [label, row] of Object.entries(r.summary.byLabel)) {
      const t = (byLabel[label] = byLabel[label] || { n: 0, won: 0 });
      t.n += row.n;
      t.won += row.won;
    }
  }
  const keys = ['first', 'five', 'ten', 'twenty', 'all'];
  const milestones = {};
  for (const k of keys) milestones[k] = { median: pick((r) => r.summary.milestones[k]), ...range((r) => r.summary.milestones[k]) };
  return {
    milestones,
    medianLongestWait: pick((r) => r.summary.longestWait),
    worstLongestWait: Math.max(...results.map((r) => r.summary.longestWait)),
    medianLongestPurchaseGap: pick((r) => r.summary.longestPurchaseGap),
    overallWinRate: (totalWon + totalLost) > 0 ? totalWon / (totalWon + totalLost) : null,
    pooledBandMedian: Object.fromEntries(Object.entries(pooled).map(([k, v]) => [k, { medianSec: median(v), n: v.length }])),
    byLabel,
    crowns: (() => {
      const blank = () => ({ n: 0, swift: 0, unbroken: 0 });
      const out = { overall: blank(), byBand: {}, byPersonality: {}, surrenders: 0 };
      const add = (dst, src) => { dst.n += src.n; dst.swift += src.swift; dst.unbroken += src.unbroken; };
      for (const r of results) {
        const c = r.summary.crowns;
        add(out.overall, c.overall);
        out.surrenders += c.surrenders;
        for (const [k, v] of Object.entries(c.byBand)) add((out.byBand[k] = out.byBand[k] || blank()), v);
        for (const [k, v] of Object.entries(c.byPersonality)) add((out.byPersonality[k] = out.byPersonality[k] || blank()), v);
      }
      return out;
    })(),
    // What a win pays against what the player is saving for, at conquests 1, 5, 15 and 25 (medians over seeds).
    bountyTable: [1, 5, 15, 25].map((n) => {
      const rows = results.map((r) => r.timeline.find((t) => t.n === n && t.result !== 'surrender')).filter(Boolean);
      return {
        n,
        seeds: rows.length,
        bounty: median(rows.map((t) => t.bounty)),
        crownBonus: median(rows.map((t) => t.crownBonus)),
        nextUpgradeCost: median(rows.map((t) => t.nextUpgradeCost).filter((v) => v != null)),
        income: median(rows.map((t) => t.income)),
      };
    }),
    intelSpent: median(results.map((r) => r.summary.goldSpent.intel || 0)),
    earlyReadout: (() => {
      const rows = [];
      for (const r of results) for (const t of r.timeline) if (t.n <= 5 && t.frontier > 0) rows.push(t);
      const per = {};
      for (let n = 1; n <= 5; n++) {
        const rs = rows.filter((t) => t.n === n);
        per[n] = { seeds: rs.length, noneBefore: rs.filter((t) => t.easyFairBefore === 0).length, noneAfter: rs.filter((t) => t.easyFairAfter === 0).length, median: median(rs.map((t) => t.easyFairAfter)) };
      }
      return per;
    })(),
    stalls: results.filter((r) => r.stallReason).map((r) => ({ seed: r.seed, at: r.conquestCount, reason: r.stallReason })),
  };
}

const fmtMaybe = (sec) => (sec == null || !Number.isFinite(sec) ? 'never' : formatDuration(sec));

function printAggregate(agg, seeds) {
  console.log(`
=== aggregate across seeds ${seeds.join(',')} ===`);
  const names = { first: '1st conquest', five: '5 regions', ten: '10 regions', twenty: '20 regions', all: 'whole continent' };
  for (const [k, label] of Object.entries(names)) {
    const m = agg.milestones[k];
    console.log(`  median time to ${label.padEnd(16)} ${fmtMaybe(m.median).padStart(9)}   (range ${fmtMaybe(m.min)} .. ${fmtMaybe(m.max)})`);
  }
  console.log(`  overall battle win rate: ${agg.overallWinRate == null ? 'n/a' : `${(agg.overallWinRate * 100).toFixed(0)}%`}`);
  console.log(`  median longest wait between conquests: ${fmtMaybe(agg.medianLongestWait)}   (worst seed ${fmtMaybe(agg.worstLongestWait)})`);
  console.log(`  median longest gap between purchases:  ${fmtMaybe(agg.medianLongestPurchaseGap)}`);
  console.log('  median WINNING battle length, pooled over seeds:');
  for (const [band, v] of Object.entries(agg.pooledBandMedian)) console.log(`    ${band.padEnd(8)}: ${fmtMaybe(v.medianSec)} (n=${v.n})`);
  console.log('  fights by the label shown at attack:');
  for (const label of ['Easy', 'Fair', 'Hard', 'Deadly']) {
    const t = agg.byLabel[label];
    if (t) console.log(`    ${label.padEnd(7)} ${String(t.n).padStart(3)} fights, ${((t.won / t.n) * 100).toFixed(0)}% won`);
  }
  const pct = (x, n) => (n > 0 ? `${Math.round((100 * x) / n)}%` : 'n/a');
  const c = agg.crowns;
  console.log(`  crowns over the ${c.overall.n} regions won in battle (Victory is certain; ${c.surrenders} surrenders excluded): Swift ${pct(c.overall.swift, c.overall.n)}, Unbroken ${pct(c.overall.unbroken, c.overall.n)}`);
  for (const [k, v] of Object.entries(c.byBand)) console.log(`    band ${k.padEnd(8)} n=${String(v.n).padStart(3)}  Swift ${pct(v.swift, v.n).padStart(4)}  Unbroken ${pct(v.unbroken, v.n).padStart(4)}`);
  for (const [k, v] of Object.entries(c.byPersonality)) console.log(`    vs ${k.padEnd(10)} n=${String(v.n).padStart(3)}  Swift ${pct(v.swift, v.n).padStart(4)}  Unbroken ${pct(v.unbroken, v.n).padStart(4)}`);
  console.log('  bounty against the next upgrade (median over seeds; a crown is +25% of the bounty):');
  for (const b of agg.bountyTable) {
    if (!b.seeds) continue;
    const up = b.nextUpgradeCost || 1;
    console.log(`    conquest ${String(b.n).padStart(2)}: bounty ${Math.round(b.bounty)}g (${(b.bounty / up).toFixed(1)} upgrades), crowns earned paid ${Math.round(b.crownBonus)}g, next upgrade ${Math.round(up)}g, income ${b.income.toFixed(1)}/s`);
  }
  if (agg.intelSpent) console.log(`  median gold spent on scouting and sabotage: ${Math.round(agg.intelSpent)}g`);
  console.log('  frontier regions readable as Easy/Fair right after conquest n (seeds with NONE before / after shopping, median after):');
  for (const [n, v] of Object.entries(agg.earlyReadout)) console.log(`    after conquest ${n}: none before shop ${v.noneBefore}/${v.seeds}, none after shop ${v.noneAfter}/${v.seeds}, median ${v.median}`);
  if (agg.stalls.length) {
    console.log('  STALLS:');
    for (const st of agg.stalls) console.log(`    seed ${st.seed} at region ${st.at}: ${st.reason}`);
  }
}

/** The welcome-back experiment (--offlineAt=N --offlineHours=H): what a long absence buys. */
function printOffline(results, flags) {
  console.log(`
-- welcome back: away ${flags.offlineHours || 3} h after conquest ${flags.offlineAt} --`);
  for (const r of results) {
    const o = r.offline;
    if (!o) { console.log(`  seed ${r.seed}: never reached conquest ${flags.offlineAt}`); continue; }
    const after = (min) => r.timeline.filter((t) => t.wallSec > o.returnedAtSec && t.wallSec <= o.returnedAtSec + min * 60).length;
    console.log(`  seed ${r.seed}: gold on return ${Math.round(o.goldGained)} (paid for ${(o.paidSec / 3600).toFixed(1)} h of ${(o.awaySec / 3600).toFixed(1)} h away), ${o.purchases} purchases at once, ${o.easyFairOnReturn} Easy/Fair regions; conquered in the next 10 / 30 / 60 min: ${after(10)} / ${after(30)} / ${after(60)} (of ${r.totalToConquer - o.atConquest} left)`);
  }
}

/** --dynasties=N: per-seed whole-continent time of each dynasty, longest waits, and the ratios to dynasty 1. */
function printDynasties(seeds, flags) {
  const n = Number(flags.dynasties);
  const all = seeds.map((seed) => runDynasties(seed, n, flags));
  const hrs = (sec) => (sec == null ? 'never' : `${(sec / 3600).toFixed(2)}h`);
  console.log(`
=== ${n} dynasties per seed (stars earned, real world regeneration) ===`);
  console.log('  seed  ' + Array.from({ length: n }, (_, d) => `D${d + 1}: regions, all, longest wait`).join('   |   '));
  for (let i = 0; i < seeds.length; i++) {
    console.log(`  ${String(seeds[i]).padStart(4)}  ` + all[i].map((r) => `${String(r.totalToConquer).padStart(2)}  ${hrs(r.summary.milestones.all).padStart(6)}  ${String(Math.round(r.summary.longestWait / 60)).padStart(3)}m${r.stallReason ? ' STALL' : ''}`).join('   |   '));
  }
  for (let d = 0; d < n; d++) {
    const times = all.map((a) => (a[d] ? a[d].summary.milestones.all : null));
    const waits = all.map((a) => (a[d] ? a[d].summary.longestWait / 60 : null)).filter((w) => w != null);
    const d1 = median(all.map((a) => a[0].summary.milestones.all ?? Infinity));
    const dm = median(times.map((t) => t ?? Infinity));
    console.log(`  D${d + 1}: median ${hrs(Number.isFinite(dm) ? dm : null)} (${Number.isFinite(dm) && Number.isFinite(d1) ? (dm / d1).toFixed(2) : '-'}x of D1); longest wait over 40 min on ${waits.filter((w) => w > 40).length} of ${waits.length} seeds, worst ${Math.round(Math.max(...waits))} min`);
  }
}

async function main() {
  const t0 = Date.now();
  const flags = parseArgs(process.argv.slice(2));
  const seeds = (flags.seeds ? String(flags.seeds).split(',') : ['1', '2', '3', '4', '5']).map(Number);

  if (Number(flags.dynasties) > 1) { printDynasties(seeds, flags); return; }
  const results = seeds.map((seed) => runCampaign(seed, flags));

  if (flags.json) {
    console.log(JSON.stringify({ results, aggregate: aggregate(results) }, null, 2));
    return;
  }

  for (const r of results) printSeedReport(r, flags);
  if (results.length > 1) printAggregate(aggregate(results), seeds);
  if (flags.offlineAt) printOffline(results, flags);
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}s wall-clock to simulate)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
