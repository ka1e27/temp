// The pre-battle loadout — the decision point the campaign was missing.
//
// THE EXPEDITION IS A SLOT BUDGET, NOT A HEAD COUNT. A marshal costs eight
// slots and a militia one (content/balance.js UNIT_SLOTS), so "as many of the
// best troops as possible" is no longer a free pick — it is eight militia you
// did not bring. The screen shows slots spent against slots granted, every
// control lands exactly on the budget, and Launch refuses an over-budget army
// even though the controls cannot produce one.
//
// It also CARRIES: the composition the player launched with last time is
// persisted in `meta.loadout` and pre-filled here. A budget that grew since
// then arrives as militia — the picks are not rescaled and nothing the player
// chose is silently dropped. A newly unlocked unit becomes available, never
// force-fed; it enters the army when the player presses '+'.
//
// The model and the two strips live in prebattle-brief.js / prebattle-army.js;
// this file is the scene, the frame around them, and the transitions.

import { h, mount } from '../ui/dom.js';
import { UI, WORLD } from '../content/strings.js';
import { nudgeComposition } from '../meta/composition.js';
import { unlockedUnits } from '../meta/upgrades.js';
import { inventory, defaultSelection } from '../meta/boosters.js';
import { markDirty } from '../core/store.js';
import {
  regionBrief, initialComposition, defaultComposition, loadoutBudget, overBudget,
} from './prebattle-brief.js';
import { renderArmy, renderBoosters } from './prebattle-army.js';

// One front door. The screen's decisions live in prebattle-brief.js and the
// slot arithmetic in meta/composition.js; the shop and the tests import them
// from here and should not have to know which file each one ended up in.
export {
  UNIT_LABEL, BOOSTER_LABEL, BOOSTER_NOTE, regionBrief, initialComposition,
  defaultComposition, loadoutBudget, budgetSummary, compositionSlots,
  compositionTotal, overBudget,
} from './prebattle-brief.js';
export { nudgeComposition, canNudge } from '../meta/composition.js';

