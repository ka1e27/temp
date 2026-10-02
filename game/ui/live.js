// One polite live region for things that appear and go without taking focus (a new hint, a send that was refused, the map cursor moving). Browser only; no
// game-logic imports. Toasts and the results card carry their own live regions; everything else announces through here (DESIGN §7.5a).
//
//   announce('Greenreach, frontier, Easy')
//
// The region is visually hidden, always present once created, and never made inert by a dialog (`data-keep-live`). The text is cleared and set a moment
// later so the same sentence twice in a row is still read.
let region = null;
let timer = null;

function ensure() {
  if (region || typeof document === 'undefined') return region;
  region = document.createElement('div');
  region.className = 'visually-hidden';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  region.setAttribute('data-keep-live', '');
  region.id = 'a11y-live';
  document.body.appendChild(region);
  return region;
}

/** @param {string} text */
export function announce(text) {
  const r = ensure();
  if (!r || !text) return;
  r.textContent = '';
  clearTimeout(timer);
  timer = setTimeout(() => { r.textContent = text; }, 60);
}

/** The text last handed to `announce` (for tests and the keyboard check). */
export function lastAnnouncement() {
  return region ? region.textContent : '';
}
