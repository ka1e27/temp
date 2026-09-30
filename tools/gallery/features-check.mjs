// Drives tools/gallery/features.html in real headless Chrome with real CDP mouse events and asserts
// on what the browser actually does (not on function calls): the crown-award timing, Reduce
// Motion, the leader banner's click-through, live region, auto-hide and phone-width fit.
//
//   node tools/dev server running: npm start
//   CHROME_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe" node tools/gallery/features-check.mjs
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('../cdp.js');

const BASE = 'http://localhost:8080/tools/gallery/features.html';
let failures = 0;
const ok = (cond, label) => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`);
};

async function open(query, width, height, dpr = 1) {
  const page = await launch({ url: 'about:blank', width, height });
  page.errors = [];
  page.on((method, params) => {
    if (method === 'Runtime.exceptionThrown') page.errors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text);
    else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') page.errors.push(params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: width < 768 });
  await page.goto(`${BASE}?${query}`);
  await sleep(1500);
  return page;
}

async function clickCentre(page, selectorFn) {
  const r = await page.eval(selectorFn);
  await page.mouse('mouseMoved', r.x, r.y, 'none', 0);
  await page.mouse('mousePressed', r.x, r.y, 'left', 1);
  await page.mouse('mouseReleased', r.x, r.y, 'left', 0);
}

/** Polls the first .crown-row's slot states; returns [{t, earned:[keys]}] once all three landed. */
async function sampleAward(page, ms = 2200) {
  const start = Date.now();
  const log = [];
  let last = '';
  while (Date.now() - start < ms) {
    const snap = await page.eval(() => {
      const row = document.querySelector('#view-crowns .crown-row');
      return [...row.querySelectorAll('.crown-slot')].map((s) => `${s.dataset.key}:${s.dataset.state}${s.classList.contains('is-popping') ? '*' : ''}`).join(' ');
    });
    if (snap !== last) { log.push({ t: Date.now() - start, snap }); last = snap; }
    await sleep(25);
  }
  return log;
}

async function crownChecks() {
  console.log('crowns: animated award, real click on Replay');
  const page = await open('mode=crowns&bare=1', 1280, 800);
  try {
    await sleep(1500); // let the page-load award finish
    const replayAt = () => page.eval(() => {
      const b = [...document.querySelectorAll('#view-crowns button')].find((x) => x.textContent === 'Replay award');
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const t0 = Date.now();
    const at = await replayAt();
    await page.mouse('mouseMoved', at.x, at.y, 'none', 0);
    await page.mouse('mousePressed', at.x, at.y, 'left', 1);
    await page.mouse('mouseReleased', at.x, at.y, 'left', 0);
    const log = await sampleAward(page, 2000);
    const landed = [];
    for (const e of log) {
      const n = (e.snap.match(/:earned/g) || []).length;
      if (n > landed.length) landed.push(e.t);
    }
    console.log('   landed at ms:', landed.join(', '), `(click to first sample ${Date.now() - t0 - 2000}ms ignored)`);
    ok(landed.length === 3, 'all three crowns land one by one');
    if (landed.length === 3) {
      ok(landed[0] >= 350, `first crown waits for the card pop (${landed[0]} ms)`);
      ok(Math.abs(landed[1] - landed[0] - 350) <= 90, `crown 2 ~350 ms after crown 1 (${landed[1] - landed[0]} ms)`);
      ok(Math.abs(landed[2] - landed[1] - 350) <= 90, `crown 3 ~350 ms after crown 2 (${landed[2] - landed[1]} ms)`);
    }
    ok(log.some((e) => e.snap.includes('*')), 'a landing crown gets the pop class');
    await sleep(900);
    const settled = await page.eval(() => !document.querySelector('#view-crowns .crown-row .is-popping'));
    ok(settled, 'the pop class is cleared after the animation');

    console.log('crowns: Reduce Motion (html.reduce-motion)');
    await page.eval(() => document.documentElement.classList.add('reduce-motion'));
    const at2 = await replayAt();
    await page.mouse('mouseMoved', at2.x, at2.y, 'none', 0);
    await page.mouse('mousePressed', at2.x, at2.y, 'left', 1);
    await page.mouse('mouseReleased', at2.x, at2.y, 'left', 0);
    await sleep(120);
    const rm = await page.eval(() => {
      const slots = [...document.querySelectorAll('#view-crowns .crown-row')[0].querySelectorAll('.crown-slot')];
      const glyph = slots[0].querySelector('.crown-glyph');
      return {
        earned: slots.filter((s) => s.dataset.state === 'earned').length,
        pop: slots.some((s) => s.classList.contains('is-popping')),
        animation: getComputedStyle(glyph).animationName,
        ringDisplay: getComputedStyle(slots[0].querySelector('.crown-ring')).display,
      };
    });
    ok(rm.earned === 3, 'all crowns fill immediately under Reduce Motion');
    ok(!rm.pop || rm.animation === 'crown-fade' || rm.animation === 'none', `no pop animation (glyph animation: ${rm.animation})`);
    ok(rm.ringDisplay === 'none', 'ring and sparks are removed');
    ok(page.errors.length === 0, `no page errors ${page.errors.join(' | ')}`);
  } finally { await page.close(); }
}

async function phoneChecks() {
  console.log('phone width (390 px): nothing overflows');
  for (const mode of ['crowns', 'leaders', 'compose']) {
    const page = await open(`mode=${mode}&bare=1`, 390, 844, 2);
    try {
      const r = await page.eval(() => {
        const rows = [...document.querySelectorAll('.crown-row')].filter((n) => n.offsetParent);
        const banners = [...document.querySelectorAll('.leader-card')].filter((n) => n.offsetParent);
        const over = (n) => { const b = n.getBoundingClientRect(); return b.left < -0.5 || b.right > window.innerWidth + 0.5; };
        return {
          scrollW: document.documentElement.scrollWidth,
          rowsOverflow: rows.filter((n) => n.scrollWidth > n.clientWidth + 1 || over(n)).length,
          rows: rows.length,
          bannersOverflow: banners.filter(over).length,
          banners: banners.length,
        };
      });
      const tableScroll = mode === 'leaders'; // the writing table scrolls inside its own panel
      ok(tableScroll || r.scrollW <= 390, `${mode}: page is not wider than the viewport (${r.scrollW})`);
      ok(r.rowsOverflow === 0, `${mode}: ${r.rows} crown rows fit`);
      ok(r.bannersOverflow === 0, `${mode}: ${r.banners} banners fit`);
      ok(page.errors.length === 0, `${mode}: no page errors ${page.errors.join(' | ')}`);
    } finally { await page.close(); }
  }
}

async function bannerChecks() {
  console.log('leader banner: click-through, live region, auto-hide, Reduce Motion');
  const page = await open('mode=leaders&bare=1&f=violet&t=keepAssaulted', 1280, 800);
  try {
    const r = await page.eval(async () => {
      const { createLeaderBanner } = await import('/game/ui/leaderBanner.js');
      // a click target underneath the banner, to prove clicks reach it
      const under = document.createElement('button');
      under.id = 'under';
      Object.assign(under.style, { position: 'fixed', left: '300px', top: '300px', width: '400px', height: '160px', zIndex: 5 });
      document.body.appendChild(under);
      window.__clicks = 0;
      under.addEventListener('click', () => { window.__clicks++; });
      const ui = document.createElement('div');
      ui.id = 'ui-test';
      Object.assign(ui.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 20 });
      document.body.appendChild(ui);
      const b = createLeaderBanner();
      ui.appendChild(b.el);
      b.el.style.setProperty('--leader-banner-top', '300px');
      b.update({ faction: { name: 'Crimson Legion', color: '#d8433f', colorDark: '#8f1f1c', colorLight: '#ff9c93', emblem: 'sword' }, name: 'Korash', title: 'Warlord', line: 'Enjoy Ashport. You will be handing it back in pieces.' });
      window.__banner = b;
      await new Promise((res) => setTimeout(res, 500));
      const card = b.el.querySelector('.leader-card');
      const cr = card.getBoundingClientRect();
      const cs = getComputedStyle(b.el);
      const hit = document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2);
      return {
        state: b.el.dataset.state,
        showing: b.isShowing(),
        pe: cs.pointerEvents,
        role: b.el.getAttribute('role'),
        live: b.el.getAttribute('aria-live'),
        atomic: b.el.getAttribute('aria-atomic'),
        cardHidden: card.getAttribute('aria-hidden'),
        sr: b.el.querySelector('.visually-hidden').textContent,
        hitId: hit && hit.id,
        hitInside: !!(hit && hit.closest('.leader-banner')),
        centre: { x: cr.left + cr.width / 2, y: cr.top + cr.height / 2 },
        opacity: getComputedStyle(card).opacity,
      };
    });
    ok(r.state === 'in' && r.showing, 'banner is showing after update()');
    ok(r.pe === 'none', 'root has pointer-events: none');
    ok(r.role === 'status' && r.live === 'polite' && r.atomic === 'true', 'aria-live="polite" role=status aria-atomic');
    ok(r.cardHidden === 'true' && r.sr.includes('Warlord Korash') && r.sr.includes('Enjoy Ashport'), `screen readers get the line once (${r.sr})`);
    ok(!r.hitInside && r.hitId === 'under', `elementFromPoint at the banner centre lands on the element beneath (${r.hitId})`);
    ok(Number(r.opacity) > 0.9, 'card is fully visible');
    await page.mouse('mouseMoved', r.centre.x, r.centre.y, 'none', 0);
    await page.mouse('mousePressed', r.centre.x, r.centre.y, 'left', 1);
    await page.mouse('mouseReleased', r.centre.x, r.centre.y, 'left', 0);
    const clicks = await page.eval(() => window.__clicks);
    ok(clicks === 1, `a real mouse click through the banner reaches what is under it (${clicks})`);

    // auto-hide ~4 s
    await sleep(3400);
    const stillIn = await page.eval(() => window.__banner.isShowing());
    await sleep(1100);
    const gone = await page.eval(() => ({ showing: window.__banner.isShowing(), state: window.__banner.el.dataset.state, vis: getComputedStyle(window.__banner.el.querySelector('.leader-card')).visibility }));
    ok(stillIn, 'still up at ~3.9 s');
    ok(!gone.showing && gone.state === 'idle' && gone.vis === 'hidden', `hidden by ~5 s (${JSON.stringify(gone)})`);

    // second line swaps in place and restarts the timer; sticky mode never hides
    const sticky = await page.eval(async () => {
      const b = window.__banner;
      const f = { name: 'Violet Covenant', color: '#9b5de5', colorDark: '#5b2c99', colorLight: '#d3b5ff', emblem: 'eye' };
      b.update({ faction: f, name: 'Selavane', title: 'High Seer', line: 'The walls are singing the low note.', durationMs: 0 });
      await new Promise((res) => setTimeout(res, 4800));
      const still = b.isShowing();
      b.hide();
      await new Promise((res) => setTimeout(res, 500));
      return { still, after: b.isShowing() };
    });
    ok(sticky.still && !sticky.after, 'durationMs: 0 stays until hide()');

    // Reduce Motion: fade only
    const rm = await page.eval(async () => {
      document.documentElement.classList.add('reduce-motion');
      const b = window.__banner;
      b.update({ faction: { color: '#f29e38', emblem: 'sun' }, name: 'Gashrok', title: 'Khan', line: 'Hey! Get off the porch! We just swept!', durationMs: 0 });
      await new Promise((res) => setTimeout(res, 400));
      const card = b.el.querySelector('.leader-card');
      const cs = getComputedStyle(card);
      const out = { transform: cs.transform, props: cs.transitionProperty, timer: getComputedStyle(b.el.querySelector('.leader-timer')).display };
      b.hide();
      document.documentElement.classList.remove('reduce-motion');
      return out;
    });
    ok(rm.transform === 'none' && !rm.props.includes('transform'), `Reduce Motion: fade only (transform ${rm.transform}, transitions ${rm.props})`);
    ok(page.errors.length === 0, `no page errors ${page.errors.join(' | ')}`);
  } finally { await page.close(); }
}

async function liveGalleryChecks() {
  console.log('leader gallery: every faction x trigger renders without errors or overflow');
  const page = await open('mode=leaders&bare=1', 1280, 800);
  try {
    const r = await page.eval(async () => {
      const { LEADER_TRIGGERS } = await import('/game/config/leaders.js');
      const buttons = [...document.querySelectorAll('#view-leaders .g-tools button')].filter((b) => LEADER_TRIGGERS.includes(b.textContent));
      const bad = [];
      for (const b of buttons) {
        b.click();
        await new Promise((res) => setTimeout(res, 60));
        for (const card of document.querySelectorAll('.g-static .leader-card')) {
          const text = card.querySelector('.leader-line');
          const lines = Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight));
          if (lines > 2 || card.scrollWidth > card.clientWidth + 1 || !text.textContent.trim()) bad.push(`${b.textContent}: ${text.textContent} (${lines} lines)`);
        }
      }
      return { triggers: buttons.length, bad };
    });
    ok(r.triggers === 11, `11 trigger buttons (${r.triggers})`);
    ok(r.bad.length === 0, `all lines fit in at most two lines at 1280 px ${r.bad.join(' | ')}`);
    ok(page.errors.length === 0, `no page errors ${page.errors.join(' | ')}`);
  } finally { await page.close(); }
}

try {
  await crownChecks();
  await bannerChecks();
  await liveGalleryChecks();
  await phoneChecks();
} catch (e) {
  failures++;
  console.log('  FAIL threw', e && e.stack ? e.stack : e);
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
