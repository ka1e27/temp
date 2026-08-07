// World map — 18 regions as hexes on one grid. Conquered hexes flood with your
// colour, so the campaign literally looks like a spreading empire.
//
// DOM rather than canvas: 18 static, clickable, labelled things are exactly
// what the browser is already good at, and it gets focus, keyboard nav and
// accessibility for free. Canvas would mean reimplementing all of it.
//
// This is also the campaign's HUB: it owns the boot decision (menu, or straight
// into region 1 on a clean save) for as long as main.js still replaces into it,
// and it is the only route to the loadout, the shop and the menu.
import { h, clear, mount, bindText } from '../ui/dom.js';
import { compact, rate, duration } from '../ui/format.js';
import { UI, WORLD } from '../content/strings.js';
import {
  worldView, regionById, isAttackable, raidCooldownRemaining, modeOf,
} from '../meta/world.js';
import { incomePerSec } from '../meta/idle.js';
import { previewReward } from '../meta/rewards.js';
import { bootRoute, launchFirstRegion } from './mainmenu.js';

const HEX_W = 92;
const HEX_H = 80;

export function createWorldMapScene(ctx) {
  let root = null;
  let cells = new Map();
  let banner = null;
  let selected = null;
  let detailEl = null;
  let detailMode = null;
  let tickDetail = null;
  let pending = null;

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
      const income = h('span.num.income');
      const setCrowns = bindText(crowns);
      const setIncome = bindText(income);
      const header = h('div.wm-header.panel', {},
        // Read constantly and changing constantly, so it is announced politely
        // and written only when the string actually differs.
        h('div.wm-treasury', { 'aria-live': 'polite' },
          h('span.label', { text: UI.treasury }), crowns,
          h('span.label', { text: UI.income }), income),
        h('div.wm-actions', {},
          h('button.btn', {
            text: UI.shop, type: 'button',
            'aria-label': 'Open the upgrade shop',
            on: { click: () => ctx.scenes.push(ctx.screens.shop) },
          }),
          h('button.btn.ghost.wm-menu', {
            text: 'Menu', type: 'button',
            'aria-label': 'Open the main menu',
            on: { click: () => ctx.scenes.push(ctx.screens.mainmenu) },
          })));

      const board = h('div.wm-board', { role: 'group', 'aria-label': 'Regions' });
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

      mount(root, header, h('div.wm-body', {}, board, detail));
      mount(ctx.root, root);

      buildBoard(board, detail);
      refresh(setCrowns, setIncome);

      const timer = setInterval(() => refresh(setCrowns, setIncome), 250);
      const off = ctx.bus.on('meta:region-unlocked', () => buildBoard(board, detail));

      return [() => clearInterval(timer), off, () => root?.remove()];
    },

    exit() {
      cells.clear();
      selected = detailMode = tickDetail = pending = detailEl = null;
      root = banner = null;
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
    // geometry as the battle map.
    for (const r of regions) {
      const [q, rr] = r.hex;
      const x = HEX_W * (q + rr / 2);
      const y = HEX_H * rr * 0.86;
      const locked = r.status === 'locked';
      const cell = h('button.wm-hex', {
        type: 'button',
        'data-status': r.status,
        'data-tier': r.tier,
        'data-mode': r.mode,
        style: { left: `${x}px`, top: `${y}px` },
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
    }

    // Centre the cluster.
    const xs = regions.map((r) => HEX_W * (r.hex[0] + r.hex[1] / 2));
    const ys = regions.map((r) => HEX_H * r.hex[1] * 0.86);
    board.style.setProperty('--wm-ox', `${-Math.min(...xs) + 24}px`);
    board.style.setProperty('--wm-oy', `${-Math.min(...ys) + 24}px`);
    board.style.width = `${Math.max(...xs) - Math.min(...xs) + HEX_W + 48}px`;
    board.style.height = `${Math.max(...ys) - Math.min(...ys) + HEX_H + 48}px`;

    const keep = selected && cells.has(selected) ? selected : null;
    const first = regions.find((r) => isAttackable(meta(), r.id))
      ?? regions.find((r) => r.status !== 'locked');
    if (keep) select(keep, detail);
    else if (first) select(first.id, detail);
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

  function refresh(setCrowns, setIncome) {
    setCrowns(compact(meta().crowns));
    setIncome(rate(incomePerSec(meta())));
    if (!selected || !detailEl) return;
    const region = regionById(selected);
    if (!region) return;
    if (modeOf(meta(), selected, Date.now()) !== detailMode) renderDetail(detailEl, region);
    else tickDetail?.();
  }
}
