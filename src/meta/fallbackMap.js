// Fallback battle-map generation.
//
// `battle/mapgen.js` owns the real generator. This exists so the meta layer and
// its tests are never blocked on that file, and so `buildBattleConfig` still
// produces a valid map when no generator is injected. Kept out of
// modifiers.js purely to stay inside the 400-line file budget.
// PURE.
import { createRng } from '../core/rng.js';
import { MAPGEN, SITES, SITE_LEVELS } from '../content/balance.js';
import {
  FALLBACK_MAP, BASE_GARRISON, NEUTRAL_GARRISON, PLAYER_SITE_GARRISON, ENEMY_SCALING,
} from '../content/regions.data.js';

/** odd-r offset -> axial. Exported so an injected mapGen can match it exactly. */
export const offsetToAxial = (col, row) => [col - ((row - (row & 1)) / 2), row];

const scaleGarrison = (comp, mult) => Object.fromEntries(
  Object.entries(comp).map(([u, n]) => [u, Math.max(1, Math.round(n * mult))]),
);

/** @returns {{blocked:Array<[number,number]>, sites:object[], adjacency:Array<[string,string]>}} */
export function fallbackMapGen({ grid, siteCounts, seed }) {
  const rng = createRng(seed >>> 0);
  const { cols, rows } = grid;
  const slots = [];
  for (let row = 1; row < rows - 1; row += 2) {
    for (let col = 1; col < cols - 1; col += 2) slots.push({ col, row });
  }
  const need = siteCounts.player + siteCounts.enemy + siteCounts.neutral;
  for (let row = 2; slots.length < need && row < rows - 1; row += 2) {
    for (let col = 2; col < cols - 1; col += 2) slots.push({ col, row });
  }
  slots.sort((a, b) => a.col - b.col || a.row - b.row);

  const playerSlots = slots.slice(0, siteCounts.player);
  const enemySlots = slots.slice(slots.length - siteCounts.enemy);
  const mid = (cols - 1) / 2;
  const neutralSlots = slots
    .slice(siteCounts.player, slots.length - siteCounts.enemy)
    .sort((a, b) => Math.abs(a.col - mid) - Math.abs(b.col - mid) || a.row - b.row)
    .slice(0, siteCounts.neutral);

  const sites = [];
  const campAt = Math.floor(playerSlots.length / 2);
  playerSlots.forEach((s, i) => sites.push({
    id: `p${i}`, kind: i === campAt ? 'camp' : 'farm', owner: 'player',
    hex: offsetToAxial(s.col, s.row),
  }));
  const castleAt = enemySlots.length - 1 - Math.floor(enemySlots.length / 6);
  enemySlots.forEach((s, i) => sites.push({
    id: `e${i}`, kind: i === castleAt ? 'castle' : (i % 3 === 1 ? 'stronghold' : 'farm'),
    owner: 'enemy', hex: offsetToAxial(s.col, s.row),
  }));
  neutralSlots.forEach((s, i) => sites.push({
    id: `n${i}`, kind: 'farm', owner: 'neutral', hex: offsetToAxial(s.col, s.row),
  }));

  return { blocked: pickBlocked(rng, cols, rows, sites), sites, adjacency: nearestGraph(sites) };
}

const hexDist = (a, b) =>
  (Math.abs(a[0] - b[0]) + Math.abs(a[0] + a[1] - b[0] - b[1]) + Math.abs(a[1] - b[1])) / 2;

/** Chokepoints: a sparse scatter that never touches a site or its ring, so the
 *  site graph stays reachable no matter what the seed rolls. */
