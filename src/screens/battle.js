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
import { fxVisible } from '../render/fog.js';
import { createBattleInput, createView } from '../screens/battle-input.js';
import { createBattleHud, travelSecondsFor } from '../screens/battle-hud.js';
import { saveBattle, clearBattle } from '../meta/resume.js';
import { qs } from '../ui/dom.js';
import { createSound } from '../ui/sound.js';

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
  let sound = null;
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

  const siteOf = (battle, siteId) => battle?.sites.find((s) => s.id === siteId) ?? null;

  /** Sim events name a site, never a coordinate — the simulation has no idea
   *  where anything is on screen. Effects need one, so resolve it here. */
  const locate = (siteId) => {
    const site = siteOf(getState(), siteId);
    return site && board ? board.sitePos(site, { x: 0, y: 0 }) : null;
  };
  /** ...and a fight on open ground names a hex instead. Same job, one layer
   *  lower — `hexPos` is what `sitePos` already defers to. */
  const locateHex = (hex) => (board ? board.hexPos(hex.q, hex.r, { x: 0, y: 0 }) : null);

  return {
    id: 'battle',

    enter(params) {
      const { regionId, boosters, composition, resume, incursion } = params;
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
        // `incursion` is a DEPTH on the endless ladder, carried from the briefing
        // through the loadout screen. modifiers.js checks the region against the
        // rung's own plan, so a stale param cannot pick an easy map for a deep
        // rung — it throws at the seam instead.
        // THE ROOT STATE, NOT `ctx.state.meta`, AND THE DIFFERENCE WAS THE WORLD
        // SEED. `metaOf` accepts either object — that is its whole job — so
        // passing the slice worked for everything except `metaState.seed`, which
        // lives at the ROOT (`core/store.js createState`) and is not in the slice.
        // It read as undefined and fell through to `?? 1`, so every real battle
        // this game has ever generated came from world seed 1: `newCampaign`'s
        // promise that "a new campaign is a new world, not a replay of the same
        // maps" was false, and every player's Riverfen was the same Riverfen.
        // Verified — two saves seeded 12345 and 999 both produced
        // `riverfen#0#0#e4285f2e`.
        //
        // No balance number moves: `tools/simplayer.js` passes `seed` explicitly
        // in `options`, so the harness always generated from a real seed and the
        // whole table was measured on correctly-varied maps.
        config = buildBattleConfig(
          ctx.state, regionId, boosters, generateBattleMap,
          { ...(composition ? { composition } : {}), ...(incursion ? { incursion } : {}) },
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

      // Feeds off the same event drain the effects layer does — the sim has no
      // idea it exists. Settings are read per cue, not captured, so a change
      // takes effect without rebuilding anything.
      sound = createSound({
        enabled: () => ctx.state?.meta?.settings?.sound !== false,
        volume: () => ctx.state?.meta?.settings?.volume ?? 0.7,
      });
      fx = createFx();
      // The board is always drawn for the PLAYER — there is no spectator or
      // enemy-eye view — but named rather than left implicit, so the renderer
      // itself never has to assume who it is fogging the board for.
      board = createBattleView({
        bg: qs('#board-bg'), fx: qs('#board-fx'), fxLayer: fx, viewFaction: 'player',
      });
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
        // The player's saved pace. A preference, not battle state, so it
        // rides meta rather than the BattleConfig.
        initialSpeed: ctx.state?.meta?.settings?.defaultSpeed ?? 1,
        getSpeed: () => ctx.loop?.speed ?? 1,
      });
      view = presentation;

      coach = mountCoach();

      document.body.dataset.scene = 'battle';
      // Exposed for the browser smoke test, which drives real drag gestures
      // through the same pointer path a player uses.
      // `__view` is the BOARD (geometry + camera); `__ui` is the presentation
      // state the input layer writes — two different things that both got
      // called "view" in conversation, so they are named apart here.
      if (window.__game) {
        window.__game.__view = board;
        window.__game.__fx = fx;
        window.__game.__ui = view;
      }

      return [
        () => input?.dispose(),
        () => hud?.dispose(),
        () => board?.dispose(),
        () => coach?.dispose(),
        () => sound?.dispose(),
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
      const drainedAt = Date.now();
      for (const ev of drainEvents(battle)) {
        // FOG. An effect — and a sound — is a claim that something happened
        // THERE, so both answer to the same rule the board does. Measured on
        // gallowmoor before this gate: 85% of all combat and economy effects
        // fired on ground the player cannot see, 385 of them gold "+N" floats
        // over the enemy's training grounds. See render/fog.js `fxVisible`.
        //
        // An event that names no site AND NO HEX is not a positional claim (a
        // battle ending, a command refused) and passes through untouched —
        // gating those on a place they do not have would silence them all. A
        // fight on open ground names a HEX, which is every bit as positional as
        // a site id, and reading "no site id" as "not positional" let every
        // clash on the map be heard through fog.
        //
        // The bus is deliberately outside the gate: it feeds game logic, not
        // the screen, and starving a coach beat or the results screen of the
        // fact that something happened is a different bug from drawing it.
        const at = ev.siteId != null ? siteOf(battle, ev.siteId) : null;
        const placed = ev.siteId != null || ev.hex != null;
        if (!placed || fxVisible(battle, 'player', ev, at)) {
          // A WALL FIRES EVERY TICK, so tower fire is the one event that must not
          // map one-to-one onto an effect — 347 to 1408 of them in a single
          // battle. `towerFxDue` lets one spark through per COLUMN per cooldown,
          // which is the thing worth noticing ("that lot are being shot at")
          // rather than the individual shot. The sound has its own per-cue gap.
          const muffle = ev.type === 'tower-fired'
            && !fx.towerFxDue(ev.squadId, drainedAt);
          if (!muffle) {
            const placedEv = ev.hex ? { ...ev, ...(locateHex(ev.hex) ?? {}) } : ev;
            fxFromEvent(fx, placedEv, board.palette, board.hexSize, locate);
            sound?.onEvent(ev);
          }
        }
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
      if (battle && board) board.draw(battle, alpha, view, frameMs);
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
