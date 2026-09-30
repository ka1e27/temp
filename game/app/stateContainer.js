// Owns the live {state, world} pair and every transition that replaces one or
// both (load-on-boot, New Realm, Found Dynasty, dev Reseed). `storage` and
// `now` are injected so this stays testable without real localStorage/Date.
import { generateWorld } from '../world/generate.js';
import { createGame, resetRegions } from '../meta/state.js';
import { loadFrom } from '../meta/save.js';
import { foundDynasty } from '../meta/progression.js';

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

  /** Loads the save if one exists and its world regenerates cleanly; else starts a fresh realm. */
  function boot() {
    let loaded = null;
    try {
      loaded = loadFrom(storage);
    } catch {
      loaded = null;
    }
    if (loaded) {
      try {
        world = generateWorld(loaded.seed >>> 0, { dynasty: loaded.dynasty?.level });
        state = loaded;
        // A hand-edited / older save whose owner table doesn't fit this world is repaired, not trusted.
        if (!Array.isArray(state.owner) || state.owner.length !== world.regions.length) resetRegions(state, world, now());
        else if (!Array.isArray(state.conqueredAt) || state.conqueredAt.length !== world.regions.length) {
          state.conqueredAt = world.regions.map((r, i) => (state.owner[i] === 0 ? now() : null));
        }
        return { state, world, resumed: true };
      } catch {
        // A corrupt/foreign seed (or a worldgen regression) must never brick the boot:
        // fall through to a fresh realm rather than leaving the player stuck on a blank map.
      }
    }
    newRealm();
    return { state, world, resumed: false };
  }

  /** @param {number} [seed] omit for a random one (Date.now()/crypto, DESIGN §8). */
  function newRealm(seed) {
    const s = (seed ?? randomSeed()) >>> 0;
    world = generateWorld(s);
    state = createGame(s, world, now());
    return { state, world };
  }

  /** A fresh game on the CURRENT world (title "New Realm" when nothing was saved yet, so the
   *  continent the player has been looking at is the one they start on). */
  function restart() {
    state = createGame(world.seed, world, now());
    return { state, world };
  }

  /** Same as `newRealm` but explicit about intent for callers (dev panel "Reseed"). */
  function reseed(seed) {
    return newRealm(seed);
  }

  /** DESIGN §5.4: keeps stars/lifetime stats/settings, resets onto a new continent with tougher enemies (its region count is whatever the generator makes of the request; never promise it is larger). */
  function tryFoundDynasty() {
    if (!state) return false;
    const seed = randomSeed();
    const next = foundDynasty(state, seed);
    if (!next) return false;
    world = generateWorld(seed, { dynasty: next.dynasty.level });
    state = resetRegions(next, world, now());
    return { state, world };
  }

  function get() {
    return { state, world };
  }

  /** For save-import (settings "Import"): swap in a validated GameState and
   *  regenerate its world from `newState.seed`. Returns false (no-op) if that
   *  seed's world fails to generate, so a bad/foreign code can never brick play. */
  function replaceState(newState) {
    try {
      const newWorld = generateWorld(newState.seed >>> 0, { dynasty: newState.dynasty?.level });
      world = newWorld;
      state = newState;
      return true;
    } catch {
      return false;
    }
  }

  return {
    boot, newRealm, restart, reseed, tryFoundDynasty, get, replaceState,
  };
}
