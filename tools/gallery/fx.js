// Gallery/demo harness for game/audio/sfx.js and game/render/fx.js. Not part
// of the shipped game — a dev tool (docs/ARCHITECTURE.md §2) for auditioning
// every cue and every particle kind in isolation, plus the composite
// "battle event" pairings from this engineer's final report table.
//
// `window.demo(name)` is exposed for tools/pageshot.mjs screenshot automation
// (see the repo's top-level tooling notes): it accepts any scenario name,
// any bare fx kind name, or any bare sfx cue name, plus `'chaos'`.
import { createSfx } from '../../game/audio/sfx.js';
import { createFx } from '../../game/render/fx.js';
import { axialToPixel, hexCorners } from '../../game/core/hex.js';
import { shade } from '../../game/render/palette.js';

const bg = document.getElementById('bg');
const fxCanvas = document.getElementById('fx');
const shakeWrap = document.getElementById('shakeWrap');
const stage = document.getElementById('stage');
const statsEl = document.getElementById('stats');
const goldValEl = document.getElementById('goldVal');
const goldCounterEl = document.getElementById('goldCounter');

const bgCtx = bg.getContext('2d');
const fxCtx = fxCanvas.getContext('2d');
const DPR = Math.min(2, window.devicePixelRatio || 1);

const sfx = createSfx();
const fx = createFx({ maxParticles: 600 });

// ------------------------------------------------------------- fake camera
// Matches the real contract (docs/ARCHITECTURE.md §7): worldToScreen(x,y) →
// {x,y} in CSS px, zoom = CSS px per world unit (one hex ≈ 1 world unit
// centre-to-corner). Static pan/zoom is enough for a demo gallery; no drag.
const camera = {
  x: 0,
  y: 0,
  zoom: 40,
  worldToScreen(wx, wy) {
    return {
      x: bg.clientWidth / 2 + (wx - camera.x) * camera.zoom,
      y: bg.clientHeight / 2 + (wy - camera.y) * camera.zoom,
    };
  },
};

// Demo "settlements" (world units) — enough to show off directional fx
// (arrow, rally) and multi-origin ones (rally, levy) without a real world.
const camp = { x: -3.4, y: 1.1 };
const village = { x: -0.4, y: 2.6 };
const farVillage = { x: -2.6, y: -2.3 };
const keep = { x: 3.2, y: -1.0 };
const mid = { x: 0.6, y: 0.2 };
const SETTLEMENTS = [camp, village, farVillage];

function goldCounterScreenPos() {
  const stageRect = stage.getBoundingClientRect();
  const goldRect = goldCounterEl.getBoundingClientRect();
  return {
    x: goldRect.left + goldRect.width / 2 - stageRect.left,
    y: goldRect.top + goldRect.height / 2 - stageRect.top,
  };
}

// ------------------------------------------------------------ background
// "Soft green/blue terrain-ish gradient with a few hexagons drawn" — a
// placeholder, not the real renderer (which belongs to a different
// engineer's game/render/tiles.js). Painted once and on resize, not per frame.
const LAND_COLORS = ['#86b46a', '#9cc46e', '#5f9a55', '#a9b66c'];
const SHALLOW_COLOR = '#3b8fb0';

