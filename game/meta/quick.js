// Quick Conquest (PLAN-PHASE5 §5D): an Easy region resolved headless, the real battle with the player's side commanded by the card's
// commander through the Steward (as the campaign tool runs unattended battles). Pure and incremental: create -> step (time-sliced by
// the caller) -> finish. The job is plain JSON and never enters state.battles. No DOM, no Date.now, no Math.random, no storage.
import { QUICK } from '../config/legacy.js';
import { TICK_SEC, patienceFor } from '../config/battle.js';
import { PLAYER_FACTION } from './state.js';
import { playerBattleStats, enemyBattleStats, difficulty, attackable, conquer } from './progression.js';
import { attackArenaOpts } from './frontier.js';
import { buildArena } from '../battle/arena.js';
import { createBattle, step, issue } from '../battle/sim.js';
import { think } from '../battle/ai.js';
import { stewardDecide } from '../battle/steward.js';
import { decide as botDecide } from '../battle/bot.js';
import { trackerOf, trackBattle, battleSummaryFor, awardCrowns } from './crowns.js';
import { generalById, commanderStyle, settleCommander } from './generals.js';
import { onBattleEnd, onConquest, claimCompleted } from './bounties.js';
import { onStreakBroken } from './streak.js';
import { edictMods, commanderFor } from './edicts.js';
import { boonBattleEnd } from './boons.js';

function busyHas(busy, regionId) {
  if (!busy) return false;
  const r = busy.regions ?? busy;
  return r instanceof Set ? r.has(regionId) : Array.isArray(r) ? r.includes(regionId) : false;
}

/**
 * Can this region be Quick-Conquered now? `{ ok }` or `{ ok:false, reason }`, reason one of QUICK.copy.refusals' keys:
 * 'locked' (no Legacy node) | 'owned' | 'busy' | 'type' (Bandit Hold, Lair) | 'capital' | 'attack' (not attackable) | 'label' (not Easy).
 * @param {{ busy?: { regions: Set<number> }|Set<number>|number[], commander?: string|null }} [opts]
 */
export function canQuickConquer(state, world, regionId, opts = {}) {
  const region = world.regions[regionId];
  if (!edictMods(state).quickConquest) return { ok: false, reason: 'locked' };
  if (!region || state.owner[regionId] === PLAYER_FACTION) return { ok: false, reason: 'owned' };
  if (busyHas(opts.busy, regionId) || (Array.isArray(state.battles) && state.battles.some((r) => r && r.regionId === regionId))) return { ok: false, reason: 'busy' };
  if (QUICK.excludedTypes.includes(region.type)) return { ok: false, reason: 'type' };
  if (QUICK.excludeCapitals && region.isCapital) return { ok: false, reason: 'capital' };
  if (!attackable(state, world, regionId)) return { ok: false, reason: 'attack' };
  const commander = commanderFor(state, opts.commander ?? null);
  if (difficulty(state, world, regionId, commander ? { commander } : {}).label !== QUICK.label) return { ok: false, reason: 'label' };
  return { ok: true };
}

/**
 * Builds the job: the real arena and battle (busy sites excluded, captured fortifications in), the commander (forced to none under
 * Lone Banner) and its Steward style. Throws like buildArena when no arena can be built: check canQuickConquer first.
 * @param {{ commander?: string|null, busy?: object, nowMs?: number }} [opts]
 * @returns {object} the job (plain JSON)
 */
export function createQuickConquest(state, world, regionId, opts = {}) {
  const commander = commanderFor(state, opts.commander ?? null);
  const general = commander ? generalById(state, commander) : null;
  const player = playerBattleStats(state, world, regionId, general ? { commander: general.id } : {});
  const enemy = enemyBattleStats(world, state, regionId);
  const arena = buildArena(world, state.owner, regionId, player, enemy, attackArenaOpts(state, world, regionId, opts.busy));
  const battle = createBattle(arena, player, enemy);
  const label = difficulty(state, world, regionId, general ? { commander: general.id } : {}).label;
  return {
    v: 1, quick: true, regionId, commander: general ? general.id : null, labelAtAttack: label,
    style: general ? commanderStyle(general) : QUICK.captainStyle,
    driver: opts.driver || QUICK.driver,
    capSec: opts.capSec ?? Math.min(QUICK.maxSimSec, patienceFor(world.regions[regionId], state.dynasty.level) * QUICK.patienceMult),
    battle, memo: {}, steps: 0,
  };
}

