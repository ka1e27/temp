// TEACHING THE HARNESS TO MASS FORCE, the way the enemy AI already does.
//
// simplayer.js's assault loop hands ONE garrison at a time to simtactics.js
// `bestAssaultTarget` (`for (const src of mine)`), judged against
// `ATTACK_MARGIN` 1.5 alone. `battle/aicore.js adjacentSources` pools up to
// `AI.maxSources` (3) neighbouring sites into a single strike, and the player
// can now pool their whole selection by hand (multi-source send, shipped this
// week). So the measuring instrument was the only actor on the board that
// could not mass — against exactly the target that punishes it: a Marshal'd
// castle trains against zero attrition because no ONE rear site can ever
// legally clear 1.5x its garrison alone. See CLAUDE.md, "The harness bot
// cannot concentrate force".
//
// THIS IS ADDITIVE, NOT A REPLACEMENT. simplayer.js's per-source loop is
// UNCHANGED and runs first — every soft target the bot already takes alone,
// it still takes alone, from the same source, at the same fraction. Pooling
// only ever looks at what that loop left behind: sources it did not use and
// targets it did not take. Reversing the order (pool first, mop up with
// single sources after) would let pooling grab sources away from ordinary
// expansion for targets a single garrison already handles fine — re-tuning
// the easy regions by accident, which this pass is expressly told not to do.
//
// `bestAssaultTarget` IS NOT TOUCHED. A pooled strike is scored by handing it
// a SYNTHETIC source, `{ adj: [target.id] }`, so the castle gate, the siege
// budget, and the reinforce/microsend hatches all run unmodified against the
// pooled composition. Only WHERE `send` came from changes.
import { AI, UNIT_IDS } from '../src/content/balance.js';
import {
  total, addComp, scaleComp, emptyComp,
} from '../src/battle/combat.js';
import { filterComp } from '../src/battle/commands.js';
import { distance } from '../src/core/hex.js';
import { asHex } from '../src/battle/influence.js';
import { travelTicks } from '../src/battle/movement.js';
import { bestAssaultTarget, RIDERS } from './simtactics.js';

/**
 * Keep a real home guard, but not so large that the opening push never fires —
 * the expedition exists to be spent, and the first minute is when enemy sites
 * are still thinly held.
 *
 * Lives here rather than in simplayer.js so both files can read the same
 * number without a cycle: simplayer.js already has to import FROM this file
 * (`pooledAssaultTurn`), and an import back for one constant would be exactly
 * the pair this project always avoids (see CLAUDE.md, `movement.js`←`retreat.js`).
 */
export const HOME_FLOOR = 5;

/**
 * How many sites may feed one pooled strike. Equal to the enemy's own
 * `AI.maxSources`, not a new number — the whole point of this file is that the
 * two are directly comparable, so a player-side cap chosen independently would
 * leave "can the harness mass as well as the AI" an open question again.
 */
const POOL_MAX_SOURCES = AI.maxSources;

/**
 * RIDERS NEVER CONTRIBUTE TO A POOLED SEND. `riderTurn` (simtactics.js) already
 * gave them first refusal — their own 165-speed detachment, alone — and
 * anything left behind is a rider that could not act on its own. The ordinary
 * per-source column still carries a leftover rider, because `slowestSpeed` is a
 * MIN over ONE squad and a single leftover unit cannot slow its own site's
 * column down.
 *
 * Pooling is different in exactly the way that makes this matter:
 * `launch`-style synchronization (below) holds EVERY contributing squad to the
 * SAME arriveTick, set by the slowest contributor. A rider-heavy source folded
 * into that wave would have its 165 speed thrown away to match a militia column
 * three sites over — precisely "welding a rider to a slow column in a way the
 * single-source path avoided". Leaving them out costs nothing measurable: a
 * rider is `siege` 0.5 (RIDER_BREACH_SEC in simtactics.js already says a wall
 * is somebody else's job), so it was never the body pooling exists to mass.
 */
export const POOL_FILTER = Object.freeze(UNIT_IDS.filter((u) => !RIDERS.includes(u)));

/**
 * What one candidate source can spare toward a pooled strike, or `null`.
 *
 * The floor and fraction are the SAME formula simplayer.js's per-source loop
 * uses — pooling does not spend a garrison any more aggressively than a solo
 * assault would, it only combines several such shares at once.
 */
function contributionFrom(s, inFlight) {
  const garrison = total(s.garrison);
  const floor = s.kind === 'camp' ? HOME_FLOOR : 3;
  if (garrison <= floor + 3) return null;
  if (inFlight.has(s.id) && garrison < floor + 15) return null;
  const fraction = Math.min(0.75, (garrison - floor) / garrison);
  const comp = scaleComp(filterComp(s.garrison, POOL_FILTER), fraction);
  if (total(comp) < 1) return null;
  return { site: s, fraction, comp };
}

