// Internal helper shared by economy.js and progression.js: aggregates the
// permanent bonuses granted by every region perk the player currently owns
// (DESIGN §3.5). Not part of the public meta contract in
// docs/ARCHITECTURE.md §5 — progression.js's `perkTotals` is the exported,
// UI-facing view over the same numbers.
//
// ASSUMPTION (flagged per ARCHITECTURE's "say so loudly" rule): DESIGN §3.5
// says perks "stack additively", which we read as: every owned region
// contributes its perk's percentage to one shared pool per stat, and that
// pool is applied once (1 + sum), rather than compounding per region
// (1.12 × 1.12 × ...). This keeps late-game bonuses from running away.
//
// ASSUMPTION 2: the Throne perk's "+15% of one stat (faction-specific)" does
// not name the mapping. We use the captured faction's personality (DESIGN
// §3.3), which the region's original `faction` id keys into forever, even
// after the player owns it:
//   aggressive (Crimson Legion)   → attack  (their whole identity is offence)
//   defensive  (Violet Covenant)  → defence
//   swarm      (Amber Horde)      → growth  (constant reinforcement is their gimmick)
// Free Folk have no capital and are excluded.

import { PLAYER_FACTION } from './state.js';

const PERK_PCT = Object.freeze({
  fertile: { income: 0.12 },
  timber: { growth: 0.06 },
  iron: { atk: 0.05 },
  stone: { def: 0.05 },
  horses: { speed: 0.06 },
  harbour: { bounty: 0.20 },
  shrine: { cooldown: 0.06 },
});

const THRONE_STAT_BY_PERSONALITY = Object.freeze({
  aggressive: 'atk',
  defensive: 'def',
  swarm: 'growth',
});

const THRONE_INCOME_PCT = 0.25;
const THRONE_STAT_PCT = 0.15;

/**
 * @typedef {Object} PerkAccumulation
 * @property {Object<string, number>} totals   raw summed percentages per stat
 *   (income, growth, atk, def, speed, bounty, cooldown)
 * @property {Object<string, number>} counts   number of owned regions per perk id
 * @property {{ regionId: number, factionId: number, stat: string, pct: number }[]} throneDetail
 */

/**
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @returns {PerkAccumulation}
 */
export function perkAccumulate(state, world) {
  const totals = { income: 0, growth: 0, atk: 0, def: 0, speed: 0, bounty: 0, cooldown: 0 };
  const counts = {
    fertile: 0, timber: 0, iron: 0, stone: 0, horses: 0, harbour: 0, shrine: 0, throne: 0,
  };
  const throneDetail = [];

  for (const region of world.regions) {
    if (state.owner[region.id] !== PLAYER_FACTION) continue;
    const perk = region.perk;

    if (perk === 'throne') {
      counts.throne += 1;
      totals.income += THRONE_INCOME_PCT;
      // region.faction is the ORIGINAL owner, which never changes — exactly
      // what we need to know whose throne this was.
      const faction = world.factions[region.faction];
      const stat = faction && THRONE_STAT_BY_PERSONALITY[faction.personality];
      if (stat) {
        totals[stat] += THRONE_STAT_PCT;
        throneDetail.push({ regionId: region.id, factionId: region.faction, stat, pct: THRONE_STAT_PCT });
      }
      continue;
    }

    const bonus = PERK_PCT[perk];
    if (!bonus) continue;
    counts[perk] = (counts[perk] || 0) + 1;
    for (const stat of Object.keys(bonus)) totals[stat] += bonus[stat];
  }

  return { totals, counts, throneDetail };
}

/**
 * The multiplier bundle economy.js and progression.js actually consume.
 * cooldown is floored so stacking shrines can never reach zero/negative.
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 */
export function perkMultipliers(state, world) {
  const { totals } = perkAccumulate(state, world);
  return {
    income: 1 + totals.income,
    growth: 1 + totals.growth,
    atk: 1 + totals.atk,
    def: 1 + totals.def,
    speed: 1 + totals.speed,
    bounty: 1 + totals.bounty,
    cooldownMult: Math.max(0.2, 1 - totals.cooldown),
  };
}