export function createPreBattleScene(ctx) {
  let root = null;
  let armyBody = null;
  let boosterBody = null;
  let announce = null;
  let regionId = null;
  let chosen = null;
  let carried = null;
  let pending = null;
  let focusKey = null;
  let ownable = new Set();

  const meta = () => ctx.state.meta;
  const units = () => unlockedUnits(meta());
  const budget = () => loadoutBudget(meta());

  return {
    id: 'prebattle',

    enter(params) {
      regionId = params?.regionId;
      const brief = regionBrief(meta(), regionId);
      // A scene may not replace itself from enter(); the stack has not finished
      // pushing it yet. update() runs one frame later, which is safe.
      if (!brief) { pending = toMap; return []; }

      // Explicit params win (results.js re-opens on the army that just fought),
      // then the persisted loadout, then the default spread.
      chosen = initialComposition(meta(), params?.composition ?? meta().loadout);
      ownable = new Set(defaultSelection(meta()));
      carried = new Set(params?.boosters ?? ownable);

      document.body.dataset.scene = 'prebattle';
      announce = h('p.sr-only', { 'aria-live': 'polite' });
      armyBody = h('div.pb-army-body');
      boosterBody = h('div.pb-booster-body');

      root = h('div.screen.prebattle', {},
        h('div.pb-wrap', {},
          header(brief),
          h('div.pb-body', {},
            briefPanel(brief),
            h('section.pb-army.panel', { 'aria-labelledby': 'pb-army-h' },
              h('h2#pb-army-h', { text: UI.expedition }),
              h('p.pb-note', {
                text: `${WORLD.expeditionHint} Every unit spends slots from the `
                  + 'same budget, and your picks carry into the next battle.',
              }),
              armyBody),
            h('section.pb-boosters.panel', { 'aria-labelledby': 'pb-boost-h' },
              h('h2#pb-boost-h', { text: UI.boosters }),
              h('p.pb-note', { text: 'Carried into battle. Only what you fire is spent.' }),
              boosterBody)),
          footer(brief),
          announce));

      mount(ctx.root, root);
      paint();
      root.querySelector('.pb-go')?.focus();

      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); toMap(); return; }
        // Enter launches, but only when no control has focus — otherwise it
        // would fire the focused button AND launch.
        const onControl = e.target instanceof HTMLElement
          && e.target.closest('button, textarea, input, select');
        if (e.key === 'Enter' && !onControl) { e.preventDefault(); launch(); }
      };
      document.addEventListener('keydown', onKey);

      // Buying charges or a unit from the shop overlay changes what this screen
      // is offering, so it rebuilds rather than going stale behind the dialog.
      const offs = ['meta:booster-purchased', 'meta:upgrade-purchased']
        .map((ev) => ctx.bus.on(ev, () => rebuild(false)));

      return [
        () => document.removeEventListener('keydown', onKey),
        ...offs,
        () => root?.remove(),
      ];
    },

    exit() {
      root = armyBody = boosterBody = announce = null;
      chosen = carried = regionId = pending = null;
      delete document.body.dataset.scene;
    },

    update() {
      if (!pending) return;
      const go = pending;
      pending = null;
      go();
    },
  };

  // --- structure -----------------------------------------------------------

  function header(brief) {
    return h('header.pb-header.panel', {},
      h('div.pb-title', {},
        h('h1#pb-title', { text: `${brief.raid ? UI.raid : UI.attack} ${brief.name}` }),
        h('p.pb-flavour', { text: brief.flavour ?? '' })),
      h('div.pb-header-actions', {},
        h('button.btn.ghost.pb-shop', {
          type: 'button', text: UI.shop,
          'aria-label': 'Open the upgrade shop',
          on: { click: () => ctx.scenes.push(ctx.screens.shop) },
        }),
        h('button.btn.ghost.pb-back', {
          type: 'button', text: UI.back,
          'aria-label': 'Back to the world map',
          on: { click: toMap },
        })));
  }

  function briefPanel(brief) {
    return h('section.pb-brief.panel', { 'aria-labelledby': 'pb-brief-h' },
      h('h2#pb-brief-h', { text: `Tier ${brief.tier} briefing` }),
      h('dl.pb-stats', {}, ...brief.rows.flatMap(([k, v]) => [
        h('dt.label', { text: k }), h('dd.num', { text: v }),
      ])));
  }

  function footer(brief) {
    return h('footer.pb-actions.panel', {},
      h('button.btn.primary.pb-go', {
        type: 'button',
        text: brief.raid ? `Launch raid on ${brief.name}` : `Invade ${brief.name}`,
        on: { click: launch },
      }),
      h('button.btn.pb-reset', {
        type: 'button', text: 'Reset to default', on: { click: () => rebuild(true) },
      }),
      h('div.keys', {}, h('span', {}, h('kbd', { text: 'Enter' }), ' launch'),
        h('span', {}, h('kbd', { text: 'Esc' }), ' back')));
  }

  // --- painting ------------------------------------------------------------

  // Declarations, not consts: everything here sits after the factory's `return`,
  // so only hoisted function declarations are ever initialised.
  function paint() {
    announce.textContent = renderArmy(armyBody, {
      chosen, unlocked: units(), budget: budget(), focusKey, onStep: step,
    });
    focusKey = null;
    renderBoosters(boosterBody, {
      items: inventory(meta()),
      carried,
      // A charge bought from the shop overlay mid-loadout is one you meant to
      // bring; one you switched off yourself stays off.
      isUsable: (b) => {
        const usable = b.unlocked && b.count > 0;
        if (usable && !ownable.has(b.id)) { ownable.add(b.id); carried.add(b.id); }
        return usable;
      },
      onToggle: (id, on) => { if (on) carried.add(id); else carried.delete(id); },
    });
    gate();
  }

  /** An over-budget army can never be launched. The controls cannot build one,
   *  so this is defence in depth — and the thing a stale save gets caught by. */
  function gate() {
    const go = root?.querySelector('.pb-go');
    if (!go) return;
    const bad = overBudget(chosen, budget());
    go.disabled = bad;
    if (bad) go.setAttribute('aria-disabled', 'true'); else go.removeAttribute('aria-disabled');
  }

  function step(unitId, delta) {
    const next = nudgeComposition(chosen, unitId, delta, units(), budget());
    chosen = next;
    focusKey = `${unitId}:${delta}`;
    paint();
  }

  // --- transitions ---------------------------------------------------------

  /**
   * Rebuild both strips. An unlock bought from the shop overlay can change the
   * budget AND the roster, so the picks are carried into the new budget (extra
   * slots become militia); `reset` throws the player's edits away instead.
   */
  function rebuild(reset) {
    if (!root) return;
    chosen = reset ? defaultComposition(meta()) : initialComposition(meta(), chosen);
    if (reset) { ownable = new Set(defaultSelection(meta())); carried = new Set(ownable); }
    paint();
  }

  function toMap() {
    ctx.scenes.replace(ctx.screens.worldmap);
  }

  function launch() {
    if (overBudget(chosen, budget())) { gate(); return; }
    // Persisted in meta, not in battle state: it is a standing preference, not a
    // fact about one fight. PERSISTED_KEYS already covers `meta`, so this needs
    // no save migration.
    meta().loadout = { ...chosen };
    markDirty(ctx.state);
    ctx.scenes.replace(ctx.screens.battle, {
      regionId,
      boosters: [...carried],
      composition: { ...chosen },
    });
  }
}
