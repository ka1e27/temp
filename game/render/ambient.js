// The living map's ambient life (DESIGN §7.7): caravans on the roads, chimney smoke, turning windmill
// sails, sailboats off Harbour regions and the odd flock of birds. Browser only; reads the world and
// a game-state snapshot, never mutates either.
//
//   const ambient = createAmbient({ world, seed, reduceMotion, incomeOf? });
//   ambient.rebuild(state);                       // ownership / prosperity changed (cheap when unchanged)
//   ambient.update(dt);                           // once per frame, real seconds
//   ambient.drawGround(ctx, camera, visible);     // after the territory + cloud shadows, BEFORE settlements
//   ambient.drawAir(ctx, camera, visible);        // after settlements + banners, before fx and fog
//
// Cheap by construction (budget: all of it <= 1 ms/frame at 1440x900, see AMBIENT.budgetMs):
// carts, smoke, sails and boats are pure functions of a clock (no pools, nothing spawned per frame),
// sprites are baked once per zoom bucket, everything is culled to the view, and the hot loops use
// no allocation (screen positions are computed inline from the camera's fields).
import { AMBIENT } from '../config/ambient.js';
import { buildCaravanRoutes, sampleRoute } from '../world/caravanRoutes.js';
import { collectChimneys, buildBoatLanes, forestSpots } from '../world/ambientPlaces.js';
import { createProsperityPlan, FEATURE_LEVEL } from '../world/prosperityPlan.js';
import { regionIncome } from '../meta/economy.js';
import { BUCKETS, bucketIndex, createSpriteCache } from './ambientSprites.js';
import { createCaravans, ramp, h01 } from './ambientCaravans.js';
import { createBirds } from './ambientBirds.js';

const TAU = Math.PI * 2;
const PLAYER = 0;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const fract = (v) => v - Math.floor(v);
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * @typedef {Object} AmbientOptions
 * @property {import('../world/generate.js').World} world
 * @property {number} [seed]            defaults to world.seed; drives the bird schedule
 * @property {boolean} [reduceMotion]
 * @property {(regionId: number) => number} [incomeOf]  caravan density input; default: the region's `regionIncome`
 * @property {number} [pixelRatio]      device pixel ratio (sprite sharpness); default devicePixelRatio, max 2
 * @property {number} [spriteBudgetMs]  ms of NEW sprite baking allowed per draw call (default AMBIENT.spriteBudgetMs; Infinity = bake at once)
 * @property {ReturnType<typeof createProsperityPlan>} [plan]  share the prosperity plan with the terrain bake
 */

/**
 * @param {AmbientOptions} opts
 */
