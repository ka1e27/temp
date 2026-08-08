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
import { setRiverLayer } from '../render/hexRenderer.js';
import { createFx, fxFromEvent } from '../render/fx.js';
import { createBattleInput, createView } from '../screens/battle-input.js';
import { createBattleHud, travelSecondsFor } from '../screens/battle-hud.js';
import { saveBattle, clearBattle } from '../meta/resume.js';
import { qs } from '../ui/dom.js';

/** Checkpoint cadence. A refresh should cost seconds, not the whole fight. */
const RESUME_EVERY_MS = 4000;

/**
 * @param {object} ctx {state, bus, scenes, root, hudRoot}
 */
export function createBattleScene(ctx) {
  let view = null;
  let input = null;
  let hud = null;
  let board = null;
  let fx = null;
  let coach = null;
  let config = null;
  let finished = false;
  let lastResumeAt = 0;

  /**
   * Coach marks are optional: the game must run whether or not ui/coach.js
   * exists yet, so this loads it lazily and never lets a missing tutorial stop
   * a battle. Onboarding is additive, never load-bearing.
   */
  function mountCoach() {
    if (ctx.state.meta.tutorialSeen) return null;
    let live = null;
    let disposed = false;
    import('../ui/coach.js')
      .then((m) => {
        if (disposed || !m.createCoach) return;
        live = m.createCoach({
          root: ctx.hudRoot,
          bus: ctx.bus,
          getState,
          getMeta: () => ctx.state.meta,
        });
      })
      .catch(() => { /* no coach module yet — play on */ });
    return {
      update: () => live?.update?.(),
      dispose: () => { disposed = true; live?.dispose?.(); live = null; },
    };
  }

  const getState = () => ctx.state.battle;

  /** Sim events name a site, never a coordinate — the simulation has no idea
   *  where anything is on screen. Effects need one, so resolve it here. */
  const locate = (siteId) => {
    const battle = getState();
    const site = battle?.sites.find((s) => s.id === siteId);
    return site && board ? board.sitePos(site, { x: 0, y: 0 }) : null;
  };

  return {
    id: 'battle',

    enter(params) {
      const { regionId, boosters, composition, resume } = params;
      finished = false;

      if (resume) {
        // Picked back up mid-fight after a refresh. The state was validated on
        // the way out of storage, so it is stepped exactly as it was left.
        config = resume.config;
        ctx.state.battle = resume.battle;
      } else {
        // ---- meta -> battle -----------------------------------------------
        // `composition` comes from the pre-battle loadout screen. modifiers.js
        // treats it as ratios and refits it to the expedition budget, so the
        // screen can never mint troops.
        config = buildBattleConfig(
          ctx.state.meta, regionId, boosters, generateBattleMap,
          composition ? { composition } : undefined,
        );
        assertBattleConfig(config);
        ctx.state.battle = startBattle(config);
      }
      ctx.state.session.pendingConfig = config;
      lastResumeAt = 0;
      // Hand the board its river layer. It comes off the SIMULATION, not off
      // the config, so a resumed battle draws the map it is actually being
      // fought on — and the two can never disagree.
      setRiverLayer(ctx.state.battle.grid.rivers);

      fx = createFx();
      board = createBattleView({ bg: qs('#board-bg'), fx: qs('#board-fx'), fxLayer: fx });
      const presentation = createView();
      input = createBattleInput({
        canvas: qs('#board-fx'), board, view: presentation, getState, bus: ctx.bus,
      });
      hud = createBattleHud({
        root: ctx.hudRoot, getState, view: presentation, input, board,
        bus: ctx.bus, travelSeconds: travelSecondsFor,
        // The HUD must not reach the loop directly; presentation never drives
        // the clock. It asks, and the shell decides.
        onSetSpeed: (n) => ctx.loop?.setSpeed(n),
        getSpeed: () => ctx.loop?.speed ?? 1,
      });
      view = presentation;

      coach = mountCoach();

      document.body.dataset.scene = 'battle';
      // Exposed for the browser smoke test, which drives real drag gestures
      // through the same pointer path a player uses.
      if (window.__game) { window.__game.__view = board; window.__game.__fx = fx; }

      return [
        () => input?.dispose(),
        () => hud?.dispose(),
        () => board?.dispose(),
        () => coach?.dispose(),
      ];
    },

    exit() {
      ctx.state.battle = null;
      view = input = hud = board = fx = null;
      delete document.body.dataset.scene;
    },

    update() {
      const battle = getState();
      if (!battle || finished) return;

      step(battle);

      // The sim never touches the bus. It appends notifications to
      // state.events and we drain them here, AFTER the tick, so a listener can
      // never mutate state the simulation is mid-way through iterating.
      for (const ev of drainEvents(battle)) {
        fxFromEvent(fx, ev, board.palette, board.hexSize, locate);
        ctx.bus.emit(`battle:${ev.type}`, ev);
      }

      coach?.update();

      // Checkpoint often enough that a refresh costs seconds, not the fight.
      const now = Date.now();
      if (now - lastResumeAt > RESUME_EVERY_MS) {
        lastResumeAt = now;
        saveBattle(ctx.storage, battle, config, now);
      }

      if (battle.status !== 'running') finish(battle);
    },

    render(alpha, frameMs) {
      const battle = getState();
      // Effects age on the frame clock, not the sim clock, so they stay smooth
      // at any battle speed. Without this call every effect froze at frame 0,
      // never faded and never freed its pool slot.
      fx?.update(Math.min(frameMs ?? 16, 100) / 1000);
      if (battle && board) board.draw(battle, alpha, view);
      hud?.update();
    },
  };

  // ---- battle -> meta ---------------------------------------------------
  function finish(battle) {
    finished = true;
    // The fight is decided; a resume blob now would replay a finished battle.
    clearBattle(ctx.storage);
    const outcome = toOutcome(battle, config);
    assertBattleOutcome(outcome, config);
    ctx.state.session.lastOutcome = outcome;
    ctx.scenes.replace(ctx.screens.results, { outcome, config });
  }
}
