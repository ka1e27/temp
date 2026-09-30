// Bird flocks of the living map (DESIGN §7.7): every 20-40 s a V of birds crosses the view, flying
// over a forest of a revealed region, with a faint shadow gliding over the ground below. One flock at
// a time; nothing is drawn over fog-hidden regions. Air layer. No allocation per frame.
import { AMBIENT } from '../config/ambient.js';
import { createRng } from '../core/rng.js';
import { h01, ramp } from './ambientCaravans.js';

const TAU = Math.PI * 2;
const R3 = Math.sqrt(3);

/** Region id of the tile under a ground point (world units), or -1. Allocation free. */
export function regionAtGround(world, x, y) {
  const rf = y / 1.5;
  const qf = x / R3 - rf / 2;
  let rx = Math.round(qf);
  let rz = Math.round(rf);
  const ry = Math.round(-qf - rf);
  const dx = Math.abs(rx - qf);
  const dy = Math.abs(ry - (-qf - rf));
  const dz = Math.abs(rz - rf);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy <= dz) rz = -rx - ry;
  const col = rx + (rz - (rz & 1)) / 2;
  if (col < 0 || col >= world.cols || rz < 0 || rz >= world.rows) return -1;
  return world.tiles[rz * world.cols + col].region;
}

/**
 * @param {import('../world/generate.js').World} world
 * @param {{xs: Float32Array, ys: Float32Array, regions: Int16Array, count: number}} forest
 * @param {number} seed
 */
export function createBirds(world, forest, seed) {
  const B = AMBIENT.birds;
  const rng = createRng(seed ^ 0x51ed270b).fork('birds');
  let timer = rng.range(B.firstSec[0], B.firstSec[1]);
  let flock = null; // { x0, y0, fx, fy, age, life, n, salt }
  let flocks = 0;

  function spawn(view, hidden, qf) {
    if (!forest.count || !view) return false;
    for (let tries = 0; tries < 28; tries++) {
      const i = rng.int(0, forest.count - 1);
      const x = forest.xs[i];
      const y = forest.ys[i];
      if (x < view.minX + 1 || x > view.maxX - 1 || y < view.minY + 1 || y > view.maxY - 1) continue;
      if (hidden[forest.regions[i]]) continue;
      // Mostly horizontal crossings, either way, with a gentle diagonal.
      const ang = (rng.chance(0.5) ? 0 : Math.PI) + rng.range(-0.5, 0.5);
      const fx = Math.cos(ang);
      const fy = Math.sin(ang);
      const half = B.pathLen / 2;
      const n = Math.max(3, Math.round(rng.int(B.flock[0], B.flock[1]) * (0.6 + 0.4 * qf)));
      flock = { x0: x - fx * half, y0: y - fy * half, fx, fy, age: 0, life: B.pathLen / B.speed, n, salt: flocks++ };
      return true;
    }
    return false;
  }

  /**
   * @param {number} dt seconds
   * @param {{minX:number,minY:number,maxX:number,maxY:number}|null} view last known view, world units
   * @param {Uint8Array} hidden per-region hidden flags
   * @param {number} qf quality factor 0.5..1
   */
  function update(dt, view, hidden, qf) {
    if (flock) {
      flock.age += dt;
      if (flock.age >= flock.life) flock = null;
      return;
    }
    timer -= dt;
    if (timer > 0) return;
    timer = spawn(view, hidden, qf) ? rng.range(B.intervalSec[0], B.intervalSec[1]) : 4;
  }

  function draw(ctx, f) {
    if (!flock) return 0;
    const zk = ramp(f.z, B.zoom.hide, B.zoom.full);
    if (zk <= 0.02) return 0;
    const fl = flock;
    const fade = Math.min(1, fl.age / 1.4, (fl.life - fl.age) / 1.4) * zk;
    const lead = B.speed * fl.age;
    const span = Math.max(B.span * f.z, B.minSpanPx);
    ctx.strokeStyle = B.color;
    ctx.lineWidth = Math.max(1.4, span * 0.17);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let drawn = 0;
    for (let j = 0; j < fl.n; j++) {
      const row = (j + 1) >> 1;
      const side = j === 0 ? 0 : (j & 1 ? -1 : 1);
      const jit = h01(fl.salt, j, 5) - 0.5;
      const back = row * 0.4 + jit * 0.08;
      const lat = side * row * 0.3 + jit * 0.06;
      const gx = fl.x0 + fl.fx * (lead - back) - fl.fy * lat;
      const gy = fl.y0 + fl.fy * (lead - back) + fl.fx * lat;
      if (gx < f.minX || gx > f.maxX || gy < f.minY - 2 || gy > f.maxY + 2) continue;
      const reg = regionAtGround(f.world, gx, gy);
      if (reg >= 0 && f.hidden[reg]) continue;
      const flap = Math.sin(f.t * B.flapHz * TAU + j * 0.9 + fl.salt);
      const bob = Math.sin(f.t * 1.1 + j) * 0.05;
      const px = f.ax + gx * f.z;
      const py = f.ay + (gy - B.altitude + bob) * f.z;
      if (f.birdShadow) {
        ctx.globalAlpha = B.shadowAlpha * fade;
        ctx.fillStyle = '#0a140a';
        ctx.beginPath();
        ctx.ellipse(px + 0.1 * f.z, f.ay + gy * f.z + 0.1 * f.z, span * 0.85, span * 0.24, 0, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 0.85 * fade;
      const tip = flap * span * 0.62;
      ctx.beginPath();
      ctx.moveTo(px - span, py - tip);
      ctx.quadraticCurveTo(px - span * 0.42, py - tip * 0.25 - span * 0.34, px, py);
      ctx.quadraticCurveTo(px + span * 0.42, py - tip * 0.25 - span * 0.34, px + span, py - tip);
      ctx.stroke();
      drawn++;
    }
    ctx.globalAlpha = 1;
    return drawn;
  }

  return {
    update, draw,
    get active() { return flock != null; },
    /** Forget the current flock and wait `sec` before the next one (Reduce Motion, battle). */
    reset(sec = rng.range(B.firstSec[0], B.firstSec[1])) { flock = null; timer = sec; },
    /** Test/gallery hook: start a flock now over the view. */
    spawnNow(view, hidden, qf = 1) { flock = null; return spawn(view, hidden, qf); },
    flockInfo: () => (flock ? { ...flock } : null),
  };
}
