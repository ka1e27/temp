// Scene barrel. This is the extension point for new screens — main.js wires
// the registry once and is then frozen, so adding a scene never touches it.
import { createMainMenuScene } from './mainmenu.js';
import { createWorldMapScene } from './worldmap.js';
import { createPreBattleScene } from './prebattle.js';
import { createBattleScene } from './battle.js';
import { createShopScene } from './shop.js';
import { createIncursionScene } from './incursion.js';
import { createResultsScene } from './results.js';

/**
 * Scenes never construct each other; they read `ctx.screens` and hand the
 * instance to the scene stack. Building them all up front keeps the wiring in
 * one place and the lifetime obvious.
 *
 * The campaign flow is:
 *   mainmenu -> worldmap -> prebattle -> battle -> results -> worldmap
 * with `shop` pushed as an overlay from the map or the loadout, and `mainmenu`
 * reachable again from the map's Menu button. main.js may open with EITHER
 * `mainmenu` or `worldmap`; whichever it is, exactly one of them takes the boot
 * decision (see mainmenu.bootRoute) and the other stands down.
 *
 * `incursion` is the endless ladder's briefing and joins the flow at the same
 * place the shop does — an overlay pushed from the map, which then hands off to
 * `prebattle` carrying a depth. It is only offered once every region has fallen.
 */
export function createScreens(ctx) {
  const screens = {};
  ctx.screens = screens;
  screens.mainmenu = createMainMenuScene(ctx);
  screens.worldmap = createWorldMapScene(ctx);
  screens.prebattle = createPreBattleScene(ctx);
  screens.battle = createBattleScene(ctx);
  screens.shop = createShopScene(ctx);
  screens.incursion = createIncursionScene(ctx);
  screens.results = createResultsScene(ctx);
  return screens;
}
