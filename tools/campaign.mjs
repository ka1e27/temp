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
// REGION WORKS (DESIGN §5.8, docs/briefs/works-hookup.md §8). `--works=normal` (the default) is how an engaged player builds: a
// Barracks (then Stables) in every owned region that touches enemy land, a Market in every region that does not, level I
// only, plus a level II/III whenever it costs at most WORKS_UPGRADE_SEC seconds of the realm's income. A Work is one more
// item in the savings pool: the cheapest of (core upgrades, wanted Works) is the next target, bought the instant it is
// affordable. `--works=heavy` is the dominance check: every Work of every useful kind at every level, before ANY other
// purchase (it should land within about +-15% of normal). `--works=none` builds nothing (clearly slower, not stalled).
//
// THE LIVING FRONTIER (DESIGN §10; on unless --raids=off). The campaign clock is active play, so the game's own raid scheduler
// (meta/frontier.js tickFrontier) runs along it in FRONTIER.checkSec chunks. A person watches ONE battle at a time (DESIGN §10.5):
// a raid that arrives while the player idles through a wait is defended IN PERSON (bot.js decideDefense: the Steward's rules at a
// person's 3 s cadence), unless another in-person defense is still running; one that arrives during the player's own attack battle,
// or overlaps an in-person defense, is left to the Steward (the Militia Captain, stewardDecide 'captain'). A won defense pays defenseReward, a lost
// one is occupied (occupy). Occupied regions are retaken with priority (RETAKE_PREFERENCE x the value score) through conquer, which
// restores them. FORTIFICATIONS (--forts=normal, the default; heavy; none): Walls then an Arrow Tower at level I in every owned
// region that borders a rival and is threatened (its unattended odds read under FORT_THREAT, or it has been raided), upgraded to II when that costs at most FORT_UPGRADE_SEC seconds of income; one more item in the
// savings pool, like Works. Away (--checkinHours, --offlineAt) runs resolveAway after offlineEarnings, exactly as the game does.
//
// GENERALS AND RENOWN (DESIGN §10.11, §10.12; off with --generals=off): every attack is commanded by the best free General
// (bestFreeGeneral), every raid by the nearest free one (nearestFreeGeneral; the attack's General is busy while it fights), the
// Militia Captain when none is free. Their passives and abilities apply in person (the bots use abilityAdvice) and their own
// steward fights unattended raids (stewardDecide with commanderStyle). settleCommander gives XP and wounds; skill picks take option
// 0. Renown comes from the game's own hooks; it is spent (--renown=off to keep it) on a Festival for the richest owned region whose
// prosperity is not at the top, then Training the Marshal, whichever is affordable first, with a heal for a wounded General first.
//
// GOALS AND RIVALS (PLAN-PHASE4): the Conquest Streak and Deeds work inside the game's own meta functions. The Bounty Board is
// taken as a player takes it with no special play (off with --bounties=off): ensureBounties along the clock, every on* hook at
// the matching moment (battles through crowns.js battleSummaryFor, conquests, prosperity, fortifications) and claimCompleted at
// once; nothing is rerolled. Vendettas arrive through tickFrontier and are fought exactly like raids (in person or by the
// steward); every defense is settled with defenseReward (a lost Vendetta resets its Grudge), and a lost attack breaks the streak.
// --dynasties=N prints a goals line per dynasty (contracts, best streak, Vendettas, Trophies, deed tiers).
//
// Usage:
//   node tools/campaign.mjs [--seeds=1,2,3,4,5] [--works=normal|heavy|none] [--verbose] [--json] [--no-army]
//                           [--maxRegions=N] [--offlineAt=N --offlineHours=H [--offlineDynasty=D]] [--intel=finisher|heavy]
//                           [--dynasties=N]   (plays N dynasties per seed with the stars earned; prints D1..DN times and waits)
//                           [--archipelago=force|off] (PLAN-PHASE12: every founding from dynasty 3 an archipelago with the Sea Kings, or none)
//                           [--policy=human [--minutes=60] [--shop=three|bot3|cheapest|optimal] [--labels=card|plain] [--patience=strict] [--trace]]
//                                              (PLAN-PHASE11: the human-paced first hour, per seed and medians; see runHumanHour; default seeds 1-8)
//                           [--policy=human --dynasties=N [--crown=7] [--legacy=greedy] [--edict=first]]
//                                              (PLAN-PHASE14: whole dynasties at a person's pace with a person's Legacy and Edict; default seeds 1-12;
//                                               tools/_p14pace.mjs forks D7 and the Crown from one D6 realm and tabulates)
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
  playerBattleStats, enemyBattleStats, frontier, attackableFrontier, enemyDepth, difficulty, conquer, perkTotals, foundDynasty,
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
import * as Works from '../game/meta/works.js';
import { buildArena } from '../game/battle/arena.js';
import { createBattle, step, issue } from '../game/battle/sim.js';
import { think } from '../game/battle/ai.js';
import { decide } from '../game/battle/bot.js';
import { TICK_SEC, patienceFor } from '../game/config/battle.js';
import { ECONOMY } from '../game/config/meta.js';
import { PLAYER_FACTION } from '../game/meta/state.js';
import { formatDuration } from '../game/core/format.js';
import { pathToFileURL } from 'node:url';
import * as Frontier from '../game/meta/frontier.js';
import * as Forts from '../game/meta/forts.js';
import { decideDefense } from '../game/battle/bot.js';
import { stewardDecide } from '../game/battle/steward.js';
import { FRONTIER } from '../game/config/frontier.js';
import * as Generals from '../game/meta/generals.js';
import * as Renown from '../game/meta/renown.js';
import * as Events from '../game/meta/events.js';
import * as Bounties from '../game/meta/bounties.js';
import { battleSummaryFor } from '../game/meta/crowns.js';
import { onStreakBroken } from '../game/meta/streak.js';
import { deedProgress } from '../game/meta/deeds.js';
import { edictChoices, worldOptsFor } from '../game/meta/edicts.js';
import { rivalsFor } from '../game/meta/rivals.js';
import { ARCHIPELAGO } from '../game/config/sea.js';
import * as Quick from '../game/meta/quick.js';
import { militiaFill } from '../game/meta/militia.js';
import { legacyPointsForFounding, legacyInfo, legacyTree } from '../game/meta/legacy.js';
import { resetRegions } from '../game/meta/state.js';
import * as Boons from '../game/meta/boons.js';
import { relicAt } from '../game/meta/relics.js';
import { BOON_LIST } from '../game/config/boons.js';
import { bestValueUpgrade } from '../game/app/bestValue.js';
import { tickUnrest, calmUnrest } from '../game/meta/unrest.js';

// --- Tuning knobs for the VIRTUAL PLAYER (not game balance — see file header) -------------
const CORE_ARMY = ['recruitment', 'steel', 'armour', 'muster'];
const LATE_POWERS = ['bulwark', 'march', 'levy'];
const FIRESTORM_GATE_CONQUESTS = 3;
const POWER_SOFT_MULT = 2.2; // re-leveling an unlocked power must look this much cheaper to
                              // compete with the core pool — see "level powers occasionally"
const PERK_PREFERENCE_MULT = 1.3; // value bump for a perk the player holds zero copies of
const RETRY_MARGIN = 1.25; // after a loss, retry only once the ratio is this much better than at the loss
// A battle that outlasts the band's patience (config/battle.js PATIENCE_SEC) is a loss: the player retreats.
const INTEL_FINISHER_FACTOR = 6; // --intel=finisher: buy scout+sabotage only when it costs at most this many of the cheapest upgrade
// A "wait" for the next affordable purchase can legitimately take a long time near the edge
// of what the player can reach — that's still forward progress, not a stall, as long as the
// wait eventually pays off. NO_PROGRESS_STALL_LIMIT is generous so those slow-but-working
// stretches get to finish; MAX_WALL_SEC (24h, well past the 4-7h whole-continent target) is a
// second, time-based backstop for the same "still working, just slow" case. A TRUE stall (the
// --no-army ablation, where nothing left in the pool ever moves the difficulty ratio again)
// ends when the pool has nothing left to buy or the 24 h backstop trips.
const NO_PROGRESS_STALL_LIMIT = 400;

const TYPE_PREFERENCE = { goldmine: 1.6, monastery: 1.3, bandit: 1.1, ruins: 1.1, dragon: 1 }; // value score x this by region type
const RELIC_PREFERENCE = 1.4; // a region holding a Relic (PLAN-PHASE7 §7B): the value score x this, the route choice a player makes
const BOON_AHEAD_WINS = 5;   // the bot takes a Cursed Boon only when its last this-many battles were all won (PLAN-PHASE7: "unless ahead")
const RETAKE_PREFERENCE = 3; // an occupied region's value score x this: the player wants its own land back first
const FORT_THREAT = 0.9;     // a border region is fortified once its unattended odds read below this (or once it has been raided)
const FORT_UPGRADE_SEC = 8;   // --forts=normal: a level-II fortification only when it costs at most this many seconds of income
const FORT_POLICIES = {
  normal: { types: ['walls', 'tower'], upgradeSec: FORT_UPGRADE_SEC, maxLevel: 2, weight: 1 },
  heavy: { types: ['walls', 'tower', 'hall'], upgradeSec: Infinity, maxLevel: 3, weight: 0.6 },
};

/** Debug hook for scratch tools: called with (battle, region, timedOut) after every fought battle. */
export const hooks = { onBattleEnd: null, onConquest: null, onBattleStart: null };
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

// --- Region Works policy (see the header) ------------------------------------------------------
const WORKS_UPGRADE_SEC = 5; // normal: a level II/III Work is bought only when it costs at most this many seconds of realm income
// weight: a Work's price is multiplied by this when it competes with the core upgrades for "the cheapest thing" (a player who
// likes Works leans to them).
const WORKS_POLICIES = {
  normal: { border: ['watchtower', 'barracks'], interior: ['market'], upgradeSec: WORKS_UPGRADE_SEC, weight: 1 },
  heavy: { border: ['watchtower', 'barracks', 'shrine', 'stables'], interior: ['market'], upgradeSec: Infinity, weight: 0.5 },
  // single-Work policies, to price each Work on its own against building nothing (docs: the Works worth table)
  markets: { border: ['market'], interior: ['market'], upgradeSec: Infinity, weight: 1 },
  barracks: { border: ['barracks'], interior: [], upgradeSec: Infinity, weight: 1 },
  stables: { border: ['stables'], interior: [], upgradeSec: Infinity, weight: 1 },
  shrines: { border: ['shrine'], interior: [], upgradeSec: Infinity, weight: 1 },
  watchtowers: { border: ['watchtower'], interior: [], upgradeSec: Infinity, weight: 1 },
};

function worksPolicy(flags) {
  const name = flags.works === undefined || flags.works === true ? 'normal' : String(flags.works);
  return WORKS_POLICIES[name] ?? null; // 'none' (or anything else): no Works
}

