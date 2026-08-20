// THE FRONTIER — the endless mode's meta half: what a run is, and what it pays.
//
// The battle half is battle/frontier.js (one enormous board whose difficulty
// rises with distance from your camp). This is the side that decides which map
// you get, what your record is, and what you take home. Nothing here knows how
// a hex works and nothing in battle/ knows this file exists — the seam is the
// same `mapGen` injection `buildBattleConfig` already takes, so the frontier
// needed no contract field and no CONTRACT_VERSION bump.
//
// WHY THIS IS NOT THE INCURSION LADDER, since the two could be confused. A rung
// is a fresh arena and a fresh landing force, so nothing you build carries and
// the escalation is a number you did not choose. The frontier is ONE continuous
// map: the yard you raised in ring 2 is still training for you in ring 6, the
// relief column has to walk the distance you overreached by, and the difficulty
// is set by how far you decide to go. Push-your-luck rather than a staircase.
//
// PURE. No DOM, no clock, no randomness that is not seeded.
// `FRONTIER_ID` and `frontierRegion` live in content/ rather than here: a
// region row is pure data, and content/ must not depend on meta/ — which is
// what putting them here would have forced on regions.data.js.
import {
  FRONTIER_REWARD, FRONTIER_ID, frontierRegion,
} from '../content/endless.data.js';
export { FRONTIER_ID, frontierRegion };
import { metaOf } from '../core/store.js';
import { deriveSeed } from '../core/rng.js';

/** The player's record. Absent on a save written before the mode existed, which
 *  is why every read goes through here rather than touching `meta.frontier`. */
export function frontierRecord(metaState) {
  const m = metaOf(metaState);
  return {
    bestRing: Math.max(0, Math.floor(m?.frontier?.bestRing ?? 0)),
    runs: Math.max(0, Math.floor(m?.frontier?.runs ?? 0)),
  };
}

/**
 * A NEW MAP EVERY RUN, and the same map if you reload mid-run.
 *
 * Keyed on the run COUNT rather than on a stored seed, so nothing about the
 * board has to be persisted: a frontier is a pure function of `(worldSeed,
 * runs)` exactly as a rung is of its depth. That is also what makes a run
 * resumable — `meta/resume.js` keeps the battle blob, and if it is ever
 * discarded the same run number regenerates the identical country.
 */
export function frontierSeed(metaState, worldSeed = 1) {
  return deriveSeed(worldSeed >>> 0, `frontier:${frontierRecord(metaState).runs}`);
}

/**
 * WHAT A RUN PAID, from the outcome the battle hands back.
 *
 * Crowns are summed over the sites HELD AT THE END, weighted by the ring each
 * sits in — so the deep country is worth pushing for and the doorstep cannot be
 * farmed. Relics are paid ONLY for beating the record, which makes the hard
 * currency non-farmable by construction rather than by a cooldown: a record can
 * only be broken by breaking it.
 *
 * LOSING YOUR CAMP PAYS NOTHING. The mode is push-your-luck or it is nothing,
 * and a consolation payout is exactly what would make banking pointless.
 *
 * @param {{status:string, heldRings:number[]}} outcome `heldRings` is one entry
 *   per site the player finished holding, each the ring it sits in.
 * @returns {{crowns:number, relics:number, deepest:number, record:boolean}}
 */
export function frontierReward(metaState, outcome) {
  const held = Array.isArray(outcome?.heldRings) ? outcome.heldRings : [];
  const deepest = held.length ? Math.max(...held) : 0;
  const lost = outcome?.status === 'loss';
  if (lost) {
    return {
      crowns: FRONTIER_REWARD.keepOnLoss, relics: 0, deepest, record: false,
    };
  }
  let crowns = 0;
  for (const ring of held) {
    crowns += FRONTIER_REWARD.base * (1 + Math.max(0, ring) * FRONTIER_REWARD.perRing);
  }
  const best = frontierRecord(metaState).bestRing;
  const gained = Math.max(0, deepest - best);
  const relics = Math.min(FRONTIER_REWARD.relicsPerRunMax,
    gained * FRONTIER_REWARD.relicsPerRing);
  return {
    crowns: Math.round(crowns), relics, deepest, record: deepest > best,
  };
}

/**
 * Bank a finished run. The ONE writer of `meta.frontier`, so the record and the
 * payout can never disagree about what "deepest" meant.
 *
 * The run counter advances on EVERY run including a lost one, because it is
 * what seeds the next map — not advancing it on a loss would hand the player
 * the identical country to retry, which is the one thing a push-your-luck mode
 * must not offer.
 */
export function applyFrontierRun(metaState, reward) {
  const m = metaOf(metaState);
  m.frontier = m.frontier ?? { bestRing: 0, runs: 0 };
  m.frontier.runs = Math.max(0, Math.floor(m.frontier.runs ?? 0)) + 1;
  m.frontier.bestRing = Math.max(
    Math.max(0, Math.floor(m.frontier.bestRing ?? 0)),
    Math.max(0, Math.floor(reward?.deepest ?? 0)),
  );
  return m.frontier;
}
