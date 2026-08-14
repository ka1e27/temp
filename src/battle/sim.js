// The tick. 10 Hz, fixed step, decoupled from rendering.
//
// THE PHASE ORDER IS LOAD-BEARING AND MUST NEVER BE REORDERED:
//   tick++ -> drain orders -> economy -> training -> siege damage & HP regen
//   -> rally auto-send -> arrivals -> timers -> AI -> attrition -> win/lose
//
// Siege resolves BEFORE arrivals so a relieving force always gets one chance to
// break a siege before that tick's damage would have breached the wall —
// defence is never robbed by ordering. Same-tick arrivals are MERGED into one
// force, which deliberately rewards synchronized strikes.
// PURE.
import { TICK_HZ } from '../core/loop.js';
import {
  UNIT_IDS, UNITS, BOOSTERS, ATTRITION, ATTRITION_BLEED_SEC, ATTRITION_CHECK_TICKS, RALLY_KEEP,
} from '../content/balance.js';
import {
  resolveField, siegeDps, siteRegen, siteMaxHp, emptyComp, addComp, total, repairMult,
} from './combat.js';
import {
  createBattleState, siteById, effectiveLevel, armySize, sitesOwned, castleSealed,
  clampRallyKeep, recomputeReach,
} from './state.js';
import { rallyPhase } from './rally.js';
import { arrivalsPhase } from './arrivals.js';
import { towersPhase } from './towers.js';
import { recomputeInfluence, territoryScore } from './influence.js';
import { recomputeOccupancy } from './occupancy.js';
import { recomputeVision, recordSquadSightings } from './vision.js';
import { groundOf, siteDefMultOf } from './terrain.js';
import { spawnSquad, clearPathCache, squadHexOf } from './movement.js';
import { retreatTarget, reverseSquad } from './retreat.js';
import { drainCommands } from './commands.js';
import { runEconomy, attritionMods } from './economy.js';
import { runTraining, garrisonCap } from './training.js';
import { pushEvent, EVENTS } from './events.js';
import { think } from './ai.js';

const FACTIONS = ['player', 'enemy'];

/**
 * Build a live battle from a validated config and paint the opening front.
 *
 * The river layer used to be attached HERE rather than in `createBattleState`,
 * which meant every state built directly — i.e. every test fixture — was a
 * riverless board that looked healthy. It has moved into the state builder
 * beside `blocked`; see the comment on `grid` there for what it measured.
 */
export function startBattle(config) {
  clearPathCache();
  const state = createBattleState(config);
  // All three per-hex maps, together, because they are invalidated by exactly
  // the same event: a site changing hands or coming into existence. Vision is
  // the fog-of-war layer (battle/vision.js), and it is the SITE half only — a
  // squad's own small radius is answered live by `canSee` and never written to
  // a map, so nothing here has to know that a column can see at all.
  recomputeInfluence(state);
  recomputeOccupancy(state);
  recomputeVision(state);
  return state;
}

const modOf = (state, faction, key, fallback = 1) => state.mods[faction]?.[key] ?? fallback;
/** Per-troop levels (contract v7). Sparse and usually absent. */
const vetOf = (state, faction) => state.mods[faction]?.unitMult;

// --- phase 5: siege damage & HP regen --------------------------------------

/**
 * SCAFFOLDING YOU SEIZE IS RUBBLE, not a building.
 *
 * A site still going up sits at 1 HP with an empty garrison, so it is trivially
 * takeable — which is the whole risk of building forward. What it must not do is
 * hand the captor the finished article: `buildTicksLeft` is a timer on the site,
 * not on its owner, so before this the enemy could walk onto a half-dug yard and
 * have `timersPhase` complete it for them thirty seconds later. Observed exactly
 * that on gallowmoor — the site went to 0 HP under an enemy siege and came out
 * the far side at 180/180.
 *
 * Razing rather than cancelling, because cancelling leaves them a real building
 * at 1 HP that simply regenerates: still a gift, just a slower one. You lose the
 * gold and nobody gets a yard.
 * @returns {boolean} true when the site should be struck from the board
 */
const razedByCapture = (site) => site.buildTicksLeft > 0;