/** The cheapest Work the policy wants right now: { kind: 'work', action, regionId, type, slot, level, cost, id } or null. */
function nextWork(state, world, flags) {
  const policy = worksPolicy(flags);
  if (!policy) return null;
  const income = incomePerSec(state, world);
  let best = null;
  const consider = (cand) => { if (!best || cand.cost < best.cost - 1e-9) best = cand; };
  for (const region of world.regions) {
    if (state.owner[region.id] !== PLAYER_FACTION) continue;
    const border = region.neighbors.some((n) => state.owner[n] !== PLAYER_FACTION);
    const wanted = border ? policy.border : policy.interior;
    const slots = Works.workSlots(state, region.id);
    const built = Works.worksOf(state, region.id);
    if (built.length < slots) {
      const type = wanted.find((t) => !built.some((w) => w.type === t));
      if (type) {
        const cost = Works.workCost(state, world, region.id, type, 1);
        if (Number.isFinite(cost)) consider({ kind: 'work', action: 'build', regionId: region.id, type, slot: built.length, level: 1, cost, id: `work:${type}` });
      }
    }
    built.forEach((w, slot) => {
      if (!wanted.includes(w.type) || w.level >= 3) return;
      const cost = Works.workCost(state, world, region.id, w.type, w.level + 1);
      if (Number.isFinite(cost) && cost <= policy.upgradeSec * income) {
        consider({ kind: 'work', action: 'upgrade', regionId: region.id, type: w.type, slot, level: w.level + 1, cost, id: `work:${w.type}` });
      }
    });
  }
  return best;
}

/** The cheapest fortification the policy wants (owned regions that border a rival): { kind: 'fort', ... } or null. */
function nextFort(state, world, flags) {
  if (flags.raids === 'off') return null;
  const policy = FORT_POLICIES[flags.forts === undefined || flags.forts === true ? 'normal' : String(flags.forts)];
  if (!policy) return null;
  const income = incomePerSec(state, world);
  let best = null;
  const consider = (cand) => { if (!best || cand.cost < best.cost - 1e-9) best = cand; };
  for (const region of world.regions) {
    if (state.owner[region.id] !== PLAYER_FACTION) continue;
    if (!region.neighbors.some((n) => state.owner[n] > 1)) continue; // only where a rival can raid
    // threatened: the card reads its odds unattended below FORT_THREAT, or a raid has already come for it
    const raided = state.frontier && state.frontier.cooldown && state.frontier.cooldown[region.id] != null;
    if (!raided && Frontier.estimateDefense(state, world, region.id, null, { nowMs: state.lastSeen }).winChance >= FORT_THREAT) continue;
    const built = Forts.fortsOf(state, region.id);
    if (built.length < Forts.fortSlots(state, region.id)) {
      const type = policy.types.find((t) => !built.some((f) => f.type === t));
      if (type) consider({ kind: 'fort', action: 'build', regionId: region.id, type, slot: built.length, level: 1, cost: Forts.fortCost(state, world, region.id, type, 1), id: 'fort:' + type });
    }
    built.forEach((f, slot) => {
      if (!policy.types.includes(f.type) || f.level >= Math.min(policy.maxLevel, Forts.fortMaxLevel(f.type))) return;
      const cost = Forts.fortCost(state, world, region.id, f.type, f.level + 1);
      if (cost <= policy.upgradeSec * income) consider({ kind: 'fort', action: 'upgrade', regionId: region.id, type: f.type, slot, level: f.level + 1, cost, id: 'fort:' + f.type });
    });
  }
  if (best) best.weight = policy.weight;
  return best;
}

/** What the player is saving for: the cheapest of the pool upgrades, the wanted Works ('heavy' takes Works first) and the wanted fortifications. */
function nextTarget(state, world, conquestCount, flags) {
  const uid = cheapestTargetId(state, conquestCount, flags);
  const up = uid ? { kind: 'upgrade', id: uid, cost: upgradeCost(uid, levelOf(state, uid)) } : null;
  const work = nextWork(state, world, flags);
  let pick = up;
  if (work && (!pick || work.cost * worksPolicy(flags).weight < pick.cost)) pick = work;
  const fort = nextFort(state, world, flags);
  if (fort && (!pick || fort.cost * fort.weight < pick.cost)) pick = fort;
  return pick;
}

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
function buyingPass(state, world, conquestCount, flags, goldSpent) {
  const bought = [];
  for (;;) {
    const target = nextTarget(state, world, conquestCount, flags);
    if (!target) break;
    if (target.kind === 'fort') {
      if (state.gold < target.cost - 1e-9) break;
      const res = target.action === 'build' ? Forts.buildFort(state, world, target.regionId, target.type) : Forts.upgradeFort(state, world, target.regionId, target.slot);
      if (!res) break;
      if (bountyCtx) bountyClaim(state, world, Bounties.onFortBuilt(state, world, target.regionId, target.type), state.lastSeen);
      bought.push({ id: target.id, level: target.level, cost: res.cost });
      goldSpent[target.id] = (goldSpent[target.id] || 0) + res.cost;
      continue;
    }
    if (target.kind === 'work') {
      if (state.gold < target.cost - 1e-9) break;
      const res = target.action === 'build' ? Works.buildWork(state, world, target.regionId, target.type) : Works.upgradeWork(state, world, target.regionId, target.slot);
      if (!res) break; // defensive: the policy only asks for what the game allows
      bought.push({ id: target.id, level: target.level, cost: res.cost });
      goldSpent[target.id] = (goldSpent[target.id] || 0) + res.cost;
      continue;
    }
    const id = target.id;
    if (!canBuy(state, id)) break;
    const level = buy(state, id);
    bought.push({ id, level, cost: target.cost });
    goldSpent[id] = (goldSpent[id] || 0) + target.cost;
  }
  return bought;
}

// --- The Living Frontier in the campaign (see the header) ---------------------------------------------------------------
let raidCtx = null; // { state, mode: 'idle'|'playing', log } while a campaign with raids runs
let genCtx = null;  // { busy: generalId|null, noSpend, log } while a campaign with Generals runs
let quickCtx = null; // { n, won } while a campaign that may Quick-Conquer runs
let unrestCtx = null; // the state whose Unrest ticks along the clock (PLAN-PHASE11b), unless --unrest=off
const unrestLog = { started: 0 };
const UNREST_STEP_SEC = 20; // the campaign ticks Unrest in chunks of this many active seconds
let humanCtx = false; // true while runHumanHour plays (attemptConquest's patience rule)
let boonCtx = null;  // { recent: [won...], picks: [{ id, at }], force } while a campaign with Boons runs (off with --boons=off)

const RARITY_RANK = { legendary: 3, rare: 2, common: 1 };
/**
 * The Boon policy (PLAN-PHASE7 contract): the highest rarity on offer; a Cursed Boon only when the bot is ahead (its last
 * BOON_AHEAD_WINS battles all won); ties broken by a seeded hash so every Boon gets picked somewhere. --boonForce=id: always that
 * Boon when it is offered (and it is granted at the start of each dynasty, see runCampaign). Never rerolls.
 */
function botPickBoon(state, nowSec) {
  const p = state.boons2 && state.boons2.pending;
  if (!boonCtx || !p) return null;
  const ahead = boonCtx.recent.length >= BOON_AHEAD_WINS && boonCtx.recent.slice(-BOON_AHEAD_WINS).every(Boolean);
  const infos = p.choices.map((id) => Boons.boonInfo(id)).filter(Boolean);
  const ok = infos.filter((b) => ahead || !b.cursed);
  const pool = ok.length ? ok : infos;
  pool.sort((a, b) => RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity] || hash32(state.seed, 'botBoon', a.id) - hash32(state.seed, 'botBoon', b.id));
  const r = Boons.pickBoon(state, pool[0].id);
  if (r.ok) boonCtx.picks.push({ id: pool[0].id, at: nowSec, duo: r.duo ? r.duo.id : null });
  return r;
}

/** Notes a finished battle for the Cursed rule and settles the Boons' end-of-battle gold (Plunderers, Fortune Favours). */
function boonsAfterBattle(state, world, battle, result) {
  const g = Boons.boonBattleEnd(state, world, battle, result); // also with --boons=off: a --boonForce Boon still pays / costs
  if (!boonCtx) return;
  boonCtx.recent.push(result === 'win');
  if (boonCtx.recent.length > 20) boonCtx.recent.shift();
  boonCtx.plunder += g.plunder;
  boonCtx.goldLost += g.goldLost;
}
const QUICK_SEC = 2; // a Quick Conquest's overlay: the player's time it takes

/** The General commanding a new battle in the campaign, or null for the Militia Captain (see the header). */
function pickCommander(state, world, regionId, kind, nowMs) {
  if (!genCtx) return null;
  const busy = genCtx.busy;
  const free = Generals.freeGenerals(state, nowMs).filter((g) => g.id !== busy);
  if (!free.length) return null;
  const choose = kind === 'attack' ? Generals.bestFreeGeneral : Generals.nearestFreeGeneral;
  // bestFree/nearestFree read state.battles for busy Generals; the campaign keeps none there, so filter here
  const pick = kind === 'attack' ? choose(state, world, regionId, 'attack', nowMs) : choose(state, world, regionId, nowMs);
  return pick && pick.id !== busy ? pick : free[0];
}

/** Settles a battle's commander (XP, wounds) and takes every skill pick owed (option 0). */
function settle(state, run, result, nowMs) {
  if (!genCtx || !run.commander) return;
  const out = Generals.settleCommander(state, run, result, nowMs);
  if (out) genCtx.log.xp += out.xp;
  const g = Generals.generalById(state, run.commander);
  while (g && Generals.pendingPicks(g) > 0) Generals.pickSkill(g, 0);
}

/** The Renown policy (see the header). */
function spendRenown(state, world, nowMs) {
  if (!genCtx || genCtx.noSpend) return;
  for (let guard = 0; guard < 20; guard++) {
    const wounded = Generals.ensureGenerals(state).roster.find((g) => Generals.isWounded(g, nowMs));
    if (wounded && Renown.heal(state, wounded.id, nowMs)) { genCtx.log.heals += 1; continue; }
    let best = null;
    for (const region of world.regions) {
      if (Renown.festivalRefusal(state, world, region.id) === 'notOwned' || Renown.festivalRefusal(state, world, region.id) === 'maxed') continue;
      const v = regionIncome(region);
      if (!best || v > best.v) best = { id: region.id, v };
    }
    const fCost = best ? Renown.festivalCost(state, best.id) : Infinity;
    const marshal = Generals.generalById(state, 'marshal');
    const tCost = marshal && marshal.level < 10 ? Renown.trainCost(marshal) : Infinity;
    if (best && fCost <= tCost && Renown.festival(state, world, best.id, nowMs)) { genCtx.log.festivals += 1; continue; }
    if (tCost < fCost && Renown.train(state, 'marshal')) { genCtx.log.trains += 1; const g = marshal; while (Generals.pendingPicks(g) > 0) Generals.pickSkill(g, 0); continue; }
    break;
  }
}

function newRaidLog() {
  return {
    announced: 0, inPerson: { n: 0, won: 0 }, steward: { n: 0, won: 0 }, lost: [], retakes: [], maxOccupied: 0,
    defenses: [], firstRaidSec: null, away: [], rivalSec: 0, rateSec: 0, vendettas: { n: 0, won: 0, championFell: 0 },
  };
}

