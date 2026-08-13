// The battle board renderer. TWO CANVASES, deliberately:
//
//   #board-bg  terrain, the territory flood and site base shapes. Repainted
//              ONLY when the background is dirty — an
//              ownership or level change, i.e. roughly once a second, not
//              sixty times.
//   #board-fx  everything that moves: squads, garrison bars, HP rings, siege
//              progress, selection, the drag arc. Cleared and redrawn every
//              frame.
//
// The whole fx path is allocation-free: scratch vectors live at module scope,
// dash patterns are mutated in place, draws are batched by colour, `ctx.font`
// is assigned exactly once per frame, and there is no `shadowBlur` anywhere
// (it costs 10-50x a plain fill).
import { UNIT_IDS } from '../content/balance.js';
import { createSurface, createCamera, pointerPos } from './canvas.js';
import { createBgCache } from './bgcache.js';
import { palette as loadPalette } from './palette.js';
import {
  computeOwners, drawPlates, drawFlood, drawFrontLine, drawBlocked, drawGridLines,
  makeHatch, hexCx, hexCy, gridBounds,
} from './hexRenderer.js';
import {
  siteRadius, drawSiteBase, drawHpRing, drawSiegeRing, drawSiteState,
  drawGarrisonPlaque, drawSelection, drawHover, garrisonLabelY, builtLevel,
} from './siteGlyphs.js';
import { siteHeadYAt } from './siteShapes.js';
import { drawBuildBar } from './siteBuild.js';
import { drawBuildTargets } from './buildTargets.js';
import {
  drawSquads, drawSquadLabels, drawDragArc, drawBox, drawSquadRoutes,
} from './routes.js';
import { drawRallies, drawRallyDrag } from './rallyLines.js';
import { drawStaticFormation } from './formation.js';
import { numStr } from '../ui/format.js';
// FOG OF WAR. `perceivedSite`/`perceivedSquads` are the one resolver every
// surface is meant to call (battle/vision.js); `fog.js` is the renderer's own
// half — the drawn flood and the veil, neither of which is "hide one object".
import { perceivedSite, perceivedSquads } from '../battle/vision.js';
import {
  perceivedInfluence, computeVeil, drawVeil, GHOST_ALPHA,
} from './fog.js';
import { capOf, signature } from './battleViewSig.js';

const HEX_SIZE = 34;   // world units; the camera does all the zooming
const LABEL_PX = 14;   // constant on-screen size at any zoom
const OWNERS3 = ['player', 'enemy', 'neutral'];
const OWNERS2 = ['player', 'enemy'];

const _a = { x: 0, y: 0 };
const _bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/** Space the HUD occupies over the board: the gold/clock row on top and the
 *  strength/filter/booster dock below. The sides are the player's. */
const HUD_INSETS = Object.freeze({ top: 56, bottom: 96, left: 8, right: 8 });

/**
 * @param {{bg:HTMLCanvasElement, fx:HTMLCanvasElement, hexSize?:number,
 *          fxLayer?:object, viewFaction?:'player'|'enemy'}} opts
 *   `viewFaction` is who the board is drawn FOR — always 'player' in
 *   practice (screens/battle.js is the one caller), but threaded through
 *   rather than hardcoded so nothing here has to assume it.
 */
