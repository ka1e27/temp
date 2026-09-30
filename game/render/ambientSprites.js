// Pre-rendered sprites for the living map (DESIGN §7.7), cached per zoom bucket with a per-frame bake
// budget. The art itself is in ambientArt.js. Nothing here creates a gradient or a canvas per frame.
import { AMBIENT } from '../config/ambient.js';
import {
  setCanvasFactory, CART_TILT_STEPS, buildCart, buildSails, buildBoat, buildPuff, buildPlume,
} from './ambientArt.js';

export { setCanvasFactory, CART_TILT_STEPS };

/** Device px per world unit; same ladder as the terrain / site sprite caches. */
export const BUCKETS = Object.freeze([8, 11, 16, 22, 32, 45, 64, 90, 128]);

/** Index of the bucket nearest (in log space) to `devScale` device px per world unit. */
export function bucketIndex(devScale) {
  let best = 0;
  let bestD = Infinity;
  const l = Math.log(Math.max(1, devScale));
  for (let i = 0; i < BUCKETS.length; i++) {
    const d = Math.abs(Math.log(BUCKETS[i]) - l);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ------------------------------------------------------------------- cache

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * One cache per ambient instance. Every getter builds lazily and memoises, but only while the frame's
 * build budget (`beginFrame(ms)`) is not spent: a sprite that would push a frame over budget is
 * answered with the nearest zoom bucket that already exists (any bucket works, callers scale by
 * `sprite.bucket`), or `null` when there is none yet. So crossing into a new zoom bucket spreads
 * its ~30 ms of sprite baking over several frames instead of one hitch. At least one sprite is
 * built per frame, so the cache always converges.
 */
export function createSpriteCache() {
  const stores = { cart: [], sails: [], boat: [], plume: [] }; // [bucketIdx][key]
  const puffs = { smoke: [], smokeDark: [], dust: [] };
  const rgbOf = { smoke: '240,237,230', smokeDark: '204,200,194', dust: '214,190,138' };
  let spent = 0;
  let budget = Infinity;

  function puff(kind, variant) {
    const list = puffs[kind];
    return list[variant] || (list[variant] = buildPuff(rgbOf[kind], variant));
  }

  function lookup(store, bi, key, build) {
    const row = store[bi] || (store[bi] = []);
    const hit = row[key];
    if (hit) return hit;
    if (spent > budget) {
      for (let d = 1; d <= 3; d++) {
        const lo = store[bi - d] && store[bi - d][key];
        if (lo) return lo;
        const hi = store[bi + d] && store[bi + d][key];
        if (hi) return hi;
      }
      return null;
    }
    const t0 = clock();
    const built = build();
    row[key] = built;
    spent += clock() - t0;
    return built;
  }

  const api = {
    /** Call once per draw call: sets how many ms of NEW sprite baking this frame may spend. */
    beginFrame(ms = Infinity) {
      spent = 0;
      budget = ms;
    },
    /** Cart sprite baked at tilt `tiltIdx` (-3..3), facing left or right, with or without its dust trail, loaded or `empty`. */
    cart(bi, frame, tiltIdx = 0, left = false, dust = true, empty = false) {
      const key = ((((tiltIdx + CART_TILT_STEPS) * 2 + frame) * 2 + (left ? 1 : 0)) * 2 + (dust ? 1 : 0)) * 2 + (empty ? 1 : 0);
      return lookup(stores.cart, bi, key, () => buildCart(BUCKETS[bi], frame, tiltIdx, left, dust, empty));
    },
    sails(bi) {
      return lookup(stores.sails, bi, 0, () => buildSails(BUCKETS[bi]));
    },
    /** variant 0 = the player's boats (sails in the owner colour), 1 = everyone else's (off-white). */
    boat(bi, variant) {
      return lookup(stores.boat, bi, variant, () => buildBoat(BUCKETS[bi], variant));
    },
    /** A chimney's looping plume strip; `sparse` = the half-density version (Reduce Motion, low quality). */
    plume(bi, variant, sparse) {
      const key = variant * 2 + (sparse ? 1 : 0);
      return lookup(stores.plume, bi, key, () => buildPlume(
        BUCKETS[bi], variant, sparse ? AMBIENT.smoke.puffsSparse : AMBIENT.smoke.puffs,
        [0, 1, 2, 3].map((v) => puff('smoke', v)), [0, 1, 2, 3].map((v) => puff('smokeDark', v)),
      ));
    },
    puff,
    /** Builds everything a bucket can need right now (boot, or a camera settling): ~30 ms, no budget. */
    prewarm(bi) {
      const keep = budget;
      budget = Infinity;
      for (let variant = 0; variant < AMBIENT.smoke.variants; variant++) {
        api.plume(bi, variant, false);
        api.plume(bi, variant, true);
      }
      api.sails(bi);
      api.boat(bi, 0);
      api.boat(bi, 1);
      for (let tilt = -CART_TILT_STEPS; tilt <= CART_TILT_STEPS; tilt++) {
        for (let frame = 0; frame < 2; frame++) {
          for (const left of [false, true]) {
            api.cart(bi, frame, tilt, left, true, false);
            api.cart(bi, frame, tilt, left, true, true);
          }
        }
      }
      budget = keep;
    },
    clear() {
      for (const k of Object.keys(stores)) stores[k].length = 0;
      puffs.smoke.length = 0;
      puffs.smokeDark.length = 0;
      puffs.dust.length = 0;
    },
    /** For the gallery/tests: how many sprites exist. */
    count() {
      let n = 0;
      for (const k of Object.keys(stores)) for (const row of stores[k]) if (row) n += row.filter(Boolean).length;
      return n;
    },
  };
  return api;
}