/** Fights one arrived raid to the end (in person or by the Militia Captain) and settles it exactly as the game does. */
function fightRaid(state, world, raid, nowMs, inPerson, log) {
  const general = pickCommander(state, world, raid.toRegionId, 'defense', nowMs);
  const est = Frontier.estimateDefense(state, world, raid.toRegionId, raid, general && !inPerson ? { nowMs, general } : { nowMs, commander: inPerson ? 'inPerson' : 'captain' });
  const stats = general ? playerBattleStats(state, world, raid.toRegionId, { commander: general }) : null;
  let run;
  try { run = Frontier.defenseRunFor(state, world, raid, stats, { nowMs }); } catch { return null; }
  run.commander = general ? general.id : null;
  const style = general ? Generals.commanderStyle(general) : 'captain';
  const b = run.battle;
  const memo = {};
  const tracker = trackerOf(b);
  while (!b.result && b.t < 600) {
    for (const cmd of think(b, b.t)) issue(b, cmd);
    for (const cmd of (inPerson ? decideDefense(b, b.t, memo) : stewardDecide(b, b.t, memo, style))) issue(b, cmd);
    step(b, TICK_SEC);
    trackBattle(tracker, b);
  }
  const won = b.result === 'win';
  // defenseReward settles every defense (a lost Vendetta resets its Grudge), then a loss is occupied
  const reward = Frontier.defenseReward(state, world, run, won ? 'win' : 'lose', nowMs);
  boonsAfterBattle(state, world, b, won ? 'win' : 'lose');
  if (reward && reward.boonOffer) { botPickBoon(state, nowMs / 1000); if (boonCtx) boonCtx.champEye += 1; } // the Champion's eye
  if (!won) Frontier.occupy(state, world, run.regionId, run.attackerFaction, nowMs);
  bountyBattle(state, world, run, b, tracker, nowMs);
  if (run.vendetta) { log.vendettas.n += 1; if (won) log.vendettas.won += 1; if (b.champion && b.champion.fellAt != null) log.vendettas.championFell += 1; }
  settle(state, run, won ? 'win' : 'lose', nowMs);
  if (genCtx) genCtx.log[general ? 'generalDefenses' : 'captainDefenses'] += 1;
  const bucket = inPerson ? log.inPerson : log.steward;
  bucket.n += 1;
  if (won) bucket.won += 1;
  const row = {
    atSec: nowMs / 1000, region: raid.toRegionId, inPerson, won, sec: b.t, depth: raid.depth, first: !!raid.first,
    winChance: est.winChance, ratio: est.ratio, forts: Forts.fortsOf(state, raid.toRegionId).length, vendetta: !!run.vendetta,
    commander: general ? general.kind : null, level: general ? general.level : 0,
    faction: raid.faction, landing: !!raid.landing, // PLAN-PHASE12: who raided, and whether the war band landed from the sea
  };
  log.defenses.push(row);
  if (!won) log.lost.push(row);
  log.maxOccupied = Math.max(log.maxOccupied, Object.keys(state.occupation || {}).length);
  return row;
}

/**
 * World events (DESIGN §10.13) as a sensible player takes them: the Merchant's Renown when it costs at most a third of the gold in
 * hand, the Duel always (fought in person, a short no-powers battle), the Plague is news.
 */
function eventsTick(state, world, endSec, dt, ctx) {
  const { offered } = Events.tickEvents(state, world, endSec * 1000, dt);
  if (!offered) return;
  const log = ctx.log.events || (ctx.log.events = { merchant: 0, plague: 0, duel: 0, deserters: 0, harvest: 0, duelsWon: 0, accepted: 0 });
  log[offered.kind] = (log[offered.kind] || 0) + 1;
  const nowMs = endSec * 1000;
  if (offered.kind === 'merchant') {
    const deal = offered.deals.find((d) => d.deal === 'renown');
    if (deal && state.gold >= 3 * deal.gold && Events.acceptEvent(state, world, { deal: 'renown' }, nowMs)) log.accepted += 1;
    else Events.declineEvent(state);
  } else if (offered.kind === 'duel') {
    Events.acceptEvent(state, world, {}, nowMs);
    log.accepted += 1;
    let run;
    try { run = Events.duelRunFor(state, world, offered, null, { nowMs: endSec * 1000 }); } catch { return; }
    const b = run.battle;
    const memo = {};
    while (!b.result && b.t < 300) {
      for (const cmd of think(b, b.t)) issue(b, cmd);
      for (const cmd of decideDefense(b, b.t, memo)) issue(b, cmd);
      step(b, TICK_SEC);
    }
    if (Events.duelReward(state, world, run, b.result).renown > 0) log.duelsWon += 1;
  } else if (offered.kind === 'deserters') {
    // PLAN-PHASE8: the Muster when some militia is below half (the realm was raided lately), else weaken the rival's next raid
    const low = world.regions.some((r) => state.owner[r.id] === 0 && militiaFill(state, r.id, nowMs) < 0.5);
    if (Events.acceptEvent(state, world, { choice: low ? 'muster' : 'raid' }, nowMs)) log.accepted += 1;
  } else if (offered.kind === 'harvest') {
    // PLAN-PHASE8: the festival when it costs at most a third of the gold in hand (the Merchant's rule)
    if (state.gold >= 3 * offered.gold && Events.acceptEvent(state, world, {}, nowMs)) log.accepted += 1;
    else Events.declineEvent(state);
  } else {
    Events.declineEvent(state); // the Plague applies by itself
  }
}

/** Runs the raid scheduler over `dt` active seconds ending at `endSec` and fights whatever arrives. */
function frontierTick(state, world, endSec, dt, ctx) {
  if (!ctx.noEvents) eventsTick(state, world, endSec, dt, ctx);
  const { announced, arrived } = Frontier.tickFrontier(state, world, endSec * 1000, dt);
  ctx.log.announced += announced.length;
  bountyEnsure(state, world);
  if (!Frontier.inGrace(state)) {
    // pace bookkeeping: rival-seconds of exposure, and the raids the rates promise (before caps and cooldowns)
    for (const { faction } of Frontier.borderingRivals(state, world)) {
      const rate = Frontier.raidRate(state, world, faction);
      if (rate > 0) { ctx.log.rivalSec += dt; ctx.log.rateSec += rate * dt; }
    }
  }
  if (announced.length && ctx.log.firstRaidSec == null) ctx.log.firstRaidSec = endSec;
  for (const raid of arrived) {
    // A person watches ONE battle at a time (DESIGN §10.5): during its own attack it watches the attack, and while one defense
    // is being fought in person a second one that overlaps it is left to the Steward. Idle, it switches to a new raid for free.
    const inPerson = ctx.mode !== 'playing' && endSec >= ctx.watchingUntil;
    const row = fightRaid(state, world, raid, endSec * 1000, inPerson, ctx.log);
    if (row && inPerson) ctx.watchingUntil = endSec + row.sec;
  }
}

// --- Phase 4 (PLAN-PHASE4): the Bounty Board as a player takes it, with no special play: every contract it happens to meet is
// claimed at once (the game's claimCompleted), nothing is rerolled. Off with --bounties=off.
let bountyCtx = null; // { log } while a campaign with the board runs

function bountyEnsure(state, world) {
  if (bountyCtx) Bounties.ensureBounties(state, world);
}

function bountyClaim(state, world, done, nowMs) {
  if (!bountyCtx || !done || !done.length) return;
  const r = Bounties.claimCompleted(state, world, done, nowMs);
  const log = bountyCtx.log;
  log.completed += r.claimed.length;
  log.gold += r.gold;
  log.renown += r.renown;
  log.xp += r.xp;
  for (const c of r.claimed) log.byKind[c.kind] = (log.byKind[c.kind] || 0) + 1;
}

/** updateProsperity, with its level-ups handed to the board (as the game does). */
function prosper(state, world, nowMs) {
  const ups = updateProsperity(state, world, nowMs);
  if (bountyCtx && ups.length) bountyClaim(state, world, Bounties.onProsperity(state, world, ups), nowMs);
  return ups;
}

/** A finished battle, handed to the board through the game's own summary. */
function bountyBattle(state, world, run, battle, tracker, nowMs) {
  if (!bountyCtx) return;
  const summary = battleSummaryFor(tracker, battle, run, world, state);
  bountyClaim(state, world, Bounties.onBattleEnd(state, world, run, battle.result || 'retreat', summary), nowMs);
}

/**
 * Advances the simulated clock by `sec`, integrating income across prosperity level changes (DESIGN §5.6):
 * income steps up mid-wait when a region reaches its next level, so the jump is split at each one.
 * Tenure runs on this same clock (`conquer` stamps `conqueredAt` with wallSec x 1000).
 */
function advanceClock(state, world, wallSecRef, sec) {
  let left = sec;
  const raids = raidCtx && raidCtx.state === state ? raidCtx : null;
  for (let guard = 0; left > 1e-9 && guard < (raids || unrestCtx === state ? 1e6 : 256); guard++) {
    const nowMs = wallSecRef.sec * 1000;
    prosper(state, world, nowMs);
    const change = nextProsperityChangeAt(state, world, nowMs); // ms, or null
    let step = change == null ? left : Math.min(left, Math.max(1e-6, (change - nowMs) / 1000));
    if (raids) {
      step = Math.min(step, FRONTIER.checkSec);
      frontierTick(state, world, wallSecRef.sec + step, step, raids);
    }
    if (unrestCtx === state) { // PLAN-PHASE11b: Unrest runs on the same active clock (--unrest=off: never)
      step = Math.min(step, UNREST_STEP_SEC);
      if (tickUnrest(state, world, step, nowMs).started != null) unrestLog.started += 1;
    }
    tickIncome(state, world, step);
    wallSecRef.sec += step;
    left -= step;
  }
  prosper(state, world, wallSecRef.sec * 1000);
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
  const target = nextTarget(state, world, conquestCount, flags);
  if (!target) return false;
  const before = wallSecRef.sec;
  if (!waitUntilAffordable(state, world, wallSecRef, target.cost)) return false;
  const waitSec = wallSecRef.sec - before;
  if (waitSec > 0) log.push({ t: wallSecRef.sec, kind: 'wait', forId: target.id, waitSec });
  for (const b of buyingPass(state, world, conquestCount, flags, goldSpent)) {
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
  if (!Intel.isScouted(state, plan.regionId) && Intel.scout(state, world, plan.regionId) && bountyCtx) Bounties.onScout(state, world, plan.regionId);
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
    if (Frontier.occupationOf(state, c.regionId)) score *= RETAKE_PREFERENCE;
    if (region.type) score *= TYPE_PREFERENCE[region.type] ?? 1; // Gold Mines and Monasteries make route choice matter (DESIGN §10.13)
    if (relicAt(state, c.regionId)) score *= RELIC_PREFERENCE;
    return { ...c, score };
  });
  scored.sort((a, b) => b.score - a.score || a.regionId - b.regionId);
  return scored;
}

