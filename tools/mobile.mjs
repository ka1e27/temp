// Phone-width UI audit. Walks every scene at real device metrics and reports
// the three things that actually break on a small screen:
//
//   1. HOW MUCH SCREEN THE BOARD ACTUALLY GETS. This is the one that matters
//      and the one that is easiest to miss. The HUD dock wraps, so at 390px
//      every group folded onto its own row and the stack took ~85% of the
//      screen: the board was a 200px band, the game was unplayable, and NOTHING
//      ELSE IN THIS FILE NOTICED — no overflow, no error, every tap target a
//      comfortable 44px. Measured as PLATE COVERAGE over a grid of points; the
//      first version hit-tested instead and was wrong for a subtle reason worth
//      reading before touching it (see the block itself).
//   2. HORIZONTAL OVERFLOW — the page is wider than the viewport, so the whole
//      layout scrolls sideways and the board drifts under the HUD.
//   3. OFF-SCREEN CONTROLS — a button whose centre is outside the viewport, or
//      which another element covers. Both are unreachable, and neither shows up
//      as an error anywhere.
//   4. TAP TARGETS UNDER 44px — the platform minimum. Below it a control is
//      technically present and practically unusable.
//
// Written as a REPORT rather than a pass/fail gate: which of these matter is a
// design call, and a number on a screenshot is more useful than an exit code.
// tools/smoke.mjs remains the gate for "does it work at all".
//
//   node tools/serve.js &     # or npm start
//   node tools/mobile.mjs                 # iPhone-ish 390x844
//   node tools/mobile.mjs --w=360 --h=740 # a small Android
import { mkdir } from 'node:fs/promises';
import { launch } from './cdp.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]),
);
const W = Number(args.w ?? 390);
const H = Number(args.h ?? 844);
const URL = process.env.URL || 'http://localhost:8080/';
const OUT = 'screenshots/mobile';
await mkdir(OUT, { recursive: true });

const MIN_TAP = 44;
const page = await launch({ url: URL, width: W, height: H });
let problems = 0;

await page.send('Emulation.setDeviceMetricsOverride', {
  width: W, height: H, deviceScaleFactor: 3, mobile: true,
});
await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const scene = () => page.eval(() => document.body.dataset.scene ?? null);
const has = (sel) => page.eval((s) => !!document.querySelector(s), sel);

