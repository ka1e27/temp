// The territory flood — the signature mechanic.
//
// Every owned site projects influence over nearby hexes, falling off with
// distance; the strongest faction paints the hex and near-ties render as a
// contested band, so the front line draws itself with no numbers to read.
// Territory is FUNCTIONAL: squads move faster in friendly ground and slower in
// enemy ground (see TERRITORY_SPEED), which is what turns "capture nodes" into
// "hold a front".
//
// Recomputed ONLY when ownership changes — never per tick, never per frame.
// PURE.
import { withinRadius, distance } from '../core/hex.js';
import { INFLUENCE_RADIUS, TERRITORY_SPEED, INFLUENCE } from '../content/balance.js';
import { inGrid } from './mapgen.js';

/** Accept either the state's `[q,r]` site tuples or hex.js's `{q,r}`. */
export const asHex = (h) => (Array.isArray(h) ? { q: h[0], r: h[1] } : h);
const kOf = (h) => `${h.q},${h.r}`;

/**
 * Fill `state.influence`: hexKey -> 'player' | 'enemy' | 'contested'.
 * Hexes nobody claims are simply absent, and read back as 'neutral' — that
 * keeps the map small enough to serialize into a save every 5 seconds.
 * @returns {Record<string,string>} the same object now on state
 */
export function recomputeInfluence(state) {
  /** @type {Record<string,{player:number,enemy:number}>} */
  const field = {};

  for (const site of state.sites) {
    if (site.owner !== 'player' && site.owner !== 'enemy') continue;
    const radius = INFLUENCE_RADIUS[site.kind] ?? 1;
    const weight = 1 + (site.level - 1) * INFLUENCE.levelBonus;
    const centre = asHex(site.hex);
    for (const h of withinRadius(centre, radius)) {
      if (!inGrid(state.grid, h)) continue;
      const key = kOf(h);
      const cell = field[key] ?? (field[key] = { player: 0, enemy: 0 });
      cell[site.owner] += (radius + 1 - distance(centre, h)) * weight;
    }
  }

  const out = {};
  for (const key of Object.keys(field).sort()) {
    const { player, enemy } = field[key];
    const max = Math.max(player, enemy);
    if (max <= 0) continue;
    out[key] = Math.abs(player - enemy) <= max * INFLUENCE.contestRatio
      ? 'contested'
      : (player > enemy ? 'player' : 'enemy');
  }
  state.influence = out;
  return out;
}

/** 'player' | 'enemy' | 'contested' | 'neutral' */
export function territoryAt(state, hex) {
  const h = asHex(hex);
  return state.influence[kOf(h)] ?? 'neutral';
}

/** March speed multiplier for `faction` crossing this hex. */
export function speedMultiplierFor(state, faction, hex) {
  const t = territoryAt(state, hex);
  if (t === faction) return TERRITORY_SPEED.friendly;
  if (t === 'contested' || t === 'neutral') return TERRITORY_SPEED.neutral;
  return TERRITORY_SPEED.hostile;
}

/** Painted hexes held by a faction. Contested ground counts for nobody — this
 *  is what the hard cap decides a timeout on. */
export function territoryScore(state, faction) {
  let n = 0;
  for (const key of Object.keys(state.influence)) {
    if (state.influence[key] === faction) n++;
  }
  return n;
}
