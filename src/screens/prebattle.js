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

import { h, mount, moreBelow } from '../ui/dom.js';
import { UI, WORLD } from '../content/strings.js';
import { nudgeComposition } from '../meta/composition.js';
import { unlockedUnits } from '../meta/upgrades.js';
import { inventory, defaultSelection } from '../meta/boosters.js';
import { markDirty } from '../core/store.js';
import {
  UNIT_LABEL, regionBrief, initialComposition, defaultComposition, loadoutBudget, overBudget,
} from './prebattle-brief.js';
import { renderArmy, renderBoosters } from './prebattle-army.js';
import { parseCount, setUnitCount, countNote } from './prebattle-count.js';

// One front door. The screen's decisions live in prebattle-brief.js and the
// slot arithmetic in meta/composition.js; the shop and the tests import them
// from here and should not have to know which file each one ended up in.
export {
  UNIT_LABEL, BOOSTER_LABEL, BOOSTER_NOTE, regionBrief, initialComposition,
  defaultComposition, loadoutBudget, budgetSummary, compositionSlots,
  compositionTotal, overBudget,
} from './prebattle-brief.js';
export { parseCount, setUnitCount, maxCount, countNote } from './prebattle-count.js';
export { nudgeComposition, canNudge } from '../meta/composition.js';

