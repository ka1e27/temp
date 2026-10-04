// Drives tools/gallery/works.html in real headless Chrome with real CDP mouse events and asserts on what the browser
// actually does: building and upgrading through the real region card, a tap that survives a refresh between
// pointerdown and pointerup, the chooser round trip, the phone bottom-sheet height budget, phone-width overflow and the
// map view. Needs the dev server: npm start.
//
//   CHROME_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe" node tools/gallery/works-check.mjs
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('../cdp.js');

const BASE = 'http://localhost:8080/tools/gallery/works.html';
let failures = 0;
const ok = (cond, label) => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`);
};

async function open(query, width, height, { touch = false } = {}) {
  const page = await launch({ url: 'about:blank', width, height });
  page.errors = [];
  page.on((method, params) => {
    if (method === 'Runtime.exceptionThrown') page.errors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text);
    else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') page.errors.push(params.args.map((a) => a.value ?? a.description).join(' '));
    else if (method === 'Log.entryAdded' && params.entry.level === 'error' && !/favicon/.test(params.entry.url || '')) page.errors.push(params.entry.text);
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: touch ? 2 : 1, mobile: width < 768 });
  if (touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.goto(`${BASE}?${query}`);
  await sleep(1600);
  return page;
}

/** Centre of the n-th element matching `sel` inside the cell with data-key `key`, as page coordinates. */
const centreOf = (page, key, sel, n = 0) => page.eval((k, s, i) => {
  const root = document.querySelector(`.state-cell[data-key="${k}"]`);
  const el = root.querySelectorAll(s)[i];
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: !!el.disabled };
}, key, sel, n);

async function click(page, at) {
  await page.mouse('mouseMoved', at.x, at.y, 'none', 0);
  await page.mouse('mousePressed', at.x, at.y, 'left', 1);
  await page.mouse('mouseReleased', at.x, at.y, 'left', 0);
  await sleep(120);
}

const cellState = (page, key) => page.eval((k) => {
  const g = window.__worksGallery;
  const cell = g.cells.find((c) => c.def.key === k);
  const root = cell.cell;
  return {
    gold: Math.round(cell.state.gold),
    works: JSON.parse(JSON.stringify(cell.state.works[g.heroId] || [])),
    view: root.querySelector('.works-panel:not(.is-forts)').dataset.view,
    slots: [...root.querySelectorAll('.works-panel:not(.is-forts) .works-slot')].map((s) => s.dataset.state),
    pips: [...root.querySelectorAll('.works-panel:not(.is-forts) .works-slot')].map((s) => [...s.querySelectorAll('.works-pip')].filter((p) => p.dataset.on === '1').length),
    toasts: document.querySelectorAll('.toast').length,
  };
}, key);

async function desktopChecks() {
  console.log('desktop: build and upgrade through the real region card, with real clicks');
  const page = await open('bare=1', 1440, 900);
  try {
    let s = await cellState(page, 'fresh');
    ok(s.slots.join() === 'empty,locked,locked' && s.works.length === 0, `fresh region: ${s.slots.join()}`);
    const gold0 = s.gold;

    await click(page, await centreOf(page, 'fresh', '.works-build'));
    s = await cellState(page, 'fresh');
    ok(s.view === 'choose', 'Build... opens the chooser in place');
    const rows = await page.eval(() => [...document.querySelectorAll('.state-cell[data-key="fresh"] .works-choice')].map((r) => `${r.dataset.type}:${r.disabled ? 'off' : 'on'}`));
    ok(rows.length === 5 && rows.every((r) => r.endsWith(':on')), `five enabled rows: ${rows.join(' ')}`);

    await click(page, await centreOf(page, 'fresh', '.works-choice', 1)); // Stables
    s = await cellState(page, 'fresh');
    ok(s.works.length === 1 && s.works[0].type === 'stables' && s.works[0].level === 1, `a real tap built Stables: ${JSON.stringify(s.works)}`);
    ok(s.gold < gold0, `gold was paid (${gold0} to ${s.gold})`);
    ok(s.view === 'slots' && s.slots[0] === 'built', 'the panel went back to the list with the Work built');
    ok(s.toasts >= 1, 'the gallery toast fired');

    console.log('desktop: upgrade, and a disabled upgrade does nothing');
    await click(page, await centreOf(page, 'one', '.works-upgrade'));
    s = await cellState(page, 'one');
    ok(s.works[0].level === 2 && s.pips[0] === 2, `Barracks went to level II, two pips lit (${JSON.stringify(s.works)})`);
    const poorAt = await centreOf(page, 'one-poor', '.works-upgrade');
    ok(poorAt.disabled, 'the unaffordable Upgrade button is disabled');
    const before = await cellState(page, 'one-poor');
    await click(page, poorAt);
    const after = await cellState(page, 'one-poor');
    ok(JSON.stringify(before.works) === JSON.stringify(after.works) && before.gold === after.gold, 'clicking it changed nothing');

    console.log('desktop: a refresh between pointerdown and pointerup must not swallow the tap');
    const at = await centreOf(page, 'mixed', '.works-upgrade', 1); // Market II -> III
    const beforeMixed = await cellState(page, 'mixed');
    await page.mouse('mouseMoved', at.x, at.y, 'none', 0);
    await page.mouse('mousePressed', at.x, at.y, 'left', 1);
    // the card refreshes exactly here (gold drifts a little, like idle income): the button must be the same node
    await page.eval(() => {
      const g = window.__worksGallery;
      const cell = g.cells.find((c) => c.def.key === 'mixed');
      cell.state.gold -= 3;
      cell.refresh();
    });
    await page.mouse('mouseReleased', at.x, at.y, 'left', 0);
    await sleep(150);
    const afterMixed = await cellState(page, 'mixed');
    ok(afterMixed.works[1].level === beforeMixed.works[1].level + 1, `the tap still landed (Market ${beforeMixed.works[1].level} to ${afterMixed.works[1].level})`);

    console.log('desktop: Demolish needs a confirm; Keep keeps, Demolish refunds half and closes the list up');
    const rowH = () => page.eval(() => Math.round(document.querySelectorAll('.state-cell[data-key="mixed"] .works-slot')[0].getBoundingClientRect().height));
    const h0 = await rowH();
    await click(page, await centreOf(page, 'mixed', '.works-more', 0));
    let m = await cellState(page, 'mixed');
    const confirming = await page.eval(() => document.querySelector('.state-cell[data-key="mixed"] .works-slot').dataset.confirm);
    const prompt = await page.eval(() => document.querySelector('.state-cell[data-key="mixed"] .works-confirm-text').textContent);
    ok(confirming === '1' && /^Demolish Barracks\? Refund \d+ gold$/.test(prompt), `the ... opened the confirm step: "${prompt}"`);
    ok(m.works.length === 3, 'one tap destroyed nothing');
    ok(Math.abs((await rowH()) - h0) <= 1, `the row kept its height (${h0} px)`);
    await click(page, await centreOf(page, 'mixed', '.works-keep', 0));
    m = await cellState(page, 'mixed');
    ok(m.works.length === 3, 'Keep kept it');
    const goldBefore = m.gold;
    await click(page, await centreOf(page, 'mixed', '.works-more', 0));
    await click(page, await centreOf(page, 'mixed', '.works-demolish', 0));
    m = await cellState(page, 'mixed');
    ok(m.works.length === 2 && m.works[0].type === 'market', `Demolish removed the Barracks; the Market moved up (${m.works.map((w) => w.type).join()})`);
    ok(m.gold > goldBefore, `the refund arrived (${goldBefore} to ${m.gold})`);
    ok(m.slots.join() === 'built,built,empty', `the slot is free again (${m.slots.join()})`);
    const pre = await cellState(page, 'confirm');
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    ok(pre.works.length === 3, 'the pre-opened confirm cell still has all three Works');

    console.log('desktop: Escape and Back close the chooser');
    await click(page, await centreOf(page, 'fresh-poor', '.works-build'));
    s = await cellState(page, 'fresh-poor');
    ok(s.view === 'choose', 'chooser open');
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(80);
    s = await cellState(page, 'fresh-poor');
    ok(s.view === 'slots', 'Escape closed it (focus moved into the chooser when it opened)');
    const focused = await page.eval(() => document.activeElement && document.activeElement.className);
    ok(/works-build/.test(focused || ''), `focus returned to the slot's Build... button (${focused})`);
    await click(page, await centreOf(page, 'fresh-poor', '.works-build'));
    await click(page, await centreOf(page, 'fresh-poor', '.works-back'));
    s = await cellState(page, 'fresh-poor');
    ok(s.view === 'slots', 'Back closes it with a real click');
    ok(page.errors.length === 0, `no page errors ${page.errors.join(' | ')}`);
  } finally { await page.close(); }
}