function capture(state, site) {
  const from = site.owner;
  const to = site.siege.owner;
  if (razedByCapture(site)) {
    site.siege = null;
    site.razed = true;                   // struck from state.sites by siegePhase
    pushEvent(state, EVENTS.SITE_RAZED, { siteId: site.id, kind: site.kind, from, to });
    state.meta.lastFlipTick = state.tick;
    return;
  }
  site.owner = to;
  site.garrison = addComp(emptyComp(), site.siege.comp);
  site.siege = null;
  // HP carries over at its current value — the site is briefly fragile, so a
  // fast counterattack can retake it. It is NOT reset to max.
  site.hp = Math.max(0, site.hp);
  site.level = 1;                        // in-battle upgrades are lost on capture
  site.hpMax = siteMaxHp(site.kind, 1);
  site.hp = Math.min(site.hp, site.hpMax);
  site.upgradeTicksLeft = 0;
  site.trainProgress = 0;
  site.rallyTargets = [];                // the standing order died with the wall
  site.rallyCursor = 0;
  site.rallyKeep = clampRallyKeep(state.rules?.rallyKeepDefault ?? RALLY_KEEP.default);
  site.shieldTicks = 0;
  pushEvent(state, EVENTS.SITE_CAPTURED, { siteId: site.id, kind: site.kind, from, to });
  state.meta.lastFlipTick = state.tick;
}

/**
 * Stop a column where it is and have it hold that ground.
 *
 * The same three fields `arrivals.js` writes when a squad's destination has
 * vanished under it, kept in step with that branch deliberately: `camped` is
 * what every consumer reads to tell holding ground from marching, and a second
 * spelling of "camped" is how one of the two would drift. The hex comes from
 * `squadHexOf`, so the army holds where it actually is rather than at the end of
 * a path that leads to a site no longer on the board.
 */
function campWhereItStands(state, sq) {
  sq.hex = sq.hex ?? squadHexOf(state, sq) ?? (sq.path?.length ? sq.path[0] : null);
  sq.camped = true;
  sq.to = null;
  pushEvent(state, EVENTS.SQUAD_CAMPED, {
    squadId: sq.id, owner: sq.owner, hex: sq.hex, count: total(sq.comp),
  });
}

function siegePhase(state) {
  const att = attritionMods(state);
  let flipped = false;
  for (const site of state.sites) {
    if (site.siege && total(site.siege.comp) === 0) site.siege = null;
    const shielded = site.shieldTicks > 0;
    const regenMult = modOf(state, site.owner, 'structureRegenMult')
      * att.regenMult * (shielded ? BOOSTERS.fortify.regenMult : 1);
    // Sappers repair what they garrison (combat.js `repairMult`), on the same
    // term `structureRegenMult` already uses — so `breachSeconds`, which the AI
    // and the preview both call, sees it without learning about the unit.
    //
    // SCAFFOLDING DOES NOT REPAIR ITSELF. A site still going up sits at 1 HP
    // for the whole build (battle/construct.js), and that fragility is the risk
    // the purchase carries — building forward is a bet. Left to regenerate, it
    // healed out of being a soft target on its own: measured, a training ground
    // was at 1.57 HP two ticks after it was paid for and would have been safe
    // long before the timer ran out. `buildTicksLeft` is only ever set on a site
    // the player raised, so every generated map is untouched by this.
    const regen = site.buildTicksLeft > 0 ? 0
      : siteRegen(site.kind, effectiveLevel(site),
        regenMult * repairMult(site.garrison)) / TICK_HZ;

    if (site.siege && site.siege.owner !== site.owner) {
      // Terrain is part of the siege, not just the field battle: rams work at a
      // fraction of their rate against a fort up in the rocks.
      const dps = siegeDps(site.siege.comp, modOf(state, site.siege.owner, 'siegeDmgMult'),
        groundOf(state, site)) / TICK_HZ;
      // Ceiling is hpMax, or the current HP when Emergency Fortify has pushed a
      // site above it: an overheal may drain away, but repair never restores it.
      const ceiling = Math.max(site.hpMax, site.hp);
      // The castle gate: below the region's territory threshold, a sealed
      // castle's HP has a FLOOR instead of a ceiling of zero — the siege grinds
      // but can never complete, the same shape breachSeconds() already gives an
      // under-strength siege against a stronghold. One extra hp keeps it out of
      // the capture check without inventing a second state field.
      const sealed = castleSealed(state, site);
      const floor = sealed ? 1 : 0;
      site.hp = Math.min(ceiling, Math.max(floor, site.hp - dps + regen));
      if (!sealed && site.hp <= 0) { capture(state, site); flipped = true; }
    } else if (site.hp < site.hpMax) {
      site.hp = Math.min(site.hpMax, site.hp + regen);
    }
  }
  // A razed site is removed AFTER the loop, never during it — splicing the array
  // being iterated is how a site next to a razed one silently gets skipped.
  if (state.sites.some((s) => s.razed)) {
    const gone = new Set(state.sites.filter((s) => s.razed).map((s) => s.id));
    // TURN THE COLUMN AROUND FIRST, while the site it was marching to still
    // exists. `resolveArrival` returns early when `siteById` finds nothing, and
    // the squads have already been taken off the board by then — so an army in
    // the air toward a razed site would simply cease to exist, with no event and
    // no body count. Reversing needs the old target to compute the trip home,
    // which is why it happens before the filter rather than after.
    for (const sq of state.squads) {
      if (!gone.has(sq.to) || sq.retreating) continue;
      if (reverseSquad(state, sq)) continue;
      // NOWHERE TO RUN, SO IT HOLDS WHERE IT STANDS — and this line used to
      // DELETE it instead, which is the exact bug the comment above claims to
      // have fixed. It read `sq.arriveTick = Infinity; // nowhere to run: it
      // holds`, and the very next statement filtered the squad list on
      // `Number.isFinite(sq.arriveTick)`: Infinity is not finite, so the sentinel
      // meant for "keep this one" was read as "remove it". An army vanished with
      // no event and no body count, and when it was the ENEMY's last column in
      // flight, `endPhase`'s `!inFlight('enemy')` handed the player an instant
      // win instead of a fight.
      //
      // Camping is the right answer rather than a better sentinel, because it is
      // what the engine already does to a column whose destination disappeared —
      // `arrivals.js` camps on a missing `dest` for precisely this case, and says
      // so. Holding ground is a real state a squad can be in now; "in flight
      // forever" is not.
      campWhereItStands(state, sq);
    }
    state.sites = state.sites.filter((s) => !s.razed);
    for (const s of state.sites) {
      // Anything pointing at ground that no longer exists: a standing rally
      // order outlives its target otherwise, and `rallyPhase` would send into a
      // hole every tick for the rest of the battle.
      s.rallyTargets = s.rallyTargets.filter((id) => state.sites.some((x) => x.id === id));
      if (s.rallyCursor >= s.rallyTargets.length) s.rallyCursor = 0;
    }
    recomputeReach(state.sites);
  }
  if (flipped) { recomputeInfluence(state); recomputeOccupancy(state); recomputeVision(state); }
}

