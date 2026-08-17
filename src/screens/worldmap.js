// World map — 24 regions as hexes on one grid. Conquered hexes flood with your
// colour, so the campaign literally looks like a spreading empire.
//
// DOM rather than canvas: 24 static, clickable, labelled things are exactly
// what the browser is already good at, and it gets focus, keyboard nav and
// accessibility for free. Canvas would mean reimplementing all of it.
//
// The map is BIGGER than the window on purpose and you press-and-drag to look
// around it, the same verb the battle board uses. Geometry, the clamp and the
// gesture all live in worldmap-pan.js; this file only says what to centre on.
//
// This is also the campaign's HUB: it owns the boot decision (menu, or straight
// into region 1 on a clean save) for as long as main.js still replaces into it,
// and it is the only route to the loadout, the shop and the menu.
import { h, clear, mount, bindText } from '../ui/dom.js';
import { compact, rate, duration } from '../ui/format.js';
import { UI, WORLD, ENDGAME } from '../content/strings.js';
import {
  worldView, regionById, isAttackable, raidCooldownRemaining, modeOf,
  campaignGap, CAMPAIGN_GAP_WARN,
} from '../meta/world.js';
import { incursionView } from '../meta/incursion.js';
import { incomePerSec } from '../meta/idle.js';
import { previewReward } from '../meta/rewards.js';
import { createAutoResolveUI } from './worldmap-autobattle.js';
import { createDetailRenderer } from './worldmap-detail.js';
import { bootRoute, launchFirstRegion } from './mainmenu.js';
import { HEX, layoutHexes, createMapPanner } from './worldmap-pan.js';

