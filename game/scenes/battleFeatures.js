// A varied map in battle (DESIGN 10.13; docs/briefs/phase3-hookup.md §2): what the battle scene draws and says for a fight's twist,
// its feature sites and the Dragon. The scene calls this controller; the drawing itself lives in render/battleFeatures.js.
//
//   const feat = createBattleFeatures(deps);  feat.reset(battle, world, regionId)
//   feat.onEvent(ev, nowMs)            shrines, dragon*, the Gate's capture, a power refused on Holy Ground
//   feat.drawGround(t, nowMs)          under the settlements: high water, Night's tower reach, Shrine rings, the Dragon's warning
//   feat.drawAir(t, nowMs)             over the squads: the Dragon, its health, its breath
//   feat.drawWeather(t)                last, over the field: Night's shade, the Blizzard's snow
//   feat.badgeLabel(site)              '?' for a garrison Night hides, else null
//   feat.hud()                         the HUD's feature line (battleHud update({ feature }))
//   feat.powerFlags(id)                { holy, boost } for a power button
//   feat.spriteType(site)              the sprite to draw ('ancientTower' for the Ruins' tower)
//   feat.noRouteText(siteId)           "No route: take the Gate first" for a keep a Gate still shuts, else null
import { FEATURES } from '../config/features.js';
import { SITE_TYPES } from '../config/battle.js';
import { PLAYER_OWNER } from '../battle/owner.js';
import { hexRadiusToWorld } from '../battle/geom.js';
import { tileOwner as simTileOwner } from '../battle/territory.js';
import { towerRangeMult, gateBlocks } from '../battle/features.js';
import { isScoutedOrFree } from '../meta/intel.js';
import { factionColor, ACCENTS } from '../render/palette.js';
import { elevOffset } from '../render/tiles.js';
import {
  drawFloodWater, drawRangeRing, drawShrineRing, drawTelegraph, drawDragon, drawDragonHp, drawBreath, drawNightShade, drawSnow, drawSiteTag, drawPadlock,
} from '../render/battleFeatures.js';

const D = FEATURES.dragon;
const TWIST_LINE = Object.freeze({ // the HUD's line for a twist with nothing to count (copy: the twist's name, then what it does in a few words)
  night: 'Night: garrisons hidden until scouted',
  blizzard: 'Blizzard: slow marches, fiercer Firestorm',
  flooded: 'Flooded: cross rivers on the bridges',
  holy: 'Holy Ground: no powers',
});

/**
 * @param {{ ctx: CanvasRenderingContext2D, camera: object, renderer: object, sfx: object, ui: object, container: object,
 *   reduceMotion: () => boolean, tutorial: object, ownerFaction: (owner:number) => number, siteWorldPos: (site) => {x,y},
 *   playerFaction: number }} deps
 */