function paintBackground() {
  const w = bg.clientWidth;
  const h = bg.clientHeight;
  bg.width = Math.max(1, Math.round(w * DPR));
  bg.height = Math.max(1, Math.round(h * DPR));
  bgCtx.setTransform(DPR, 0, 0, DPR, 0, 0);

  const sky = bgCtx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#2c6c8c');
  sky.addColorStop(1, '#1f4f6e');
  bgCtx.fillStyle = sky;
  bgCtx.fillRect(0, 0, w, h);

  const r = camera.zoom * 1.02;
  for (let q = -12; q <= 12; q++) {
    for (let rr = -9; rr <= 9; rr++) {
      const { x: ax, y: ay } = axialToPixel(q, rr);
      const sx = w / 2 + (ax - camera.x) * camera.zoom;
      const sy = h / 2 + (ay - camera.y) * camera.zoom;
      if (sx < -r * 2 || sx > w + r * 2 || sy < -r * 2 || sy > h + r * 2) continue;
      const dist = Math.hypot(q, rr + q / 2);
      if (dist > 6.4) continue; // outside the island silhouette
      const shoreZone = dist > 5.2;
      const isShallow = shoreZone && Math.random() < (dist - 5.2) * 1.7;
      const base = isShallow ? SHALLOW_COLOR : LAND_COLORS[Math.abs((q * 7 + rr * 13) % LAND_COLORS.length)];
      const jittered = shade(base, (Math.random() - 0.5) * 0.12);
      const corners = hexCorners(sx, sy, r);
      bgCtx.beginPath();
      corners.forEach((p, i) => (i === 0 ? bgCtx.moveTo(p.x, p.y) : bgCtx.lineTo(p.x, p.y)));
      bgCtx.closePath();
      bgCtx.fillStyle = jittered;
      bgCtx.fill();
      bgCtx.strokeStyle = 'rgba(0,0,0,0.07)';
      bgCtx.lineWidth = 1;
      bgCtx.stroke();
    }
  }

  drawMarker(camp, '#3d7ef0', 'Camp');
  drawMarker(village, '#3d7ef0', 'Village');
  drawMarker(farVillage, '#3d7ef0', 'Village');
  drawMarker(keep, '#d8433f', 'Enemy keep');
}

function drawMarker(world, color, label) {
  const s = camera.worldToScreen(world.x, world.y);
  bgCtx.beginPath();
  bgCtx.arc(s.x, s.y, 7, 0, Math.PI * 2);
  bgCtx.fillStyle = color;
  bgCtx.fill();
  bgCtx.lineWidth = 2;
  bgCtx.strokeStyle = 'rgba(10,12,18,0.6)';
  bgCtx.stroke();
  bgCtx.font = '600 11px system-ui, sans-serif';
  bgCtx.textAlign = 'center';
  bgCtx.fillStyle = 'rgba(243,234,215,0.9)';
  bgCtx.shadowColor = 'rgba(0,0,0,0.8)';
  bgCtx.shadowBlur = 3;
  bgCtx.fillText(label, s.x, s.y + 20);
  bgCtx.shadowBlur = 0;
}

function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  fxCanvas.width = Math.max(1, Math.round(w * DPR));
  fxCanvas.height = Math.max(1, Math.round(h * DPR));
  paintBackground();
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ audio
let unlocked = false;
function ensureUnlocked() {
  if (unlocked) return;
  unlocked = true;
  sfx.unlock();
}
window.addEventListener('pointerdown', ensureUnlocked, { once: true, passive: true });
window.addEventListener('keydown', ensureUnlocked, { once: true });

