// Battle state -> music inputs. Pure functions of a BattleState (docs/ARCHITECTURE.md §6):
// no WebAudio, no clock. The integration layer calls these once per frame (or a few times a
// second) and feeds the results to music.setIntensity() / music.setAssault(); all smoothing
// and debouncing happens inside the score, so it is fine to call them every frame.
import { MUSIC } from '../config/music.js';
import { clamp01 } from './musicTheory.js';

const PLAYER_OWNER = 0; // game/battle/combat.js PLAYER_OWNER; duplicated so audio never imports battle code

/**
 * How hot the fight is, 0..1: troops out in the field, squads in contact, and how even the
 * two sides are. A quiet opening is about 0.1-0.2; a full melee with both armies committed
 * approaches 1. Returns 0 once the battle has a result (the stinger takes over from there).
 * @param {{result?: string|null, sites: Array<{owner: number, troops: number}>,
 *   squads: Array<{owner: number, count: number, state: string}>}} battle
 */
export function battleIntensity(battle, cfg = MUSIC) {
  if (!battle || battle.result) return 0;
  const m = cfg.intensityModel;
  let inField = 0;
  let inSites = 0;
  let player = 0;
  let other = 0;
  let contactSquads = 0;
  for (const s of battle.sites) {
    inSites += s.troops;
    if (s.owner === PLAYER_OWNER) player += s.troops; else other += s.troops;
  }
  for (const q of battle.squads) {
    inField += q.count;
    if (q.owner === PLAYER_OWNER) player += q.count; else other += q.count;
    if (q.state === 'fight' || q.state === 'assault') contactSquads += 1;
  }
  const total = inField + inSites;
  const field = total > 0 ? clamp01(inField / total / m.fieldSaturation) : 0;
  const contact = clamp01(contactSquads / m.contactSaturation);
  const sides = player + other;
  const balance = sides > 0 ? 1 - Math.abs(player - other) / sides : 0;
  const gate = m.balanceGate + (1 - m.balanceGate) * Math.max(contact, field);
  return clamp01(m.base + m.wField * field + m.wContact * contact + m.wBalance * balance * gate);
}

/**
 * True while a keep or War Camp (either side's) is under siege: `site.assault` is set by the
 * sim while a squad is hammering the gate. The score debounces this, so passing the raw
 * per-frame value is right.
 */
export function battleAssault(battle, cfg = MUSIC) {
  if (!battle || battle.result) return false;
  const types = cfg.intensityModel.assaultSiteTypes;
  return battle.sites.some((s) => s.assault && types.includes(s.type));
}
