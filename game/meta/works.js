// Region Works (DESIGN §5.8): the local, spatial upgrade layer. Costs, the build and upgrade actions,
// and the data the region card's Works panel needs. Pure: no DOM, no Date.now, no Math.random, no storage.
//
//   state.works = { [regionId]: [{ type, level }] }     see worksEffects.js
//
// Everything that does not need the economy or the difficulty ladder (slots, battle effects, the Market's
// income multiplier, the Watchtower's free scout, resetting, save sanitising) lives in ./worksEffects.js, a
// leaf with no meta dependencies, so progression.js and economy.js can import it without a cycle (this file
// imports progression.js for `enemyDepth`). It is re-exported here, so the rest of the game imports the
// whole API from this one module. progression.js / economy.js must import './worksEffects.js', never this file.
import { WORKS, WORK_TYPES } from '../config/works.js';
import { PROSPERITY } from '../config/prosperity.js';
import { enemyDepth } from './progression.js';
import { PLAYER_FACTION } from './state.js';
import {
  ensureWorks, worksOf, totalWorks, workSlots, MAX_WORK_SLOTS,
} from './worksEffects.js';

export * from './worksEffects.js';

const TYPES = new Set(WORK_TYPES);
const pct = (fraction) => Math.round(fraction * 100);
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

// --- Copy (built from the config numbers, never typed into UI code) -------------------------------

/** Display name of a Work type ("Barracks"). */
export function workName(type) {
  return WORKS.copy.names[type] || type;
}

/**
 * One line of copy per EFFECT a Work has. `key` names the field of `WORKS.effects[type]` that holds its per-level number, `kind` how it is shown
 * ('flat': the number as it is, 'pct': a fraction as a percentage), `text` the words with the number as {n} (and the level as {level}), `short` the
 * terse version the chooser uses so a row stays one line. NO digit is ever typed here: `ui.works.test.js` / `meta.works.test.js` fail on one, and
 * on a numeric effect in the config that has no line here (a new effect must say what it does).
 */
const EFFECT_LINES = Object.freeze({
  barracks: [
    { key: 'perLevel', kind: 'flat', text: '+{n} camp troops', short: '+{n} troops' },
    { key: 'growthPerLevel', kind: 'pct', text: '+{n}% camp growth', short: '+{n}% growth' },
  ],
  stables: [
    { key: 'perLevel', kind: 'pct', text: '+{n}% march speed', short: '+{n}% speed' },
    { key: 'supplyPerLevel', kind: 'pct', text: '−{n}% supply time', short: '−{n}% supply time' },
    { key: 'fieldPerLevel', kind: 'pct', text: '+{n}% clash strength', short: '+{n}% clash' },
  ],
  shrine: [{ key: 'perLevel', kind: 'pct', text: '−{n}% power cooldowns', short: '−{n}% cooldowns' }],
  // the Watchtower's number is its LEVEL (the camp's volley level), so its line takes {level}, not a config fraction
  watchtower: [{ key: 'perLevel', kind: 'level', text: 'Free scouting + camp arrows L{level}', short: 'Free scouting, camp arrows' }],
  market: [{ key: 'perLevel', kind: 'pct', text: '+{n}% income here', short: '+{n}% income here' }],
});

/** Every numeric field of a Work's config that copy must cover (the keys of EFFECT_LINES[type]). Exported for the tests. */
export function workEffectKeys(type) {
  return (EFFECT_LINES[type] || []).map((l) => l.key);
}

function effectLines(type, level, variant) {
  const cfg = WORKS.effects[type];
  const lines = EFFECT_LINES[type];
  if (!cfg || !lines) return [];
  return lines.map((line) => {
    const per = cfg[line.key];
    if (per == null) return '';
    const text = variant === 'short' ? line.short : line.text;
    if (line.kind === 'level') return text.replace('{level}', String(level));
    const v = per * level;
    return text.replace('{n}', line.kind === 'pct' ? String(pct(v)) : fmt(v));
  }).filter(Boolean);
}

/**
 * What a Work does at `level`, in the words the panel shows on a built Work (every effect it has, from `WORKS.effects`). The panel header says the
 * effect applies in battles next door; only the Market says where it applies ("here"), because it is the one that does not.
 * @param {string} type
 * @param {number} level 1..maxLevel
 * @returns {string}
 */
