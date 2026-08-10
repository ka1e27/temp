// Transient visual effects: capture flashes, siege impacts, floating numbers.
//
// A FIXED POOL, allocated once. Spawning grabs a dead slot and overwrites its
// fields; nothing is created or collected while the game is running, which is
// the whole point — an idle game runs for hours and a per-effect allocation
// becomes a per-hour GC pause you can feel.
//
// Effects are pure decoration and are driven by events the SIM already emits,
// so nothing here can influence what actually happens.

const RING = 0, BURST = 1, FLOAT = 2, SHOCK = 3, WASH = 4;
const TYPES = { ring: RING, burst: BURST, float: FLOAT, shock: SHOCK, wash: WASH };
const TAU = Math.PI * 2;

/**
 * @param {{max?:number}} [opts]
 */
export function createFx(opts = {}) {
  const max = opts.max ?? 128;
  const pool = new Array(max);
  for (let i = 0; i < max; i++) {
    pool[i] = { on: false, kind: RING, x: 0, y: 0, t: 0, life: 1, r0: 0, r1: 0, color: '', text: '', n: 0 };
  }
  let cursor = 0;

  /**
   * @param {'ring'|'burst'|'float'|'shock'|'wash'} kind
   * @param {number} x world x @param {number} y world y
   * @param {{color?:string, life?:number, r0?:number, r1?:number, text?:string, n?:number}} [o]
   */
  function spawn(kind, x, y, o = {}) {
    // Round-robin: when saturated the oldest effect is recycled rather than
    // dropping the newest, so the most recent action is always visible.
    let slot = -1;
    for (let i = 0; i < max; i++) {
      const j = (cursor + i) % max;
      if (!pool[j].on) { slot = j; break; }
    }
    if (slot < 0) slot = cursor % max;
    cursor = (slot + 1) % max;

    const e = pool[slot];
    e.on = true;
    e.kind = TYPES[kind] ?? RING;
    e.x = x;
    e.y = y;
    e.t = 0;
    e.life = o.life ?? 0.6;
    e.r0 = o.r0 ?? 6;
    e.r1 = o.r1 ?? 34;
    e.color = o.color || null;   // resolved from the palette at draw time
    e.text = o.text || '';
    e.n = o.n ?? 8;
    return e;
  }

  function update(dtSec) {
    for (let i = 0; i < max; i++) {
      const e = pool[i];
      if (!e.on) continue;
      e.t += dtSec;
      if (e.t >= e.life) e.on = false;
    }
  }

  /**
   * The UNDER-SITES pass: effects that are ground rather than overlay.
   *
   * `draw` below paints on top of everything, which is right for a ring and
   * wrong for a colour arriving — a wash over the sites reads as a filter laid
   * on the board, and the same wash under them reads as the ground changing
   * hands. Ownership is the one thing in this game worth that distinction: the
   * cached background canvas repaints the instant `signature(state)` changes, so
   * the flood HARD-CUTS and always will. This is what makes that cut land.
   */
  function drawGround(ctx, p, px) {
    for (let i = 0; i < max; i++) {
      const e = pool[i];
      if (!e.on || e.kind !== WASH) continue;
      const f = e.t / e.life;
      const r = e.r0 + (e.r1 - e.r0) * easeOut(f);
      ctx.globalAlpha = 0.45 * (1 - f);
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, TAU);
      ctx.fillStyle = e.color || p.text;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Shapes only. Called inside the camera transform; `px` is 1/zoom. */
  function draw(ctx, p, px) {
    ctx.lineCap = 'round';
    for (let i = 0; i < max; i++) {
      const e = pool[i];
      if (!e.on || e.kind === FLOAT || e.kind === WASH) continue;
      const f = e.t / e.life;
      const fade = 1 - f;
      // Linear for a SHOCK: `fade*fade` put the perceptible life of a capture
      // ring at roughly 300ms of its 800, which is why the loudest moment in the
      // game could not be caught on a 1.5s screenshot interval. A short hard
      // ring beats a long soft one.
      ctx.globalAlpha = e.kind === SHOCK ? fade : fade * fade;
      const col = e.color || p.text;
      if (e.kind === RING || e.kind === SHOCK) {
        const r = e.r0 + (e.r1 - e.r0) * easeOut(f);
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, TAU);
        ctx.strokeStyle = col;
        ctx.lineWidth = px * (e.kind === SHOCK ? 5 : 2.5) * fade;
        ctx.stroke();
      } else if (e.kind === BURST) {
        const r = e.r0 + (e.r1 - e.r0) * easeOut(f);
        ctx.beginPath();
        for (let k = 0; k < e.n; k++) {
          const a = (k / e.n) * TAU;
          const cx = Math.cos(a);
          const cy = Math.sin(a);
          ctx.moveTo(e.x + cx * r * 0.55, e.y + cy * r * 0.55);
          ctx.lineTo(e.x + cx * r, e.y + cy * r);
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = px * 2;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Floating text. Called from the renderer's single text pass, so `ctx.font`
   *  has already been set exactly once this frame. */
  function drawText(ctx, p, px) {
    for (let i = 0; i < max; i++) {
      const e = pool[i];
      if (!e.on || e.kind !== FLOAT) continue;
      const f = e.t / e.life;
      ctx.globalAlpha = 1 - f * f;
      ctx.fillStyle = e.color || p.text;
      ctx.fillText(e.text, e.x, e.y - f * px * 26);
    }
    ctx.globalAlpha = 1;
  }

  function clear() {
    for (let i = 0; i < max; i++) pool[i].on = false;
  }

  /** Count of live effects — used by tests and the dev overlay. */
  const live = () => pool.reduce((n, e) => n + (e.on ? 1 : 0), 0);

  return { spawn, update, draw, drawGround, drawText, clear, live, max };
}

const easeOut = (t) => 1 - (1 - t) * (1 - t);

/**
 * Map a sim event onto an effect. The sim pushes to state.events[] and main.js
 * drains it AFTER the tick, so this only ever runs between ticks.
 *
 * @param {ReturnType<createFx>} fx
 * @param {object} ev  {type, x, y, owner, amount}
 * @param {object} p   palette
 */
/**
 * Map a sim event to an effect at the right place on the board.
 *
 * Sim events carry `siteId`, never coordinates — the simulation has no idea
 * where anything is on screen, and it must not. This previously read `ev.x`
 * and `ev.y`, so every spawn landed at NaN and canvas silently drew nothing:
 * no capture flash, no siege impact, no floating number had ever appeared.
 * `locate` resolves a site id to a world position.
 *
 * @param {(siteId:string)=>({x:number,y:number}|null)} locate
 */
export function fxFromEvent(fx, ev, p, hexSize = 34, locate = null) {
  const at = ev.siteId != null && locate ? locate(ev.siteId) : null;
  if (at) { ev = { ...ev, x: at.x, y: at.y }; }
  if (!Number.isFinite(ev.x) || !Number.isFinite(ev.y)) return;
  // `site-captured` carries from/to rather than owner; prefer the new holder.
  const color = p.owner[ev.to ?? ev.owner] || p.accent;
  switch (ev.type) {
    case 'site-captured':
      // THE VERB OF THE GAME, and it used to be a 300ms translucent ring over an
      // instant repaint — you did not win a site, you observed that the number
      // changed. Three layers now: the colour arriving as ground (under the
      // sites, see drawGround), a hard short ring, and a word.
      fx.spawn('wash', ev.x, ev.y, { color, life: 0.42, r0: hexSize * 0.5, r1: hexSize * 3 });
      fx.spawn('shock', ev.x, ev.y, { color, life: 0.5, r0: hexSize * 0.4, r1: hexSize * 2.4 });
      fx.spawn('burst', ev.x, ev.y, { color, life: 0.5, r0: hexSize * 0.5, r1: hexSize * 1.3, n: 10 });
      fx.spawn('float', ev.x, ev.y, {
        color, life: 1.0, text: ev.to === 'player' ? 'TAKEN' : 'LOST',
      });
      break;
    case 'field-battle':
      fx.spawn('burst', ev.x, ev.y, { color: p.warn, life: 0.45, r0: hexSize * 0.3, r1: hexSize, n: 12 });
      break;
    case 'siege-begun':
      fx.spawn('ring', ev.x, ev.y, { color: p.danger, life: 0.35, r0: hexSize * 0.5, r1: hexSize * 0.8 });
      break;
    case 'units-trained':
      fx.spawn('float', ev.x, ev.y, { color: p.gold, life: 1.1, text: `+${ev.count ?? ev.amount ?? 1}` });  // events use `count`
      break;
    default:
      break;
  }
}
