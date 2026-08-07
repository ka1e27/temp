// The pre-battle loadout — the decision point the campaign was missing.
//
// The engine was already built for this and never called: buildBattleConfig takes
// `options.composition`, expeditionSize() gives the budget, fitComposition() re-fits
// a chosen split to it, inventory() lists the boosters. All dead code, because the
// world map jumped straight into the battle.
//
// THE SCREEN CAN NEVER MINT TROOPS. It only ever moves one soldier between two
// unit types, so what it hands over always sums to the budget the empire
// granted — and buildBattleConfig re-fits it anyway, so a hand-edited params
// object cannot cheat either. Defaults come pre-filled from
// distributeExpedition() and defaultSelection(): "Launch" is one click away.

import { h, clear, mount } from '../ui/dom.js';
import { compact, rate, duration } from '../ui/format.js';
import { UI, WORLD } from '../content/strings.js';
import { UNIT_IDS, UNITS } from '../content/balance.js';
import { expeditionSize, distributeExpedition, fitComposition } from '../meta/modifiers.js';
import { unlockedUnits } from '../meta/upgrades.js';
import { inventory, defaultSelection } from '../meta/boosters.js';
import { regionById, effectiveEnemyMult, isConquered } from '../meta/world.js';
import { previewReward } from '../meta/rewards.js';

export const UNIT_LABEL = Object.freeze({
  militia: 'Militia', spearmen: 'Spearmen', raiders: 'Raiders',
  rams: 'Rams', marshal: 'Marshal',
});

/** Label + what the booster actually does. Shared with the shop. */
export const BOOSTER_LABEL = Object.freeze({
  rally: 'Rally', march: 'Forced March', bombard: 'Bombardment',
  fortify: 'Emergency Fortify', tithe: 'War Tithe',
});
const BOOSTER_NOTE = Object.freeze({
  rally: 'Every site within 2 hops sends half its garrison, arriving together.',
  march: 'Halves squad travel time for a short window.',
  bombard: 'Kills a quarter of a garrison and 60 structure HP. Never captures.',
  fortify: 'One site: double regen, half incoming damage, for 20s.',
  tithe: 'Instant battle gold plus 15s of faster training.',
});

const clampInt = (n) => Math.max(0, Math.floor(Number(n) || 0));

/** Total troops in a composition. */
export const compositionTotal = (c) => UNIT_IDS.reduce((a, u) => a + clampInt(c?.[u]), 0);

/** The army the screen opens with: the last one used re-fitted to today's
 *  budget, or the default weighting. Never a blank form. */
export function initialComposition(meta, composition) {
  const total = expeditionSize(meta);
  const units = unlockedUnits(meta);
  return composition
    ? fitComposition(total, units, composition)
    : distributeExpedition(total, units);
}

/**
 * Move exactly one troop between `unitId` and the largest other unlocked unit.
 * The total never changes, which is what makes the control safe: the player is
 * spending a fixed budget, not requisitioning a bigger army.
 * A Marshal is granted as exactly one and is not adjustable.
 */
export function nudgeComposition(chosen, unitId, delta, unlocked) {
  const out = {};
  for (const u of UNIT_IDS) out[u] = clampInt(chosen?.[u]);
  if (unitId === 'marshal' || !unlocked.includes(unitId) || !delta) return out;

  const others = UNIT_IDS.filter((u) => u !== unitId && u !== 'marshal' && unlocked.includes(u));
  if (!others.length) return out;
  // Ties resolve to roster order, so the control is deterministic.
  const biggest = others.reduce((a, b) => (out[b] > out[a] ? b : a), others[0]);

  if (delta > 0 && out[biggest] > 0) { out[biggest] -= 1; out[unitId] += 1; }
  else if (delta < 0 && out[unitId] > 0) { out[unitId] -= 1; out[biggest] += 1; }
  return out;
}

/** Would that nudge change anything? Drives the +/- disabled state. */
export function canNudge(chosen, unitId, delta, unlocked) {
  const next = nudgeComposition(chosen, unitId, delta, unlocked);
  return UNIT_IDS.some((u) => next[u] !== clampInt(chosen?.[u]));
}