export function workEffectText(type, level) {
  return effectLines(type, level, 'full').join(', ');
}

/** What ONE level of a Work is worth, for the chooser ("+3 troops, +18% growth per level"): the same effects, terse. */
export function workBlurb(type) {
  const lines = effectLines(type, 1, 'short');
  if (!lines.length) return '';
  // the Watchtower's line has no per-level number to state
  return type === 'watchtower' ? lines.join(', ') : `${lines.join(', ')} per level`;
}
/** Where a Work's effect applies: 'here' for the Market, 'next door' for the rest. */
export function workScope(type) {
  return type === 'market' ? 'here' : 'next door';
}

/**
 * Toast text: `worksToast('built', { work: 'Barracks', region: 'Fenwall' })`, `('upgraded', { work, region, level: 2 })`
 * or `('demolished', { work, region, refund: 190 })`.
 * @param {'built'|'upgraded'|'demolished'} kind
 */
export function worksToast(kind, { work = '', region = '', level = 1, refund = 0 } = {}) {
  return String(WORKS.copy.toasts[kind] || '')
    .replace('{work}', work).replace('{region}', region).replace('{level}', WORKS.copy.levels[level] || String(level))
    .replace('{refund}', String(refund));
}

function reasonGold(missing) {
  return WORKS.copy.reasons.gold.replace('{n}', String(Math.max(1, Math.ceil(missing))));
}

// --- Costs ------------------------------------------------------------------------------------------

/**
 * Gold to REACH `level` of `type` in `regionId`: level 1 builds it, level 2 upgrades I to II, level 3 II to
 * III (the price of that one step, not a running total).
 *
 *   cost = base x perDepth^(depth - 1) x levelMult[level - 1] x typeMult[type]      (config/works.js)
 *
 * `depth` is `enemyDepth(world, region)` from progression.js, floored at 1 (the start region is 0): the
 * region's rung on the difficulty ladder, which is also the order the player conquers regions in, so a
 * Work costs about the same share of the realm's income wherever it is built. `state` is accepted for
 * symmetry with the other meta cost functions and is not read today.
 * Infinity for an unknown region or type or a level outside 1..maxLevel, so `gold >= cost` is false.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @param {string} type
 * @param {number} level
 * @returns {number}
 */
export function workCost(state, world, regionId, type, level) {
  void state;
  const region = world.regions[regionId];
  if (!region || !TYPES.has(type) || !Number.isInteger(level) || level < 1 || level > WORKS.maxLevel) return Infinity;
  const depth = Math.max(1, enemyDepth(world, region));
  const c = WORKS.cost;
  return Math.round(c.base * Math.pow(c.perDepth, depth - 1) * c.levelMult[level - 1] * c.typeMult[type]);
}

// --- Build ---------------------------------------------------------------------------------------------

/**
 * Why `type` cannot be built in `regionId` right now, or null when it can: 'notOwned' (also an unknown
 * type or region), 'noSlot' (every unlocked slot is taken), 'duplicate' (one Work per type per region, so a
 * three-slot region holds three different Works), or 'gold'.
 * @returns {null|'notOwned'|'noSlot'|'duplicate'|'gold'}
 */
export function buildRefusal(state, world, regionId, type) {
  if (!world.regions[regionId] || !TYPES.has(type) || state.owner[regionId] !== PLAYER_FACTION) return 'notOwned';
  const list = worksOf(state, regionId);
  if (list.length >= workSlots(state, regionId)) return 'noSlot';
  if (list.some((w) => w.type === type)) return 'duplicate';
  if (state.gold < workCost(state, world, regionId, type, 1)) return 'gold';
  return null;
}

/** An owned region with a free slot, a type not built there yet, and the gold. */
export function canBuild(state, world, regionId, type) {
  return buildRefusal(state, world, regionId, type) === null;
}

/**
 * Pays for and builds a level-I Work in the region's next free slot. MUTATES gold and `state.works`.
 * @returns {{ slot: number, cost: number, work: { type: string, level: 1 } } | false} false when refused (nothing changes)
 */
