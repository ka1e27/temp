// The upgrade shop: costs, purchase, and the aggregation of every owned level
// into the four buckets meta/modifiers.js consumes.
//
// PURITY: no time, no storage, no randomness. Every number lives in
// content/upgrades.data.js; this file only does arithmetic on them.
//
// ATOMICITY is the whole point of buy(): it either deducts the exact integer
// cost and raises the level, or it changes nothing at all. There is no
// intermediate state where crowns have been spent and the level has not moved,
// and `crowns` can never go negative — including at cost - 0.001, which a
// float-accumulating idle income WILL produce.

import {
  UPGRADES, UPGRADE_BY_ID, UPGRADE_GROUPS, STARTING_UNITS, OFFLINE, SAFE_MAX_LEVEL,
  upgradeCost,
} from '../content/upgrades.data.js';
import { legacyEffects, endgameOpen } from './legacy.js';
import { META_EVENTS, emit } from './events.js';

export { UPGRADES, UPGRADE_BY_ID, UPGRADE_GROUPS };

/**
 * IS THIS LINE ON SALE YET?
 *
 * `requires: 'endgame'` is the only gate there is, and it means what
 * meta/legacy.js `endgameOpen` means: the campaign has been finished at least
 * once. Everything else is available from the first battle, exactly as before.
 *
 * IT IS CHECKED HERE, IN `canBuy`, AND NOT ONLY IN THE SHOP SCREEN, and that is
 * the whole reason the endgame lines could ship without re-tuning anything. The
 * harness buys cheapest-affordable-first straight off `shopListing`
 * (tools/simplayer.js), so a gate the LISTING respected but a purchase did not
 * would be worth nothing — and a gate in the screen alone would be worth less
 * than nothing, since the screen is not what measures the campaign.
 */
export function isAvailable(meta, u) {
  if (!u?.requires) return true;
  if (u.requires === 'endgame') return endgameOpen(meta);
  // `unit:<id>` — a troop's own line, on sale once you own the troop. Same
  // mechanism, same enforcement point, and the same reason for both: a row a
  // player cannot use is a row they still have to read past.
  if (u.requires.startsWith('unit:')) {
    return unlockedUnits(meta).includes(u.requires.slice(5));
  }
  // An unknown requirement is treated as UNMET rather than ignored: content that
  // asks for a gate this file does not implement must not silently go on sale.
  return false;
}

/**
 * WHICH PURSE. `crowns` unless the line says otherwise.
 *
 * Two currencies, and only one of them ticks. Crowns accrue per second, so they
 * can price a ladder but cannot price scarcity; relics are paid only for ground
 * beaten (meta/rewards.js) and are what the troop lines and booster charges
 * cost. Read here rather than at each call site so a line that forgets to
 * declare one is charged in crowns, which is the safe direction: a relic line
 * mis-read as free would be the expensive mistake.
 */
export const currencyOf = (u) => (u?.currency === 'relics' ? 'relics' : 'crowns');

/** What a purse holds right now. */
const purse = (meta, cur) => Math.max(0, Math.floor(meta?.[cur] ?? 0));

/** Levels already owned. Absent === 0. */
export function levelOf(meta, id) {
  return meta?.upgrades?.[id] ?? 0;
}

/**
 * Is this line finished?
 *
 * For a one-off purchase that is `maxLevel`. For an ENDLESS line it is the
 * floating-point ceiling instead (content/upgrades.data.js `SAFE_MAX_LEVEL`):
 * past it a price is no longer an exact integer, and a shop button reading
 * "Infinity crowns" would be a bug rather than a challenge.
 */
export const isMaxed = (u, level) => level >= Math.min(u.maxLevel, SAFE_MAX_LEVEL);

/** Does this line have no design cap? True for the six empire lines. */
export const isEndless = (u) => !Number.isFinite(u?.maxLevel);

/** Cost of the NEXT level, or Infinity when maxed. Always an integer. */
export function nextCost(meta, id) {
  const u = UPGRADE_BY_ID[id];
  if (!u) return Infinity;
  const level = levelOf(meta, id);
  if (isMaxed(u, level)) return Infinity;
  return upgradeCost(u, level);
}

/** Cost of a specific level index (0 = first purchase). Exposed for tests and
 *  for the shop tooltip's "total to max" line. */
