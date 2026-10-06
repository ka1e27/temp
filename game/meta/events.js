// World events (DESIGN §10.13): the Merchant, the Plague and the Duel. A seeded scheduler on ACTIVE time offers one event about
// every EVENTS.meanSec, at most one pending at a time, never during the opening (EVENTS.graceSec, minRegions). Each waits
// EVENTS.offerSec for Accept or Decline. Pure: no DOM, no Date.now, no Math.random, no storage.
//
//   tickEvents(state, world, nowMs, activeDt) -> { offered, expired }   every frame of active play (like tickFrontier)
//   acceptEvent(state, world, choice, nowMs)  -> the result, or false     Merchant: { deal: 'fort', regionId, type } | { deal: 'renown' }
//                                                                          Deserters: { choice: 'raid'|'muster' }; Harvest: {} (pays gold)
//                                                                          Shipwreck (PLAN-PHASE12): { choice: 'salvage'|'leave' }
//   declineEvent(state)                                                    Plague: acknowledged; Duel: then duelRunFor
//   duelRunFor(state, world, event, stats, opts) -> BattleRun (kind 'duel'); duelReward(state, world, run, result) -> { renown }
import { EVENTS } from '../config/events.js';
import { hash32 } from '../core/rng.js';
import { PLAYER_FACTION } from './state.js';
import { ensureWorldEvents } from './eventsState.js';
import { incomePerSec } from './economy.js';
import { earnRenown } from './renownState.js';
import { leaderFor } from './leaders.js';
import { borderingRivals, raidDepth, raidEnemyStats, busyFromState } from './frontier.js';
import { fortsOf, fortCost, fortMaxLevel, buildFort, upgradeFort, fortBuildRefusal } from './forts.js';
import { buildDefenseArena, canBuildDefenseArena } from '../battle/defenseArena.js';
import { createBattle } from '../battle/sim.js';
import { militiaGarrisons, militiaCapMult, refillMilitia } from './militia.js';
import { playerBattleStats } from './progression.js';
import { addGrudge } from './grudges.js';
import { recordDeed, deedBonuses } from './deeds.js';
import { boonMods } from './boonsState.js';
import { edictMods } from './edicts.js';
import { activeHarvest } from './eventsState.js';
import { recordChronicle } from './chronicle.js';
import { wreckRelic } from './relics.js';
import { touchesOpenSea } from '../world/archipelago.js';

export * from './eventsState.js';

function rand(state) {
  const e = ensureWorldEvents(state);
  const h = hash32(state.seed ?? 0, 'events', e.rng);
  e.rng += 1;
  return h / 4294967296;
}

function ownedCount(state) {
  return state.owner.reduce((n, o) => n + (o === PLAYER_FACTION ? 1 : 0), 0);
}

function pickKind(state, world) {
  // the Shipwreck washes up only on an archipelago (PLAN-PHASE12): a land continent rolls exactly the Phase 8 table
  const entries = Object.entries(EVENTS.weights).filter(([k]) => k !== 'shipwreck' || !!(world && world.archipelago));
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let x = rand(state) * total;
  for (const [k, w] of entries) { x -= w; if (x < 0) return k; }
  return entries[0][0];
}

