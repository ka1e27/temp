// Top-level renderer (ARCHITECTURE §7, §9): owns the canvas/DPR/resize
// lifecycle and the sub-layer caches (terrain, site sprites, clouds, overlays,
// units, fx), rebuilding the world-shaped caches whenever the world changes
// (New Realm / Found Dynasty). Scenes (game/scenes/*) do the actual per-frame
// draw-order composition by calling these layers directly — this file is the
// shared instance + canvas plumbing they compose.
import { createTerrainCache, oceanStops } from './terrainCache.js';
import { createSiteSpriteCache } from './sites.js';
import { createCloudLayer } from './cloudLayer.js';
import { createOverlays } from './overlays.js';
import { createArenaLayer } from './arenaLayer.js';
import { createUnitLayer } from './units.js';
import { createAmbient } from './ambient.js';
import { createFx } from './fx.js';

export const MAX_DPR = 2;

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let dpr = 1;
  let cssW = canvas.clientWidth || 300;
  let cssH = canvas.clientHeight || 150;

  let world = null;
  let terrain = null;
  let clouds = null;
  let overlays = null;
  let arena = null;
  let ambient = null; // caravans, smoke, sails, boats, birds: one per world
  let reduceMotion = false;

  // World-independent layers persist across `setWorld` calls.
  const sites = createSiteSpriteCache();
  const units = createUnitLayer();
  const fx = createFx({ reduceMotion: false });

  // Vertical extent of the sea gradient in world units (see terrainCache.js).
  let oceanMinY = -2;
  let oceanMaxY = 56;

  /** @param {import('../world/generate.js').World} newWorld */
  function setWorld(newWorld) {
    world = newWorld;
    terrain = createTerrainCache(world);
    terrain.setPixelRatio(dpr);
    clouds = createCloudLayer(world);
    clouds.setPixelRatio(dpr);
    overlays = createOverlays(world);
    overlays.setPixelRatio(dpr);
    arena = createArenaLayer(world);
    arena.setPixelRatio(dpr);
    // The ambient life shares the terrain cache's prosperity plan (the windmill sites).
    ambient = createAmbient({ world, seed: world.seed, plan: terrain.plan, pixelRatio: dpr, reduceMotion });
    oceanMinY = terrain.seaExtent.minY;
    oceanMaxY = terrain.seaExtent.maxY;
    units.reset();
    fx.clear();
  }

  /** @param {number} cssWidth @param {number} cssHeight @param {number} devicePixelRatio */
  function resize(cssWidth, cssHeight, devicePixelRatio) {
    cssW = Math.max(1, Math.round(cssWidth));
    cssH = Math.max(1, Math.round(cssHeight));
    dpr = Math.max(1, Math.min(MAX_DPR, devicePixelRatio || 1));
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    if (terrain) terrain.setPixelRatio(dpr);
    if (clouds) clouds.setPixelRatio(dpr);
    if (overlays) overlays.setPixelRatio(dpr);
    if (arena) arena.setPixelRatio(dpr);
    if (ambient) ambient.setPixelRatio(dpr);
    sites.setPixelRatio(dpr);
  }

  /**
   * Call once per animation frame, before any scene draws. Paints the sea
   * gradient (so anything beyond the baked chunk grid, e.g. deep water past the
   * world edge at extreme zoom-out, matches the chunks exactly), syncs the
   * camera's viewport, and — if `shake` is given — translates all following
   * drawing (never hit testing) by the fx shake offset.
   * @param {object} camera
   * @param {{x:number,y:number}} [shake]
   */
  function beginFrame(camera, shake) {
    camera.resize(cssW, cssH);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [top, bottom] = oceanStops();
    const y0 = camera.worldToScreen(0, oceanMinY).y;
    const y1 = camera.worldToScreen(0, oceanMaxY).y;
    const g = ctx.createLinearGradient(0, y0, 0, Math.max(y0 + 1, y1));
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssW, cssH);
    if (shake && (shake.x || shake.y)) {
      ctx.translate(shake.x, shake.y);
      // Cover the strip the translate exposes.
      ctx.fillRect(-24, -24, cssW + 48, cssH + 48);
    }
  }

  return {
    canvas,
    get ctx() { return ctx; },
    get world() { return world; },
    get cssWidth() { return cssW; },
    get cssHeight() { return cssH; },
    get dpr() { return dpr; },
    setWorld,
    resize,
    beginFrame,
    get terrain() { return terrain; },
    get clouds() { return clouds; },
    get overlays() { return overlays; },
    get arena() { return arena; },
    get ambient() { return ambient; },
    /** Reduce Motion for the ambient layer (no birds, still sails, half the smoke, slower carts). */
    setReduceMotion(on) { reduceMotion = !!on; if (ambient) ambient.setReduceMotion(reduceMotion); },
    sites,
    units,
    fx,
  };
}
