// Caravans of the living map (DESIGN §7.7): little carts that roll along a route's smooth road path.
//
// STATELESS by design: a cart is a pure function of (route, direction, lane, slot, clock). Nothing is
// spawned, pooled or updated per frame; only the routes in view are evaluated, a panned-to road is
// already busy, changing the camera never hitches, and there is nothing to allocate. A route runs
// 1..N independent "lanes"; lane `l` releases slot `k` at a jittered time, each slot with its own
// speed, so two carts never stay glued together. Income sets the rate (lanes x period), the cap thins
// by a stable per-cart priority, so carts never flicker.
//
// Two streams per route: LOADED carts (cloth in the player colour) roll from the settlement to the keep
// and on toward the capital; EMPTY carts (bare bed, no cloth) return the other way at half the density.
import { AMBIENT } from '../config/ambient.js';
import { sampleRoute } from '../world/caravanRoutes.js';
import { factionColor, factionColorLight } from './palette.js';
import { CART_TILT_STEPS } from './ambientSprites.js';

const TAU = Math.PI * 2;

/** Stable hash of three ints -> [0, 1). Integer maths only, no allocation. */
export function h01(a, b, c, d = 0) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ ((b | 0) + 0x7f4a7c15), 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h ^ (c | 0) ^ Math.imul(d | 0, 0x27d4eb2f), 0x27d4eb2f);
  h ^= h >>> 13;
  h = Math.imul(h, 0x165667b1);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 0 at/below `lo`, 1 at/above `hi`, smooth between. */
