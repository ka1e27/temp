// The harness's scripted player, and the one-battle driver.
//
// Split out of tools/simrunner.js so it can be IMPORTED without running the
// CLI. tests/aidefence.test.js drives real battles through this exact bot, so
// an AI assertion is made against the same ordinary opponent the balance table
// is measured with — not against a hand-built fixture.
import { startBattle, step } from '../src/battle/sim.js';
import { generateBattleMap } from '../src/battle/mapgen.js';
// The between-battles shopping moved to ./simshop.js for the line budget and is
// re-exported here, so this file stays the harness's one front door.
import { spendCrowns, fieldedUnits } from './simshop.js';
export { spendCrowns, fieldedUnits };
// The site-upgrade ladder moved to ./simbuild.js for the line budget and is
// re-exported here, so `import { upgradeTurn } from './simplayer.js'` keeps
// working.
import { rearOf, upgradeTurn, constructTurn, buildHexes, scoutTurn } from './simbuild.js';
export { rearOf, upgradeTurn, constructTurn, scoutTurn };
import { buildBattleConfig } from '../src/meta/modifiers.js';
import { createState } from '../src/core/store.js';
import { markConquered, refreshUnlocks } from '../src/meta/world.js';
import { recalcIncome, incomePerSec } from '../src/meta/idle.js';
import { total } from '../src/battle/combat.js';
import { distance as hexDistance } from '../src/core/hex.js';
import { factionTrainCostPerSec } from '../src/battle/training.js';
import { goldOf } from '../src/battle/economy.js';
import { UNIT_IDS, CENTIGOLD, SITES } from '../src/content/balance.js';
import {
  assaultFilter, riderTurn, COLUMN_FILTER, PRIORITY, bestAssaultTarget,
} from './simtactics.js';
export { PRIORITY };
import { beliefFor } from '../src/battle/belief.js';
// Massing several sites into one strike — see simpool.js for the whole
// argument. `HOME_FLOOR` lives there now rather than here, so both files read
// the same number without an import cycle (this file already has to import
// FROM simpool.js for `pooledAssaultTurn`).
import { HOME_FLOOR, pooledAssaultTurn } from './simpool.js';

/**
 * HOW FAR EACH OWNED SITE IS FROM THE FIGHTING, in hexes to the nearest site
 * somebody else holds.
 *
 * It used to be HOPS: a BFS that seeded 0 at every owned site with a hostile
 * neighbour and walked outward over the site graph. Free movement broke that
 * outright rather than degrading it. `site.adj` is hex reach now, so on
 * gallowmoor EVERY player site borders something hostile, every one scored 0,
 * and two mechanics that gate on the gradient stopped happening at all:
 * `upgradeTurn` builds only behind the line, and the rear-army column only
 * pushes toward a lower number. The bot silently stopped upgrading a single
 * site — the mechanic this project measured at +9 to +25 points — and every
 * region measured against a player who no longer plays it.
 *
 * Hexes instead of hops, so the gradient survives a wider neighbourhood. And
 * note what it can no longer claim: the old note here said a rear site "cannot
 * be attacked directly at all" because sends were adjacency-only. Nothing is
 * safe now. This is a heuristic about where the fighting IS, not a guarantee
 * about where it cannot reach.
 */
export function frontDistance(state) {
  const dist = {};
  const foes = state.sites.filter((s) => s.owner !== 'player');
  for (const s of state.sites) {
    if (s.owner !== 'player') continue;
    let best = Infinity;
    for (const f of foes) {
      const d = hexDistance({ q: s.hex[0], r: s.hex[1] }, { q: f.hex[0], r: f.hex[1] });
      if (d < best) best = d;
    }
    dist[s.id] = Number.isFinite(best) ? best : Infinity;
  }
  return dist;
}

/**
 * HOW FAR EACH OWNED SITE IS FROM THE OBJECTIVE, in hexes to the enemy throne.
 *
 * A DIFFERENT QUESTION FROM `frontDistance`, and conflating the two is what
 * stopped this bot winning anything. Under the authored site graph one function
 * answered both by accident: hops-to-the-front formed a monotone gradient that
 * happened to point at the enemy, because the enemy was the far end of a narrow
 * graph. Hex reach destroyed that. Measured on gallowmoor with the enemy AI
 * switched OFF entirely — the cleanest possible test — the bot took 19 of 28
 * sites, held a site TWO HEXES from the castle, had a clear route to it from
 * every site it owned, and never attacked it once in seventeen minutes. Seven of
 * its sites scored an identical `frontDistance` of 2, so the column had nowhere
 * "forward" to go, and the whole 128-man army sat in nineteen piles of 3 to 19.
 *
 * "Where is the fighting" is a LOCAL measure and it is the right one for
 * deciding where you feel safe enough to build. "Which way is the war" is a
 * GLOBAL one and it needs a single sink, or an army diffuses instead of massing.
 * `victory: capture-castle` means there is exactly one such sink and it is not a
 * heuristic: it is the win condition.
 */
