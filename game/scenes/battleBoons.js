// Boons in battle (PLAN-PHASE7 §7A; docs/briefs/phase7-hookup.md §5): the sim's `boonTriggered` events become small icon pops (the Boon's own mark in a
// dark disc, with "+N" where it has a number) that rise a little and fade, and Scorched Earth's ground burns like the Firestorm's. Kept small and readable:
// at most MAX_POPS at once, the same Boon at the same place merges into one pop (its number adds up), nothing at all for a Boon the player cannot see.
//
//   const boons = createBattleBoons(deps);  boons.reset(battle)
//   boons.onEvent(ev, nowMs)   consumes `boonTriggered` (returns true); ignores everything else
//   boons.drawGround(t)        Scorched Earth's ground, from the sim's own record (battle.boonFx.scorch): a reload draws it again
//   boons.drawAir(t, nowMs)    the pops
//   boons.info()               for the checks: { triggered: { [boon]: n }, pops, scorch }
import { icon } from '../ui/icons.js';
import { BOON_ICONS } from '../app/boons.js';
import { drawBurnGround } from '../render/ashenFx.js';
import { hexRadiusToWorld } from '../battle/geom.js';

const MAX_POPS = 6;
const LIFE_MS = 1500;
const MERGE_MS = 700;
const BADGE_PX = 22;

// what a pop says (short), from the event; null = the icon alone
const WORDS = {
  warlordsMark: (ev) => (ev.count > 0 ? `×2 +${Math.round(ev.count)}` : '×2'),
  turncoats: (ev) => (ev.count > 0 ? `+${Math.round(ev.count)} join` : null),
  ghostLegion: (ev) => (ev.count > 0 ? `+${Math.round(ev.count)} join` : null),
  hitAndRun: () => 'Hit and Run',
  lightningWar: () => 'March −5 s',
  bloodPrice: (ev) => (ev.count > 0 ? `−${Math.round(ev.count)}` : null),
  plunderers: () => 'Plunder',
  secondWind: (ev) => (ev.count > 0 ? `Holds! +${Math.round(ev.count)}` : 'Holds!'),
  martyrsCrown: () => "Martyr's Crown",
  bannerBearer: () => 'Ability ready',
  // Phase 8 (docs/briefs/phase8-hookup.md §2)
  vanguard: (ev) => (ev.count > 0 ? `Vanguard +${Math.round(ev.count)}` : 'Vanguard'),
  thunderCharge: (ev) => (ev.count > 0 ? `Charge +${Math.round(ev.count)}` : 'Charge'),
  supplyWagons: (ev) => (ev.count > 0 ? `+${Math.round(ev.count)}` : null),
  warDrums: () => 'War Drums',
  towerSappers: () => 'Sapped',
  lastStand: () => 'Last Stand',
};
const COLORS = { bloodPrice: '#ff8a9a', martyrsCrown: '#ff9ab8', scorchedEarth: '#ffb070', fireArrows: '#ffb070', lastStand: '#a8d8ff', towerSappers: '#e8c79a' };

/** An icon as a canvas image (white glyph), built once per name from the UI kit's SVG. */
const images = new Map();
function iconImage(name) {
  if (images.has(name)) return images.get(name);
  const svg = icon(name, 48);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('fill', '#fff4d6');
  const markup = svg.outerHTML.replace(/currentColor/g, '#fff4d6');
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  images.set(name, img);
  return img;
}

/**
 * @param {{ camera: object, ctx: CanvasRenderingContext2D, reduceMotion: () => boolean, ui?: object, sfx?: object }} deps
 */
export function createBattleBoons(deps) {
  const { camera, ctx, reduceMotion } = deps;
  let battle = null;
  let pops = []; // { key, boon, x, y, count, born, text }
  let triggered = {};

  function reset(b) {
    battle = b;
    pops = [];
    triggered = {};
  }

  function onEvent(ev, nowMs) {
    if (!ev || ev.type !== 'boonTriggered') return false;
    const boon = ev.boon;
    triggered[boon] = (triggered[boon] || 0) + 1;
    if (boon === 'bannerBearer') {
      const btn = deps.ui && deps.ui.battleHud && deps.ui.battleHud.el.querySelector('.battle-ability');
      if (btn && !reduceMotion()) { btn.classList.remove('is-boon-ready'); void btn.offsetWidth; btn.classList.add('is-boon-ready'); }
    }
    if (!Number.isFinite(ev.x) || !Number.isFinite(ev.y)) return true;
    const key = `${boon}:${ev.site ?? ''}:${Math.round(ev.x * 2)}:${Math.round(ev.y * 2)}`;
    const old = pops.find((p) => p.key === key && nowMs - p.born < MERGE_MS);
    if (old) { old.count += ev.count || 0; old.text = (WORDS[boon] || (() => null))({ ...ev, count: old.count }); return true; }
    if (pops.length >= MAX_POPS) pops.shift();
    pops.push({ key, boon, x: ev.x, y: ev.y, count: ev.count || 0, born: nowMs, text: (WORDS[boon] || (() => null))(ev) });
    deps.sfx?.play('click', { pitch: 1.6, volume: 0.25 });
    return true;
  }

  function drawGround(t) {
    const list = battle && battle.boonFx && Array.isArray(battle.boonFx.scorch) ? battle.boonFx.scorch : [];
    if (!list.length) return;
    const still = reduceMotion();
    for (const z of list) {
      if (battle.t > z.until) continue;
      const s = camera.worldToScreen(z.x, z.y);
      const r = (z.r > 0 && z.r < 20 ? z.r : hexRadiusToWorld(2)) * camera.zoom;
      drawBurnGround(ctx, s.x, s.y, r, Math.min(1, (z.until - battle.t) / 3 + 0.25), t, still);
    }
  }

  function drawAir(t, nowMs) {
    if (!pops.length) return;
    const still = reduceMotion();
    pops = pops.filter((p) => nowMs - p.born < LIFE_MS);
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '800 12px Nunito, system-ui, sans-serif';
    for (const p of pops) {
      const k = (nowMs - p.born) / LIFE_MS;
      const a = k < 0.12 ? k / 0.12 : k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1;
      const s = camera.worldToScreen(p.x, p.y);
      const lift = still ? 0 : 26 * Math.min(1, k * 1.6);
      const x = s.x;
      const y = s.y - 30 - lift;
      ctx.globalAlpha = a;
      const r = BADGE_PX / 2;
      ctx.fillStyle = 'rgba(14, 18, 28, 0.88)';
      ctx.strokeStyle = COLORS[p.boon] || '#ffd86b';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const img = iconImage(BOON_ICONS[p.boon] || 'boonCard');
      if (img.complete && img.naturalWidth) ctx.drawImage(img, x - r + 4, y - r + 4, BADGE_PX - 8, BADGE_PX - 8);
      if (p.text) {
        const w = ctx.measureText(p.text).width;
        ctx.fillStyle = 'rgba(14, 18, 28, 0.78)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x + r + 2, y - 9, w + 10, 18, 9); else ctx.rect(x + r + 2, y - 9, w + 10, 18);
        ctx.fill();
        ctx.fillStyle = COLORS[p.boon] || '#ffe7a0';
        ctx.fillText(p.text, x + r + 7, y + 0.5);
      }
    }
    ctx.restore();
  }

  function info() {
    const scorch = battle && battle.boonFx && Array.isArray(battle.boonFx.scorch) ? battle.boonFx.scorch.filter((z) => battle.t <= z.until).length : 0;
    return { triggered: { ...triggered }, pops: pops.length, scorch };
  }

  return { reset, onEvent, drawGround, drawAir, info };
}