export function buildWork(state, world, regionId, type) {
  if (!canBuild(state, world, regionId, type)) return false;
  const cost = workCost(state, world, regionId, type, 1);
  const works = ensureWorks(state);
  const list = Array.isArray(works[regionId]) ? works[regionId] : (works[regionId] = []);
  const slot = list.length;
  state.gold -= cost;
  list.push({ type, level: 1 });
  return { slot, cost, work: { type, level: 1 } };
}

// --- Upgrade -------------------------------------------------------------------------------------------

/**
 * Why the Work in `slotIdx` cannot be upgraded right now, or null when it can: 'notOwned' (also an
 * empty or unknown slot), 'maxed' (already level III) or 'gold'.
 * @returns {null|'notOwned'|'maxed'|'gold'}
 */
export function upgradeRefusal(state, world, regionId, slotIdx) {
  if (!world.regions[regionId] || state.owner[regionId] !== PLAYER_FACTION) return 'notOwned';
  const work = Array.isArray(state.works && state.works[regionId]) ? state.works[regionId][slotIdx] : null;
  if (!work || !TYPES.has(work.type) || !Number.isInteger(work.level) || work.level < 1) return 'notOwned';
  if (work.level >= WORKS.maxLevel) return 'maxed';
  if (state.gold < workCost(state, world, regionId, work.type, work.level + 1)) return 'gold';
  return null;
}

export function canUpgrade(state, world, regionId, slotIdx) {
  return upgradeRefusal(state, world, regionId, slotIdx) === null;
}

/**
 * Pays for one level of the Work in `slotIdx`. MUTATES gold and the Work.
 * @returns {{ slot: number, cost: number, level: number, type: string } | false} false when refused (nothing changes)
 */
export function upgradeWork(state, world, regionId, slotIdx) {
  if (!canUpgrade(state, world, regionId, slotIdx)) return false;
  const work = state.works[regionId][slotIdx];
  const cost = workCost(state, world, regionId, work.type, work.level + 1);
  state.gold -= cost;
  work.level += 1;
  return { slot: slotIdx, cost, level: work.level, type: work.type };
}

// --- Demolish ------------------------------------------------------------------------------------------

/**
 * Gold a demolish would give back: `WORKS.demolishRefund` (50 %) of what was spent on the Work across all its levels, i.e. the
 * prices of levels I up to its current level (prices depend only on the region, the type and the level, so this is what was paid).
 * 0 for an empty or invalid slot.
 * @returns {number}
 */
export function demolishRefundFor(state, world, regionId, slotIdx) {
  const work = Array.isArray(state.works && state.works[regionId]) ? state.works[regionId][slotIdx] : null;
  if (!work || !TYPES.has(work.type) || !Number.isInteger(work.level) || work.level < 1) return 0;
  let spent = 0;
  for (let level = 1; level <= Math.min(work.level, WORKS.maxLevel); level++) spent += workCost(state, world, regionId, work.type, level);
  return Number.isFinite(spent) ? Math.round(spent * WORKS.demolishRefund) : 0;
}

/** An owned region whose slot holds a Work (there is nothing else to check: demolishing is always free to do). */
export function canDemolish(state, world, regionId, slotIdx) {
  if (!world.regions[regionId] || state.owner[regionId] !== PLAYER_FACTION) return false;
  const list = state.works && state.works[regionId];
  if (!Array.isArray(list) || !Number.isInteger(slotIdx)) return false;
  const work = list[slotIdx];
  return !!work && TYPES.has(work.type) && Number.isInteger(work.level) && work.level >= 1;
}

/**
 * Tears down the Work in `slotIdx` and refunds half of what it cost. MUTATES gold and `state.works`: the Works after it move
 * up one slot (the list index is the slot index), and the region's entry is removed when it becomes empty. The slot is free to
 * build in again at once, including the same type (the one-per-type rule only counts what is standing).
 * @returns {{ refund: number, type: string, level: number } | false} false when refused (nothing changes)
 */
export function demolishWork(state, world, regionId, slotIdx) {
  if (!canDemolish(state, world, regionId, slotIdx)) return false;
  const refund = demolishRefundFor(state, world, regionId, slotIdx);
  const list = state.works[regionId];
  const [gone] = list.splice(slotIdx, 1);
  if (list.length === 0) delete state.works[regionId];
  state.gold += refund;
  return { refund, type: gone.type, level: gone.level };
}

