// The Tapestry's data (DESIGN §5.9): turns the game state into what game/render/tapestry.js `composeTapestry` draws, with
// every word from game/config/chronicle.js. PURE: no DOM, no clock (the caller passes `now`), no storage; it reads the state and
// changes nothing, so it can be called while the Found a Dynasty modal is open over the finished realm.
//
//   const data = tapestryData(state, world, Date.now());
//   const tapestry = composeTapestry({ mapCanvas: renderWorldImage({ world, state, width: 1100 }), ...data });
//   await downloadCanvas(tapestry, tapestryFilename({ dynasty: data.dynasty, date: data.date }));
import { CHRONICLE } from '../config/chronicle.js';
import { formatDuration } from '../core/format.js';
import { PLAYER_FACTION } from './state.js';
import { crownTotals } from './crowns.js';

const ROMAN = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

function roman(n) {
  let v = Math.max(1, Math.round(Number.isFinite(n) ? n : 1));
  let out = '';
  for (const [val, sym] of ROMAN) while (v >= val) { out += sym; v -= val; }
  return out || 'I';
}

function fill(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
}

/**
 * @typedef {Object} TapestryData   spread straight into `composeTapestry({ mapCanvas, ...data })`
 * @property {string} title          "The Realm of Greenreach"
 * @property {string} subtitle       "Dynasty II"
 * @property {number} dynasty        the dynasty's number (the seal's numeral, and the file name)
 * @property {{ regions: string, battlesWon: number, crowns: string, timePlayed: string }} stats
 * @property {string} factionColor   the player's colour: the border is woven in it
 * @property {string} emblem         the player's emblem, on the second seal
 * @property {number} date           the ms timestamp it was made (`now`)
 * @property {number} seed           seeds the paper grain and the fringe: one continent, one tapestry
 */

/**
 * @param {import('./state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} now  ms timestamp
 * @returns {TapestryData}
 */
export function tapestryData(state, world, now) {
  const t = CHRONICLE.tapestry;
  const level = state.dynasty && Number.isInteger(state.dynasty.level) ? Math.max(1, state.dynasty.level) : 1;
  const home = world.regions[world.startRegion] || world.regions[0];
  let owned = 0;
  for (const r of world.regions) if (state.owner[r.id] === PLAYER_FACTION) owned += 1;
  const crowns = crownTotals(state, world);
  const stats = state.stats || {};
  const player = world.factions[PLAYER_FACTION] || {};
  return {
    title: fill(t.title, { region: home ? home.name : '' }),
    subtitle: fill(t.subtitle, { numeral: roman(level) }),
    dynasty: level,
    stats: {
      regions: fill(t.regions, { owned, total: world.regions.length }),
      battlesWon: Math.max(0, Math.round(stats.battlesWon || 0)),
      crowns: fill(t.crowns, { earned: crowns.earned, possible: crowns.possible }),
      timePlayed: formatDuration(stats.playSec || 0),
    },
    factionColor: player.color || '#3d7ef0',
    emblem: player.emblem || 'star',
    date: now,
    seed: Number.isFinite(state.seed) ? state.seed >>> 0 : 1,
  };
}

/**
 * The words around saving, from config: `saveText('done', { file: 'hex-dominion-dynasty-2-2026-09-30.png' })`.
 * @param {'button'|'busy'|'done'|'failed'|'hint'} key
 * @param {Object<string, string|number>} [vars]
 */
export function saveText(key, vars = {}) {
  return fill(CHRONICLE.save[key] ?? '', vars);
}
