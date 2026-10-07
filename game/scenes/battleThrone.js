// The Throne of Ages in battle (PLAN-PHASE13 §13A; docs/briefs/phase13-hookup.md §4): what the battle scene draws and says for the final
// battle. Drawing lives in render/throneFx.js (and the reused render/ashenFx.js / render/seaFx.js); the sim in battle/throne.js.
//
//   const throne = createBattleThrone(deps);  throne.reset(battle)
//   throne.onEvent(ev, nowMs)   throneChampion, thronePhase, usurperBorrow, usurperField, usurperHit, usurperFell, a borrowed tideHit.
//                               Returns true only for the events it alone handles.
//   throne.drawGround(t, nowMs) under the settlements: the borrowed Tide (telegraph + flood), the Plague's ring and aura, the Rising's ash ring
//   throne.drawAir(t, nowMs, alpha)  over the squads: the Champion banners on the Gate, the Usurper-King and his health bar, his fall
//   throne.hud()                the HUD's feature line, or null when this is not the Throne
//   throne.anchors()            for the tutorial: the Gate, the next borrow's place, the Usurper
//   throne.info()               for the checks
import { THRONE } from '../config/crown.js';
import { PLAYER_OWNER } from '../battle/owner.js';
import { tileAt } from '../battle/runtime.js';
import { hexRadiusToWorld } from '../battle/geom.js';
import { icon } from '../ui/icons.js';
import { drawTideRing, drawFloodTile, SEA_FX } from '../render/seaFx.js';
import { drawAshRing, ASHEN_FX } from '../render/ashenFx.js';
import { drawChampionBanners, drawPlagueRing, drawPlagueAura, drawUsurper, drawUsurperHp, THRONE_FX } from '../render/throneFx.js';
import { factionColor } from '../render/palette.js';
import { THRONE_LINES } from '../config/leadersUsurper.js';
import { leaderFor } from '../meta/leaders.js';

const LINE_GAP_MS = 9000; // the Usurper-King's own lines on the banner: at most one this often (the borrows come every 30 s)

const B = THRONE.borrow;
// the banner and floating words for each borrowed weapon (presentation copy; the numbers are config's)
const BORROW = Object.freeze({
  rising: { banner: 'The Usurper borrows the Rising!', soon: 'The dead stir…', strike: 'The dead rise!', icon: 'skullCrown', hud: 'the Rising' },
  tide: { banner: 'The Usurper borrows the Tide!', soon: 'The tide rises…', strike: 'The Tide!', icon: 'tide', hud: 'the Tide' },
  plague: { banner: 'The Usurper borrows a Plague!', soon: 'A sickness spreads…', strike: `Plague: −${Math.round((1 - B.plagueDefMult) * 100)}% defence`, icon: 'skull', hud: 'a Plague' },
});
const CHAMPION_ICON = Object.freeze({ barrowKnight: 'skullCrown', reaverCaptain: 'trident', champion: 'sword' });
const CHAMPION_FACTION = Object.freeze({ barrowKnight: 5, reaverCaptain: 6 });

/**
 * @param {{ ctx: CanvasRenderingContext2D, camera: object, renderer: object, sfx: object, ui: object, reduceMotion: () => boolean,
 *   siteWorldPos: (site) => {x:number,y:number}, tutorial?: object }} deps
 */
