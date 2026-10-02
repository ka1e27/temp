// The Regions list (DESIGN 7.5a): every region the player can see, as plain rows a keyboard, a screen reader or a thumb can use without the map. Frontier first
// (the ones you can attack, easiest first, then the walled-off ones), then your own. Pure: state and world in, plain rows out; the UI (ui/regionsPanel.js) draws them and
// the world scene feeds it. The same words describe a region to the map's keyboard cursor (`regionSummary`).
import { revealed, frontier, difficulty, attackBlocker } from '../meta/progression.js';
import { PLAYER_FACTION } from '../meta/state.js';
import { getCrowns, crownCount } from '../meta/crowns.js';
import { chanceWords } from './chanceWords.js';
import { effectiveRegionIncome } from './income.js';

/**
 * @typedef {Object} RegionRow
 * @property {number} id
 * @property {string} name
 * @property {'frontier'|'owned'} kind
 * @property {{ id: number, name: string, color: string, colorLight: string, emblem: string }} owner
 * @property {number} tier
 * @property {string|null} label           Easy / Fair / Hard / Deadly (frontier regions)
 * @property {number|null} winChance       0..1
 * @property {string|null} chanceText      "about 1 in 5"
 * @property {boolean} surrender           a surrender is on offer
 * @property {'no-passable-border'|'unbuildable'|null} blocked  why it cannot be attacked, when it cannot
 * @property {number|null} crowns          crowns earned on an owned region (0..3)
 * @property {string} summary              the whole row in one sentence, for a screen reader and the map cursor
 */

/** One sentence for a region (a row's accessible name, and what the map cursor says when it lands there). */
export function regionSummary(row) {
  const tier = row.tier === 0 ? 'home region' : `tier ${row.tier}`;
  if (row.kind === 'owned') {
    const crowns = row.crowns != null ? `, ${row.crowns} of 3 crowns` : '';
    return `${row.name}: yours, ${tier}${crowns}.`;
  }
  const who = `${row.name}: ${row.owner.name}, ${tier}.`;
  if (row.surrender) return `${who} Would surrender to you.`;
  if (row.blocked) return `${who} Cannot be attacked yet: conquer a neighbour first.`;
  return `${who} ${row.label}: your chance to win is ${row.chanceText}. Can be attacked.`;
}

/**
 * @param {import('../meta/state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {{ revealAll?: boolean }} [opts] dev: every region counts as revealed
 * @returns {RegionRow[]} frontier first (attackable, easiest first; then the walled-off), then owned (highest tier first, then by name)
 */
export function regionsListData(state, world, opts = {}) {
  const seen = revealed(state, world);
  const front = new Set(frontier(state, world));
  const rows = [];
  for (const region of world.regions) {
    if (!(seen[region.id] || opts.revealAll)) continue;
    const factionId = state.owner[region.id];
    const f = world.factions[factionId];
    const owner = { id: factionId, name: f.name, color: f.color, colorLight: f.colorLight, emblem: f.emblem };
    if (factionId === PLAYER_FACTION) {
      const crowns = region.tier === 0 ? null : crownCount(getCrowns(state, region.id));
      const row = {
        id: region.id, name: region.name, kind: 'owned', owner, tier: region.tier, label: null, winChance: null, chanceText: null, surrender: false, blocked: null, crowns,
        income: effectiveRegionIncome(state, world, region),
      };
      rows.push({ ...row, summary: regionSummary(row) });
    } else if (front.has(region.id) || opts.revealAll) {
      const d = difficulty(state, world, region.id);
      const blockedReason = attackBlocker(state, world, region.id);
      const blocked = blockedReason === 'no-passable-border' || blockedReason === 'unbuildable' ? blockedReason : null;
      const row = {
        id: region.id, name: region.name, kind: 'frontier', owner, tier: region.tier, label: d.label, winChance: d.winChance, chanceText: chanceWords(d.winChance),
        surrender: !!d.surrender, blocked, crowns: null, ratio: d.ratio,
      };
      rows.push({ ...row, summary: regionSummary(row) });
    }
  }
  const rank = (r) => (r.kind === 'frontier' ? (r.blocked && !r.surrender ? 1 : 0) : 2);
  rows.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.kind === 'frontier') return (b.ratio ?? 0) - (a.ratio ?? 0) || a.id - b.id; // easiest first
    return b.tier - a.tier || a.name.localeCompare(b.name);
  });
  return rows;
}
