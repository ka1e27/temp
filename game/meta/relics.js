// Relics (docs/PLAN-PHASE7.md §7B): unique legendary items on special regions. RELICS.perContinent are placed per continent (Ruins
// first, then deep untyped regions), seeded and visible before the player commits; conquering the region claims the Relic for the
// dynasty (conquer() calls claimRelic), and the lasting Reliquary remembers every Relic ever found (the "Reliquarian" deed).
// Effects fold into the one modifier source, meta/boonsState.js boonMods. Pure: no DOM, no Date.now, no Math.random, no storage.
import { RELIC_LIST, RELICS } from '../config/relics.js';
import { ASHEN_FACTION, ASHEN } from '../config/ashen.js';
import { hash32 } from '../core/rng.js';
import { RELIC_BY_ID, ensureRelics, ensureReliquary, fillBoonText } from './boonsState.js';
import { edictMods } from './edicts.js';
import { rivalsInWorld } from './rivals.js';
import { recordDeed, deedBonuses } from './deeds.js';
import { earnRenown } from './renownState.js';

const PLAYER = 0;

/** `{ id, name, icon, text }` for a Relic (text built from config numbers); null for an unknown id. */
export function relicInfo(id) {
  const r = RELIC_BY_ID.get(id);
  if (!r) return null;
  const extra = { risingBase: ASHEN.rising.everySec, rising: +(ASHEN.rising.everySec * (r.mods.risingIntervalMult || 1)).toFixed(1) };
  return { id: r.id, name: r.name, icon: r.icon, text: fillBoonText(r.text, r.mods, extra) };
}

function relevant(state, world, r) {
  if (r.requires === 'ashen') return rivalsInWorld(world).includes(ASHEN_FACTION);
  if (r.requires === 'raids') return edictMods(state).raids !== false;
  return true;
}

/**
 * Places this continent's Relics (resetRegions calls it; `syncRelics` for a save from before Phase 7). Seeded per world and dynasty:
 * RELICS.perContinent Relics, undiscovered ones first (so the Reliquary fills), on unowned regions of tier >= RELICS.minTier that are
 * not capitals or the Lair: Ruins first, then untyped regions at least RELICS.deepShare of the deepest tier, then any untyped one.
 * Replaces `state.relics.placed`; keeps `owned`. MUTATES. Returns `placed`.
 */
export function placeRelics(state, world) {
  const r = ensureRelics(state);
  const seed = (world.seed >>> 0) || 0;
  const level = (state.dynasty && state.dynasty.level) || 1;
  const found = new Set(ensureReliquary(state).found);
  const pool = RELIC_LIST.filter((x) => relevant(state, world, x) && !r.owned.includes(x.id))
    .map((x) => ({ id: x.id, found: found.has(x.id) ? 1 : 0, h: hash32(seed, 'relic', level, x.id) }))
    .sort((a, b) => a.found - b.found || a.h - b.h || (a.id < b.id ? -1 : 1));
  const maxTier = Math.max(0, ...world.regions.map((x) => x.tier));
  const ok = (x) => x.tier >= RELICS.minTier && !x.isCapital && x.type !== 'dragon' && state.owner[x.id] !== PLAYER;
  const rank = (list) => list.map((x) => ({ id: x.id, h: hash32(seed, 'relicHost', level, x.id) })).sort((a, b) => a.h - b.h || a.id - b.id).map((x) => x.id);
  const hosts = [];
  const add = (ids) => { for (const id of ids) if (!hosts.includes(id)) hosts.push(id); };
  add(rank(world.regions.filter((x) => ok(x) && x.type === RELICS.preferType)));
  add(rank(world.regions.filter((x) => ok(x) && !x.type && x.tier >= RELICS.deepShare * maxTier)));
  add(rank(world.regions.filter((x) => ok(x) && !x.type)));
  r.placed = {};
  const n = Math.min(RELICS.perContinent, pool.length, hosts.length);
  for (let i = 0; i < n; i++) r.placed[hosts[i]] = pool[i].id;
  r.seed = seed;
  return r.placed;
}

/** Places the Relics once for this world if they never were (an old save, a fresh import). Cheap to call on every load. MUTATES. */
export function syncRelics(state, world) {
  const r = ensureRelics(state);
  if (r.seed !== ((world.seed >>> 0) || 0)) placeRelics(state, world);
  return r;
}

/** The unclaimed Relic waiting in `regionId`, or null. */
export function relicAt(state, regionId) {
  const r = state && state.relics;
  if (!r || !r.placed) return null;
  const id = r.placed[regionId];
  return id && RELIC_BY_ID.has(id) && !(Array.isArray(r.owned) && r.owned.includes(id)) ? id : null;
}

/** Every unclaimed Relic on the map: `[{ regionId, relicId }]` (the map glints), by region id. */
export function relicsOnMap(state) {
  const r = state && state.relics;
  if (!r || !r.placed) return [];
  return Object.keys(r.placed).map(Number).filter((id) => relicAt(state, id)).sort((a, b) => a - b)
    .map((regionId) => ({ regionId, relicId: r.placed[regionId] }));
}

/**
 * Claims the Relic in `regionId` (conquer() calls it, for every conquest: battle, surrender or Quick Conquest). Returns
 * `{ ...relicInfo, newFind, renown, deeds }` (newFind: first time ever, for the Reliquary moment; renown: the Reliquarian deed's
 * bonus; deeds: tiers newly earned) or null when there is none. MUTATES.
 */
export function claimRelic(state, regionId) {
  const id = relicAt(state, regionId);
  if (!id) return null;
  const r = ensureRelics(state);
  r.owned.push(id);
  delete r.placed[regionId];
  const q = ensureReliquary(state);
  const newFind = !q.found.includes(id);
  if (newFind) q.found.push(id);
  const deeds = recordDeed(state, 'relics', q.found.length);
  const renown = earnRenown(state, deedBonuses(state).renownPerRelic, 'feature');
  return { ...relicInfo(id), newFind, renown, deeds };
}

/** The Realm panel's Reliquary: `{ found, total, items: [{ id, name, icon, text, found, owned }] }` (owned = held this dynasty). */
export function reliquary(state) {
  const found = new Set(state && state.generals && state.generals.reliquary && Array.isArray(state.generals.reliquary.found) ? state.generals.reliquary.found : []);
  const owned = new Set(state && state.relics && Array.isArray(state.relics.owned) ? state.relics.owned : []);
  const items = RELIC_LIST.map((x) => ({ ...relicInfo(x.id), found: found.has(x.id), owned: owned.has(x.id) }));
  return { found: items.filter((x) => x.found).length, total: items.length, items };
}

/** The Relics held this dynasty, as relicInfo objects (the owned strip). */
export function ownedRelics(state) {
  const owned = state && state.relics && Array.isArray(state.relics.owned) ? state.relics.owned : [];
  return owned.map(relicInfo).filter(Boolean);
}

/** A frontier region (adjacent to the player's land) holding an unclaimed Relic, lowest id, or null: the tutorial hint's trigger. */
export function relicOnFrontier(state, world) {
  for (const { regionId } of relicsOnMap(state)) {
    const r = world.regions[regionId];
    if (r && state.owner[regionId] !== PLAYER && r.neighbors.some((n) => state.owner[n] === PLAYER)) return regionId;
  }
  return null;
}

/** The region card's line for a region holding a Relic ("Relic: Sundial. ..."), or null. */
export function relicLine(state, regionId) {
  const id = relicAt(state, regionId);
  if (!id) return null;
  const info = relicInfo(id);
  return RELICS.copy.cardLine.replace('{name}', info.name).replace('{text}', info.text);
}
