// Owns the live {state, world} pair and every transition that replaces one or
// both (load-on-boot, New Realm, Found Dynasty, dev Reseed). `storage` and
// `now` are injected so this stays testable without real localStorage/Date.
import { generateWorld } from '../world/generate.js';
import { createGame, resetRegions } from '../meta/state.js';
import { loadFrom } from '../meta/save.js';
import { foundDynasty } from '../meta/progression.js';
import { chronicleOnDynasty } from '../meta/chronicle.js';
import { worldOptsFor } from '../meta/edicts.js';
import { syncRelics } from '../meta/relics.js';

function randomSeed() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] >>> 0;
  }
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

/**
 * @param {{ storage: { getItem, setItem }, now: () => number }} deps
 */
export function createStateContainer({ storage, now }) {
  let state = null;
  let world = null;
  // Rises every time the realm is REPLACED (boot, new realm, restart, a new dynasty, an import): anything computed for the old realm (a welcome-back card, queued
  // prosperity cheers, an idle coin pop) carries the epoch it was made in and is dropped when it no longer matches.
  let epoch = 0;

  /** Loads the save if one exists and its world regenerates cleanly; else starts a fresh realm (on `freshSeed` when given: ?dev=1&seed=N). */
  function boot(freshSeed) {
    let loaded = null;
    try {
      loaded = loadFrom(storage);
    } catch {
      loaded = null;
    }
    if (loaded) {
      try {
        world = generateWorld(loaded.seed >>> 0, worldOptsFor(loaded)); // the Edict shapes the continent (Long Winter, Age of Dragons, Open Roads)
        state = loaded;
        epoch += 1;
        // A hand-edited / older save whose owner table doesn't fit this world is repaired, not trusted.
        if (!Array.isArray(state.owner) || state.owner.length !== world.regions.length) resetRegions(state, world, now());
        else if (!Array.isArray(state.conqueredAt) || state.conqueredAt.length !== world.regions.length) {
          state.conqueredAt = world.regions.map((r, i) => (state.owner[i] === 0 ? now() : null));
        }
        try { syncRelics(state, world); } catch (err) { console.warn('[relics] sync skipped:', err); } // Phase 7: a save from before Relics gets its chests
        return { state, world, resumed: true };
      } catch {
        // A corrupt/foreign seed (or a worldgen regression) must never brick the boot:
        // fall through to a fresh realm rather than leaving the player stuck on a blank map.
      }
    }
    newRealm(freshSeed);
    return { state, world, resumed: false };
  }

  /** @param {number} [seed] omit for a random one (Date.now()/crypto, DESIGN §8). */
  function newRealm(seed, { keepGenerals = true } = {}) {
    const s = (seed ?? randomSeed()) >>> 0;
    world = generateWorld(s);
    epoch += 1;
    const prev = state;
    state = createGame(s, world, now());
    // the player's SETTINGS are not part of a realm: sound, Reduce Motion, hints... survive a new realm, a reset and a reseed
    if (prev && prev.settings) state.settings = { ...prev.settings };
    // the Generals are lifetime progress (DESIGN 10.11): a new realm keeps the roster, freed (Settings > Reset passes keepGenerals: false)
    if (keepGenerals) carryRoster(prev);
    return { state, world };
  }

  function carryRoster(prev) {
    if (!prev || !prev.generals || !Array.isArray(prev.generals.roster)) return;
    state.generals = { ...prev.generals, roster: prev.generals.roster.map((g) => ({ ...g, regionId: null })) };
  }

  /** A fresh game on the CURRENT world (title "New Realm" when nothing was saved yet, so the
   *  continent the player has been looking at is the one they start on). */
  function restart() {
    epoch += 1;
    const prev = state;
    state = createGame(world.seed, world, now());
    if (prev && prev.settings) state.settings = { ...prev.settings }; // settings outlive the realm
    carryRoster(prev); // and so do the Generals
    return { state, world };
  }

  /** Same as `newRealm` but explicit about intent for callers (dev panel "Reseed"). */
  function reseed(seed) {
    return newRealm(seed);
  }

  /** DESIGN §5.4: keeps stars/lifetime stats/settings, resets onto a new continent with tougher enemies (its region count is whatever the generator makes of the request; never promise it is larger). */
  /**
   * @param {{ seed?: number, edict?: string|null, challenges?: string[] }} [choice] the founding ceremony's picks (PLAN-PHASE5): the seed it drew the Edicts
   *   for, the Edict and the Challenges
   */
  function tryFoundDynasty(choice = {}) {
    if (!state) return false;
    const seed = (choice.seed ?? randomSeed()) >>> 0;
    // the continent being left (its Dragon's Lair may stand: it is optional); the Edict and Challenges are applied by foundDynasty
    const buys = Array.isArray(choice.legacyBuys) ? choice.legacyBuys : [];
    const next = foundDynasty(state, seed, undefined, world, { edict: choice.edict ?? null, challenges: choice.challenges || [], legacyBuys: buys });
    if (!next) return false;
    // the Legacy bought during the ceremony (on a preview) is applied by foundDynasty (`legacyBuys`, before the dynasty-start effects); its report rides on
    // the non-saved `next.founding` ({ legacyEarned, bought, refused }), handed back to the scene
    const founding = next.founding || null;
    world = generateWorld(seed, worldOptsFor(next));
    const t = now();
    state = resetRegions(next, world, t);
    try { chronicleOnDynasty(state, world, { t }); } catch (err) { console.warn('[chronicle] dynasty line skipped:', err); } // closes the old chapter, opens the next (Keepsakes); never blocks founding
    epoch += 1;
    return { state, world, founding };
  }

  /** A seed for the next founding (the ceremony draws its Edicts for it, then founds on it). */
  function nextSeed() { return randomSeed(); }

  function get() {
    return { state, world };
  }

  // Phase 9 (docs/briefs/phase9-hookup.md §1): a challenge is an ordinary {state, world} pair. While one is played the container POINTS at it, and the
  // realm's pair waits here untouched (never read or written by the sandbox); leaving points back at the very same objects.
  let parked = null; // { state, world } of the realm while a challenge is played
  /** Plays `pair` (a challenge) in place of the realm. A second call replaces the challenge (Retry); the realm stays parked. */
  function enterSandbox(pair) {
    if (!pair || !pair.state || !pair.world) return false;
    if (!parked) parked = { state, world };
    state = pair.state;
    world = pair.world;
    epoch += 1;
    return true;
  }
  /** Back to the realm, exactly as it was parked. */
  function leaveSandbox() {
    if (!parked) return false;
    state = parked.state;
    world = parked.world;
    parked = null;
    epoch += 1;
    return true;
  }
  /** The realm's pair, whether or not a challenge is being played (Settings, the Codex, the Daily reward read it). */
  function main() { return parked || { state, world }; }

  /** For save-import (settings "Import"): swap in a validated GameState and
   *  regenerate its world from `newState.seed`. Returns false (no-op) if that
   *  seed's world fails to generate, so a bad/foreign code can never brick play. */
  function replaceState(newState) {
    try {
      const newWorld = generateWorld(newState.seed >>> 0, worldOptsFor(newState));
      world = newWorld;
      state = newState;
      epoch += 1;
      try { syncRelics(state, world); } catch (err) { console.warn('[relics] sync skipped:', err); }
      return true;
    } catch {
      return false;
    }
  }

  return {
    boot, newRealm, restart, reseed, tryFoundDynasty, nextSeed, get, replaceState,
    enterSandbox, leaveSandbox, main,
    get inSandbox() { return !!parked; },
    get epoch() { return epoch; },
  };
}
