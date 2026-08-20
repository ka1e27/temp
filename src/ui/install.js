// INSTALLING THE GAME. The manifest, the icons and sw.js have all shipped for
// releases, so the game was installable the whole time — and the ONLY route in
// was whatever prompt the browser decided to show on its own, which on desktop
// Chrome is an address-bar icon most players never look at and on iOS is a
// Share-sheet item with no relation to this game at all. An idle game that
// pays out absences is exactly the kind a player wants on a home screen, and
// nothing anywhere said it could go there.
//
// `beforeinstallprompt` fires ONCE, early, and is not replayable — the browser
// hands over a single `prompt()` and takes it back after use. So it has to be
// captured at boot, before any screen exists to want it, and parked. That is
// the whole reason this is a module with state rather than a listener a screen
// installs when it mounts: by the time the main menu is built, the event is
// long gone.
//
// It lives in ui/ and not meta/ because it touches `window`, which the four
// pure directories may never do. The DECISION is still a pure function —
// `installOffer` — for the same reason `recruitOffer` and `offlineNotice` are:
// a screen that decided for itself is a rule with no test but squinting at it.

/** @type {any} the parked BeforeInstallPromptEvent, or null */
let deferred = null;
/** Set once the browser reports the app installed, so the offer retires. */
let installed = false;
/** Bumped on every state change, so a mounted screen can re-render. */
const listeners = new Set();

function announce() {
  for (const fn of listeners) fn();
}

/**
 * Capture the prompt at boot. Idempotent, and safe to call in any environment —
 * a browser that never fires the event, or no browser at all, simply leaves the
 * offer hidden forever, which is the correct answer for both.
 *
 * @param {object} [win] injected for tests; defaults to the real window
 */
export function watchInstall(win = globalThis) {
  if (!win?.addEventListener) return;
  win.addEventListener('beforeinstallprompt', (ev) => {
    // Chrome shows its own mini-infobar unless this is called, and two install
    // affordances competing on one screen is worse than the one we control.
    ev.preventDefault?.();
    deferred = ev;
    installed = false;
    announce();
  });
  win.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    announce();
  });
}

/** Re-render hook for a mounted screen. Returns its own unsubscribe. */
export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Whether to offer the install, and what to say. Pure — it reads the parked
 * event and nothing else, so a test can drive every branch without a browser.
 *
 * There are deliberately only two states rather than three. A "you already
 * have it installed" row was drafted and dropped: the player reading it is by
 * definition inside the installed app, so it is a row that only ever appears
 * to someone who cannot act on it.
 *
 * @returns {{shown: boolean, label: string, hint: string}}
 */
export function installOffer() {
  if (installed || !deferred) return { shown: false, label: '', hint: '' };
  return {
    shown: true,
    label: 'Install',
    hint: 'Add Hex Dominion to this device. It runs offline, so your empire keeps paying out.',
  };
}

/**
 * Fire the browser's own install flow. Resolves to whether the player accepted.
 *
 * The event is SPENT either way — accepted or dismissed, `prompt()` may not be
 * called twice on the same event — so it is cleared before awaiting the answer
 * rather than after. Clearing on success alone would leave a dead button that
 * throws on a second press, which is how this API is usually got wrong.
 */
export async function promptInstall() {
  const ev = deferred;
  if (!ev) return false;
  deferred = null;
  announce();
  try {
    await ev.prompt?.();
    const choice = await ev.userChoice;
    return choice?.outcome === 'accepted';
  } catch {
    // A refused or already-consumed prompt is not an error worth surfacing:
    // the game is unaffected and the browser's own route in still exists.
    return false;
  }
}

/** Test seam — resets the parked state between cases. */
export function __resetInstall() {
  deferred = null;
  installed = false;
  listeners.clear();
}