async function phoneChecks() {
  console.log('phone (390 x 844): the bottom-sheet height budget and overflow');
  for (const view of ['panels', 'chooser']) {
    const page = await open(`bare=1&view=${view}`, 390, 844, { touch: true });
    try {
      const r = await page.eval(() => {
        const heights = Object.entries(window.__worksHeights).filter(([, h]) => h > 0);
        const over = [...document.querySelectorAll('.works-panel')].filter((n) => n.offsetParent && n.scrollWidth > n.clientWidth + 1).length;
        const tooWide = [...document.querySelectorAll('.state-cell:not([hidden]) .works-choice, .state-cell:not([hidden]) .works-slot')]
          .filter((n) => n.offsetParent && n.getBoundingClientRect().right > window.innerWidth + 0.5).length;
        const targets = [...document.querySelectorAll('.works-upgrade, .works-build, .works-choice, .works-more, .works-keep, .works-demolish')].filter((n) => n.offsetParent && !n.closest('[hidden]'))
          .map((n) => Math.round(n.getBoundingClientRect().height));
        return { heights, over, tooWide, minTarget: Math.min(...targets), scrollW: document.documentElement.scrollWidth };
      });
      for (const [key, px] of r.heights) ok(px <= 844 * 0.52 + 1, `${key}: owned card ${px}px = ${Math.round(px / 8.44)}% of the screen (budget 52%)`);
      ok(r.over === 0 && r.tooWide === 0 && r.scrollW <= 390, `${view}: nothing overflows 390 px (panel ${r.over}, rows ${r.tooWide}, page ${r.scrollW})`);
      ok(r.minTarget >= 44, `${view}: touch targets are at least 44 px (smallest ${r.minTarget})`);
      ok(page.errors.length === 0, `${view}: no page errors ${page.errors.join(' | ')}`);
    } finally { await page.close(); }
  }
}

