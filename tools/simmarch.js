// A HALTED COLUMN GETS MOVING AGAIN — the bot's `MOVE_SQUAD`.
//
// Split out of ./simplayer.js the way ./simdefend.js was, along the same seam:
// that file is what the bot does with the troops standing in its buildings,
// this is what it does with the ones standing in a field.
//
// IT EXISTS BECAUSE THE MEASURING INSTRUMENT WAS LOSING MOST OF ITS FIELD ARMY
// AND NOBODY HAD COUNTED. `battle/meleephase.js openHexMelee` camps every squad
// that walks onto a contested tile — that is the whole of "you cannot walk
// through an army" — and NOTHING clears `camped` again except `RETREAT_SQUAD`
// or `MOVE_SQUAD`, neither of which anything in `tools/` has ever issued. So a
// column that met one of the enemy's two-troop columns, won, and was left
// standing on a hex simply stopped being part of the war. Measured, five
// battles across three regions, wins and losses alike:
//
//   riverfen   seed 1000    win   9.2m    81% of body-seconds off a site STRANDED
//   riverfen   seed 8919    win  11.4m    72%     ...ending with 41 bodies parked
//   gallowmoor seed 1000    loss  9.3m    59%     44 squads halted
//   gallowmoor seed 24757   loss  4.9m    71%     31 squads halted
//   thanescar  seed 8919    loss  4.6m    60%     23 squads halted
//
// Between 59% and 81% of every body-second the bot spent OUTSIDE a building was
// spent stranded, and riverfen — a region it WINS — ends with fifty-one bodies
// standing in fields. That is the `upgradeTurn` lesson for the fifth time, and
// the largest instance of it yet found: a mechanic the harness cannot play is a
// mechanic nobody has measured, and here the mechanic is "keep your army".
//
// The interception rate is not incidental either. CLAUDE.md's own census has
// the enemy sending 2,114 columns in a twenty-minute gallowmoor battle at a
// median size of TWO — so on the late maps the board is thick with tiny columns
// whose main effect is to halt bigger ones. A player drags the survivors
// onward without thinking about it. The bot could not.
//
// IT SHIPS OFF (`--march` OPTS IN), AND THE REASON IS SIZE RATHER THAN DOUBT.
// Re-taken at n=32 across five tiers, matched seeds, one variable:
//
//     region       tier   off     --march ON    delta
//     riverfen      1     84%      88%           +4
//     emberholt     2     91%      94%           +3
//     gallowmoor    3     53%      66%          +13
//     thanescar     4     59%      59%            0
//     ravensmarch   5     31%      56%          +25
//
// +3, +4, +13, 0, +25 — NOT A SHIFT, A RE-WEIGHTING, and a wider spread than the
// ram slot reprice (+14 duskfell against +3 karrowmere) that CLAUDE.md records
// as having cost a full re-tune rather than a dial nudge. Ravensmarch alone goes
// from `ok` to `TOO EASY`; thanescar does not move at all.
//
// The shape follows how much INTERCEPTION a map produces, which is the
// mechanism: the enemy halts 11 player columns on riverfen and 44 on gallowmoor,
// so the busier the board the more there is to pick back up. One number cannot
// price this, and the re-base has to re-take every row.
//
// ⚠ AN EARLIER TWO-ROW SCREEN AT n=24 READ +8 AND +13 AND WAS MISLEADING. It
// moved its own control (riverfen 88% off at n=24, 84% at n=32), so most of that
// +8 was noise. CLAUDE.md's "n=12 is far too noisy to tune on" applies at 24 too
// when the deltas are single digits.
//
// AND IT IS NOT AN ASYMMETRY FIX, WHICH IS HOW THIS WAS FIRST WRITTEN UP. The
// enemy AI emits exactly three verbs — SEND, TRAIN, RETREAT — so it has no
// MOVE_SQUAD either, and `openHexMelee` camps its columns on the same rule.
// Measured, both sides strand a comparable share of their own field army:
// player 59-81%, enemy 51-64%. The enemy halts two to four times as many
// columns and each is tiny (median 2 against the player's 4-6), but relative to
// what each side has in the field the loss is similar.
//
// So this hands the player a capability the enemy structurally lacks. That is
// still the right model — the game ships to HUMANS and an unremarkable human
// drags a stopped column onward, which is this harness's whole specification —
// but it is a design decision rather than a neutral repair, and the honest
// alternative is to teach the enemy to recover its columns too.
//
// Inertness is proven rather than argued: riverfen, gallowmoor and thanescar at
// n=8 are byte-identical to the parent commit with the flag absent, and
// tests/simmarch.test.js pins the default issuing zero MOVE_SQUAD as its
// load-bearing negative control. `tools/autoresolve.js` calls `playerTurn` with
// no options, so the shipped game's auto-resolve is untouched — which is
// required, since its whole contract is to be the policy the table is measured
// with.
//
// DELIBERATELY THE DULLEST POLICY THAT WORKS, which is this harness's whole
// specification ("a deliberately unremarkable player"): a stranded column walks
// to the nearest friendly site and rejoins the empire, where every rule in
// simplayer.js can spend it again. It does not pick assault targets of its own
// — `bestAssaultTarget` reasons about a SOURCE SITE and its garrison, and
// teaching it to reason about a squad instead would be a second targeting
// policy to keep in step with the first.
import { total } from '../src/battle/combat.js';
import { squadHexOf } from '../src/battle/movement.js';
import { distance } from '../src/core/hex.js';

/** Below this a stranded column is not worth an order — the send it would
 *  rejoin is bounded by a `+3` floor at the far end anyway, and re-tasking
 *  single stragglers is solver-play rather than what a player does. */
const WORTH_MOVING = 2;

/**
 * One order per stranded column: walk to the nearest friendly site.
 *
 * @param {object} view   the belief-filtered board `playerTurn` is reasoning on
 * @param {object[]} mine the player's own sites, already filtered by the caller
 * @returns {object[]} MOVE_SQUAD commands, possibly empty
 */
export function marchTurn(view, mine) {
  if (!mine.length) return [];
  const out = [];
  for (const sq of view.squads) {
    if (sq.owner !== 'player' || !sq.camped) continue;
    // A SQUAD IN AN OPEN-GROUND MELEE IS CAMPED TOO, and it must not be
    // re-tasked. `openHexMelee` sets `camped` and hangs a `melee` record on the
    // same squad without taking it off `state.squads`, so `cmdMoveSquad` would
    // accept the order and march it straight out of a fight it is winning —
    // a free disengage no player is offered, since breaking off is RETREAT and
    // RETREAT leaves with whatever is left at the moment it is ordered.
    if (sq.melee) continue;
    if (total(sq.comp) < WORTH_MOVING) continue;
    const at = squadHexOf(view, sq);
    if (!at) continue;

    let best = null;
    let bestD = Infinity;
    for (const s of mine) {
      const d = distance(at, { q: s.hex[0], r: s.hex[1] });
      // Ties broken on id so the order is deterministic: two sites equidistant
      // from a stranded column must not depend on site-array order, which
      // capture rewrites.
      if (d < bestD || (d === bestD && best && s.id < best.id)) { bestD = d; best = s; }
    }
    // Already standing on it. `arrivals.js` only camps a squad whose
    // destination is gone, so this happens when the site it was heading for was
    // razed under it — ordering a zero-hex march would be refused as `no-route`
    // and would be noise in the command log either way.
    if (!best || bestD === 0) continue;
    out.push({ t: 'MOVE_SQUAD', squadId: sq.id, to: best.id, fraction: 1 });
  }
  return out;
}