/** Everything wrong with the current screen, measured in the browser. */
const audit = (min) => page.eval((minTap) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out = {
    scene: document.body.dataset.scene ?? null,
    vw,
    vh,
    scrollW: document.documentElement.scrollWidth,
    overflow: [],
    tiny: [],
    offscreen: [],
    boardPct: null,
  };

  // THE HEADLINE NUMBER: how much of the screen is still board.
  //
  // COVERAGE, not hit-testing. The first version asked `elementFromPoint` what
  // was on top and counted anything that was not a plate as board — wrong in
  // the one direction that matters, because `#hud` is pointer-events:none and
  // only the CONTROLS opt back in. A plate's opaque background is not
  // interactive, so every point over the body of a panel fell straight through
  // to the canvas and counted as a clear view: it scored a layout with two
  // full-height rails covering both flanks at 84%.
  //
  // A grid over the plates' rectangles answers what is actually PAINTED, and
  // the grid — rather than summing areas — is what makes two overlapping plates
  // count once instead of twice.
  //
  // Battle only: it is the scene with a board to be eaten. The world map and
  // the shop are documents, and "how much of a shop is not shop" is not a
  // question — asking it there produced a 0% and a false alarm.
  if (out.scene === 'battle') {
    const plates = [...document.querySelectorAll('.panel, .hint, .hud-objective')]
      .filter((el) => {
        const st = getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) > 0.05;
      })
      .map((el) => el.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0);
    let covered = 0;
    let total = 0;
    for (let gy = 0; gy < 60; gy++) {
      for (let gx = 0; gx < 30; gx++) {
        const x = ((gx + 0.5) / 30) * vw;
        const y = ((gy + 0.5) / 60) * vh;
        total++;
        if (plates.some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom)) {
          covered++;
        }
      }
    }
    out.boardPct = total ? Math.round(((total - covered) / total) * 100) : null;
  }
  const name = (el) => {
    const cls = typeof el.className === 'string' && el.className
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    return `${el.tagName.toLowerCase()}${cls}`;
  };
  /**
   * Is this element inside something the player can scroll to reach it?
   *
   * Without this the audit reports every deliberately-scrollable row as broken.
   * The phone HUD dock is one long scrolling strip on purpose — its children
   * extend past the right edge BY DESIGN and a thumb swipe brings them in — and
   * an audit that cannot tell that from a genuinely stranded control would
   * either be ignored or, worse, argue the fix back out again.
   */
  const scrollable = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const st = getComputedStyle(p);
      const ov = st.overflowX;
      const oy = st.overflowY;
      if ((ov === 'auto' || ov === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
      // Vertical too. The loadout is a scrolling document — a briefing table, an
      // army list and a booster list — so a unit row below the fold is exactly
      // as reachable as one below the fold on a web page.
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return true;
      // A PANNABLE PORTHOLE. The world map is deliberately bigger than its box:
      // `.wm-map` clips, `.wm-board` is one transformed layer inside it, and a
      // drag moves the layer. Every region off the right edge is one swipe away,
      // exactly like the scrolling dock — and there is a recentre button for
      // when you get lost. Detected by the signature rather than by class name,
      // so this stays true if the map is rebuilt.
      if (ov === 'hidden' && st.touchAction === 'none') return true;
    }
    return false;
  };
  // Anything painting past the right edge. A 1px tolerance keeps sub-pixel
  // rounding out of the report.
  for (const el of document.querySelectorAll('body *')) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    if ((b.right > vw + 1 || b.left < -1) && !scrollable(el)) {
      // Only report the OUTERMOST offender: a wide container reports every
      // child inside it and the list becomes unreadable.
      if (!out.overflow.some((o) => el.parentElement && o.el === name(el.parentElement))) {
        out.overflow.push({
          el: name(el), left: Math.round(b.left), right: Math.round(b.right),
        });
      }
    }
  }
  // Interactive things: reachable, and big enough to hit.
  const tappable = 'button, [role="button"], input, select, a[href], .chip, .seg, [data-interactive]';
  for (const el of document.querySelectorAll(tappable)) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || el.disabled) continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    const label = `${name(el)}${el.textContent ? ` "${el.textContent.trim().slice(0, 18)}"` : ''}`;
    if (b.width < minTap || b.height < minTap) {
      out.tiny.push({ el: label, w: Math.round(b.width), h: Math.round(b.height) });
    }
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    if ((cx < 0 || cx > vw || cy < 0 || cy > vh) && !scrollable(el)) {
      out.offscreen.push({ el: label, cx: Math.round(cx), cy: Math.round(cy) });
    }
  }
  return out;
}, min);

/** Below this the HUD has eaten the game. Not a style preference: at 40% of a
 *  844px screen the board is a 340px band, which is about four hex rows. */
const MIN_BOARD_PCT = 55;

function report(a, tag) {
  const bad = [];
  if (a.boardPct !== null && a.boardPct < MIN_BOARD_PCT) {
    bad.push(`the board only gets ${a.boardPct}% of the screen `
      + `(want >= ${MIN_BOARD_PCT}%) — the HUD has eaten the game`);
  }
  if (a.scrollW > a.vw + 1) bad.push(`page scrolls sideways (${a.scrollW}px in ${a.vw}px)`);
  if (a.overflow.length) {
    bad.push(`${a.overflow.length} element(s) past the edge: `
      + a.overflow.slice(0, 4).map((o) => `${o.el} [${o.left}..${o.right}]`).join(', '));
  }
  if (a.offscreen.length) {
    bad.push(`${a.offscreen.length} control(s) off-screen: `
      + a.offscreen.slice(0, 4).map((o) => `${o.el} @${o.cx},${o.cy}`).join(', '));
  }
  if (a.tiny.length) {
    bad.push(`${a.tiny.length} tap target(s) under ${MIN_TAP}px: `
      + a.tiny.slice(0, 5).map((o) => `${o.el} ${o.w}x${o.h}`).join(', '));
  }
  problems += bad.length;
  console.log(`\n  ${tag}  [${a.scene}]  ${a.vw}x${a.vh}`
    + (a.boardPct === null ? '' : `  board ${a.boardPct}%`));
  if (!bad.length) console.log('    ok');
  for (const line of bad) console.log(`    !! ${line}`);
}

async function click(sel) {
  const p = await page.eval((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
  }, sel);
  if (!p) return false;
  await page.mouse('mouseMoved', p.x, p.y);
  await page.mouse('mousePressed', p.x, p.y);
  await page.mouse('mouseReleased', p.x, p.y);
  await page.sleep(420);
  return true;
}

async function shot(tag) {
  await page.screenshot(`${OUT}/${tag}-${W}x${H}.png`);
}

