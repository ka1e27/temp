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
 *
 * NEUTRAL SITES PROJECT TOO, and leaving them out was the reason the board
 * never looked like the raid the campaign describes.
 *
 * This loop used to skip any owner that was not player or enemy, so a neutral
 * farm sat inside whichever faction's colour reached it first — and the faction
 * it usually reached first was the PLAYER, because the camp carries the biggest
 * radius on the map (INFLUENCE_RADIUS.camp is 3). The result was a board that
 * read as an even split no matter what the region table said. Measured at
 * tick 0, before this:
 *
 *     region        sites P/E/N     board: player / enemy
 *     riverfen      3/5/3             42%      43%
 *     nightharrow   13/17/18          46%      42%      <- player ahead
 *
 * Nightharrow is the deepest region of the enemy's homeland and it was painting
 * the player as holding more of it than its owner. The site table said 27%; the
 * thing a player actually looks at said 46%, and only the site table was ever
 * asserted. With neutral in the field it reads 30% / 40% / 30%, and the enemy
 * holds more ground than the player in every region of the campaign.
 *
 * A hex where neutral wins is OMITTED rather than stored, because absent
 * already means 'neutral' to `territoryAt` — so this costs nothing in the save
 * and needs no contract change. It is not only cosmetic either: `territoryAt`
 * drives `speedMultiplierFor`, so ground around an untaken site now moves both
 * armies at the neutral rate instead of quietly speeding whoever was nearest.
 * @returns {Record<string,string>} the same object now on state
 */
export function recomputeInfluence(state) {
  /** @type {Record<string,{player:number,enemy:number,neutral:number}>} */
  const field = {};

  for (const site of state.sites) {
    if (site.owner !== 'player' && site.owner !== 'enemy' && site.owner !== 'neutral') continue;
    const radius = INFLUENCE_RADIUS[site.kind] ?? 1;
    const weight = 1 + (site.level - 1) * INFLUENCE.levelBonus;
    const centre = asHex(site.hex);
    for (const h of withinRadius(centre, radius)) {
      if (!inGrid(state.grid, h)) continue;
      const key = kOf(h);
      const cell = field[key] ?? (field[key] = { player: 0, enemy: 0, neutral: 0 });
      cell[site.owner] += (radius + 1 - distance(centre, h)) * weight;
    }
  }

  const out = {};
  for (const key of Object.keys(field).sort()) {
    const { player, enemy, neutral } = field[key];
    const max = Math.max(player, enemy, neutral);
    if (max <= 0) continue;
    // Unowned ground wins outright rather than tying into 'contested': a hex
    // beside an untaken farm belongs to nobody, which is a different statement
    // from two armies meeting on it.
    if (neutral >= max) continue;
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
