// The front door: Continue, a New Campaign that says what it will cost you,
// and export/import so a save survives a cleared browser.
//
// A BRAND-NEW SAVE NEVER SEES THIS SCREEN. There is nothing to continue and
// nothing to export, so the menu would be a form between a first-time player
// and the game. `bootRoute()` sends them straight into region 1 instead.
//
// The scene works BOTH as the boot scene (main.js replaces into it) and as an
// overlay pushed from the world map's Menu button. `enter()` runs BEFORE the
// stack pushes this scene, so `ctx.scenes.depth` at that moment is exactly what
// is underneath — all it takes to tell the two apart.
//
// WIPE AND IMPORT MUTATE THE LIVE ROOT IN PLACE. main.js closed over the state
// object at boot, so swapping `ctx.state` for a new object would leave idle
// income and autosave pointed at the old one forever.

import { h, clear, mount, bindText } from '../ui/dom.js';
import { compact, rate } from '../ui/format.js';
import { UI, SAVE, ENDGAME } from '../content/strings.js';
import { renderSettings } from './mainmenu-settings.js';
import { renderAbdicate } from './mainmenu-legacy.js';
import { endgameEntry } from './endgate.js';
import { renderRecord } from './mainmenu-record.js';
import { honourCount } from '../meta/milestones.js';
import { renderRefusal } from './mainmenu-recovery.js';
import { renderExport, renderImport } from './mainmenu-io.js';
import { canAbdicate, legacyPoints } from '../meta/legacy.js';
import { createMeta } from '../core/store.js';
import { incomePerSec } from '../meta/idle.js';
import { REGION_IDS, regionsConquered } from '../meta/world.js';
import { isFreshCampaign, launchFirstRegion, adoptCampaign } from './mainmenu-boot.js';

