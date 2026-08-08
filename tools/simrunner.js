// Headless balance harness. Plays N battles per region with a scripted player
// and reports win rate and duration against the region's target length.
//
// Balance becomes measurable instead of vibes:
//   node tools/simrunner.js                 # the vertical slice
//   node tools/simrunner.js --region=kaldan --n=50
import { startBattle, step } from '../src/battle/sim.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { createState } from '../src/core/store.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { recalcIncome, incomePerSec } from '../src/meta/idle.js';
import { shopListing, buy } from '../src/meta/upgrades.js';
import { REGIONS, REGION_BY_ID } from '../src/content/regions.data.js';
import { breachSeconds, siegeDps, total, resolveField } from '../src/battle/combat.js';
import { groundOf, siteDefMultOf } from '../src/battle/terrain.js';
import { UNIT_IDS } from '../src/content/balance.js';
import { TICK_HZ } from '../src/core/loop.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]),
);
const N = Number(args.n ?? 12);
const SLICE = ['riverfen', 'ashford', 'ironwood', 'saltmere', 'kaldan'];
const regionIds = args.region ? [args.region] : (args.all ? REGIONS.map((r) => r.id) : SLICE);

/** Farms first (economy wins fights), then the war machine, then the prize. */
const PRIORITY = { farm: 0, stronghold: 1, castle: 2, camp: 3 };
// Keep a real home guard, but not so large that the opening push never fires —
// the expedition exists to be spent, and the first minute is when enemy sites
// are still thinly held.
const HOME_FLOOR = 5;
const ATTACK_MARGIN = 1.5; // overkill to survive the defender's reinforcement

/**
 * A deliberately ordinary player: expands toward soft targets, keeps a home
 * garrison, and only commits when it can actually BREACH — which is the lesson
 * the siege rules exist to teach. If a competent-but-unremarkable player cannot
 * clear a region, that region is mis-tuned.
 */
function playerTurn(state) {
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

/** Hops from each owned site to the nearest one bordering an enemy/neutral. */
function frontDistance(state) {
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
 * Spend a realistic idle budget the way a player would: cheapest useful thing
 * first. Without this the harness tests an unupgraded player against later
 * regions, which is not a case the design claims is winnable.
 */
function spendCrowns(meta, crowns) {
  meta.crowns += crowns;
  for (let guard = 0; guard < 200; guard++) {
    const affordable = shopListing(meta)
      .flatMap((g) => g.items)
      .filter((i) => i.affordable && i.level < i.maxLevel)
      .sort((a, b) => a.cost - b.cost);
    if (!affordable.length) break;
    buy(meta, affordable[0].id, null);
  }
  recalcIncome(meta, null);
}

function playOne(regionId, seed, conquered, idleMinutes = 0) {
  const state = createState({ seed, now: 0 });
  // Simulate a player who has already taken everything before this region.
  for (const id of conquered) markConquered(state.meta, id, { now: 0, durationMs: 0 });
  refreshUnlocks(state.meta, null);
  recalcIncome(state.meta, null);

  // ...and who then spent the income those regions earned.
  if (idleMinutes > 0) {
    spendCrowns(state.meta, incomePerSec(state.meta) * idleMinutes * 60);
  }

  const config = buildBattleConfig(state.meta, regionId, [], generateBattleMap, { seed });
  const battle = startBattle(config);

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

console.log(`\n  region        n   win%   median   target    verdict`);
console.log(`  ${'-'.repeat(58)}`);

let anyBad = false;
for (const id of regionIds) {
  const region = REGION_BY_ID[id];
  if (!region) { console.log(`  unknown region "${id}"`); continue; }
  const before = SLICE.slice(0, Math.max(0, SLICE.indexOf(id)));

  const runs = [];
  const idleMin = Number(args.idle ?? 10);
  for (let i = 0; i < N; i++) runs.push(playOne(id, 1000 + i * 7919, before, idleMin));

  const wins = runs.filter((r) => r.status === 'win');
  const losses = runs.filter((r) => r.status === 'loss').length;
  const ahead = runs.filter((r) => r.status === 'timeout' && r.mineN > r.foeN).length;
  const behind = runs.filter((r) => r.status === 'timeout' && r.mineN <= r.foeN).length;
  const mins = runs.map((r) => r.ticks / TICK_HZ / 60).sort((a, b) => a - b);
  const median = mins[Math.floor(mins.length / 2)];
  const winPct = Math.round((wins.length / runs.length) * 100);
  const target = region.targetLengthMin;

  // A region is healthy when a competent player usually wins, in roughly the
  // advertised time. Too fast is as wrong as too slow.
  const lengthOk = median >= target * 0.5 && median <= target * 1.6;
  const winOk = winPct >= 55;
  const verdict = winOk && lengthOk ? 'ok'
    : !winOk ? 'TOO HARD'
      : median > target * 1.6 ? 'TOO SLOW' : 'TOO FAST';
  if (verdict !== 'ok') anyBad = true;

  console.log(`  ${id.padEnd(12)} ${String(N).padStart(2)}  ${String(winPct).padStart(4)}%`
    + `  ${median.toFixed(1).padStart(5)}m  ${String(target).padStart(5)}m    ${verdict.padEnd(9)}`
    + `  losses=${losses} timeout(ahead=${ahead},behind=${behind})`);
}

console.log('');
if (anyBad) console.log('  Some regions are outside their target band — tune content/balance.js.\n');