function makeEvent(state, world, kind, t, nowMs) {
  const e = ensureWorldEvents(state);
  const base = { id: e.seq++, kind, offeredAt: t, expiresAt: t + EVENTS.offerSec };
  const rivals = borderingRivals(state, world);
  if (kind === 'plague') {
    // the rival with the most land next to the realm
    const target = rivals.slice().sort((a, b) => b.pairs.length - a.pairs.length || a.faction - b.faction)[0];
    if (!target) return null;
    return { ...base, faction: target.faction, until: t + EVENTS.plague.durationSec,
      text: EVENTS.copy.plague.replace('{faction}', world.factions[target.faction].name).replace('{min}', String(Math.round(EVENTS.plague.durationSec / 60))) };
  }
  if (kind === 'duel') {
    const options = [];
    for (const r of rivals) for (const p of r.pairs) if (canBuildDefenseArena(world, state.owner, p.to, r.faction)) options.push({ faction: r.faction, ...p });
    if (!options.length) return null;
    const o = options[Math.floor(rand(state) * options.length) % options.length];
    const leader = leaderFor(state.seed ?? 0, state.dynasty ? state.dynasty.level : 1, o.faction);
    return { ...base, faction: o.faction, regionId: o.to, fromRegionId: o.from, leader: leader ? leader.fullName : '',
      text: EVENTS.copy.duel.replace('{leader}', leader ? leader.fullName : 'A rival').replace('{faction}', world.factions[o.faction].name)
        .replace('{region}', world.regions[o.to].name).replace('{renown}', String(EVENTS.duel.renown)) };
  }
  if (kind === 'deserters') {
    if (edictMods(state).raids === false) return null; // Peace of the Crowns: no raids to weaken, no militia to need
    // a bordering rival the player has not already turned (the one with the most land next to the realm, ties by a seeded roll)
    const turned = e.deserters ? e.deserters.faction : null;
    const list = rivals.filter((r) => r.faction !== turned).sort((a, b) => b.pairs.length - a.pairs.length || a.faction - b.faction);
    if (!list.length) return null;
    const target = list[0];
    const leader = leaderFor(state.seed ?? 0, state.dynasty ? state.dynasty.level : 1, target.faction);
    return { ...base, faction: target.faction, leader: leader ? leader.fullName : '', raidMult: EVENTS.deserters.raidMult,
      text: EVENTS.copy.deserters.replace('{faction}', world.factions[target.faction].name)
        .replace('{pct}', `${Math.round((1 - EVENTS.deserters.raidMult) * 100)}%`) };
  }
  if (kind === 'harvest') {
    const wall = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Number.isFinite(state.lastSeen) ? state.lastSeen : 0;
    if (e.harvests.some((h) => h.until > wall)) return null; // one festival at a time
    const hgold = Math.round(incomePerSec(state, world) * EVENTS.harvest.priceIncomeSec);
    return { ...base, gold: hgold, durationSec: EVENTS.harvest.durationSec, mult: EVENTS.harvest.rateMult,
      text: EVENTS.copy.harvest.replace('{gold}', String(hgold)).replace('{mult}', String(EVENTS.harvest.rateMult))
        .replace('{min}', String(Math.round(EVENTS.harvest.durationSec / 60))) };
  }
  if (kind === 'shipwreck') {
    // a coastal region of the realm (seeded among them), on an archipelago
    const coasts = world.archipelago ? world.regions.filter((r) => state.owner[r.id] === PLAYER_FACTION
      && r.tiles.some((i) => world.tiles[i].land && touchesOpenSea(world.tiles, i, world.cols, world.rows))) : [];
    if (!coasts.length) return null;
    const region = coasts[Math.floor(rand(state) * coasts.length) % coasts.length];
    const sgold = Math.round(incomePerSec(state, world) * EVENTS.shipwreck.salvageIncomeSec);
    return { ...base, regionId: region.id, gold: sgold, relicChance: EVENTS.shipwreck.relicChance,
      text: EVENTS.copy.shipwreck.replace('{region}', region.name).replace('{gold}', String(sgold))
        .replace('{pct}', `${Math.round(EVENTS.shipwreck.relicChance * 100)}%`) };
  }
  // the Merchant: two deals priced now (the Merchant's Scale Relic: x merchantPriceMult)
  const gold = Math.round(incomePerSec(state, world) * EVENTS.merchant.renownIncomeSec * boonMods(state).merchantPriceMult);
  return { ...base, deals: [{ deal: 'fort', priceShare: EVENTS.merchant.fortPriceShare * boonMods(state).merchantPriceMult }, { deal: 'renown', renown: EVENTS.merchant.renown, gold }],
    text: EVENTS.copy.merchantRenown.replace('{renown}', String(EVENTS.merchant.renown)).replace('{gold}', String(gold)) };
}

/**
 * Advances the events clock by `activeDt` active seconds. Offers an event when one is due (and applies a Plague at once: it is
 * news, not a deal), and lets a pending offer expire.
 * @returns {{ offered: object|null, expired: object|null }}
 */
export function tickEvents(state, world, nowMs, activeDt) {
  const e = ensureWorldEvents(state);
  e.activeSec += Math.max(0, Number.isFinite(activeDt) ? activeDt : 0);
  const t = e.activeSec;
  let expired = null;
  let offered = null;
  if (e.plague && t >= e.plague.until) e.plague = null;
  if (e.pending && t >= e.pending.expiresAt) { expired = e.pending; e.pending = null; }
  if (!e.pending && t >= e.nextAt) {
    e.nextAt = t + EVENTS.meanSec * (1 + EVENTS.jitter * (2 * rand(state) - 1));
    if (t >= EVENTS.graceSec && ownedCount(state) >= EVENTS.minRegions) {
      const kind = pickKind(state, world);
      const ev = makeEvent(state, world, kind, t, nowMs) || (kind !== 'merchant' ? makeEvent(state, world, 'merchant', t, nowMs) : null);
      if (ev) {
        e.pending = ev;
        e.log[ev.kind] += 1;
        if (ev.kind === 'plague') e.plague = { faction: ev.faction, until: ev.until };
        offered = ev;
      }
    }
  }
  return { offered, expired };
}

