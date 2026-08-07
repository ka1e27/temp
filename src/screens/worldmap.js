// World map — 18 regions as hexes on one grid. Conquered hexes flood with your
// colour, so the campaign literally looks like a spreading empire.
//
// DOM rather than canvas: 18 static, clickable, labelled things are exactly
// what the browser is already good at, and it gets focus, keyboard nav and
// accessibility for free. Canvas would mean reimplementing all of it.
import { h, clear, mount } from '../ui/dom.js';
import { compact, rate, duration } from '../ui/format.js';
import { worldView, regionById, isAttackable, canRaid, raidCooldownRemaining } from '../meta/world.js';
import { incomePerSec } from '../meta/idle.js';
import { defaultSelection } from '../meta/boosters.js';
import { previewReward } from '../meta/rewards.js';

const HEX_W = 92;
const HEX_H = 80;

export function createWorldMapScene(ctx) {
  let root = null;
  let cells = new Map();
  let banner = null;
  let selected = null;

  const meta = () => ctx.state.meta;

  return {
    id: 'worldmap',

    enter(params) {
      root = h('div.screen.worldmap');
      document.body.dataset.scene = 'worldmap';

      const crowns = h('span.num.crowns');
      const income = h('span.num.income');
      const header = h('div.wm-header.panel', {},
        h('div.wm-treasury', {},
          h('span.label', { text: 'Treasury' }), crowns,
          h('span.label', { text: 'Income' }), income),
        h('div.wm-actions', {},
          h('button.btn', {
            text: 'Upgrades', type: 'button',
            on: { click: () => ctx.scenes.push(ctx.screens.shop) },
          })));

      const board = h('div.wm-board');
      const detail = h('aside.wm-detail.panel');

      // "While you were away" — the payoff for the idle half of the game.
      if (params?.offline?.grantedMs > 0) {
        banner = h('div.wm-offline.panel', {},
          h('strong', { text: `+${compact(params.offline.crowns)} crowns` }),
          h('span', { text: ` earned while you were away (${duration(params.offline.grantedMs / 1000)})` }),
          h('button.btn.ghost', {
            text: 'Dismiss', type: 'button',
            on: { click: () => banner?.remove() },
          }));
        mount(root, banner);
      }

      mount(root, header, h('div.wm-body', {}, board, detail));
      mount(ctx.root, root);

      buildBoard(board, detail);
      refresh(crowns, income, detail);

      const timer = setInterval(() => refresh(crowns, income, detail), 250);
      const off = ctx.bus.on('meta:region-unlocked', () => buildBoard(board, detail));

      return [() => clearInterval(timer), off, () => root?.remove()];
    },

    exit() {
      cells.clear();
      selected = null;
      root = banner = null;
      delete document.body.dataset.scene;
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
      const cell = h('button.wm-hex', {
        type: 'button',
        'data-status': r.status,
        'data-tier': r.tier,
        style: { left: `${x}px`, top: `${y}px` },
        title: r.status === 'locked' ? 'Locked' : r.name,
        on: { click: () => select(r.id, detail) },
      },
      h('span.wm-name', { text: r.status === 'locked' ? '???' : r.name }),
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

    if (!selected) {
      const first = regions.find((r) => isAttackable(meta(), r.id));
      if (first) select(first.id, detail);
    }
  }

  function select(id, detail) {
    const region = regionById(id);
    if (!region) return;
    selected = id;
    for (const [rid, el] of cells) el.classList.toggle('is-selected', rid === id);
    renderDetail(detail, region);
  }

  function renderDetail(detail, region) {
    clear(detail);
    const m = meta();
    const now = Date.now();
    const attackable = isAttackable(m, region.id);
    const raidable = canRaid(m, region.id, now);
    const conquered = m.regions[region.id]?.status === 'conquered';
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
      h('h2', { text: region.name }),
      h('p.wm-flavour', { text: region.flavour ?? '' }),
      h('dl.wm-stats', {}, ...rows.flatMap(([k, v]) => [
        h('dt', { text: k }), h('dd.num', { text: v }),
      ])));

    if (!m.regions[region.id] || m.regions[region.id].status === 'locked') {
      mount(detail, h('p.wm-hint', {
        text: 'Locked. Conquer a neighbouring region first.',
      }));
      return;
    }

    if (attackable) {
      mount(detail, h('button.btn.primary.wm-go', {
        text: `Invade ${region.name}`, type: 'button',
        on: { click: () => launch(region.id) },
      }));
    } else if (conquered && raidable) {
      mount(detail,
        h('p.wm-hint', { text: `Conquered. Raid for a one-time ${compact(reward.crowns)} crowns.` }),
        h('button.btn.wm-go', {
          text: 'Raid', type: 'button', on: { click: () => launch(region.id) },
        }));
    } else if (conquered) {
      const left = raidCooldownRemaining(m, region.id, now);
      mount(detail, h('p.wm-hint', {
        text: `Conquered. Raid available in ${duration(left / 1000)}.`,
      }));
    }
  }

  function launch(regionId) {
    ctx.scenes.replace(ctx.screens.battle, {
      regionId,
      boosters: defaultSelection(meta()),
    });
  }

  function refresh(crowns, income, detail) {
    crowns.textContent = compact(meta().crowns);
    income.textContent = rate(incomePerSec(meta()));
    if (selected) {
      const r = regionById(selected);
      // Raid cooldowns tick down while you watch; keep the panel honest.
      if (r && meta().regions[selected]?.status === 'conquered') renderDetail(detail, r);
    }
  }
}
