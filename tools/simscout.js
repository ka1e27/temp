// THE BOT'S ANSWER TO FOG: build a watchtower when it cannot see the throne.
//
// Split out of tools/simbuild.js at the 400-line cap, along the seam that
// matters rather than at a line number: that file is the bot's ECONOMY — the
// upgrade ladder and construction, both spending the same treasury under the
// same reserve — and this is its answer to a different problem entirely, with
// its own flag (`--noscout`) and its own retry clock.
//
// Imported directly by `tools/simplayer.js`, and re-exported from simbuild.js so
// `import { scoutTurn } from './simbuild.js'` keeps working. It imports nothing
// from that file, so the pair is not a cycle.
import { canSee } from '../src/battle/vision.js';
import { buildBlocker } from '../src/battle/construct.js';
import { goldOf } from '../src/battle/economy.js';
import { CENTIGOLD, VISION_RADIUS, BUILD_COSTS } from '../src/content/balance.js';
import { distance as hexDistance } from '../src/core/hex.js';

/**
 * SIGHT OF THE OBJECTIVE, WHEN THE BOT HAS NONE OF ITS OWN.
 *
 * CLAUDE.md's most-repeated lesson, applied to fog: a mechanic the harness
 * cannot play is a mechanic nobody has measured. `beliefFor` can hand the bot
 * an accurate throne OWNER now (belief.js), but everything else about that
 * castle — garrison, level, hp — stays a presumption for as long as nothing
 * of the player's ever sees it, and a presumption is not a plan. The
 * watchtower is the game's own answer to "I cannot see the throne and need
 * to" — `BUILD_COSTS` prices it as the cheapest thing on the menu FOR this
 * reason ("an ordinary player has to be able to afford it on a whim rather
 * than save for it") — so this is that whim, scripted.
 *
 * THE RULE IS THE SMALLEST ONE THAT IS STILL HONEST PLAY: no vision of the
 * castle, nothing already being built or upgraded (the same one-at-a-time
 * convention `upgradeTurn`/`constructTurn` already keep), afford 120 gold
 * outright, raise a tower at the legal hex nearest the castle that would
 * actually reveal it. Nothing more elaborate, and nothing that nudges any
 * other decision this file makes — a real player who cannot see the throne
 * reaches for the cheapest fix, not a scouting doctrine.
 *
 * DOES NOT SHARE `upgradeTurn`'s reserve, ON PURPOSE. 120 gold is a rounding
 * error against a battle treasury (300 starting, 10-80/s), so gating this
 * behind the same `RESERVE_SEC`-scaled reserve the upgrade ladder protects
 * would make the one thing that answers fog compete for budget with a
 * mechanic that has nothing to do with it. "Can afford it outright" is the
 * whole gate, and it is why this is checked ahead of `upgradeTurn` below
 * rather than after: seeing the win condition is not one more spending
 * decision to queue behind the ladder.
 *
 * CHECKED AGAINST CURRENT VISION ONLY (`canSee`), not `state.seen`'s
 * last-known memory — a stale sighting answers "have I ever", and the
 * question this function exists to ask is "can I RIGHT NOW".
 *
 * PICKS THE SAFEST LEGAL HEX, NOT THE NEAREST ONE — and conflating those two
 * was a real, measured bug, not a style choice. `VISION_RADIUS.watchtower` is
 * a flat 4; any legal hex inside it sees the castle exactly as well as any
 * other, so "nearest to the castle" bought nothing and cost everything: on a
 * region where the enemy's remaining holdouts ring their own throne (mapgen's
 * `holdBandFrac`), the nearest legal hex is reliably the most exposed one on
 * the board. `construct.js` prices that fragility on purpose — 1 HP, no
 * regen, `razedByCapture` — for a farm behind the line that is a real risk; at
 * the front it is a certainty. Measured on nightharrow: the same hex razed
 * and rebuilt every 20-60 ticks for a THOUSAND-PLUS TICKS STRAIGHT, never
 * once surviving its own 150-tick build timer, `canSee` never once true. Zero
 * of those builds is a `site-built` event — the scaffolding never survives
 * long enough to fire it — so `--noscout`'s own guard test could not have
 * caught this: it counts completions, and there were none to miscount either
 * way. Maximise distance from the nearest non-player site instead, among the
 * hexes already legal and in range — the same notion of exposure
 * `frontDistance` uses elsewhere in this file, aimed at a hex instead of a
 * site because nothing is owned yet.
 */