// --- One battle attempt (or instant surrender) ------------------------------------------------
function attemptConquest(state, world, regionId, wallSecRef, battleDurations, forceBattle = false) {
  if (unrestCtx === state) calmUnrest(state, regionId); // attacking ends the wait (PLAN-PHASE11b)
  const general = pickCommander(state, world, regionId, 'attack', wallSecRef.sec * 1000);
  const diffAtAttack = difficulty(state, world, regionId, general ? { commander: general } : {}); // the card credits its commander
  const region = world.regions[regionId];

  if (diffAtAttack.surrender && !forceBattle) {
    if (Frontier.occupationOf(state, regionId) && raidCtx) raidCtx.log.retakes.push({ atSec: wallSecRef.sec, region: regionId, label: diffAtAttack.label, ratio: diffAtAttack.ratio, surrender: true });
    const conq = conquer(state, world, regionId, wallSecRef.sec * 1000);
    const { bounty } = conq;
    const crowns = crownsForSurrender(); // a surrender earns Victory only (DESIGN §4.8)
    const award = awardCrowns(state, world, regionId, crowns, bounty);
    state.stats.surrenders += 1;
    if (bountyCtx) bountyClaim(state, world, Bounties.onConquest(state, world, regionId, conq), wallSecRef.sec * 1000);
    return {
      won: true, surrendered: true, battleSec: 0, bounty, crowns, crownBonus: award.bonusGold, diffAtAttack, region,
      personality: world.factions[region.faction].personality,
    };
  }

  // Quick Conquest (PLAN-PHASE5 §5D; --quick=off to fight every Easy region by hand): an Easy region is auto-resolved once the node is
  // owned. It takes QUICK_SEC of the player's time (the overlay); a loss counts like any lost attack.
  if (!forceBattle && quickCtx && Quick.canQuickConquer(state, world, regionId, { commander: general ? general.id : null }).ok) {
    const job = Quick.createQuickConquest(state, world, regionId, { commander: general ? general.id : null, nowMs: wallSecRef.sec * 1000 });
    while (!Quick.stepQuickConquest(job, 4000).done);
    advanceClock(state, world, wallSecRef, QUICK_SEC);
    const out = Quick.finishQuickConquest(state, world, job, wallSecRef.sec * 1000);
    quickCtx.n += 1; if (out.won) quickCtx.won += 1;
    if (boonCtx) boonCtx.recent.push(out.won);
    if (out.won) {
      return { won: true, surrendered: false, quick: true, battleSec: QUICK_SEC, bounty: out.conquerResult.bounty, crowns: out.crowns,
        crownBonus: out.crownAward.bonusGold, diffAtAttack, region, timedOut: false, personality: world.factions[region.faction].personality };
    }
    return { won: false, surrendered: false, quick: true, battleSec: QUICK_SEC, diffAtAttack, region, timedOut: job.battle.result === 'retreat' };
  }

  const player = playerBattleStats(state, world, regionId, general ? { commander: general } : {});
  const enemy = enemyBattleStats(world, state, regionId);
  let arena;
  try {
    arena = buildArena(world, state.owner, regionId, player, enemy, Frontier.attackArenaOpts(state, world, regionId));
  } catch {
    // Rare world-generation edge case (mirrors tools/balance.mjs's own real-world sweep):
    // `frontier()` treats two regions as adjacent whenever their graph-neighbour list says
    // so, but buildArena additionally needs an actual PASSABLE player-owned tile bordering
    // the target (e.g. two regions can be "neighbors" across an all-mountain edge). Never a
    // battle outcome — just try the next-best candidate this round.
    return { unattackable: true, region, regionId };
  }
  const battle = createBattle(arena, player, enemy);
  if (hooks.onBattleStart) hooks.onBattleStart(battle, region, state);
  const tracker = trackerOf(battle); // crowns (DESIGN §4.8): fed after EVERY step, exactly as the battle scene does
  const botMemo = {};
  // PLAN-PHASE8: a player holding Supply Wagons uses supply lines (the bot's 'overflow' habit: only sites about to waste growth)
  if (state.boons2 && state.boons2.owned.includes('supplyWagons')) botMemo.supply = 'overflow';
  const patience = patienceFor(region, state.dynasty.level);
  // --policy=human: a person who holds most of the settlements at the patience mark keeps going (up to HUMAN.aheadPatience x it); behind, it retreats
  const ahead = () => { let mine = 0; for (const x of battle.sites) if (x.owner === PLAYER_FACTION) mine += 1; return mine * 2 > battle.sites.length; };
  const longest = humanCtx ? patience * HUMAN.aheadPatience : patience;
  let capSec = patience;
  while (!battle.result && (battle.t < patience || (battle.t < longest && ahead()))) {
    for (const cmd of think(battle, battle.t)) issue(battle, cmd);
    for (const cmd of decide(battle, battle.t, botMemo)) issue(battle, cmd);
    step(battle, TICK_SEC);
    trackBattle(tracker, battle);
  }
  const timedOut = !battle.result;
  if (timedOut || battle.t > patience) capSec = Math.max(patience, Math.min(longest, battle.t));
  if (hooks.onBattleEnd) hooks.onBattleEnd(battle, region, timedOut);
  const battleSec = timedOut ? capSec : battle.stats.durationSec;
  if (raidCtx) raidCtx.mode = 'playing'; // the player watches its own attack: raids that land now are the Steward's
  if (genCtx) genCtx.busy = general ? general.id : null; // and its General is busy
  advanceClock(state, world, wallSecRef, battleSec);
  if (raidCtx) raidCtx.mode = 'idle';
  if (genCtx) genCtx.busy = null;
  settle(state, { kind: 'attack', regionId, commander: general ? general.id : null }, battle.result === 'win' && !timedOut ? 'win' : 'lose', wallSecRef.sec * 1000);
  battleDurations.push({
    band: bandFor(region), sec: battleSec, timedOut, won: battle.result === 'win',
    ratio: diffAtAttack.ratio, label: diffAtAttack.label, tier: region.tier, personality: enemy.personality,
    capital: region.isCapital, sites: region.settlements.length, regionId, throne: !!region.throne, // PLAN-PHASE13: the Throne of Ages
    ...(battle.throne ? { thronePhase: battle.throne.phase, usurperFell: battle.throne.usurper.fell, winChance: diffAtAttack.winChance, throneAt: { ...battle.throne.at }, borrows: battle.throne.borrow.n } : {}),
    boons: state.boons2 ? state.boons2.owned.slice() : [], dynasty: state.dynasty.level, // PLAN-PHASE7: the per-Boon report
    // PLAN-PHASE15 (tools/labelAudit.mjs): what the card promised and the slices the audit cuts by
    promised: diffAtAttack.winChance, rawRatio: diffAtAttack.rawRatio, twist: region.twist || null, type: region.type || null, ascension: state.ascension || 0,
    crown: !!state.crownOfAges, archipelago: !!world.archipelago,
  });

  const attackRun = { kind: 'attack', regionId, commander: general ? general.id : null, labelAtAttack: diffAtAttack.label };
  if (!timedOut && battle.result === 'win') {
    const wasOccupied = !!Frontier.occupationOf(state, regionId);
    const conq = conquer(state, world, regionId, wallSecRef.sec * 1000, { viaBattle: !!boonCtx, labelAtAttack: diffAtAttack.label }); // PLAN-PHASE7: a battle win drafts Boons (Fair or harder, typed, capitals)
    boonsAfterBattle(state, world, battle, 'win');
    if (conq.boonOffer) botPickBoon(state, wallSecRef.sec);
    const { bounty } = conq;
    if (bountyCtx) {
      bountyBattle(state, world, attackRun, battle, tracker, wallSecRef.sec * 1000);
      bountyClaim(state, world, Bounties.onConquest(state, world, regionId, conq), wallSecRef.sec * 1000);
    }
    if (wasOccupied && raidCtx) raidCtx.log.retakes.push({ atSec: wallSecRef.sec, region: regionId, label: diffAtAttack.label, ratio: diffAtAttack.ratio });
    const { crowns } = evaluateBattle(tracker, battle, world, regionId, state);
    const award = awardCrowns(state, world, regionId, crowns, bounty); // pays the bonus, never the base bounty twice
    state.stats.battlesWon += 1; // unlocks surrender offers (DESIGN §5.3), as the game's own results screen does
    return {
      won: true, surrendered: false, battleSec, bounty, crowns, crownBonus: award.bonusGold, diffAtAttack, region, timedOut: false,
      personality: enemy.personality,
    };
  }
  onStreakBroken(state, timedOut ? 'retreat' : 'lost'); // a lost attack (or a retreat) ends the Conquest Streak (PLAN-PHASE4 §4B)
  boonsAfterBattle(state, world, battle, timedOut ? 'retreat' : 'lose');
  bountyBattle(state, world, attackRun, battle, tracker, wallSecRef.sec * 1000);
  return {
    won: false, surrendered: false, battleSec, diffAtAttack, region, timedOut,
  };
}

