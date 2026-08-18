// THE AWAY BANNER, AND THE CAP LINE THAT WAS WRITTEN AND NEVER SHOWN.
//
// `applyOfflineProgress` has returned `cappedOut` since it was written and
// nothing ever read it, while `content/strings.js IDLE` carried five copy
// strings with no reader at all — the banner in `screens/worldmap.js` hardcoded
// its own beside them. So a player who idled past the cap lost every crown
// after it in silence, and the Treasury line, which is the upgrade that raises
// exactly that cap, was never named at the one moment it sells itself.
//
// Two costs, and the second is the one worth pinning: unread copy goes stale
// unnoticed. The dead `IDLE.awayCapped` still advertised a "Granary" upgrade
// that stopped existing when twenty-six upgrades collapsed into six endless
// lines. The last test in this file is the guard against that class rather than
// against this instance — every string in IDLE must reach a screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { offlineNotice } from '../src/meta/idle.js';
import { OFFLINE } from '../src/content/upgrades.data.js';
import { IDLE } from '../src/content/strings.js';

const HOUR = 3600_000;
const summary = (o) => ({
  crowns: 500, creditedMs: 2 * HOUR, capMs: 8 * HOUR, cappedOut: false, ...o,
});

test('an ordinary absence shows the banner and says nothing about the cap', () => {
  const n = offlineNotice(summary());
  assert.equal(n.shown, true);
  assert.equal(n.capped, false, 'two hours against an eight-hour cap cost nothing');
});

test('an absence that OUTRAN the cap says so', () => {
  const n = offlineNotice(summary({ creditedMs: 8 * HOUR, cappedOut: true }));
  assert.equal(n.shown, true);
  assert.equal(n.capped, true);
  assert.equal(n.capMs, 8 * HOUR, 'the banner needs the cap to name it');
});

test('a page reload announces nothing — both floors bind independently', () => {
  // The original defect this threshold exists for: "+0 crowns earned while you
  // were away (0.3s)" on every refresh.
  assert.equal(offlineNotice(summary({ creditedMs: 300, crowns: 0.02 })).shown, false);
  // A rich empire earns a crown in well under a second, so time alone is not
  // enough...
  assert.equal(offlineNotice(summary({ creditedMs: 400, crowns: 9000 })).shown, false,
    'under a minute, however rich');
  // ...and a poor one earns nothing over an hour, so time alone is not enough
  // in the other direction either.
  assert.equal(offlineNotice(summary({ creditedMs: HOUR, crowns: 0.4 })).shown, false,
    'under a crown, however long');
});

test('exactly at both floors it shows — the thresholds are inclusive', () => {
  const n = offlineNotice(summary({
    creditedMs: OFFLINE.noticeMinMs, crowns: OFFLINE.noticeMinCrowns,
  }));
  assert.equal(n.shown, true);
});

test('a banner that is not shown can never carry a cap line', () => {
  // `capped` is gated on `shown` so a caller reading it alone cannot render a
  // warning with nothing around it. A one-second reload of a capped-out save is
  // the case: `cappedOut` is true and there is still nothing to announce.
  const n = offlineNotice(summary({ creditedMs: 200, crowns: 0.01, cappedOut: true }));
  assert.equal(n.shown, false);
  assert.equal(n.capped, false);
});

test('no summary at all is silence, not a crash', () => {
  for (const bad of [null, undefined, {}, { crowns: NaN, creditedMs: Infinity }]) {
    const n = offlineNotice(bad);
    assert.equal(n.shown, false);
    assert.equal(n.capped, false);
    assert.equal(Number.isFinite(n.crowns), true, 'numbers stay numbers');
    assert.equal(Number.isFinite(n.capMs), true);
  }
});

// ---------------------------------------------------------------------------
// The class, not the instance
// ---------------------------------------------------------------------------

test('every string in IDLE reaches a screen', () => {
  // The whole block had no reader for the life of the feature and nothing
  // failed. This is the cheap guard: a key added here and never rendered is a
  // string that will go stale exactly the way `awayCapped` did.
  const here = dirname(fileURLToPath(import.meta.url));
  const screens = join(here, '..', 'src', 'screens');
  const src = readFileSync(join(screens, 'worldmap.js'), 'utf8');
  for (const key of Object.keys(IDLE)) {
    assert.ok(src.includes(`IDLE.${key}`), `IDLE.${key} is written and never rendered`);
  }
});

test('...and the copy names an upgrade that exists', () => {
  // `awayCapped` sold a "Granary" for years after the line was renamed. The
  // string must name something the shop actually sells.
  const line = IDLE.awayCapped('8h');
  assert.match(line, /Treasury/, 'the cap line must name the line that raises the cap');
  assert.doesNotMatch(line, /Granary/);
  assert.match(line, /8h/, 'and it must state the cap it hit');
});