/** The pending offer, or null. */
export function pendingEvent(state) {
  return (state.worldEvents && state.worldEvents.pending) || null;
}

/** The gold a Merchant's fortification deal costs for `type` in `regionId` (its next level x the deal's share), Infinity if none. */
export function merchantFortPrice(state, world, regionId, type) {
  const f = fortsOf(state, regionId).find((x) => x.type === type);
  const level = f ? f.level + 1 : 1;
  if (f && f.level >= fortMaxLevel(type)) return Infinity;
  return Math.round(fortCost(state, world, regionId, type, level) * EVENTS.merchant.fortPriceShare * boonMods(state).merchantPriceMult); // the Merchant's Scale
}

/**
 * Accepts the pending offer. Merchant: `{ deal: 'fort', regionId, type }` buys one fortification level there for the deal's price
 * (gold), `{ deal: 'renown' }` buys the Renown. Plague: acknowledged. Duel: accepted (start it with duelRunFor). MUTATES.
 * @returns {object|false} what happened, or false when the choice is not possible (the offer stays)
 */
export function acceptEvent(state, world, choice = {}, nowMs = 0) {
  void nowMs;
  const e = ensureWorldEvents(state);
  const ev = e.pending;
  if (!ev) return false;
  if (ev.kind === 'merchant') {
    if (choice.deal === 'renown') {
      const deal = ev.deals.find((d) => d.deal === 'renown');
      if (state.gold < deal.gold) return false;
      state.gold -= deal.gold;
      earnRenown(state, deal.renown, 'feature');
      e.pending = null;
      return { kind: 'merchant', deal: 'renown', gold: deal.gold, renown: deal.renown };
    }
    if (choice.deal === 'fort') {
      const { regionId, type } = choice;
      const price = merchantFortPrice(state, world, regionId, type);
      if (!Number.isFinite(price) || state.gold < price || state.owner[regionId] !== PLAYER_FACTION) return false;
      const list = fortsOf(state, regionId);
      const slot = list.findIndex((x) => x.type === type);
      const refusal = slot < 0 ? fortBuildRefusal({ ...state, gold: Infinity }, world, regionId, type) : null;
      if (refusal) return false;
      const gold = state.gold;
      state.gold = Infinity; // the deal's own price, not the fortification's
      const res = slot < 0 ? buildFort(state, world, regionId, type) : upgradeFort(state, world, regionId, slot);
      state.gold = gold - price;
      if (!res) { state.gold = gold; return false; }
      e.pending = null;
      return { kind: 'merchant', deal: 'fort', gold: price, regionId, type, level: slot < 0 ? 1 : res.level };
    }
    return false;
  }
  const wall = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Number.isFinite(state.lastSeen) ? state.lastSeen : 0;
  if (ev.kind === 'deserters') {
    // { choice: 'raid' } weakens that rival's next raid (frontier.announce); { choice: 'muster' } (the default) fills every militia
    const pick = choice.choice === 'raid' ? 'raid' : 'muster';
    let regions = 0;
    if (pick === 'raid') e.deserters = { faction: ev.faction };
    else for (let id = 0; id < state.owner.length; id++) if (state.owner[id] === PLAYER_FACTION) { refillMilitia(state, id, wall); regions += 1; }
    e.pending = null;
    eventChronicle(state, world, ev, wall, pick);
    return { kind: 'deserters', choice: pick, faction: ev.faction, regions, event: ev };
  }
  if (ev.kind === 'shipwreck') {
    // { choice: 'salvage' } (the default) pays the gold; { choice: 'leave' } searches the wreck: a seeded relicChance roll for a Relic
    const pick = choice.choice === 'leave' ? 'leave' : 'salvage';
    e.pending = null;
    if (pick === 'salvage') {
      state.gold += ev.gold;
      if (state.stats) state.stats.goldEarned += ev.gold;
      return { kind: 'shipwreck', choice: pick, gold: ev.gold, relic: null, event: ev };
    }
    const relic = rand(state) < ev.relicChance ? wreckRelic(state, world) : null;
    return { kind: 'shipwreck', choice: pick, gold: 0, relic, event: ev };
  }
  if (ev.kind === 'harvest') {
    if (!(state.gold >= ev.gold)) return false;
    state.gold -= ev.gold;
    e.harvests.push({ from: wall, until: wall + ev.durationSec * 1000, mult: ev.mult });
    e.harvests = e.harvests.slice(-EVENTS.harvest.keep);
    e.pending = null;
    eventChronicle(state, world, ev, wall, null);
    return { kind: 'harvest', gold: ev.gold, until: wall + ev.durationSec * 1000, event: ev };
  }
  e.pending = null;
  return { kind: ev.kind, event: ev };
}

