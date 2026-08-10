// Mid-battle resume.
//
// A battle runs 8-14 minutes. Losing one to an accidental refresh is the kind
// of papercut that stops people playing, and the fix is nearly free: battle
// state is pure serialisable data (~7KB after a minute), so it round-trips
// through JSON exactly.
//
// Kept in its OWN storage key rather than inside the save slice, so the save
// schema and its migration chain stay untouched by a purely ephemeral concern.
// A stale blob is worthless, never precious — anything suspicious is discarded
// rather than repaired, which is the opposite of how save.js treats progress.
//
// PURE: storage is injected, never reached for.
import { CONTRACT_VERSION, assertBattleConfig } from '../battle/contract.js';

export const RESUME_KEY = 'hexdominion.battle';

/** Older than this and the player has moved on; don't ambush them with it. */
export const RESUME_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * @param {object} storage  {getItem, setItem, removeItem}
 * @param {object} battle   live BattleState
 * @param {object} config   the BattleConfig it was started from
 * @param {number} now      epoch ms, injected
 */
export function saveBattle(storage, battle, config, now) {
  if (!storage || !battle || battle.status !== 'running') return { ok: false, reason: 'not-running' };
  try {
    storage.setItem(RESUME_KEY, JSON.stringify({
      contractVersion: CONTRACT_VERSION, savedAt: now, battle, config,
    }));
    return { ok: true };
  } catch (err) {
    // A full quota must never take the battle down with it.
    return { ok: false, reason: 'write-failed', error: String(err) };
  }
}

export function clearBattle(storage) {
  try { storage?.removeItem(RESUME_KEY); } catch { /* nothing to do */ }
}

/**
 * @returns {{ok:boolean, reason?:string, battle?:object, config?:object, ageMs?:number}}
 */
export function loadBattle(storage, now) {
  let raw;
  try { raw = storage?.getItem(RESUME_KEY) ?? null; } catch { return { ok: false, reason: 'unreadable' }; }
  if (raw === null) return { ok: false, reason: 'empty' };

  let blob;
  try { blob = JSON.parse(raw); } catch { return discard(storage, 'corrupt'); }
  if (!blob || typeof blob !== 'object') return discard(storage, 'corrupt');

  // A battle from an older contract cannot be stepped by this engine: its
  // shape is not what the simulation now expects.
  if (blob.contractVersion !== CONTRACT_VERSION) return discard(storage, 'stale-contract');
  if (!blob.battle || !blob.config) return discard(storage, 'incomplete');
  if (blob.battle.status !== 'running') return discard(storage, 'already-finished');

  const ageMs = Math.max(0, (now ?? 0) - (blob.savedAt ?? 0));
  if (ageMs > RESUME_MAX_AGE_MS) return discard(storage, 'too-old');
  if (!steppable(blob)) return discard(storage, 'unsteppable');

  return { ok: true, battle: blob.battle, config: blob.config, ageMs };
}

/**
 * IS THIS BLOB SOMETHING THE ENGINE CAN ACTUALLY STEP?
 *
 * The version check above only proves the blob was written by this build. It says
 * nothing about SHAPE, and the checks either side of it were `!blob.battle` —
 * truthiness. So `{contractVersion: 6, battle: {status: 'running'}, config: {}}`
 * was accepted, and screens/battle.js assigned it to `ctx.state.battle` before
 * throwing inside `enter()`. The scene stack catches an `enter` throw and pushes
 * the half-built scene anyway, so `update()` then stepped a battle with no sites
 * ten times a second, forever, on a blank screen — and because `clearBattle` is
 * only reached from a FINISHED battle, the same blob crashed the next reload, and
 * the next. Permanently bricked short of clearing storage by hand.
 *
 * The comment in screens/battle.js said "the state was validated on the way out of
 * storage". It is true now.
 *
 * A blob is explicitly ephemeral and never precious, so anything that fails here
 * is thrown away rather than repaired — which is the policy this whole file
 * already states, applied to the shape as well as the age.
 */
function steppable(blob) {
  const b = blob.battle;
  if (!b || typeof b !== 'object') return false;
  if (!Array.isArray(b.sites) || b.sites.length < 2) return false;
  if (!b.grid || typeof b.grid !== 'object') return false;
  if (!Array.isArray(b.commands) || !Array.isArray(b.events)) return false;
  if (!Number.isFinite(b.tick) || b.tick < 0) return false;
  if (!b.factions || !b.rules) return false;
  // The config goes through the SAME assertion the fresh path uses, so a resumed
  // battle cannot be built on a config a new battle would have refused.
  try { assertBattleConfig(blob.config); } catch { return false; }
  return true;
}

function discard(storage, reason) {
  clearBattle(storage);
  return { ok: false, reason };
}