// --- Panel data (for game/ui/worksPanel.js and worksChooser.js) -------------------------------------------

/**
 * @typedef {Object} WorkChoice  one row of the chooser
 * @property {string} type
 * @property {string} name
 * @property {string} icon            = type (game/ui/worksIcons.js draws it)
 * @property {string} effect          what one level is worth ("+2 camp troops per level")
 * @property {'next door'|'here'} scope
 * @property {number} cost            gold for level I in this region
 * @property {boolean} affordable
 * @property {string|null} reason     why it is disabled ("Need 34 more gold", "Already built here"), else null
 * @property {number} missing         gold short of the price (0 when affordable or refused for another reason)
 *
 * @typedef {Object} WorkSlotView
 * @property {number} index
 * @property {'built'|'empty'|'locked'} state
 * @property {string} [type]  @property {string} [name]  @property {string} [icon]
 * @property {number} [level] @property {number} [maxLevel]
 * @property {string} [effect]             built: what it does now
 * @property {string|null} [nextEffect]    built: what the next level does (null when maxed)
 * @property {number|null} [upgradeCost]   built: gold for the next level (null when maxed)
 * @property {number} [refund]            built: gold a demolish gives back
 * @property {string} [demolishPrompt]     built: the confirm text, "Demolish Barracks? Refund 190 gold"
 * @property {boolean} [affordable]        built: can pay the next level
 * @property {string|null} [reason]        built: why the upgrade is disabled
 * @property {boolean} [canBuild]          empty: at least one Work is affordable and available
 * @property {number} [cheapest]           empty: the cheapest Work's price
 * @property {string} [unlockLabel]        locked: "Prosperity II"
 * @property {number|null} [unlockInMs]    locked: time until that level (needs `now`), else null
 *
 * @typedef {Object} WorksPanelData
 * @property {number} regionId
 * @property {number} gold
 * @property {boolean} owned
 * @property {WorkSlotView[]} slots       always MAX_WORK_SLOTS entries, in slot order
 * @property {number} freeSlot            index of the first empty unlocked slot, -1 when none
 * @property {WorkChoice[]} choices       the chooser rows for the free slot ([] when none)
 * @property {string} intro               one sentence explaining "next door"
 */

function choicesFor(state, world, regionId) {
  return WORK_TYPES.map((type) => {
    const cost = workCost(state, world, regionId, type, 1);
    const refusal = buildRefusal(state, world, regionId, type);
    let reason = null;
    if (refusal === 'gold') reason = reasonGold(cost - state.gold);
    else if (refusal) reason = WORKS.copy.reasons[refusal];
    return {
      type, name: workName(type), icon: type, effect: workBlurb(type), scope: workScope(type),
      cost, affordable: refusal === null, reason,
      missing: refusal === 'gold' ? Math.max(1, Math.ceil(cost - state.gold)) : 0,
    };
  });
}

/**
 * Everything the owned region card's Works panel needs in one call. Cheap enough for the card's 1 s refresh.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} regionId
 * @param {number} [now] ms timestamp; with it, locked slots say how long until they open
 * @returns {WorksPanelData}
 */
