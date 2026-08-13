// THE LIFETIME RECORD, derived.
//
// `meta.stats` (core/store.js `createStats`) has counted thirteen things on
// every battle since long before this file existed, survives abdication, and
// until now no screen showed a single one of them. For an idle/strategy hybrid
// that is a retention gap rather than a nicety: "numbers that go up, which you
// can look at" is the genre's core loop, and this game was collecting them and
// hiding them.
//
// THE ARITHMETIC LIVES HERE, NOT IN THE SCREEN, for the reason
// screens/battle-econ.js gives about the site panel: a figure the renderer
// computes for itself is a figure that can disagree with the thing it claims to
// describe, and there is no test that can see it. Everything below is a pure
// function of `stats`, so tests/record.test.js can state what each one means
// without opening a menu.
//
// EVERY FIELD READ HERE HAS A LIVE WRITER, checked rather than assumed — this
// project has already refunded four shop upgrades that were sold and did
// nothing, and a stats drawer showing a counter nobody increments would be the
// same mistake with a friendlier face:
//
//   battles/wins/losses/unitsLost/unitsKilled  meta/rewards.js applyOutcome
//   raids                                      meta/rewards.js, on a re-clear
//   incursions                                 meta/rewards.js, on a cleared rung
//   crownsEarned    meta/idle.js accrue + applyOfflineProgress, rewards.js x2
//   crownsSpent     meta/upgrades.js, meta/boosters.js
//   relicsEarned/relicsSpent                   meta/rewards.js, meta/upgrades.js
//   offlineMsClaimed / playMs                  meta/idle.js
// PURE.

/** Safe non-negative read: a hand-edited or partial save must not print NaN. */
const num = (n) => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * `wins / battles`, or null when nothing has been fought.
 *
 * NULL RATHER THAN 0, and every derived figure here follows the same rule: a
 * fresh save has no win rate, and printing "0%" would be a claim about a player
 * who has not played rather than an absence of data. The screen renders null as
 * an em dash.
 *
 * DELIBERATELY NOT `wins / (wins + losses)`. `losses` counts a loss OR a
 * timeout; a WITHDRAWAL is a battle that is neither, so the three do not sum to
 * `battles` and the difference is real — see `withdrawals` below, which is the
 * honest way to show it.
 */
export function winRate(stats) {
  const b = num(stats?.battles);
  return b > 0 ? num(stats.wins) / b : null;
}

/** Battles that ended in neither a win nor a loss/timeout — i.e. pulled out of. */
export function withdrawals(stats) {
  return Math.max(0, num(stats?.battles) - num(stats?.wins) - num(stats?.losses));
}

/**
 * Troops killed per troop lost, or null before either has happened.
 *
 * `Infinity` is refused explicitly: a player who has killed without losing
 * anything gets null (an em dash) rather than a division that renders as "∞
 * : 1", which reads as a bug rather than as a flawless record.
 */
export function killRatio(stats) {
  const lost = num(stats?.unitsLost);
  const killed = num(stats?.unitsKilled);
  if (lost <= 0 || killed <= 0) return null;
  return killed / lost;
}

/**
 * THE IDLE HALF, MADE VISIBLE: the share of all credited time that was credited
 * while the tab was shut.
 *
 * This is a share of TIME rather than of crowns, and the distinction is
 * deliberate rather than a shortcut. `offlineMsClaimed` counts milliseconds and
 * nothing counts offline CROWNS separately, so an income share would have to be
 * reconstructed from a rate that changes every time a region is taken — a
 * number that looks exact and is not. Time is what is actually recorded, so
 * time is what this claims.
 */
export function awayShare(stats) {
  const away = num(stats?.offlineMsClaimed);
  const played = num(stats?.playMs);
  const total = away + played;
  return total > 0 ? away / total : null;
}

/** Crowns kept rather than spent. Can be negative on a save that has spent
 *  legacy-boosted income earned before a reset, which is not an error. */
export function crownsNet(stats) {
  return num(stats?.crownsEarned) - num(stats?.crownsSpent);
}

/**
 * The whole record as one plain object, so a screen renders rather than
 * computes and a test can assert the lot in one comparison.
 */
export function recordView(stats) {
  const s = stats ?? {};
  return {
    battles: num(s.battles),
    wins: num(s.wins),
    losses: num(s.losses),
    withdrawals: withdrawals(s),
    winRate: winRate(s),
    raids: num(s.raids),
    incursions: num(s.incursions),
    unitsKilled: num(s.unitsKilled),
    unitsLost: num(s.unitsLost),
    killRatio: killRatio(s),
    crownsEarned: num(s.crownsEarned),
    crownsSpent: num(s.crownsSpent),
    crownsNet: crownsNet(s),
    relicsEarned: num(s.relicsEarned),
    relicsSpent: num(s.relicsSpent),
    playMs: num(s.playMs),
    offlineMsClaimed: num(s.offlineMsClaimed),
    awayShare: awayShare(s),
    /** Nothing has happened yet — the screen says so instead of printing a
     *  table of zeroes, which is the one shape that reads as broken. */
    empty: num(s.battles) === 0 && num(s.playMs) === 0,
  };
}
