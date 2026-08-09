// The front door: Continue, a New Campaign that says what it will cost you,
// and export/import so a save survives a cleared browser.
//
// A BRAND-NEW SAVE NEVER SEES THIS SCREEN. There is nothing to continue and
// nothing to export, so the menu would be a form standing between a first-time
// player and the game. `bootRoute()` sends that player straight into region 1
// instead; the menu is for someone with an empire to come back to.
//
// The scene works BOTH as the boot scene (main.js replaces into it) and as an
// overlay pushed from the world map's Menu button. `enter()` runs BEFORE the
// stack pushes this scene, so `ctx.scenes.depth` at that moment is exactly what
// is underneath — which is all it takes to tell the two apart.
//
// WIPE AND IMPORT MUTATE THE LIVE ROOT IN PLACE. main.js closed over the state
// object at boot, so swapping `ctx.state` for a new object would leave idle
// income and autosave pointed at the old one forever.

import { h, clear, mount, bindText } from '../ui/dom.js';
import { compact, rate } from '../ui/format.js';
import { UI, SAVE } from '../content/strings.js';
import { renderSettings } from './mainmenu-settings.js';
import { createMeta, markDirty, metaOf } from '../core/store.js';
import { exportSave, importSave } from '../meta/save.js';
import { incomePerSec, recalcIncome } from '../meta/idle.js';
import { REGION_IDS, regionsConquered, refreshUnlocks, isAttackable } from '../meta/world.js';
import { defaultSelection } from '../meta/boosters.js';

/** A campaign nobody has touched: nothing fought, held, bought or banked. */
export function isFreshCampaign(x) {
  const meta = metaOf(x);
  if (!meta?.regions) return true;
  if ((meta.stats?.battles ?? 0) > 0) return false;
  if (regionsConquered(meta) > 0) return false;
  if (Object.keys(meta.upgrades ?? {}).length > 0) return false;
  if (Object.values(meta.boosters ?? {}).some((n) => n > 0)) return false;
  return !((meta.crowns ?? 0) > 0);
}

/** 'new-game' skips the menu entirely; 'menu' has something to continue. */
export const bootRoute = (x) => (isFreshCampaign(x) ? 'new-game' : 'menu');

/** The first region you are allowed to attack — Riverfen on a clean save. */
export function firstRegionId(x) {
  const meta = metaOf(x);
  return REGION_IDS.find((id) => isAttackable(meta, id)) ?? REGION_IDS[0];
}

/** Straight into region 1: no menu, no world map, no loadout. */
export function launchFirstRegion(ctx) {
  const meta = ctx.state.meta;
  ctx.scenes.replace(ctx.screens.battle, {
    regionId: firstRegionId(meta),
    boosters: defaultSelection(meta),
  });
}

/**
 * Graft a loaded/blank meta onto the LIVE root. Everything main.js holds a
 * reference to (`state`, `state.session`) survives; only the persisted slice
 * is replaced, then the derived fields are healed.
 */
export function adoptCampaign(ctx, next, now) {
  const state = ctx.state;
  // PREFERENCES OUTLIVE THE CAMPAIGN. `meta` is replaced wholesale here — by a
  // new campaign or by an imported save — and settings ride inside it, so
  // without this a player who wanted their rally hold-back at zero would have
  // to say so again after every reset, and importing a friend's save would
  // silently adopt their pace and their hold-back too. They are the player's,
  // not the save's.
  const keptSettings = state.meta?.settings;
  state.saveVersion = next.saveVersion ?? state.saveVersion;
  state.seed = next.seed ?? state.seed;
  state.createdAt = next.createdAt ?? now;
  state.lastSeenAt = now;
  state.meta = next.meta;
  if (keptSettings) state.meta.settings = keptSettings;
  state.battle = null;
  refreshUnlocks(state.meta, ctx.bus);
  recalcIncome(state.meta, ctx.bus);
  markDirty(state);
  // Optional hooks: present only once main.js hands them to ctx.
  ctx.autosaver?.flush?.(state, now);
  return state;
}