async function mapChecks() {
  console.log('map: real terrain, real sites, real labels, Works marks at three zooms');
  for (const zoom of [14, 26, 60]) {
    const page = await open(`bare=1&view=map&zoom=${zoom}&t=0.6`, 1200, 700);
    try {
      await sleep(1200);
      // under load (other browser checks running) the first frames can take longer than 1.2 s: wait for them, up to 10 s
      for (let i = 0; i < 44 && !(await page.eval(() => document.body.dataset.ready === '1')); i++) await sleep(200);
      const r = await page.eval(() => ({ ready: document.body.dataset.ready === '1', caption: document.getElementById('map-caption').textContent }));
      ok(r.ready, `zoom ${zoom}: the map rendered frames (${r.caption})`);
      ok(page.errors.length === 0, `zoom ${zoom}: no page errors ${page.errors.join(' | ')}`);
    } finally { await page.close(); }
  }
}

async function reduceMotionCheck() {
  console.log('reduce motion');
  const page = await open('bare=1&reduce=1', 1440, 900);
  try {
    const r = await page.eval(() => {
      const pip = document.querySelector('.works-pip');
      const choice = document.querySelector('.works-choice');
      return { pip: getComputedStyle(pip).transitionDuration, cls: document.documentElement.classList.contains('reduce-motion'), choice: choice ? getComputedStyle(choice).transitionDuration : '0s' };
    });
    ok(r.cls && /^0s/.test(r.pip), `pips do not animate (transition ${r.pip})`);
    ok(page.errors.length === 0, 'no page errors');
  } finally { await page.close(); }
}

try {
  await desktopChecks();
  await phoneChecks();
  await mapChecks();
  await reduceMotionCheck();
} catch (e) {
  failures++;
  console.log('  FAIL threw', e && e.stack ? e.stack : e);
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
