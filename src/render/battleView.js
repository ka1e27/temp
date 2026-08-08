// The battle board renderer. TWO CANVASES, deliberately:
//
//   #board-bg  terrain, the territory flood, the adjacency graph and site base
//              shapes. Repainted ONLY when the background is dirty — an
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
import { UNIT_IDS, SITES, SITE_LEVELS } from '../content/balance.js';
import { createSurface, createCamera, pointerPos } from './canvas.js';
import { palette as loadPalette } from './palette.js';
import {
  computeOwners, drawPlates, drawFlood, drawFrontLine, drawBlocked, drawGridLines,
  makeHatch, hexCx, hexCy, gridBounds,
} from './hexRenderer.js';
import {
  siteRadius, drawSiteBase, drawHpRing, drawSiegeRing, drawSiteState,
  drawGarrisonPlaque, drawSelection, drawHover, garrisonLabelY,
} from './siteGlyphs.js';
import {
  drawSquads, drawSquadLabels, drawRallies, drawDragArc, drawBox,
} from './routes.js';
import { drawStaticFormation } from './formation.js';
import { numStr } from '../ui/format.js';

const HEX_SIZE = 34;   // world units; the camera does all the zooming
const LABEL_PX = 14;   // constant on-screen size at any zoom
const OWNER_N = { player: 1, enemy: 2, neutral: 3 };
const OWNERS3 = ['player', 'enemy', 'neutral'];
const OWNERS2 = ['player', 'enemy'];

const _a = { x: 0, y: 0 };
const _b = { x: 0, y: 0 };
const _bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/** Space the HUD occupies over the board: the gold/clock row on top and the
 *  strength/filter/booster dock below. The sides are the player's. */
const HUD_INSETS = Object.freeze({ top: 56, bottom: 96, left: 8, right: 8 });

/**
 * @param {{bg:HTMLCanvasElement, fx:HTMLCanvasElement, hexSize?:number,
 *          fxLayer?:object}} opts
 */