/**
 * Runs up to `maxSimSteps` steps of TICK_SEC (the enemy AI and the Steward think as in a live battle; the crown tracker is fed).
 * A battle that outlasts its patience cap is a retreat (a loss), as for the campaign's player. MUTATES the job.
 * @returns {{ done: boolean, progress: number }} progress 0..1 (simulated time over the cap; 1 when done)
 */
export function stepQuickConquest(job, maxSimSteps = 600) {
  const b = job.battle;
  const tracker = trackerOf(b);
  for (let i = 0; i < maxSimSteps && !b.result; i++) {
    if (b.t >= job.capSec) {
      b.result = 'retreat';
      b.stats.durationSec = b.t;
      break;
    }
    for (const cmd of think(b, b.t)) issue(b, cmd);
    const cmds = job.driver === 'bot' ? botDecide(b, b.t, job.memo) : stewardDecide(b, b.t, job.memo, job.style);
    for (const cmd of cmds) issue(b, cmd);
    step(b, TICK_SEC);
    trackBattle(tracker, b);
    job.steps += 1;
  }
  return { done: !!b.result, progress: b.result ? 1 : Math.min(0.99, b.t / job.capSec) };
}

/**
 * Applies a finished job: lifetime stats, `conquer` at QUICK.bountyShare of the bounty, the Victory crown only, the commander's XP or
 * wound, the Bounty Board (`summary.quick = true`: the `ability` contract does not count) and, on a loss, the broken streak.
 * MUTATES state. Call once, after stepQuickConquest returned done.
 * @returns {{ won, regionId, conquerResult?, crowns, crownAward?, commander, bounties: { gold, renown, xp, claimed }, summary }}
 */
export function finishQuickConquest(state, world, job, nowMs) {
  const b = job.battle;
  const regionId = job.regionId;
  const won = b.result === 'win';
  const stats = state.stats;
  stats.troopsSent += b.stats.sent;
  if (won) { stats.battlesWon += 1; stats.settlementsTaken += b.stats.captured; } else stats.battlesLost += 1;
  const run = { kind: 'attack', regionId, commander: job.commander, labelAtAttack: job.labelAtAttack, quick: true };
  const summary = { ...battleSummaryFor(trackerOf(b), b, run, world, state), quick: true };
  const crowns = { victory: won, swift: false, unbroken: false };
  summary.crowns = crowns;
  const out = { won, regionId, crowns, commander: null, bounties: { gold: 0, renown: 0, xp: 0, claimed: [] }, summary };
  const pay = (done) => {
    if (!done || !done.length) return;
    const r = claimCompleted(state, world, done, nowMs);
    out.bounties.gold += r.gold; out.bounties.renown += r.renown; out.bounties.xp += r.xp; out.bounties.claimed.push(...r.claimed);
  };
  if (won) {
    out.conquerResult = conquer(state, world, regionId, nowMs, { bountyShare: QUICK.bountyShare });
    out.crownAward = awardCrowns(state, world, regionId, crowns, out.conquerResult.bounty);
  } else {
    onStreakBroken(state, b.result === 'retreat' ? 'retreat' : 'lost');
  }
  out.boons = boonBattleEnd(state, world, b, b.result); // PLAN-PHASE7: Plunderers, Fortune Favours (a Quick Conquest drafts no Boons)
  out.commander = settleCommander(state, run, won ? 'win' : 'lose', nowMs);
  pay(onBattleEnd(state, world, run, b.result, summary));
  if (won) pay(onConquest(state, world, regionId, out.conquerResult));
  return out;
}