function distToNearestFoe(state, h) {
  let best = Infinity;
  for (const s of state.sites) {
    if (s.owner === 'player') continue;
    const d = hexDistance({ q: s.hex[0], r: s.hex[1] }, h);
    if (d < best) best = d;
  }
  return best;
}

// On the map this measured against, the SAFEST legal hex was still reachable
// by the enemy's own nearby holdings inside the 15-second build window — the
// razing recurred every 20-90 ticks regardless of which of the five-to-seven
// candidates got picked, because a fresh scaffold has 1 HP and no garrison of
// its own (see the file header) and nothing short of vision-of-the-approach
// (the very thing missing) can tell a genuinely quiet hex from a contested
// one in advance. So this cannot be fixed by choosing better; it can only be
// fixed by not repeating a purchase the last attempt already answered — an
// ordinary player who watches a scout post fall does not rebuild it two
// seconds later, at the same spot, forever.
//
// TWO SEPARATE THROTTLES were tried and only one survived measurement.
// Reusing `upgradeTurn`/`constructTurn`'s shared "anything in flight" gate
// starves this on exactly the boards where it matters most: a mature,
// thirty-plus-site empire has SOMETHING mid-upgrade almost continuously, so
// the shared gate was closed on 4 of 6 sampled thinks even mid-battle, before
// a single razing had happened. A per-tick modulo window measured worse
// still — closed by that same shared gate often enough that the eligible
// window could be missed for the length of a whole battle. Neither belongs
// here: they answer "is the CONSTRUCTION LADDER busy", and a burned scout
// post has nothing to do with a farm upgrading three sites away.
//
// So the cooldown is scoped to watchtowers alone (never blocked by an
// unrelated upgrade) and timed from the harness's OWN last attempt, not from
// the tick clock. `lastScoutAttempt` is a WeakMap keyed by `state.grid` —
// the SAME key `HEX_CACHE` above uses, and for the same reason spelled out
// there: `state` here is `beliefFor`'s OUTPUT, a fresh object built new on
// every single think, so keying on it directly would never see its own
// previous entry — every think would find the map empty and the cooldown
// would silently do nothing (measured: this was the actual first cut, and it
// did not throttle a single retry). `grid` is the one sub-object `beliefFor`
// passes through BY REFERENCE rather than rebuilding, so it is the same
// object every time for one battle and a different one for the next. This
// is the harness DRIVER's own scratch memory, never part of a save file or a
// resumed battle (only `state.ai` is, because only the enemy's memory has to
// survive one), so it needs no JSON shape and cannot desynchronise a
// replay — the same seed reaches the same tick with the same board and
// makes the same decision every time, which is all determinism ever
// required.
const lastScoutAttempt = new WeakMap();
const SCOUT_RETRY_TICKS = 300; // roughly a real player's "try again later"

const watchtowerBuilding = (state) => state.sites
  .some((s) => s.owner === 'player' && s.kind === 'watchtower' && s.buildTicksLeft > 0);

export function scoutTurn(state, hexes) {
  if (watchtowerBuilding(state)) return;
  if (state.tick - (lastScoutAttempt.get(state.grid) ?? -Infinity) < SCOUT_RETRY_TICKS) return;

  const castle = state.sites.find((s) => s.kind === 'castle');
  if (!castle) return;
  const at = { q: castle.hex[0], r: castle.hex[1] };
  if (canSee(state, 'player', at.q, at.r)) return; // already answered

  const gold = goldOf(state.factions.player) / CENTIGOLD;
  if (gold < BUILD_COSTS.watchtower.gold) return;

  let best = null;
  let bestSafety = -Infinity;
  for (const h of hexes) {
    if (hexDistance(h, at) > VISION_RADIUS.watchtower) continue; // must actually SEE it
    if (buildBlocker(state, 'player', h)) continue;
    const safety = distToNearestFoe(state, h);
    if (safety > bestSafety) { bestSafety = safety; best = h; }
  }
  if (best) {
    state.commands.push({ t: 'BUILD', kind: 'watchtower', hex: [best.q, best.r] });
    lastScoutAttempt.set(state.grid, state.tick);
  }
}