/** The Chronicle line of an accepted Deserters / Harvest Festival (config/chronicle.js kinds 'deserters', 'harvest'). */
function eventChronicle(state, world, ev, t, variant) {
  if (!(t > 0)) return;
  const data = {};
  if (ev.faction != null) {
    data.factionId = ev.faction;
    if (world.factions[ev.faction]) data.faction = world.factions[ev.faction].name;
    if (ev.leader) data.leader = ev.leader;
  }
  if (variant) data.variant = variant;
  recordChronicle(state, { kind: ev.kind, t, data });
}

/** True while a Harvest Festival runs at `nowMs` (the map / Realm panel may show it). */
export function harvestActive(state, nowMs) {
  return !!activeHarvest(state, nowMs);
}

/** Declines (or dismisses) the pending offer. A Plague already applies. */
export function declineEvent(state) {
  const e = ensureWorldEvents(state);
  const ev = e.pending;
  e.pending = null;
  // declining a Duel feeds that leader's Grudge (PLAN-PHASE4 §4D); `ev.grudge` says by how much it now stands
  if (ev && ev.kind === 'duel') {
    const g = addGrudge(state, ev.faction, 'duelDeclined');
    if (g) ev.grudge = { faction: ev.faction, value: g.value, crossed: g.crossed };
  }
  return ev || null;
}

/**
 * The Duel's battle (DESIGN §10.13): a short, no-powers defense of the event's region against the rival champion's war band
 * (EVENTS.duel.warBand x a raid's strength), held for EVENTS.duel.siegeSec. A BattleRun of kind 'duel' for the battle manager.
 */
export function duelRunFor(state, world, event, stats, opts = {}) {
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : state.lastSeen;
  const raid = { id: 0, faction: event.faction, fromRegionId: event.fromRegionId, toRegionId: event.regionId,
    depth: raidDepth(state, world, event.regionId), first: false, mult: EVENTS.duel.warBand };
  const player = stats || playerBattleStats(state, world, event.regionId);
  const enemy = raidEnemyStats(state, world, raid);
  const arena = buildDefenseArena(world, state.owner, event.regionId, {
    attackerFaction: event.faction, fromRegionId: event.fromRegionId, player, enemy,
    militia: militiaGarrisons(state, world, event.regionId, nowMs), militiaCapMult: militiaCapMult(state, world, event.regionId),
    busy: opts.busy || busyFromState(state, world), siegeSec: EVENTS.duel.siegeSec,
  });
  arena.twist = 'holy';
  const battle = createBattle(arena, player, enemy, { mode: 'defense', siegeSec: EVENTS.duel.siegeSec });
  return {
    id: (state.frontier && state.frontier.seq) ? state.frontier.seq++ : 1, kind: 'duel', regionId: event.regionId, fromRegionId: event.fromRegionId,
    attackerFaction: event.faction, battle, commander: null, auto: false, startedAt: Number.isFinite(opts.nowMs) ? opts.nowMs : null, eventId: event.id,
  };
}

/** Settles a Duel: a win pays its Renown; a loss costs nothing (the region is NOT occupied). */
export function duelReward(state, world, run, result) {
  void world;
  if (result !== 'win') return { renown: 0 };
  // Phase 4: the Duellist deed pays extra Renown per Duel won (and counts it); a lost leader's Grudge rises (PLAN-PHASE4 §4C, §4D)
  const renown = earnRenown(state, EVENTS.duel.renown + deedBonuses(state).renownPerDuel, 'feature');
  recordDeed(state, 'duel', 1);
  const out = { renown };
  const faction = run && run.attackerFaction;
  const g = faction > 1 ? addGrudge(state, faction, 'duelWon') : null;
  if (g) out.grudge = { faction, value: g.value, crossed: g.crossed };
  return out;
}