try {
  await page.sleep(1800);
  console.log(`\nPhone audit at ${W}x${H} (dsf 3, touch on), min tap ${MIN_TAP}px`);

  report(await audit(MIN_TAP), '1 battle ');
  await shot('1-battle');

  // A fresh save boots straight into region 1, so the way OUT to the rest of
  // the game is Withdraw — which is a two-press confirm, deliberately.
  if (await has('.hud-withdraw')) {
    await click('.hud-withdraw');
    await click('.hud-withdraw');
    await page.sleep(900);
  }
  for (const sel of ['.results-map', '.results-continue', '.menu-continue', '.menu-new']) {
    if (await has(sel)) { await click(sel); }
  }
  if (await scene() === 'worldmap') {
    report(await audit(MIN_TAP), '2 map    ');
    await shot('2-worldmap');
  }

  for (const sel of ['.wm-shop', '[data-nav="shop"]', 'button.wm-upgrades', '.wm-nav .btn']) {
    if (await has(sel)) { await click(sel); break; }
  }
  if (await scene() === 'shop') {
    report(await audit(MIN_TAP), '3 shop   ');
    await shot('3-shop');
    // `.shop-close` IS THE BUTTON, and the four selectors that used to be
    // guessed at here (`.shop-back`, `.btn-back`, `[data-nav="map"]`,
    // `.scene-back`) match nothing in src/ and never did — so the shop never
    // closed, `button.wm-go` was never there, and steps 4, 5 and 6 SILENTLY DID
    // NOT RUN on any invocation of this tool, ever, including the CI job that
    // gates the deploy. The tool reported "no layout problems found" for three
    // screens it had not looked at, which is worse than reporting nothing.
    //
    // Absent is a FAILURE, per this project's own rule about smoke selectors.
    // A navigation step that quietly no-ops takes every assertion downstream of
    // it with it, and the whole point of that rule is that the tool must not be
    // able to lie about coverage again.
    if (!await has('.shop-close')) {
      console.log('\n  !! shop Close (.shop-close) is not on the page — the shop cannot be');
      console.log('     closed, so the loadout, in-battle and site-panel steps below would');
      console.log('     silently not run. Fix the selector rather than the symptom.');
      problems += 1;
    } else {
      await click('.shop-close');
    }
  }

  // Pre-battle loadout — the densest screen in the game, and the one the type
  // cap just added a whole line to.
  if (await has('button.wm-go')) await click('button.wm-go');
  if (await scene() === 'prebattle') {
    report(await audit(MIN_TAP), '4 loadout');
    await shot('4-prebattle');
  }

  // Back into battle for the site panel and the training fan.
  if (await has('.pb-go')) await click('.pb-go');
  await page.sleep(1400);
  if (await scene() === 'battle') {
    report(await audit(MIN_TAP), '5 battle ');
    await shot('5-battle');

    // Open the training fan on a site that can train — the control most likely
    // to have outgrown the screen, since it hangs chips on a radius.
    const at = await page.eval(() => {
      const g = window.__game;
      const b = g.state.battle;
      // Asked of `trainType`, not of the kind. A stronghold trains nothing since
      // the yard/wall split — mapgen gives it no train type at all — so naming
      // kinds here would have had the audit clicking a site with no fan and
      // reporting the layout fine. This is the same class of miss as a smoke
      // selector that names a container: it keeps passing once the thing moves.
      const s = b.sites.find((x) => x.owner === 'player' && x.trainType);
      if (!s) return null;
      // `__view` IS THE BOARD. The two names tried here before (`g.view.board`
      // and `g.board`) are neither of the things screens/battle.js exposes —
      // it sets `__view` for the geometry and `__ui` for the presentation state,
      // and says so in a comment about those two having been confused once
      // already. So this returned null every run and the step below printed
      // "could not locate a trainable site" forever: a second dead lookup
      // hiding behind the dead selector above, which is why fixing one only
      // uncovered the other.
      const p = g.__view?.siteScreen?.(s, { x: 0, y: 0 });
      return p ? { x: Math.round(p.x), y: Math.round(p.y), id: s.id } : null;
    });
    if (at) {
      await page.mouse('mouseMoved', at.x, at.y);
      await page.mouse('mousePressed', at.x, at.y);
      await page.mouse('mouseReleased', at.x, at.y);
      await page.sleep(500);
      report(await audit(MIN_TAP), '6 site   ');
      await shot('6-sitepanel');
    } else {
      console.log('\n  6 site     -- could not locate a trainable site on screen');
    }
  }

  console.log(`\n${problems === 0 ? 'No layout problems found.' : `${problems} problem group(s).`}`);
  console.log(`Screenshots in ${OUT}/\n`);
} finally {
  await page.close?.();
}