export function createBattleFeatures(deps) {
  const { ctx, camera, renderer, sfx, ui, container, reduceMotion, tutorial } = deps;
  let battle = null;
  let world = null;
  let regionId = null;
  let shrines = null; // the last `shrines` event: { held, total, sec, need }
  let gateDown = false;
  let breath = null; // { x1, y1 (world, the jaws), x2, y2, at (ms) } the flame stream being drawn
  let hitFlashUntil = 0;
  let fall = null; // { x, y, atMs, fled } the Dragon's fall
  let adjacentCache = { at: -1e9, hidden: new Set() };
  let siteNeighbours = new Map(); // site id -> arena tile indices around it (Night's "adjacent to your land")
  let toldHoly = false;
  let lastAir = null; // { world, facing, flying } where the Dragon was last drawn (its fall starts there: the sim has already taken its perch away)

  const twist = () => (battle && battle.arena && battle.arena.twist) || null;
  const hasDragon = () => !!(battle && battle.dragon);

  function reset(b, w, rid) {
    battle = b; world = w; regionId = rid;
    shrines = null; gateDown = !b.sites.some((s) => s.type === 'gate' && s.owner !== PLAYER_OWNER) && b.sites.some((s) => s.type === 'gate');
    breath = null; hitFlashUntil = 0; fall = null; toldHoly = false; lastAir = null;
    adjacentCache = { at: -1e9, hidden: new Set() };
    siteNeighbours = new Map();
    if (twist() === 'night') {
      const byKey = new Map(b.arena.tiles.map((t) => [`${t.q},${t.r}`, t.i]));
      const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
      for (const s of b.sites) {
        const t = b.arena.tiles.find((x) => x.i === s.tile);
        if (!t) continue;
        siteNeighbours.set(s.id, DIRS.map(([dq, dr]) => byKey.get(`${t.q + dq},${t.r + dr}`)).filter((i) => i != null));
      }
    }
  }

  const worldPos = (site) => deps.siteWorldPos(site);
  const screenOf = (p) => camera.worldToScreen(p.x, p.y);
  const lifted = (x, y) => {
    // a raw world point from an event (dragon / breath): lift it by the nearest arena tile's elevation, like the sites
    let best = null; let bd = Infinity;
    for (const t of battle.arena.tiles) { const d = (t.x - x) ** 2 + (t.y - y) ** 2; if (d < bd) { bd = d; best = t; } }
    const wt = best ? world.tiles[best.i] : null;
    return { x, y: y - (wt ? elevOffset(wt, 1) : 0) };
  };

  // --- events ---------------------------------------------------------------------------------------------------------
  function onEvent(ev, nowMs) {
    const fx = renderer.fx;
    switch (ev.type) {
      case 'shrines': {
        const before = shrines;
        shrines = { held: ev.held, total: ev.total, sec: ev.sec, need: ev.need };
        if (ev.held === ev.total) tutorial.notify('shrinesHeld');
        if (!before || before.held !== ev.held) {
          if (ev.held === ev.total) { sfx.play('upgrade', { pitch: 1.15, volume: 0.6 }); ui.toasts.update({ id: 'shrines', type: 'info', icon: 'star', message: `All ${ev.total} Shrines are yours: hold them for ${Math.round(ev.need)} s`, duration: 2600 }); }
          else if (before && ev.held < before.held && before.held === before.total) ui.toasts.update({ id: 'shrines', type: 'warning', icon: 'flag', message: 'A Shrine was lost: the hold starts again', duration: 2400 });
        }
        break;
      }
      case 'capture': {
        const site = battle.sites[ev.site];
        if (site && site.type === 'gate' && ev.to === PLAYER_OWNER) {
          gateDown = true;
          tutorial.notify('gateTaken');
          const p = worldPos(site);
          fx.spawn('shockwave', p.x, p.y, { color: '#e7dcc2', growth: 3.2, duration: 0.7, thickness0: 0.14, thickness1: 0.02 });
          fx.spawn('smoke', p.x, p.y, { count: 10, spread: 0.7 });
          fx.spawn('dust', p.x, p.y, { count: 16 });
          fx.spawn('floatText', p.x, p.y - 0.9, { text: 'The Gate falls!', color: '#ffe6a8', size: 0.5 });
          fx.shake(0.8, 0.5);
          sfx.play('capture', { pitch: 0.7 });
          ui.toasts.update({ id: 'gate', type: 'success', icon: 'castle', message: 'Gate breached: storm the keep!', duration: 2600 });
        }
        break;
      }
      case 'refused':
        if (ev.reason === 'holy' && ev.owner === PLAYER_OWNER) {
          ui.battleHud.refuse?.(ev.power);
          sfx.play('error', { volume: 0.6 });
          ui.toasts.update({ id: 'holy', type: 'warning', icon: 'lock', message: toldHoly ? 'Holy Ground: no powers here' : 'Holy Ground: powers cannot be used here. Your General’s ability still works.', duration: 2600 });
          toldHoly = true;
          return true;
        }
        break;
      case 'dragonTelegraph':
        tutorial.notify('dragonTelegraph');
        sfx.play('arrow', { pitch: 0.5, volume: 0.6 });
        break;
      case 'dragonBreath': {
        const at = lifted(ev.x, ev.y);
        const r = hexRadiusToWorld(ev.radius);
        breath = { x2: at.x, y2: at.y, atMs: nowMs };
        fx.spawn('fireBloom', at.x, at.y, { radius: r });
        fx.spawn('embers', at.x, at.y, { count: 26, spread: r * 0.55 });
        fx.spawn('smoke', at.x, at.y, { count: 6, spread: r * 0.5 });
        fx.spawn('scorch', at.x, at.y, { size: r * 0.85 });
        fx.shake(0.5, 0.35);
        sfx.play('fireball');
        break;
      }
      case 'dragonHit':
        hitFlashUntil = nowMs + 180;
        break;
      case 'dragonFly':
        sfx.play('march', { pitch: 0.6, volume: 0.6 });
        break;
      case 'dragonFall': {
        const at = lastAir || (ev.x || ev.y ? { world: lifted(ev.x, ev.y - 1.5), facing: -1, flying: false } : null);
        fall = { at, atMs: nowMs, fled: !!ev.fled };
        const p = at ? at.world : null;
        if (p) {
          renderer.fx.spawn('shockwave', p.x, p.y, { color: '#ff9a5c', growth: 4.5, duration: 0.9, thickness0: 0.16, thickness1: 0.02 });
          renderer.fx.spawn('embers', p.x, p.y, { count: 40, spread: 1.2 });
          renderer.fx.spawn('floatText', p.x, p.y - 1.4, { text: ev.fled ? 'The Dragon flees!' : 'The Dragon falls!', color: '#ffcf8a', size: 0.6 });
        }
        renderer.fx.shake(1, 0.7);
        sfx.play('victory', { pitch: 0.8, volume: 0.7 });
        break;
      }
      default: break;
    }
    return false;
  }

  // --- the Dragon's place -----------------------------------------------------------------------------------------------
  /** Where the Dragon is (world point raised over its perch, plus the ground under it), or null. */
  function dragonPlace() {
    const dr = battle && battle.dragon;
    if (!dr) return null;
    if (dr.flight) {
      const a = battle.sites[dr.flight.from] || battle.sites[dr.flight.to];
      const b = battle.sites[dr.flight.to];
      if (!a || !b) return null;
      const pa = worldPos(a); const pb = worldPos(b);
      const k = Math.max(0, Math.min(1, 1 - (dr.flight.landAt - battle.t) / D.flightSec));
      const e = k * k * (3 - 2 * k);
      const gx = pa.x + (pb.x - pa.x) * e;
      const gy = pa.y + (pb.y - pa.y) * e;
      return { ground: { x: gx, y: gy }, air: { x: gx, y: gy - 1.8 - Math.sin(Math.PI * k) * 1.6 }, flying: true, facing: pb.x >= pa.x ? 1 : -1 };
    }
    const perch = battle.sites[dr.perch];
    if (!perch) return null;
    const p = worldPos(perch);
    return { ground: p, air: { x: p.x + 0.15, y: p.y - 1.7 }, flying: false, facing: -1 };
  }


  // --- drawing ------------------------------------------------------------------------------------------------------------
  function drawGround(t, nowMs) {
    if (!battle) return;
    const tw = twist();
    const tm = reduceMotion() ? 0 : t;
    if (tw === 'flooded') drawFloodWater(ctx, camera, battle.arena.tiles, (i) => world.tiles[i], tm);
    // Night: each tower's (halved) reach on the ground, so the player sees how close it is safe to march
    if (tw === 'night') {
      const mult = towerRangeMult(battle);
      for (const s of battle.sites) {
        const range = s.range ?? (s.type === 'tower' ? SITE_TYPES.tower.range : null);
        if (!range) continue;
        const p = screenOf(worldPos(s));
        drawRangeRing(ctx, p.x, p.y, hexRadiusToWorld(range * mult) * camera.zoom, factionColor(deps.ownerFaction(s.owner)));
      }
    }
    // Raid: a ring round each Shrine in its holder's colour; once all are yours it fills with the hold
    if (tw === 'raid') {
      const all = shrines ? shrines.held === shrines.total && shrines.total > 0 : false;
      const frac = all && shrines ? shrines.sec / shrines.need : 0;
      for (const s of battle.sites) {
        if (s.type !== 'shrine') continue;
        const p = screenOf(worldPos(s));
        drawShrineRing(ctx, p.x, p.y - camera.zoom * 0.25, camera.zoom * 0.95, s.owner === PLAYER_OWNER ? factionColor(deps.playerFaction) : factionColor(deps.ownerFaction(s.owner)), frac, all, tm);
      }
    }
    // the Dragon's warning: the breath's circle filling as it nears
    const dr = battle.dragon;
    if (dr && dr.breath && !dr.dead) {
      const at = lifted(dr.breath.x, dr.breath.y);
      const p = screenOf(at);
      const k = Math.max(0, Math.min(1, 1 - (dr.breath.at - battle.t) / D.telegraphSec));
      drawTelegraph(ctx, p.x, p.y, hexRadiusToWorld(dr.breath.radius) * camera.zoom, k, tm);
    }
  }

  function drawAir(t, nowMs) {
    if (!battle || !battle.dragon) return;
    const dr = battle.dragon;
    const z = camera.zoom;
    const tm = reduceMotion() ? 0 : t;
    if (dr.dead) {
      if (!fall || !fall.at) return;
      const k = Math.min(1, (nowMs - fall.atMs) / (reduceMotion() ? 200 : 1400));
      if (k >= 1) return;
      const s = screenOf(fall.at.world);
      drawDragon(ctx, s.x, s.y + (fall.fled ? -k * z * 4 : k * z * 1.2), z, { flying: fall.fled, flap: tm * 12, facing: fall.at.facing, dead: fall.fled ? k * 0.9 : k });
      return;
    }
    const pl = dragonPlace();
    if (!pl) return;
    lastAir = { world: pl.air, facing: pl.facing, flying: pl.flying };
    const s = screenOf(pl.air);
    const g = screenOf(pl.ground);
    const bob = pl.flying ? 0 : Math.sin(tm * 2) * z * 0.04;
    drawDragon(ctx, s.x, s.y + bob, z, { flying: pl.flying, flap: tm * 11, facing: pl.facing, groundY: g.y, flash: hitFlashUntil > nowMs ? (hitFlashUntil - nowMs) / 180 : 0 });
    drawDragonHp(ctx, s.x, s.y - z * 1.75, z, dr.hp / dr.maxHp);
    if (breath) {
      const k = (nowMs - breath.atMs) / 420;
      if (k >= 1) breath = null;
      else {
        const to = screenOf({ x: breath.x2, y: breath.y2 });
        const from = { x: s.x + pl.facing * z * 1.15, y: s.y - z * 0.88 };
        drawBreath(ctx, from.x, from.y, to.x, to.y, k, z);
      }
    }
  }

  /** Over the badges (Siege): a "Gate" tag under a standing Gate, a padlock beside the keep it shuts. */
  function drawTags() {
    if (!battle || twist() !== 'siege') return;
    const z = camera.zoom;
    for (const s of battle.sites) {
      if (s.type === 'gate' && s.owner !== PLAYER_OWNER) {
        const p = screenOf(worldPos(s));
        drawSiteTag(ctx, p.x, p.y + Math.max(16, z * 0.62), 'Gate', factionColor(deps.ownerFaction(s.owner)));
      } else if (s.type === 'keep' && gateBlocks(battle, PLAYER_OWNER, s.id)) {
        const p = screenOf(worldPos(s));
        drawPadlock(ctx, p.x + Math.max(22, z * 0.66), p.y - z * 0.08, Math.max(14, z * 0.45));
      }
    }
  }

  function drawWeather(t) {
    if (!battle) return;
    const tw = twist();
    const W = renderer.cssWidth;
    const H = renderer.cssHeight;
    if (tw === 'night') drawNightShade(ctx, W, H, 1);
    else if (tw === 'blizzard') drawSnow(ctx, W, H, reduceMotion() ? 0 : t, reduceMotion());
  }

  // --- words and flags ------------------------------------------------------------------------------------------------------
  function hiddenSites() {
    const now = performance.now();
    if (now - adjacentCache.at < 250) return adjacentCache.hidden;
    const hidden = new Set();
    const { state } = container.get();
    if (twist() === 'night' && !isScoutedOrFree(state, world, regionId)) {
      for (const s of battle.sites) {
        if (s.owner === PLAYER_OWNER) continue;
        const near = siteNeighbours.get(s.id) || [];
        if (near.some((i) => simTileOwner(battle, i) === PLAYER_OWNER)) continue; // next to your land: you can see it
        hidden.add(s.id);
      }
    }
    adjacentCache = { at: now, hidden };
    return hidden;
  }

  function badgeLabel(site) {
    if (!battle || twist() !== 'night') return null;
    return hiddenSites().has(site.id) ? '?' : null;
  }

  function hud() {
    if (!battle) return null;
    const tw = twist();
    const dr = battle.dragon;
    if (dr) {
      if (dr.dead) return { kind: 'dragon', text: 'The Dragon is down', frac: 0 };
      return { kind: 'dragon', text: dr.breath ? 'Dragon: fire incoming!' : dr.flight ? 'Dragon: taking wing' : 'Dragon', frac: dr.hp / dr.maxHp };
    }
    if (tw === 'raid') {
      const total = shrines ? shrines.total : battle.sites.filter((s) => s.type === 'shrine').length;
      const held = shrines ? shrines.held : battle.sites.filter((s) => s.type === 'shrine' && s.owner === PLAYER_OWNER).length;
      const need = FEATURES.shrine.holdSec;
      if (held === total && total > 0 && shrines) return { kind: 'raid', tone: 'good', text: `Shrines ${held}/${total} · hold ${Math.max(0, Math.ceil(need - shrines.sec))} s`, frac: shrines.sec / need };
      return { kind: 'raid', text: `Hold all ${total} Shrines · ${held}/${total}`, frac: total ? held / total : 0 };
    }
    if (tw === 'siege') {
      const standing = battle.sites.some((s) => s.type === 'gate' && s.owner !== PLAYER_OWNER);
      return { kind: 'siege', tone: standing ? null : 'good', text: standing ? 'Siege: take the Gate first' : 'Gate breached: storm the keep!' };
    }
    if (TWIST_LINE[tw]) return { kind: tw, text: TWIST_LINE[tw] };
    return null;
  }

  function powerFlags(id) {
    const tw = twist();
    return { holy: tw === 'holy', boost: tw === 'blizzard' && id === 'firestorm' ? `+${Math.round((FEATURES.blizzard.firestorm - 1) * 100)}%` : null };
  }

  function spriteType(site) {
    return site.feature === 'ancientTower' ? 'ancientTower' : site.type;
  }

  function noRouteText(siteId) {
    if (!battle || twist() !== 'siege') return null;
    return gateBlocks(battle, PLAYER_OWNER, siteId) ? 'No route: take the Gate first' : null;
  }

  /** The Gate site (for the first-Siege hint's anchor), the first telegraph's centre (the Dragon hint's) and a Shrine (the Raid hint's). */
  function anchors() {
    if (!battle) return {};
    const gate = battle.sites.find((s) => s.type === 'gate' && s.owner !== PLAYER_OWNER) || null;
    const shrine = battle.sites.find((s) => s.type === 'shrine' && s.owner !== PLAYER_OWNER) || battle.sites.find((s) => s.type === 'shrine') || null;
    const dr = battle.dragon;
    const telegraph = dr && dr.breath && !dr.dead ? lifted(dr.breath.x, dr.breath.y) : null;
    return { gate, shrine, telegraph, telegraphTarget: dr && dr.breath ? dr.breath.target : null };
  }

  return { reset, onEvent, drawGround, drawAir, drawTags, drawWeather, badgeLabel, hud, powerFlags, spriteType, noRouteText, anchors, twist, hasDragon, ACCENTS };
}