export function createBattleThrone(deps) {
  const { ctx, camera, renderer, sfx, ui, reduceMotion } = deps;
  let battle = null;
  let tele = null;      // { kind, from, at, tiles?, site?, x, y, radius? } the borrow being announced (battle seconds)
  let flood = null;     // { from, until, tiles } the borrowed Tide on the approach
  let plague = null;    // { from, until, site }
  let fall = null;      // { x, y, atMs, fled }
  let lastHero = null;  // { x, y, facing } where the Usurper was last drawn (his fall starts there)
  let flashUntil = 0;
  let stats = null;
  let lastLineAt = -1e9;
  let lineN = 0;

  const has = () => !!(battle && battle.throne && battle.arena && battle.arena.throne);
  const site = (id) => (battle && id != null ? battle.sites[id] : null);
  const pos = (id) => { const s = site(id); return s ? deps.siteWorldPos(s) : null; };
  const champs = () => (has() ? battle.arena.throne.champions || [] : []);

  function reset(b) {
    battle = b;
    tele = null; flood = null; plague = null; fall = null; lastHero = null; flashUntil = 0;
    stats = { championsFell: 0, phases: [], borrows: { rising: 0, tide: 0, plague: 0 }, telegraphs: 0, tideLost: 0, field: 0, hits: 0, fell: 0 };
    ui.battleHud?.clearBanners?.();
    if (!has()) return;
    // resumed mid-borrow: draw the telegraph and the flood / plague again from the sim's own state
    const bo = b.throne.borrow || {};
    const t = b.t || 0;
    if (bo.warned && bo.next > t) tele = telegraphFor(kindOf(bo), bo.next, {});
    if (bo.tideUntil > t) flood = { from: bo.tideUntil - B.tideFloodSec, until: bo.tideUntil, tiles: (b.arena.throne.tide || []).slice() };
    if (bo.plagueUntil > t) plague = { from: bo.plagueUntil - B.plagueSec, until: bo.plagueUntil };
    if (b.throne.phase >= 2) stats.phases.push(2);
    if (b.throne.phase >= 3) stats.phases.push(3);
  }

  const kindOf = (bo) => bo.kind || B.order[(bo.n | 0) % B.order.length]; // the next weapon in turn (Rising, Tide, Plague)
  const mySites = () => battle.sites.filter((s) => s.owner === PLAYER_OWNER); // the Plague weakens every site of yours

  function telegraphFor(kind, at, ev) {
    const th = battle.arena.throne;
    if (kind === 'tide') return { kind, from: battle.t, at, tiles: (ev.tiles || th.tide || []).slice() };
    if (kind === 'plague') return { kind, from: battle.t, at };
    return { kind, from: battle.t, at, site: th.keep };
  }

  /** The Usurper-King mocks you on the leader banner (config/leadersUsurper.js THRONE_LINES); `force` for his field and his fall. */
  function taunt(key, nowMs, force) {
    const lines = THRONE_LINES[key];
    if (!lines || !lines.length || !deps.leaderLine || (!force && nowMs - lastLineAt < LINE_GAP_MS)) return;
    lastLineAt = nowMs;
    const st = deps.getState ? deps.getState() : null;
    const who = st ? leaderFor(st.seed, st.dynasty && st.dynasty.level, battle.arena.enemyFaction) : null;
    deps.leaderLine({ line: lines[lineN++ % lines.length], name: who ? who.name : '', title: who ? who.title : 'Usurper-King', faction: battle.arena.enemyFaction });
  }

  function banner(text, iconName) { ui.battleHud?.showChampionBanner?.(text, iconName ? icon(iconName, 22) : null, 'throne'); }

  function onEvent(ev, nowMs) {
    if (!has()) return false;
    const fx = renderer.fx;
    switch (ev.type) {
      case 'throneChampion': {
        stats.championsFell += 1;
        fx.spawn('shockwave', ev.x, ev.y, { color: THRONE_FX.gold, growth: 3.2, duration: 0.7, thickness0: 0.12, thickness1: 0.02 });
        fx.spawn('floatText', ev.x, ev.y - 1, { text: `The ${ev.name} has fallen!`, color: THRONE_FX.goldBright, size: 0.42 });
        fx.shake(0.4, 0.35);
        sfx.play('capture', { pitch: 0.8 });
        taunt('throneChampion', nowMs);
        banner(ev.left > 0 ? `The ${ev.name} has fallen! ${ev.left} Champion${ev.left === 1 ? '' : 's'} left` : `The ${ev.name} has fallen! The Gate stands alone`, CHAMPION_ICON[ev.kind] || 'sword');
        return true;
      }
      case 'thronePhase': {
        stats.phases.push(ev.phase);
        if (ev.phase === 2) { taunt('gateFallen', nowMs, true); banner('The Gate falls! The Usurper reaches for borrowed power', 'crownChains'); sfx.play('rally', { pitch: 0.7 }); }
        else if (ev.phase === 3) { taunt('field', nowMs, true); banner('The Usurper takes the field!', 'crownChains'); sfx.play('rally', { pitch: 0.55 }); fx.shake(0.6, 0.5); }
        return true;
      }
      case 'usurperBorrow': {
        const w = BORROW[ev.kind];
        if (!w) return true;
        if (ev.stage === 'telegraph') {
          stats.telegraphs += 1;
          tele = telegraphFor(ev.kind, ev.at, ev);
          banner(w.banner, w.icon);
          taunt(`borrow${ev.kind.charAt(0).toUpperCase()}${ev.kind.slice(1)}`, nowMs);
          const p = ev.kind === 'plague' ? (mySites()[0] ? deps.siteWorldPos(mySites()[0]) : null) : { x: ev.x, y: ev.y };
          if (p) fx.spawn('floatText', p.x, p.y - 1, { text: w.soon, color: ev.kind === 'tide' ? SEA_FX.warn : ev.kind === 'plague' ? THRONE_FX.plague : ASHEN_FX.glow, size: 0.36 });
          sfx.play('reveal', { pitch: 0.6, volume: 0.5 });
          deps.tutorial?.notify?.('usurperBorrow');
        } else if (ev.stage === 'strike') {
          stats.borrows[ev.kind] += 1;
          tele = null;
          deps.tutorial?.notify?.('usurperStrike');
          strike(ev, w);
        } else if (ev.stage === 'end') {
          if (ev.kind === 'tide') flood = null;
          if (ev.kind === 'plague') plague = null;
        }
        return true;
      }
      case 'tideHit': {
        if (!ev.borrowed) return false;
        stats.tideLost += ev.lost || 0;
        fx.spawn('ripple', ev.x, ev.y, { color: SEA_FX.foam });
        if (ev.lost) fx.spawn('floatText', ev.x, ev.y - 0.8, { text: `−${ev.lost} swept away`, color: ev.owner === PLAYER_OWNER ? '#ff8a7a' : SEA_FX.warn, size: 0.38 });
        return true;
      }
      case 'usurperField': {
        stats.field += 1;
        fx.spawn('shockwave', ev.x, ev.y, { color: THRONE_FX.wine, growth: 4, duration: 0.8, thickness0: 0.16, thickness1: 0.03 });
        fx.spawn('floatText', ev.x, ev.y - 1.6, { text: 'The Usurper-King!', color: THRONE_FX.goldBright, size: 0.5 });
        return true;
      }
      case 'usurperHit': stats.hits += 1; flashUntil = nowMs + 180; return true;
      case 'usurperFell': {
        stats.fell += 1;
        const at = lastHero || { x: ev.x, y: ev.y, facing: -1 };
        fall = { ...at, atMs: nowMs, fled: !!ev.fled };
        fx.spawn('shockwave', at.x, at.y, { color: THRONE_FX.goldBright, growth: 5, duration: 1.0, thickness0: 0.18, thickness1: 0.02 });
        fx.spawn('embers', at.x, at.y, { count: reduceMotion() ? 10 : 40, spread: 1.2 });
        fx.spawn('floatText', at.x, at.y - 1.8, { text: ev.fled ? 'The Usurper flees!' : 'The Usurper falls!', color: THRONE_FX.goldBright, size: 0.64 });
        fx.shake(1.1, 0.8);
        sfx.play('victory', { pitch: 0.75, volume: 0.8 });
        taunt('usurperFell', nowMs, true);
        const held = site(battle.arena.throne.keep)?.owner === PLAYER_OWNER;
        banner(`${ev.fled ? 'The Usurper flees!' : 'The Usurper falls!'} ${held ? 'The Throne is yours' : 'Take the keep'}`, 'crown');
        return true;
      }
      default: return false;
    }
  }

  function strike(ev, w) {
    const fx = renderer.fx;
    const rm = reduceMotion();
    if (ev.kind === 'tide') {
      flood = { from: battle.t, until: ev.until ?? battle.t + B.tideFloodSec, tiles: (ev.tiles || battle.arena.throne.tide || []).slice() };
      for (const i of flood.tiles) { const tl = tileAt(battle, i); if (tl) fx.spawn('ripple', tl.x, tl.y, { color: SEA_FX.foam }); }
      fx.shake(0.2, 0.35);
      sfx.play('lost', { pitch: 1.3, volume: 0.45 });
    } else if (ev.kind === 'plague') {
      plague = { from: battle.t, until: ev.until ?? battle.t + B.plagueSec };
      if (!rm) for (const s of mySites()) { const p = deps.siteWorldPos(s); fx.spawn('sparks', p.x, p.y, { count: 6, color: THRONE_FX.plague, dustCount: 0 }); }
      sfx.play('error', { pitch: 0.6, volume: 0.5 });
    } else {
      fx.spawn('shockwave', ev.x, ev.y, { color: ASHEN_FX.glow, growth: 3, duration: 0.7, thickness0: 0.12, thickness1: 0.02 });
      sfx.play('march', { pitch: 0.6, volume: 0.6 });
    }
    const p = ev.kind === 'plague' ? (mySites()[0] ? deps.siteWorldPos(mySites()[0]) : null) : { x: ev.x, y: ev.y };
    if (p) fx.spawn('floatText', p.x, p.y - 1, { text: w.strike, color: ev.kind === 'tide' ? SEA_FX.warn : ev.kind === 'plague' ? THRONE_FX.plague : ASHEN_FX.bone, size: 0.42 });
  }

  // --- drawing ---------------------------------------------------------------------------------------------------------------------
  function drawGround(t, nowMs) {
    if (!has()) return;
    const still = reduceMotion();
    const bt = battle.t;
    const z = camera.zoom;
    if (flood) {
      if (bt > flood.until) flood = null;
      else {
        const span = Math.max(0.1, flood.until - flood.from);
        for (const i of flood.tiles) { const tl = tileAt(battle, i); if (!tl) continue; const sc = camera.worldToScreen(tl.x, tl.y); drawFloodTile(ctx, sc.x, sc.y, z, (flood.until - bt) / span, t, still); }
      }
    }
    if (plague) {
      if (bt > plague.until) plague = null;
      else {
        const sites = mySites();
        const k = (plague.until - bt) / Math.max(0.1, plague.until - plague.from);
        for (const s of sites) { if (!s) continue; const sc = camera.worldToScreen(deps.siteWorldPos(s).x, deps.siteWorldPos(s).y); drawPlagueAura(ctx, sc.x, sc.y, z * 0.85, k, t, still); }
      }
    }
    if (tele) {
      if (bt > tele.at + 0.4) tele = null;
      else {
        const k = Math.max(0, Math.min(1, (bt - tele.from) / Math.max(0.1, tele.at - tele.from)));
        if (tele.kind === 'tide') {
          for (const i of tele.tiles) { const tl = tileAt(battle, i); if (!tl) continue; const sc = camera.worldToScreen(tl.x, tl.y); drawTideRing(ctx, sc.x, sc.y, z * 0.62, k, t, still); }
        } else if (tele.kind === 'plague') {
          for (const s of mySites()) { if (!s) continue; const p = deps.siteWorldPos(s); const sc = camera.worldToScreen(p.x, p.y); drawPlagueRing(ctx, sc.x, sc.y, z * 0.9, k, t, still); }
        } else {
          const p = pos(tele.site);
          if (p) { const sc = camera.worldToScreen(p.x, p.y); drawAshRing(ctx, sc.x, sc.y, hexRadiusToWorld(1.6) * z, k, t, still); }
        }
      }
    }
  }

  function heroSquad() {
    const u = battle.throne.usurper;
    if (!u || !u.fielded) return null;
    return battle.squads.find((q) => q.usurper) || (u.squad != null ? battle.squads.find((q) => q.id === u.squad) : null) || null;
  }

  function drawAir(t, nowMs, alpha = 1) {
    if (!has()) return;
    const z = camera.zoom;
    const still = reduceMotion();
    const tm = still ? 0 : t;
    // the Champion banners on the Gate: one per Champion, lowered when its post falls
    const gate = site(battle.arena.throne.gate);
    if (gate) {
      const list = champs().map((c) => {
        const post = site(c.site);
        return { color: factionColor(c.kind === 'champion' ? (post && post.owner !== PLAYER_OWNER ? post.owner : battle.arena.enemyFaction) : CHAMPION_FACTION[c.kind]), emblem: emblemOf(c.kind, post), down: !post || post.owner === PLAYER_OWNER };
      });
      const p = deps.siteWorldPos(gate);
      const sc = camera.worldToScreen(p.x, p.y);
      drawChampionBanners(ctx, sc.x, sc.y - z * 0.55, Math.max(26, z * 1.25), list, tm, still);
    }
    // the Usurper-King over his squad, with his health bar
    const u = battle.throne.usurper;
    const sq = heroSquad();
    const held = u && u.fielded && !u.fell && !sq && u.site != null ? site(u.site) : null; // he holds a settlement: drawn standing beside it
    if ((sq || held) && u && !u.fell) {
      const p = sq ? (renderer.units.positionOf ? renderer.units.positionOf(battle, sq.id, alpha) : null) : (() => { const w = deps.siteWorldPos(held); return { x: w.x + 0.45, y: w.y + 0.1, lift: 0, dx: -1 }; })();
      if (p) {
        const facing = p.dx < 0 ? -1 : 1;
        lastHero = { x: p.x, y: p.y - (p.lift || 0), facing };
        const sc = camera.worldToScreen(p.x, p.y - (p.lift || 0));
        const s = Math.max(30, z * 1.35);
        drawUsurper(ctx, sc.x, sc.y, s, { facing, flash: flashUntil > nowMs ? (flashUntil - nowMs) / 180 : 0, t: tm, still, step: still ? 0 : (t * 1.6) % 1 });
        drawUsurperHp(ctx, sc.x + s * 0.1, sc.y - s * 1.75, s, u.maxHp ? u.hp / u.maxHp : 0);
      }
    } else if (fall) {
      const k = Math.min(1, (nowMs - fall.atMs) / (still ? 200 : 1500));
      if (k < 1) {
        const sc = camera.worldToScreen(fall.x, fall.y);
        drawUsurper(ctx, sc.x, sc.y, Math.max(30, z * 1.35), { facing: fall.facing, dead: fall.fled ? 0 : k, still: true });
      }
    }
  }

  function emblemOf(kind, post) {
    if (kind === 'barrowKnight') return 'skullCrown';
    if (kind === 'reaverCaptain') return 'trident';
    const f = post && post.owner !== PLAYER_OWNER ? post.owner : battle.arena.enemyFaction;
    return ({ 2: 'sword', 3: 'eye', 4: 'sun' })[f] || 'sword';
  }

  // --- words -------------------------------------------------------------------------------------------------------------------------
  function hud() {
    if (!has()) return null;
    const th = battle.throne;
    if (th.phase <= 1) {
      const total = champs().length;
      const left = Number.isFinite(th.champions) ? th.champions : total;
      return left > 0
        ? { kind: 'throne', text: `${left} Champion${left === 1 ? '' : 's'} guard${left === 1 ? 's' : ''} the Gate`, frac: total ? (total - left) / total : 0 }
        : { kind: 'throne', text: 'The Champions are down: break the Gate', frac: 1 };
    }
    const u = th.usurper || {};
    if (th.phase >= 3 && u.fielded && !u.fell) return { kind: 'usurper', tone: 'bad', text: 'The Usurper-King', frac: u.maxHp ? u.hp / u.maxHp : 0 };
    if (u.fell) return { kind: 'usurper', tone: 'good', text: 'The Usurper has fallen: take the keep!' };
    const bo = th.borrow || {};
    if (tele) return { kind: 'borrow', tone: 'bad', text: `${cap(BORROW[tele.kind].hud)} in ${Math.max(0, Math.ceil(tele.at - battle.t))} s!` };
    if (flood) return { kind: 'borrow', tone: 'bad', text: 'The Tide floods the approach' };
    if (plague) return { kind: 'borrow', tone: 'bad', text: `Plague: your sites −${Math.round((1 - B.plagueDefMult) * 100)}% defence` };
    const next = BORROW[kindOf(bo)] ? BORROW[kindOf(bo)].hud : 'his next weapon';
    return { kind: 'borrow', text: `The Usurper borrows ${next}${Number.isFinite(bo.next) ? ` in ${Math.max(0, Math.ceil(bo.next - battle.t))} s` : ''}` };
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function anchors() {
    if (!has()) return {};
    const gate = site(battle.arena.throne.gate);
    const firstMine = mySites()[0];
    const telegraph = !tele ? null : tele.kind === 'tide' ? (() => { const tl = tileAt(battle, tele.tiles[0]); return tl ? { x: tl.x, y: tl.y } : null; })()
      : tele.kind === 'plague' ? (firstMine ? deps.siteWorldPos(firstMine) : null) : pos(tele.site ?? battle.arena.throne.keep);
    return { gate: gate && gate.owner !== PLAYER_OWNER ? gate : null, telegraph, usurper: lastHero && battle.throne.usurper && !battle.throne.usurper.fell ? lastHero : null };
  }

  function info() {
    if (!battle) return null;
    if (!has()) return { throne: false };
    const th = battle.throne;
    return {
      throne: true, ...stats, phase: th.phase, champions: th.champions, championPosts: champs().length,
      telegraph: tele ? { kind: tele.kind, at: tele.at } : null, telegraphPoint: anchors().telegraph || null, flooded: flood ? flood.tiles.length : 0, plague: !!plague,
      usurper: th.usurper ? { fielded: !!th.usurper.fielded, fell: !!th.usurper.fell, hp: th.usurper.hp, maxHp: th.usurper.maxHp, drawn: !!lastHero } : null,
      borrow: th.borrow ? { kind: th.borrow.kind, next: th.borrow.next, n: th.borrow.n } : null,
    };
  }

  return { reset, onEvent, drawGround, drawAir, hud, anchors, info, has };
}