// --- phase 6: rally auto-send lives in ./rally.js ---------------------------

// --- phase 7: arrivals lives in ./arrivals.js -------------------------------
// Re-exported so the phase list at the top of this file stays findable.
export { arrivalsPhase, fightStack, resolveArrival } from './arrivals.js';

// --- phase 8: timers --------------------------------------------------------

function timersPhase(state) {
  let opened = false;
  for (const site of state.sites) {
    if (site.shieldTicks > 0) site.shieldTicks--;
    // SCAFFOLDING BECOMES A BUILDING. It stood at 1 HP the whole time it was
    // going up (battle/construct.js), which is the risk the purchase carries;
    // finishing is what makes it worth defending.
    if (site.buildTicksLeft > 0) {
      site.buildTicksLeft--;
      if (site.buildTicksLeft === 0) {
        site.hp = site.hpMax;
        opened = true;
        pushEvent(state, EVENTS.SITE_BUILT, { siteId: site.id, kind: site.kind });
      }
    }
    if (site.upgradeTicksLeft > 0) {
      site.upgradeTicksLeft--;
      if (site.upgradeTicksLeft === 0) {
        const grown = siteMaxHp(site.kind, site.level);
        site.hp += grown - site.hpMax;
        site.hpMax = grown;
        pushEvent(state, EVENTS.SITE_UPGRADED, { siteId: site.id, level: site.level });
      }
    }
  }
  // A BUILD FINISHING IS A VISION EVENT, and it is the fourth one — scaffolding
  // is blind (battle/vision.js), so the tick a watchtower opens is the tick its
  // owner can suddenly see four hexes further. The other three call sites all
  // key off the site LIST or its ownership changing, neither of which happens
  // here: nothing appears, nothing changes hands, a timer merely runs out. Miss
  // this and the one building bought purely for sight grants none of it, ever.
  if (opened) recomputeVision(state);
  for (const f of FACTIONS) {
    if (state.factions[f].trainBoostTicks > 0) state.factions[f].trainBoostTicks--;
  }
  for (const id of Object.keys(state.boosters).sort()) {
    const b = state.boosters[id];
    if (b.cdTicks <= 0) continue;
    b.cdTicks--;
    if (b.cdTicks === 0) {
      if (b.charges < b.max) b.charges++;
      if (b.charges < b.max) b.cdTicks = b.cdMax;
    }
  }
}

