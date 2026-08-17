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
import { bootRoute, launchFirstRegion } from './mainmenu.js';
import { HEX, layoutHexes, createMapPanner } from './worldmap-pan.js';

export function createWorldMapScene(ctx) {
  let root = null;
  let cells = new Map();
  let banner = null;
  let selected = null;
  let detailEl = null;
  let detailMode = null;
  let tickDetail = null;
  let pending = null;
  let panner = null;
  let centred = false;

  const meta = () => ctx.state.meta;

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
        h('div.wm-actions', {},
          // The endless ladder, and only once there is one. Built here rather
          // than in the detail panel because a rung has no hex of its own: it is
          // fought on ground the player already holds. Absent until the campaign
          // is finished, so it can never be a button that explains why it is
          // disabled — see meta/incursion.js `campaignComplete`.
          ...(incursionView(meta()).open ? [h('button.btn.wm-incursion', {
            text: ENDGAME.incursionTitle, type: 'button',
            'aria-label': 'Open the incursion briefing',
            on: { click: () => ctx.scenes.push(ctx.screens.incursion) },
          })] : []),
          // `.wm-shop` on the control itself, not "the first button in the
          // header": tools/smoke.mjs used to select `.wm-actions button`, and the
          // moment a second button joined that row the smoke test would have been
          // hit-testing whichever one came first in the DOM while still reporting
          // that it had checked the shop.
          h('button.btn.wm-shop', {
            text: UI.shop, type: 'button',
            'aria-label': 'Open the upgrade shop',
            on: { click: () => ctx.scenes.push(ctx.screens.shop) },
          }),
          h('button.btn.ghost.wm-menu', {
            text: 'Menu', type: 'button',
            'aria-label': 'Open the main menu',
            on: { click: () => ctx.scenes.push(ctx.screens.mainmenu) },
          })));

      // The window and the world. `map` clips and hears the gesture; `board` is
      // the one layer that moves, so panning costs a single composited
      // transform no matter how many plates are on it.
      const board = h('div.wm-board', { role: 'group', 'aria-label': 'Regions' });
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

      buildBoard(board, detail);
      refresh(setCrowns, setRelics, setIncome);

      const timer = setInterval(() => refresh(setCrowns, setRelics, setIncome), 250);
      const off = ctx.bus.on('meta:region-unlocked', () => buildBoard(board, detail));

      return [
        () => clearInterval(timer), off,
        () => map.removeEventListener('focusin', onFocus),
        () => panner?.dispose(), () => root?.remove(),
      ];
    },

    exit() {
      // The manager runs the unsubscribers from enter() before this, so the
      // panner is already torn down; exit() only drops references.
      cells.clear();
      selected = detailMode = tickDetail = pending = detailEl = panner = null;
      root = banner = null;
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
  function renderDetail(detail, region) {
    clear(detail);
    tickDetail = null;
    const m = meta();
    const now = Date.now();
    detailMode = modeOf(m, region.id, now);
    const reward = previewReward(m, region.id);

    const rows = [
      ['Tier', `${region.tier}`],
      ['Enemy strength', `x${region.enemyMult.toFixed(2)}`],
      ['Battlefield', `${region.grid.cols} x ${region.grid.rows}`],
      ['Enemy sites', `${region.siteCounts.enemy}`],
      ['Typical length', `~${region.targetLengthMin} min`],
      ['Income if taken', rate(region.rewardPerSec)],
    ];

    mount(detail,
      h('h2#wm-detail-h', { text: region.name }),
      h('p.wm-flavour', { text: region.flavour ?? '' }),
      h('dl.wm-stats', {}, ...rows.flatMap(([k, v]) => [
        h('dt.label', { text: k }), h('dd.num', { text: v }),
      ])));

    if (detailMode === 'locked') {
      mount(detail, h('p.wm-hint', { text: `${UI.locked}. ${WORLD.lockedHint}` }));
      return;
    }

    if (detailMode === 'attack') {
      // AHEAD OF THE CAMPAIGN'S OWN PACING — see meta/world.js `campaignGap`.
      // Told, not blocked: the region stays attackable, because a player who
      // wants a hard fight should get one. What was missing was any way to know.
      const gap = campaignGap(m, region.id);
      if (gap >= CAMPAIGN_GAP_WARN) {
        mount(detail, h('p.wm-hint.is-warn', { text: WORLD.aheadOfSchedule }));
      }
      mount(detail,
        h('p.wm-hint', {
          text: `${WORLD.rewardPermanent} ${rate(reward.incomeAdded)}.`,
        }),
        h('button.btn.primary.wm-go', {
          text: `${UI.attack} ${region.name}`, type: 'button',
          'aria-label': `Plan the invasion of ${region.name}`,
          on: { click: () => launch(region.id) },
        }));
      return;
    }

    if (detailMode === 'raid') {
      mount(detail,
        h('p.wm-hint', {
          text: `${UI.conquered}. ${WORLD.rewardLump} ${compact(reward.crowns)} crowns, once.`,
        }),
        h('button.btn.wm-go', {
          text: UI.raid, type: 'button',
          'aria-label': `Plan a raid on ${region.name}`,
          on: { click: () => launch(region.id) },
        }));
      return;
    }

    // Cooldown: the only volatile line on the panel. Update the text, never the
    // subtree, and re-render once when the mode actually flips to 'raid'.
    // aria-live off: a countdown announced once a second is a denial of service.
    const line = h('p.wm-hint', { 'aria-live': 'off' });
    const setLine = bindText(line);
    mount(detail, line, h('p.wm-hint.dim', { text: WORLD.raidHarder }));
    tickDetail = () => setLine(
      `${UI.conquered}. ${WORLD.cooldownHint} `
      + `${duration(raidCooldownRemaining(meta(), region.id, Date.now()) / 1000)}.`,
    );
    tickDetail();
  }

  /** The world map no longer starts battles. It picks the region; the loadout
   *  screen decides what lands there. */
  function launch(regionId) {
    ctx.scenes.replace(ctx.screens.prebattle, { regionId });
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