export function createWorldMapScene(ctx) {
  let root = null;
  let cells = new Map();
  let banner = null;
  let selected = null;
  let detailEl = null;
  let boardEl = null;
  /** The header buttons that leave this screen — held here (not just inside
   *  enter()) so beginAutoResolve can disable them for the duration. */
  let navButtons = [];
  let detailMode = null;
  let tickDetail = null;
  let pending = null;
  let panner = null;
  let centred = false;
  /** Rebuilt every enter() — see worldmap-autobattle.js. Guards select() and
   *  the header actions so nothing else on this screen can move while a raid
   *  is resolving in the background. */
  let autoResolve = null;

  const meta = () => ctx.state.meta;

  // The panel says what a region IS and offers the one button it earns; this
  // file owns the board, the selection and the scene. `autoResolve` is passed
  // as a getter because it is rebuilt every enter() — a reference captured
  // here once would go stale on the second visit to this screen.
  const renderDetail = createDetailRenderer({
    dom: { h, clear, mount, bindText },
    meta,
    now: () => Date.now(),
    launch: (id) => launch(id),
    autoResolve: () => autoResolve,
    setMode: (m) => { detailMode = m; },
    setTick: (fn) => { tickDetail = fn; },
    tick: () => tickDetail?.(),
  });

  return {
    id: 'worldmap',

    enter(params) {
      root = h('div.screen.worldmap');
      document.body.dataset.scene = 'worldmap';

      // The boot decision. Deferred to update() because a scene may not replace
      // itself from enter() — the stack has not finished pushing it yet.
      // `session.booted` is also set by the menu, so this runs exactly once
      // whichever of the two main.js opens with.
      if (!ctx.state.session.booted) {
        ctx.state.session.booted = true;
        pending = bootRoute(meta()) === 'new-game'
          ? () => launchFirstRegion(ctx)
          : () => ctx.scenes.push(ctx.screens.mainmenu, params);
      }

      const crowns = h('span.num.crowns');
      const relics = h('span.num.relics');
      const income = h('span.num.income');
      const setCrowns = bindText(crowns);
      const setRelics = bindText(relics);
      const setIncome = bindText(income);
      // Hoisted rather than built inline: while a raid auto-resolves in the
      // background these three are the only things that could carry the
      // player off this screen while the results of that resolve still need
      // ctx.scenes.replace(...results...) to land HERE (see
      // beginAutoResolve) — so each is disabled for the duration rather than
      // guarded ad hoc in a handler that could be added later and forget to.
      const incursionBtn = incursionView(meta()).open ? h('button.btn.wm-incursion', {
        text: ENDGAME.incursionTitle, type: 'button',
        'aria-label': 'Open the incursion briefing',
        on: { click: () => ctx.scenes.push(ctx.screens.incursion) },
      }) : null;
      // `.wm-shop` on the control itself, not "the first button in the
      // header": tools/smoke.mjs used to select `.wm-actions button`, and the
      // moment a second button joined that row the smoke test would have been
      // hit-testing whichever one came first in the DOM while still reporting
      // that it had checked the shop.
      const shopBtn = h('button.btn.wm-shop', {
        text: UI.shop, type: 'button',
        'aria-label': 'Open the upgrade shop',
        on: { click: () => ctx.scenes.push(ctx.screens.shop) },
      });
      const menuBtn = h('button.btn.ghost.wm-menu', {
        text: 'Menu', type: 'button',
        'aria-label': 'Open the main menu',
        on: { click: () => ctx.scenes.push(ctx.screens.mainmenu) },
      });
      navButtons = [incursionBtn, shopBtn, menuBtn].filter(Boolean);
      const header = h('div.wm-header.panel', {},
        // NOT a live region. It was `polite` and refreshes every 250ms, and
        // `compact` renders values under 1000 as whole numbers — measured at
        // 3.0 announcements a second in the early game, which is a polite queue
        // that never drains and a screen reader that says nothing else about
        // this screen ever again. The countdown twelve elements below already
        // learned this ("a countdown announced once a second is a denial of
        // service"); the treasury had not.
        h('div.wm-treasury', { 'aria-live': 'off' },
          h('span.label', { text: UI.treasury }), crowns,
          h('span.label', { text: UI.relics }), relics,
          h('span.label', { text: UI.income }), income),
        // The endless ladder, and only once there is one. Built here rather
        // than in the detail panel because a rung has no hex of its own: it is
        // fought on ground the player already holds. Absent until the campaign
        // is finished, so it can never be a button that explains why it is
        // disabled — see meta/incursion.js `campaignComplete`.
        h('div.wm-actions', {}, ...navButtons));

      // The window and the world. `map` clips and hears the gesture; `board` is
      // the one layer that moves, so panning costs a single composited
      // transform no matter how many plates are on it.
      const board = h('div.wm-board', { role: 'group', 'aria-label': 'Regions' });
      boardEl = board;
      const map = h('div.wm-map', {}, board,
        h('button.btn.ghost.wm-recentre', {
          text: 'Centre', type: 'button',
          'aria-label': 'Centre the map on the selected region',
          on: { click: () => centreOnSelected() },
        }));
      const detail = h('aside.wm-detail.panel', {
        role: 'region', 'aria-labelledby': 'wm-detail-h', 'aria-live': 'polite',
      });
      detailEl = detail;

      // "While you were away" — the payoff for the idle half of the game.
      // The old test read `grantedMs`, a field applyOfflineProgress has never
      // returned, so this banner had never once appeared. The real field is
      // `creditedMs`; the threshold keeps a page reload from announcing "+0
      // crowns earned while you were away (0.3s)".
      if (params?.offline?.creditedMs >= 60_000 && params?.offline?.crowns >= 1) {
        banner = h('div.wm-offline.panel', { role: 'status' },
          h('strong', { text: `+${compact(params.offline.crowns)} crowns` }),
          h('span', {
            text: ` earned while you were away (${duration(params.offline.creditedMs / 1000)})`,
          }),
          h('button.btn.ghost', {
            text: 'Dismiss', type: 'button',
            'aria-label': 'Dismiss the offline income notice',
            on: { click: () => banner?.remove() },
          }));
        mount(root, banner);
      }

      mount(root, header, h('div.wm-body', {}, map, detail));
      mount(ctx.root, root);

      // `onAutoRefit` re-centres whenever the porthole changes size, until the
      // player pans or pinches. `centred` below only fires once, on first
      // render — and on a phone the panel below the map has not settled to its
      // `max-height` by then, so the map opened with the one region you can
      // attack half off the bottom edge.
      panner = createMapPanner({
        viewport: map, board, onAutoRefit: () => centreOnSelected(),
      });
      // Tabbing to a region that is off-screen has to bring it on-screen, or
      // keyboard navigation walks into a map it cannot see.
      const onFocus = (ev) => {
        if (ev.target?.classList?.contains('wm-hex')) panner?.reveal(ev.target);
      };
      map.addEventListener('focusin', onFocus);

      // Rebuilt per enter() rather than per module, because it holds the one
      // piece of state a resolve has (is one in flight) and that must not
      // survive leaving the screen. It is handed this file's own DOM helpers
      // rather than importing its own, so there is one `h`, and the two things
      // it cannot know: how to lock the rest of the screen, and what to draw
      // when a cancelled resolve hands the panel back.
      autoResolve = createAutoResolveUI({
        ctx,
        dom: { h, clear, mount, bindText },
        duration,
        lockNav: setNavLocked,
        onCancelled: (region) => {
          if (detailEl && selected === region.id) renderDetail(detailEl, region);
        },
      });

      buildBoard(board, detail);
      refresh(setCrowns, setRelics, setIncome);

      const timer = setInterval(() => refresh(setCrowns, setRelics, setIncome), 250);
      const off = ctx.bus.on('meta:region-unlocked', () => buildBoard(board, detail));

      return [
        () => clearInterval(timer), off,
        () => map.removeEventListener('focusin', onFocus),
        () => panner?.dispose(), () => root?.remove(),
        // Defensive: nothing on this screen can normally exit it while a raid
        // is resolving (see beginAutoResolve), but a stray error elsewhere
        // forcing the stack must not leave an animation-frame loop running
        // against a torn-down scene.
        () => autoResolve?.dispose(),
      ];
    },

    exit() {
      // The manager runs the unsubscribers from enter() before this, so the
      // panner is already torn down; exit() only drops references.
      cells.clear();
      selected = detailMode = tickDetail = pending = detailEl = panner = null;
      root = banner = boardEl = null;
      navButtons = [];
      autoResolve = null;
      centred = false;
      delete document.body.dataset.scene;
    },

    update() {
      if (!pending) return;
      const go = pending;
      pending = null;
      go();
    },
  };

  function buildBoard(board, detail) {
    clear(board);
    cells.clear();
    const regions = worldView(meta(), Date.now());

    // Axial -> pixel, pointy-top, so the world map reads with the same
    // geometry as the battle map. The plate size is written from the same
    // constants that space them, so layout and CSS cannot drift apart.
    const { cells: at, width, height } = layoutHexes(regions.map((r) => r.hex));
    board.style.setProperty('--hex-w', `${HEX.w}px`);
    board.style.setProperty('--hex-h', `${HEX.h}px`);
    board.style.width = `${width}px`;
    board.style.height = `${height}px`;

    regions.forEach((r, i) => {
      const locked = r.status === 'locked';
      const cell = h('button.wm-hex', {
        type: 'button',
        'data-status': r.status,
        'data-tier': r.tier,
        'data-mode': r.mode,
        style: { left: `${at[i].x}px`, top: `${at[i].y}px` },
        title: locked ? UI.locked : r.name,
        // Ownership is otherwise conveyed by colour alone.
        'aria-label': hexLabel(r),
        'aria-pressed': 'false',
        on: { click: () => select(r.id, detail) },
      },
      h('span.wm-name', { text: locked ? '???' : r.name }),
      h('span.wm-tier', { text: `T${r.tier}` }));
      cells.set(r.id, cell);
      mount(board, cell);
    });

    // setContent re-clamps whatever pan the player already had, so a rebuild
    // (a region unlocking) never yanks the view out from under them. Only the
    // first build of a visit chooses where to look.
    panner?.setContent(width, height);

    const keep = selected && cells.has(selected) ? selected : null;
    const first = regions.find((r) => isAttackable(meta(), r.id))
      ?? regions.find((r) => r.status !== 'locked');
    if (keep) select(keep, detail);
    else if (first) select(first.id, detail);
    if (!centred) { centred = true; centreOnSelected(); }
  }

  /** The one anti-lost-ness guarantee: whatever you can act on is one press
   *  away from the middle of the screen. */
  function centreOnSelected() {
    const el = cells.get(selected);
    if (!el || !panner) return;
    panner.centre(el.offsetLeft + el.offsetWidth / 2, el.offsetTop + el.offsetHeight / 2);
  }

  function hexLabel(r) {
    if (r.status === 'locked') return `Locked region, tier ${r.tier}`;
    const state = r.mode === 'attack' ? 'available to invade'
      : r.mode === 'raid' ? 'conquered, raid ready'
        : r.mode === 'cooldown' ? 'conquered, recovering' : UI.locked;
    return `${r.name}, tier ${r.tier}, ${state}`;
  }

  function select(id, detail) {
    // A raid resolving in the background is the one thing on this screen that
    // must not be interrupted mid-flight — see beginAutoResolve.
    if (autoResolve?.isActive) return;
    const region = regionById(id);
    if (!region) return;
    selected = id;
    for (const [rid, el] of cells) {
      const on = rid === id;
      el.classList.toggle('is-selected', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    // A click target is already visible, so this is a no-op then. It earns its
    // keep for selections that arrive from elsewhere — a rebuild, or the coach.
    panner?.reveal(cells.get(id));
    renderDetail(detail, region);
  }

  /**
   * Rebuilt only when the region's MODE changes. It used to be rebuilt every
   * 250ms while a conquered region was selected, which threw focus off the Raid
   * button four times a second; now the countdown updates its own text node.
   */
  /** The world map no longer starts battles. It picks the region; the loadout
   *  screen decides what lands there. */
  function launch(regionId) {
    ctx.scenes.replace(ctx.screens.prebattle, { regionId });
  }

  /** Disable everything else on this screen for the duration of an
   *  auto-resolve. The one thing that must not happen mid-flight is leaving
   *  this scene: completion replaces it with the results screen (below), and
   *  that replace has to find THIS scene on top, not the shop or the menu. */
  function setNavLocked(locked) {
    for (const btn of navButtons) btn.disabled = locked;
    boardEl?.classList.toggle('is-locked', locked);
  }

  function refresh(setCrowns, setRelics, setIncome) {
    setCrowns(compact(meta().crowns));
    // Uncompacted, like the shop's. A relic count is small enough to read
    // exactly, and "1.2k" beside a treasury reading "1.2k" would be two
    // different quantities wearing the same word.
    setRelics(String(Math.floor(meta().relics ?? 0)));
    setIncome(rate(incomePerSec(meta())));
    if (!selected || !detailEl) return;
    const region = regionById(selected);
    if (!region) return;
    if (modeOf(meta(), selected, Date.now()) !== detailMode) renderDetail(detailEl, region);
    else tickDetail?.();
  }
}