/** The share of the realm's region income that comes from prosperity bonuses now (DESIGN §5.6; Festivals raise it). */
function prosperityShare(state, world) {
  let base = 0;
  let bonus = 0;
  for (const region of world.regions) {
    if (state.owner[region.id] !== PLAYER_FACTION) continue;
    const inc = regionIncome(region);
    const level = Array.isArray(state.prosperity) && Number.isInteger(state.prosperity[region.id]) ? state.prosperity[region.id] : 0;
    base += inc;
    bonus += inc * 0.05 * level;
  }
  return base > 0 ? bonus / (base + bonus) : 0;
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
    world.regions.length - 1 - (world.regions.some((x) => x.type === 'dragon') ? 1 : 0), // the optional Lair is not required
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
  // The Living Frontier: raids run along the clock (see the header). conquestCount is the NET number of regions held beyond the
  // start, so a region lost to a raid has to be won back before the continent counts as whole.
  const raidLog = newRaidLog();
  raidCtx = flags.raids === 'off' ? null : { state, mode: 'idle', log: raidLog, watchingUntil: 0, noEvents: flags.events === 'off' };
  unrestCtx = flags.unrest === 'off' ? null : state;
  if (!Array.isArray(state.battles)) state.battles = [];
  // the Dragon's Lair is optional (DESIGN §10.13): the continent counts as whole without it, and it is attacked only when it reads
  // Fair or better, like any region (so it is taken when ready, or left behind when the dynasty is founded)
  const lairId = world.regions.findIndex((x) => x.type === 'dragon');
  const netOwned = () => state.owner.reduce((n, o, id) => n + (o === PLAYER_FACTION && id !== lairId ? 1 : 0), 0) - 1;
  const genLog = { xp: 0, festivals: 0, trains: 0, heals: 0, generalDefenses: 0, captainDefenses: 0 };
  genCtx = flags.generals === 'off' ? null : { busy: null, noSpend: flags.renown === 'off', log: genLog };
  const bountyLog = { completed: 0, gold: 0, renown: 0, xp: 0, byKind: {} };
  bountyCtx = flags.bounties === 'off' ? null : { log: bountyLog };
  if (genCtx) Generals.ensureGenerals(state);
  const quickLog = { n: 0, won: 0 };
  quickCtx = flags.quick === 'off' ? null : quickLog;
  // PLAN-PHASE7: Boons (--boons=off: never drafted). --boonForce=id grants that Boon at the start of the dynasty (the per-Boon sweep)
  const boonLog = { recent: [], picks: [], plunder: 0, goldLost: 0, champEye: 0 };
  boonCtx = flags.boons === 'off' ? null : boonLog;
  if (flags.relics === 'off' && state.relics) { state.relics.placed = {}; state.relics.seed = world.seed >>> 0; } // --relics=off: the pre-Phase-7 baseline
  if (flags.boonForce && state.boons2 && !state.boons2.owned.includes(flags.boonForce) && BOON_LIST.some((b) => b.id === flags.boonForce)) state.boons2.owned.push(flags.boonForce);

  for (let iter = 0; iter < MAX_LOOP_ITERATIONS && (conquestCount = netOwned()) < totalToConquer; iter++) {
    if (wallSecRef.sec > (flags.checkinHours ? 90 * MAX_WALL_SEC : MAX_WALL_SEC)) {
      stallReason = `stalled: exceeded ${fmtSec(MAX_WALL_SEC)} of simulated wall-clock (well past the 4-7h whole-continent target) without finishing`;
      break;
    }
    for (const b of buyingPass(state, world, conquestCount, flags, goldSpent)) {
      log.push({ t: wallSecRef.sec, kind: 'buy', ...b });
    }
    spendRenown(state, world, wallSecRef.sec * 1000);
    bountyEnsure(state, world);

    const candidates = [];
    for (const regionId of frontier(state, world)) {
      // The card a player sees, with its default commander's credit (DESIGN §10.11; PLAN-PHASE6 §6C made it the default);
      // --card=plain reads it without the credit (the pre-Phase-6 campaign)
      const cmdr = flags.card !== 'plain' ? pickCommander(state, world, regionId, 'attack', wallSecRef.sec * 1000) : null;
      const d = difficulty(state, world, regionId, cmdr ? { commander: cmdr } : {});
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
      if (raidCtx) raidLog.away.push(Frontier.resolveAway(state, world, awaySec * 1000, state.lastSeen));
      wallSecRef.sec += awaySec;
      prosper(state, world, wallSecRef.sec * 1000);
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
      conquestCount = netOwned();
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
      for (const b of buyingPass(state, world, conquestCount, flags, goldSpent)) log.push({ t: wallSecRef.sec, kind: 'buy', ...b });
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
        if (raidCtx) raidLog.away.push(Frontier.resolveAway(state, world, awaySec * 1000, state.lastSeen));
        wallSecRef.sec += awaySec;
        prosper(state, world, wallSecRef.sec * 1000);
        const spent = buyingPass(state, world, conquestCount, flags, goldSpent);
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

  raidCtx = null;
  unrestCtx = null;
  bountyCtx = null;
  quickCtx = null;
  boonCtx = null;
  const goals = {
    bounties: bountyLog,
    bestStreak: state.streak ? state.streak.best : 0,
    trophies: Object.entries(state.trophies || {}).filter(([k]) => /^\d+$/.test(k)).reduce((a, [, v]) => a + v, 0),
    deedTiers: deedProgress(state).reduce((a, d) => a + d.tier, 0),
  };
  const genSummary = genCtx ? {
    ...genLog, renown: { ...Renown.ensureRenown(state) },
    roster: Generals.ensureGenerals(state).roster.map((g) => ({ id: g.id, kind: g.kind, level: g.level })),
    prosperityShare: prosperityShare(state, world),
  } : null;
  genCtx = null;
  conquestCount = netOwned();
  const summary = summarize({
    world, timeline, log, battleDurations, goldSpent, battlesWon, battlesLost,
    conquestCount, totalToConquer, wallSec: wallSecRef.sec, stallReason,
  });
  const result = {
    seed, timeline, log, summary, stallReason, conquestCount, totalToConquer, battleDurations, offline,
    dynasty: state.dynasty.level, stars: state.dynasty.stars, checkins,
    generals: genSummary,
    goals,
    quick: quickLog,
    boons: { ...boonLog, recent: undefined, owned: state.boons2 ? state.boons2.owned.slice() : [], relics: state.relics ? state.relics.owned.slice() : [], reliquary: state.generals && state.generals.reliquary ? state.generals.reliquary.found.length : 0 },
    lairTaken: lairId >= 0 && state.owner[lairId] === PLAYER_FACTION,
    raids: flags.raids === 'off' ? null : { ...raidLog, stats: { ...(state.frontier ? state.frontier.stats : {}) }, activeSec: state.frontier ? state.frontier.activeSec : 0 },
  };
  Object.defineProperty(result, 'endState', { value: { state, world }, enumerable: false }); // for runDynasties; not in --json
  return result;
}

// --- The human-paced first hour (PLAN-PHASE11, --policy=human) ---------------------------------------------------------------
// tools/firstHour.mjs's new player, headless: the same machinery as runCampaign (battles by the bot, raids, events, Boons, the board,
// Generals, Quick Conquest), but a person's habits instead of the optimal shopper. It looks at the map, attacks the Easy or Fair region
// with the best ratio (the label on the map, commander credited as on the card), tries the best Hard one after 2 minutes with nothing better (and
// again 2 minutes later), and opens the War Council every 3 minutes, or every 45 s while nothing is worth attacking, where it presses the
// cheapest of three cards (Best value, the next power, Taxes) until the gold runs out (humanShop). No Works, no fortifications, no
// Renown spending. Every step costs a person's seconds (HUMAN). Virtual-player knobs, not game balance.
const HUMAN = Object.freeze({
  startSec: 20,        // the title, the realm reveal and the first hint before the first look at the map
  shopEverySec: 180,   // the War Council every 3 minutes of play (firstHour.mjs, from minute 2) ...
  idleShopSec: 45,     // ... and, with nothing worth attacking, again once 45 s have passed since the last visit
  shopSec: 8,          // a visit to the council
  idleStepSec: 30,     // nothing worth attacking: a person looks again every 30 s
  hardAfterSec: 120,   // ... and tries the best Hard region after 2 minutes of that
  aheadPatience: 2,    // ... holding most of the settlements at the patience mark (config/battle.js PATIENCE_SEC), a person fights on up to 2x it
  retrySec: 180,       // a region that beat us is tried again after 3 minutes (or sooner, once its card reads RETRY_MARGIN better)
  attackSec: 6,        // find the region, read the card, press Attack
  afterSec: 12,        // the results card, a Boon draft, the toasts
  maxPresses: 60,      // per visit: presses until the gold runs out (a backstop)
  armyBuys: 3,         // --shop=bot3: up to three Army buys per visit (firstHourBot.mjs)
});
const ARMY_ORDER = ['recruitment', 'steel', 'armour', 'logistics', 'muster']; // the Army tab's card order

function humanBuy(state, id, goldSpent) {
  const cost = upgradeCost(id, levelOf(state, id));
  if (!canBuy(state, id)) return false;
  buy(state, id);
  goldSpent[id] = (goldSpent[id] || 0) + cost;
  return true;
}

const costNow = (state, id) => upgradeCost(id, levelOf(state, id));

/**
 * One visit to the War Council. The default (a sensible person): it watches three cards, the Best value Army card, the cheapest power
 * (the next unlock or a level) and Taxes, and presses the cheapest of them until the gold runs out (at most HUMAN.maxPresses).
 * --shop=bot3 shops exactly as tools/firstHourBot.mjs does (the Best value card, else the first affordable Army card, up to
 * HUMAN.armyBuys times, a power it can unlock, a level of Taxes and of Plunder). --shop=cheapest / optimal: see runHumanHour.
 */
function humanShop(state, world, goldSpent, variant) {
  let n = 0;
  if (variant !== 'bot3') {
    for (let i = 0; i < HUMAN.maxPresses; i++) {
      const best = bestValueUpgrade(state, world);
      const power = [...POWER_ID_SET].sort((a, b) => costNow(state, a) - costNow(state, b))[0];
      const ids = [best && best.id, power, 'taxes'].filter(Boolean).sort((a, b) => costNow(state, a) - costNow(state, b));
      if (!humanBuy(state, ids[0], goldSpent)) break;
      n += 1;
    }
    return n;
  }
  for (let i = 0; i < HUMAN.armyBuys; i++) {
    const best = bestValueUpgrade(state, world);
    const id = best && canBuy(state, best.id) ? best.id : ARMY_ORDER.find((x) => canBuy(state, x));
    if (!id || !humanBuy(state, id, goldSpent)) break;
    n += 1;
  }
  const locked = [...POWER_ID_SET].filter((id) => levelOf(state, id) < 1).sort((a, b) => upgradeCost(a, 0) - upgradeCost(b, 0))[0];
  if (locked && humanBuy(state, locked, goldSpent)) n += 1;
  for (const id of ['taxes', 'plunder']) if (humanBuy(state, id, goldSpent)) n += 1;
  return n;
}

/**
 * Plays the first `flags.minutes` (60) minutes of a fresh realm the human way. Returns { seed, attacks, segs, metrics, raids }.
 * PLAN-PHASE14: with `flags.whole` it plays the whole continent instead (from `carry` = { state, world } for a later dynasty, as
 * runCampaign does), spends Renown as the optimal campaign does (--renown=off: never) and returns the continent's metrics (wholeMetrics).
 */
export function runHumanHour(seed, flags = {}, carry = null) {
  const whole = !!flags.whole;
  const endSec = whole ? MAX_WALL_SEC : Number(flags.minutes || 60) * 60;
  const world = carry ? carry.world : generateWorld(seed);
  const state = carry ? carry.state : createGame(seed, world, 0);
  const goldSpent = {};
  const battleDurations = [];
  const wall = { sec: 0 };
  const raidLog = newRaidLog();
  raidCtx = flags.raids === 'off' ? null : { state, mode: 'idle', log: raidLog, watchingUntil: 0, noEvents: flags.events === 'off' };
  unrestCtx = flags.unrest === 'off' ? null : state;
  if (!Array.isArray(state.battles)) state.battles = [];
  genCtx = flags.generals === 'off' ? null : { busy: null, noSpend: !whole || flags.renown === 'off', log: { xp: 0, festivals: 0, trains: 0, heals: 0, generalDefenses: 0, captainDefenses: 0 } };
  if (genCtx) Generals.ensureGenerals(state);
  bountyCtx = flags.bounties === 'off' ? null : { log: { completed: 0, gold: 0, renown: 0, xp: 0, byKind: {} } };
  quickCtx = flags.quick === 'off' ? null : { n: 0, won: 0 };
  boonCtx = flags.boons === 'off' ? null : { recent: [], picks: [], plunder: 0, goldLost: 0, champEye: 0 };
  humanCtx = flags.patience !== 'strict';
  const segs = []; // { a, b, ok }: ok = an Easy or Fair fight was there to take (or being fought)
  const attacks = [];
  const blocked = new Map(); // region id -> when its arena could not be built (a busy border; whole continents look again HUMAN.retrySec later)
  // the labels on the MAP are what a person scans for a fight: since PLAN-PHASE11 they credit the card's default commander (world.js);
  // --labels=plain reads them without it (the map before Phase 11)
  const cards = () => attackableFrontier(state, world).filter((id) => !blocked.has(id) || (whole && wall.sec - blocked.get(id) >= HUMAN.retrySec))
    .map((regionId) => { const cmdr = flags.labels !== 'plain' ? pickCommander(state, world, regionId, 'attack', wall.sec * 1000) : null; return { regionId, diff: difficulty(state, world, regionId, cmdr ? { commander: cmdr } : {}) }; }).sort((a, b) => b.diff.ratio - a.diff.ratio);
  // a region that beat us is left until its card reads RETRY_MARGIN better or HUMAN.retrySec have passed (a person does not replay the same lost fight at once)
  const lost = new Map();
  const fresh = (c) => { const l = lost.get(c.regionId); return !l || c.diff.ratio >= l.ratio * RETRY_MARGIN || wall.sec - l.at >= HUMAN.retrySec; };
  const worth = (c) => fresh(c) && (c.diff.surrender || c.diff.label === 'Easy' || c.diff.label === 'Fair');
  const spend = (sec, ok) => { const a = wall.sec; advanceClock(state, world, wall, sec); segs.push({ a, b: wall.sec, ok }); };
  // --shop=optimal: the optimal campaign's buying (everything affordable, cheapest first, Works included) at the human's visits
  const net = () => state.owner.filter((o) => o === PLAYER_FACTION).length - 1;
  const shop = () => (flags.shop === 'optimal' ? buyingPass(state, world, net(), flags, goldSpent)
    : flags.shop === 'cheapest' ? buyingPass(state, world, net(), { ...flags, works: 'none', forts: 'none' }, goldSpent)
    : humanShop(state, world, goldSpent, flags.shop));
  spend(HUMAN.startSec, true);
  let lastShop = -Infinity;
  let noTargetSince = null;
  let doneAt = null;
  for (let guard = 0; wall.sec < endSec && guard < (whole ? 60000 : 5000); guard++) {
    bountyEnsure(state, world);
    if (wall.sec >= 120 && wall.sec - lastShop >= HUMAN.shopEverySec) {
      shop(); lastShop = wall.sec;
      if (whole) spendRenown(state, world, wall.sec * 1000);
      spend(HUMAN.shopSec, cards().some(worth));
    }
    const list = cards();
    let pick = list.find(worth) || null;
    let hard = false;
    if (pick) noTargetSince = null;
    else {
      if (noTargetSince == null) noTargetSince = wall.sec;
      if (wall.sec - noTargetSince >= HUMAN.hardAfterSec) {
        pick = list.find((c) => fresh(c) && c.diff.label === 'Hard') || null;
        if (pick) { hard = true; noTargetSince = wall.sec; }
      }
    }
    if (!pick && !frontier(state, world).some((id) => world.regions[id].type !== 'dragon')) { doneAt = wall.sec; break; } // the continent is whole: the hour ends here (Found a Dynasty)
    if (!pick) {
      if (wall.sec - lastShop > HUMAN.idleShopSec) { shop(); lastShop = wall.sec; }
      if (flags.trace && Math.floor(wall.sec / 120) !== Math.floor((wall.sec + HUMAN.idleStepSec) / 120)) {
        console.log(`  ${(wall.sec / 60).toFixed(1)}m gold ${Math.round(state.gold)} income ${incomePerSec(state, world).toFixed(1)}/s unrest ${state.unrest ? `${state.unrest.target}:${JSON.stringify(state.unrest.thin)} idle ${Math.round(state.unrest.idleSec)}` : "-"}; `
          + list.slice(0, 5).map((c) => `${c.diff.label[0]} ${c.diff.ratio.toFixed(2)} t${world.regions[c.regionId].tier} d${enemyDepth(world, world.regions[c.regionId]).toFixed(1)} ${world.factions[world.regions[c.regionId].faction].personality.slice(0, 4)}${world.regions[c.regionId].isCapital ? "C" : ""} s${Math.round(c.diff.strength)}`).join(' | '));
      }
      spend(HUMAN.idleStepSec, false);
      continue;
    }
    spend(HUMAN.attackSec, !hard);
    const t0 = wall.sec;
    const res = attemptConquest(state, world, pick.regionId, wall, battleDurations, state.stats.battlesWon === 0);
    if (res.unattackable) { blocked.set(pick.regionId, wall.sec); continue; }
    segs.push({ a: t0, b: wall.sec, ok: !hard });
    if (!res.won) lost.set(pick.regionId, { ratio: pick.diff.ratio, at: wall.sec });
    else if (hooks.onConquest) hooks.onConquest(state, world, { n: net(), wallSec: wall.sec, human: true }); // PLAN-PHASE15: the label audit's probes
    attacks.push({ t: t0, sec: wall.sec - t0, label: pick.diff.label, ratio: pick.diff.ratio, won: res.won, kind: res.surrendered ? 'surrender' : res.quick ? 'quick' : 'battle', regionId: pick.regionId, hard, timedOut: !!res.timedOut });
    spend(HUMAN.afterSec, !hard);
  }
  const raids = raidCtx ? { firstRaidSec: raidLog.firstRaidSec, announced: raidLog.announced } : null;
  raidCtx = null; genCtx = null; bountyCtx = null; quickCtx = null; boonCtx = null; humanCtx = false; unrestCtx = null;
  if (whole) {
    const out = {
      seed, dynasty: state.dynasty.level, attacks, segs, doneAt, stallReason: doneAt == null ? `not whole within ${fmtSec(wall.sec)}` : null,
      regions: world.regions.length, crown: !!state.crownOfAges, ascension: state.ascension || 0, edict: state.edict ? state.edict.id : null,
      archipelago: !!state.archipelago, rivals: (state.rivals || []).map((f) => world.factions[f] && world.factions[f].personality),
      battleDurations, raids: raidLog, goldSpent, metrics: wholeMetrics(attacks, segs, doneAt != null ? doneAt : wall.sec),
    };
    Object.defineProperty(out, 'endState', { value: { state, world }, enumerable: false });
    return out;
  }
  return { seed, attacks, segs, raids, unrest: state.unrest ? { ...state.unrest, thin: { ...state.unrest.thin } } : null, upgrades: { ...state.upgrades }, goldSpent, owned: state.owner.filter((o) => o === PLAYER_FACTION).length, doneAt, metrics: humanMetrics(attacks, segs, doneAt != null ? Math.min(endSec, doneAt) : endSec) };
}

/**
 * PLAN-PHASE14: a whole continent at a human pace. humanMetrics over the continent, plus the continent's time, the longest WAIT (as the
 * optimal campaign counts it: the end of one conquest to the start of the battle that wins the next, lost and Hard tries included), where
 * it fell, the share of the time spent in battles, timeouts and Hard tries.
 */
export function wholeMetrics(attacks, segs, endSec) {
  const m = humanMetrics(attacks, segs, endSec);
  let prev = 0;
  let longestWait = 0;
  let longestWaitAt = 0;
  const waits = [];
  for (const a of attacks) {
    if (!a.won) continue;
    const w = a.t - prev;
    waits.push(w);
    if (w > longestWait) { longestWait = w; longestWaitAt = prev; }
    prev = a.t + a.sec;
  }
  const inBattle = attacks.reduce((s, a) => s + a.sec, 0);
  return {
    ...m, timeSec: endSec, longestWait, longestWaitAt, waits, battleShare: endSec > 0 ? inBattle / endSec : 0,
    timeouts: attacks.filter((a) => a.timedOut).length, hardTries: attacks.filter((a) => a.hard).length,
    lost: attacks.filter((a) => !a.won).length,
  };
}

/** Battles started in the hour, the share of minutes after minute 3 with an Easy or Fair fight to take, the longest stretch without one. */
export function humanMetrics(attacks, segs, endSec) {
  const battles = attacks.filter((x) => x.t < endSec).length;
  let ok = 0;
  let n = 0;
  for (let m = 3; m < endSec / 60; m++, n++) if (segs.some((s) => s.ok && s.b > m * 60 && s.a < m * 60 + 60)) ok += 1;
  let longest = 0;
  let longestAt = 0;
  let cur = 0;
  let from = 0;
  for (const s of segs) {
    if (s.a >= endSec) break;
    if (s.ok) { cur = 0; continue; }
    if (cur === 0) from = s.a;
    cur += Math.min(s.b, endSec) - s.a;
    if (cur > longest) { longest = cur; longestAt = from; }
  }
  let gap = 0; // the longest wait between two fights (Hard ones too): the end of one battle to the start of the next, or to the end of the hour
  for (let i = 0, prevEnd = 0; i <= attacks.length; i++) {
    const next = i < attacks.length ? Math.min(endSec, attacks[i].t) : endSec;
    gap = Math.max(gap, next - prevEnd);
    if (i < attacks.length) prevEnd = Math.min(endSec, attacks[i].t + attacks[i].sec);
  }
  return { battles, won: attacks.filter((x) => x.t < endSec && x.won).length, avail: n ? ok / n : 1, longestIdleSec: longest, longestIdleAt: longestAt, longestGapSec: gap };
}

function printHuman(seeds, flags) {
  const runs = seeds.map((s) => runHumanHour(s, flags));
  const fmtM = (sec) => `${(sec / 60).toFixed(1)}m`;
  console.log(`\n=== human-paced first ${flags.minutes || 60} min (PLAN-PHASE11) ===`);
  console.log('  seed  battles (won)  Easy/Fair minutes  longest idle (at)  longest gap  first raid  regions');
  for (const r of runs) {
    const m = r.metrics;
    console.log(`  ${String(r.seed).padStart(4)}  ${String(m.battles).padStart(7)} (${String(m.won).padStart(2)})  ${`${Math.round(100 * m.avail)}%`.padStart(17)}  ${fmtM(m.longestIdleSec).padStart(6)} @${fmtM(m.longestIdleAt).padStart(5)}  ${fmtM(m.longestGapSec).padStart(11)}  ${(r.raids && r.raids.firstRaidSec != null ? fmtM(r.raids.firstRaidSec) : '-').padStart(10)}  ${String(r.owned).padStart(7)}${r.doneAt != null ? ` (whole at ${fmtM(r.doneAt)})` : ''}`);
    if (flags.verbose) console.log('        ' + r.attacks.map((x) => `${(x.t / 60).toFixed(1)}${x.label[0]}${x.won ? '' : 'x'}${x.kind === 'battle' ? '' : x.kind[0]}`).join(' '));
  }
  const med = (fn) => median(runs.map(fn));
  console.log(`  median: ${med((r) => r.metrics.battles)} battles, Easy/Fair ${Math.round(100 * med((r) => r.metrics.avail))}% of minutes, longest idle ${fmtM(med((r) => r.metrics.longestIdleSec))} (gap between fights ${fmtM(med((r) => r.metrics.longestGapSec))}), first raid ${fmtM(med((r) => (r.raids && r.raids.firstRaidSec != null ? r.raids.firstRaidSec : Infinity)))}`);
  console.log(`  targets: >= 18 battles, >= 75%, <= 4.0m`);
  return runs;
}

/**
 * Plays `count` dynasties in a row exactly as the game does (DESIGN §5.4): when the continent is whole, foundDynasty
 * with a freshly generated, larger world (regionsPerDynasty), the stars earned so far, tougher enemies
 * (enemyMultPerDynasty), upgrades and gold reset, lifetime stats kept (so surrender is open from the first minute).
 * Returns one runCampaign result per dynasty; a dynasty that stalls ends the run.
 */
export function runDynasties(seed, count, flags = {}, from = null) {
  const out = [];
  let carry = from ? from.carry : null;
  for (let level = from ? from.level : 1; level <= count; level++) {
    // PLAN-PHASE14: --policy=human plays every continent at a person's pace (runHumanHour with `whole`), with a person's Legacy and Edict
    const r = flags.policy === 'human' ? runHumanHour(seed, { ...flags, whole: true }, carry) : runCampaign(seed, flags, carry);
    out.push(r);
    if (r.stallReason || level === count) break;
    carry = foundNext(r, seed, level, flags);
    if (!carry) break;
  }
  return out;
}

/**
 * The founding that follows dynasty `level`'s finished run `r` (DESIGN §5.4): the Legacy, the Edict, the Crown and Ascension choices,
 * the next continent generated. Returns { state, world } for the next runCampaign / runHumanHour, or null. MUTATES r (r.founding) and
 * consumes r.endState (pass a structuredClone of it to fork one realm into two foundings).
 */
export function foundNext(r, seed, level, flags = {}, endState = r.endState) {
  const { state } = endState;
  const newSeed = hash32(seed, 'dynasty', level + 1);
  const human = flags.policy === 'human';
  // Phase 5 (PLAN-PHASE5 pacing guard): the Edict (--edict=first, the default: the first one offered; --edict=<id> forces one on
  // every founding; --edict=none: standard rules), the Challenges (--challenges=a,b) and the Legacy bought greedily (--legacy=off: none).
  // PLAN-PHASE14: the human policy buys Legacy by a person's wish list and takes the Edict a person prefers among those offered
  const legacyBuys = flags.legacy === 'off' ? [] : human && flags.legacy !== 'greedy' ? humanLegacy(state) : greedyLegacy(state);
  const edictFlag = flags.edict || (human ? 'prefer' : 'first');
  const offered = () => edictChoices(state, newSeed, { legacyNodes: previewNodes(state, legacyBuys) }).map((e) => e.id);
  const edict = edictFlag === 'none' ? null : edictFlag === 'first' ? offered()[0]
    : edictFlag === 'prefer' ? offered().sort((a, b) => HUMAN_EDICT_ORDER.indexOf(a) - HUMAN_EDICT_ORDER.indexOf(b))[0] : edictFlag;
  const challenges = flags.challenges ? String(flags.challenges).split(',') : [];
  // PLAN-PHASE13: --crown=N seeks the Crown of Ages at every founding of dynasty N or later (when it is offered); --ascension=N founds at
  // that level (clamped by the game: 0 until crowned) or --ascension=max at the highest open one
  const crownOfAges = !!flags.crown && level + 1 >= Number(flags.crown);
  const ascension = flags.ascension === 'max' ? 99 : Number(flags.ascension) || 0;
  const next = foundDynasty(state, newSeed, undefined, endState.world, { edict, challenges, legacyBuys, crownOfAges, ascension }); // an unslain Dragon's Lair does not block founding
  if (!next) return null;
  if (flags.rivals === 'classic') next.rivals = [2, 3, 4]; // PLAN-PHASE6 guard: --rivals=classic plays every dynasty against the classic three
  // PLAN-PHASE13 guard: --ascensionForce=N plays every dynasty from --ascensionFrom (default 3) at Ascension N, crowned or not
  if (flags.ascensionForce != null && next.dynasty.level >= Number(flags.ascensionFrom || 3)) next.ascension = Number(flags.ascensionForce);
  // PLAN-PHASE12 guard: --archipelago=force makes every founding from dynasty 3 an archipelago (with the Sea Kings), --archipelago=off none
  if ((flags.archipelago === 'force' || flags.archipelago === 'off') && next.dynasty.level >= ARCHIPELAGO.fromDynasty) {
    next.archipelago = flags.archipelago === 'force';
    next.rivals = flags.rivals === 'classic' ? [2, 3, 4] : rivalsFor(newSeed, next.dynasty.level, { archipelago: next.archipelago });
  }
  const world = generateWorld(newSeed, worldOptsFor(next));
  resetRegions(next, world, state.lastSeen);
  r.founding = { edict, legacyBuys: next.founding ? next.founding.bought : [] };
  Works.resetWorks(next); // a new continent: no Works (state.js's resetRegions does the same once integration has patched it)
  return { state: next, world };
}

// PLAN-PHASE14: a person's choices at a founding (virtual-player knobs, not game balance). The Edict: the first of these among those offered
// (calm and gold first, the slow-march and raid-heavy ones last, as a reader of the cards would). The Legacy: this wish list, each node
// bought as soon as it is affordable and unlocked (a person reaches for the obvious army and economy nodes, the Court last).
const HUMAN_EDICT_ORDER = ['peaceOfCrowns', 'merchantPrinces', 'ageOfIron', 'bountyHunters', 'openRoads', 'warriorKings', 'grandFestival',
  'ageOfDragons', 'ironFrontier', 'longWinter'];
const HUMAN_LEGACY_ORDER = ['veteranCamp', 'oldRoads', 'swiftBanners', 'royalTreasury', 'heralds', 'quickConquest', 'warChest', 'masons',
  'drillmasters', 'scribes', 'patronage', 'warlord', 'oldAlliances', 'spymaster', 'kingmaker'];

function humanLegacy(state) {
  const l = state.generals && state.generals.legacy ? state.generals.legacy : { v: 1, points: 0, spent: 0, nodes: {}, pendingBonus: 0 };
  const sim = { generals: { legacy: { ...l, nodes: { ...l.nodes }, points: (l.points || 0) + legacyPointsForFounding(state) } } };
  const cost = new Map(legacyTree().flatMap((b) => b.nodes).map((n) => [n.id, n.cost]));
  const buys = [];
  for (let guard = 0; guard < 20; guard++) {
    const info = legacyInfo(sim);
    const pick = HUMAN_LEGACY_ORDER.find((id) => info.nodes[id] === 'buyable');
    if (!pick) break;
    sim.generals.legacy.nodes[pick] = true;
    sim.generals.legacy.spent += cost.get(pick);
    buys.push(pick);
  }
  return buys;
}

/** The Legacy nodes a greedy player buys at a founding: the cheapest buyable node, again and again (tree order on a tie). */
function greedyLegacy(state) {
  const l = state.generals && state.generals.legacy ? state.generals.legacy : { v: 1, points: 0, spent: 0, nodes: {}, pendingBonus: 0 };
  const sim = { generals: { legacy: { ...l, nodes: { ...l.nodes }, points: (l.points || 0) + legacyPointsForFounding(state) } } };
  const order = legacyTree().flatMap((b) => b.nodes);
  const buys = [];
  for (let guard = 0; guard < 20; guard++) {
    const info = legacyInfo(sim);
    const pick = order.filter((n) => info.nodes[n.id] === 'buyable').sort((a, b) => a.cost - b.cost)[0];
    if (!pick) break;
    sim.generals.legacy.nodes[pick.id] = true;
    sim.generals.legacy.spent += pick.cost;
    buys.push(pick.id);
  }
  return buys;
}

function previewNodes(state, buys) {
  const nodes = { ...((state.generals && state.generals.legacy && state.generals.legacy.nodes) || {}) };
  for (const id of buys) nodes[id] = true;
  return nodes;
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
  if (r.raids) printRaids([r], '  ');
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
    // Region Works: the share of everything spent that went into them, and how many were built (medians over seeds)
    worksShare: median(results.map((r) => {
      const all = Object.values(r.summary.goldSpent).reduce((a, b) => a + b, 0);
      const works = Object.entries(r.summary.goldSpent).filter(([k]) => k.startsWith('work:')).reduce((a, [, v]) => a + v, 0);
      return all > 0 ? works / all : 0;
    })),
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
    raidResults: results.filter((r) => r.raids),
    genResults: results.map((r) => r.generals).filter(Boolean),
  };
}

/** The Living Frontier table (DESIGN §10): pace, defense odds in person and by the Steward, losses, retakes. */
export function raidTable(results) {
  const all = results.map((r) => r.raids).filter(Boolean);
  const sum = (fn) => all.reduce((a, x) => a + fn(x), 0);
  const defenses = all.flatMap((x) => x.defenses);
  const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) : null);
  const band = (rows) => ({ n: rows.length, won: rows.filter((d) => d.won).length, pct: pct(rows.filter((d) => d.won).length, rows.length) });
  const early = (d) => d.depth < 2.5;
  const retakes = all.flatMap((x) => x.retakes);
  const firsts = all.map((x) => x.firstRaidSec).filter((v) => v != null);
  return {
    seeds: all.length,
    announced: sum((x) => x.announced),
    perRivalPer10Min: sum((x) => x.rivalSec) > 0 ? sum((x) => x.announced) / (sum((x) => x.rivalSec) / 600) : null,
    promisedPerRivalPer10Min: sum((x) => x.rivalSec) > 0 ? sum((x) => x.rateSec) / (sum((x) => x.rivalSec) / 600) : null,
    firstRaidMedianSec: median(firsts),
    inPerson: band(defenses.filter((d) => d.inPerson)),
    inPersonEarly: band(defenses.filter((d) => d.inPerson && early(d))),
    steward: band(defenses.filter((d) => !d.inPerson)),
    stewardEarly: band(defenses.filter((d) => !d.inPerson && early(d))),
    fortified: band(defenses.filter((d) => d.forts >= 2)),
    lostPerSeed: all.map((x) => x.lost.length),
    maxOccupied: Math.max(0, ...all.map((x) => x.maxOccupied)),
    retakes: retakes.length,
    retakeLabels: retakes.reduce((m, x) => { m[x.label] = (m[x.label] || 0) + 1; return m; }, {}),
    awayRaids: sum((x) => x.away.reduce((a, rep) => a + rep.raids.length, 0)),
    awayLost: sum((x) => x.away.reduce((a, rep) => a + rep.lost.length, 0)),
    predicted: defenses.length ? defenses.reduce((a, d) => a + d.winChance, 0) / defenses.length : null,
    actual: defenses.length ? defenses.filter((d) => d.won).length / defenses.length : null,
  };
}

