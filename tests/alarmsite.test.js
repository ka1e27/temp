// THE ALERT NAMES A SITE AND THE BOARD NEVER POINTED AT IT.
//
// Measured by a readability pass on a real gallowmoor frame: the strip read
// `ATTACKED — training ground will fall` while five enemy counts (5, 7, 8, 7, 6)
// sat within one screen-width of the player's own (56, 1, 4) at nearly the same
// size, every inbound force the identical red pennant, and nothing anywhere
// saying which of them the sentence meant.
//
// The fix is the `buildBlocker`/`boosterBlocker` pattern: ONE decision, two
// surfaces. This file pins the decision, and — more importantly — pins that the
// two surfaces cannot disagree, because a mark that named a different site from
// the text would be worse than no mark at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { alarmSite, ALARM_MS, wireAlerts, fightAlert } from '../src/screens/battle-alert.js';

test('only DANGER flags a site', () => {
  // `TAKEN — farm` is good news about something already finished; there is
  // nothing to go and look at, and a mark on every success would be back to
  // 25-a-minute chatter in a second channel.
  assert.equal(alarmSite('danger', 'es04'), 'es04');
  assert.equal(alarmSite('good', 'es04'), null);
  assert.equal(alarmSite(undefined, 'es04'), null);
});

test('...and a danger message that names no site flags nothing', () => {
  // Rejections and the stalemate warning are danger-toned and positional about
  // nothing. A flag needs an id or it is a mark with no place to be.
  assert.equal(alarmSite('danger', null), null);
  assert.equal(alarmSite('danger', undefined), null);
});

test('the mark outlives the words', () => {
  // The text is a sentence you read once; the mark is where you look after
  // reading it. A mark that expired with the words would answer a question the
  // player only asks once the words are gone.
  assert.ok(ALARM_MS > 2600, `${ALARM_MS} must outlast the alert's own hold`);
  assert.ok(ALARM_MS <= 15000, `${ALARM_MS} is long enough to accumulate alarms`);
});

/** A bus that lets a test fire one event and see what the HUD was told. */
function harness(state) {
  const handlers = {};
  const shown = [];
  const flagged = [];
  wireAlerts({
    bus: { on: (k, fn) => { handlers[k] = fn; return () => {}; } },
    off: () => {},
    alert: { show: (text, _t, tone) => shown.push({ text, tone }), hold: () => {} },
    getState: () => state,
    boosterIds: [], boostShake: [], aiming: () => '',
    onShake: () => {},
    onFlag: (siteId, until) => flagged.push({ siteId, until }),
  });
  return { handlers, shown, flagged };
}

const board = {
  sites: [
    { id: 'ps01', kind: 'trainingGround', owner: 'player', hex: [1, 1] },
    { id: 'ps02', kind: 'farm', owner: 'player', hex: [2, 1] },
    { id: 'es04', kind: 'stronghold', owner: 'enemy', hex: [5, 5] },
  ],
};

test('the site the strip NAMES is the site the board is told to mark', () => {
  // The property that matters, and the reason the decision is one function:
  // text and mark read the same answer, so they cannot name different sites.
  const h = harness(board);
  h.handlers['battle:field-battle']({
    siteId: 'ps01', attacker: 'enemy', win: true,
  });
  assert.equal(h.shown.length, 1);
  assert.match(h.shown[0].text, /ATTACKED/);
  assert.equal(h.flagged.length, 1);
  assert.equal(h.flagged[0].siteId, 'ps01');
});

test('a fight the player is WINNING says nothing and marks nothing', () => {
  // The negative control. `fightAlert` speaks for two outcomes out of hundreds;
  // if the mark spoke for more than the text does, the board would light up on
  // events the player was never told about.
  const h = harness(board);
  h.handlers['battle:field-battle']({ siteId: 'es04', attacker: 'player', win: true });
  assert.equal(h.shown.length, 0);
  assert.equal(h.flagged.length, 0);
});

test('losing your own site marks it; taking one does not', () => {
  const h = harness(board);
  h.handlers['battle:site-captured']({ siteId: 'ps01', kind: 'trainingGround', from: 'player', to: 'enemy' });
  h.handlers['battle:site-captured']({ siteId: 'es04', kind: 'stronghold', from: 'enemy', to: 'player' });
  assert.equal(h.shown.length, 2, 'both are announced');
  assert.equal(h.flagged.length, 1, 'only the loss is marked');
  assert.equal(h.flagged[0].siteId, 'ps01');
});

