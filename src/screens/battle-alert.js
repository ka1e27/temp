// The HUD's two message controls: Withdraw, and the one-line status strip.
//
// Split out of battle-panel.js when the site panel moved onto the board. They
// never had anything to do with a selected site — they are corner furniture —
// and battle-panel.js needed the room for the anchoring maths.
//
// battle-panel.js re-exports both, so every existing import path still works.
//
// HARD RULE, same as everywhere: nothing here mutates simulation state. The
// Withdraw button appends a command through `input`, exactly like a click on
// the board does.
import { h, bindText, bindClass } from '../ui/dom.js';
import { spaceCase } from '../ui/format.js';
import { RESULTS } from '../content/strings.js';
import { rejectionText } from './battle-upgrade.js';
import { siteOf } from './battle-preview.js';

/**
 * HAS THIS BATTLE STOPPED BEING A BATTLE? A pure fold over the site tally, so
 * the rule is testable without a DOM and there is exactly one of it.
 *
 * `Withdraw` is always on screen and withdrawing is genuinely FREE — a retreat
 * does not increment `stats.losses` and leaves the region untouched — so the
 * tool to cut a dead battle short already exists. Nothing ever told the player
 * they were in one. Measured on real battles: **widowsgate locks at 7 sites v
 * 48 by minute 9 and does not move a single site for the remaining 25 minutes**,
 * 74% of a 34-minute cap; gallowmoor locks at minute 26 and sits for 12 more.
 * A timeout is not an early exit the sim takes when nothing is happening —
 * `endPhase` only assigns it at `hardCapTicks` — so every one of those minutes
 * is paid in full, by a player watching a board that has stopped changing.
 *
 * IT WARNS, IT DOES NOT ACT. Withdrawing is the player's call and a frozen
 * tally is not proof of a lost battle (duskfell, measured, was genuinely
 * contested to the wire and decided in the last 5% of its clock). So this is a
 * nudge toward a button that is already there, not an auto-resign.
 *
 * `memo` is the caller's own scratch — presentation state, not sim state, so it
 * neither replays nor crosses the contract. It is mutated in place rather than
 * returned so the per-frame path allocates nothing.
 *
 * @param {{tally:string, tick:number, hz:number}} now
 * @param {{tally:?string, since:number, warnedAt:number}} memo
 * @returns {boolean} true when the caller should raise the warning THIS frame
 */
export function stalemateCheck(now, memo, opts = {}) {
  const quietSec = opts.quietSec ?? 180;      // three minutes of a still board
  const repeatSec = opts.repeatSec ?? 120;    // and no more than one nag every two
  const minTick = opts.minTick ?? (now.hz * 120);
  if (memo.tally !== now.tally) {             // the board moved: reset and say nothing
    memo.tally = now.tally;
    memo.since = now.tick;
    return false;
  }
  // Too early to call it: an opening where nothing has changed hands yet is not
  // a stalemate, it is an opening.
  if (now.tick < minTick) return false;
  const stillFor = (now.tick - memo.since) / now.hz;
  if (stillFor < quietSec) return false;
  if (memo.warnedAt && (now.tick - memo.warnedAt) / now.hz < repeatSec) return false;
  memo.warnedAt = now.tick;
  return true;
}

// The strip itself — see ./battle-alertstrip.js. This file decides WHAT is worth
// saying; that one is the single line every decision has to fit through.
export { createAlert } from './battle-alertstrip.js';

/**
 * Withdraw. Confirm-style rather than a plain button: ending a run on one
 * stray click is the kind of thing you only regret once, which is also why
 * battle-input.js keeps it off every key.
 *
 * IT IS ALSO THE ONLY LABELLED WAY OUT OF A BATTLE, and that was a real
 * problem, because it is not the only way out — screens/battle.js autosaves the
 * whole fight every four seconds and main.js resumes it ahead of every other
 * boot route, for twelve hours. A player who has to stop can simply close the
 * tab and lose nothing. Nothing said so anywhere, so the one visible exit from
 * a 7-to-15-minute battle was the destructive one, and "I had to go" and "I
 * gave up" collapsed into the same button.
 *
 * The hint rides the CONFIRM state rather than a tooltip, for two reasons: a
 * tooltip does not exist on a touchscreen, which is half of where this is
 * played; and arming the button is the exact moment a player has decided to
 * leave and has not yet decided how. It is a sibling element rather than part
 * of the label so the button keeps one accessible name.
 * @param {{input:object, holdMs?:number}} o
 */