export function createPreBattleScene(ctx) {
  let root = null;
  let armyBody = null;
  let boosterBody = null;
  let announce = null;
  let regionId = null;
  let depth = null;
  let chosen = null;
  let carried = null;
  let pending = null;
  let focusKey = null;
  let notice = '';
  let painting = false;
  let ownable = new Set();

  const meta = () => ctx.state.meta;
  const units = () => unlockedUnits(meta());
  const budget = () => loadoutBudget(meta());

  return {
    id: 'prebattle',

    enter(params) {
      regionId = params?.regionId;
      // The rung, when this loadout is for one. Carried as a param the whole way
      // to buildBattleConfig rather than re-read from meta at each stop: the
      // depth the player pressed the button for is the depth they fight.
      depth = params?.incursion ?? null;
      const brief = regionBrief(meta(), regionId, depth);
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

      // The fade has to follow the scroll and the viewport, not just the paint:
      // the panel fits at 1440x900 and clips at 1440x800, so a window a player
      // resizes crosses the boundary without anything being re-rendered.
      const body = root.querySelector('.pb-body');
      body?.addEventListener('scroll', markScroll, { passive: true });
      window.addEventListener('resize', markScroll);

      return [
        () => document.removeEventListener('keydown', onKey),
        () => body?.removeEventListener('scroll', markScroll),
        () => window.removeEventListener('resize', markScroll),
        ...offs,
        () => root?.remove(),
      ];
    },

    exit() {
      root = armyBody = boosterBody = announce = null;
      chosen = carried = regionId = depth = pending = null;
      notice = '';
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
        h('h1#pb-title', { text: brief.incursion ? `${brief.incursion.label}: ${brief.name}`
          : `${brief.raid ? UI.raid : UI.attack} ${brief.name}` }),
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
      h('h2#pb-brief-h', {
        text: brief.incursion ? brief.incursion.label : `Tier ${brief.tier} briefing`,
      }),
      h('dl.pb-stats', {}, ...brief.rows.flatMap(([k, v]) => [
        h('dt.label', { text: k }), h('dd.num', { text: v }),
      ])),
      // The complications are the reason this screen matters on a rung: `thinned`
      // lands a smaller army and `ironwall` makes engines the difference between
      // a siege and a stalemate, so they are shown WHERE the army is chosen and
      // not only on the briefing overlay the player has already closed.
      ...(brief.incursion?.mutators?.length
        ? [h('ul.pb-mutators', {}, ...brief.incursion.mutators.map((m) => h('li.pb-mutator', {
          'data-mutator': m.id,
        }, h('strong', { text: m.name }), h('span', { text: ` ${m.note}` }))))]
        : []),
      // THE HAND THIS REGION CARRIES — its own (meta/incursion.js
      // `campaignTwistPlan`, which is what an ordinary player meets from region
      // 10 on) or a replayed run's (`campaignReplayPlan`). ONE block for both,
      // because they are the same statement to the player and a third copy of
      // this markup is how a surface drifts out of step with its own rule.
      // Mutually exclusive with the incursion list above, and shown for the same
      // reason: know before you pick a loadout, not mid-battle.
      ...(brief.regionMutators?.length
        ? [h('ul.pb-mutators.pb-replay-mutators', {},
          ...brief.regionMutators.map((m) => h('li.pb-mutator', {
            'data-mutator': m.id,
          }, h('strong', { text: m.name }), h('span', { text: ` ${m.note}` }))))]
        : []),
      // The specialists are opt-in and easy to forget; meta/specialists.js
      // reads this same region's own data and says when one answers the fight
      // better than the default spread. `data-unlocked` is what tells "bring
      // it" from "consider buying it" apart without repeating the unit's name.
      ...(brief.callouts?.length
        ? [h('ul.pb-tips', {}, ...brief.callouts.map((c) => h('li.pb-tip', {
          'data-unit': c.unit, 'data-unlocked': c.unlocked ? '1' : '0',
        }, h('strong', { text: UNIT_LABEL[c.unit] }), h('span', { text: ` ${c.note}` }))))]
        : []));
  }

  function footer(brief) {
    return h('footer.pb-actions.panel', {},
      h('button.btn.primary.pb-go', {
        type: 'button',
        text: brief.incursion ? `Launch ${brief.incursion.label.toLowerCase()}`
          : brief.raid ? `Launch raid on ${brief.name}` : `Invade ${brief.name}`,
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
    // `painting` closes a re-entrancy trap that only exists because the counts
    // are now typed into: rebuilding the strip destroys the focused field,
    // which fires `blur`, which commits AGAIN — into a list that is halfway
    // through being cleared. It threw a DOM exception every single edit and
    // corrupted the army on the way past. See setCount().
    painting = true;
    announce.textContent = renderArmy(armyBody, {
      chosen, unlocked: units(), budget: budget(), focusKey, notice,
      onStep: step, onSet: setCount,
    });
    painting = false;
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
    markScroll();
  }

  /**
   * IS THERE MORE ARMY BELOW THE FOLD? `.pb-body` has always scrolled and the
   * platform draws an overlay scrollbar — measured at 0px wide — so at a
   * nine-unit roster on a 1440x800 laptop 210 pixels of the player's own
   * expedition sat below the edge with nothing whatsoever indicating it.
   *
   * Toggled rather than always on, because a fade at the bottom of a panel that
   * fits says there is more when there is not, which is the same class of lie.
   */
  function markScroll() {
    const body = root?.querySelector('.pb-body');
    if (!body) return;
    body.classList.toggle('has-more', moreBelow(body));
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

  function step(unitId, delta, focus) {
    const next = nudgeComposition(chosen, unitId, delta, units(), budget());
    chosen = next;
    focusKey = focus ?? `${unitId}:${delta}`;
    notice = '';
    paint();
  }

  /**
   * A TYPED count. Clamped by prebattle-count.js before it reaches the model,
   * so an impossible number is answered here and now — the Launch gate never
   * has to be the first time the player hears about it.
   *
   * A field that does not parse (empty, half-deleted, pasted rubbish) simply
   * repaints from the model, which puts the real number back.
   */
  function setCount(unitId, raw, focus) {
    // The echo of our own repaint blurring the field it just replaced. The
    // value it carries is the one we committed a microsecond ago, so the only
    // correct thing to do with it is nothing.
    if (painting) return;
    focusKey = focus === undefined ? `count:${unitId}` : focus;
    const n = parseCount(raw);
    if (n === null) { notice = ''; paint(); return; }
    const r = setUnitCount(chosen, unitId, n, units(), budget());
    chosen = r.comp;
    notice = countNote(r, UNIT_LABEL[unitId]);
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
    notice = '';
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
      ...(depth ? { incursion: depth } : {}),
    });
  }
}
