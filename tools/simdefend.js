// THE BOT'S ANSWER TO THE SET-PIECE.
//
// Split out of ./simplayer.js at the 400-line cap, along the seam that matters:
// that file is what the bot does to take ground, this is the one thing it does
// because something is being done TO it.
//
// IT EXISTS BECAUSE A MEASUREMENT WITHOUT IT WOULD BE MEANINGLESS. The enemy's
// muster (battle/setpiece.js) is announced to the player with a size and an ETA
// precisely so it can be ANSWERED — march home and meet it, or go and take the
// country it just emptied. The scripted bot had neither response: it keeps a
// standing `HOME_FLOOR` at the camp and has never once reacted to a threat, so
// a harness run of the muster would have measured a player who watches a host
// walk into their camp and does nothing. That is the `upgradeTurn` lesson for
// the fourth time — a mechanic the harness cannot PLAY is a mechanic nobody has
// measured, and answering is as much a part of playing as attacking is.
//
// It is deliberately the SIMPLER of the two answers. Counter-attacking the
// emptied country is the better play and a much harder policy to write; a bot
// that only knows how to come home is an ordinary player, which is the whole
// specification of this harness ("a deliberately unremarkable player").
//
// PROVABLY INERT WITHOUT A MUSTER: it fires only on an enemy wave inbound at
// the player's own camp, and before battle/setpiece.js existed the enemy AI
// never aimed one there — `attack()` scores by `AI.siteValue` and reach, and the
// camp sits in the corner the enemy does not hold. So every number in
// regions.data.js was taken in a world where this function's first `if` is
// false on every think.
import { total, scaleComp, addComp, emptyComp } from '../src/battle/combat.js';
import { UNIT_IDS } from '../src/content/balance.js';
import { TICK_HZ } from '../src/core/loop.js';
import { travelTicks } from '../src/battle/movement.js';

/** How far ahead to look for an inbound host, in seconds. Beyond this a recall
 *  is premature — the troops are more useful where they are, and the wave may
 *  still be intercepted on the way. */
const HORIZON_SEC = 90;

/** Recall up to this share of a garrison. Not all of it: a site stripped to
 *  nothing to save the camp is a site handed over for free, which is the same
 *  trade `aihome.js relievers` refuses in the other direction. */
const RECALL_FRAC = 0.8;

/** Sites this far past the camp's own hex are not going to arrive in time and
 *  are better left holding what they hold. */
const MAX_LEGS = 4;

/**
 * Everything the enemy currently has in the air aimed at `site`, and when the
 * first of it lands.
 *
 * Read off the fogged `view` like everything else the bot does — but note the
 * threat is knowable regardless, because the shipped game ANNOUNCES it
 * (screens/battle-alert.js, `battle:enemy-muster`). A bot given less
 * information than the player has would under-measure the answer.
 */
export function inboundAt(view, site) {
  let comp = emptyComp();
  let first = Infinity;
  for (const q of view.squads) {
    if (q.owner !== 'enemy' || q.to !== site.id) continue;
    comp = addComp(comp, q.comp);
    if (q.arriveTick < first) first = q.arriveTick;
  }
  return { bodies: total(comp), first };
}

/**
 * Bring the army home if a host is coming and the camp cannot hold.
 *
 * Returns the set of sources it spent, so the caller can keep them out of the
 * ordinary expansion loop — a garrison marched home and then marched at a farm
 * on the same think would be neither.
 */
export function defendTurn(view, state, out) {
  const spent = new Set();
  const camp = view.sites.find((s) => s.kind === 'camp' && s.owner === 'player');
  if (!camp) return spent;

  const { bodies, first } = inboundAt(view, camp);
  if (bodies <= 0) return spent;
  if ((first - view.tick) / TICK_HZ > HORIZON_SEC) return spent;

  // ALREADY ENOUGH IS ENOUGH. The camp defends at a multiplier and the
  // attackers have to breach it afterwards, so parity at the gate is a
  // comfortable hold rather than a coin flip — recalling the whole empire
  // against a host the camp already beats is how a bot loses a won battle to
  // its own panic.
  let held = total(camp.garrison);
  if (held >= bodies) return spent;

  // Nearest first, because the only thing that matters is arriving in time.
  const others = view.sites
    .filter((s) => s.owner === 'player' && s.id !== camp.id && total(s.garrison) > 3)
    .map((s) => ({ s, legs: travelTicks(state, s, camp, s.garrison, 'player') }))
    .filter((x) => Number.isFinite(x.legs))
    .sort((a, b) => a.legs - b.legs);

  for (const { s, legs } of others) {
    if (held >= bodies) break;
    // Too far to matter. `MAX_LEGS` is expressed against the wave's OWN
    // remaining flight rather than as a distance, so a long warning pulls from
    // further out and a short one does not bother.
    if (view.tick + legs > first + MAX_LEGS * TICK_HZ) continue;
    const comp = scaleComp(s.garrison, RECALL_FRAC);
    const n = total(comp);
    if (n <= 0) continue;
    out.push({
      t: 'SEND', by: 'player', from: s.id, to: camp.id,
      fraction: RECALL_FRAC, filter: [...UNIT_IDS],
    });
    spent.add(s.id);
    held += n;
  }
  return spent;
}