/**
 * MASS FORCE ON THE TARGETS THE PER-SOURCE LOOP LEFT BEHIND.
 *
 * Target-major, mirroring `aicore.js adjacentSources`'s reasoning rather than
 * its code: for every non-player site reachable from something we hold, gather
 * the nearest unused sources that can also reach it (nearest first, capped at
 * `POOL_MAX_SOURCES`), pool their spendable shares, and ask
 * `bestAssaultTarget` — UNMODIFIED — whether the combined force is worth
 * sending. `busy` and `taken` are populated by the per-source loop that ran
 * before this (their own sources/targets already spoken for) and are extended
 * here as pooled strikes commit, so two candidate targets in the same think
 * cannot double-spend the same site.
 *
 * Returns command objects rather than pushing them, so a caller (or a test)
 * can inspect what would be sent before it touches `state.commands`.
 *
 * IT IS OFF BY DEFAULT (`opts.pool` must be TRUE, `--pool` on the CLI), and
 * that inverts the house pattern on purpose. `upgradeTurn`, `constructTurn`,
 * `scoutTurn` and the throne budget all shipped ON behind a `--noX` revert,
 * because each was measured as an improvement (or an understood neutral) in
 * the same pass that added it, and the campaign was re-tuned against it there
 * and then. This one measured as a WASH with a defect attached:
 *
 *   n=48   gallowmoor  pooled 25%  unpooled 33%
 *          thanescar   pooled 27%  unpooled 23%
 *
 * — opposite signs, both inside the noise band, so the "the harness cannot
 * mass, and that is why eleven rows read below floor" hypothesis does not
 * reproduce. And the per-seed evidence says why it is not merely neutral:
 * `targetIds` below is ID-ordered over ANY reachable site and is NOT weighted
 * toward the throne, so a pooled strike competes with `simplayer.js`'s own
 * "push the rear army forward" consolidation instead of reinforcing it. On
 * thanescar seed 1000 that turned a clean 18-minute WIN into a 30-minute
 * timeout, with all nine of its synchronized strikes landing on ordinary
 * secondary sites and none ever aimed at the castle.
 *
 * So the capability ships and the DEFAULT does not move: every number in
 * CLAUDE.md was measured without it, the campaign re-tune is mid-binary-search
 * against an n=24 screen taken without it, and silently re-basing the
 * instrument would make the whole table incomparable to fix nothing. **What
 * would justify flipping it: weight the target scan toward the throne (the
 * one target no single rear garrison can ever legally clear alone, which is
 * the gap this was built for), re-measure, and turn it on in the same pass
 * that re-tunes against it.**
 *
 * The gate is checked HERE and not only by the caller — same reason
 * `bestAssaultTarget` checks its own `opts.throne` rather than trusting
 * simrunner.js: a test or a future caller can flip it directly and get exactly
 * one behaviour or the other, with nothing to remember on the way in.
 */
export function pooledAssaultTurn(view, mine, inFlight, busy, taken, opts = {}) {
  const commands = [];
  if (opts.pool !== true) return commands;

  const targetIds = new Set();
  for (const s of mine) {
    if (busy.has(s.id)) continue;
    for (const id of s.adj) targetIds.add(id);
  }

  for (const id of [...targetIds].sort()) {
    if (taken.has(id)) continue;
    const t = view.sites.find((x) => x.id === id);
    if (!t || t.owner === 'player') continue;

    const here = asHex(t.hex);
    const pool = mine
      .filter((s) => !busy.has(s.id) && s.adj.includes(t.id))
      .map((s) => contributionFrom(s, inFlight))
      .filter(Boolean)
      .sort((a, b) => distance(here, asHex(a.site.hex)) - distance(here, asHex(b.site.hex))
        || (a.site.id < b.site.id ? -1 : 1))
      .slice(0, POOL_MAX_SOURCES);

    // A single contributor is the ordinary path's job, not this one — and if
    // it were enough alone, the per-source loop already tried it and either
    // took the target (so it is in `taken`) or found it wanting.
    if (pool.length < 2) continue;

    const send = pool.reduce((c, p) => addComp(c, p.comp), emptyComp());
    const best = bestAssaultTarget(view, { adj: [t.id] }, send, opts);
    if (!best) continue;

    // ONE SYNCHRONIZED WAVE — aicore.js `launch`'s own rule, and for the same
    // reason: `bestAssaultTarget` just scored the COMBINED force as if it hit
    // at once, so the real squads have to actually do that, or the pooled
    // evaluation was a preview of a battle that never happens.
    let common = 0;
    for (const p of pool) {
      const eta = view.tick + 1 + travelTicks(view, p.site, t, p.comp, 'player');
      if (eta > common) common = eta;
    }
    for (const p of pool) {
      commands.push({
        t: 'SEND', from: p.site.id, to: t.id, fraction: p.fraction,
        filter: POOL_FILTER, arriveTick: common,
      });
      busy.add(p.site.id);
    }
    taken.add(t.id);
  }
  return commands;
}
