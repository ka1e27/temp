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
import { CONTRACT_VERSION } from '../battle/contract.js';

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

  return { ok: true, battle: blob.battle, config: blob.config, ageMs };
}

function discard(storage, reason) {
  clearBattle(storage);
  return { ok: false, reason };
}
