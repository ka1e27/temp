// Drives tools/gallery/keepsakes.html in real headless Chrome with real CDP mouse events and asserts on what the browser
// actually does: the Chronicle toggle with real clicks (and a tap that survives a refresh between pointerdown and
// pointerup), the list scrolling on a desktop, the phone fit (no sideways scroll, touch-sized toggle, the list flowing with
// the panel), the Tapestry actually drawn (not blank, the realm colour woven in) and "Save PNG" really producing a PNG
// file of the right size and name. Needs the dev server: npm start.
//
//   CHROME_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe" node tools/gallery/keepsakes-check.mjs
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('../cdp.js');

const BASE = 'http://localhost:8080/tools/gallery/keepsakes.html';
let failures = 0;
const ok = (cond, label) => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`);
};

async function open(query, width, height, { touch = false, wait = 2200 } = {}) {
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
  await sleep(wait);
  return page;
}

/** Centre of the n-th element matching `sel` inside the cell with data-key `key`, as page coordinates. */
const centreOf = (page, key, sel, n = 0) => page.eval((k, s, i) => {
  const root = document.querySelector(`.state-cell[data-key="${k}"]`);
  const el = root.querySelectorAll(s)[i];
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}, key, sel, n);

async function click(page, at) {
  await page.mouse('mouseMoved', at.x, at.y, 'none', 0);
  await page.mouse('mousePressed', at.x, at.y, 'left', 1);
  await page.mouse('mouseReleased', at.x, at.y, 'left', 0);
  await sleep(120);
}

const panelState = (page, key) => page.eval((k) => {
  const root = document.querySelector(`.state-cell[data-key="${k}"]`);
  const chron = root.querySelector('.chron');
  const list = chron.querySelector('.chron-list');
  const btns = [...chron.querySelectorAll('.chron-seg-btn')];
  return {
    mode: chron.dataset.mode,
    rows: chron.querySelectorAll('.chron-row').length,
    chapters: chron.querySelectorAll('.chron-chapter').length,
    on: btns.map((b) => b.dataset.on),
    selected: btns.map((b) => b.getAttribute('aria-pressed')),
    counts: [...chron.querySelectorAll('.chron-seg-count')].map((c) => c.textContent),
    emptyShown: !chron.querySelector('.chron-empty').hidden,
    listHidden: list.hidden,
    scroll: { top: list.scrollTop, scrollH: list.scrollHeight, clientH: list.clientHeight },
  };
}, key);

async function desktopChecks() {
  console.log('desktop: the real Realm panel with the Chronicle, real clicks');
  const page = await open('bare=1', 1440, 900);
  try {
    let s = await panelState(page, 'empty');
    ok(s.rows === 0 && s.emptyShown && s.listHidden, 'empty: the empty line shows, no rows');
    ok(s.counts.join() === '0,0', `empty counts ${s.counts.join()}`);
    const emptyText = await page.eval(() => document.querySelector('.state-cell[data-key="empty"] .chron-empty').textContent);
    ok(emptyText.length > 10, `empty line: "${emptyText}"`);

    s = await panelState(page, 'few');
    ok(s.rows === 5 && s.mode === 'dynasty' && s.on.join() === '1,0', `few: ${s.rows} rows, mode ${s.mode}`);
    const highlights = await page.eval(() => [...document.querySelectorAll('.state-cell[data-key="few"] .chron-row')].map((r) => r.dataset.highlight).join(''));
    ok(highlights.includes('1') && highlights.includes('0'), `few: highlights and plain rows both present (${highlights})`);

    // toggle with real clicks
    await click(page, await centreOf(page, 'few', '.chron-seg-btn', 1));
    s = await panelState(page, 'few');
    ok(s.mode === 'all' && s.on.join() === '0,1' && s.selected.join() === 'false,true', `All time: mode ${s.mode}, on ${s.on.join()}`);
    ok(s.rows === Number(s.counts[1]), `All time shows ${s.rows} rows = its count ${s.counts[1]}`);
    ok(s.chapters >= 1, 'rows sit under a dynasty divider');
    await click(page, await centreOf(page, 'few', '.chron-seg-btn', 0));
    s = await panelState(page, 'few');
    ok(s.mode === 'dynasty' && s.rows === 5, 'This dynasty again');

    // a tap that survives a refresh between pointerdown and pointerup (the buttons are never rebuilt)
    const at = await centreOf(page, 'few', '.chron-seg-btn', 1);
    await page.mouse('mouseMoved', at.x, at.y, 'none', 0);
    await page.mouse('mousePressed', at.x, at.y, 'left', 1);
    await page.eval(() => { const k = window.__keepsakes.few; k.panel.update(k.data()); k.panel.update(k.data()); });
    await page.mouse('mouseReleased', at.x, at.y, 'left', 0);
    await sleep(120);
    s = await panelState(page, 'few');
    ok(s.mode === 'all', 'a tap with a refresh in between still registers');
    await click(page, await centreOf(page, 'few', '.chron-seg-btn', 0));

    // the full chapter scrolls on its own, the list height is bounded
    s = await panelState(page, 'full');
    ok(s.rows === 40, `full: 40 rows (the cap), got ${s.rows}`);
    ok(s.scroll.scrollH > s.scroll.clientH + 100 && s.scroll.clientH <= 290, `full: the list scrolls inside a bounded box (${s.scroll.clientH}px of ${s.scroll.scrollH}px)`);
    const lat = await centreOf(page, 'full', '.chron-list');
    await page.mouse('mouseMoved', lat.x, lat.y, 'none', 0);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: lat.x, y: lat.y, deltaX: 0, deltaY: 400 });
    await sleep(250);
    s = await panelState(page, 'full');
    ok(s.scroll.top > 50, `a real wheel scrolls the list (scrollTop ${s.scroll.top})`);
    await click(page, await centreOf(page, 'full', '.chron-seg-btn', 1));
    s = await panelState(page, 'full');
    ok(s.scroll.top === 0 && s.mode === 'all', 'switching lists starts at the top');

    // the all-time cell
    s = await panelState(page, 'all');
    ok(s.mode === 'all' && s.chapters === 3, `all-time: three dynasty dividers (${s.chapters})`);

    const dims = await page.eval(() => ({ w: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    ok(dims.w <= dims.cw + 1, `no sideways scroll (${dims.w} / ${dims.cw})`);
    ok(page.errors.length === 0, `no page errors ${page.errors.join(' | ')}`);
  } finally { await page.close(); }
}

/** Replaces anchor clicks with a recorder (no file is written to disk) and decodes each blob it is handed. */
const installDownloadSpy = (page) => page.eval(() => {
  window.__downloads = [];
  HTMLAnchorElement.prototype.click = function spy() {
    const d = { name: this.download, href: this.href };
    window.__downloads.push(d);
    d.done = fetch(this.href).then((r) => r.blob()).then(async (blob) => {
      const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
      const bmp = await createImageBitmap(blob);
      d.info = { type: blob.type, size: blob.size, magic: [...head].join(','), w: bmp.width, h: bmp.height };
    });
  };
});

const PNG_MAGIC = '137,80,78,71,13,10,26,10';
const waitSaved = (page) => page.eval(() => new Promise((resolve) => {
  const t = setInterval(() => { if (window.__saved) { clearInterval(t); resolve(true); } }, 50);
  setTimeout(() => { clearInterval(t); resolve(false); }, 20000);
}));
const downloadInfo = (page) => page.eval(async () => {
  const d = window.__downloads[0];
  if (!d) return null;
  await d.done;
  return { name: d.name, count: window.__downloads.length, info: d.info, saved: window.__saved, words: window.__savedWords };
});

async function saveButtonChecks() {
  console.log('save the map: the button in the Realm panel and in the Found a Dynasty confirmation, real taps');
  let page = await open('bare=1&only=few', 1440, 900);
  try {
    await installDownloadSpy(page);
    const at = await centreOf(page, 'few', '.keepsake-save');
    const label = await page.eval(() => document.querySelector('.state-cell[data-key="few"] .keepsake-save').textContent);
    ok(label === 'Save the map', 'the Realm panel has the button: "' + label + '"');
    await click(page, at);
    const busy = await page.eval(() => {
      const b = document.querySelector('.state-cell[data-key="few"] .keepsake-save');
      return { label: b.textContent, disabled: b.disabled, aria: b.getAttribute('aria-busy') };
    });
    ok(busy.disabled && busy.aria === 'true' && /Saving/.test(busy.label), 'busy while it renders: "' + busy.label + '"');
    ok(await waitSaved(page), 'the save finished');
    const r = await downloadInfo(page);
    ok(!!r && r.count === 1 && r.saved.ok, 'one download, reported ok');
    if (r) {
      ok(/^hex-dominion-dynasty-[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}[.]png$/.test(r.name), 'file ' + r.name);
      ok(r.info.magic === PNG_MAGIC && r.info.w > 1500, 'a PNG ' + r.info.w + 'x' + r.info.h + ', ' + Math.round(r.info.size / 1024) + ' KB');
      ok(/^Map saved: /.test(r.words), 'toast words: "' + r.words + '"');
    }
    const after = await page.eval(() => {
      const b = document.querySelector('.state-cell[data-key="few"] .keepsake-save');
      return { label: b.textContent, disabled: b.disabled };
    });
    ok(!after.disabled && after.label === 'Save the map', 'the button is back to normal');
    ok(page.errors.length === 0, 'no page errors ' + page.errors.join(' | '));
  } finally { await page.close(); }

  for (const [name, w, h, touch] of [['desktop', 1440, 900, false], ['phone', 390, 844, true]]) {
    page = await open('bare=1&only=-&modal=1', w, h, { touch });
    try {
      await installDownloadSpy(page);
      const m = await page.eval(() => {
        const panel = document.querySelector('.modal-panel');
        const btn = document.querySelector('.modal-panel .keepsake-save');
        const pr = panel.getBoundingClientRect();
        const br = btn.getBoundingClientRect();
        return {
          open: !!panel, role: panel.getAttribute('role'), fits: pr.left >= 0 && pr.right <= innerWidth && pr.top >= 0 && pr.bottom <= innerHeight,
          btnInside: br.left >= pr.left && br.right <= pr.right, btnH: br.height, note: (document.querySelector('.keepsake-save-note') || {}).textContent,
          actions: [...document.querySelectorAll('.modal-actions .btn')].map((b) => b.textContent),
          sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        };
      });
      ok(m.open && m.role === 'dialog', name + ': the Found a Dynasty confirmation is open');
      ok(m.fits && m.btnInside, name + ': the dialog fits the screen and the button sits inside it');
      ok(m.sw <= m.cw + 1, name + ': no sideways scroll');
      ok(m.actions.join() === 'Not yet,Found it', name + ': the confirmation keeps its two choices (' + m.actions.join(' / ') + ')');
      ok(m.btnH >= 40, name + ': the button is ' + Math.round(m.btnH) + ' px high');
      ok(/before it resets/.test(m.note || ''), name + ': hint "' + m.note + '"');
      const at = await page.eval(() => { const r = document.querySelector('.modal-panel .keepsake-save').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await click(page, at);
      ok(await waitSaved(page), name + ': the save from the confirmation finished');
      const r = await downloadInfo(page);
      ok(!!r && r.info.magic === PNG_MAGIC, name + ': a PNG came out' + (r ? ' (' + r.info.w + 'x' + r.info.h + ', ' + Math.round(r.info.size / 1024) + ' KB)' : ''));
      const still = await page.eval(() => !!document.querySelector('.modal-panel'));
      ok(still, name + ': saving does not close the confirmation');
      const notYet = await page.eval(() => [...document.querySelectorAll('.modal-actions .btn')][0].getBoundingClientRect().toJSON());
      await click(page, { x: notYet.x + notYet.width / 2, y: notYet.y + notYet.height / 2 });
      ok(!(await page.eval(() => !!document.querySelector('.modal-panel'))), name + ': "Not yet" closes it');
      ok(page.errors.length === 0, name + ': no page errors ' + page.errors.join(' | '));
    } finally { await page.close(); }
  }
}

async function keyboardChecks() {
  console.log('keyboard: the Realm panel is a modal dialog now (focus trap, inert page); the Chronicle works inside it');
  const page = await open('bare=1&only=full&dialog=1', 1440, 900);
  const press = async (name, code, vk, text) => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: vk });
    await sleep(70);
  };
  const focused = () => page.eval(() => {
    const a = document.activeElement;
    return { cls: a ? String(a.className) : '', inRealm: !!(a && a.closest && a.closest('.realm')), tag: a ? a.tagName : '', text: a ? (a.textContent || '').slice(0, 16) : '' };
  });
  try {
    const d = await page.eval(() => ({ dialog: document.documentElement.hasAttribute('data-dialog'), role: document.querySelector('.realm').getAttribute('role') }));
    ok(d.dialog && d.role === 'dialog', 'the Realm panel opened as a dialog');
    const visited = [];
    for (let i = 0; i < 8; i++) {
      await press('Tab', 'Tab', 9);
      const f = await focused();
      visited.push(f.cls.split(' ')[0] || f.tag);
      ok(f.inRealm, `Tab ${i + 1}: focus stays inside the dialog (${f.cls.split(' ')[0] || f.tag})`);
      if (f.cls.includes('chron-seg-btn') && /All time/.test(f.text)) break;
    }
    ok(visited.includes('chron-seg-btn'), `Tab reaches the toggle (${visited.join(' > ')})`);
    await press('Enter', 'Enter', 13, String.fromCharCode(13));
    let st = await panelState(page, 'full');
    ok(st.mode === 'all', `Enter on "All time" switches the list (mode ${st.mode})`);
    ok(st.selected.join() === 'false,true', `aria-pressed follows (${st.selected.join()})`);
    await press('Tab', 'Tab', 9);
    const f2 = await focused();
    ok(f2.cls.includes('chron-list'), `Tab reaches the list itself so a keyboard can scroll it (${f2.cls.split(' ')[0]})`);
    // back to the dynasty list (many rows) and scroll with the arrow keys
    await page.eval(() => window.__keepsakes.full.panel.setMode('dynasty'));
    await page.eval(() => document.querySelector('.chron-list').focus());
    for (let i = 0; i < 6; i++) await press('ArrowDown', 'ArrowDown', 40);
    st = await panelState(page, 'full');
    ok(st.scroll.top > 40, `arrow keys scroll the focused list (scrollTop ${st.scroll.top})`);
    await press('Escape', 'Escape', 27);
    ok(page.errors.length === 0, `no page errors ${page.errors.join(' | ')}`);
  } finally { await page.close(); }
}

async function phoneChecks() {
  console.log('phone 390 x 844, touch');
  const page = await open('bare=1', 390, 844, { touch: true });
  try {
    const m = await page.eval(() => ({
      coarse: matchMedia('(pointer: coarse)').matches,
      w: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      phone: document.body.classList.contains('phone'),
    }));
    ok(m.phone, 'phone layout');
    ok(m.w <= m.cw + 1, `no sideways scroll (${m.w} / ${m.cw})`);
    for (const key of ['empty', 'few', 'full', 'all']) {
      const r = await page.eval((k) => {
        const root = document.querySelector(`.state-cell[data-key="${k}"]`);
        const frame = root.querySelector('.realm-frame').getBoundingClientRect();
        const list = root.querySelector('.chron-list');
        const cs = getComputedStyle(list);
        const rows = [...root.querySelectorAll('.chron-row')];
        const over = rows.filter((row) => row.getBoundingClientRect().right > frame.right + 0.5 || row.getBoundingClientRect().left < frame.left - 0.5).length;
        const btn = root.querySelector('.chron-seg-btn').getBoundingClientRect();
        return { maxH: cs.maxHeight, overflowY: cs.overflowY, over, rows: rows.length, btnH: btn.height, btnW: btn.width };
      }, key);
      ok(r.maxH === 'none' && r.overflowY === 'visible', `${key}: the list flows with the panel (max-height ${r.maxH}, overflow ${r.overflowY})`);
      ok(r.over === 0, `${key}: every row inside the panel`);
      if (m.coarse) ok(r.btnH >= 44, `${key}: toggle touch target ${Math.round(r.btnH)} px`);
      else console.log(`  note ${key}: (pointer: coarse) not emulated here, toggle is ${Math.round(r.btnH)} px high`);
    }
    // the realm body scrolls on a phone; the Chronicle toggle is reachable and works with a tap
    await click(page, await centreOf(page, 'few', '.chron-seg-btn', 1));
    const s = await panelState(page, 'few');
    ok(s.mode === 'all' && s.rows === 4, `tap on All time: ${s.rows} rows`);
    ok(page.errors.length === 0, `no page errors ${page.errors.join(' | ')}`);
  } finally { await page.close(); }
}

async function tapestryChecks() {
  console.log('tapestry: drawn by the real renderer + composer, saved as a real PNG');
  const page = await open('bare=1&view=tapestry&w=1100', 1440, 900, { wait: 3500 });
  try {
    await page.eval(() => {
      window.__downloads = [];
      const real = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function (...a) {
        const d = { name: this.download, href: this.href };
        window.__downloads.push(d);
        d.done = fetch(this.href).then((r) => r.blob()).then(async (blob) => {
          const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
          const bmp = await createImageBitmap(blob);
          d.info = { type: blob.type, size: blob.size, magic: [...head].join(','), w: bmp.width, h: bmp.height };
        });
        return undefined; // do not navigate or save to disk: the check inspects the blob instead
      };
      window.__realClick = real;
    });
    const t = await page.eval(() => {
      const k = window.__tapestry;
      if (!k) return null;
      const c = k.tapestry;
      const g = c.getContext('2d');
      const px = (x, y) => [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data];
      const W = c.width, H = c.height;
      const samples = {
        corner: px(4, H - 4),
        borderMid: px(W / 2 - 3, H * 0.5), // not used for colour: just checks opaque
        mat: px(W * 0.5, H * 0.075 + 10),
        centre: px(W * 0.5, H * 0.45),
      };
      // the left woven band, off the hexagon chain (which runs down its middle): blue-dominant (realm colour #3d7ef0)
      const bandX = W * 0.0337, bandY = H * 0.5;
      let blue = 0, n = 0;
      for (let dy = -40; dy <= 40; dy += 4) { const p = px(bandX, bandY + dy); blue += p[2] > p[0] ? 1 : 0; n++; }
      // variety on the map: count distinct coarse colours in a window
      const seen = new Set();
      for (let i = 0; i < 400; i++) { const p = px(W * (0.2 + 0.6 * ((i * 37) % 100) / 100), H * (0.2 + 0.5 * ((i * 53) % 100) / 100)); seen.add(p.map((v) => v >> 5).join('.')); }
      return { W, H, mapW: k.map.width, mapH: k.map.height, samples, blueShare: blue / n, distinct: seen.size, composeMs: k.composeMs, mapMs: k.mapMs, info: document.getElementById('tapestry-info').textContent };
    });
    ok(!!t, 'the tapestry was composed (window.__tapestry exists)');
    if (t) {
      ok(t.W > t.mapW && t.H > t.mapH, `tapestry ${t.W}x${t.H} frames a ${t.mapW}x${t.mapH} map`);
      ok(t.samples.corner[3] === 255 && t.samples.mat[3] === 255 && t.samples.centre[3] === 255, 'fully opaque (no transparent holes)');
      ok(t.samples.mat[0] > 200 && t.samples.mat[1] > 190, `the mat is parchment (${t.samples.mat.slice(0, 3).join(',')})`);
      ok(t.blueShare > 0.8, `the border is woven in the realm colour (blue-dominant share ${t.blueShare.toFixed(2)})`);
      ok(t.distinct >= 12, `the map is not blank (${t.distinct} distinct colours sampled)`);
      console.log(`  note map ${t.mapMs} ms, compose ${t.composeMs} ms`);
    }

    const at = await page.eval(() => { const r = document.getElementById('save-btn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    // the gallery's nav is hidden in bare mode along with .tools: show the button for the check
    await page.eval(() => { document.querySelector('.tools').style.display = 'flex'; });
    const at2 = await page.eval(() => { const r = document.getElementById('save-btn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await click(page, at2.x ? at2 : at);
    await sleep(800);
    const dl = await page.eval(async () => {
      const d = window.__downloads[0];
      if (!d) return null;
      await d.done;
      return { name: d.name, href: d.href.slice(0, 5), count: window.__downloads.length, info: d.info };
    });
    ok(!!dl && dl.count === 1, 'Save PNG started exactly one download');
    if (dl) {
      ok(/^hex-dominion-dynasty-2-\d{4}-\d{2}-\d{2}\.png$/.test(dl.name), `file name ${dl.name}`);
      ok(dl.href === 'blob:', 'from a blob URL');
      ok(dl.info.type === 'image/png' && dl.info.magic === '137,80,78,71,13,10,26,10', `a real PNG (${dl.info.type}, magic ${dl.info.magic})`);
      ok(dl.info.size > 100000, `PNG size ${Math.round(dl.info.size / 1024)} KB`);
      ok(dl.info.w === t.W && dl.info.h === t.H, `the PNG decodes at ${dl.info.w}x${dl.info.h}, the full canvas`);
    }

    // the game's own path: saveTapestry(state, world, now) behind the "Save the map" button
    await page.eval(() => { window.__downloads.length = 0; });
    const btn = await page.eval(() => { const r = document.getElementById('save-real-btn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: document.getElementById('save-real-btn').textContent }; });
    ok(btn.label === 'Save the map', `the button reads "${btn.label}"`);
    await click(page, btn);
    await sleep(120);
    const busy = await page.eval(() => ({ label: document.getElementById('save-real-btn').textContent, disabled: document.getElementById('save-real-btn').disabled }));
    ok(busy.disabled && /Saving/.test(busy.label), `busy while rendering: "${busy.label}", disabled ${busy.disabled}`);
    await page.eval(() => new Promise((resolve) => { const t = setInterval(() => { if (window.__saved) { clearInterval(t); resolve(); } }, 50); }));
    const real = await page.eval(async () => {
      const d = window.__downloads[0];
      if (!d) return null;
      await d.done;
      return { name: d.name, count: window.__downloads.length, info: d.info, saved: window.__saved, label: document.getElementById('save-real-btn').textContent, disabled: document.getElementById('save-real-btn').disabled, info2: document.getElementById('tapestry-info').textContent };
    });
    ok(!!real && real.count === 1 && real.saved.ok, 'saveTapestry downloaded exactly one file and reported ok');
    if (real) {
      ok(real.name === real.saved.file && /^hex-dominion-dynasty-2-\d{4}-\d{2}-\d{2}\.png$/.test(real.name), `file ${real.name}`);
      ok(real.info.magic === '137,80,78,71,13,10,26,10' && real.info.w >= 1600 && real.info.w <= 1800, `a PNG ${real.info.w}x${real.info.h}, ${Math.round(real.info.size / 1024)} KB`);
      ok(!real.disabled && real.label === 'Save the map', 'the button is back to normal afterwards');
      ok(/^Map saved: hex-dominion-dynasty-2-/.test(real.info2), `toast words: "${real.info2}"`);
    }
    ok(page.errors.length === 0, `no page errors ${page.errors.join(' | ')}`);
  } finally { await page.close(); }
}

try {
  await desktopChecks();
  await keyboardChecks();
  await saveButtonChecks();
  await phoneChecks();
  await tapestryChecks();
} catch (e) {
  failures++;
  console.log('  FAIL threw', e && e.stack ? e.stack : e);
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
