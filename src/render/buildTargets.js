// Where a build may legally land, drawn WHILE the player is still choosing.
//
// `buildBlocker` is exported precisely so this can never disagree with the
// command it previews — the same guarantee the outcome preview gives combat
// (CLAUDE.md's zero-randomness rule, one level up: the SAME function decides
// and shows). It only exists while `view.armedBuild` is set, so it belongs on
// #board-fx, not #board-bg: the background repaints on ownership or level,
// and arming a build changes neither.
//
// One path for every legal hex, one fill, one stroke — batched exactly like
// hexRenderer.js drawFlood, and for the same reason: a fillRect (or a stroke)
// per hex on a 300-hex board is the kind of per-frame allocation the render
// budget forbids.
//
// THE QUERY HEX IS MODULE-SCOPE, AND THAT WAS ONLY HALF THE COST. This comment
// used to claim the scan "allocates nothing either" on the strength of `_hex`
// alone, which was true of this file and false of the frame: `buildBlocker`
// itself minted a `{q, r}` per SITE per call for its separation scan, so one
// armed build cost cols x rows x sites object literals a frame — ~18,500 on
// widowsgate. Fixed where it was spent (battle/construct.js `_s`), because the
// alternative was this file second-guessing a rule the harness plays. Both
// scratches together are what make the claim true; neither is on its own.
import { hexRow, hexQ, hexCx, hexCy, traceHex } from './hexGeom.js';
import { buildBlocker } from '../battle/commands.js';

const _hex = { q: 0, r: 0 };

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state @param {object} view presentation state
 * @param {number} size hex circumradius, world units
 * @param {object} p palette @param {number} px
 */
export function drawBuildTargets(ctx, state, view, size, p, px) {
  if (!view?.armedBuild) return;
  const { cols, rows } = state.grid;
  const n = cols * rows;
  let any = false;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const r = hexRow(i, cols);
    const q = hexQ(i, cols);
    _hex.q = q;
    _hex.r = r;
    if (buildBlocker(state, 'player', _hex)) continue;
    any = true;
    traceHex(ctx, hexCx(q, r, size), hexCy(q, r, size), size * 0.9);
  }
  if (!any) return;
  // Reuses the box-select colours: both are a wash over an area of GROUND
  // rather than a stroke on a site, so they should read as the same kind of
  // affordance rather than mint a third meaning for the accent hue.
  ctx.fillStyle = p.selectionFill;
  ctx.fill();
  ctx.strokeStyle = p.selection;
  ctx.lineWidth = px * 1.5;
  ctx.stroke();
}