export function createBattleView(opts) {
  const p = loadPalette();
  const hexSize = opts.hexSize ?? HEX_SIZE;
  const viewFaction = opts.viewFaction ?? 'player';
  const camera = createCamera({ minZoom: 0.3, maxZoom: 2.6 });
  const bgCache = createBgCache({ el: opts.bg, camera });
  let autoFit = true;

  let lastSig = NaN;
  let owners = new Uint8Array(0);
  let veil = new Uint8Array(0);
  let blockedSig = null;
  let spin = 0;
  let state0 = null;
  let fontZoom = -1;
  let fontStr = '';

  const onResize = (w, hgt) => { camera.setViewport(w, hgt); bgCache.markDirty(true); };
  let firstFit = true;
  const bg = createSurface(opts.bg, { alpha: false, onResize });
  const fx = createSurface(opts.fx, { alpha: true, onResize });
  camera.setViewport(bg.cssW, bg.cssH);

  // Reused on every background repaint; never reallocated.
  const board = {
    cols: 0, rows: 0, size: hexSize, owners, blocked: new Set(),
    palette: p, hatch: makeHatch(bg.ctx, p.hatchA, p.hatchB, 12),
    zoom: 1, lineWidth: 1,
  };
  // Geometry bundle handed to routes.js — stable references, so passing it
  // every frame allocates nothing.
  // `hexPos` answers for a bare hex what `pos` answers for a site — a route is
  // hexes now, not buildings — and `sitePos` defers to it, so there is one
  // formula. Squad hit-testing needs it too; see screens/battle-orders.js.
  const hexPos = (q, r, o) => { o.x = hexCx(q, r, hexSize); o.y = hexCy(q, r, hexSize); return o; };
  const sitePos = (s2, out) => hexPos(s2.hex[0], s2.hex[1], out);
  const geo = { palette: p, hexSize, pos: sitePos, hexPos, byId };

  // PERCEIVED, not raw — every consumer below (hover/selection halos, the drag
  // and rally previews, a squad's endpoints) gets whatever this faction
  // actually knows about that site, so a halo traced around a ghost can never
  // draw the storeys of a level it has not seen (see siteShapes.js
  // traceStructure). Position and kind are common knowledge either way.
  function byId(id) {
    const list = state0.sites;
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return perceivedSite(state0, viewFaction, list[i]);
    }
    return null;
  }

  const api = {
    camera,
    hexSize,
    get palette() { return p; },

    markBgDirty(force) { bgCache.markDirty(force); },
    releaseAutoFit() { autoFit = false; },

    /** Frame the whole grid — on first draw, and on resize until the player
     *  takes manual control of the camera. */
    fitTo(state, pad = 20, insets = HUD_INSETS) {
      gridBounds(state.grid.cols, state.grid.rows, hexSize, _bounds);
      camera.fit(_bounds, pad, insets);
      bgCache.markDirty(true);
    },

    sitePos,
    hexPos,
    /** Screen-space centre of a site — the HUD hangs the training picker here. */
    siteScreen(site, out) {
      sitePos(site, _a);
      return camera.worldToScreen(_a.x, _a.y, out);
    },
    toWorld(sx, sy, out) { return camera.screenToWorld(sx, sy, out); },
    pointer(ev, out) { return pointerPos(opts.fx, ev, out); },

    /** Nearest site body containing (wx,wy), with slop so a fingertip on a
     *  phone never misses a target it visually covered. */
    siteAt(state, wx, wy, slop = 1.25) {
      let best = null;
      let bestD = Infinity;
      for (let i = 0; i < state.sites.length; i++) {
        const s = state.sites[i];
        sitePos(s, _a);
        const dx = wx - _a.x;
        const dy = wy - _a.y;
        const d = dx * dx + dy * dy;
        const rr = siteRadius(s.kind, hexSize) * slop + hexSize * 0.25;
        if (d < rr * rr && d < bestD) { bestD = d; best = s; }
      }
      return best;
    },

    /**
     * @param {object} state battle state (never mutated here)
     * @param {number} alpha loop interpolation factor in [0,1)
     * @param {object} view  presentation state owned by battle-input.js
     */
    draw(state, alpha, view, frameMs) {
      state0 = state;
      if (autoFit && firstFit) { api.fitTo(state); firstFit = false; }
      const sig = signature(state);
      // Ownership, level or influence changed: that is a REPAINT, not a slide.
      if (sig !== lastSig) { lastSig = sig; bgCache.markDirty(true); }
      if (bgCache.take()) redrawBg(state);
      bgCache.sync();
      // WALL-CLOCK, not per-frame. This was a flat `+= 0.016` every frame, so
      // on a 120Hz display every siege ring rotated and every selection pulsed
      // at exactly double speed — the animation ran at whatever rate the
      // monitor happened to be. The caller already has the real delta.
      spin += (Number.isFinite(frameMs) ? frameMs : 16) / 1000;
      drawFrame(state, alpha, view);
    },

    dispose() { bg.dispose(); fx.dispose(); },
  };

  // ---- background ---------------------------------------------------------

  function redrawBg(state) {
    const ctx = bg.ctx;
    bgCache.painted();
    bg.fill(p.bg);
    board.cols = state.grid.cols;
    board.rows = state.grid.rows;
    board.zoom = camera.zoom;
    board.lineWidth = 1 / camera.zoom;
    // Compared by IDENTITY, not by length: two different maps with the same
    // number of mountains are not the same mountains, and a length check would
    // paint the previous battle's peaks over the new one. `grid.blocked` is
    // built once in state.js and never mutated, so the reference changes exactly
    // when the map does.
    if (state.grid.blocked !== blockedSig) {
      blockedSig = state.grid.blocked;
      board.blocked = new Set(state.grid.blocked);
    }
    // THE DRAWN FLOOD, not the sim's — see render/fog.js. state.influence
    // itself is never touched, so the castle gate, territory score and march
    // speed all keep reading the true one.
    owners = computeOwners(
      perceivedInfluence(state, viewFaction), board.cols, board.rows, owners,
    );
    board.owners = owners;
    veil = computeVeil(state, viewFaction, board.cols, board.rows, veil);

    camera.applyTo(ctx, bg.dpr);
    drawPlates(ctx, board);
    drawFlood(ctx, board);
    drawBlocked(ctx, board);
    drawGridLines(ctx, board);
    board.lineWidth = 2.5 / camera.zoom;
    drawFrontLine(ctx, board);
    for (let i = 0; i < state.sites.length; i++) {
      // A ghost draws too — kind and position are common knowledge (design
      // decision 9) — but faded, so it reads as remembered rather than live.
      const s = perceivedSite(state, viewFaction, state.sites[i]);
      sitePos(s, _a);
      if (s.ghost) ctx.globalAlpha = GHOST_ALPHA;
      drawSiteBase(ctx, s, _a.x, _a.y, siteRadius(s.kind, hexSize), p, 1 / camera.zoom);
      if (s.ghost) ctx.globalAlpha = 1;
    }
    // THE VEIL (moved here from drawFrame — see the perf report). Vision
    // changes exactly on the events that already force a repaint here
    // (recomputeVision bumps `influenceVersion`, folded into `signature()`),
    // so this stays as stale-free as the per-frame version, without paying
    // #board-fx's per-frame recomposite — filling ~90% of a late board
    // translucent 60x/s, measured as most of a throttled frame's cost.
    drawVeil(ctx, veil, board.cols, board.rows, hexSize, p);
  }

  // THE LINK GRAPH IS GONE, and deleting it was the point rather than a tidy-up.
  //
  // It drew one line per `site.adj` entry, and its own comment said why: "sends
  // go to adjacent sites only, so the graph is drawn explicitly — the rule
  // should never be something the player has to infer from a rejection." That
  // rule no longer exists. An army marches anywhere it can find a path to, and
  // `adj` was redefined as REACH — every site within `MOVEMENT.reachHexes` —
  // which is a scan bound for the AI and the harness, not a promise to anybody.
  //
  // So the lines had stopped being information and become an anti-explanation:
  // at hex reach a late map draws forty-odd of them into a cobweb that connects
  // nearly everything to nearly everything, and what it tells the player is a
  // constraint the engine gave up enforcing. A screenshot found this; no test
  // could, because every one of them still drew correctly.
  //
  // What replaces it is the ground itself — the mountains, the shape mask and
  // the bases that deny their own hex are all already drawn, and they are what
  // actually decides where an army can go.

  // ---- per-frame ----------------------------------------------------------

  function drawFrame(state, alpha, view) {
    const ctx = fx.ctx;
    fx.clear();
    camera.applyTo(ctx, fx.dpr);
    const px = 1 / camera.zoom;
    const t = state.tick + (alpha > 0 ? (alpha < 1 ? alpha : 1) : 0);
    const pulse = 0.5 + 0.5 * Math.sin(spin * 3);
    // Own squads always; the enemy's only while this faction can see them
    // (battle/vision.js perceivedSquads) — computed ONCE and threaded through
    // every consumer below, so a route line or a formation block can never
    // disagree with the troop pieces about who is visible.
    const visSquads = perceivedSquads(state, viewFaction);

    // UNDER the sites and the squads, unlike the pass at the end of this
    // function. A capture wash drawn on top reads as a filter over the board;
    // drawn underneath it reads as the ground itself changing hands.
    opts.fxLayer?.drawGround(ctx, p, px);
    // The veil now paints onto #board-bg, in redrawBg — see the comment
    // there for why this moved off the per-frame canvas.
    drawRallies(ctx, state, viewFaction, px, geo);
    drawSquadRoutes(ctx, visSquads, px, geo);
    drawHighlights(ctx, state, view, px, pulse);
    if (view?.dragFrom) {
      const from = byId(view.dragFrom);
      const to = view.dragTo ? byId(view.dragTo) : null;
      if (from) {
        // One arc, straight from the source: free movement means a send is
        // never routed through a waypoint drawn on the way, only aimed.
        drawDragArc(ctx, from, to, view.pointer, px, geo);
        if (to) {
          sitePos(to, _a);
          drawSelection(ctx, to, _a.x, _a.y, siteRadius(to.kind, hexSize), p, px, 1);
        }
      }
    }
    if (view?.rallyFrom) {
      const from = byId(view.rallyFrom);
      const to = view.rallyTo ? byId(view.rallyTo) : null;
      if (from) {
        drawRallyDrag(ctx, from, to, view.pointer, px, geo);
        if (to && to.id !== from.id) {
          sitePos(to, _a);
          drawSelection(ctx, to, _a.x, _a.y, siteRadius(to.kind, hexSize), p, px, 1);
        }
      }
    }
    if (view?.box) drawBox(ctx, view.box, px, geo);
    // Ground, not a site — drawn before the site loop so the pieces sitting
    // on top of it stay crisp rather than tinted along with the hexes.
    drawBuildTargets(ctx, state, view, hexSize, p, px);

    for (let i = 0; i < state.sites.length; i++) {
      const s = perceivedSite(state, viewFaction, state.sites[i]);
      sitePos(s, _a);
      const r = siteRadius(s.kind, hexSize);
      if (s.ghost) continue; // a building you know is there, and nothing else
      drawSiteState(ctx, s, _a.x, _a.y, r, p, px);
      drawBuildBar(ctx, s, _a.x, _a.y, r, p, px);
      drawHpRing(ctx, s, _a.x, _a.y, r, p, px);
      drawSiegeRing(ctx, s, _a.x, _a.y, r, p, px, spin);
      drawGarrisonPlaque(ctx, s.garrison, capOf(s), _a.x, _a.y, r, p, px, hexSize);
      if (s.siege) drawSiegeStack(ctx, s, _a.x, _a.y, r, px);
    }

    drawSquads(ctx, visSquads, t, px, geo);
    opts.fxLayer?.draw(ctx, p, px);
    drawLabels(ctx, state, visSquads, t, px);
  }

  function drawHighlights(ctx, state, view, px, pulse) {
    if (!view) return;
    if (view.hoverId) {
      const s = byId(view.hoverId);
      if (s) {
        sitePos(s, _a);
        drawHover(ctx, s, _a.x, _a.y, siteRadius(s.kind, hexSize), p, px);
      }
    }
    for (let i = 0; i < view.selection.length; i++) {
      const s = byId(view.selection[i]);
      if (!s) continue;
      sitePos(s, _a);
      drawSelection(ctx, s, _a.x, _a.y, siteRadius(s.kind, hexSize), p, px, pulse);
    }
  }

  /** A besieging stack sits ON the site it is grinding down, offset upward so
   *  it never hides the garrison plaque beneath.
   *
   *  Drawn as troops, at the SAME piece size drawSquads uses, because a siege is
   *  exactly when the player is asking "is this enough to hold?" against the
   *  relieving columns walking toward it — and that comparison only works if a
   *  besieging soldier is the same size as a marching one.
   *
   *  `angle` faces the wall (+PI/2, down the screen toward the site), which is
   *  the opposite of the chevron this replaces: it puts the militia screen
   *  against the structure and sweeps the crescent's wings the right way. */
  function drawSiegeStack(ctx, site, cx, cy, r, px) {
    // Hung off the built roofline rather than a fixed 1.25r, because a level-3
    // tower now grows up into where the besiegers used to sit. At L1 this is
    // 1.22r, so an un-upgraded site is unchanged.
    const head = siteHeadYAt(site.kind, builtLevel(site)) + 0.3;
    drawStaticFormation(ctx, site.siege.comp, cx, cy - r * head - px * 20,
      Math.PI / 2, Math.max(hexSize * 0.1, px * 2.2), site.siege.owner, px, p);
  }

  /** ONE text pass, ONE `ctx.font` assignment, batched by colour. The font
   *  string is cached against zoom so a steady camera allocates nothing.
   *  `squads` is the PERCEIVED list drawFrame already built. */
  function drawLabels(ctx, state, squads, t, px) {
    if (camera.zoom !== fontZoom) {
      fontZoom = camera.zoom;
      fontStr = `700 ${(LABEL_PX * px).toFixed(2)}px ui-monospace, Menlo, monospace`;
    }
    ctx.font = fontStr;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let o = 0; o < OWNERS3.length; o++) {
      const owner = OWNERS3[o];
      ctx.fillStyle = p.owner[owner];
      for (let i = 0; i < state.sites.length; i++) {
        // Ghost or not, no digits over ground you cannot currently verify.
        const s = perceivedSite(state, viewFaction, state.sites[i]);
        if (s.ghost || s.owner !== owner) continue;
        let n = 0;
        for (let k = 0; k < UNIT_IDS.length; k++) n += s.garrison[UNIT_IDS[k]] || 0;
        sitePos(s, _a);
        ctx.fillText(numStr(n), _a.x, _a.y + garrisonLabelY(s.kind, hexSize, px));
      }
    }
    ctx.textBaseline = 'middle';
    for (let o = 0; o < OWNERS2.length; o++) {
      ctx.fillStyle = p.owner[OWNERS2[o]];
      drawSquadLabels(ctx, squads, t, px, geo, OWNERS2[o]);
    }
    // Floating numbers share this pass, so the font is still set exactly once.
    opts.fxLayer?.drawText(ctx, p, px);
  }

  return api;
}

// capOf/signature moved to ./battleViewSig.js at the 400-line cap — see the
// import above; neither was exported from here, so nothing else changes.
