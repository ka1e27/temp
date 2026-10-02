// The whole continent as one picture (DESIGN §5.9): what the Tapestry frames. Browser only; read-only on the game: it makes
// its OWN renderer on a fresh detached canvas, so the live map, its camera and its terrain cache are never touched, and
// it can be called while the Found a Dynasty modal is open over the finished realm.
//
//   const map = renderWorldImage({ world, state, width: 700, scale: 2 });     // 1400 px wide canvas
//   const tapestry = composeTapestry({ mapCanvas: map, ... });                // game/render/tapestry.js
//
// Territory tint and borders, settlements with their banners and every region's name; no fog, clouds, HUD or selection. It is
// drawn with the same layers the world scene uses (terrain cache, site drawer, region labels), so it always looks like the
// game. Cost: about half a second for a 2200 px picture on a desktop, once per save, off the frame loop.
import { createRenderer } from '../render/renderer.js';
import { createCamera } from '../render/camera.js';
import { drawRegionLabels } from '../render/labels.js';
import { PLAYER_FACTION } from '../meta/state.js';
import { tapestryData } from '../meta/keepsake.js';
import { CHRONICLE } from '../config/chronicle.js';
import { composeTapestry, downloadCanvas, ensureTapestryFonts, tapestryFilename } from '../render/tapestry.js';
import { createSiteDrawer, regionLabelAnchors } from './worldLayers.js';

/** World units of margin around the continent's bounds: a little sea all round, enough for a name at the coast not to be clipped. */
export const WORLD_IMAGE_PADDING = 3.4;
/** Region names are drawn as if the camera were this much more zoomed in, so they stay legible on a whole-continent picture. */
export const WORLD_IMAGE_LABEL_BOOST = 1.7;

/**
 * @param {{ world: import('../world/generate.js').World, state: import('../meta/state.js').GameState, width: number, scale?: number, padding?: number }} o
 *   `width` CSS pixels, `scale` the pixel ratio (the renderer caps it at 2); the canvas is `width * scale` pixels wide
 * @returns {HTMLCanvasElement}
 */
export function renderWorldImage({ world, state, width, scale = 2, padding = WORLD_IMAGE_PADDING }) {
  const b = world.bounds;
  const bw = b.maxX - b.minX + padding * 2;
  const bh = b.maxY - b.minY + padding * 2;
  const height = Math.round((width * bh) / bw);
  const canvas = document.createElement('canvas');
  const renderer = createRenderer(canvas);
  const camera = createCamera({ minZoom: 0.1, maxZoom: 400 });
  renderer.setWorld(world);
  renderer.resize(width, height, scale);
  camera.resize(width, height);
  camera.zoom = width / bw;
  camera.x = (b.minX + b.maxX) / 2;
  camera.y = (b.minY + b.maxY) / 2;

  const owners = state.owner.slice(); // everything revealed: no fog
  const anchors = regionLabelAnchors(world);
  const labelData = world.regions.map((r) => ({
    x: anchors[r.id].x,
    y: anchors[r.id].y,
    name: r.name,
    regionId: r.id,
    isCapital: r.isCapital && owners[r.id] !== PLAYER_FACTION,
    priority: owners[r.id] === PLAYER_FACTION ? 3 : r.isCapital ? 2 : 4,
  }));

  const { ctx } = renderer;
  renderer.beginFrame(camera);
  renderer.terrain.draw(ctx, camera, owners);
  createSiteDrawer(world).draw(ctx, renderer, camera, owners, 0, () => true, { hideHamlets: false });
  // drawRegionLabels sizes its font from camera.zoom; a proxy with a larger zoom (same world-to-screen mapping) keeps every
  // name legible on a whole-continent picture without touching the label code.
  const labelCamera = {
    worldToScreen: (x, y) => camera.worldToScreen(x, y),
    zoom: camera.zoom * WORLD_IMAGE_LABEL_BOOST,
    viewW: camera.viewW,
    viewH: camera.viewH,
  };
  drawRegionLabels(ctx, labelCamera, labelData);
  return canvas;
}

/**
 * "Save the map": renders the whole continent, frames it as the Tapestry and starts the PNG download. Never throws; resolves
 * `{ ok, file }` (`ok` false when the browser refused the file or anything failed). Reads the game, changes nothing, so it can
 * run over the finished realm while the Found a Dynasty modal is open. The caller shows its busy state and the toast
 * (`saveText('done', { file })` / `saveText('failed')` from meta/keepsake.js).
 * @param {import('../meta/state.js').GameState} state
 * @param {import('../world/generate.js').World} world
 * @param {number} now  ms timestamp (the date on the picture and in the file name)
 * @returns {Promise<{ ok: boolean, file: string }>}
 */
export async function saveTapestry(state, world, now) {
  let file = '';
  try {
    const data = tapestryData(state, world, now);
    file = tapestryFilename({ dynasty: data.dynasty, date: data.date });
    await ensureTapestryFonts();
    // let a "Saving..." label paint before the half second of drawing
    await new Promise((resolve) => setTimeout(resolve, 50));
    const phone = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
    const width = phone ? CHRONICLE.tapestryWidth.phone : CHRONICLE.tapestryWidth.desktop;
    const mapCanvas = renderWorldImage({ world, state, width, scale: 2 });
    const canvas = composeTapestry({ mapCanvas, ...data });
    return { ok: await downloadCanvas(canvas, file), file };
  } catch {
    return { ok: false, file };
  }
}
