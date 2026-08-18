// Two small pure helpers pulled out of battleView.js at the 400-line cap.
// Neither is exported FROM battleView.js today, so nothing outside it has to
// change — that file is simply where these are USED, not where they live.
import { SITES, SITE_LEVELS } from '../content/balance.js';
import { squadHexOf } from '../battle/movement.js';
import { builtLevel } from './siteGlyphs.js';

/** `builtLevel`, not `s.level`: the level increments when the upgrade is paid
 *  for, but the sim keeps producing — and capping — at the OLD level until the
 *  work finishes. Using s.level here over-reported cap for the whole build. */
export function capOf(s) {
  return SITES[s.kind].cap + SITE_LEVELS[Math.min(SITE_LEVELS.length - 1, builtLevel(s) - 1)].cap;
}

const OWNER_N = { player: 1, enemy: 2, neutral: 3 };

/** Cheap change detector for the background. Ownership, level, whether a site
 *  is mid-build, and the influence field are the only things painted there that
 *  move, and the sim recomputes influence only on an ownership change — so this
 *  is exact.
 *
 *  `upgradeTicksLeft` has to be in here, not just `level`: level increments the
 *  moment the upgrade is PAID FOR, so hashing it alone repaints when the work
 *  starts and never again — the scaffolding then stays pegged out on a finished
 *  building forever. Only the 0/non-0 transition matters, so the countdown does
 *  not repaint the background every tick.
 *
 *  Ownership alone, not the PERCEIVED one: a vision change already bumps
 *  `influenceVersion` (battle/vision.js recomputeVision), which the hash below
 *  folds in, so a ghost flipping to real (or back) still forces a repaint
 *  without this needing to know fog exists at all. */
export function signature(state) {
  let hsh = (state.sites.length * 2654435761) | 0;
  for (let i = 0; i < state.sites.length; i++) {
    const s = state.sites[i];
    hsh = (hsh * 31 + (OWNER_N[s.owner] || 0) * 7 + s.level * 3
      + (s.upgradeTicksLeft > 0 ? 1 : 0)) | 0;
  }
  return (hsh + (state.influenceVersion || 0) * 977) | 0;
}

/** Scratch for the hex below — module-scope so this allocates nothing per
 *  frame, which is the whole reason `squadHexOf` grew an `out` parameter. */
const _at = { q: 0, r: 0 };

/**
 * WHERE THIS FACTION'S OWN ARMIES ARE STANDING, as a hash.
 *
 * The veil lives on the background canvas, which repaints only when
 * `signature()` moves — and a squad grants sight of its own hex and the ring
 * around it (`battle/vision.js canSee`, `SQUAD_VISION_RADIUS`). Those two
 * facts used to contradict each other: `computeVeil` folded squad sight in
 * correctly, but nothing marked the background dirty when a column MOVED, so
 * on screen the fog neither opened ahead of a march nor closed behind it. It
 * sat frozen at whatever the last capture or construction happened to leave.
 *
 * FOLDING POSITION IN IS AFFORDABLE BECAUSE A COLUMN CROSSES A HEX, NOT A
 * TICK. The march table (CLAUDE.md, "Speed is a much weaker stat") puts a leg
 * at 0.7-2.5 seconds per hex, so this changes a couple of times a second per
 * marching column rather than ten times a second. Hashing `state.tick` instead
 * would repaint every tick, which is exactly the regression bgcache.js
 * measured once at 60fps -> 31.
 *
 * THE HEX-CROSSING RATE IS THE WHOLE ARGUMENT, AND IT IS NOT BACKED BY THE
 * 8/s GATE — this comment used to claim it was, and that was simply wrong.
 * `battleView.js` calls `bgCache.markDirty(TRUE)`, and `force` exists to skip
 * that gate: a signature change is real content (an owner flipped, a building
 * went up) and owes the CURRENT frame, where a pan gesture does not. So the
 * only thing bounding a repaint storm here is how often the hash can actually
 * move, which is why the paragraph above is the load-bearing one rather than
 * a nicety. Do not "restore" the gate by dropping `force`: it would make every
 * capture lag by up to a gate interval to fix a problem that measurement says
 * does not exist. Measured on widowsgate (336 hexes, the biggest board) with
 * 56 columns marching: 60.1 fps, and columns desynchronise, so the aggregate
 * lands near 3 repaints a second rather than 56 times a leg.
 *
 * A CAMPED FORCE COSTS NOTHING AND KEEPS ITS RING, which is the other half of
 * the rule and falls straight out of this: its hex does not change, so it
 * forces no repaints, and `canSee` keeps answering true for the ring around
 * it. Fog closes behind troops that are moving through and stays open around
 * troops that are staying put, without either being a special case.
 *
 * Own squads only. An enemy column moving changes nothing about what THIS
 * faction can see, and it is drawn on the per-frame layer anyway.
 */
export function squadSightSig(state, faction) {
  const squads = state.squads;
  if (!squads || !squads.length) return 0;
  let hsh = squads.length | 0;
  for (let i = 0; i < squads.length; i++) {
    const sq = squads[i];
    if (sq.owner !== faction) continue;
    const at = squadHexOf(state, sq, _at);
    if (!at) continue;
    hsh = (hsh * 31 + at.q * 7 + at.r * 13) | 0;
  }
  return hsh;
}
