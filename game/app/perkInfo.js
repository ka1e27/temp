// Display metadata (icon/name/effect text) for region perks (DESIGN §3.5), consumed by regionCard/results view-model
// building in the world/battle scenes. Presentation only, and the NUMBERS are never typed here: they are read from the
// same place the simulation reads them. game/meta/perks.js owns the perk magnitudes (PERK_PCT and the Throne constants,
// private to it) and exposes them through `perkAccumulate`, so each text below is built by asking that function what ONE
// owned region with this perk grants. A balance change to a perk therefore moves the card text with it, and the Throne's
// stat (attack / defence / growth by the captured faction's personality) is the very mapping the economy applies, not a
// copy of it.
import { perkAccumulate } from '../meta/perks.js';
import { PLAYER_FACTION } from '../meta/state.js';
import { DYNASTY } from '../config/meta.js';

const PERK_INFO = Object.freeze({
  fertile: { icon: 'wheat', name: 'Fertile Plains' },
  timber: { icon: 'tree', name: 'Timberland' },
  iron: { icon: 'pick', name: 'Iron Hills' },
  stone: { icon: 'stone', name: 'Stone Quarry' },
  horses: { icon: 'horse', name: 'Horse Pastures' },
  harbour: { icon: 'anchor', name: 'Harbour' },
  shrine: { icon: 'candle', name: 'Old Shrine' },
});

/** What each stat key of `perkAccumulate().totals` is called in a card line. */
const STAT_WORDS = Object.freeze({
  income: 'gold income', growth: 'troop growth', atk: 'attack', def: 'defence', speed: 'march speed', bounty: 'conquest bounty', cooldown: 'power cooldowns',
});
/** The Throne's stat, worded the way its line has always read ("+15% attack"). */
const THRONE_STAT_WORDS = Object.freeze({ atk: 'attack', def: 'defence', growth: 'growth' });

/** A fraction as card copy: 0.12 -> "+12%", -0.06 -> "−6%", 0.125 -> "+12.5%" (one decimal, never a silently rounded number). */
export function pctText(fraction) {
  return `${fraction < 0 ? '−' : '+'}${Number((Math.abs(fraction) * 100).toFixed(1))}%`;
}

/** What one player-owned region with `perk` grants, straight from game/meta/perks.js. */
function grant(perk, personality) {
  const world = { regions: [{ id: 0, perk, faction: 0 }], factions: [{ id: 0, personality }] };
  return perkAccumulate({ owner: [PLAYER_FACTION] }, world);
}

const textCache = new Map();

/** "+12% gold income", "−6% power cooldowns"; '' for an unknown perk. */
function plainPerkText(perkId) {
  if (textCache.has(perkId)) return textCache.get(perkId);
  const { totals } = grant(perkId);
  const stat = Object.keys(totals).find((k) => totals[k] !== 0);
  // the shrine's `cooldown` total is the REDUCTION (0.06): shown as a minus
  const text = stat ? `${pctText(stat === 'cooldown' ? -totals[stat] : totals[stat])} ${STAT_WORDS[stat]}` : '';
  textCache.set(perkId, text);
  return text;
}

/** "+25% income, +15% attack" for the Throne of a faction with this personality (just the income part when it has none). */
function throneText(personality) {
  const key = `throne:${personality || ''}`;
  if (textCache.has(key)) return textCache.get(key);
  const { totals, throneDetail } = grant('throne', personality);
  const detail = throneDetail[0];
  const text = `${pctText(totals.income)} income${detail ? `, ${pctText(detail.pct)} ${THRONE_STAT_WORDS[detail.stat] || detail.stat}` : ''}`;
  textCache.set(key, text);
  return text;
}

/**
 * What each dynasty star adds, from a DYNASTY-shaped config: "+3% income, +3% bounty". An effect tuned to zero is left out
 * (never "+0% attack/defence"); no effects at all gives ''.
 */
export function starEffectsText(dynasty) {
  return [
    [dynasty.incomePerStar, 'income'],
    [dynasty.atkDefPerStar, 'attack/defence'],
    [dynasty.bountyPerStar, 'bounty'],
  ].filter(([v]) => v > 0).map(([v, words]) => `${pctText(v)} ${words}`).join(', ');
}

/** The live DYNASTY config as card copy (game/config/meta.js). */
export function dynastyStarText() {
  return starEffectsText(DYNASTY);
}

/**
 * @param {string} perkId
 * @param {import('../world/generate.js').World} world
 * @param {import('../world/generate.js').Region} [region] required for 'throne' (to
 *   name which stat it grants); omitted elsewhere.
 * @returns {{icon: string, name: string, text: string}}
 */
export function perkDisplay(perkId, world, region) {
  if (perkId === 'throne') {
    const faction = region ? world.factions[region.faction] : null;
    return { icon: 'throne', name: 'Throne', text: throneText(faction && faction.personality) };
  }
  const info = PERK_INFO[perkId];
  return info ? { ...info, text: plainPerkText(perkId) } : { icon: 'star', name: perkId || 'Perk', text: '' };
}
