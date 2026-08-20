import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  watchInstall, installOffer, promptInstall, onInstallChange, __resetInstall,
} from '../src/ui/install.js';

// A fake window that records its listeners, so a test can fire the browser
// event the real thing fires once and never again.
function fakeWin() {
  const handlers = {};
  return {
    addEventListener: (k, fn) => { (handlers[k] ??= []).push(fn); },
    fire: (k, ev) => (handlers[k] ?? []).forEach((fn) => fn(ev)),
    handlers,
  };
}

/** A BeforeInstallPromptEvent that can only be prompted once, as the real one is. */
function fakeEvent(outcome = 'accepted') {
  let spent = false;
  return {
    prevented: false,
    preventDefault() { this.prevented = true; },
    prompt() {
      if (spent) throw new Error('prompt() called twice');
      spent = true;
      return Promise.resolve();
    },
    userChoice: Promise.resolve({ outcome }),
    get spent() { return spent; },
  };
}

test.beforeEach(() => __resetInstall());

test('nothing is offered until the browser hands over a prompt', () => {
  // THE NEGATIVE CONTROL, and the important one: an offer that showed
  // unconditionally would pass every test below and put a dead button in front
  // of every player on a browser that cannot install anything.
  const win = fakeWin();
  watchInstall(win);
  assert.equal(installOffer().shown, false);
});

test('the offer appears once beforeinstallprompt fires, with real copy', () => {
  const win = fakeWin();
  watchInstall(win);
  win.fire('beforeinstallprompt', fakeEvent());
  const o = installOffer();
  assert.equal(o.shown, true);
  assert.ok(o.label.length > 0, 'a shown offer needs a label');
  assert.match(o.hint, /offline/i, 'the hint should say what installing buys');
});

test('the browser mini-infobar is suppressed', () => {
  // Two install affordances competing on one screen is worse than one.
  const win = fakeWin();
  watchInstall(win);
  const ev = fakeEvent();
  win.fire('beforeinstallprompt', ev);
  assert.equal(ev.prevented, true);
});

test('accepting installs and retires the offer', async () => {
  const win = fakeWin();
  watchInstall(win);
  win.fire('beforeinstallprompt', fakeEvent('accepted'));
  assert.equal(await promptInstall(), true);
  assert.equal(installOffer().shown, false, 'a spent prompt must not be re-offered');
});

test('dismissing also retires the offer, because the event is spent', async () => {
  // The way this API is usually got wrong: clearing on success alone leaves a
  // button that throws `prompt() called twice` the second time it is pressed.
  const win = fakeWin();
  watchInstall(win);
  const ev = fakeEvent('dismissed');
  win.fire('beforeinstallprompt', ev);
  assert.equal(await promptInstall(), false);
  assert.equal(installOffer().shown, false);
  assert.equal(await promptInstall(), false, 'a second press must be a no-op, not a throw');
});

test('appinstalled retires the offer even if it was never pressed', () => {
  // The player can install through the browser's own route while the menu is
  // open; the row has to notice.
  const win = fakeWin();
  watchInstall(win);
  win.fire('beforeinstallprompt', fakeEvent());
  assert.equal(installOffer().shown, true);
  win.fire('appinstalled', {});
  assert.equal(installOffer().shown, false);
});

test('subscribers are told when the offer changes, and can unsubscribe', () => {
  const win = fakeWin();
  watchInstall(win);
  let n = 0;
  const off = onInstallChange(() => { n += 1; });
  win.fire('beforeinstallprompt', fakeEvent());
  assert.equal(n, 1, 'a new prompt must wake a mounted menu');
  off();
  win.fire('appinstalled', {});
  assert.equal(n, 1, 'an unsubscribed screen must not be called');
});

test('watchInstall survives an environment with no window at all', () => {
  assert.doesNotThrow(() => watchInstall(undefined));
  assert.doesNotThrow(() => watchInstall({}));
  assert.equal(installOffer().shown, false);
});

// THE WIRING, asserted against source. The module can be perfect and still
// reach nobody — which is exactly how `beforeinstallprompt` was missed for the
// life of the feature: the manifest and sw.js shipped and nothing captured it.
test('the prompt is captured at boot and offered in the menu', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /watchInstall\(window\)/, 'main.js must capture the prompt');
  // Before the first await-shaped thing, or the event is already gone.
  assert.ok(main.indexOf('watchInstall(window)') < main.indexOf('createBus()'),
    'capture must happen before the game boots');

  const menu = readFileSync(new URL('../src/screens/mainmenu.js', import.meta.url), 'utf8');
  assert.match(menu, /installOffer\(\)/, 'the menu must ask whether to offer it');
  assert.match(menu, /promptInstall\(\)/, 'the button must actually prompt');
  assert.match(menu, /onInstallChange\(/, 'the row must re-render when the offer arrives');
});