export function createWithdraw(o) {
  // HOW LONG THE CONFIRM STAYS ARMED, and four seconds was too short to read
  // the sentence it puts on screen. The hint is 95 characters — "This gives up
  // the region. Just closing the tab keeps it — the battle resumes." — which is
  // about three and a half seconds of reading before a player has even decided,
  // so the window could close while they were reading the thing it asked them to
  // read. A first-session critic hit exactly that and filed it as the confirm
  // expiring silently; it does revert visibly (the label goes back to
  // "Withdraw" and the hint closes), it simply reverted faster than the copy
  // could be consumed.
  //
  // It still disarms, and that is not negotiable: a confirm that stays armed
  // turns a forgotten click into a withdrawal minutes later, which is the one
  // outcome worse than having to click twice.
  const { input, holdMs = 8000 } = o;
  let armedAt = 0;
  const el = h('button.btn.ghost.hud-withdraw', {
    'data-interactive': true,
    type: 'button',
    title: 'Give up the region. To stop for now instead, just close the tab —'
      + ' the battle is saved and picks up where you left it.',
    on: {
      click: () => {
        const now = Date.now();
        if (armedAt && now - armedAt < holdMs) { armedAt = 0; sync(0); input.withdraw(); return; }
        armedAt = now;
        sync(now);
      },
    },
  }, 'Withdraw');

  // `role: 'status'` rather than an alert: it is an alternative, not a warning,
  // and it must not interrupt a screen reader mid-battle.
  const hint = h('div.hud-leavehint', { role: 'status', 'aria-live': 'polite', text: '' });

  const set = {
    text: bindText(el, 'Withdraw'),
    armed: bindClass(el, 'is-confirming'),
    hint: bindText(hint, ''),
    hintOpen: bindClass(hint, 'is-open'),
  };
  const sync = (at) => {
    set.text(at ? 'Confirm withdraw' : 'Withdraw');
    set.armed(!!at);
    set.hint(at ? 'This gives up the region. Just closing the tab keeps it — the battle resumes.' : '');
    set.hintOpen(!!at);
  };

  return {
    el,
    /** Placed by the HUD beside the button. Separate so the button keeps one
     *  accessible name and the hint can wrap to its own line. */
    hint,
    /** Called from the HUD's 10Hz refresh; disarms itself so a forgotten click
     *  never turns into a withdrawal minutes later. */
    update(now) {
      if (armedAt && now - armedAt >= holdMs) { armedAt = 0; sync(0); }
    },
    get isArmed() { return armedAt !== 0; },
  };
}

/**
 * What a `field-battle` should SAY to the player, or null for silence.
 *
 * The melee layer's whole premise is that a fight now has a middle the player
 * can act inside — reinforce it, pull out of it, redirect around it. Nothing
 * told them the middle existed: `field-battle` had no listener at all, and the
 * burst and the clash sound fire identically whether the fight is a curb-stomp
 * or a wipeout. A 500-militia rout and a 5-militia suicide were the same
 * three-frame flash.
 *
 * SILENCE IS THE DEFAULT AND IT IS THE HARD PART. Measured over whole battles,
 * `field-battle` fires 73 times on riverfen and 929 on gallowmoor; of those,
 * 40 and 374 are the player's own assaults. The alert has no queue — every call
 * replaces whatever is showing — so announcing "a fight started" at that rate
 * would bury the one message that mattered under 25 a minute of chatter, which
 * is indistinguishable from saying nothing.
 *
 * So this speaks for exactly the two outcomes a player would act on, and both
 * are things they cannot currently see:
 *
 *   MY ASSAULT IS LOSING   3 a battle on riverfen, 0 on gallowmoor. It is the
 *                          six-second opening the whole layer exists to create,
 *                          and it was completely silent.
 *   MY SITE WILL FALL      an enemy attack that the projection says wins. The
 *                          existing UNDER SIEGE alert fires only AFTER the
 *                          garrison has already lost the field, which is too
 *                          late to relieve.
 *
 * A fight the player is winning says nothing: they can see the outcome arrive,
 * and a game that congratulates you 374 times is a game you stop reading.
 *
 * PURE — takes the event and the site, returns text or null. Tested headlessly.
 * @returns {{text:string, tone:string}|null}
 */
