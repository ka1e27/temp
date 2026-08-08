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
import { UNIT_IDS } from '../src/content/balance.js';

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
 * A deliberately ordinary player: expands toward soft targets, keeps a home
 * garrison, and only commits when it can actually BREACH — which is the lesson
 * the siege rules exist to teach. If a competent-but-unremarkable player cannot
 * clear a region, that region is mis-tuned.
 */
export function playerTurn(state) {
  const mine = state.sites.filter((s) => s.owner === 'player');
  const inFlight = new Set(state.squads.filter((q) => q.owner === 'player').map((q) => q.from));

  for (const src of mine) {
    const garrison = total(src.garrison);
    const floor = src.kind === 'camp' ? HOME_FLOOR : 3;
    if (garrison <= floor + 3) continue;
    // A wave already left here — only send a second if we are still strong.
    // Sitting on an unused army is the classic way to lose a winnable map.
    if (inFlight.has(src.id) && garrison < floor + 15) continue;

    // Commit only what we can spare above the floor.
    const fraction = Math.min(0.75, (garrison - floor) / garrison);
    const send = {};
    for (const u of UNIT_IDS) send[u] = Math.floor((src.garrison[u] || 0) * fraction);
    if (total(send) < 5) continue;

    let best = null;
    let bestScore = Infinity;
    for (const id of src.adj) {
      const t = state.sites.find((x) => x.id === id);
      if (!t || t.owner === 'player' || t.siege?.owner === 'player') continue;

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

    if (best) {
      state.commands.push({ t: 'SEND', from: src.id, to: best.id, fraction, filter: UNIT_IDS });
    }
  }

  // Push the rear army forward.
  //
  // Sends are adjacency-only, so a camp ringed by your own sites accumulates an
  // army it can never use — 80 units sitting at cap while the front line holds
  // with 4. This is what rally points automate for a human player, and it is
  // the single biggest difference between a stalled game and a won one.
  const front = frontDistance(state);
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
    state.commands.push({
      t: 'SEND', from: src.id, to: forward.id,
      fraction: Math.min(0.75, (garrison - floor) / garrison), filter: UNIT_IDS,
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
}

/**
 * Spend a realistic idle budget the way a player would: cheapest useful thing
 * first. Without this the harness tests an unupgraded player against later
 * regions, which is not a case the design claims is winnable.
 */
export function spendCrowns(meta, crowns) {
  meta.crowns += crowns;
  for (let guard = 0; guard < 400; guard++) {
    const affordable = shopListing(meta)
      .flatMap((g) => g.items)
      .filter((i) => i.affordable && i.level < i.maxLevel)
      .sort((a, b) => a.cost - b.cost);
    if (!affordable.length) break;
    buy(meta, affordable[0].id, null);
  }
  recalcIncome(meta, null);
}

/** A meta state for a player who has taken `conquered` and idled `idleMinutes`. */
export function metaFor(conquered, idleMinutes = 0, seed = 1) {
  const state = createState({ seed, now: 0 });
  for (const id of conquered) markConquered(state.meta, id, { now: 0, durationMs: 0 });
  refreshUnlocks(state.meta, null);
  recalcIncome(state.meta, null);
  if (idleMinutes > 0) {
    spendCrowns(state.meta, incomePerSec(state.meta) * idleMinutes * 60);
  }
  return state;
}

/** Start one battle for that player. Exposed so a test can drive it tick by
 *  tick and watch what the AI does, rather than only reading the verdict. */
export function startRun(regionId, seed, conquered, idleMinutes = 0) {
  const state = metaFor(conquered, idleMinutes, seed);
  const config = buildBattleConfig(state.meta, regionId, [], generateBattleMap, { seed });
  return startBattle(config);
}

/** Run one battle to its end with the scripted player at the wheel. */
export function playOne(regionId, seed, conquered, idleMinutes = 0) {
  const battle = startRun(regionId, seed, conquered, idleMinutes);
  const cap = battle.rules.hardCapTicks;
  let nextThink = 0;
  while (battle.status === 'running' && battle.tick < cap) {
    if (battle.tick >= nextThink) { playerTurn(battle); nextThink = battle.tick + 20; }
    step(battle);
  }
  const mineN = battle.sites.filter((x) => x.owner === 'player').length;
  const foeN = battle.sites.filter((x) => x.owner === 'enemy').length;
  return { status: battle.status, ticks: battle.tick, cap, mineN, foeN };
}
