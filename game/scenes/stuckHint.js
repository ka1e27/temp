// The "Stuck?" coach hint's decision, pure (battle.js supplies the facts and draws the bubble). Once per battle, hints on, never while the
// tutorial has a hint of its own on screen: when STUCK_HINT.afterSec of battle time has passed since the
// player's last capture (or the start) and a power the hint can name is unlocked AND ready, it says so. Only such powers are named.
import { STUCK_HINT } from './timing.js';

/**
 * @param {{ hintsOn: boolean, tutorialHintActive: boolean, battleT: number, lastCaptureT: number, done: boolean,
 *   fireReady: boolean, rallyReady: boolean }} f
 * @returns {{ key: 'both'|'firestorm'|'rally', text: string, power: 'firestorm'|'rally' } | null}
 */
export function stuckHintDue(f) {
  if (f.done || !f.hintsOn) return null;
  if (f.tutorialHintActive) return null;
  if (f.battleT - f.lastCaptureT < STUCK_HINT.afterSec) return null;
  if (!f.fireReady && !f.rallyReady) return null;
  const key = f.fireReady && f.rallyReady ? 'both' : f.fireReady ? 'firestorm' : 'rally';
  return { key, text: STUCK_HINT.text[key], power: f.fireReady ? 'firestorm' : 'rally' };
}