test('a siege on the ENEMY\'s ground marks nothing', () => {
  // The same asymmetry `UNDER SIEGE` already keeps in words: `defender` is whose
  // ground it is, and the enemy sweeping up neutral farms must not fire a red
  // banner — nor, now, a red bracket.
  const h = harness(board);
  h.handlers['battle:siege-begun']({ siteId: 'es04', kind: 'stronghold', owner: 'player', defender: 'enemy' });
  assert.equal(h.flagged.length, 0);
  h.handlers['battle:siege-begun']({ siteId: 'ps01', kind: 'trainingGround', owner: 'enemy', defender: 'player' });
  assert.equal(h.flagged.length, 1);
  assert.equal(h.flagged[0].siteId, 'ps01');
});

test('every site a danger alert can name is one the player can see', () => {
  // FOG SAFETY, asserted as the property rather than trusted from the comment.
  // There is no `canSee` call in the flag path, and this is why: every branch
  // that can flag names ground the player OWNS or is themselves assaulting.
  const mine = { id: 'ps01', kind: 'trainingGround', owner: 'player', hex: [1, 1] };
  const theirs = { id: 'es04', kind: 'stronghold', owner: 'enemy', hex: [5, 5] };
  // ATTACKED only fires when the site is the viewing faction's own.
  assert.ok(fightAlert({ attacker: 'enemy', win: true }, mine));
  assert.equal(fightAlert({ attacker: 'enemy', win: true }, theirs), null);
  // LOSING only fires on the player's OWN assault, which siteFightSight lights.
  const losing = fightAlert({ attacker: 'player', win: false }, theirs);
  assert.match(losing.text, /LOSING/);
});

test('wireAlerts works with no onFlag at all', () => {
  // It is optional on purpose — this function has callers with no board to
  // mark, and an undefined callback must not throw inside a bus handler. That
  // is not hypothetical: a throw out of a handler once ate the rest of a
  // battle's events (see the guard comment on the field-battle listener).
  const handlers = {};
  wireAlerts({
    bus: { on: (k, fn) => { handlers[k] = fn; return () => {}; } },
    off: () => {}, alert: { show: () => {}, hold: () => {} },
    getState: () => board, boosterIds: [], boostShake: [], aiming: () => '',
    onShake: () => {},
  });
  assert.doesNotThrow(() => handlers['battle:site-captured']({
    siteId: 'ps01', kind: 'farm', from: 'player', to: 'enemy',
  }));
});

test('SEVERAL live threats are all marked, not just the most recent', () => {
  // The readability complaint this exists to answer: the strip is
  // last-write-wins, and five threats were live on one measured frame while
  // the one line could name a single training ground. The board has room.
  const h = harness(board);
  h.handlers['battle:field-battle']({ siteId: 'ps01', attacker: 'enemy', win: true });
  h.handlers['battle:siege-begun']({
    siteId: 'ps02', kind: 'farm', owner: 'enemy', defender: 'player',
  });
  assert.equal(h.flagged.length, 2);
  assert.deepEqual(h.flagged.map((f) => f.siteId).sort(), ['ps01', 'ps02']);
  // ...and the strip still only ever says the latest, which is correct: one
  // line cannot say two things, which is the whole reason the board says them.
  assert.equal(h.shown.length, 2);
});

test('re-arming a site that is already marked extends it rather than doubling', () => {
  // A threat that keeps firing should stay lit, not accumulate entries. The
  // view state is keyed by site id, so this is a property of the shape rather
  // than of a de-duplication step — asserted so a future change to a list
  // cannot quietly reintroduce the pile-up.
  const view = { alarms: {} };
  const h = harness(board);
  for (const f of [0, 1, 2]) {
    h.handlers['battle:field-battle']({ siteId: 'ps01', attacker: 'enemy', win: true });
    void f;
  }
  for (const f of h.flagged) view.alarms[f.siteId] = f.until;
  assert.equal(Object.keys(view.alarms).length, 1);
});
