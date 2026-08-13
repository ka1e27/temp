// THE INCURSION BRIEFING — an overlay over the world map, in the same shape as
// the shop: the map stays drawn behind it, so you choose a rung while looking at
// the empire that pays for it.
//
// It is an OVERLAY rather than a region on the map, and that is the honest
// geometry: a rung is fought on ground you already own, so it has no hex of its
// own to click. `.wm-body` is a two-column grid, and a third panel wedged into it
// would have to fight both phone layouts for room it does not need.
//
// Everything shown here comes from meta/incursion.js `incursionView` and
// meta/rewards.js `previewReward` — the screen computes nothing. A rung is a pure
// function of its depth, so what this panel promises and what the battle actually
// builds cannot drift.
import { h, clear, mount, bindText } from '../ui/dom.js';
import { compact, rate } from '../ui/format.js';
import { UI, ENDGAME } from '../content/strings.js';
import { incursionView } from '../meta/incursion.js';
import { previewReward } from '../meta/rewards.js';
import { incomePerSec } from '../meta/idle.js';

export function createIncursionScene(ctx) {
  let root = null;
  let body = null;
  let setCrowns = null;

  const meta = () => ctx.state.meta;

  return {
    id: 'incursion',
    keepVisible: true, // the world map keeps rendering underneath

    enter() {
      // MARK THE SCENE, as every other screen does. These two were the only
      // screens that never did, and it was not cosmetic: tools/mobile.mjs gates
      // its phone audit on `scene() === 'shop'`, so that step could never run
      // and silently no-opped instead of failing. The shop was consequently
      // never audited at any width — which is exactly how it shipped unreadable
      // below 520px while the tool reported "no layout problems found".
      //
      // `keepVisible` means the world map stays mounted underneath, so `exit()`
      // restores the marker rather than deleting it.
      document.body.dataset.scene = 'incursion';
      root = h('div.screen.shop-overlay.incursion-overlay');
      const crowns = h('span.num.crowns');
      setCrowns = bindText(crowns);

      const close = h('button.btn.ghost.shop-close', {
        text: UI.close, type: 'button',
        'aria-label': 'Close the incursion briefing',
        on: { click: () => ctx.scenes.pop() },
      });

      body = h('div.shop-list.inc-body');
      mount(root, h('div.shop-panel.panel', {
        role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'inc-title',
      },
      h('div.shop-header.panel', {},
        h('h2#inc-title', { text: ENDGAME.incursionTitle }),
        h('div.shop-treasury', { 'aria-live': 'polite' },
          h('span.label', { text: UI.treasury }), crowns),
        close),
      body));
      mount(ctx.root, root);

      render();
      root.querySelector('.inc-go')?.focus() ?? close.focus();

      const onKey = (e) => { if (e.key === 'Escape') ctx.scenes.pop(); };
      document.addEventListener('keydown', onKey);
      // The treasury ticks while this is open, exactly as it does in the shop, so
      // the reward line is re-read rather than frozen at the moment of opening.
      const timer = setInterval(() => setCrowns(compact(meta().crowns)), 250);

      return [
        () => clearInterval(timer),
        () => document.removeEventListener('keydown', onKey),
        () => root?.remove(),
      ];
    },

    exit() {
      // Back to the map that is still mounted underneath, not deleted — these
      // are overlays, and a screen that clears the marker outright would make
      // the world map look like no scene at all to anything reading it.
      document.body.dataset.scene = 'worldmap';
      root = body = setCrowns = null;
    },
  };

  function render() {
    clear(body);
    setCrowns(compact(meta().crowns));
    const view = incursionView(meta());

    if (!view.open) {
      // Reachable by a stale overlay only — the world map does not offer the
      // button until the ladder is open — so it says why rather than crashing.
      mount(body, h('p.inc-locked', { text: ENDGAME.incursionLocked }));
      return;
    }

    const reward = previewReward(meta(), view.regionId, view.depth);
    // No "Complications: 2" row — the section below lists them by name, and a
    // count above a list is a number the reader has to reconcile with something
    // they can already see.
    const rows = [
      ['Ground', view.regionName],
      ['Enemy strength', `x${view.enemyMult.toFixed(2)}`],
      ['Clears this rung', `${compact(reward.crowns)} crowns, once`],
      ['Your income', rate(incomePerSec(meta()))],
    ];

    mount(body,
      h('div.inc-head', {},
        h('h3.inc-depth', { text: ENDGAME.incursionDepth(view.depth) }),
        h('span.inc-cleared.dim', { text: ENDGAME.incursionCleared(view.cleared) })),
      h('p.inc-hint', { text: ENDGAME.incursionHint }),
      h('dl.wm-stats.inc-stats', {}, ...rows.flatMap(([k, v]) => [
        h('dt.label', { text: k }), h('dd.num', { text: v }),
      ])),
      mutatorList(view),
      h('button.btn.primary.inc-go', {
        type: 'button', text: ENDGAME.incursionGo,
        'aria-label': `Plan incursion depth ${view.depth} on ${view.regionName}`,
        on: { click: () => launch(view) },
      }));
  }

  function mutatorList(view) {
    const section = h('section.inc-mutators', { 'aria-labelledby': 'inc-mut-h' },
      h('h4#inc-mut-h.label', { text: ENDGAME.mutatorsTitle }));
    if (!view.mutators.length) {
      mount(section, h('p.inc-hint.dim', { text: ENDGAME.mutatorsNone }));
      return section;
    }
    for (const m of view.mutators) {
      mount(section, h('div.inc-mutator', { 'data-mutator': m.id },
        h('span.inc-mutator-name', { text: m.name }),
        h('span.inc-mutator-note', { text: m.note })));
    }
    return section;
  }

  /**
   * Straight to the loadout, carrying the depth. It POPS first and then replaces
   * the world map underneath, because this scene is an overlay: replacing from
   * here would leave the map stranded below the loadout for the rest of the
   * session, which is the one way a scene stack can leak a screen.
   *
   * The depth travels as a param rather than being re-read from meta at the far
   * end. It is the same reason meta/rewards.js reads it off the config: a rung
   * cleared in another tab, or a `cleared` that moved while this panel sat open,
   * must not silently change which battle the player pressed the button for.
   */
  function launch(view) {
    ctx.scenes.pop();
    ctx.scenes.replace(ctx.screens.prebattle, {
      regionId: view.regionId,
      incursion: view.depth,
    });
  }
}