function pickBlocked(rng, cols, rows, sites) {
  const near = new Set();
  for (const s of sites) {
    for (let dq = -1; dq <= 1; dq++) {
      for (let dr = -1; dr <= 1; dr++) near.add(`${s.hex[0] + dq},${s.hex[1] + dr}`);
    }
  }
  const open = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const h = offsetToAxial(col, row);
      if (!near.has(`${h[0]},${h[1]}`)) open.push(h);
    }
  }
  const want = Math.min(open.length, Math.floor(cols * rows * FALLBACK_MAP.blockedFrac));
  const taken = new Set();
  for (let g = 0; taken.size < want && g < want * 8; g++) taken.add(rng.int(0, open.length));
  return [...taken].map((i) => open[i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Nearest-N graph, then a union-find pass that stitches any stranded component
 *  to its closest neighbour. Sends go to adjacent sites only, so a disconnected
 *  site graph is an unwinnable battle: this makes that impossible. */
function nearestGraph(sites) {
  const edges = new Set();
  const parent = new Map(sites.map((s) => [s.id, s.id]));
  const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  const link = (a, b) => {
    edges.add(a < b ? `${a} ${b}` : `${b} ${a}`);
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const a of sites) {
    sites.filter((b) => b.id !== a.id)
      .sort((x, y) => hexDist(a.hex, x.hex) - hexDist(a.hex, y.hex) || (x.id < y.id ? -1 : 1))
      .slice(0, FALLBACK_MAP.degree)
      .forEach((b) => link(a.id, b.id));
  }
  for (let guard = 0; guard < sites.length; guard++) {
    if (new Set(sites.map((s) => find(s.id))).size <= 1) break;
    let best = null;
    for (const a of sites) {
      for (const b of sites) {
        if (find(a.id) === find(b.id)) continue;
        const d = hexDist(a.hex, b.hex);
        const tie = best && d === best.d && `${a.id}${b.id}` < `${best.a}${best.b}`;
        if (!best || d < best.d || tie) best = { d, a: a.id, b: b.id };
      }
    }
    if (!best) break;
    link(best.a, best.b);
  }
  return [...edges].sort().map((e) => e.split(' '));
}

/** Fill in every field the contract requires, whoever generated the layout.
 *  An injected mapGen may set hp/garrison itself; anything it omits lands here. */
export function normalizeSites(raw, mult) {
  return raw.map((s, i) => {
    const level = Math.max(1, Math.min(SITE_LEVELS.length, s.level ?? 1));
    const spec = SITES[s.kind] ?? SITES.farm;
    const lv = SITE_LEVELS[level - 1];
    const hpMax = s.hpMax ?? spec.hp * lv.hp;
    const base = s.owner === 'enemy' ? BASE_GARRISON[s.kind] ?? {}
      : s.owner === 'neutral' ? NEUTRAL_GARRISON
        : (s.kind === 'camp' ? BASE_GARRISON.camp : PLAYER_SITE_GARRISON);
    const garrison = s.garrison ?? (s.owner === 'enemy'
      ? scaleGarrison(base, mult ** ENEMY_SCALING.garrison)
      : { ...base });
    return {
      id: s.id ?? `s${i}`,
      kind: s.kind,
      owner: s.owner,
      hex: [s.hex[0], s.hex[1]],
      level,
      garrison,
      hp: s.hp ?? hpMax,
      hpMax,
      hpRegen: s.hpRegen ?? spec.hpRegen * lv.regen,
      trainType: s.trainType ?? (s.owner === 'enemy' ? 'spearmen' : 'militia'),
    };
  });
}

/**
 * Call the injected generator. The context carries the same facts under BOTH
 * naming conventions ({grid, siteCounts} and flat {cols, rows, *Sites}) and is
 * passed with `seed` as a second argument, so battle/mapgen.js's
 * `generateBattleMap(regionSpec, seed)` is a drop-in with no adapter, and so is
 * anything preferring a single ctx. The return normalises the same way:
 * `blocked` may sit at the top level or inside `grid`.
 */
export function callMapGen(mapGen, { region, seed, mult, isRaid }) {
  const { grid, siteCounts } = region;
  const ctx = {
    region, grid, siteCounts, seed, isRaid, enemyMult: mult, tier: region.tier,
    cols: grid.cols, rows: grid.rows, playerSites: siteCounts.player,
    enemySites: siteCounts.enemy, neutralSites: siteCounts.neutral,
    rng: createRng(seed),
  };
  const gen = (typeof mapGen === 'function' ? mapGen : fallbackMapGen)(ctx, seed);
  if (!gen || !Array.isArray(gen.sites)) {
    throw new TypeError('mapGen must return { sites, adjacency, blocked | grid.blocked }');
  }
  return {
    sites: gen.sites,
    adjacency: gen.adjacency ?? [],
    blocked: gen.blocked ?? gen.grid?.blocked ?? [],
  };
}