export function worksPanelData(state, world, regionId, now) {
  const isOwned = state.owner[regionId] === PLAYER_FACTION;
  const unlocked = workSlots(state, regionId);
  const list = worksOf(state, regionId);
  const at = state.conqueredAt ? state.conqueredAt[regionId] : null;
  const slots = [];
  let freeSlot = -1;
  for (let i = 0; i < MAX_WORK_SLOTS; i++) {
    if (i < list.length) {
      const w = list[i];
      const maxed = w.level >= WORKS.maxLevel;
      const cost = maxed ? null : workCost(state, world, regionId, w.type, w.level + 1);
      const refusal = upgradeRefusal(state, world, regionId, i);
      slots.push({
        index: i, state: 'built', type: w.type, name: workName(w.type), icon: w.type,
        level: w.level, maxLevel: WORKS.maxLevel,
        effect: workEffectText(w.type, w.level),
        nextEffect: maxed ? null : workEffectText(w.type, w.level + 1),
        refund: demolishRefundFor(state, world, regionId, i),
        demolishPrompt: WORKS.copy.demolishPrompt.replace('{work}', workName(w.type)).replace('{n}', String(demolishRefundFor(state, world, regionId, i))),
        upgradeCost: cost, affordable: refusal === null,
        reason: refusal === 'gold' ? reasonGold(cost - state.gold) : refusal === 'maxed' ? WORKS.copy.reasons.maxed : null,
      });
    } else if (i < unlocked) {
      if (freeSlot < 0) freeSlot = i;
      const costs = WORK_TYPES.filter((t) => !list.some((w) => w.type === t)).map((t) => workCost(state, world, regionId, t, 1));
      const cheapest = costs.length ? Math.min(...costs) : null;
      slots.push({
        index: i, state: 'empty', cheapest,
        canBuild: WORK_TYPES.some((t) => buildRefusal(state, world, regionId, t) === null),
      });
    } else {
      // The prosperity level that opens this slot: slot 1 at extraAtProsperity[0], slot 2 at [1], ...
      const level = WORKS.slots.extraAtProsperity[i - WORKS.slots.onConquest];
      const threshold = PROSPERITY.thresholdsMs[level - 1];
      slots.push({
        index: i, state: 'locked',
        unlockLabel: `${WORKS.copy.lockedLabel} ${PROSPERITY.labels[level]}`.trim(),
        unlockInMs: now != null && at != null && Number.isFinite(at) && isOwned && threshold != null
          ? Math.max(0, at + threshold - now) : null,
      });
    }
  }
  return {
    regionId, gold: state.gold, owned: isOwned, slots, freeSlot,
    choices: freeSlot >= 0 ? choicesFor(state, world, regionId) : [],
    intro: WORKS.copy.nextDoor,
  };
}

// --- World map marks ---------------------------------------------------------------------------------------

/**
 * @typedef {Object} WorksMark  one owned region's Works, anchored at its keep (render/worksMarks.js draws it)
 * @property {number} regionId
 * @property {number} x  @property {number} y  keep tile centre, world units
 * @property {number} elev  keep tile elevation level (0..3), for the raised-top anchor
 * @property {{ type: string, level: number }[]} works  in slot order
 */

/**
 * Every owned region that has Works, for the map layer. Plain data (copies), cheap to rebuild on conquest
 * and whenever a Work is built or upgraded.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @returns {WorksMark[]}
 */
export function worksMarksData(state, world) {
  const out = [];
  for (const region of world.regions) {
    if (state.owner[region.id] !== PLAYER_FACTION) continue;
    const list = worksOf(state, region.id);
    if (!list.length) continue;
    const tile = world.tiles[world.settlements[region.keep].tile];
    if (!tile) continue;
    out.push({ regionId: region.id, x: tile.x, y: tile.y, elev: tile.elev || 0, works: list.map((w) => ({ type: w.type, level: w.level })) });
  }
  return out;
}

// --- Tutorial (PLAYFEEL step M3) ---------------------------------------------------------------------------

/**
 * Is tutorial step M3 due ("after the 3rd conquest")? The realm has conquered at least three regions and has no Work standing
 * (a demolished one does not count). The integrator also checks the tutorial step, which is what stops it from repeating, and
 * the Hints setting.
 * @param {import('./state.js').GameState} state
 */
export function worksTutorialDue(state) {
  return (state.stats ? state.stats.regionsConquered : 0) >= 3 && totalWorks(state) === 0;
}

/**
 * The owned frontier region M3 should point at: an owned region that borders land the player does not own
 * (so a Barracks or Stables there helps the next fight), still has a free slot, and borders the most such
 * regions (ties: lowest id). -1 when there is none.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @returns {number}
 */
export function worksTutorialRegion(state, world) {
  let best = -1;
  let bestBorders = 0;
  for (const region of world.regions) {
    if (state.owner[region.id] !== PLAYER_FACTION) continue;
    if (worksOf(state, region.id).length >= workSlots(state, region.id)) continue;
    const borders = region.neighbors.filter((n) => state.owner[n] !== PLAYER_FACTION).length;
    if (borders > bestBorders) { bestBorders = borders; best = region.id; }
  }
  return best;
}