export function costAtLevel(id, level) {
  const u = UPGRADE_BY_ID[id];
  if (!u || level < 0 || isMaxed(u, level)) return Infinity;
  return upgradeCost(u, level);
}

/**
 * Total crowns to take an upgrade from its current level to max.
 *
 * `Infinity` for an endless line, and that is the honest answer rather than a
 * missing feature: there is no "max" to save up for, which is the whole point of
 * the six lines. Callers that want a next step want `nextCost`.
 */
export function costToMax(meta, id) {
  const u = UPGRADE_BY_ID[id];
  if (!u) return Infinity;
  if (isEndless(u)) return Infinity;
  let total = 0;
  for (let l = levelOf(meta, id); l < u.maxLevel; l++) total += upgradeCost(u, l);
  return total;
}

/**
 * @returns {{ok:boolean, reason:string, cost:number, level:number, maxLevel:number,
 *   currency:string}}
 */
export function canBuy(meta, id) {
  const u = UPGRADE_BY_ID[id];
  if (!u) {
    return { ok: false, reason: 'unknown', cost: Infinity, level: 0, maxLevel: 0, currency: 'crowns' };
  }
  const level = levelOf(meta, id);
  const currency = currencyOf(u);
  const out = (ok, reason, cost) => ({ ok, reason, cost, level, maxLevel: u.maxLevel, currency });
  // `cost` stays the real price rather than Infinity on a locked line: the shop
  // shows a gated row WITH what it will cost, which is the point of showing it.
  if (!isAvailable(meta, u)) return out(false, 'locked', upgradeCost(u, level));
  if (isMaxed(u, level)) return out(false, 'maxed', Infinity);
  const cost = upgradeCost(u, level);
  if (!(purse(meta, currency) >= cost)) return out(false, 'insufficient', cost);
  return out(true, 'ok', cost);
}

/**
 * Atomic purchase. Mutates `meta` only on success.
 *
 * ATOMICITY still means what it did — the deduction and the level move as one
 * pair with nothing between them that can throw — it just deducts from whichever
 * purse the line named. A relic line billed to crowns would be free, so the
 * currency is read from `canBuy`'s answer rather than re-derived here.
 * @returns {{ok:boolean, reason:string, cost:number, level:number, currency:string}}
 */
export function buy(meta, id, bus) {
  const check = canBuy(meta, id);
  if (!check.ok) return { ...check, level: check.level };
  const { currency } = check;

  meta[currency] -= check.cost;
  meta.upgrades[id] = check.level + 1;
  if (currency === 'relics') meta.stats.relicsSpent += check.cost;
  else meta.stats.crownsSpent += check.cost;

  const result = { ok: true, reason: 'ok', cost: check.cost, level: check.level + 1, currency };
  emit(bus, META_EVENTS.UPGRADE_PURCHASED, { id, ...result });
  emit(bus, currency === 'relics' ? META_EVENTS.RELICS_CHANGED : META_EVENTS.CROWNS_CHANGED, {
    crowns: meta.crowns, relics: meta.relics, delta: -check.cost, reason: 'spend',
  });
  return result;
}

// ---------------------------------------------------------------------------
// Aggregation. One pass over owned levels producing the four buckets.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} UpgradeEffects
 * @property {Record<string,number>} add   additive fractions, applied as (1 + sum)
 * @property {Record<string,number>} mult  independent multipliers, multiplied together
 * @property {Record<string,number>} flat  raw additions (gold, troops, ms, slots)
 * @property {string[]} units             unlocked unit ids, in roster order
 * @property {string[]} boosters          unlocked booster ids
 * @property {Record<string,boolean>} features
 */