// --- phase 10: the attrition ladder ----------------------------------------

function bleedGarrisons(state, count) {
  for (const site of state.sites) {
    if (!FACTIONS.includes(site.owner)) continue;
    if (total(site.garrison) <= garrisonCap(state, site)) continue;
    for (let i = 0; i < count; i++) {
      const cheapest = Object.keys(UNITS)
        .filter((u) => (site.garrison[u] || 0) > 0)
        .sort((a, b) => UNITS[a].gold - UNITS[b].gold)[0];
      if (!cheapest) break;
      site.garrison[cheapest]--;
      state.factions[site.owner].unitsLost++;
    }
  }
}

function attritionPhase(state) {
  if (state.tick % ATTRITION_CHECK_TICKS === 0) {
    const sinceSec = (state.tick - state.meta.lastFlipTick) / TICK_HZ;
    let stage = 0;
    for (let i = 0; i < ATTRITION.length; i++) if (sinceSec >= ATTRITION[i].afterSec) stage = i + 1;
    if (stage !== state.meta.attritionStage) {
      state.meta.attritionStage = stage;
      pushEvent(state, EVENTS.ATTRITION_STAGE, { stage });
    }
  }
  const att = attritionMods(state);
  if (att.garrisonBleed > 0 && state.tick % (ATTRITION_BLEED_SEC * TICK_HZ) === 0) {
    bleedGarrisons(state, att.garrisonBleed);
  }
}

// --- phase 11: win, lose, hard cap -----------------------------------------

function endPhase(state) {
  const camp = state.sites.find((s) => s.kind === 'camp');
  const castle = state.sites.find((s) => s.kind === 'castle');
  const inFlight = (f) => state.squads.some((sq) => sq.owner === f)
    || state.sites.some((s) => s.siege?.owner === f);

  let result = null;
  if (castle && castle.owner === 'player') result = 'win';
  else if (!state.sites.some((s) => s.owner !== 'player')) result = 'win';
  else if (camp && camp.owner !== 'player') result = 'loss';
  else if (!sitesOwned(state, 'player').length && !inFlight('player')) result = 'loss';
  else if (!sitesOwned(state, 'enemy').length && !inFlight('enemy')) result = 'win';
  else if (state.tick >= state.rules.hardCapTicks) {
    result = 'timeout';
    const p = territoryScore(state, 'player') + sitesOwned(state, 'player').length;
    const e = territoryScore(state, 'enemy') + sitesOwned(state, 'enemy').length;
    state.meta.timeoutWinner = p > e ? 'player' : e > p ? 'enemy' : 'draw';
  }
  if (!result) return;
  state.status = result;
  pushEvent(state, EVENTS.BATTLE_ENDED, { result, winner: state.meta.timeoutWinner ?? null });
}

// --- the tick ---------------------------------------------------------------

/** Advance one 10 Hz tick. Returns the same (mutated) state for chaining. */
export function step(state) {
  if (state.status !== 'running') return state;

  state.tick++;
  // main.js drains events after every tick; anything still here is stale, and
  // clearing now is what keeps the array bounded in a headless run.
  state.events = [];

  drainCommands(state);
  runEconomy(state);
  runTraining(state);
  siegePhase(state);
  rallyPhase(state);
  arrivalsPhase(state);
  // AFTER arrivals, so a column that reached its target this tick is resolved
  // as a fight rather than shot at while standing on the doorstep — being
  // taxed for passing and being taxed for arriving would double-charge the one
  // assault the whole siege mechanic is about. Before `timersPhase`, so a
  // building that opens this tick does not fire on the tick it opens.
  towersPhase(state);
  timersPhase(state);
  // SEE, THEN DECIDE. What the columns learned this tick has to be written
  // down before the commander reasons about it, or the AI acts on a map one
  // tick older than its own scouts. See battle/vision.js for why this is a
  // per-tick pass at all when `state.vision` is rebuilt only four times a
  // battle: squad sight is answered live and would otherwise leave no trace.
  recordSquadSightings(state);
  think(state);
  attritionPhase(state);
  endPhase(state);

  for (const f of FACTIONS) {
    const n = armySize(state, f);
    if (n > state.factions[f].peakArmy) state.factions[f].peakArmy = n;
  }
  return state;
}

/** Headless convenience: run until the battle ends or `maxTicks` elapse. */
export function runToEnd(state, maxTicks = 100000) {
  let n = 0;
  while (state.status === 'running' && n < maxTicks) { step(state); n++; }
  return state;
}