export function createAmbient(opts) {
  const { world } = opts;
  const seed = opts.seed ?? world.seed;
  const sprites = createSpriteCache();
  const plan = opts.plan || createProsperityPlan(world);
  const chimneys = collectChimneys(world);
  const lanes = buildBoatLanes(world);
  const forest = forestSpots(world);
  const caravans = createCaravans(sprites);
  const birds = createBirds(world, forest, seed);
  const spriteBudgetMs = opts.spriteBudgetMs ?? AMBIENT.spriteBudgetMs;
  const incomeOf = opts.incomeOf || ((rid) => regionIncome(world.regions[rid]));
  let dpr = Math.min(2, opts.pixelRatio || (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1));

  let enabled = true;
  const features = { caravans: true, smoke: true, sails: true, boats: true, birds: true };
  let reduceMotion = !!opts.reduceMotion;
  let quality = 1;
  let qf = 1;
  let t = 0; // seconds of ambient time
  let carT = 0; // caravan clock (slower under Reduce Motion)
  let builtOnce = false;
  let ownerSig = null;

  // ---- rebuilt with the realm ------------------------------------------------------
  let smoke = { n: 0, x: new Float32Array(0), y: new Float32Array(0), ph: new Float32Array(0), reg: new Int16Array(0), id: new Int16Array(0), pri: new Float32Array(0), own: new Uint8Array(0) };
  let mills = []; // windmill sites at level II+
  let boats = []; // { lane, variant, period, phase, minX..maxY }
  let levelsSig = '';

  // ---- hidden regions -----------------------------------------------------------------
  const hidden = new Uint8Array(world.regions.length + 1);
  let maskSrc = null;
  function refreshHidden() {
    if (!maskSrc) { hidden.fill(0); return; }
    if (typeof maskSrc === 'function') {
      for (let r = 0; r < world.regions.length; r++) hidden[r] = maskSrc(r) ? 1 : 0;
    } else {
      for (let r = 0; r < world.regions.length; r++) hidden[r] = maskSrc[r] ? 1 : 0;
    }
  }

  // ---- per-frame context (reused) -------------------------------------------------------
  const F = {
    z: 1, ax: 0, ay: 0, w: 1, h: 1, minX: 0, minY: 0, maxX: 0, maxY: 0, bi: 0, qf: 1, t: 0, carT: 0,
    dust: true, birdShadow: true, hidden, world,
  };
  const lastView = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let haveView = false;
  const tmp = { x: 0, y: 0, dx: 0, dy: 0 };

  function prep(cam, visible) {
    const z = cam.zoom;
    F.z = z;
    F.w = cam.viewW;
    F.h = cam.viewH;
    F.ax = cam.viewW * 0.5 - cam.x * z;
    F.ay = cam.viewH * 0.5 - cam.y * z;
    const hw = cam.viewW / (2 * z);
    const hh = cam.viewH / (2 * z);
    const m = AMBIENT.cullMargin;
    lastView.minX = visible ? visible.minX : cam.x - hw;
    lastView.maxX = visible ? visible.maxX : cam.x + hw;
    lastView.minY = visible ? visible.minY : cam.y - hh;
    lastView.maxY = visible ? visible.maxY : cam.y + hh;
    haveView = true;
    F.minX = lastView.minX - m;
    F.maxX = lastView.maxX + m;
    F.minY = lastView.minY - m;
    F.maxY = lastView.maxY + m;
    F.bi = bucketIndex(z * dpr);
    F.qf = qf;
    F.t = t;
    F.carT = carT;
    F.dust = quality > AMBIENT.quality.noDustBelow;
    F.birdShadow = quality > AMBIENT.quality.noBirdShadowBelow;
  }

  // ---- rebuild -----------------------------------------------------------------------------
  function rebuildOwnership(state) {
    const owner = state.owner;
    const routes = buildCaravanRoutes(world, owner, world.startRegion);
    caravans.rebuild(routes, { incomeOf, clock: carT, prewarm: !builtOnce });

    // Chimney smoke: the player's settlements at full density; every other revealed owner's settlements
    // (owner >= 0: fog is -1) at about half the rate, i.e. their first chimney only and the sparse wisp.
    const xs = []; const ys = []; const phs = []; const regs = []; const ids = []; const own = [];
    for (const c of chimneys) {
      const o = owner[c.region];
      if (o == null || o < 0) continue;
      const mine = o === PLAYER;
      if (!mine && c.index > 0) continue;
      xs.push(c.x); ys.push(c.y); phs.push(c.phase); regs.push(c.region); ids.push(c.id); own.push(mine ? 1 : 0);
    }
    smoke = {
      n: xs.length, x: Float32Array.from(xs), y: Float32Array.from(ys), ph: Float32Array.from(phs),
      reg: Int16Array.from(regs), id: Int16Array.from(ids), own: Uint8Array.from(own),
      // Stable thinning priority: the player's plumes (0..1) always outrank everyone else's (1..2).
      pri: Float32Array.from(ids, (id, k) => h01(id, 77, 5) + (own[k] ? 0 : 1)),
    };
    const perSec = AMBIENT.boats.speedHexPerSec * AMBIENT.hexPitch;
    boats = lanes.map((lane) => {
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      for (let i = 0; i < lane.pts.length; i += 2) {
        if (lane.pts[i] < minX) minX = lane.pts[i];
        if (lane.pts[i] > maxX) maxX = lane.pts[i];
        if (lane.pts[i + 1] < minY) minY = lane.pts[i + 1];
        if (lane.pts[i + 1] > maxY) maxY = lane.pts[i + 1];
      }
      return {
        lane, variant: owner[lane.region] === PLAYER ? 0 : 1,
        period: (2 * lane.length) / perSec, phase: ((lane.seed >>> 8) % 6283) / 1000,
        bob: ((lane.seed >>> 3) % 6283) / 1000, minX, minY, maxX, maxY,
      };
    });
  }

  function rebuildLevels(state, owner) {
    const levels = Array.isArray(state.prosperity) ? state.prosperity : [];
    const list = [];
    let sig = '';
    for (const w of plan.windmills) {
      if (owner[w.region] !== PLAYER || (levels[w.region] | 0) < FEATURE_LEVEL.windmill) continue;
      list.push(w);
      sig += `${w.tile},`;
    }
    if (sig !== levelsSig) { mills = list; levelsSig = sig; }
  }

  /**
   * (Re)derives everything that depends on the realm: caravan routes and rates, smoking chimneys,
   * windmills (level II+), boat sail colours. Call it whenever ownership OR prosperity levels
   * changed; it is cheap and does nothing expensive when neither did. Uses `state.owner` and
   * `state.prosperity` (missing = level 0). The FIRST call pre-populates the roads so the map is
   * alive on the first frame; later calls start new roads empty.
   * @param {{ owner: number[], prosperity?: number[] }} state
   */
  function rebuild(state) {
    const sig = state.owner.join(',');
    if (sig !== ownerSig) {
      rebuildOwnership(state);
      ownerSig = sig;
      builtOnce = true;
    }
    rebuildLevels(state, state.owner);
  }

  // ---- update --------------------------------------------------------------------------------
  /** @param {number} dt real seconds since the last frame */
  function update(dt) {
    if (!enabled) return;
    const d = dt > 0.25 ? 0.25 : dt < 0 ? 0 : dt;
    t += d;
    carT += d * (reduceMotion ? AMBIENT.reduceMotion.caravanSpeed : 1);
    if (reduceMotion && !AMBIENT.reduceMotion.birds) return;
    birds.update(d, haveView ? lastView : null, hidden, qf);
  }

  // ---- ground layer ---------------------------------------------------------------------------
  function drawBoats(ctx) {
    const B = AMBIENT.boats;
    const zk = ramp(F.z, B.zoom.hide, B.zoom.full);
    if (zk <= 0.02 || !boats.length) return 0;
    const shown = Math.max(1, Math.ceil(Math.min(boats.length, B.maxShare) * qf));
    const bi = F.bi;
    let drawn = 0;
    for (let i = 0; i < boats.length && drawn < shown; i++) {
      const b = boats[i];
      if (hidden[b.lane.region]) continue;
      if (b.maxX < F.minX || b.minX > F.maxX || b.maxY < F.minY || b.minY > F.maxY) continue;
      const ph = (t / b.period) * TAU + b.phase;
      const u = (1 - Math.cos(ph)) * 0.5;
      sampleRoute(b.lane, u * b.lane.length, tmp);
      const going = Math.sin(ph) >= 0 ? 1 : -1;
      const dx = tmp.dx * going;
      const left = dx < 0;
      const spd = Math.abs(Math.sin(ph));
      const sp = sprites.boat(bi, b.variant);
      if (!sp) continue;
      const k = F.z / sp.bucket;
      const bobPh = t * B.bobHz * TAU + b.bob;
      const px = F.ax + tmp.x * F.z;
      const py = F.ay + tmp.y * F.z + Math.sin(bobPh) * B.bobAmp * F.z;
      const roll = Math.sin(bobPh * 0.83 + 1.3) * B.rollAmp;
      // Wake: two thin foam arcs trailing behind, longer the faster the boat moves.
      if (spd > 0.12 && F.z >= 16) {
        const wl = (0.16 + 0.22 * spd) * F.z;
        const sgn = left ? 1 : -1;
        ctx.globalAlpha = 0.5 * zk * Math.min(1, spd * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, F.z * 0.022);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px, py + 0.04 * F.z);
        ctx.quadraticCurveTo(px + sgn * wl * 0.5, py + 0.075 * F.z, px + sgn * (wl + 0.14 * F.z), py + 0.055 * F.z);
        ctx.stroke();
      }
      ctx.globalAlpha = zk;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(roll);
      if (left) ctx.scale(-1, 1);
      ctx.drawImage(sp.canvas, -sp.ox * k, -sp.oy * k, sp.w * k, sp.h * k);
      ctx.restore();
      drawn++;
    }
    ctx.globalAlpha = 1;
    return drawn;
  }

  let groundMs = 0;
  let airMs = 0;
  let lastGroundMs = 0;
  let lastAirMs = 0;
  let boatsDrawn = 0;

  /**
   * Caravans and boats. Draw after the territory and the cloud shadows, before the settlements.
   * @param {CanvasRenderingContext2D} ctx CSS-px space (already scaled by the dpr)
   * @param {{x:number,y:number,zoom:number,viewW:number,viewH:number}} cam
   * @param {{minX:number,minY:number,maxX:number,maxY:number}} [visible] world-unit view bounds (default: from `cam`)
   */
  function drawGround(ctx, cam, visible) {
    if (!enabled) return;
    const t0 = clock();
    refreshHidden();
    prep(cam, visible);
    sprites.beginFrame(spriteBudgetMs);
    if (features.caravans) caravans.draw(ctx, F); else caravans.skip();
    boatsDrawn = features.boats ? drawBoats(ctx) : 0;
    lastGroundMs = clock() - t0;
    groundMs += (lastGroundMs - groundMs) * 0.08;
  }

  // ---- air layer -------------------------------------------------------------------------------
  let smokePlumes = 0;
  let lastOwnPlumes = 0;
  let lastOtherPlumes = 0;
  let smokeDrawn = 0;
  let sailsDrawn = 0;
  let birdsDrawn = 0;

  function drawSmoke(ctx) {
    const S = AMBIENT.smoke;
    const zk = ramp(F.z, S.zoom.hide, S.zoom.full);
    smokeDrawn = 0;
    smokePlumes = 0;
    if (zk <= 0.02 || !smoke.n) return;
    // Half the smoke (Reduce Motion, low quality, and every settlement that is not the player's) = the
    // sparse baked wisp.
    const sparse = reduceMotion || qf < 0.75;
    // Fewer plumes when the view is far out, thinned by a stable per-chimney priority (no popping).
    const cap = Math.max(8, Math.floor(S.maxPlumes * qf * Math.min(1, Math.max(0.25, (F.z - 12) / 14))));
    // Keep the `cap` best plumes by priority, judged with last frame's counts: the player's own first, then the rest.
    let keep = 3;
    if (cap < lastOwnPlumes + lastOtherPlumes) {
      keep = cap <= lastOwnPlumes ? cap / Math.max(1, lastOwnPlumes) : 1 + (cap - lastOwnPlumes) / Math.max(1, lastOtherPlumes);
    }
    let ownSeen = 0;
    let otherSeen = 0;
    const base = t / S.periodSec;
    const stubOn = F.z >= S.stub.zoomFrom;
    const stubW = S.stub.w * F.z;
    const stubH = S.stub.h * F.z;
    const bi = F.bi;
    ctx.globalAlpha = zk;
    for (let i = 0; i < smoke.n; i++) {
      const sx = smoke.x[i];
      const sy = smoke.y[i];
      if (sx < F.minX || sx > F.maxX || sy < F.minY || sy > F.maxY + 2) continue;
      if (hidden[smoke.reg[i]]) continue;
      if (smoke.own[i]) ownSeen++; else otherSeen++;
      if (smoke.pri[i] >= keep) continue;
      const px = F.ax + sx * F.z;
      const py = F.ay + sy * F.z;
      if (stubOn) {
        ctx.fillStyle = '#6b5142';
        ctx.fillRect(px - stubW / 2, py, stubW, stubH);
        ctx.fillStyle = '#2e2119';
        ctx.fillRect(px - stubW / 2 - 0.5, py - 0.5, stubW + 1, Math.max(1.4, stubH * 0.24));
      }
      const strip = sprites.plume(bi, smoke.id[i] % S.variants, sparse || !smoke.own[i]);
      if (!strip) continue;
      const frame = Math.floor(fract(base + smoke.ph[i]) * strip.frames) % strip.frames;
      const k = F.z / strip.bucket;
      ctx.drawImage(strip.canvas, frame * strip.fw, 0, strip.fw, strip.fh, px - strip.ax * k, py - strip.ay * k, strip.fw * k, strip.fh * k);
      smokePlumes++;
      smokeDrawn += strip.count;
    }
    lastOwnPlumes = ownSeen;
    lastOtherPlumes = otherSeen;
    ctx.globalAlpha = 1;
  }

  function drawSails(ctx) {
    const W = AMBIENT.windmill;
    const zk = ramp(F.z, W.zoom.hide, W.zoom.full);
    sailsDrawn = 0;
    if (zk <= 0.02 || !mills.length) return;
    const sp = sprites.sails(F.bi);
    if (!sp) return;
    const k = F.z / sp.bucket;
    const omega = (W.rpm * TAU) / 60;
    const quarter = Math.PI / 2;
    ctx.globalAlpha = zk;
    for (let i = 0; i < mills.length; i++) {
      const m = mills[i];
      if (m.x < F.minX || m.x > F.maxX || m.y < F.minY || m.y > F.maxY + 2) continue;
      if (hidden[m.region]) continue;
      const angle = m.phase + (reduceMotion && !AMBIENT.reduceMotion.sailsTurn ? W.staticAngle : t * omega);
      const frame = Math.floor((fract(angle / quarter)) * sp.frames) % sp.frames;
      ctx.drawImage(sp.canvas, frame * sp.fw, 0, sp.fw, sp.fh, F.ax + m.x * F.z - sp.cx * k, F.ay + m.y * F.z - sp.cy * k, sp.fw * k, sp.fh * k);
      sailsDrawn++;
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Smoke, windmill sails and birds. Draw after the settlements and banners, before fx and fog.
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} cam
   * @param {{minX:number,minY:number,maxX:number,maxY:number}} [visible]
   */
  function drawAir(ctx, cam, visible) {
    if (!enabled) return;
    const t0 = clock();
    refreshHidden();
    prep(cam, visible);
    sprites.beginFrame(spriteBudgetMs);
    if (features.smoke) drawSmoke(ctx); else smokeDrawn = 0;
    if (features.sails) drawSails(ctx); else sailsDrawn = 0;
    birdsDrawn = !features.birds || (reduceMotion && !AMBIENT.reduceMotion.birds) ? 0 : birds.draw(ctx, F);
    lastAirMs = clock() - t0;
    airMs += (lastAirMs - airMs) * 0.08;
  }

  // ---- controls ---------------------------------------------------------------------------------
  return {
    rebuild,
    update,
    drawGround,
    drawAir,
    /** Reduce Motion: no birds, static sails, half the smoke, caravans at 60 % speed. */
    setReduceMotion(v) {
      const b = !!v;
      if (b === reduceMotion) return;
      reduceMotion = b;
      if (b) birds.reset();
    },
    /** 0..1; 0 halves every count (carts, smoke puffs, boats, flock size) and drops dust and bird shadows. */
    setQuality(q) {
      quality = clamp01(Number.isFinite(q) ? q : 1);
      qf = AMBIENT.quality.minFactor + (1 - AMBIENT.quality.minFactor) * quality;
    },
    /** false: draw and update nothing (battle arena). Time stands still while disabled. */
    setEnabled(v) {
      enabled = !!v;
    },
    /**
     * Hide everything that belongs to some regions (fog, battle arena). `fn(regionId) => true` when
     * hidden, or an array indexed by region id (truthy = hidden), or null to clear.
     */
    setHiddenMask(fnOrArray) {
      maskSrc = fnOrArray || null;
      refreshHidden();
    },
    /** Switch single layers off (`{ smoke: false }`): caravans, smoke, sails, boats, birds. For tests and profiling. */
    setFeatures(patch) {
      Object.assign(features, patch);
    },
    setPixelRatio(v) {
      const next = Math.min(2, Math.max(1, v || 1));
      if (next !== dpr) { dpr = next; sprites.clear(); }
    },
    /**
     * Bakes every sprite the zoom's bucket can need (about 30 ms, all at once). Optional: without it the
     * sprites bake lazily, at most `AMBIENT.spriteBudgetMs` per frame. Call it once after boot / `applyWorld`
     * for the framing zoom.
     */
    prewarm(zoom) {
      sprites.prewarm(bucketIndex(zoom * dpr));
    },
    /** Gallery / test hook: start a flock over the current view right now. */
    spawnFlock() {
      return haveView ? birds.spawnNow(lastView, hidden, qf) : false;
    },
    stats() {
      return {
        enabled, quality, reduceMotion, time: t, caravanClock: carT,
        caravans: caravans.stats(),
        smokeSources: smoke.n, smokePlumesDrawn: smokePlumes, smokePuffsDrawn: smokeDrawn,
        windmills: mills.length, sailsDrawn,
        boats: boats.length, boatsDrawn,
        birdsActive: birds.active, birdsDrawn,
        groundMs: groundMs, airMs: airMs, lastGroundMs, lastAirMs,
        totalMs: groundMs + airMs,
        spriteCount: sprites.count(), buckets: BUCKETS.length,
      };
    },
    /** Read-only view of the current caravan routes (gallery overlay, tests). */
    get routes() { return caravans.routes; },
    /** Read-only boat lanes (gallery focus helpers, tests). */
    get boatLanes() { return lanes; },
    get plan() { return plan; },
    get windmills() { return mills; },
  };
}