export function advanceDistance(state) {
  const goal = state.sites.find((s) => s.kind === 'castle' && s.owner !== 'player')
    ?? state.sites.find((s) => s.kind === 'castle');
  if (!goal) return null;
  const at = { q: goal.hex[0], r: goal.hex[1] };
  const dist = {};
  for (const s of state.sites) {
    if (s.owner === 'player') dist[s.id] = hexDistance({ q: s.hex[0], r: s.hex[1] }, at);
  }
  return dist;
}

/**
 * A deliberately ordinary player: expands toward soft targets, keeps a home
 * garrison, builds up the country behind the line, and only commits when it can
 * actually BREACH — which is the lesson the siege rules exist to teach. If a
 * competent-but-unremarkable player cannot clear a region, that region is
 * mis-tuned.
 *
 * `opts.upgrades: false` reverts to the pre-upgrade bot; `opts.scout: false`
 * to one with no answer to fog (simbuild.js `scoutTurn`) — both exist so a
 * mechanic's cost stays MEASURABLE after it ships, one flag rather than a
 * fork of this file. FOG OF WAR itself: blinded like the AI (battle/belief.js)
 * via `opts.sightedBot`, the measurement-only escape hatch (`--sighted`).
 */
export function playerTurn(state, opts = {}) {
  const view = opts.sightedBot ? state : beliefFor(state, 'player');
  const mine = view.sites.filter((s) => s.owner === 'player');
  const inFlight = new Set(view.squads.filter((q) => q.owner === 'player').map((q) => q.from));
  const front = frontDistance(view);

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
  for (const src of mine) riderTurn(view, src, front);

  // Sources and targets already spoken for THIS think — populated as the loop
  // below commits, and handed to the pooling pass after it so a garrison
  // cannot be double-spent and a target already taken cannot draw a second,
  // redundant wave from sources this loop did not use.
  const usedSources = new Set();
  const takenTargets = new Set();

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
    const filter = assaultFilter(view, src);
    const send = {};
    for (const u of UNIT_IDS) {
      send[u] = filter.includes(u) ? Math.floor((src.garrison[u] || 0) * fraction) : 0;
    }

    // The scan itself — castle gate, the reinforce-a-stalled-siege escape
    // hatch, and the below-floor-but-still-sufficient escape hatch — lives in
    // simtactics.js `bestAssaultTarget` now; both hatches are documented
    // there, alongside `opts.reinforce` / `opts.microsend`.
    const best = bestAssaultTarget(view, src, send, opts);
    if (best) {
      state.commands.push({ t: 'SEND', from: src.id, to: best.id, fraction, filter });
      usedSources.add(src.id);
      takenTargets.add(best.id);
    }
  }

  // MASS FORCE THE WAY THE ENEMY AI DOES — see simpool.js for the whole
  // argument (`battle/aicore.js adjacentSources`'s reasoning, copied rather
  // than its code). Additive: every target the loop above could take alone,
  // it just did, from the same source, at the same fraction, as always. This
  // only ever looks at what that loop left behind — the gap CLAUDE.md's "the
  // harness bot cannot concentrate force" traces to a Marshal'd castle no
  // single rear garrison can ever legally clear alone. `--nopool` reverts to
  // the loop above being the whole of the bot's assault decision, so the
  // delta stays re-measurable rather than remembered.
  for (const cmd of pooledAssaultTurn(view, mine, inFlight, usedSources, takenTargets, opts)) {
    state.commands.push(cmd);
  }

  // Push the rear army forward.
  //
  // A camp ringed by your own sites accumulates an army it can never use — 80
  // units sitting at cap while the front line holds with 4. This is what rally
  // points automate for a human player, and it is the single biggest difference
  // between a stalled game and a won one.
  //
  // FORWARD MEANS TOWARD THE THRONE, and it means the FULLEST staging post
  // rather than the emptiest. Both halves changed for the same reason and both
  // were measured. The old rule pushed toward a lower `frontDistance` and
  // preferred the neighbour with the smallest garrison — a load-balancer, which
  // is exactly right when a send is adjacency-only and a site has two or three
  // neighbours to balance across. At hex reach it has eight, and load-balancing
  // eight ways is a machine for making sure no stack is ever big enough to take
  // anything: gallowmoor ended with nineteen sites, a 128-man army, and no pile
  // over 19.
  //
  // A gradient needs one sink. Marching at the site already nearest the castle,
  // and breaking ties on the biggest garrison, gives it one — the army converges
  // on the staging post for the assault instead of diffusing across the ground
  // it has already taken. Nothing caps the sink, deliberately: `garrisonCap`
  // limits TRAINING, not stacking, and the throne is the one target that needs
  // more bodies than a farm can build.
  const advance = advanceDistance(view) ?? front;
  for (const src of mine) {
    const d = advance[src.id];
    if (d === undefined) continue;
    const garrison = total(src.garrison);
    const floor = src.kind === 'camp' ? HOME_FLOOR : 3;
    if (garrison <= floor + 3) continue;

    const forward = src.adj
      .map((id) => view.sites.find((x) => x.id === id))
      .filter((n) => n && n.owner === 'player' && advance[n.id] < d)
      .sort((a, b) => advance[a.id] - advance[b.id]
        || total(b.garrison) - total(a.garrison))[0];
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
  //
  // Asked of `SITES[kind].train` rather than of the kind, because the two came
  // apart: a stronghold trains nothing now, and this loop naming it would have
  // ordered a build at a site that cannot build and skipped every yard that can.
  // The wall threshold moved with it — a training ground is 180 HP, so `> 200`
  // no longer means "too tough for bodies", it means "not a farm".
  for (const s of mine) {
    if (!SITES[s.kind].train) continue;
    const wantsSiege = s.adj.some((id) => {
      const t = view.sites.find((x) => x.id === id);
      return t && t.owner !== 'player' && t.hpMax > SITES.trainingGround.hp;
    });
    const want = wantsSiege && state.mods.player.unlockedUnits.includes('rams')
      ? 'rams' : 'militia';
    if (s.trainType !== want) state.commands.push({ t: 'TRAIN', site: s.id, unit: want });
  }

  // SIGHT OF THE OBJECTIVE — see simbuild.js scoutTurn. Ahead of the ladder
  // and not gated by --noupgrades: seeing the win condition is not a spend.
  if (opts.scout !== false) scoutTurn(view, buildHexes(view));

  // Build the country behind the line. Last, so the treasury it reads has
  // already been reasoned about by everything that spends from it.
  //
  // Levelling what you hold comes BEFORE raising something new, and they never
  // both fire in a turn: one treasury, one decision. A cheap upgrade that is
  // already affordable is the thing a player reaches for first, and a bot that
  // raised a 350-gold yard while a 150-gold farm upgrade sat unbought would be
  // measuring a spender rather than an ordinary player.
  if (opts.upgrades === false) return;
  upgradeTurn(view, front);
  if (opts.construct !== false) constructTurn(view, front, buildHexes(view), opts);
}

