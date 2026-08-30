// Low-level drivers shared by every phase of tools/smoke.mjs.
//
// EVERY interaction goes through real pointer events at real screen
// coordinates, and every click first asserts that the browser's own hit test
// actually lands on the target. A synthetic `el.click()` bypasses hit testing
// entirely, which is exactly how a completely unclickable UI once passed this
// suite green: `#screen-root` was pointer-events:none and no scene opted back
// in, so every button was dead while looking perfectly fine.
//
// Bound to one `page` via `makeHelpers`, rather than each function taking a
// `page` argument, so every call site downstream reads exactly as it did
// before the split — `h.click(sel)`, not `click(page, sel)`.
export function makeHelpers(page) {
  /**
   * Poll until the page reports `ready`, instead of sleeping a guessed number
   * of milliseconds and asserting into the dark.
   *
   * This file is now a DEPLOY GATE, and that changes what a fixed sleep
   * costs. A guessed delay that is generous on a dev box is a coin flip on a
   * CI runner — slower, shared, and running the dev server in the same
   * container. Observed here: the abdication drawer failed once with
   * `rows: 0` under load and passed twice immediately after, on identical
   * code. A flaky gate is worse than no gate, because the first thing anyone
   * learns is to re-run it.
   *
   * Returns the LAST value even on timeout, so the assertion that follows
   * can still say what it actually saw rather than "timed out".
   */
  async function waitFor(fn, ms = 5000) {
    const deadline = Date.now() + ms;
    let last;
    for (;;) {
      last = await page.eval(fn);
      if (last?.ready) return last;
      if (Date.now() > deadline) return last;
      await page.sleep(100);
    }
  }

  const scene = () => page.eval(() => document.body.dataset.scene ?? null);
  const has = (sel) => page.eval((s) => !!document.querySelector(s), sel);

  /** Locate an element and verify the browser would actually deliver a click. */
  async function hitPoint(selector, label = selector) {
    const r = await page.eval((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { err: 'not found' };
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return { err: 'zero size' };
      const cx = Math.round(b.left + b.width / 2);
      const cy = Math.round(b.top + b.height / 2);
      const hit = document.elementFromPoint(cx, cy);
      const ok = hit === el || el.contains(hit) || hit?.contains(el);
      return {
        cx, cy, ok,
        blockedBy: ok ? null : (hit ? `${hit.tagName}.${hit.className}` : 'nothing'),
        pe: getComputedStyle(el).pointerEvents,
      };
    }, selector);
    if (r.err) throw new Error(`${label}: ${r.err}`);
    if (!r.ok) {
      throw new Error(
        `${label} is not clickable — hit test at (${r.cx},${r.cy}) landed on `
        + `${r.blockedBy} instead (pointer-events: ${r.pe})`,
      );
    }
    return r;
  }

  /** Click the way a player does: real pointer events, hit test asserted first. */
  async function click(selector, label = selector) {
    const p = await hitPoint(selector, label);
    await page.mouse('mouseMoved', p.cx, p.cy);
    await page.mouse('mousePressed', p.cx, p.cy);
    await page.mouse('mouseReleased', p.cx, p.cy);
    await page.sleep(320);
    return p;
  }

  /** Click a raw canvas point rather than a selector — for a gesture that
   *  targets bare ground, where there is no DOM element for hitPoint() to
   *  resolve against. */
  async function clickAt(x, y) {
    await page.mouse('mouseMoved', x, y);
    await page.mouse('mousePressed', x, y);
    await page.mouse('mouseReleased', x, y);
    await page.sleep(320);
  }

  /** Advance out of whatever screen we are on until we reach `want`. */
  async function reach(want, maxHops = 6) {
    for (let i = 0; i < maxHops; i++) {
      const at = await scene();
      if (at === want) return true;
      // Known one-click transitions between screens.
      const routes = [
        ['.menu-continue, .menu-new', 'main menu'],
        ['.pb-go, .pb-launch, .prebattle-go', 'loadout launch'],
        ['.results-map', 'results → map'],
        ['button.wm-go', 'invade'],
      ];
      let moved = false;
      for (const [sel] of routes) {
        if (await has(sel)) { await click(sel); moved = true; break; }
      }
      if (!moved) return false;
    }
    return (await scene()) === want;
  }

  // `page` is handed back too, so a step that needs a raw `eval` does not have
  // to take a second parameter alongside the helpers it already has.
  return { page, waitFor, scene, has, hitPoint, click, clickAt, reach };
}
