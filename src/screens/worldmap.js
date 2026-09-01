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
import { h, clear, mount, bindText, bindClass } from '../ui/dom.js';
import { compact, rate, duration } from '../ui/format.js';
import { UI, WORLD, IDLE } from '../content/strings.js';
import {
  worldView, regionById, isAttackable, raidCooldownRemaining, modeOf,
  campaignGap, CAMPAIGN_GAP_WARN, regionsConquered,
} from '../meta/world.js';
import { incomePerSec, offlineNotice } from '../meta/idle.js';
import { offlineCapMs } from '../meta/upgrades.js';
import { OFFLINE } from '../content/upgrades.data.js';
import { previewReward } from '../meta/rewards.js';
import { createAutoResolveUI } from './worldmap-autobattle.js';
import { createDetailRenderer } from './worldmap-detail.js';
import { createWorldHeader } from './worldmap-header.js';
import { bootRoute, launchFirstRegion } from './mainmenu.js';
import { HEX, layoutHexes, createMapPanner, centreOn } from './worldmap-pan.js';
import { CAPITAL_ID, REGION_IDS } from '../content/regions.data.js';

export function createWorldMapScene(ctx) {
  let root = null;
  let cells = new Map();
  let banner = null;
  let selected = null;
  let detailEl = null;
  let boardEl = null;
  let objective = null;
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

      const head = createWorldHeader({ meta, scenes: ctx.scenes, screens: ctx.screens });
      navButtons = head.navButtons;
      const header = head.el;
      // `head.set` is passed whole rather than as positional setters: adding a
      // sixth is what showed that shape does not scale, and a mis-ordered
      // argument list would write the treasury into the campaign counter with
      // nothing failing.

      // The window and the world. `map` clips and hears the gesture; `board` is
      // the one layer that moves, so panning costs a single composited
      // transform no matter how many plates are on it.
      const board = h('div.wm-board', { role: 'group', 'aria-label': 'Regions' });
      boardEl = board;
      // THE OBJECTIVE, PINNED TO THE PORTHOLE RATHER THAN TO THE WORLD.
      // Marking the capital on its own plate is not the same as SHOWING it:
      // measured at 1440x900 the board is 2011px wide against a 1046px window,
      // and the beachhead and the capital are 1071px apart, so at this screen's
      // fixed 1:1 zoom the two cannot be in shot together at all. (At 1920x1080
      // they can, and `centreOnSelected` takes that view when it is available —
      // confirmed in a browser at both sizes.) A tag that does not pan is what
      // answers "where am I going" on every window in between.
      //
      // It retires the moment the capital falls, because an objective you have
      // met is not an objective. What is behind it is announced by the results
      // screen (RESULTS.capitalBody), which is a better place for a surprise
      // than a label that would have to spoil it in advance.
      objective = h('p.wm-objective', { 'aria-hidden': 'true' });
      const map = h('div.wm-map', {}, board, objective,
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
      //
      // AND IT SAYS WHEN THE TREASURY FILLED, which is the half that was
      // missing. `applyOfflineProgress` has returned `cappedOut` since it was
      // written and nothing has ever read it, while `content/strings.js IDLE`
      // has carried a line for exactly this case with no reader at all — so a
      // player who idled past the cap lost every crown after it, silently, and
      // was never told which upgrade raises it. That is the one moment in the
      // game where the Treasury line sells itself, and it was the one moment
      // the game said nothing. The copy lives in IDLE now rather than inline
      // here, because the block that was hardcoded beside it is exactly how the
      // unread one went stale (it named a "Granary" upgrade that stopped
      // existing when twenty-six upgrades collapsed into six endless lines).
      const notice = offlineNotice(params?.offline);
      if (notice.shown) {
        banner = h('div.wm-offline.panel', { role: 'status' },
          h('strong', { text: IDLE.awayCrowns(compact(notice.crowns)) }),
          h('span', { text: IDLE.awayBody(duration(notice.creditedMs / 1000)) }),
          // Only when it actually capped: a player who was away for an hour
          // against an eight-hour cap must not be nagged about a limit that
          // cost them nothing.
          notice.capped
            ? h('span.wm-offline-cap', { text: IDLE.awayCapped(duration(notice.capMs / 1000)) })
            : null,
          h('button.btn.ghost', {
            text: IDLE.awayDismiss, type: 'button',
            'aria-label': IDLE.awayDismissLabel,
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
      refresh(head.set);

      const timer = setInterval(() => refresh(head.set), 250);
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
      // A LOCKED REGION IS NAMED, and the placeholder it replaced was never a
      // secret: `worldmap-detail.js` renders the name, the flavour and the whole
      // stat block — tier, enemy multiplier to two decimals, board size, enemy
      // sites, typical length, income if taken — BEFORE it branches on the lock,
      // so one click on a region twenty conquests away already returned all of
      // it. The board and the panel disagreed and the board was the one lying.
      // 23 of 24 plates read as question marks, so a new player had no
      // destination and no sense that the names meant anything.
      const capital = r.id === CAPITAL_ID;
      const cell = h('button.wm-hex', {
        type: 'button',
        'data-status': r.status,
        'data-tier': r.tier,
        'data-mode': r.mode,
        // Marked from tick 0, because a destination revealed on arrival is not
        // a destination.
        ...(capital ? { 'data-capital': 'true' } : {}),
        style: { left: `${at[i].x}px`, top: `${at[i].y}px` },
        title: hexTitle(r, locked, capital),
        // Ownership is otherwise conveyed by colour alone.
        'aria-label': hexLabel(r, capital),
        'aria-pressed': 'false',
        on: { click: () => select(r.id, detail) },
      },
      h('span.wm-name', { text: r.name }),
      h('span.wm-tier', { text: `T${r.tier}` }));
      cells.set(r.id, cell);
      mount(board, cell);
    });

    // setContent re-clamps whatever pan the player already had, so a rebuild
    // (a region unlocking) never yanks the view out from under them. Only the
    // first build of a visit chooses where to look.
    panner?.setContent(width, height);

    // Written where the board is, so the conquest that retires it lands on the
    // same rebuild that repaints the plate.
    const cap = regions.find((r) => r.id === CAPITAL_ID);
    const showObjective = !!cap && cap.status !== 'conquered';
    if (objective) {
      objective.textContent = showObjective ? `${WORLD.objective} ${cap.name}` : '';
      objective.classList.toggle('is-on', showObjective);
    }

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
    const cx = el.offsetLeft + el.offsetWidth / 2;
    const cy = el.offsetTop + el.offsetHeight / 2;
    // ...AND THE DESTINATION IS IN SHOT WHERE IT FITS. Slide the centre toward
    // the capital, but only as far as leaves the region you can ACT on fully
    // visible — the guarantee above is checked rather than traded away, and on
    // a window too small for both (see `.wm-objective`) nothing moves.
    const cap = cells.get(CAPITAL_ID);
    if (cap && cap !== el) {
      const mid = { x: (cx + cap.offsetLeft + cap.offsetWidth / 2) / 2, y: cy };
      if (panner.wouldReveal(el, centreOn(mid.x, mid.y, panner.view, panner.zoom))) {
        panner.centre(mid.x, mid.y);
        return;
      }
    }
    panner.centre(cx, cy);
  }

  function hexTitle(r, locked, capital) {
    const head = capital ? `${r.name} — ${WORLD.capitalTag}` : r.name;
    return locked ? `${head}. ${UI.locked}: ${WORLD.lockedHint}` : head;
  }

  function hexLabel(r, capital) {
    const state = r.status === 'locked' ? 'locked'
      : r.mode === 'attack' ? 'available to invade'
        : r.mode === 'raid' ? 'conquered, raid ready'
          : r.mode === 'cooldown' ? 'conquered, recovering' : UI.locked;
    // The capital is named in the label too: a marker that is a glyph and a
    // colour is a marker a screen reader cannot see.
    return `${r.name}, tier ${r.tier}, ${state}${capital ? `, ${WORLD.capitalTag}` : ''}`;
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

  function refresh(set) {
    // N of 24, and it is the only figure on this screen that is not money.
    set.campaign(`${regionsConquered(meta())} / ${REGION_IDS.length}`);
    set.crowns(compact(meta().crowns));
    // Uncompacted, like the shop's. A relic count is small enough to read
    // exactly, and "1.2k" beside a treasury reading "1.2k" would be two
    // different quantities wearing the same word.
    set.relics(String(Math.floor(meta().relics ?? 0)));
    set.income(rate(incomePerSec(meta())));
    // Whole hours: the cap moves in two-hour steps and nobody plans an absence
    // to the minute. `is-floor` marks the untouched base — the one state worth
    // drawing attention to, because it is the one a player can fix.
    const capMs = offlineCapMs(meta());
    set.away(`${Math.round(capMs / 3600000)}h`);
    set.awayFloor(capMs <= OFFLINE.baseCapMs);
    if (!selected || !detailEl) return;
    const region = regionById(selected);
    if (!region) return;
    if (modeOf(meta(), selected, Date.now()) !== detailMode) renderDetail(detailEl, region);
    else tickDetail?.();
  }
}
