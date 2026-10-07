// The Ashen Host in battle (PLAN-PHASE6 §6B; docs/briefs/phase6-hookup.md §4): what the battle scene draws and says for The Fallen Rise,
// Firestorm burning the dead, the Barrow Keep's Rising and the Gravewarden's Raise the Fallen. Drawing lives in render/ashenFx.js.
//
//   const ashen = createBattleAshen(deps);  ashen.reset(battle)
//   ashen.onEvent(ev, nowMs)    fallenRose, fallenBurned, rising, risingCancelled; also LOOKS at (never consumes) a rising `send`, a
//                               player Firestorm and a raiseFallen `ability`. Returns true only for the events it alone handles.
//   ashen.drawGround(t, nowMs)  under the settlements: burning ground, the Rising's ash ring
//   ashen.drawAir(t, nowMs)     over the squads: the wisps
//   ashen.info()                for the checks: { risen, burned, risings, cancelled, emerged, raised, wisps, telegraph }
import { ASHEN } from '../config/ashen.js';
import { POWERS } from '../config/battle.js';
import { PLAYER_OWNER } from '../battle/owner.js';
import { hexRadiusToWorld } from '../battle/geom.js';
import { drawWisp, drawAshRing, drawBurnGround, ASHEN_FX } from '../render/ashenFx.js';
import { factionColorLight } from '../render/palette.js';
import { effects } from '../render/accessibility.js'; // Settings > Effects (PLAN-PHASE14): fewer wisps at Reduced / Minimal

const MAX_WISPS = 90;
const POP_MS = 550; // rises at one site within this window add up into one "+N risen" pop

/**
 * @param {{ camera: object, renderer: object, sfx: object, ui: object, ctx: CanvasRenderingContext2D, reduceMotion: () => boolean,
 *   siteWorldPos: (site) => {x:number,y:number}, announce?: (text:string) => void }} deps
 */
