// The battle board renderer. TWO CANVASES, deliberately:
//
//   #board-bg  terrain, the territory flood and site base shapes. Repainted
//              ONLY when the background is dirty — an ownership or level
//              change, i.e. roughly once a second, not sixty times.
//   #board-fx  everything that moves: squads, garrison bars, HP rings, siege
//              progress, selection, the drag arc. Redrawn every frame.
//
// The whole fx path is allocation-free: scratch vectors live at module scope,
// dash patterns are mutated in place, draws are batched by colour, `ctx.font`
// is assigned exactly once per frame, and there is no `shadowBlur` anywhere
// (it costs 10-50x a plain fill).
import { createSurface, createCamera, pointerPos } from './canvas.js';
import { createBgCache } from './bgcache.js';
import { palette as loadPalette } from './palette.js';
import {
  computeOwners, drawPlates, drawFlood, drawFrontLine, drawBlocked, drawGridLines,
  makeHatch, makeOwnerHatches, hexCx, hexCy, gridBounds,
} from './hexRenderer.js';
import {
  siteRadius, drawSiteBase, drawHpRing, drawSiegeRing, drawSiteState,
  drawGarrisonPlaque, drawSelection, drawHover, builtLevel, siteStackY, siteStackLen,
} from './siteGlyphs.js';
import { siteHeadYAt } from './siteShapes.js';
import { drawBuildBar } from './siteBuild.js';
import { drawBuildTargets } from './buildTargets.js';
import { drawAlarm } from './alarm.js';
import {
  drawSquads, drawDragArc, drawBox, drawSquadRoutes,
} from './routes.js';
import { drawRallies, drawRallyDrag } from './rallyLines.js';
import { drawStaticFormation } from './formation.js';
// FOG OF WAR. `perceivedSite`/`perceivedSquads` are the one resolver every
// surface is meant to call (battle/vision.js); `fog.js` is the renderer's own
// half — the drawn flood and the veil, neither of which is "hide one object".
import { perceivedSite, perceivedSquads, siteKnown } from '../battle/vision.js';
import {
  perceivedInfluence, computeVeil, drawVeil, GHOST_ALPHA, drawAssaultWash,
} from './fog.js';
import { capOf, signature, squadSightSig } from './battleViewSig.js';
import { createLabelPass } from './battleLabels.js';

