// The sea in battle (PLAN-PHASE12 §12A/§12B): what the battle scene draws and says for harbours, sea lanes, the Tide Fortress's Tide and
// sea reinforcements, and the Admiral's Broadside. Drawing lives in render/seaMarks.js and render/seaFx.js; the sim in battle/sea.js.
//
//   const sea = createBattleSea(deps);  sea.reset(battle)
//   sea.onEvent(ev, nowMs)     tideRising, tideFlood, tideEbb, tideHit, seaReinforce, broadsideHit; LOOKS at a broadside `ability` and a
//                              lane `send`. Returns true only for the events it alone handles.
//   sea.drawGround(t, nowMs)   under the settlements: piers at the ports, the lanes, the Tide's telegraph and the flooded fords
//   sea.drawAir(t, nowMs)      over the squads: Broadside's muzzle flashes, the loss pops
//   sea.info()                 for the checks
import { TIDE } from '../config/sea.js';
import { PLAYER_OWNER } from '../battle/owner.js';
import { laneRoute } from '../battle/sea.js';
import { tileAt } from '../battle/runtime.js';
import { drawHarbour, drawSeaLane } from '../render/seaMarks.js';
import { drawTideRing, drawFloodTile, drawBroadsideHit, SEA_FX } from '../render/seaFx.js';
import { factionColor, factionColorLight, rgba } from '../render/palette.js';
import { elevOffset } from '../render/tiles.js';

const POP_MS = 500;
const TIDE_MERGE = Object.freeze({ ms: 600, hexes: 3 }); // presentation only: Tide-loss pops this close in time and space merge
const FLASH_MS = 520;

/**
 * @param {{ camera: object, renderer: object, sfx: object, ctx: CanvasRenderingContext2D, reduceMotion: () => boolean,
 *   siteWorldPos: (site) => {x:number,y:number} }} deps
 */
