// The battle scene — THE ONLY BROKER between the meta layer and the battle
// engine. `src/battle/**` and `src/meta/**` never import each other; both sides
// speak only `battle/contract.js`, and this file carries the messages.
//
//   meta ──buildBattleConfig──▶ assertBattleConfig ──▶ startBattle
//   battle ──toOutcome──▶ assertBattleOutcome ──▶ meta/rewards.applyOutcome
import { assertBattleConfig, assertBattleOutcome } from '../battle/contract.js';
import { startBattle, step } from '../battle/sim.js';
import { toOutcome } from '../battle/outcome.js';
import { drainEvents } from '../battle/events.js';
import { buildBattleConfig } from '../meta/modifiers.js';
import { generateBattleMap } from '../battle/mapgen.js';
import { createBattleView } from '../render/battleView.js';
import { createBattleInput, createView } from '../screens/battle-input.js';
import { createBattleHud, travelSecondsFor } from '../screens/battle-hud.js';
import { qs } from '../ui/dom.js';

/**
 * @param {object} ctx {state, bus, scenes, root, hudRoot}
 */
export function createBattleScene(ctx) {
  let view = null;
  let input = null;
  let hud = null;
  let board = null;
  let config = null;
  let finished = false;

  const getState = () => ctx.state.battle;

  return {
    id: 'battle',

    enter(params) {
      const { regionId, boosters } = params;
      finished = false;

      // ---- meta -> battle -------------------------------------------------
      config = buildBattleConfig(ctx.state.meta, regionId, boosters, generateBattleMap);
      assertBattleConfig(config);
      ctx.state.battle = startBattle(config);
      ctx.state.session.pendingConfig = config;

      // Keep the tick-0 snapshot in memory so Retry is instant. ~5KB, and it
      // matters: the intended experience is failing a hard region twice and
      // adjusting your expedition rather than reloading the page.
      ctx.state.session.snapshot = JSON.stringify(ctx.state.battle);

      board = createBattleView({ bg: qs('#board-bg'), fx: qs('#board-fx') });
      const presentation = createView();
      input = createBattleInput({
        canvas: qs('#board-fx'), board, view: presentation, getState, bus: ctx.bus,
      });
      hud = createBattleHud({
        root: ctx.hudRoot, getState, view: presentation, input, board,
        bus: ctx.bus, travelSeconds: travelSecondsFor,
      });
      view = presentation;

      document.body.dataset.scene = 'battle';
      // Exposed for the browser smoke test, which drives real drag gestures
      // through the same pointer path a player uses.
      if (window.__game) window.__game.__view = board;

      return [
        () => input?.dispose(),
        () => hud?.dispose(),
        () => board?.dispose(),
      ];
    },

    exit() {
      ctx.state.battle = null;
      view = input = hud = board = null;
      delete document.body.dataset.scene;
    },

    update() {
      const battle = getState();
      if (!battle || finished) return;

      step(battle);

      // The sim never touches the bus. It appends notifications to
      // state.events and we drain them here, AFTER the tick, so a listener can
      // never mutate state the simulation is mid-way through iterating.
      for (const ev of drainEvents(battle)) ctx.bus.emit(`battle:${ev.type}`, ev);

      if (battle.status !== 'running') finish(battle);
    },

    render(alpha) {
      const battle = getState();
      if (battle && board) board.draw(battle, alpha, view);
      hud?.update();
    },
  };

  // ---- battle -> meta ---------------------------------------------------
  function finish(battle) {
    finished = true;
    const outcome = toOutcome(battle, config);
    assertBattleOutcome(outcome, config);
    ctx.state.session.lastOutcome = outcome;
    ctx.scenes.replace(ctx.screens.results, { outcome, config });
  }
}