const HEX_SIZE = 34;   // world units; the camera does all the zooming

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
  let owners = new Uint8Array(0); let veil = new Uint8Array(0); // per-hex, grown in place
  let blockedSig = null; let spin = 0; let state0 = null;

  const onResize = (w, hgt) => { camera.setViewport(w, hgt); bgCache.markDirty(true); };
  let firstFit = true;
  const bg = createSurface(opts.bg, { alpha: false, onResize });
  const fx = createSurface(opts.fx, { alpha: true, onResize });
  camera.setViewport(bg.cssW, bg.cssH);

  // Reused on every background repaint; never reallocated.
  const board = {
    cols: 0, rows: 0, size: hexSize, owners, blocked: new Set(),
    palette: p, hatch: makeHatch(bg.ctx, p.hatchA, p.hatchB, 12),
    // Ownership's second channel — a stripe DIRECTION per faction, so the two
    // territories differ by more than hue (hexRenderer.js `ownerWeave`).
    ownerHatch: makeOwnerHatches(bg.ctx, p),
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
  const drawLabels = createLabelPass({
    camera, palette: p, viewFaction, sitePos, hexSize, geo, scratch: _a,
  });

  // PERCEIVED, not raw — every consumer below (hover/selection halos, the drag
  // and rally previews, a squad's endpoints) gets whatever this faction
  // actually knows about that site, so a halo traced around a ghost can never
  // draw the storeys of a level it has not seen (see siteShapes.js
  // traceStructure). A site this faction has NEVER SEEN resolves to null rather
  // than to a ghost, exactly as it draws nothing and hit-tests to nothing —
  // `siteKnown` is the one predicate all three ask, so an unscouted building
  // cannot be invisible on the board and still reachable through a halo.
  function byId(id) {
    const list = state0.sites;
    for (let i = 0; i < list.length; i++) {
      if (list[i].id !== id) continue;
      if (!siteKnown(state0, viewFaction, list[i])) return null;
      return perceivedSite(state0, viewFaction, list[i]);
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
        // A BUILDING YOU HAVE NEVER SEEN IS NOT PICKABLE, for the same reason
        // squadpick already refuses an unseen column: a thing that draws
        // nothing and still answers the cursor is a worse tell than drawing
        // it, because the player finds it by sweeping empty dark.
        if (!siteKnown(state, viewFaction, s)) continue;
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
      // ...plus WHERE THIS FACTION'S ARMIES ARE. The veil is painted on the
      // background, and a squad lights its own ring — so without this the fog
      // never opened ahead of a march nor closed behind it. It is a hex-crossing
      // trigger, not a per-tick one; see battleViewSig.js `squadSightSig`.
      const sig = (signature(state) * 31 + squadSightSig(state, viewFaction)) | 0;
      // Ownership, level, influence or a column's position changed: that is a
      // REPAINT, not a slide.
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
    // The repaint TIMES ITSELF, and the number sizes the next gate — see
    // bgcache.js, where the fixed 8/s was a claim about a 54ms repaint that a
    // 2880-hex board turns into 168ms.
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
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
      // A GHOST DRAWS, faded, so it reads as remembered rather than live — but
      // only once this faction has actually LOOKED at it. Position and kind
      // used to be common knowledge from tick 0 for the player as well as for
      // the commander; that made the enemy's whole economy and defence layout
      // readable at a glance, which is exactly what the owner asked to lose.
      // The commander keeps it (battle/belief.js reads `perceivedSite`
      // directly and plans over the whole map), so this is a change to what
      // the screen shows, not to what either side can reason about.
      if (!siteKnown(state, viewFaction, state.sites[i])) continue;
      const s = perceivedSite(state, viewFaction, state.sites[i]);
      sitePos(s, _a);
      if (s.ghost) ctx.globalAlpha = GHOST_ALPHA;
      drawSiteBase(ctx, s, _a.x, _a.y, siteRadius(s.kind, hexSize), p, 1 / camera.zoom);
      if (s.ghost) ctx.globalAlpha = 1;
    }
    // THE VEIL lives here rather than on #board-fx: vision changes exactly on
    // the events that already force a repaint (recomputeVision bumps
    // `influenceVersion`, folded into `signature()`), so it is as stale-free as
    // a per-frame version without paying the per-frame recomposite — filling
    // ~90% of a late board translucent 60x/s was most of a throttled frame.
    drawVeil(ctx, veil, board.cols, board.rows, hexSize, p);
    drawAssaultWash(ctx, state, viewFaction, board.cols, board.rows, hexSize, p); // over the veil, see fog.js
    bgCache.spent((typeof performance !== 'undefined' ? performance : Date).now() - t0);
  }

  // THE LINK GRAPH IS GONE, and deleting it was the point. It drew one line per
  // `site.adj` to advertise "sends go to adjacent sites only" — a rule free
  // movement retired, after which a late map drew forty-odd lines into a cobweb
  // describing a constraint the engine no longer enforced. A screenshot found
  // it; no test could, because every line still drew correctly.

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
        // The ROUTE, not an arc — see routes.js and battle-waypoints.js
        // `previewPath`. Null falls back to the old dashed arc.
        drawDragArc(ctx, from, to, view.pointer, px, geo, view.dragPath);
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
      // A MELEE DRAWS EXACTLY LIKE A SIEGE, and it has to: for `MELEE.seconds`
      // the attacking column is off `state.squads` and lives in `site.melee`,
      // so drawing only sieges makes an assault VANISH for six seconds and
      // reappear as besiegers — the one opening the whole layer exists to give
      // the player something to do in.
      if (s.siege) drawSiteStack(ctx, s, s.siege.comp, s.siege.owner, _a.x, _a.y, r, px);
      else if (s.melee) drawSiteStack(ctx, s, s.melee.comp, s.melee.owner, _a.x, _a.y, r, px);
    }

    drawSquads(ctx, visSquads, t, px, geo);
    opts.fxLayer?.draw(ctx, p, px);
    drawLabels(ctx, state, visSquads, t, px, opts.fxLayer);
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
    // LAST, so the one site that needs attention is not drawn over by a
    // selection halo the player set several seconds ago.
    drawAlarm(ctx, view, byId, sitePos, _a, hexSize, p, px, pulse);
  }

  /** A stack that is AT a site rather than marching to one — besieging it, or
   *  fighting its garrison outside the walls. It sits ON the site, offset upward
   *  so it never hides the garrison plaque, at the SAME piece size drawSquads
   *  uses: this is exactly when the player asks "is this enough to hold?"
   *  against the relieving columns walking toward it, and that comparison only
   *  works if a besieging soldier is the same size as a marching one. `angle`
   *  faces the wall (+PI/2, down the screen). The offset is hung off the built
   *  roofline rather than a fixed 1.25r, because a level-3 tower grows up into
   *  where the besiegers used to sit; at L1 it is 1.22r, so an un-upgraded site
   *  is unchanged. */
  function drawSiteStack(ctx, site, comp, owner, cx, cy, r, px) {
    drawStaticFormation(ctx, comp, cx, cy + siteStackY(site.kind, builtLevel(site), r, px),
      Math.PI / 2, siteStackLen(hexSize, px), owner, px, p);
  }

  return api;
}

// capOf/signature moved to ./battleViewSig.js and the whole text pass to
// ./battleLabels.js, both at the 400-line cap — see the imports above. Nothing
// here was ever exported, so no consumer changes.