export function fightAlert(ev, site, faction = 'player') {
  if (!ev || ev.attacker === undefined) return null;
  const what = site ? spaceCase(site.kind).toLowerCase() : 'the field';
  // `win` is always from the ATTACKER's point of view.
  if (ev.attacker === faction) {
    return ev.win ? null : { text: `LOSING — assault on ${what}`, tone: 'danger' };
  }
  if (site && site.owner === faction && ev.win) {
    return { text: `ATTACKED — ${what} will fall`, tone: 'danger' };
  }
  return null;
}

/**
 * HOW LONG THE BOARD KEEPS SHOWING WHICH SITE THE ALERT MEANT, in ms.
 *
 * Deliberately LONGER than the alert's own hold. The text is a sentence you
 * read once; the mark is where you look after reading it, and a mark that
 * expired with the words would answer a question the player only asks once the
 * words are gone. Short enough that a battle does not accumulate a board full
 * of standing alarms — a threat that is still live re-fires and re-arms this.
 */
export const ALARM_MS = 6000;

/**
 * WHICH SITE, IF ANY, THE ALERT IS TALKING ABOUT.
 *
 * The alert strip has said `ATTACKED — training ground will fall` since the
 * melee layer shipped, and the board has never singled that site out. Measured
 * by a readability pass on a real gallowmoor frame: five enemy counts (5, 7, 8,
 * 7, 6) within one screen-width of the player's own (56, 1, 4) at nearly the
 * same size, every inbound force the same red pennant, and nothing anywhere
 * saying which of them the sentence named. The player has to already know which
 * glyph is a training ground, find it among three to six similar icons, and
 * trust the text over the picture.
 *
 * So this is the `buildBlocker`/`boosterBlocker` pattern once more: ONE
 * decision, two surfaces. The text and the mark cannot name different sites,
 * because there is only one answer and both read it.
 *
 * ONLY DANGER. `TAKEN — farm` is good news about something that has already
 * finished happening; there is nothing to go and look at. This exists to answer
 * "what needs attention", and a mark that also fired on success would be back
 * to 25-a-minute chatter in a second channel.
 *
 * FOG-SAFE BY CONSTRUCTION rather than by a check, which is why there is no
 * `canSee` call here: every danger alert that names a site names one the player
 * OWNS (`LOST`, `UNDER SIEGE` with `defender === 'player'`, `ATTACKED` with
 * `site.owner === faction`) or one they are themselves assaulting (`LOSING`,
 * which `siteFightSight` lights for exactly that reason). There is no path
 * through here that can point at ground the player cannot see.
 *
 * PURE — takes what the handler already has, returns an id or null.
 */
export function alarmSite(tone, siteId) {
  return tone === 'danger' && siteId != null ? siteId : null;
}

/**
 * One-line inline message: rejections, and what an armed booster is waiting
 * for. Empty text renders nothing at all, so it costs no space when silent.
 * @param {{ttlMs?:number}} [o]
 */

/**
 * Wire the bus to the alert strip: everything the HUD SAYS when the simulation
 * speaks, next to the control that says it.
 *
 * Split out of battle-hud.js at the 400-line cap, and along a real seam rather
 * than at a convenient line — that file builds and refreshes controls, this one
 * owns the one-line message and now owns what goes in it. The HUD keeps only
 * the two pieces of its own state a rejection touches (which booster shakes,
 * and until when), handed back through `onShake`.
 *
 * @param {{bus:object, off:Function, alert:object, getState:()=>object,
 *          boosterIds:string[], boostShake:Function[], aiming:(id:string)=>string,
 *          onShake:(i:number, until:number)=>void,
 *          onFlag?:(siteId:string, until:number)=>void}} o
 */
