// Two small pure helpers pulled out of battleView.js at the 400-line cap.
// Neither is exported FROM battleView.js today, so nothing outside it has to
// change — that file is simply where these are USED, not where they live.
import { SITES, SITE_LEVELS } from '../content/balance.js';
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