// ----------------------------------------------------------------- demos
// Every fx kind, in isolation, at a spot chosen to show it off. Some pull in
// their same-named sfx cue too (arrow/fireball/rally/levy/shield↔bulwark) —
// see this engineer's final-report table for why those specific pairs.
const FX_DEMOS = {
  dust: () => fx.spawn('dust', camp.x, camp.y, {}),
  sparks: () => fx.spawn('sparks', mid.x, mid.y, {}),
  burst: () => fx.spawn('burst', village.x, village.y, { color: '#3d7ef0' }),
  shockwave: () => fx.spawn('shockwave', mid.x, mid.y, {}),
  floatText: () => fx.spawn('floatText', village.x, village.y - 0.6, { text: '+35', color: '#6fcf97' }),
  coins: () => {
    fx.spawn('coins', keep.x, keep.y, { count: 14, toScreen: goldCounterScreenPos() });
    sfx.play('coin');
  },
  embers: () => fx.spawn('embers', mid.x, mid.y, {}),
  smoke: () => fx.spawn('smoke', mid.x, mid.y, {}),
  scorch: () => fx.spawn('scorch', mid.x, mid.y, {}),
  arrow: () => {
    fx.spawn('arrow', camp.x, camp.y, { to: keep });
    sfx.play('arrow');
  },
  fireball: () => {
    // radius/telegraph both default sensibly; spelled out here for clarity.
    fx.spawn('fireball', keep.x, keep.y, { delay: 0.8, radius: 1.3, telegraph: true });
    sfx.play('fireball');
  },
  confetti: () => fx.spawn('confetti', mid.x, mid.y - 3, { count: 90 }),
  ripple: () => fx.spawn('ripple', mid.x, mid.y, {}),
  levy: () => {
    SETTLEMENTS.forEach((s) => fx.spawn('levy', s.x, s.y, {}));
    sfx.play('levy');
  },
  shield: () => {
    fx.spawn('shield', camp.x, camp.y, { duration: 3.2 });
    sfx.play('bulwark');
  },
  rally: () => {
    SETTLEMENTS.forEach((s) => fx.spawn('rally', s.x, s.y, { to: keep }));
    sfx.play('rally');
  },
  // --- round 2 additions ---
  fireBloom: () => fx.spawn('fireBloom', mid.x, mid.y, { radius: 1.3 }),
  telegraph: () => fx.spawn('telegraph', keep.x, keep.y, { radius: 1.3, duration: 1.6 }),
  flood: () => {
    // The integrator spawns one of these per tile in an outward ripple; a
    // single call only shows one tile, so the demo fakes the ripple across
    // a small ring of hexes using the SAME axial math the real world uses.
    const ring = [[0, 0], [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    ring.forEach(([q, r], i) => {
      const c = axialToPixel(q, r);
      setTimeout(() => fx.spawn('flood', village.x + c.x, village.y + c.y, { size: 0.55 }), i * 45);
    });
  },
};

// Every sfx cue, in isolation. `coin` plays three times with a pitch step
// each time to show off the per-call pitch variation the brief asks for.
const SFX_DEMOS = {
  send: () => sfx.play('send'),
  clash: () => sfx.play('clash'),
  capture: () => sfx.play('capture'),
  lost: () => sfx.play('lost'),
  arrow: () => sfx.play('arrow'),
  fireball: () => sfx.play('fireball'),
  rally: () => sfx.play('rally'),
  bulwark: () => sfx.play('bulwark'),
  march: () => sfx.play('march'),
  levy: () => sfx.play('levy'),
  coin: () => {
    sfx.play('coin', { pitch: 0.9 });
    setTimeout(() => sfx.play('coin', { pitch: 1.05 }), 80);
    setTimeout(() => sfx.play('coin', { pitch: 1.2 }), 160);
  },
  upgrade: () => sfx.play('upgrade'),
  click: () => sfx.play('click'),
  hover: () => sfx.play('hover'),
  victory: () => sfx.play('victory'),
  defeat: () => sfx.play('defeat'),
  reveal: () => sfx.play('reveal'),
  error: () => sfx.play('error'),
};

// Composite "battle event" scenarios — what actually fires together in the
// real game (see the final-report event→fx/sfx table), for names that have
// no same-named fx-kind button above.
const SCENARIOS = {
  send: () => {
    fx.spawn('dust', camp.x, camp.y, {});
    sfx.play('send');
  },
  clash: () => {
    fx.spawn('sparks', mid.x, mid.y, {});
    fx.shake(0.35, 0.25);
    sfx.play('clash');
  },
  capture: () => {
    // `burst` now layers its own flash + shards + double ring internally
    // (round 2) — no separate shockwave call needed here any more.
    fx.spawn('burst', village.x, village.y, { color: '#3d7ef0' });
    fx.spawn('floatText', village.x, village.y - 0.7, { text: 'Captured!', color: '#f3ead7', size: 0.5 });
    fx.shake(0.5, 0.35);
    sfx.play('capture');
  },
  lost: () => {
    fx.spawn('floatText', village.x, village.y - 0.5, { text: '-18', color: '#eb5757' });
    sfx.play('lost');
  },
  march: () => sfx.play('march'),
  upgrade: () => {
    fx.spawn('floatText', keep.x, keep.y - 0.8, { text: 'Upgrade!', color: '#f5c451' });
    sfx.play('upgrade');
  },
  victory: () => {
    fx.spawn('confetti', mid.x, mid.y - 3, { count: 110 });
    fx.spawn('coins', keep.x, keep.y, { count: 20, toScreen: goldCounterScreenPos() });
    sfx.play('victory');
  },
  defeat: () => {
    fx.spawn('floatText', keep.x, keep.y - 0.6, { text: 'Defeated', color: '#eb5757' });
    sfx.play('defeat');
  },
  reveal: () => {
    fx.spawn('ripple', mid.x, mid.y, { duration: 1.2 });
    sfx.play('reveal');
  },
  error: () => sfx.play('error'),
};

function chaos() {
  ensureUnlocked();
  fx.spawn('confetti', mid.x, mid.y - 3, { count: 60 });
  fx.spawn('fireball', keep.x, keep.y, { delay: 0.5 });
  fx.spawn('burst', village.x, village.y, { color: '#f29e38' });
  fx.shake(0.6, 0.4);
  const names = [...Object.keys(FX_DEMOS), ...Object.keys(SFX_DEMOS)];
  let i = 0;
  const id = setInterval(() => {
    const n = names[(Math.random() * names.length) | 0];
    (FX_DEMOS[n] || SFX_DEMOS[n])();
    if (++i > 40) clearInterval(id);
  }, 90);
}

/** Screenshot/automation entry point: `window.demo('capture')` etc. */
function demo(name) {
  ensureUnlocked();
  if (name === 'chaos') return chaos();
  if (SCENARIOS[name]) return SCENARIOS[name]();
  if (FX_DEMOS[name]) return FX_DEMOS[name]();
  if (SFX_DEMOS[name]) return SFX_DEMOS[name]();
  console.warn('demo: unknown name', name);
  return undefined;
}
window.demo = demo;

// ---------------------------------------------------------------- buttons
function fillGrid(container, names) {
  for (const name of names) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.addEventListener('click', () => demo(name));
    b.addEventListener('mouseenter', () => { if (unlocked) sfx.play('hover'); });
    container.appendChild(b);
  }
}
fillGrid(document.getElementById('sfxGrid'), Object.keys(SFX_DEMOS));
fillGrid(document.getElementById('fxGrid'), Object.keys(FX_DEMOS));
fillGrid(document.getElementById('scenarioGrid'), Object.keys(SCENARIOS));
document.getElementById('chaosBtn').addEventListener('click', () => demo('chaos'));

// ---------------------------------------------------------------- controls
const muteChk = document.getElementById('muteChk');
const volRange = document.getElementById('volRange');
const rmChk = document.getElementById('rmChk');
muteChk.addEventListener('change', () => sfx.setMuted(muteChk.checked));
volRange.addEventListener('input', () => sfx.setVolume(Number(volRange.value)));
rmChk.addEventListener('change', () => fx.setReduceMotion(rmChk.checked));
sfx.setVolume(Number(volRange.value));

// -------------------------------------------------------------- gold tick
let gold = 1240;
setInterval(() => {
  gold += Math.round(3 + Math.random() * 4);
  goldValEl.textContent = gold.toLocaleString('en-US');
}, 1000);

// ------------------------------------------------------------------ loop
let last = performance.now();
let fpsSmoothed = 60;
function frame(now) {
  const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
  last = now;

  fx.update(dt);

  fxCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  fxCtx.clearRect(0, 0, fxCanvas.clientWidth, fxCanvas.clientHeight);
  fx.draw(fxCtx, camera);

  const off = fx.shakeOffset();
  shakeWrap.style.transform = `translate(${off.x}px, ${off.y}px)`;

  if (dt > 0) fpsSmoothed += (1 / dt - fpsSmoothed) * 0.08;
  statsEl.textContent = `fps ${Math.round(fpsSmoothed)} · particles ${fx.count()}`;

  requestAnimationFrame(frame);
}

resize();
requestAnimationFrame(frame);

// Devtools convenience only (not part of the brief's contract): lets the lead
// poke `__gallery.camera.zoom` or fire `__gallery.fx.spawn(...)` directly from
// the console without hunting through this file.
window.__gallery = { camera, fx, sfx };