export function ramp(v, lo, hi) {
  if (v <= lo) return 0;
  if (v >= hi) return 1;
  const t = (v - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
}

/**
 * @param {ReturnType<import('./ambientSprites.js').createSpriteCache>} sprites
 */
export function createCaravans(sprites) {
  const C = AMBIENT.caravans;
  const v0 = C.speedHexPerSec * AMBIENT.hexPitch; // world units / s
  const cloth = factionColor(0);
  const clothLight = factionColorLight(0);
  let routes = [];
  let keepProb = 1;
  let lastCandidates = 0;
  const tmp = { x: 0, y: 0, dx: 0, dy: 0 };
  const stats = {
    routes: 0, lanes: 0, visibleRoutes: 0, candidates: 0, drawn: 0, emptyDrawn: 0, keepProb: 1,
  };

  function streamOf(perSec) {
    const lanes = Math.min(C.maxLanes, Math.max(1, Math.round(perSec * C.lanePeriodTargetSec)));
    const period = lanes / perSec;
    const phase = new Float64Array(lanes);
    return { lanes, period, phase };
  }

  /**
   * Decorates freshly built routes with their spawn parameters. Routes whose `key` existed before
   * keep their `bornAt`, so a rebuild after a conquest does not restart every road.
   * @param {import('../world/caravanRoutes.js').CaravanRoute[]} raw
   * @param {{ incomeOf: (regionId: number) => number, clock: number, prewarm: boolean }} o
   */
  function rebuild(raw, o) {
    const prev = new Map(routes.map((r) => [r.key, r]));
    routes = raw.map((r) => {
      const income = Math.max(0.01, o.incomeOf(r.regionId));
      const weight = r.kind === 'trunk' ? C.trunkWeight : (C.sourceWeight[r.sourceType] ?? 1);
      const perMin = Math.min(C.rateMax, Math.max(C.rateMin, C.rateBase * weight * (income / C.incomeRef) ** C.incomeExp));
      const perSec = perMin / 60;
      const out = streamOf(perSec);
      const back = streamOf(perSec * C.returnShare);
      const maxDur = r.length / (v0 * (1 - C.speedJitter));
      const old = prev.get(r.key);
      const bornAt = old ? old.bornAt : (o.prewarm ? o.clock - (maxDur + 3 * back.period) : o.clock);
      const seed = (r.from * 73856093) ^ (r.to * 19349663) ^ r.tiles.length;
      for (let l = 0; l < out.lanes; l++) out.phase[l] = (l / out.lanes) * out.period * 0.9;
      // The return stream is offset so empty carts do not leave the moment loaded ones do.
      for (let l = 0; l < back.lanes; l++) back.phase[l] = (l / back.lanes) * back.period * 0.9 + back.period * 0.35;
      return {
        ...r, seed, lanes: out.lanes, period: out.period, lanePhase: out.phase,
        retLanes: back.lanes, retPeriod: back.period, retLanePhase: back.phase, maxDur, bornAt, perMin,
      };
    });
    stats.routes = routes.length;
    stats.lanes = routes.reduce((n, r) => n + r.lanes + r.retLanes, 0);
  }

  /** Draws every visible cart (ground layer). `f` is the ambient frame context. */
  function draw(ctx, f) {
    stats.visibleRoutes = 0;
    stats.drawn = 0;
    stats.emptyDrawn = 0;
    stats.candidates = 0;
    const zoomK = ramp(f.z, C.dots.hide, C.dots.full);
    if (zoomK <= 0 || !routes.length) { lastCandidates = 0; return; }
    const spriteK = ramp(f.z, C.sprite.dot, C.sprite.full);
    const dotA = zoomK * (1 - spriteK);
    const sprA = zoomK * spriteK;
    const limit = Math.max(1, Math.floor(C.maxAlive * f.qf));
    // Thin to the cap (and to the quality) with last frame's candidate count: a stable per-cart
    // priority, quantised, so carts never flicker while the count drifts.
    const want = Math.min(f.qf, limit / Math.max(1, lastCandidates));
    keepProb = want >= 1 ? 1 : Math.max(C.thinStep, Math.floor(want / C.thinStep) * C.thinStep);
    const carT = f.carT;
    const dotR = Math.max(C.dotMinPx, C.dotRadius * f.z);
    const useSprites = sprA > 0.02;
    const dust = f.dust && f.z >= C.dust.minZoom;
    const tiltStep = C.maxTilt / CART_TILT_STEPS;
    const boost = Math.min(C.spriteBoostMax, Math.max(1, C.spriteMinPx / (C.length * f.z)));
    let candidates = 0;
    let drawn = 0;
    let emptyDrawn = 0;

    for (let ri = 0; ri < routes.length; ri++) {
      const r = routes[ri];
      const bb = r.bbox;
      if (bb.maxX < f.minX || bb.minX > f.maxX || bb.maxY < f.minY || bb.minY > f.maxY) continue;
      if (f.hidden[r.regionId]) continue;
      stats.visibleRoutes++;
      for (let dir = 0; dir < 2; dir++) {
        const empty = dir === 1;
        const lanes = empty ? r.retLanes : r.lanes;
        const period = empty ? r.retPeriod : r.period;
        const phases = empty ? r.retLanePhase : r.lanePhase;
        const salt = empty ? 8 : 0;
        for (let l = 0; l < lanes; l++) {
          const base = r.bornAt + phases[l];
          const kHi = Math.floor((carT - base) / period);
          let kLo = Math.floor((carT - base - r.maxDur) / period - 0.65);
          if (kLo < 0) kLo = 0;
          for (let s = kLo; s <= kHi; s++) {
            const h0 = h01(r.seed, l + salt, s, 1);
            const spawn = s === 0 ? base + 1 + 2.5 * h0 : base + (s + 0.6 * h0) * period;
            const age = carT - spawn;
            if (age < 0) continue;
            const speed = v0 * (1 + C.speedJitter * (2 * h01(r.seed, l + salt, s, 2) - 1));
            const dist = age * speed;
            if (dist >= r.length) continue;
            // Loaded carts walk the route from its start; empty carts walk it back from its end.
            sampleRoute(r, empty ? r.length - dist : dist, tmp);
            if (empty) { tmp.dx = -tmp.dx; tmp.dy = -tmp.dy; }
            const px = f.ax + tmp.x * f.z;
            const py = f.ay + tmp.y * f.z;
            if (px < -60 || px > f.w + 60 || py < -60 || py > f.h + 60) continue;
            candidates++; // carts ON SCREEN: what the cap and the quality thin
            if (h01(r.seed, l + salt, s, 3) >= keepProb || drawn >= limit) continue;
            const fade = Math.min(1, dist / C.fadeUnits, (r.length - dist) / C.fadeUnits);
            const fa = fade * fade * (3 - 2 * fade);
            if (fa < 0.02) continue;
            const bob = Math.sin(carT * C.bobHz * TAU + h0 * TAU) * C.bobAmp * f.z;
            const cy = py + bob;
            drawn++;
            if (empty) emptyDrawn++;

            if (dotA > 0.02) {
              ctx.globalAlpha = dotA * fa;
              ctx.fillStyle = 'rgba(10,14,24,0.92)';
              ctx.beginPath();
              ctx.arc(px, cy, dotR + 1, 0, TAU);
              ctx.fill();
              ctx.fillStyle = empty ? C.emptyDot : clothLight;
              ctx.beginPath();
              ctx.arc(px, cy, dotR, 0, TAU);
              ctx.fill();
              if (!empty) {
                ctx.fillStyle = cloth;
                ctx.beginPath();
                ctx.arc(px + dotR * 0.18, cy + dotR * 0.2, dotR * 0.66, 0, TAU);
                ctx.fill();
              }
            }
            if (useSprites) {
              const left = tmp.dx < 0;
              const phi = left ? Math.atan2(-tmp.dy, -tmp.dx) : Math.atan2(tmp.dy, tmp.dx);
              let ti = Math.round((phi * C.tiltFactor) / tiltStep);
              if (ti > CART_TILT_STEPS) ti = CART_TILT_STEPS; else if (ti < -CART_TILT_STEPS) ti = -CART_TILT_STEPS;
              const sp = sprites.cart(f.bi, ((carT * 3 + h0 * 7) | 0) & 1, ti, left, dust, empty);
              if (!sp) continue;
              const k = (f.z / sp.bucket) * boost;
              ctx.globalAlpha = sprA * fa;
              ctx.drawImage(sp.canvas, px - sp.ox * k, cy - sp.oy * k, sp.w * k, sp.h * k);
            }
          }
        }
      }
    }
    ctx.globalAlpha = 1;
    lastCandidates = candidates;
    stats.candidates = candidates;
    stats.drawn = drawn;
    stats.emptyDrawn = emptyDrawn;
    stats.keepProb = keepProb;
  }

  /** A frame with the caravans switched off: reports nothing drawn. */
  function skip() {
    stats.drawn = 0;
    stats.emptyDrawn = 0;
    stats.candidates = 0;
    stats.visibleRoutes = 0;
    lastCandidates = 0;
  }

  return {
    rebuild, draw, skip,
    get routes() { return routes; },
    stats: () => ({ ...stats }),
  };
}
