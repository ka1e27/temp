// Scene barrel. This is the extension point for new screens — main.js wires
// the registry once and is then frozen, so adding a scene never touches it.
import { createWorldMapScene } from './worldmap.js';
import { createBattleScene } from './battle.js';
import { createShopScene } from './shop.js';
import { createResultsScene } from './results.js';

/**
 * Scenes never construct each other; they read `ctx.screens` and hand the
 * instance to the scene stack. Building them all up front keeps the wiring in
 * one place and the lifetime obvious.
 */
export function createScreens(ctx) {
  const screens = {};
  ctx.screens = screens;
  screens.worldmap = createWorldMapScene(ctx);
  screens.battle = createBattleScene(ctx);
  screens.shop = createShopScene(ctx);
  screens.results = createResultsScene(ctx);
  return screens;
}