function printRaids(results, pad = '') {
  const t = raidTable(results);
  const f = (b) => (b.n ? `${b.pct}% of ${b.n}` : 'n/a');
  console.log(`${pad}living frontier: ${t.announced} raids, ${t.perRivalPer10Min == null ? 'n/a' : t.perRivalPer10Min.toFixed(2)} per bordering rival per 10 min (rates promise ${t.promisedPerRivalPer10Min == null ? 'n/a' : t.promisedPerRivalPer10Min.toFixed(2)}), first raid at ${fmtSec(t.firstRaidMedianSec)} (median)`);
  console.log(`${pad}  held in person ${f(t.inPerson)} (early war bands ${f(t.inPersonEarly)}); by the Militia Captain ${f(t.steward)} (early ${f(t.stewardEarly)}); with 2+ fortifications ${f(t.fortified)}`);
  console.log(`${pad}  label check: predicted ${t.predicted == null ? 'n/a' : (100 * t.predicted).toFixed(0)}% vs held ${t.actual == null ? 'n/a' : (100 * t.actual).toFixed(0)}%`);
  console.log(`${pad}  regions lost per seed [${t.lostPerSeed.join(',')}], most occupied at once ${t.maxOccupied}; retakes ${t.retakes} (${Object.entries(t.retakeLabels).map(([k, v]) => k + ' ' + v).join(', ') || '-'}); away raids ${t.awayRaids}, lost away ${t.awayLost}`);
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
  if (agg.worksShare) console.log(`  median share of all gold spent on Region Works: ${(agg.worksShare * 100).toFixed(1)}%`);
  console.log('  frontier regions readable as Easy/Fair right after conquest n (seeds with NONE before / after shopping, median after):');
  for (const [n, v] of Object.entries(agg.earlyReadout)) console.log(`    after conquest ${n}: none before shop ${v.noneBefore}/${v.seeds}, none after shop ${v.noneAfter}/${v.seeds}, median ${v.median}`);
  if (agg.raidResults.length) printRaids(agg.raidResults, '  ');
  const gens = agg.genResults;
  if (gens.length) {
    const m = (fn) => median(gens.map(fn));
    console.log(`  generals and renown (medians per seed): Renown earned ${m((g) => g.renown.earned)} (crowns ${m((g) => g.renown.log.crown)}, defenses ${m((g) => g.renown.log.defense)}, retakes ${m((g) => g.renown.log.retake)}, capitals ${m((g) => g.renown.log.capital)}), festivals ${m((g) => g.festivals)}, trainings ${m((g) => g.trains)}, heals ${m((g) => g.heals)}`);
    console.log(`    Marshal level ${m((g) => g.roster.find((x) => x.id === 'marshal').level)}, roster size ${m((g) => g.roster.length)}; raids commanded by a General ${m((g) => g.generalDefenses)} vs the Captain ${m((g) => g.captainDefenses)}; prosperity share of region income at the end ${(100 * m((g) => g.prosperityShare)).toFixed(1)}%`);
  }
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
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (rs, fn) => { const bs = rs.flatMap((r) => r.battleDurations); return bs.length ? `${Math.round((100 * bs.filter(fn).length) / bs.length)}%` : '-'; };

/**
 * PLAN-PHASE7 pacing guard: win rate and battle time per Boon. Every attack battle the campaigns fought is tagged with the Boons owned
 * at the time; for each Boon, the battles with it are compared with the battles WITHOUT it in the same dynasty level (the progression
 * confound is the same on both sides only roughly: later battles carry more Boons, so read the deltas, not the absolutes).
 */
export function boonTable(all) {
  const battles = all.flat().flatMap((r) => r.battleDurations.filter((b) => Array.isArray(b.boons)));
  const rows = [];
  for (const boon of BOON_LIST) {
    const w = battles.filter((b) => b.boons.includes(boon.id));
    if (!w.length) { rows.push({ id: boon.id, n: 0 }); continue; }
    const levels = new Set(w.map((b) => b.dynasty));
    const wo = battles.filter((b) => !b.boons.includes(boon.id) && levels.has(b.dynasty));
    const stat = (xs) => ({ n: xs.length, win: xs.filter((b) => b.won).length / Math.max(1, xs.length), sec: mean(xs.map((b) => b.sec)) });
    rows.push({ id: boon.id, rarity: boon.rarity, cursed: boon.cursed, with: stat(w), without: stat(wo) });
  }
  return rows;
}

function printBoonTable(all) {
  const rows = boonTable(all).filter((r) => r.n !== 0).sort((a, b) => (a.with.sec - a.without.sec) - (b.with.sec - b.without.sec));
  console.log('\n=== per-Boon battles (with vs without, same dynasty levels) ===');
  console.log('  boon             rarity     n   win%   sec  |  w/o n  win%   sec  | Δwin  Δsec');
  for (const r of rows) {
    const d = (r.with.win - r.without.win) * 100;
    console.log(`  ${r.id.padEnd(16)} ${(r.rarity + (r.cursed ? '*' : '')).padEnd(10)} ${String(r.with.n).padStart(3)}  ${(r.with.win * 100).toFixed(0).padStart(4)}  ${r.with.sec.toFixed(0).padStart(4)}  |  ${String(r.without.n).padStart(4)}  ${(r.without.win * 100).toFixed(0).padStart(4)}  ${r.without.sec.toFixed(0).padStart(4)}  | ${d >= 0 ? '+' : ''}${d.toFixed(0).padStart(3)}  ${(r.with.sec - r.without.sec).toFixed(0).padStart(4)}`);
  }
  const never = boonTable(all).filter((r) => r.n === 0).map((r) => r.id);
  if (never.length) console.log('  never owned in a battle: ' + never.join(', '));
}

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
    const rs = all.map((a) => a[d]).filter(Boolean);
    const med = (fn) => median(rs.map(fn));
    const v = rs.reduce((acc, r) => { const x = r.raids ? r.raids.vendettas : null; if (x) { acc.n += x.n; acc.won += x.won; acc.fell += x.championFell; } return acc; }, { n: 0, won: 0, fell: 0 });
    const kinds = {};
    for (const r of rs) for (const [k, n] of Object.entries(r.goals ? r.goals.bounties.byKind : {})) kinds[k] = (kinds[k] || 0) + n;
    const q = rs.reduce((acc, r) => ({ n: acc.n + (r.quick ? r.quick.n : 0), won: acc.won + (r.quick ? r.quick.won : 0) }), { n: 0, won: 0 });
    const edicts = d > 0 ? all.map((a) => (a[d - 1] && a[d - 1].founding ? a[d - 1].founding.edict || '-' : '-')) : [];
    if (d > 0) console.log(`      phase 5: Edicts ${edicts.join(' ')}; Legacy bought ${all[0][d - 1] && all[0][d - 1].founding ? all[0][d - 1].founding.legacyBuys.join('+') || '-' : '-'} (seed ${seeds[0]}); Quick Conquests ${q.won}/${q.n}`);
    if (rs[0] && rs[0].boons) console.log(`      phase 7: Boons owned ${med((r) => r.boons.owned.length)} per seed (picks ${med((r) => r.boons.picks.length)}, duos ${rs.reduce((a, r) => a + r.boons.picks.filter((p) => p.duo).length, 0)}, champion's eye ${rs.reduce((a, r) => a + r.boons.champEye, 0)}), Relics ${med((r) => r.boons.relics.length)} per seed, Reliquary ${med((r) => r.boons.reliquary)}; plunder ${Math.round(med((r) => r.boons.plunder))}g, Fortune lost ${Math.round(med((r) => r.boons.goldLost))}g; battles won ${pct(rs, (b) => b.won)}, mean battle ${Math.round(mean(rs.flatMap((r) => r.battleDurations.map((b) => b.sec))))} s`);
    const ev = rs.reduce((acc, r) => { const e = r.raids && r.raids.events; if (e) for (const k of Object.keys(e)) acc[k] = (acc[k] || 0) + e[k]; return acc; }, {});
    console.log(`      phase 8: events ${['merchant', 'plague', 'duel', 'deserters', 'harvest'].map((k) => k + ' ' + (ev[k] || 0)).join(', ')} (accepted ${ev.accepted || 0}); Boon drafts end with ${med((r) => r.boons ? r.boons.owned.length : 0)} owned`);
    console.log(`      goals: contracts ${med((r) => r.goals.bounties.completed)} per seed (${Math.round(med((r) => r.goals.bounties.gold))}g), best streak ${med((r) => r.goals.bestStreak)}, vendettas ${v.n} (won ${v.won}, champion fell ${v.fell}), trophies ${med((r) => r.goals.trophies)}, deed tiers ${med((r) => r.goals.deedTiers)}; by kind ${Object.entries(kinds).map(([k, n]) => k + ' ' + n).join(', ')}`);
  }
  return all;
}

