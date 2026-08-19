import { siteTier } from './siteShapes.js';

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
/** See `towerFxDue`: a wall fires every tick, so the spark is throttled per
 *  column rather than per shot. */
const TOWER_FX_GAP = 650;

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
   * `delay` (seconds) holds an effect back without a timer or a second pool:
   * the clock simply STARTS NEGATIVE and `update` walks it up to zero, so a
   * delayed effect costs exactly one slot and nothing per frame. The three draw
   * passes skip while `t < 0` — without that guard a negative `t` draws a
   * shrinking radius at alpha > 1, which is a brighter bug than no bug.
   * @param {{color?:string, life?:number, r0?:number, r1?:number, text?:string,
   *   n?:number, delay?:number}} [o]
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
    e.t = -(o.delay ?? 0);
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
      if (!e.on || e.t < 0 || e.kind !== WASH) continue;
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
      if (!e.on || e.t < 0 || e.kind === FLOAT || e.kind === WASH) continue;
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
      if (!e.on || e.t < 0 || e.kind !== FLOAT) continue;
      const f = e.t / e.life;
      ctx.globalAlpha = 1 - f * f;
      ctx.fillStyle = e.color || p.text;
      ctx.fillText(e.text, e.x, e.y - f * px * 26);
    }
    ctx.globalAlpha = 1;
  }

  function clear() {
    for (let i = 0; i < max; i++) pool[i].on = false;
    shotAt.clear();
  }

  /**
   * Per-squad cooldown for tower fire, in ms of wall clock.
   *
   * A WALL SHOOTS EVERY TICK, so this is the one event that cannot map 1:1 onto
   * an effect: measured over single battles, `tower-fired` fires 347 times on
   * riverfen, 1012 on duskfell and 1408 on ravensmarch. Ten a second at one
   * spot is not a tell, it is a strobe, and it would exhaust a 128-slot pool on
   * its own. One spark per column per `TOWER_FX_GAP` reads as "that lot are
   * taking fire" — which is the whole lesson the mechanic is trying to teach,
   * since a marching stack otherwise just quietly shrinks.
   *
   * Keyed by squad, not by site: what the player needs to notice is which of
   * THEIR columns is being shot, not which building is doing it.
   */
  const shotAt = new Map();
  function towerFxDue(squadId, nowMs) {
    const prev = shotAt.get(squadId);
    if (prev !== undefined && nowMs - prev < TOWER_FX_GAP) return false;
    shotAt.set(squadId, nowMs);
    return true;
  }

  /** Count of live effects — used by tests and the dev overlay. */
  const live = () => pool.reduce((n, e) => n + (e.on ? 1 : 0), 0);

  return { spawn, update, draw, drawGround, drawText, clear, live, max, towerFxDue };
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
/**
 * What a capture SAYS. `TAKEN`/`LOST` is right for a farm and much too quiet
 * for the win condition — the castle is the whole objective and the camp is the
 * whole lose condition, so the two of them get the word for it. Read off the
 * kind rather than off `rules.victory`: this function has an event and a
 * palette and deliberately nothing else, and a renderer that had to be handed
 * the victory rule to name a flash would be a second place that rule lives.
 */
function captureWord(ev) {
  const mine = ev.to === 'player';
  if (ev.kind === 'castle') return mine ? 'THRONE TAKEN' : 'THRONE LOST';
  if (ev.kind === 'camp') return mine ? 'CAMP TAKEN' : 'CAMP LOST';
  return mine ? 'TAKEN' : 'LOST';
}

export function fxFromEvent(fx, ev, p, hexSize = 34, locate = null) {
  const at = ev.siteId != null && locate ? locate(ev.siteId) : null;
  if (at) { ev = { ...ev, x: at.x, y: at.y }; }
  if (!Number.isFinite(ev.x) || !Number.isFinite(ev.y)) return;
  // `site-captured` carries from/to rather than owner; prefer the new holder.
  const color = p.owner[ev.to ?? ev.owner] || p.accent;
  switch (ev.type) {
    case 'site-captured': {
      // THE VERB OF THE GAME, and it used to be a 300ms translucent ring over an
      // instant repaint — you did not win a site, you observed that the number
      // changed. Three layers now: the colour arriving as ground (under the
      // sites, see drawGround), a hard short ring, and a word.
      //
      // ...AND IT USED TO BE THE SAME THREE LAYERS FOR A FARM AND FOR THE THRONE.
      // `ev.kind` has crossed on this payload since the event was written and
      // nothing read it, so taking an undefended farm and breaking the enemy's
      // castle — the literal win condition — fired pixel-identical bursts,
      // differing only in tint. Measured by calling this function directly with
      // two events differing only in `kind`: indistinguishable screenshots. This
      // is the most-repeated reward beat in the game, so it was also the flattest.
      //
      // The magnitude is DERIVED FROM `siteTier`, not a second table. That
      // constant already means "how much attention does this kind deserve" — it
      // is what sets outline weight — so a capture flash keyed off it cannot
      // drift out of step with how the site is drawn the rest of the time. A
      // fresh table would be a second thing to keep correct, and the one place
      // the two disagreed would be a farm that flashed like a keep.
      const t = siteTier(ev.kind);          // 0 ambient, 1 martial, 2 objective
      const big = 1 + t * 0.42;             // 1.00 / 1.42 / 1.84
      fx.spawn('wash', ev.x, ev.y, {
        color, life: 0.42 + t * 0.10, r0: hexSize * 0.5, r1: hexSize * 3 * big,
      });
      fx.spawn('shock', ev.x, ev.y, {
        color, life: 0.5 + t * 0.12, r0: hexSize * 0.4, r1: hexSize * 2.4 * big,
      });
      fx.spawn('burst', ev.x, ev.y, {
        color, life: 0.5 + t * 0.15, r0: hexSize * 0.5, r1: hexSize * 1.3 * big, n: 10 + t * 7,
      });
      // A SECOND RING ON THE OBJECTIVE ONLY, offset in time. Scaling one ring
      // further just makes it faster and thinner at the same moment; a second
      // arrival is what reads as "that was a different kind of event" rather
      // than "that was a bigger one".
      if (t >= 2) {
        fx.spawn('shock', ev.x, ev.y, {
          color, life: 0.75, r0: hexSize * 1.2, r1: hexSize * 5.2, delay: 0.14,
        });
      }
      fx.spawn('float', ev.x, ev.y, {
        color, life: 1.0 + t * 0.35, text: captureWord(ev),
      });
      break;
    }
    case 'field-battle':
      fx.spawn('burst', ev.x, ev.y, { color: p.warn, life: 0.45, r0: hexSize * 0.3, r1: hexSize, n: 12 });
      break;
    case 'tower-fired':
      // A SPARK ON THE COLUMN, not a number. `lost` is a FRACTION of a body per
      // tick (towers.js carries the remainder on the squad), so a floating "-N"
      // would read -0 nearly every time and a rounded one would lie about the
      // total. The spark says "you are being shot here"; the shrinking stack
      // says how much it cost.
      fx.spawn('burst', ev.x, ev.y, {
        color: p.danger, life: 0.3, r0: hexSize * 0.12, r1: hexSize * 0.42, n: 4,
      });
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