/**
 * Everything the briefing panel shows, with no DOM and no clock. Difficulty,
 * map size, target length and reward all come off the region record.
 */
export function regionBrief(meta, regionId) {
  const region = regionById(regionId);
  if (!region) return null;
  const raid = isConquered(meta, regionId);
  const reward = previewReward(meta, regionId);
  const mult = effectiveEnemyMult(meta, regionId);
  return {
    id: region.id, name: region.name, tier: region.tier, flavour: region.flavour,
    raid, reward, enemyMult: mult,
    rows: [
      ['Difficulty', `x${mult.toFixed(2)}`],
      ['Battlefield', `${region.grid.cols} x ${region.grid.rows}`],
      ['Enemy sites', `${region.siteCounts.enemy}`],
      ['Typical length', `~${region.targetLengthMin} min`],
      ['Hard cap', duration(region.hardCapMs / 1000)],
      [raid ? 'Raid pays' : 'Conquest pays', raid
        ? `${compact(reward.crowns)} crowns, once`
        : `${compact(reward.crowns)} crowns and ${rate(reward.incomeAdded)} forever`],
    ],
  };
}

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

  const meta = () => ctx.state.meta;
  const units = () => unlockedUnits(meta());

  return {
    id: 'prebattle',

    enter(params) {
      regionId = params?.regionId;
      const brief = regionBrief(meta(), regionId);
      // A scene may not replace itself from enter(); the stack has not finished
      // pushing it yet. update() runs one frame later, which is safe.
      if (!brief) { pending = toMap; return []; }

      chosen = initialComposition(meta(), params?.composition);
      carried = new Set(params?.boosters ?? defaultSelection(meta()));

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
              h('p.pb-note', { text: WORLD.expeditionHint }),
              armyBody),
            h('section.pb-boosters.panel', { 'aria-labelledby': 'pb-boost-h' },
              h('h2#pb-boost-h', { text: UI.boosters }),
              h('p.pb-note', { text: 'Carried into battle. Only what you fire is spent.' }),
              boosterBody)),
          footer(brief),
          announce));

      mount(ctx.root, root);
      renderArmy();
      renderBoosters();
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
        .map((ev) => ctx.bus.on(ev, refit));

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
        type: 'button', text: 'Reset to default', on: { click: resetToDefault },
      }),
      h('div.keys', {}, h('span', {}, h('kbd', { text: 'Enter' }), ' launch'),
        h('span', {}, h('kbd', { text: 'Esc' }), ' back')));
  }

  // --- expedition ----------------------------------------------------------

  function renderArmy() {
    clear(armyBody);
    const unlocked = units();
    const total = compositionTotal(chosen);

    mount(armyBody, h('p.pb-budget', {},
      h('span.num.pb-budget-n', { text: `${total}` }),
      h('span.label', { text: ' troops' })));

    const list = h('ul.pb-units', { role: 'list' });
    for (const id of UNIT_IDS) {
      if (!unlocked.includes(id)) continue;
      mount(list, unitRow(id, unlocked, total));
    }
    mount(armyBody, list);
    announce.textContent = `Expedition: ${describe(chosen, unlocked)}.`;

    // The list is rebuilt on every step, so put focus back where the player
    // left it or the control is unusable from the keyboard after one press.
    if (focusKey) {
      const btn = armyBody.querySelector(`[data-step="${focusKey}"]`);
      (btn && !btn.disabled ? btn : armyBody.querySelector('.pb-step:not([disabled])'))?.focus();
      focusKey = null;
    }
  }

  function unitRow(id, unlocked, total) {
    const count = clampInt(chosen[id]);
    const share = total > 0 ? Math.round((count / total) * 100) : 0;
    const fixed = id === 'marshal';
    const stat = UNITS[id];

    const step = (delta, symbol, word) => {
      const ok = !fixed && canNudge(chosen, id, delta, unlocked);
      return h('button.btn.pb-step', {
        type: 'button', text: symbol, disabled: !ok,
        'aria-disabled': ok ? null : 'true',
        'aria-label': `${word} ${UNIT_LABEL[id]}`,
        'data-step': `${id}:${delta}`,
        on: {
          click: () => {
            if (!ok) return;
            chosen = nudgeComposition(chosen, id, delta, unlocked);
            focusKey = `${id}:${delta}`;
            renderArmy();
          },
        },
      });
    };

    return h('li.pb-unit', { 'data-unit': id },
      h('div.pb-unit-main', {},
        h('span.pb-unit-name', { text: UNIT_LABEL[id] }),
        h('span.pb-unit-stat.dim', { text: `ATK ${stat.atk} · DEF ${stat.def} · SIEGE ${stat.siege}` })),
      h('div.pb-unit-adjust', {},
        fixed ? null : step(-1, '−', 'One fewer'),
        h('span.num.pb-unit-count', {
          text: `${count}`,
          'aria-label': `${count} ${UNIT_LABEL[id]}, ${share}% of the expedition`,
        }),
        fixed
          ? h('span.label', { text: 'always 1' })
          : step(1, '+', 'One more')));
  }

  // Declarations, not consts: everything here sits after the factory's `return`,
  // so only hoisted function declarations are ever initialised.
  function describe(comp, unlocked) {
    return unlocked
      .filter((u) => clampInt(comp[u]) > 0)
      .map((u) => `${clampInt(comp[u])} ${UNIT_LABEL[u]}`)
      .join(', ') || 'empty';
  }

  // --- boosters ------------------------------------------------------------

  function renderBoosters() {
    clear(boosterBody);
    const list = h('ul.pb-booster-list', { role: 'list' });
    let any = false;

    for (const b of inventory(meta())) {
      const usable = b.unlocked && b.count > 0;
      any = any || usable;
      mount(list, boosterRow(b, usable, usable ? null : (b.unlocked ? 'No charges' : UI.locked)));
    }
    mount(boosterBody, list);
    if (!any) {
      mount(boosterBody, h('p.pb-note.dim', {
        text: 'No charges in stock. Buy some in Upgrades — they are only spent when fired.',
      }));
    }
  }

  function boosterRow(b, usable, reason) {
    const on = usable && carried.has(b.id);
    const chip = h('button.chip.pb-booster', {
      type: 'button',
      class: on ? 'is-on' : 'is-off',
      'aria-pressed': on ? 'true' : 'false',
      'aria-disabled': usable ? null : 'true',
      disabled: !usable,
      'aria-label': `${BOOSTER_LABEL[b.id]}${usable ? `, ${b.count} charges` : `, ${reason}`}`,
      on: {
        // Toggled in place rather than re-rendered: the chip keeps focus.
        click: (e) => {
          if (!usable) return;
          const next = !carried.has(b.id);
          if (next) carried.add(b.id); else carried.delete(b.id);
          e.currentTarget.setAttribute('aria-pressed', String(next));
          e.currentTarget.classList.toggle('is-on', next);
          e.currentTarget.classList.toggle('is-off', !next);
        },
      },
    },
    h('span.pb-booster-name', { text: BOOSTER_LABEL[b.id] }),
    h('span.num.pb-booster-count', { text: usable ? `x${b.count}` : (reason ?? '') }));

    return h('li.pb-booster-row', { 'data-booster': b.id },
      chip,
      h('span.pb-booster-note.dim', { text: BOOSTER_NOTE[b.id] ?? '' }));
  }

  // --- transitions ---------------------------------------------------------

  /** Unlocks bought from the shop overlay can change both the budget and the
   *  roster, so re-fit rather than keeping a stale split. */
  function refit() {
    if (!root) return;
    chosen = fitComposition(expeditionSize(meta()), units(), chosen);
    renderArmy();
    renderBoosters();
  }

  function resetToDefault() {
    chosen = distributeExpedition(expeditionSize(meta()), units());
    carried = new Set(defaultSelection(meta()));
    renderArmy();
    renderBoosters();
  }

  function toMap() {
    ctx.scenes.replace(ctx.screens.worldmap);
  }

  function launch() {
    ctx.scenes.replace(ctx.screens.battle, {
      regionId,
      boosters: [...carried],
      composition: { ...chosen },
    });
  }
}