// Re-exported so worldmap.js and four tests keep importing them from here. Safe
// in this direction only: mainmenu-boot.js imports nothing back, so there is no
// cycle and no temporal dead zone.
export {
  isFreshCampaign, bootRoute, firstRegionId, launchFirstRegion, adoptCampaign,
} from './mainmenu-boot.js';
import { installOffer, promptInstall, onInstallChange } from '../ui/install.js';

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
  // Five controls dismiss a drawer; a `clear` that forgets `renderActions`
  // leaves the menu with no buttons at all, so it is written once.
  const backToActions = () => { clear(drawer); renderActions(); };
  const closeBtn = () => h('button.btn.ghost', {
    type: 'button', text: UI.close, on: { click: backToActions },
  });
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
      // A REFUSED SAVE IS NOT A FRESH CAMPAIGN even though it looks exactly like
      // one — see mainmenu-recovery.js for what that cost.
      if (!overlay && isFreshCampaign(meta()) && !params?.blocked) {
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
      if (params?.blocked) {
        renderRefusal({
          drawer, say, reason: params.reason, backup: params.backup,
          onRestore: (backup) => {
            adoptCampaign(ctx, backup.state, Date.now());
            clear(drawer);
            renderActions();
            stats.update();
            say(SAVE.restored);
          },
        });
      }

      // The offer can arrive AFTER the menu is on screen — `beforeinstallprompt`
      // is fired by the browser on its own schedule — so the row is subscribed
      // rather than rendered once. It also has to retire itself the moment the
      // prompt is spent, or the button throws on a second press.
      const offInstall = onInstallChange(() => { if (actions) renderActions(); });

      const onKey = (e) => {
        if (e.key === 'Escape' && overlay) { e.preventDefault(); close(); }
      };
      document.addEventListener('keydown', onKey);
      timer = setInterval(() => stats.update(), 1000);

      return [
        offInstall,
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
    // Legacy joins the readout only once there is some: a row reading "0 legacy"
    // on every save advertises a mechanic most players have not reached and
    // teaches them nothing about it.
    if (legacyPoints(meta()) > 0) {
      rows.push([ENDGAME.legacyTitle, () => `${legacyPoints(meta())}`]);
    }
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

  // A FUNCTION DECLARATION, NOT A CONST, and that is load-bearing: everything
  // below here sits after `return {...}`, so a `const` is never initialized and
  // every call sees it in its own temporal dead zone. Written as an arrow first,
  // and `renderActions` threw on the install row — taking the Abdicate button
  // that follows it down too, silently, in a menu that otherwise looked fine.
  // Only a live browser found it.
  //
  // Re-renders either way: accepted retires the row for good, dismissed retires
  // it too, because the event is spent and cannot be prompted twice.
  function doInstall() {
    promptInstall().then(() => { if (actions) renderActions(); });
  }

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
      // THE COUNT RIDES THE BUTTON, and without it the honours are a drawer
      // nobody opens. `honourCount` is null on a save that has done nothing —
      // "0 / 20" in front of a new player is a scolding, and the drawer already
      // refuses to draw a table of zeroes for the same reason.
      h('button.btn.ghost.menu-record-btn', {
        type: 'button', on: { click: showRecord },
      }, h('span', { text: 'Record' }), ...(recordTally() ? [
        h('span.menu-record-tally', { text: recordTally() }),
      ] : [])),
      h('button.btn.ghost.menu-settings-btn', {
        type: 'button', text: 'Settings', on: { click: showSettings },
      }));
    // Shown LOCKED rather than omitted — see screens/endgate.js. It used to be
    // built only when it could be taken, on the argument that a button whose
    // whole job is to explain why it is disabled is clutter; the cost was that a
    // player mid-campaign had no way to learn abdication exists, and
    // `ENDGAME.abdicateLocked` had no reader anywhere. The drawer still handles
    // the locked case independently, because a menu left open across a battle
    // is a stale menu.
    // INSTALL. Offered only when the browser has actually handed over a prompt,
    // which is the one thing that distinguishes "installable here" from "the
    // manifest exists". Absent rather than disabled: unlike abdication, there is
    // nothing to teach a player who cannot act on it — the game is already
    // running, and on a browser with no prompt to give there is no route to
    // explain. See ui/install.js.
    const inst = installOffer();
    if (inst.shown) {
      mount(actions, h('button.btn.ghost.menu-install', {
        type: 'button', text: inst.label, title: inst.hint, on: { click: doInstall },
      }));
    }
    mount(actions, endgameEntry({
      cls: 'menu-abdicate', text: ENDGAME.abdicateTitle,
      open: canAbdicate(meta()), why: ENDGAME.abdicateLocked,
      label: 'End this empire and start again', onOpen: showAbdicate,
    }));
    actions.firstChild?.focus?.();
  }

  /**
   * Open a drawer: bring it into view, THEN focus its entry point.
   *
   * MEASURED, and it is the reason the honours are visible at all. The menu
   * keeps its six action buttons on screen while a drawer is open — right, so
   * you can switch drawers — but that puts `.menu-io` at y=671 inside a
   * `.dialog` sitting at `scrollTop: 0`, so at a 760px window a 488px drawer
   * showed its TITLE and nothing else: body 761..1050 and Close at 1115 were
   * both past the bottom edge. Byte-identical before the honours landed, so
   * this is a pre-existing trap rather than their cost — it simply had no
   * content worth scrolling to until now.
   *
   * `focus()` alone cannot fix it and that is the subtle part: browsers scroll
   * a focused element into view by the MINIMAL amount, and the title was
   * already inside the container, so the correct call did nothing. Scrolling
   * the drawer's own top to the container's top is what buys it the full
   * height. `preventScroll` then stops the focus undoing it.
   */
  function openDrawer(target) {
    drawer.scrollIntoView?.({ block: 'start' });
    target?.focus?.({ preventScroll: true });
  }

  /** `earned / total` for the button, or '' when there is nothing to tally. */
  function recordTally() {
    const c = honourCount(meta().stats);
    return c ? `${c.earned} / ${c.total}` : '';
  }

  /** The lifetime record — see ./mainmenu-record.js. Offered unconditionally,
   *  unlike Abdicate: it is never destructive and a save with nothing in it
   *  says so, so there is no state in which the button would be a dead end. */
  function showRecord() {
    openDrawer(renderRecord(drawer, ctx, { onCancel: backToActions }));
  }

  /** The prestige decision. Destructive, so it lives behind the same second
   *  click "New Campaign" does — see ./mainmenu-legacy.js. */
  function showAbdicate() {
    openDrawer(renderAbdicate(drawer, ctx, {
      onCancel: backToActions,
      onDone: (result) => {
        say(`Abdicated. You hold ${result.total} legacy.`);
        // Same stack reasoning as newCampaign(): as an overlay there is a world
        // map underneath, so drop the overlay first and then replace what it was
        // covering — which re-enters the map and rebuilds a board where nothing
        // but Riverfen is open again.
        if (overlay) ctx.scenes.pop();
        ctx.scenes.replace(ctx.screens.worldmap);
      },
    }));
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
        type: 'button', text: 'Cancel', on: { click: backToActions },
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

  function showSettings() {
    openDrawer(renderSettings(drawer, ctx));
  }

  function showExport() {
    renderExport(drawer, ctx, { say, close: closeBtn });
  }

  function showImport() {
    renderImport(drawer, ctx, {
      say,
      close: closeBtn,
      // The drawer only ever hands back a save that PARSED (see
      // mainmenu-io.js), so this side does the adopting and nothing else has
      // to know the refusal rules.
      onAdopt: (next, now) => {
        adoptCampaign(ctx, next, now);
        backToActions();
        stats.update();
      },
    });
  }
}