export function createMainMenuScene(ctx) {
  let root = null;
  let actions = null;
  let drawer = null;
  let status = null;
  let stats = null;
  let timer = null;
  let pending = null;
  let overlay = false;
  let bootParams = null;
  let prevScene;

  const meta = () => ctx.state.meta;
  const close = () => (overlay
    ? ctx.scenes.pop()
    : ctx.scenes.replace(ctx.screens.worldmap, bootParams ?? undefined));

  return {
    id: 'mainmenu',
    keepVisible: true, // the world map keeps drawing behind the dim

    enter(params) {
      bootParams = params ?? null;
      overlay = ctx.scenes.depth > 0;
      ctx.state.session.booted = true;

      // Nothing to continue: do not make a new player read a menu.
      if (!overlay && isFreshCampaign(meta())) {
        pending = () => launchFirstRegion(ctx);
        return [];
      }

      prevScene = document.body.dataset.scene;
      document.body.dataset.scene = 'mainmenu';

      status = h('p.menu-status', { role: 'status', 'aria-live': 'polite' });
      stats = buildStats();
      actions = h('div.menu-actions');
      drawer = h('div.menu-io');

      root = h('div.screen.mainmenu', {},
        h('div.overlay', {},
          h('div.dialog.panel.menu-dialog', {
            role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'menu-title',
          },
          h('h1#menu-title', { text: UI.gameTitle }),
          h('p', { text: UI.tagline }),
          stats.el,
          actions,
          drawer,
          status,
          h('div.keys', {},
            h('span', {}, h('kbd', { text: 'Esc' }), ' close'),
            h('span', {}, h('kbd', { text: 'Enter' }), ' continue')))));

      mount(ctx.root, root);
      renderActions();
      stats.update();
      if (params?.blocked) say(`${SAVE.refusedTitle}. ${SAVE.reasons[params.reason] ?? ''}`);

      const onKey = (e) => {
        if (e.key === 'Escape' && overlay) { e.preventDefault(); close(); }
      };
      document.addEventListener('keydown', onKey);
      timer = setInterval(() => stats.update(), 1000);

      return [
        () => clearInterval(timer),
        () => document.removeEventListener('keydown', onKey),
        () => root?.remove(),
      ];
    },

    exit() {
      pending = null;
      root = actions = drawer = status = stats = null;
      if (prevScene === undefined) delete document.body.dataset.scene;
      else document.body.dataset.scene = prevScene;
      prevScene = undefined;
    },

    // A scene may not replace itself from enter() — the stack has not finished
    // pushing it yet. One frame later is safe and still invisible to a player.
    update() {
      if (!pending) return;
      const go = pending;
      pending = null;
      go();
    },
  };

  // --- empire readout ------------------------------------------------------

  /** Regions, treasury and income, live. A returning player should see their
   *  empire before they have to click anything. */
  function buildStats() {
    const rows = [
      ['Regions held', () => `${regionsConquered(meta())} / ${REGION_IDS.length}`],
      [UI.treasury, () => compact(meta().crowns)],
      [UI.income, () => rate(incomePerSec(meta()))],
    ];
    const el = h('dl.menu-empire', { 'aria-live': 'polite' });
    const binds = rows.map(([label, read]) => {
      const dd = h('dd.num');
      mount(el, h('dt.label', { text: label }), dd);
      return [bindText(dd), read];
    });
    return { el, update: () => { for (const [set, read] of binds) set(read()); } };
  }

  function say(text) {
    if (status) status.textContent = text;
  }

  // --- actions -------------------------------------------------------------

  function renderActions() {
    clear(actions);
    clear(drawer);
    const resumable = overlay || !isFreshCampaign(meta());

    if (resumable) {
      mount(actions, h('button.btn.primary.menu-continue', {
        type: 'button', text: UI.continue, on: { click: close },
      }));
    }
    mount(actions,
      h('button.btn.menu-new', {
        type: 'button', text: 'New Campaign', on: { click: confirmNew },
      }),
      h('button.btn.ghost.menu-export', {
        type: 'button', text: 'Export save', on: { click: showExport },
      }),
      h('button.btn.ghost.menu-import', {
        type: 'button', text: 'Import save', on: { click: showImport },
      }),
      h('button.btn.ghost.menu-settings-btn', {
        type: 'button', text: 'Settings', on: { click: showSettings },
      }));
    actions.firstChild?.focus?.();
  }

  /** Wiping is destructive and irreversible from in here, so it always costs
   *  a second click and always names what is about to go. */
  function confirmNew() {
    clear(drawer);
    const held = regionsConquered(meta());
    mount(drawer, h('div.menu-confirm.panel', {
      role: 'group', 'aria-label': 'Confirm new campaign',
    },
    h('p', {
      text: `This erases ${held} conquered region${held === 1 ? '' : 's'} and `
        + `${compact(meta().crowns)} crowns. Export first if you want it back.`,
    }),
    h('div.row', {},
      h('button.btn.primary.menu-wipe', {
        type: 'button', text: 'Erase and start over', on: { click: newCampaign },
      }),
      h('button.btn.ghost', {
        type: 'button', text: 'Cancel', on: { click: () => { clear(drawer); renderActions(); } },
      }))));
    drawer.querySelector('.menu-wipe')?.focus();
  }

  function newCampaign() {
    const now = Date.now();
    // A new campaign is a new world, not a replay of the same maps.
    adoptCampaign(ctx, {
      saveVersion: ctx.state.saveVersion,
      seed: (Math.random() * 0xffffffff) >>> 0,
      createdAt: now,
      meta: createMeta(),
    }, now);
    // As an overlay there is a world map UNDERNEATH: replacing from here would
    // swap the menu for the battle and leave the old map's DOM on top of it,
    // covering the board completely. Drop the overlay first, then replace what
    // it was covering.
    if (overlay) ctx.scenes.pop();
    launchFirstRegion(ctx);
  }

  // --- export / import -----------------------------------------------------

  function textbox(props) {
    return h('textarea.menu-text', {
      spellcheck: 'false', autocomplete: 'off', rows: '4',
      // The board is user-select:none; a save you cannot select is not an export.
      style: { userSelect: 'text', WebkitUserSelect: 'text', width: '100%' },
      ...props,
    });
  }

  function showSettings() {
    renderSettings(drawer, ctx)?.focus?.();
  }

  function showExport() {
    clear(drawer);
    const text = exportSave(ctx.state, { now: Date.now() });
    const box = textbox({ readonly: true, 'aria-label': 'Your save, as text' });
    box.value = text;
    mount(drawer, h('div.menu-drawer', {},
      h('label.label', { for: 'menu-export-box', text: 'Copy this somewhere safe' }),
      box,
      h('div.row', {},
        h('button.btn.menu-copy', {
          type: 'button',
          text: 'Copy to clipboard',
          on: {
            click: () => {
              box.select();
              navigator.clipboard?.writeText(text).catch(() => {});
              say(SAVE.exported);
            },
          },
        }),
        h('button.btn.ghost', {
          type: 'button', text: UI.close, on: { click: () => { clear(drawer); renderActions(); } },
        }))));
    box.id = 'menu-export-box';
    box.focus();
    box.select();
  }

  function showImport() {
    clear(drawer);
    const box = textbox({ 'aria-label': 'Paste a save', placeholder: 'Paste your save text here' });
    mount(drawer, h('div.menu-drawer', {},
      h('label.label', { for: 'menu-import-box', text: 'Paste a save' }),
      box,
      h('div.row', {},
        h('button.btn.primary.menu-do-import', {
          type: 'button', text: 'Import', on: { click: () => runImport(box.value) },
        }),
        h('button.btn.ghost', {
          type: 'button', text: UI.close, on: { click: () => { clear(drawer); renderActions(); } },
        }))));
    box.id = 'menu-import-box';
    box.focus();
  }

  /** importSave() applies the same refusal rules as a disk load: a file we
   *  cannot read changes NOTHING, and says why. */
  function runImport(raw) {
    const text = String(raw ?? '').trim();
    if (!text) { say('Paste a save first.'); return; }
    const now = Date.now();
    const res = importSave(text, { now });
    if (!res.ok) {
      say(`${SAVE.refusedTitle}: ${SAVE.reasons[res.reason] ?? res.reason}. ${SAVE.refusedBody}`);
      return;
    }
    adoptCampaign(ctx, res.state, now);
    clear(drawer);
    renderActions();
    stats.update();
    say(SAVE.imported);
  }
}