export function createBattleView(opts) {
  const p = loadPalette();
  const hexSize = opts.hexSize ?? HEX_SIZE;
  const camera = createCamera({ minZoom: 0.3, maxZoom: 2.6 });
  let autoFit = true;
  let bgDirty = true;
  let lastSig = NaN;
  let owners = new Uint8Array(0);
  let blockedSig = null;
  let spin = 0;
  let state0 = null;
  let fontZoom = -1;
  let fontStr = '';

  const onResize = (w, hgt) => { camera.setViewport(w, hgt); bgDirty = true; };
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
  const geo = { palette: p, hexSize, pos: sitePos, byId };

  function sitePos(site, out) {
    out.x = hexCx(site.hex[0], site.hex[1], hexSize);
    out.y = hexCy(site.hex[0], site.hex[1], hexSize);
    return out;
  }

  function byId(id) {
    const list = state0.sites;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  const api = {
    camera,
    hexSize,
    get palette() { return p; },

    markBgDirty() { bgDirty = true; },
    releaseAutoFit() { autoFit = false; },

    /** Frame the whole grid — on first draw, and on resize until the player
     *  takes manual control of the camera. */
    fitTo(state, pad = 20, insets = HUD_INSETS) {
      gridBounds(state.grid.cols, state.grid.rows, hexSize, _bounds);
      camera.fit(_bounds, pad, insets);
      bgDirty = true;
    },

    sitePos,
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
    draw(state, alpha, view) {
      state0 = state;
      if (autoFit && bgDirty) api.fitTo(state);
      const sig = signature(state);
      if (sig !== lastSig) { lastSig = sig; bgDirty = true; }
      if (bgDirty) { redrawBg(state); bgDirty = false; }
      spin += 0.016;
      drawFrame(state, alpha, view);
    },

    dispose() { bg.dispose(); fx.dispose(); },
  };

  // ---- background ---------------------------------------------------------

  function redrawBg(state) {
    const ctx = bg.ctx;
    bg.fill(p.bg);
    board.cols = state.grid.cols;
    board.rows = state.grid.rows;
    board.zoom = camera.zoom;
    board.lineWidth = 1 / camera.zoom;
    if (state.grid.blocked.length !== blockedSig) {
      blockedSig = state.grid.blocked.length;
      board.blocked = new Set(state.grid.blocked);
    }
    owners = computeOwners(state.influence, board.cols, board.rows, owners);
    board.owners = owners;

    camera.applyTo(ctx, bg.dpr);
    drawPlates(ctx, board);
    drawFlood(ctx, board);
    drawBlocked(ctx, board);
    drawGridLines(ctx, board);
    board.lineWidth = 2.5 / camera.zoom;
    drawFrontLine(ctx, board);
    drawLinks(ctx, state, 1 / camera.zoom);
    for (let i = 0; i < state.sites.length; i++) {
      const s = state.sites[i];
      sitePos(s, _a);
      drawSiteBase(ctx, s, _a.x, _a.y, siteRadius(s.kind, hexSize), p, 1 / camera.zoom);
    }
  }

  /** Sends go to adjacent sites only, so the graph is drawn explicitly — the
   *  rule should never be something the player has to infer from a rejection. */
  function drawLinks(ctx, state, px) {
    ctx.beginPath();
    for (let i = 0; i < state.sites.length; i++) {
      const s = state.sites[i];
      sitePos(s, _a);
      for (let j = 0; j < s.adj.length; j++) {
        const o = byId(s.adj[j]);
        if (!o || o.id < s.id) continue;
        sitePos(o, _b);
        ctx.moveTo(_a.x, _a.y);
        ctx.lineTo(_b.x, _b.y);
      }
    }
    ctx.strokeStyle = p.link;
    ctx.lineWidth = px * 2.5;
    ctx.stroke();
  }

  // ---- per-frame ----------------------------------------------------------

  function drawFrame(state, alpha, view) {
    const ctx = fx.ctx;
    fx.clear();
    camera.applyTo(ctx, fx.dpr);
    const px = 1 / camera.zoom;
    const t = state.tick + (alpha > 0 ? (alpha < 1 ? alpha : 1) : 0);
    const pulse = 0.5 + 0.5 * Math.sin(spin * 3);

    drawRallies(ctx, state, px, geo);
    drawHighlights(ctx, state, view, px, pulse);
    if (view?.dragFrom) {
      const from = byId(view.dragFrom);
      const to = view.dragTo ? byId(view.dragTo) : null;
      if (from) {
        drawDragArc(ctx, from, to, view.pointer, px, geo);
        if (to) {
          sitePos(to, _a);
          drawSelection(ctx, to, _a.x, _a.y, siteRadius(to.kind, hexSize), p, px, 1);
        }
      }
    }
    if (view?.box) drawBox(ctx, view.box, px, geo);

    for (let i = 0; i < state.sites.length; i++) {
      const s = state.sites[i];
      sitePos(s, _a);
      const r = siteRadius(s.kind, hexSize);
      drawSiteState(ctx, s, _a.x, _a.y, r, p, px);
      drawHpRing(ctx, s, _a.x, _a.y, r, p, px);
      drawSiegeRing(ctx, s, _a.x, _a.y, r, p, px, spin);
      drawGarrisonPlaque(ctx, s.garrison, capOf(s), _a.x, _a.y, r, p, px, hexSize);
      if (s.siege) drawSiegeStack(ctx, s, _a.x, _a.y, r, px);
    }

    drawSquads(ctx, state, t, px, geo);
    opts.fxLayer?.draw(ctx, p, px);
    drawLabels(ctx, state, t, px);
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
    drawStaticFormation(ctx, site.siege.comp, cx, cy - r * 1.25 - px * 20,
      Math.PI / 2, Math.max(hexSize * 0.1, px * 2.2), site.siege.owner, px, p);
  }

  /** ONE text pass, ONE `ctx.font` assignment, batched by colour. The font
   *  string is cached against zoom so a steady camera allocates nothing. */
  function drawLabels(ctx, state, t, px) {
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
        const s = state.sites[i];
        if (s.owner !== owner) continue;
        let n = 0;
        for (let k = 0; k < UNIT_IDS.length; k++) n += s.garrison[UNIT_IDS[k]] || 0;
        sitePos(s, _a);
        ctx.fillText(numStr(n), _a.x, _a.y + garrisonLabelY(s.kind, hexSize, px));
      }
    }
    ctx.textBaseline = 'middle';
    for (let o = 0; o < OWNERS2.length; o++) {
      ctx.fillStyle = p.owner[OWNERS2[o]];
      drawSquadLabels(ctx, state, t, px, geo, OWNERS2[o]);
    }
    // Floating numbers share this pass, so the font is still set exactly once.
    opts.fxLayer?.drawText(ctx, p, px);
  }

  return api;
}

// --- helpers ----------------------------------------------------------------

function capOf(s) {
  return SITES[s.kind].cap + SITE_LEVELS[Math.min(SITE_LEVELS.length - 1, s.level - 1)].cap;
}

/** Cheap change detector for the background. Ownership, level and the
 *  influence field are the only things painted there that move, and the sim
 *  recomputes influence only on an ownership change — so this is exact. */
function signature(state) {
  let hsh = (state.sites.length * 2654435761) | 0;
  for (let i = 0; i < state.sites.length; i++) {
    const s = state.sites[i];
    hsh = (hsh * 31 + (OWNER_N[s.owner] || 0) * 7 + s.level * 3) | 0;
  }
  return (hsh + (state.influenceVersion || 0) * 977) | 0;
}