/** @returns {UpgradeEffects} */
export function upgradeEffects(meta) {
  const out = {
    add: {}, mult: {}, flat: {}, unit: {},
    units: [...STARTING_UNITS], boosters: [], features: {},
  };
  for (const u of UPGRADES) {
    const level = levelOf(meta, u.id);
    if (level <= 0) continue;
    for (const e of u.effects) {
      if (e.bucket === 'add') out.add[e.key] = (out.add[e.key] ?? 0) + e.value * level;
      else if (e.bucket === 'mult') out.mult[e.key] = (out.mult[e.key] ?? 1) * e.value ** level;
      else if (e.bucket === 'flat') out.flat[e.key] = (out.flat[e.key] ?? 0) + e.value * level;
      // Per TROOP, additive like `add` and for the same reason: two levels of
      // one line have to be worth twice one level, or the shop is lying about
      // its own price curve.
      else if (e.bucket === 'unit') out.unit[e.key] = (out.unit[e.key] ?? 0) + e.value * level;
      else if (e.bucket === 'unlock') {
        if (e.key === 'unit') { if (!out.units.includes(e.value)) out.units.push(e.value); }
        else if (e.key === 'booster') out.boosters.push(e.value);
        else if (e.key === 'feature') out.features[e.value] = true;
      }
    }
  }
  // LEGACY IS THE LAST THING FOLDED IN, through the same buckets, so a prestige
  // point reaches idle income, the offline cap and both battle multipliers down
  // exactly the channels the shop does — and there is no second stacking order
  // for the two to drift apart in. A NO-OP at zero points, which is every battle
  // the balance table was ever measured with.
  return legacyEffects(meta, out);
}

/** Convenience readers used by idle.js and modifiers.js. */
export const addBonus = (fx, key) => fx.add[key] ?? 0;
export const multBonus = (fx, key) => fx.mult[key] ?? 1;
export const flatBonus = (fx, key) => fx.flat[key] ?? 0;

/**
 * The per-troop multipliers, as `FactionMods.unitMult` wants them: unit id ->
 * a multiplier on both attack and defence, and ONLY for units that have one.
 *
 * Sparse on purpose. An empty object is the overwhelmingly common case — every
 * battle in content/regions.data.js is fought with one — and a map of eight 1.0s
 * would put a field in every saved config that means "nothing", which is how a
 * dead seam field gets read as a live one.
 */
export function unitMults(fx) {
  const out = {};
  for (const [id, bonus] of Object.entries(fx.unit ?? {})) {
    if (bonus) out[id] = 1 + bonus;
  }
  return out;
}

/** Offline cap: base 8h, +4h per Granary level, clamped to the 24h design max. */
export function offlineCapMs(meta) {
  const fx = upgradeEffects(meta);
  return Math.min(OFFLINE.hardMaxCapMs, OFFLINE.baseCapMs + flatBonus(fx, 'offlineCapMs'));
}

/** Units the player may put in an expedition, in canonical roster order. */
export function unlockedUnits(meta) {
  return upgradeEffects(meta).units;
}

export function hasFeature(meta, feature) {
  return upgradeEffects(meta).features[feature] === true;
}

/** Shop listing, grouped, with everything the UI needs and no DOM. */
export function shopListing(meta) {
  return UPGRADE_GROUPS.map((g) => ({
    ...g,
    // A gated GROUP is still listed, with `open: false` — the shop shows the
    // Crown tier locked so a player can see what finishing the campaign buys.
    // `affordable` on its items is false regardless, so nothing can be bought
    // through it: the gate is enforced in canBuy, not here.
    open: g.requires ? isAvailable(meta, g) : true,
    currency: g.currency ?? 'crowns',
    // A `unit:` gate HIDES its row rather than showing it locked, which is the
    // opposite of what `endgame` does — and deliberately. A locked Crown line is
    // an advertisement for finishing the campaign; a locked Sapper Veterans line
    // is an advertisement for an unlock two groups above it that already has its
    // own row. The Troops group grows with the roster instead, two lines to
    // seven, which is what keeps the shop scannable.
    items: UPGRADES.filter((u) => u.group === g.id
      && !(u.requires?.startsWith('unit:') && !isAvailable(meta, u))).map((u) => {
      const check = canBuy(meta, u.id);
      return {
        id: u.id,
        name: u.name,
        desc: u.desc,
        level: levelOf(meta, u.id),
        maxLevel: u.maxLevel,
        // The shop shows "Lv 7" rather than "7 / Infinity" for these.
        endless: isEndless(u),
        cost: check.cost,
        // Which purse pays. The screen shows a price in the wrong unit
        // otherwise, and "4" beside a treasury of nine million reads as free.
        currency: check.currency,
        affordable: check.ok,
        reason: check.reason,
        locked: !isAvailable(meta, u),
        requires: u.requires ?? null,
      };
    }),
  }));
}