export function createBattleSea(deps) {
  const { camera, renderer, sfx, ctx, reduceMotion } = deps;
  let battle = null;
  let telegraph = null; // { from, at, tiles } battle seconds
  let flood = null;     // { from, until, tiles }
  let flashes = [];     // { x, y, born } world, ms
  let pops = new Map();
  let ports = [];       // { site, dx, dy } where each port's pier points
  let stats = null;

  const pos = (siteId) => { const s = battle && battle.sites[siteId]; return s ? deps.siteWorldPos(s) : null; };
  const has = () => !!(battle && battle.arena && battle.arena.sea);

  function seaDir(site) {
    const t0 = tileAt(battle, site.tile);
    const sea = battle.arena.sea;
    let dx = 0; let dy = 0;
    for (const l of sea.lanes || []) {
      const first = l.a === site.id ? l.tiles[0] : l.b === site.id ? l.tiles[l.tiles.length - 1] : null;
      const t = first != null ? tileAt(battle, first) : null;
      if (t && t0) { dx += t.x - t0.x; dy += t.y - t0.y; }
    }
    if (!dx && !dy) { dx = 0.6; dy = 0.8; }
    const len = Math.hypot(dx, dy);
    return { dx: dx / len, dy: dy / len };
  }

  function reset(b) {
    battle = b;
    telegraph = null; flood = null; flashes = []; pops = new Map(); ports = [];
    stats = { risings: 0, floods: 0, hits: 0, lost: 0, reinforced: 0, broadsides: 0, broadsideLost: 0, laneSends: 0 };
    if (!has()) return;
    ports = b.sites.filter((s) => s.port).map((s) => ({ site: s.id, ...seaDir(s) }));
    // a battle resumed mid-telegraph or mid-flood: draw them again from the sim's own tide state
    const tide = b.arena.sea.tide;
    const st = b.sea && b.sea.tide;
    if (tide && st && !st.done) {
      if (st.warned) telegraph = { from: st.nextAt - TIDE.telegraphSec, at: st.nextAt, tiles: tide.tiles.slice() };
      if (st.floodUntil > b.t) flood = { from: st.floodUntil - TIDE.floodSec, until: st.floodUntil, tiles: tide.tiles.slice() };
    }
  }

  function pop(key, site, n, text, color, nowMs) {
    const p = pops.get(key);
    if (p) { p.n += n; return; }
    pops.set(key, { n, first: nowMs, site, text, color });
  }
  function flushPops(nowMs) {
    for (const [key, p] of pops) {
      if (nowMs - p.first < (p.wait || POP_MS)) continue;
      pops.delete(key);
      const c = p.site != null ? pos(p.site) : p.at;
      if (c) renderer.fx.spawn('floatText', c.x, c.y - (p.lift || 0.6), { text: p.text(p.n), color: p.color, size: p.size || 0.34 });
    }
  }

  function onEvent(ev, nowMs) {
    if (!has()) return false;
    const fx = renderer.fx;
    switch (ev.type) {
      case 'tideRising': {
        stats.risings += 1;
        telegraph = { from: battle.t, at: ev.at, tiles: ev.tiles || [] };
        fx.spawn('floatText', ev.x, ev.y - 1.0, { text: 'The tide rises…', color: SEA_FX.warn, size: 0.36 });
        sfx.play('reveal', { pitch: 0.7, volume: 0.45 });
        return true;
      }
      case 'tideFlood': {
        stats.floods += 1;
        telegraph = null;
        flood = { from: battle.t, until: ev.until, tiles: ev.tiles || [] };
        const rm = reduceMotion();
        for (const i of flood.tiles) {
          const t = tileAt(battle, i);
          if (!t) continue;
          fx.spawn('ripple', t.x, t.y, { color: SEA_FX.foam });
          if (!rm) fx.spawn('sparks', t.x, t.y, { count: 4, color: SEA_FX.foam, dustCount: 0 });
        }
        fx.spawn('floatText', ev.x, ev.y - 1.0, { text: 'The Tide!', color: SEA_FX.warn, size: 0.44 });
        fx.shake(0.18, 0.35);
        sfx.play('lost', { pitch: 1.3, volume: 0.45 });
        return true;
      }
      case 'tideEbb': flood = null; telegraph = null; return true;
      case 'tideHit': {
        stats.hits += 1; stats.lost += ev.lost || 0;
        // one pop per wave: Tide losses within TIDE_MERGE.hexes of a pop still gathering (TIDE_MERGE.ms) add to it, so a flooded column of
        // squads reads "−96 swept away" once instead of a stack of overlapping numbers
        const color = ev.owner === PLAYER_OWNER ? '#ff8a7a' : SEA_FX.warn;
        let key = null;
        for (const [k, p] of pops) if (k.startsWith('t:') && p.color === color && Math.hypot(p.at.x - ev.x, p.at.y - ev.y) <= TIDE_MERGE.hexes * Math.sqrt(3)) { key = k; break; }
        if (!key) { key = `t:${nowMs}:${ev.squad}`; pops.set(key, { n: 0, first: nowMs, site: null, at: { x: ev.x, y: ev.y }, text: (n) => `−${n} swept away`, color, wait: TIDE_MERGE.ms, size: 0.44, lift: 1.0 }); }
        pops.get(key).n += ev.lost || 0;
        fx.spawn('ripple', ev.x, ev.y, { color: SEA_FX.foam });
        return true;
      }
      case 'seaReinforce': {
        stats.reinforced += ev.count || 0;
        const c = pos(ev.to) || { x: ev.x, y: ev.y };
        fx.spawn('ripple', ev.x, ev.y, { color: factionColorLight(battle.arena.enemyFaction) });
        pop(`r:${ev.to}`, ev.to, ev.count || 0, (n) => `+${n} by sea`, factionColorLight(battle.arena.enemyFaction), nowMs);
        void c;
        return true;
      }
      case 'broadsideHit': {
        stats.broadsideLost += ev.count || 0;
        flashes.push({ x: ev.x, y: ev.y, born: nowMs });
        pop(`b:${ev.site}`, ev.site, ev.count || 0, (n) => `−${n}`, SEA_FX.shot, nowMs);
        return true;
      }
      case 'ability': {
        if (ev.ability !== 'broadside') return false;
        stats.broadsides += 1;
        for (const id of ev.sites || []) { const c = pos(id); if (c) flashes.push({ x: c.x, y: c.y, born: nowMs + Math.random() * 300 }); }
        sfx.play('fireball', { pitch: 1.4, volume: 0.5 });
        fx.shake(0.22, 0.4);
        return false; // the shared ability fx and banner still play
      }
      case 'send': if (ev.lane) stats.laneSends += 1; return false;
      default: return false;
    }
  }

  // --- drawing ------------------------------------------------------------------------------------------------------------------
  function lanePts(lane) {
    const a = battle.sites[lane.a]; const b = battle.sites[lane.b];
    const pts = [];
    const ta = a && tileAt(battle, a.tile); const tb = b && tileAt(battle, b.tile);
    if (ta) pts.push(camera.worldToScreen(ta.x, ta.y - elevOffset(ta, 1)));
    for (const i of lane.tiles) { const t = tileAt(battle, i); if (t) pts.push(camera.worldToScreen(t.x, t.y)); }
    if (tb) pts.push(camera.worldToScreen(tb.x, tb.y - elevOffset(tb, 1)));
    return pts;
  }

  function drawGround(t, nowMs) {
    if (!has()) return;
    const still = reduceMotion();
    const tm = still ? undefined : t;
    const bt = battle.t;
    const z = camera.zoom;
    // the lanes: bright in your colour when you can sail them, in the raider's when its longships can, faint otherwise
    const foe = battle.arena.enemyFaction;
    for (const l of battle.arena.sea.lanes || []) {
      const mine = !!laneRoute(battle, PLAYER_OWNER, l.a, l.b);
      const theirs = !mine && !!laneRoute(battle, foe, l.a, l.b);
      const color = mine ? factionColorLight(PLAYER_OWNER) : theirs ? factionColor(foe) : rgba('#d8eef2', 0.9);
      drawSeaLane(ctx, lanePts(l), color, mine || theirs ? tm : undefined, { dim: !mine && !theirs, width: Math.max(1.6, z * 0.05) });
    }
    // piers at the ports, boats in the holder's colour
    for (const p of ports) {
      const s = battle.sites[p.site];
      const c = s && pos(p.site);
      if (!c) continue;
      const q = camera.worldToScreen(c.x + p.dx * 0.72, c.y + p.dy * 0.62);
      drawHarbour(ctx, q.x, q.y, z * 0.7, p.dx, p.dy, factionColor(s.owner), tm, { boats: 1 });
    }
    // the Tide: a rising ring on every ford that will flood, then the flood itself
    if (flood && bt <= flood.until) {
      const span = Math.max(0.1, flood.until - flood.from);
      for (const i of flood.tiles) {
        const tile = tileAt(battle, i);
        if (!tile) continue;
        const sc = camera.worldToScreen(tile.x, tile.y);
        drawFloodTile(ctx, sc.x, sc.y, z, (flood.until - bt) / span, t, still);
      }
    } else if (flood) flood = null;
    if (telegraph) {
      if (bt > telegraph.at + 0.4) telegraph = null;
      else {
        const k = Math.max(0, Math.min(1, (bt - telegraph.from) / Math.max(0.1, telegraph.at - telegraph.from)));
        for (const i of telegraph.tiles) {
          const tile = tileAt(battle, i);
          if (!tile) continue;
          const sc = camera.worldToScreen(tile.x, tile.y);
          drawTideRing(ctx, sc.x, sc.y, z * 0.62, k, t, still);
        }
      }
    }
  }

  function drawAir(t, nowMs) {
    if (!has()) return;
    flushPops(nowMs);
    if (!flashes.length) return;
    const keep = [];
    for (const f of flashes) {
      const age = nowMs - f.born;
      if (age < 0) { keep.push(f); continue; }
      if (age > FLASH_MS) continue;
      keep.push(f);
      const sc = camera.worldToScreen(f.x, f.y - 0.3);
      drawBroadsideHit(ctx, sc.x, sc.y, camera.zoom * 0.5, age / FLASH_MS);
    }
    flashes = keep.slice(-40);
  }

  function info() {
    if (!battle) return null;
    return {
      ...(stats || {}), sea: has(), ports: ports.length, lanes: has() ? (battle.arena.sea.lanes || []).length : 0,
      tide: has() && battle.arena.sea.tide ? { tiles: battle.arena.sea.tide.tiles.length, harbour: battle.arena.sea.tide.harbour } : null,
      telegraph: telegraph ? { at: telegraph.at, tiles: telegraph.tiles.length } : null, flooded: flood ? flood.tiles.length : 0,
      laneSquads: battle.squads.filter((q) => q.lane).length,
      fordSquads: battle.squads.filter((q) => { const p = q.path && q.path[Math.min(q.seg, q.path.length - 1)]; const tl = p != null && tileAt(battle, p); return !!(tl && tl.ford); }).length,
    };
  }

  return { reset, onEvent, drawGround, drawAir, info };
}