/**
 * A meta state for a player who has taken `conquered` and idled `idleMinutes`.
 *
 * `legacy` IS A SECOND RUN, and it exists because the claim "abdicating makes the
 * next campaign a victory lap for ten regions and an ordinary fight by the last
 * three" was otherwise unmeasurable: every number this project has ever taken is
 * for a player with zero points, since `metaFor` never abdicates. A design claim
 * nobody can re-take is a design claim nobody will re-take.
 *
 * It is applied BEFORE the crowns are spent, deliberately — a legacy point raises
 * income, so a second-run player has more to spend as well as better troops, and
 * spending first would measure only half the effect.
 */
export function metaFor(conquered, idleMinutes = 0, seed = 1, fielded = null, legacy = 0,
  relics = 0) {
  const state = createState({ seed, now: 0 });
  for (const id of conquered) markConquered(state.meta, id, { now: 0, durationMs: 0 });
  if (legacy > 0) state.meta.legacy = { points: Math.floor(legacy), resets: 1 };
  // RELICS ARE ZERO UNLESS ASKED FOR, and that zero is what every number in
  // content/regions.data.js was measured against — `markConquered` above is why
  // it holds, since relics are paid by meta/rewards.js `applyOutcome` and this
  // function never calls it. `--relics=N` exists so the per-troop lines are
  // MEASURABLE rather than merely believed to be safe: a number nobody can
  // re-take is a number nobody will re-take.
  if (relics > 0) state.meta.relics = Math.floor(relics);
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
 *
 * `opts.sightedAi` is the enemy's half of the same escape hatch: it flips
 * `state.ai.sighted` on the live battle object, the one field ai.js
 * `think()` reads for it and nothing else ever writes.
 */
export function startRun(regionId, seed, conquered, idleMinutes = 0, opts = {}) {
  const state = metaFor(conquered, idleMinutes, seed, fieldedUnits(opts.weights),
    opts.legacy ?? 0, opts.relics ?? 0);
  const config = buildBattleConfig(state.meta, regionId, [], generateBattleMap, {
    seed,
    composition: opts.weights ?? null,
    // `opts.incursion` is a DEPTH on the endless ladder, and the bot plays a rung
    // exactly as it plays a region — the mutators arrive as multipliers, a gate
    // and a smaller landing force, all of which `playerTurn` already reads off the
    // state. Nothing here special-cases them, which is the point: a mechanic the
    // harness cannot play is a mechanic nobody has measured.
    ...(opts.incursion ? { incursion: opts.incursion } : {}),
  });
  const battle = startBattle(config);
  if (opts.sightedAi) battle.ai.sighted = true;
  return battle;
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