export function wireAlerts(o) {
  const { bus, off, alert, getState, boosterIds, boostShake, aiming, onShake } = o;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const kindOf = (ev) => spaceCase(ev.kind).toLowerCase();
  // Say it and point at it in one call, so a handler cannot do one and forget
  // the other. `onFlag` is optional: `wireAlerts` has other callers (tests) that
  // have no board to mark.
  const say = (text, tone, siteId) => {
    const t = now();
    alert.show(text, t, tone);
    const id = alarmSite(tone, siteId);
    if (id && o.onFlag) o.onFlag(id, t + ALARM_MS);
  };

  off(bus.on('battle:command-rejected', (ev) => {
    const t = now();
    // State is passed so the refusal can be FOG-SAFE — see rejectionText.
    alert.show(rejectionText(ev, getState()), t);
    const i = ev?.cmd?.t === 'BOOSTER' ? boosterIds.indexOf(ev.cmd.id) : -1;
    if (i >= 0) { onShake(i, t + 420); boostShake[i](true); }
  }));
  off(bus.on('ui:armed-booster', (id) => alert.hold(id ? aiming(id) : '')));

  // GROUND CHANGING HANDS, IN WORDS. The HUD listened to one of seventeen event
  // types, so the enemy could take a stronghold off you and leave no trace but a
  // ring in their colour on a 41px glyph.
  off(bus.on('battle:site-captured', (ev) => {
    if (ev.from === 'player') say(`LOST — ${kindOf(ev)} taken`, 'danger', ev.siteId);
    else if (ev.to === 'player') alert.show(`TAKEN — ${kindOf(ev)}`, now(), 'good');
  }));
  // BOTH ENDS. `owner` is who is besieging, `defender` whose ground it is —
  // checking only the first meant the enemy sweeping up empty NEUTRAL farms
  // three hexes away fired a red UNDER SIEGE banner seconds into every battle,
  // which reads identically to your own farm being stormed.
  off(bus.on('battle:siege-begun', (ev) => {
    if (ev.owner === 'enemy' && ev.defender === 'player') {
      say(`UNDER SIEGE — ${kindOf(ev)}`, 'danger', ev.siteId);
    }
  }));
  // THE ANTI-TURTLE LADDER, ANNOUNCED. `battle/sim.js attritionPhase` has cut
  // farm income, wall repair, garrison size and training throughput after
  // 150/210/270 seconds without a capture anywhere on the board for this
  // feature's whole life, and the only mention of it outside `battle/` and
  // `content/` was a COMMENT. So the numbers moved and nothing on screen said
  // why — and the third rung (half income, no repair at all, double-price
  // training) reads as the game breaking rather than as a rule.
  //
  // The event has existed since the phase was written and had no consumer. It
  // is NOT fog-gated: attrition is a rule of the whole board rather than a
  // positional claim, it names no site, and it applies to both sides.
  //
  // Stage 0 is silence, deliberately — the ladder RETIRES when ground changes
  // hands, and "the country has recovered" is a message nobody needs while they
  // are busy taking the thing that recovered it.
  off(bus.on('battle:attrition-stage', (ev) => {
    const line = RESULTS.attrition[(ev?.stage ?? 0) - 1];
    if (line) alert.show(line, now(), 'danger');
  }));

  // A FIGHT NOW HAS A MIDDLE, and nothing said so — see `fightAlert` above for
  // why this speaks for two outcomes out of the hundreds a battle fires.
  off(bus.on('battle:field-battle', (ev) => {
    // THE BATTLE MAY ALREADY BE GONE. `getState()` is `ctx.state.battle`, which
    // is cleared when the scene tears down, and an event can still be drained
    // against a listener that has not been disposed yet — so this must not
    // assume there is a board to look a site up in. `siteOf` does a bare
    // `state.sites.find`, so the unguarded version threw, the throw propagated
    // out of `bus.emit` in screens/battle.js's drain loop, and the rest of the
    // battle's events never arrived. It cost a green suite and a passing smoke
    // run to find, because nothing fails until the FIRST field battle fires.
    const st = getState();
    const s = st && ev.siteId ? siteOf(st, ev.siteId) : null;
    const a = fightAlert(ev, s);
    if (a) say(a.text, a.tone, ev.siteId);
  }));
}
