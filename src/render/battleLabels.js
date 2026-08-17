// THE ONE TEXT PASS — split out of ./battleView.js at the 400-line cap, along
// the seam rather than at a line number.
//
// Every string the board draws goes through here: garrison counts, the stale
// counts a failed assault remembers, squad headcounts and the floating numbers
// the effect layer spawns. That is not tidiness — it is the reason the font
// string is assigned EXACTLY ONCE per frame, which is one of the two rules the
// fx path is built on (the other being that it allocates nothing).
//
// It takes the font cache with it. `fontZoom`/`fontStr` are read and written
// only here, and the comment they used to sit under said so; a cache whose one
// consumer lives in another file is a staleness bug waiting for someone to add
// a second writer.
import { UNIT_IDS } from '../content/balance.js';
import {
  garrisonLabelY, siteRadius, builtLevel, siteStackY, siteStackLen,
} from './siteGlyphs.js';
import { staticHalfDepth } from './formation.js';
import { drawSquadLabels } from './routes.js';
import { drawStaleGarrisons } from './fog.js';
import { perceivedSite } from '../battle/vision.js';
import { numStr } from '../ui/format.js';

const LABEL_PX = 14;   // constant on-screen size at any zoom
const OWNERS3 = ['player', 'enemy', 'neutral'];
const OWNERS2 = ['player', 'enemy'];

/**
 * @param {{camera:object, palette:object, viewFaction:string, sitePos:Function,
 *          hexSize:number, geo:object, scratch:{x:number,y:number}}} ctxDeps
 *   `scratch` is battleView's own reused point — passed in rather than minted
 *   here so this pass allocates nothing per frame, same as every other draw.
 */
export function createLabelPass({ camera, palette: p, viewFaction, sitePos, hexSize, geo, scratch }) {
  let fontZoom = -1;
  let fontStr = '';
  const _a = scratch;

  /** The headcount of a stack besieging or assaulting a site, over its pieces.
   *  Its own faction's colour, so an enemy siege on your farm and your assault
   *  on theirs are told apart the same way every other stack is. */
  function drawSiteStackLabels(ctx, state, px) {
    const prev = ctx.textBaseline;
    ctx.textBaseline = 'bottom';
    for (const s of state.sites) {
      const stack = s.siege || s.melee;
      if (!stack) continue;
      // A site nobody has looked at draws nothing at all, so it must not carry
      // a number either — `drawFrame` skips ghosts before it draws the pieces.
      if (perceivedSite(state, viewFaction, s).ghost) continue;
      let n = 0;
      for (let k = 0; k < UNIT_IDS.length; k++) n += stack.comp[UNIT_IDS[k]] || 0;
      if (n <= 0) continue;
      sitePos(s, _a);
      const r = siteRadius(s.kind, hexSize);
      // CLEAR OF THE PIECES, not on them. The block is CENTRED on its anchor,
      // so the number has to clear half its depth — put at the anchor it lands
      // among the troops, in the troops' own colour, which is invisible.
      const len = siteStackLen(hexSize, px);
      const top = _a.y + siteStackY(s.kind, builtLevel(s), r, px)
        - staticHalfDepth(n, len) - px * 7;
      ctx.fillStyle = p.owner[stack.owner] || p.text;
      ctx.fillText(numStr(n), _a.x, top);
    }
    ctx.textBaseline = prev;
  }

  /** ONE text pass, ONE `ctx.font` assignment, batched by colour; the font
   *  string is cached against zoom, and `squads` is the PERCEIVED list
   *  drawFrame built. */
  return function drawLabels(ctx, state, squads, t, px, fxLayer) {
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
        // RAW OWNER FIRST, so a site resolves at most once per FRAME rather than
        // once per OWNER: `perceivedSite` mints a ghost on a miss, for an answer
        // that never depended on the owner. Identical set drawn — only a ghost's
        // owner can differ from the true one, and a ghost carries no digits.
        if (state.sites[i].owner !== owner) continue;
        const s = perceivedSite(state, viewFaction, state.sites[i]);
        if (s.ghost) continue;
        let n = 0;
        for (let k = 0; k < UNIT_IDS.length; k++) n += s.garrison[UNIT_IDS[k]] || 0;
        sitePos(s, _a);
        ctx.fillText(numStr(n), _a.x, _a.y + garrisonLabelY(s.kind, hexSize, px));
      }
    }
    // ...AND THE STACK STANDING ON IT. A column that reaches a site leaves
    // `state.squads` — it lives in `site.melee.comp` for six seconds and then in
    // `site.siege.comp` — so the squad labelling below stops naming it at the
    // exact moment its size decides the battle. `formation.js` compresses the
    // pieces logarithmically and caps at thirty, so a 71-troop siege and a
    // 700-troop one are drawn identically; its own comment says that is safe
    // BECAUSE "the count label carries the exact figure at every size", and
    // that promise was broken here and nowhere else. "Is this enough to hold?"
    // is the question a besieging stack exists to pose.
    drawSiteStackLabels(ctx, state, px);
    drawStaleGarrisons(ctx, state, viewFaction, sitePos, hexSize, px, p, _a);
    ctx.textBaseline = 'middle';
    for (let o = 0; o < OWNERS2.length; o++) {
      ctx.fillStyle = p.owner[OWNERS2[o]];
      drawSquadLabels(ctx, squads, t, px, geo, OWNERS2[o]);
    }
    // Floating numbers share this pass, so the font is still set exactly once.
    fxLayer?.drawText(ctx, p, px);
  };
}