// ---------------------------------------------------------------------------
// Bulk purchase. One rule, shared by the shop screen's "Spend all"/"x10"
// controls and the harness's own shopping routine — see tools/simshop.js,
// which used to carry a private copy of the loop below. Two implementations
// of "what does the shop buy next" is exactly the drift this codebase keeps
// finding, so there is exactly one, here, and every caller shares it.
// ---------------------------------------------------------------------------

const EMPTY_SKIP = Object.freeze(new Set());

/**
 * SPEND EVERYTHING IN ONE PURSE, cheapest-affordable-first, until nothing is
 * left to buy.
 *
 * This is the loop that used to cost a player 10 to 146 identical clicks to
 * run by hand (measured through this exact function, at 1k/100k/1M/50M
 * crowns) — the shop's "Spend all" button IS this call, with no skip list,
 * because a player who pressed it has already decided everything on sale is
 * fair game. `tools/simshop.js` is the other caller, and it DOES pass a skip
 * set, because the harness knows in advance which specialists a run will
 * never field and must not spend a measurement's crowns on one.
 *
 * The 400-round guard is not a real limit: the cheapest line in the game is
 * 45 crowns and the richest purse this project has measured is tens of
 * millions, so the loop always runs out of affordable lines first. It exists
 * so a future bug in the cost curve (a price that stops rising, say) fails as
 * a bounded loop instead of a hung tab.
 *
 * @returns {number} purchases made, so a caller can tell "there was nothing
 *   to spend" from "that spent everything" without a second listing pass.
 */
export function spendAll(meta, currency, bus = null, skip = EMPTY_SKIP) {
  let bought = 0;
  for (let guard = 0; guard < 400; guard++) {
    const affordable = shopListing(meta)
      .flatMap((g) => g.items)
      .filter((i) => (i.currency ?? 'crowns') === currency
        && i.affordable && i.level < i.maxLevel && !skip.has(i.id))
      .sort((a, b) => a.cost - b.cost);
    if (!affordable.length) break;
    buy(meta, affordable[0].id, bus);
    bought++;
  }
  return bought;
}

/**
 * Buy ONE line up to `n` times, stopping the moment it is unaffordable or
 * maxed. Priced level-by-level through `buy()`, never a single deduction at
 * today's rate times `n` — a level-9 line does not cost nine times its
 * level-0 price, and quoting it that way would be a lie about its own price.
 * Powers the shop's per-line "x10" control, offered only on the endless lines
 * (see `isEndless`), where "again" is ever a question worth a shortcut.
 * @returns {number} purchases actually made (0..n)
 */
export function buyN(meta, id, n, bus = null) {
  let bought = 0;
  while (bought < n && buy(meta, id, bus).ok) bought++;
  return bought;
}

/**
 * THE SUGGESTED BUY: the cheapest AFFORDABLE line in one group, or null.
 *
 * Exists because cheapest-affordable-first is the only allocation this
 * project has ever measured winning (33% at n=48, against 2% for buying
 * Standing Army first and 0% for Treasury first — see CLAUDE.md's
 * uphill-raid section) and nothing on the screen ever taught it. It names no
 * numbers and ranks nothing: it points at ONE row, so a player learns the
 * rule by watching it move rather than by reading a recommendation engine's
 * opinion of six competing figures — which is exactly the min-max meta-game
 * this feature is not allowed to become.
 *
 * Scoped to the EMPIRE group alone, on purpose: those are the six lines a
 * player revisits on every single purchase, which is the decision the
 * 33/2/0 split is actually about. An Unlock is bought once and a Troops line
 * is gated to a unit already in play, so "which of these do I feed next" is
 * never a live question the way it is for the six that never end.
 *
 * @returns {?string} an upgrade id, or null when nothing in the group is
 *   affordable — the negative control that matters as much as the happy path.
 */
export function suggestedBuy(meta, groupId = 'empire') {
  let best = null;
  for (const u of UPGRADES) {
    if (u.group !== groupId) continue;
    const check = canBuy(meta, u.id);
    if (check.ok && (!best || check.cost < best.cost)) best = { id: u.id, cost: check.cost };
  }
  return best?.id ?? null;
}