/** PLAN-PHASE14: --policy=human --dynasties=N: whole dynasties at a person's pace (--crown=7 makes the 7th the Crown of Ages). */
function printHumanDynasties(seeds, flags) {
  const n = Number(flags.dynasties);
  const all = seeds.map((seed) => runDynasties(seed, n, flags));
  const hrs = (sec) => (sec == null ? 'never' : `${(sec / 3600).toFixed(2)}h`);
  console.log(`\n=== ${n} dynasties per seed at a human pace (PLAN-PHASE14) ===`);
  console.log('  seed  ' + Array.from({ length: n }, (_, d) => `D${d + 1}: time, longest wait, Easy/Fair`).join(' | '));
  for (let i = 0; i < seeds.length; i++) {
    console.log(`  ${String(seeds[i]).padStart(4)}  ` + all[i].map((r) => `${hrs(r.doneAt).padStart(6)} ${String(Math.round(r.metrics.longestWait / 60)).padStart(3)}m ${String(Math.round(100 * r.metrics.avail)).padStart(3)}%${r.crown ? ' C' : ''}${r.stallReason ? ' STALL' : ''}`).join(' | '));
  }
  for (let d = 0; d < n; d++) {
    const rs = all.map((a) => a[d]).filter(Boolean);
    const waits = rs.map((r) => r.metrics.longestWait / 60);
    const dm = median(rs.map((r) => r.doneAt ?? Infinity));
    const worst = [...rs].sort((a, b) => (b.doneAt ?? Infinity) - (a.doneAt ?? Infinity)).slice(0, 3).map((r) => `seed ${r.seed} ${hrs(r.doneAt)}`).join(', ');
    const battles = rs.reduce((a, r) => a + r.metrics.battles, 0);
    console.log(`  D${d + 1}: median ${hrs(Number.isFinite(dm) ? dm : null)}; longest wait over 30 min on ${waits.filter((w) => w > 30).length} of ${rs.length} seeds, `
      + `over 60 on ${waits.filter((w) => w > 60).length}, worst ${Math.round(Math.max(...waits))} min; Easy/Fair ${Math.round(100 * median(rs.map((r) => r.metrics.avail)))}% of minutes; `
      + `battles ${median(rs.map((r) => r.metrics.battles))} per seed (${Math.round((100 * rs.reduce((a, r) => a + r.metrics.won, 0)) / Math.max(1, battles))}% won, ${rs.reduce((a, r) => a + r.metrics.timeouts, 0)} timeouts); slowest ${worst}`);
  }
  return all;
}

async function main() {
  const t0 = Date.now();
  const flags = parseArgs(process.argv.slice(2));
  const seeds = (flags.seeds ? String(flags.seeds).split(',') : ['1', '2', '3', '4', '5']).map(Number);

  if (flags.policy === 'human' && Number(flags.dynasties) > 1) { printHumanDynasties(flags.seeds ? seeds : Array.from({ length: 12 }, (_, i) => i + 1), flags); return; }
  if (flags.policy === 'human') { printHuman(flags.seeds ? seeds : [1, 2, 3, 4, 5, 6, 7, 8], flags); return; }
  if (Number(flags.dynasties) > 1) { const all = printDynasties(seeds, flags); if (flags.boonReport) printBoonTable(all); return; }
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
