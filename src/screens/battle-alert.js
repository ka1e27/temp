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
import { rejectionText } from './battle-upgrade.js';
import { siteOf } from './battle-preview.js';

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
  const { input, holdMs = 4000 } = o;
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
 * One-line inline message: rejections, and what an armed booster is waiting
 * for. Empty text renders nothing at all, so it costs no space when silent.
 * @param {{ttlMs?:number}} [o]
 */
export function createAlert(o = {}) {
  const ttl = o.ttlMs ?? 2600;
  const el = h('div.hud-alert', { role: 'status', 'aria-live': 'polite', text: '' });
  const set = {
    text: bindText(el, ''),
    open: bindClass(el, 'is-open'),
    danger: bindClass(el, 'is-danger'),
    good: bindClass(el, 'is-good'),
  };
  let until = 0;
  let sticky = '';

  return {
    el,
    /**
     * Transient message; replaces whatever is showing.
     *
     * `tone` exists because this line now carries losing a stronghold as well
     * as a rejected click, and those must not look the same. A threat also
     * holds twice as long: the whole point is that it reaches a player who is
     * looking at another part of the map.
     * @param {'info'|'danger'|'good'} [tone]
     */
    show(text, now, tone = 'info') {
      until = now + (tone === 'danger' ? ttl * 1.6 : ttl);
      set.text(text);
      set.danger(tone === 'danger');
      set.good(tone === 'good');
      set.open(true);
    },
    /** Persistent message (armed booster). Restored when a flash expires. */
    hold(text) {
      sticky = text || '';
      if (!until) { set.text(sticky); set.open(!!sticky); }
    },
    update(now) {
      if (until && now >= until) {
        until = 0;
        set.text(sticky);
        set.open(!!sticky);
      }
    },
  };
}

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
 *          onShake:(i:number, until:number)=>void}} o
 */
export function wireAlerts(o) {
  const { bus, off, alert, getState, boosterIds, boostShake, aiming, onShake } = o;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const kindOf = (ev) => spaceCase(ev.kind).toLowerCase();

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
    if (ev.from === 'player') alert.show(`LOST — ${kindOf(ev)} taken`, now(), 'danger');
    else if (ev.to === 'player') alert.show(`TAKEN — ${kindOf(ev)}`, now(), 'good');
  }));
  // BOTH ENDS. `owner` is who is besieging, `defender` whose ground it is —
  // checking only the first meant the enemy sweeping up empty NEUTRAL farms
  // three hexes away fired a red UNDER SIEGE banner seconds into every battle,
  // which reads identically to your own farm being stormed.
  off(bus.on('battle:siege-begun', (ev) => {
    if (ev.owner === 'enemy' && ev.defender === 'player') {
      alert.show(`UNDER SIEGE — ${kindOf(ev)}`, now(), 'danger');
    }
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
    if (a) alert.show(a.text, now(), a.tone);
  }));
}