export function createBattleAshen(deps) {
  const { camera, renderer, sfx, ctx, reduceMotion } = deps;
  let battle = null;
  let wisps = []; // { x0, y0, x1, y1, lift, born (ms), life (ms), r (world), color, fade: 'in'|'up' }
  let burns = []; // { x, y, r, from, until } battle seconds (only drawn in an undying battle)
  let telegraph = null; // { site, from, at, r } battle seconds; r world units
  let pops = new Map(); // `${kind}:${site}` -> { n, first (ms), site, text, color }
  let stats = null;
  let lastRiseSfx = -1e9;

  const undying = () => !!(battle && battle.enemy && battle.enemy.personality === 'undying');
  const pos = (siteId) => { const s = battle && battle.sites[siteId]; return s ? deps.siteWorldPos(s) : null; };
  const rnd = Math.random; // presentation only (fx jitter), never the sim

  function reset(b) {
    battle = b;
    wisps = []; burns = []; telegraph = null; pops = new Map(); lastRiseSfx = -1e9;
    stats = { risen: 0, burned: 0, risings: 0, cancelled: 0, emerged: 0, raised: 0 };
    // a resumed battle mid-telegraph: draw the ring again from the saved Rising state
    const rs = b && b.fallen && b.fallen.rising;
    if (rs && rs.warned && !rs.cancelled && b.arena && b.arena.rising) {
      telegraph = { site: b.arena.rising.site, from: rs.nextAt - ASHEN.rising.telegraphSec, at: rs.nextAt, r: hexRadiusToWorld(ASHEN.rising.radius) };
    }
  }

  /** Spawns `n` wisps from points round `c` (an annulus rIn..rOut, world units) into `c` (fade 'in'), or rising off it (fade 'up'). */
  function spawnWisps(c, n, { rIn = 0.45, rOut = 1.1, color = ASHEN_FX.glow, fade = 'in', nowMs, spread = 380, life = 1300, cap = PER_SITE }) {
    const rm = reduceMotion();
    const near = wisps.reduce((k, w) => k + (Math.abs(w.x1 - c.x) < 0.3 && Math.abs(w.y1 - c.y) < 1.2 ? 1 : 0), 0);
    const k = effects().wisps;
    const count = Math.min(Math.max(0, Math.round(cap * k) - near), Math.max(1, Math.round((rm ? Math.min(n, 2) : n) * k)));
    for (let i = 0; i < count && wisps.length < MAX_WISPS * k; i++) {
      const a = rnd() * Math.PI * 2;
      const d = rIn + rnd() * (rOut - rIn);
      const x0 = c.x + Math.cos(a) * d;
      const y0 = c.y + Math.sin(a) * d * 0.7;
      const up = fade === 'up';
      wisps.push({
        x0, y0, x1: up ? x0 + (rnd() - 0.5) * 0.4 : c.x, y1: up ? y0 - 0.9 - rnd() * 0.5 : c.y - 0.05,
        lift: up ? 0.2 : 0.55 + rnd() * 0.35, born: nowMs + (rm ? 0 : rnd() * spread), life: (rm ? 0.7 : 1) * (life + rnd() * 400),
        r: 0.12 + rnd() * 0.06, color, fade,
      });
    }
  }

  function pop(key, site, n, text, color, nowMs) {
    const p = pops.get(key);
    if (p) { p.n += n; return; }
    pops.set(key, { n, first: nowMs, site, text, color });
  }
  function flushPops(nowMs) {
    for (const [key, p] of pops) {
      if (nowMs - p.first < POP_MS) continue;
      pops.delete(key);
      const c = pos(p.site);
      if (c) renderer.fx.spawn('floatText', c.x, c.y - 0.62, { text: p.text(p.n), color: p.color, size: 0.32 });
    }
  }

  function wispCount(n) { return Math.min(5, 2 + Math.round(Math.sqrt(n))); }
  // at most this many wisps in flight per site: a long assault is a steady trickle, never a blown-out white blob (additive glow)
  const PER_SITE = 9;

  function onEvent(ev, nowMs) {
    if (!battle) return false;
    const fx = renderer.fx;
    switch (ev.type) {
      case 'fallenRose': {
        const c = pos(ev.site);
        if (!c) return true;
        stats.risen += ev.count;
        if (ev.kind === 'warBand') {
          // an Ashen war band's ranks swell with the defenders it killed: wisps rise off your settlement toward the attackers
          spawnWisps(c, wispCount(ev.count), { rIn: 0, rOut: 0.35, fade: 'up', nowMs });
          pop(`w:${ev.site}`, ev.site, ev.count, (n) => `+${n} join the Host`, ASHEN_FX.glow, nowMs); // your dead swell THEIR war band
        } else if (ev.kind === 'gravewarden') {
          spawnWisps(c, wispCount(ev.count), { nowMs, color: ASHEN_FX.glow });
          pop(`g:${ev.site}`, ev.site, ev.count, (n) => `+${n} risen`, factionColorLight(0), nowMs);
        } else {
          spawnWisps(c, wispCount(ev.count), { nowMs });
          pop(`f:${ev.site}`, ev.site, ev.count, (n) => `+${n} risen`, ASHEN_FX.glow, nowMs);
        }
        if (nowMs - lastRiseSfx > 1400) { lastRiseSfx = nowMs; sfx.play('reveal', { pitch: 0.55, volume: 0.35 }); }
        return true;
      }
      case 'fallenBurned': {
        const c = pos(ev.site);
        if (!c) return true;
        stats.burned += ev.count;
        spawnWisps(c, wispCount(ev.count), { fade: 'up', color: ASHEN_FX.ember, nowMs, life: 1000 });
        fx.spawn('embers', c.x, c.y, { count: 5 });
        pop(`b:${ev.site}`, ev.site, ev.count, (n) => `${n} burned`, ASHEN_FX.ember, nowMs);
        return true;
      }
      case 'rising': {
        stats.risings += 1;
        telegraph = { site: ev.site, from: battle.t, at: ev.at, r: hexRadiusToWorld(ev.radius ?? ASHEN.rising.radius) };
        const c = pos(ev.site);
        if (c) fx.spawn('floatText', c.x, c.y - 0.95, { text: 'The dead stir…', color: ASHEN_FX.bone, size: 0.34 });
        sfx.play('reveal', { pitch: 0.42, volume: 0.5 });
        return true;
      }
      case 'risingCancelled': {
        stats.cancelled += 1;
        telegraph = null;
        const c = pos(ev.site);
        if (c) {
          fx.spawn('smoke', c.x, c.y, { count: 10, spread: 0.8 });
          fx.spawn('embers', c.x, c.y, { count: 12 });
          spawnWisps(c, 6, { rIn: 0.4, rOut: 1.2, fade: 'up', color: ASHEN_FX.ember, nowMs, life: 1100 });
          fx.spawn('floatText', c.x, c.y - 0.95, { text: 'The Rising burns!', color: ASHEN_FX.ember, size: 0.4 });
        }
        return true;
      }
      case 'send': {
        if (!ev.rising) return false;
        stats.emerged += 1;
        telegraph = null;
        const c = pos(ev.from);
        if (c) {
          fx.spawn('shockwave', c.x, c.y, { color: ASHEN_FX.glow, growth: 2.6, duration: 0.7, thickness0: 0.12, thickness1: 0.02 });
          fx.spawn('smoke', c.x, c.y, { count: 12, spread: 0.9, color: '#3a3942' });
          spawnWisps(c, 8, { rIn: 0.6, rOut: 1.4, nowMs, spread: 200, life: 900, cap: 12 });
          fx.spawn('floatText', c.x, c.y - 0.95, { text: `The dead rise! +${Math.round(ev.count)}`, color: ASHEN_FX.glow, size: 0.42 });
          fx.shake(0.25, 0.3);
        }
        sfx.play('lost', { pitch: 0.6, volume: 0.6 });
        return false; // the ordinary send handling (dust) still runs
      }
      case 'power': {
        if (ev.power === 'firestorm' && ev.owner === PLAYER_OWNER && undying()) {
          const from = battle.t + (POWERS.firestorm.delay || 0);
          burns.push({ x: ev.x, y: ev.y, r: hexRadiusToWorld(ev.radius ?? POWERS.firestorm.radius), from, until: from + ASHEN.fallen.burnSec });
        }
        return false;
      }
      case 'ability': {
        if (ev.ability !== 'raiseFallen') return false;
        const c = pos(ev.target);
        if (c && ev.count > 0) {
          stats.raised += ev.count;
          spawnWisps(c, reduceMotion() ? 3 : 14, { rIn: 1.2, rOut: 3.2, nowMs, spread: 600, life: 1500, cap: 16 });
          renderer.fx.spawn('floatText', c.x, c.y - 0.75, { text: `+${Math.round(ev.count)} raised`, color: ASHEN_FX.glow, size: 0.4 });
        }
        return false; // the shared ability fx and banner still play
      }
      default: return false;
    }
  }

  // --- drawing ----------------------------------------------------------------------------------------------------------
  function drawGround(t, nowMs) {
    if (!battle) return;
    const still = reduceMotion();
    const bt = battle.t;
    // §7C (PLAN-PHASE7): the burning ground is read from the SIM's own record (battle.fallen.burns: { x, y, r, until }, saved with the battle), so a
    // reload mid-burn draws it again; the local list only covers a Firestorm whose landing the sim has not recorded yet (its delay)
    const simBurns = undying() && battle.fallen && Array.isArray(battle.fallen.burns) ? battle.fallen.burns : [];
    if (burns.length) burns = burns.filter((b) => bt <= b.until && !simBurns.some((z) => Math.abs(z.x - b.x) < 0.05 && Math.abs(z.y - b.y) < 0.05));
    for (const z of simBurns) {
      if (bt > z.until) continue;
      const s = camera.worldToScreen(z.x, z.y);
      drawBurnGround(ctx, s.x, s.y, z.r * camera.zoom, Math.min(1, (z.until - bt) / ASHEN.fallen.burnSec), t, still);
    }
    for (const b of burns) {
      if (bt < b.from) continue;
      const s = camera.worldToScreen(b.x, b.y);
      drawBurnGround(ctx, s.x, s.y, b.r * camera.zoom, (b.until - bt) / (b.until - b.from), t, still);
    }
    if (telegraph) {
      const c = pos(telegraph.site);
      const keep = battle.sites[telegraph.site];
      if (!c || !keep || keep.owner === PLAYER_OWNER || bt > telegraph.at + 0.6) { telegraph = null; return; }
      const span = Math.max(0.1, telegraph.at - telegraph.from);
      const k = Math.max(0, Math.min(1, (bt - telegraph.from) / span));
      const s = camera.worldToScreen(c.x, c.y);
      drawAshRing(ctx, s.x, s.y, telegraph.r * camera.zoom, k, t, still);
    }
  }

  function drawAir(t, nowMs) {
    if (!battle) return;
    flushPops(nowMs);
    if (!wisps.length) return;
    const still = reduceMotion();
    const z = camera.zoom;
    const keep = [];
    for (const w of wisps) {
      const age = nowMs - w.born;
      if (age < 0) { keep.push(w); continue; }
      const u = age / w.life;
      if (u >= 1) continue;
      keep.push(w);
      const at = (v) => {
        // a lifted quadratic arc from (x0, y0) to (x1, y1), with a gentle sideways sway
        const e = w.fade === 'in' ? v * v * (3 - 2 * v) : v;
        const mx = (w.x0 + w.x1) / 2;
        const my = Math.min(w.y0, w.y1) - w.lift;
        const x = (1 - e) * (1 - e) * w.x0 + 2 * (1 - e) * e * mx + e * e * w.x1 + (still ? 0 : Math.sin((v + w.r) * 9) * 0.05);
        const y = (1 - e) * (1 - e) * w.y0 + 2 * (1 - e) * e * my + e * e * w.y1;
        return camera.worldToScreen(x, y);
      };
      const p = at(u);
      const alpha = w.fade === 'in' ? Math.min(1, u * 5) * (u > 0.85 ? (1 - u) / 0.15 : 1) : Math.min(1, u * 6) * (1 - u);
      const tail = still ? null : [0.04, 0.08, 0.12, 0.16].map((d) => { const q = at(Math.max(0, u - d)); return [q.x, q.y]; });
      drawWisp(ctx, p.x, p.y, Math.max(2, w.r * z), w.color, alpha, tail);
    }
    wisps = keep;
  }

  function info() {
    const simBurns = battle && battle.fallen && Array.isArray(battle.fallen.burns) ? battle.fallen.burns.filter((z) => battle.t <= z.until).length : 0;
    return { ...(stats || {}), wisps: wisps.length, telegraph: telegraph ? { site: telegraph.site, at: telegraph.at } : null, burns: burns.length + (undying() ? simBurns : 0), simBurns, undying: undying() };
  }

  return { reset, onEvent, drawGround, drawAir, info };
}
