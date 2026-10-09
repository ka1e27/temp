// CI smoke test of the REAL game in a real (headless) Chrome with a fresh profile, driven only by
// real pointer / touch events, so it proves what a synthetic el.click() cannot: that the buttons and
// the map are actually clickable and draggable. Exits non-zero on the first failed check or on any
// console error.
//
//   npm start                        # in another terminal
//   node tools/check.mjs             # desktop 1440x900 (mouse) then phone 390x844 (touch)
//   node tools/check.mjs --only=phone --url=http://localhost:8080
//   node tools/check.mjs --base=/temp/     # the DEPLOYED shape: see below
//
// --base=/temp/ starts its own server (tools/serve.js) that serves the repo under that prefix with NOTHING at
// "/", exactly like GitHub Pages (https://ka1e27.github.io/temp/), runs the whole suite below against it with
// the service worker registered (?sw=1), and then the deploy checks: every same-origin request resolves under the
// prefix (no 404s, right MIME types), the worker registers with the prefix as its scope and caches under it, the
// manifest's start_url / scope / icons resolve, classic.html still loads the v1 game, and after ONE visit a reload
// works with the network switched off. --root=<dir> serves another directory (e.g. a staged _site).
//
// Per variant:
//   1. boots with no console errors and the canvas is painted (not blank)
//   2. a real click on "New Realm" lands ON the button (document.elementFromPoint) and enters the world
//   3. a real click at a frontier region's keep selects it and opens its card (regions that offer
//      "Accept Surrender" are taken with a real click first)
//   4. a real click on Attack starts a battle
//   5. a real drag from the War Camp onto a hostile/neutral site sends troops (battle.stats.sent > 0)
//   6. the dev hook winBattle() -> victory card -> a real click on Continue -> the region is ours
//   7. reload: the save persisted (Continue is offered, the region is still ours)
// It never uses frame times as a pass/fail criterion (headless Chrome here rasterises on the CPU).
import { DRAG_ARROW, NO_ROUTE_TEXT, HINT_PACE } from '../game/scenes/timing.js';

if (!process.env.CHROME_PATH && process.platform === 'win32') {
  process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
}
const { launch: rawLaunch } = await import('./cdp.js');
// Phase 7: the Relic claim moment and the Boon draft that follow a win would stand in front of every older check's "Continue -> back on the map"; under
// these tools an offer waits on the HUD chip instead (app/boons.js reads this flag in ?dev=1 only). tools/phase7Checks.mjs turns the moments back on.
// --cpu=N throttles every page's CPU N-fold and --tz=Zone overrides its timezone (opt-in, to reproduce a slow 2-core CI
// runner in UTC locally: `node tools/check.mjs --only=desktop --cpu=4 --tz=UTC`). Off by default.
// Phase 15B, the layout-shift guard: every page of every section carries tools/hintMonitor.js installShiftGuard from document start; a press whose
// interactive element moved more than 2 px, was hidden or was removed before pointerup is reported through the `__hdShift` binding and fails the section.
const { installShiftGuard } = await import('./hintMonitor.js');
const shiftLog = [];
let currentSection = 'boot';
const launch = async (opts) => {
  const page = await rawLaunch(opts);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__HD_TEST_NO_BOON_MOMENTS = true; window.__HD_TEST_NO_PACING = true;' });
  const section = currentSection;
  await page.send('Runtime.addBinding', { name: '__hdShift' });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installShiftGuard})();` });
  page.on((method, params) => {
    if (method !== 'Runtime.bindingCalled' || params.name !== '__hdShift') return;
    try { shiftLog.push({ section, ...JSON.parse(params.payload) }); } catch { /* malformed */ }
  });
  const cpu = Number(flags.cpu);
  if (cpu > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  if (flags.tz && flags.tz !== 'true') await page.send('Emulation.setTimezoneOverride', { timezoneId: flags.tz });
  return page;
};
const { robustChecks } = await import('./robustChecks.mjs');
const { keepsakeChecks } = await import('./keepsakeChecks.mjs');
const { playtestChecks } = await import('./playtestChecks.mjs');
const { frontierChecks } = await import('./frontierChecks.mjs');
const { generalsChecks } = await import('./generalsChecks.mjs');
const { varietyChecks } = await import('./varietyChecks.mjs');
const { goalsChecks } = await import('./goalsChecks.mjs');
const { phase5Checks } = await import('./phase5Checks.mjs');
const { phase6Checks } = await import('./phase6Checks.mjs');
const { phase7Checks } = await import('./phase7Checks.mjs');
const { phase12Checks } = await import('./phase12Checks.mjs');
const { phase13Checks } = await import('./phase13Checks.mjs');
const { codexChecks } = await import('./codexChecks.mjs');
const { topLaneChecks } = await import('./topLaneChecks.mjs');
const { challengeChecks } = await import('./challengeChecks.mjs');
const { optionsChecks } = await import('./optionsChecks.mjs'); // Phase 14: Play your way
const { textAuditChecks } = await import('./textAuditChecks.mjs'); // Phase 15B: Large and Larger text on two phones

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.join('=') || 'true'];
}));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { spawn } = await import('node:child_process');
const httpGet = (url) => new Promise((resolve, reject) => {
  import('node:http').then(({ get }) => get(url, (res) => { res.resume(); resolve({ status: res.statusCode, headers: res.headers }); }).on('error', reject));
});

// --base: our own server under a project subpath, like Pages. Otherwise an already-running one (npm start).
// (Git Bash on Windows turns "--base=/temp/" into "C:/Program Files/Git/temp/": a drive-letter path means its last segment.)
const baseText = String(flags.base || '').replace(/\\/g, '/');
const baseSeg = /^[A-Za-z]:/.test(baseText) ? baseText.split('/').filter(Boolean).pop() : baseText.replace(/^\/+|\/+$/g, '');
const SUBPATH = baseSeg ? `/${baseSeg}` : '';
let serverProc = null;
let ORIGIN = null;
let BASE = flags.url || process.env.CHECK_URL || 'http://localhost:8080';
const SERVER_PORT = 21000 + Math.floor(Math.random() * 20000);
/** (Re)starts our own subpath server on its fixed port and waits until it answers. */
async function startServer() {
  const args = ['tools/serve.js', `--base=${SUBPATH}/`, `--port=${SERVER_PORT}`, '--hooks'];
  if (flags.root) args.push(`--root=${flags.root}`);
  serverProc = spawn(process.execPath, args, { stdio: 'ignore', cwd: new globalThis.URL('..', import.meta.url) });
  for (let i = 0; i < 60; i++) {
    try { if ((await httpGet(`${BASE}/`)).status === 200) return; } catch { /* not up yet */ }
    await sleep(100);
  }
}
const stopServer = () => { if (serverProc) { serverProc.kill(); serverProc = null; } };
if (SUBPATH) {
  ORIGIN = `http://localhost:${SERVER_PORT}`;
  BASE = `${ORIGIN}${SUBPATH}`;
  await startServer();
}
process.on('exit', stopServer);
// ?sw=1 makes index.html register the service worker on localhost too, so the deployed code path is tested.
const URL = `${BASE}/index.html?dev=1&seed=7${SUBPATH ? '&sw=1' : ''}`;

let failures = 0;
const allErrors = [];

function ok(cond, label) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) failures++;
  return cond;
}

async function variant(name, { width, height, mobile }) {
  console.log(`\n== ${name}: ${width}x${height}${mobile ? ' touch' : ' mouse'} ==`);
  const page = await launch({ url: 'about:blank', width, height });
  const errors = [];
  page.on((method, params) => {
    if (method === 'Runtime.exceptionThrown') {
      errors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text);
    } else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      errors.push(params.args.map((a) => a.value ?? a.description).join(' '));
    } else if (method === 'Log.entryAdded' && params.entry.level === 'error') {
      errors.push(`${params.entry.text} ${params.entry.url || ''}`);
    }
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  if (mobile) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const waitFor = async (fn, timeout = 20000, ...args) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await page.eval(fn, ...args)) return true;
      await sleep(100);
    }
    return false;
  };
  // The crown bonus the copy must quote: straight from game/config/crowns.js as the page loads it (one decimal, like
  // game/app/crownCopy.js), so a balance change to BOUNTY_FRACTION_PER_CROWN moves the copy and this check together.
  const crownPct = () => page.eval(async () => {
    const { BOUNTY_FRACTION_PER_CROWN: f } = await import(new URL('game/config/crowns.js', document.baseURI).href);
    return Number((f * 100).toFixed(1));
  });
  // PLAYFEEL §4 hint placement, measured after EVERY frame of the whole run by tools/hintMonitor.js (reinstalled after each reload, collected before it).
  const hintProblems = [];
  let hintFrames = 0;
  const hintInstall = () => page.eval(async () => { const m = await import(new URL('tools/hintMonitor.js', document.baseURI).href); const mon = m.installHintMonitor(); mon.regionId = null; });
  const hintCollect = async () => {
    const r = await page.eval(() => (window.__hm ? window.__hm.report() : null)).catch(() => null);
    if (!r) return;
    hintFrames += r.shown;
    for (const h of r.hints) for (const [kind, v] of Object.entries(h.problems)) hintProblems.push(`"${h.text.slice(0, 40)}": ${kind} (${v.n} frames) ${v.detail}`);
  };
  // Icon-only buttons: the icon's visible box centre within 1 px of the button centre, the button inside its bar (tools/iconMetrics.js).
  const iconProblems = [];
  const iconSeen = new Set();
  const iconMeasure = (where) => page.eval(async () => { const m = await import(new URL('tools/iconMetrics.js', document.baseURI).href); return m.measureIconButtons(); }).then((rows) => {
    for (const r of rows) {
      iconSeen.add(r.el);
      if (Math.max(Math.abs(r.dx), Math.abs(r.dy)) > 1) iconProblems.push(`${r.el} (${where}): icon off centre by ${r.dx}, ${r.dy}`);
      if (r.outside > 0.5) iconProblems.push(`${r.el} (${where}): pokes ${r.outside} px out of ${r.bar}`);
    }
  });
  const centerOf = (sel, txt) => page.eval((s, t) => {
    const els = [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length > 0 && !e.closest('[hidden]'));
    const el = t ? els.find((e) => e.textContent.toLowerCase().includes(t.toLowerCase())) : els[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return { x, y, hit: top === el || el.contains(top), cover: top && `${top.tagName.toLowerCase()}.${String(top.className).split(' ').join('.')}` };
  }, sel, txt);
  const tap = async (x, y) => {
    if (mobile) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await sleep(70);
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse('mouseMoved', x, y, 'none', 0);
      await sleep(30);
      await page.mouse('mousePressed', x, y, 'left', 1);
      await sleep(50);
      await page.mouse('mouseReleased', x, y, 'left', 0);
    }
  };
  /** A real press whose pointerdown and pointerup are `holdMs` apart, with `during()` run between them and `beforeUp()` just before the release. */
  const slowPress = async (x, y, holdMs, during, beforeUp) => {
    if (mobile) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await sleep(holdMs * 0.3);
      if (during) await during();
      await sleep(holdMs * 0.7);
      if (beforeUp) await beforeUp();
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse('mouseMoved', x, y, 'none', 0);
      await sleep(30);
      await page.mouse('mousePressed', x, y, 'left', 1);
      await sleep(holdMs * 0.3);
      if (during) await during();
      await sleep(holdMs * 0.7);
      if (beforeUp) await beforeUp();
      await page.mouse('mouseReleased', x, y, 'left', 0);
    }
  };
  /**
   * Click-swallowing audit: presses `sel` n times with pointerdown and pointerup 130 ms apart, WHILE the game keeps
   * refreshing its UI, and counts the clicks that arrive (app handlers are muted so nothing changes). A refresh that
   * replaces the element under the pointer (a button's icon counts) in between loses the click: the battle HUD did
   * exactly that every 66 ms, so most real presses on the power buttons and Pause did nothing.
   */
  const pressAudit = async (sel, label, n = 6) => {
    const c = await page.eval((q) => {
      const el = [...document.querySelectorAll(q)].find((e) => e.getClientRects().length > 0 && !e.closest('[hidden]'));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      window.__pa = { downs: 0, clicks: 0 };
      const inEl = (e) => e.target && (e.target === el || el.contains(e.target));
      window.__paDown = (e) => { if (inEl(e)) window.__pa.downs++; };
      window.__paClick = (e) => { if (inEl(e)) { window.__pa.clicks++; e.stopImmediatePropagation(); e.preventDefault(); } };
      window.addEventListener('pointerdown', window.__paDown, true);
      window.addEventListener('click', window.__paClick, true);
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, sel);
    if (!ok(!!c, `${label}: the control is on screen`)) return;
    for (let i = 0; i < n; i++) { await slowPress(c.x, c.y, 130); await sleep(70); }
    const r = await page.eval(() => {
      window.removeEventListener('pointerdown', window.__paDown, true);
      window.removeEventListener('click', window.__paClick, true);
      return window.__pa;
    });
    ok(r.downs === n && r.clicks === n, `${label}: ${r.clicks} of ${r.downs} slow presses became clicks`);
  };
  /** A real drag a -> b; `onHold` runs while the pointer is still down over b (the preview is live), before the release;
   *  `releaseAt` lets go somewhere else instead (a cancelled send). */
  const dragTo = async (a, b, onHold, releaseAt) => {
    if (mobile) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
      // the first move already clears the tap threshold, as a finger that sets off on a drag does: a slow page (a CI runner, --cpu) handles one touchmove
      // per frame, and three short ones could outlast the 450 ms long-press (which on our own settlement arms a supply line instead of a send)
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      for (let i = 1; i <= 14; i++) {
        const f = Math.max(i / 14, Math.min(1, 16 / dist));
        await page.send('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, id: 1 }],
        });
        await sleep(16);
      }
      await sleep(120);
      if (onHold) await onHold();
      if (releaseAt) await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: releaseAt.x, y: releaseAt.y, id: 1 }] });
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse('mouseMoved', a.x, a.y, 'none', 0);
      await page.mouse('mousePressed', a.x, a.y, 'left', 1);
      for (let i = 1; i <= 14; i++) {
        await page.mouse('mouseMoved', a.x + ((b.x - a.x) * i) / 14, a.y + ((b.y - a.y) * i) / 14, 'left', 1);
        await sleep(12);
      }
      await sleep(120);
      if (onHold) await onHold();
      const end = releaseAt || b;
      if (releaseAt) await page.mouse('mouseMoved', end.x, end.y, 'left', 1);
      await page.mouse('mouseReleased', end.x, end.y, 'left', 0);
    }
  };
  /** Real click on an element, asserting the click really lands on it. */
  const clickReal = async (sel, txt, label, { stable = false } = {}) => {
    // `stable`: aim only once the element has stopped moving (two samples 150 ms apart agree), like a player who aims at a button where it IS:
    // a phone's bottom sheet grows upward when a hint opens room in it (the Attack hint waits HINT_PACE.attackHintDelaySec), moving every button
    if (stable) {
      let prev = null;
      for (let i = 0; i < 20; i++) {
        const c0 = await centerOf(sel, txt);
        if (c0 && prev && Math.abs(c0.x - prev.x) < 0.5 && Math.abs(c0.y - prev.y) < 0.5) break;
        prev = c0;
        await sleep(150);
      }
    }
    const c = await centerOf(sel, txt);
    if (!ok(!!c, `${label}: element exists`)) return false;
    ok(c.hit, `${label}: the click point is ON the element (elementFromPoint)${c.hit ? '' : `, covered by ${c.cover}`}`);
    await tap(c.x, c.y);
    return true;
  };

  try {
    await page.goto(URL);

    // 1. boot -----------------------------------------------------------------------------
    ok(await waitFor(() => !!window.__hd && window.__hd.scene === 'title', 30000), 'boots to the title scene');
    await sleep(1500);
    // The ?dev=1 panel sits over the bottom-left of a phone screen; it is not part of the game a player sees.
    await page.eval(() => window.__hd.hideDev(true));
    await hintInstall();
    await iconMeasure('title');
    ok(errors.length === 0, `no console errors during boot${errors.length ? `: ${errors[0]}` : ''}`);
    ok(await page.eval(() => {
      const c = document.getElementById('world');
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 1499) seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
      return seen.size >= 8; // a painted continent, not a flat fill
    }), 'the canvas is painted (not blank)');
    ok(await page.eval(() => !document.getElementById('boot')), 'the boot splash was removed');

    // 2. New Realm --------------------------------------------------------------------------
    await clickReal('.title-actions button', 'New Realm', 'New Realm');
    ok(await waitFor(() => window.__hd.scene === 'world', 10000), 'the world scene is entered');
    await sleep(2600); // camera flight + mists
    ok(await page.eval(() => window.__hd.state.owner.filter((o) => o === 0).length === 1), 'a fresh realm owns exactly its home region');
    // The living map: the ambient layer (smoke, boats, caravans, birds) runs on the world scene and its clock advances.
    const amb = () => page.eval(() => { const st = window.__hd.renderer.ambient.stats(); return { enabled: st.enabled, time: st.time, smoke: st.smokeSources, boats: st.boats }; });
    const amb0 = await amb();
    await sleep(700);
    const amb1 = await amb();
    ok(amb0.enabled && amb1.time > amb0.time, 'the ambient layer is enabled on the world scene and its clock runs');
    ok(amb0.smoke > 0 && amb0.boats >= 0, `the world has chimneys to smoke (${amb0.smoke} sources)`);
    // The click above was the first gesture: it must have unlocked audio and started the score (a touch only
    // counts as an activation when it ENDS, so this is what proves the phone unlock).
    {
      // a voice has sounded (peakVoices): the live count drops to 0 between notes, and a slow page (--cpu, a CI runner) polls seldom enough to miss every note
      const playing = await waitFor(() => { const m = window.__hd.music.getDebug(); return m.started && !m.paused && m.peakVoices > 0 && m.errors === 0; }, Math.min(30000, 8000 * Math.max(1, Number(flags.cpu) || 1))); // (--cpu: the first note can come late on a page drawing 1-2 frames a second)
      const dbg = playing ? '' : `: ${JSON.stringify(await page.eval(() => { const m = window.__hd.music.getDebug(); return { started: m.started, paused: m.paused, peakVoices: m.peakVoices, activeVoices: m.activeVoices, errors: m.errors }; }))}`;
      ok(playing, `the first click unlocked audio and the music is playing (voices > 0, no errors)${dbg}`);
    }

    // 2b. touch: a pinch that starts on the game's chrome must not zoom the PAGE (the viewport stays user-scalable; the chrome is `touch-action: pan-x pan-y`)
    if (mobile) {
      const pinchAt = async (cx, cy, s0, s1) => {
        await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - s0, y: cy, id: 1 }, { x: cx + s0, y: cy, id: 2 }] });
        for (let i = 1; i <= 12; i++) { const sp = s0 + ((s1 - s0) * i) / 12; await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - sp, y: cy, id: 1 }, { x: cx + sp, y: cy, id: 2 }] }); await sleep(16); }
        await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(300);
      };
      await pinchAt(width / 2, 40, 25, 110); // over the HUD bar
      ok(await page.eval(() => window.visualViewport.scale === 1), 'a pinch on the HUD does not zoom the page (visualViewport.scale stays 1)');
      await page.eval(() => window.__hd.openCouncil());
      await sleep(800);
      await pinchAt(width / 2, height * 0.45, 25, 110); // over the open War Council
      ok(await page.eval(() => window.visualViewport.scale === 1), 'nor does a pinch on an open panel');
      await page.eval(() => { document.querySelector('.council-close')?.click(); });
      await sleep(500);
      // the small x buttons keep their look but take a finger: a tap 17 px off the toast's x (inside its 44 px hit area) dismisses the toast
      await page.eval(() => window.__hd.services.ui.toasts.update({ id: 'touch-probe', type: 'info', message: 'Touch target probe', duration: 9000 }));
      await sleep(700);
      const tx = await page.eval(() => { const b = document.querySelector('.toast-close'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      ok(!!tx, 'a toast with its x is on screen');
      if (tx) {
        await tap(tx.x - 17, tx.y + 17);
        ok(await waitFor(() => ![...document.querySelectorAll('.toast')].some((t) => /Touch target probe/.test(t.textContent) && !t.classList.contains('is-out')), 2500), 'a finger 17 px off the toast x still dismisses it (44 px hit area)');
      }
    }

    // 3. select the first frontier region by clicking its keep ---------------------------------
    const frontierTarget = () => page.eval(async () => {
      const { world, state, camera } = window.__hd;
      const { difficulty } = await import(new URL('game/meta/progression.js', document.baseURI).href);
      const ids = world.regions.filter((r) => state.owner[r.id] !== 0 && r.neighbors.some((n) => state.owner[n] === 0)).map((r) => r.id);
      const id = ids.find((i) => !difficulty(state, world, i).surrender) ?? ids[0];
      const keep = world.tiles[world.settlements[world.regions[id].keep].tile];
      // the keep, unless a hint's bubble (W2 points at this very region) sits over it right now: then the region's nearest uncovered tile, like a player
      const onMap = (q) => q.x > 8 && q.y > 8 && q.x < innerWidth - 8 && q.y < innerHeight - 8 && document.elementFromPoint(q.x, q.y)?.id === 'world';
      const pts = [keep, ...world.regions[id].tiles.map((i) => world.tiles[i]).sort((a, b) => Math.hypot(a.x - keep.x, a.y - keep.y) - Math.hypot(b.x - keep.x, b.y - keep.y))]
        .map((t, k) => { const q = camera.worldToScreen(t.x, t.y); return { x: q.x, y: q.y + (k === 0 ? 6 : 0) }; });
      const p = pts.find(onMap) || pts[0];
      return { id, name: world.regions[id].name, x: p.x, y: p.y };
    });
    // aim once the camera has stopped (the world's opening drift / a fly-to): on a slow page (--cpu) a point computed mid-move landed on another region
    for (let i = 0, prev = ''; i < 30; i++) { const c = await page.eval(() => { const k = window.__hd.camera; return `${k.x.toFixed(1)},${k.y.toFixed(1)},${k.zoom.toFixed(3)}`; }); if (c === prev) break; prev = c; await sleep(150); }
    const target = await frontierTarget();
    // the page's own clock at the first frame the card is up (the Attack hint counts from there; see 3b)
    await page.eval(() => { window.__cardUpAt = null; const poll = () => { const d = document.querySelector('.hd-dock'); if (d && !d.hidden && d.getClientRects().length) window.__cardUpAt = performance.now(); else requestAnimationFrame(poll); }; poll(); });
    await tap(target.x, target.y);
    ok(await waitFor(() => { const d = document.querySelector('.hd-dock'); return d && !d.hidden && d.getClientRects().length > 0; }, 8000),
      'clicking a frontier region opens its card');
    await sleep(900); // the card slides in (and the camera eases clear of it): tap only once it has settled, like a player
    ok(await page.eval((n) => (document.querySelector('.region-card-name')?.textContent || '').includes(n), target.name),
      `the card is for the clicked region (${target.name})`);
    const action = await page.eval(() => document.querySelector('.region-card-action:not([hidden])')?.textContent || '');
    ok(/attack/i.test(action), `a fresh realm's first frontier card offers Attack, not a surrender (got "${action.trim()}")`);
    // Crowns: the desktop card shows three open medals, the phone bottom sheet one compact par line.
    if (mobile) {
      ok(await page.eval(() => { const p = document.querySelector('.region-card-par'); return !!p && p.getClientRects().length > 0 && /^Par \d+:\d\d/.test(p.textContent); }),
        'the phone card shows the compact "Par m:ss - crowns" line');
      ok(await page.eval((p) => document.querySelector('.region-card-par').textContent.includes('crowns +' + p + '% bounty each'), await crownPct()),
        'the phone par line quotes the crown bonus from config (BOUNTY_FRACTION_PER_CROWN)');
    } else {
      ok(await page.eval(() => { const r = document.querySelector('.region-card .crown-row'); return !!r && r.getClientRects().length > 0 && r.querySelectorAll('.crown-slot').length === 3; }),
        'the desktop card shows the three open crown medals');
      // the Attack hint's bubble sits beside its button (left of the card on desktop): it may brush the card's outer padding but never covers a row of the card
      ok(await page.eval(() => {
        const b = document.querySelector('.coach:not([hidden]) .coach-bubble');
        const card = document.querySelector('.region-card');
        if (!b || !card) return true;
        const a = b.getBoundingClientRect();
        return [...card.querySelectorAll('.region-card-header, .region-card-body > *')].filter((n) => n.getClientRects().length > 0).every((n) => {
          const c = n.getBoundingClientRect();
          return a.right <= c.left + 0.5 || a.left >= c.right - 0.5 || a.bottom <= c.top + 0.5 || a.top >= c.bottom - 0.5;
        });
      }),
        'the Attack hint bubble never covers a row of the region card');
      ok(await page.eval((p) => (document.querySelector('.region-card')?.textContent || '').includes('Crowns: +' + p + '% bounty each'), await crownPct()),
        'the desktop card label quotes the crown bonus from config (BOUNTY_FRACTION_PER_CROWN)');
    }

    // 3b. Scout and Sabotage through real clicks ------------------------------------------------------
    const scrollTo = async (sel) => {
      await page.eval((q) => document.querySelector(q)?.scrollIntoView({ block: 'nearest' }), sel);
      await sleep(250);
    };
    ok(await page.eval(() => { const b = document.querySelector('.intel-scout-btn'); return !!b && b.getClientRects().length > 0; }), 'the unscouted card offers Scout');
    const isTutorialRegion = await page.eval(async (id) => {
      const { tutorialRegionId } = await import(new URL('game/meta/intel.js', document.baseURI).href);
      return tutorialRegionId(window.__hd.state, window.__hd.world) === id;
    }, target.id);
    if (isTutorialRegion) ok(await page.eval(() => /free/i.test(document.querySelector('.intel-scout-btn').textContent)), 'the tutorial region is scouted for free');
    // The card refreshes once a second, so a disabled (unaffordable) Scout button only enables on the next refresh: force one and
    // wait for the button to be enabled, instead of hoping 400 ms happens to span a refresh (it flaked once Scout cost more than the start gold).
    await page.eval(() => { window.__hd.grantGold(200000); window.__hd.refreshCard(); });
    ok(await waitFor(() => { const b = document.querySelector('.intel-scout-btn'); return !!b && !b.disabled; }, 4000), 'the Scout button enables once the gold is there');
    // The Attack hint speaks once the card has been open HINT_PACE.attackHintDelaySec, and the room it opens above Attack lifts a phone's whole bottom
    // sheet (Scout with it). Landing between a press and its release, it moved the button out from under the finger and the tap hit whatever slid under
    // it instead (CI, 2-core runner: every run). Hold a real press on Scout ACROSS that moment: the card must keep the room shut while the press is on it
    // (world.js hintRoom), and the release must still scout. (A machine too slow to get here in time aims at a button that has stopped moving instead.)
    const hintLeft = () => page.eval((delay) => (window.__cardUpAt == null ? -1 : window.__cardUpAt + delay - performance.now()), HINT_PACE.attackHintDelaySec * 1000);
    const roomOpen = () => page.eval(() => [...document.querySelectorAll('.region-card-hintslot')].some((r) => r.dataset.px && r.dataset.px !== '0'));
    if ((await hintLeft()) > 700 && !(await roomOpen())) {
      const c = await centerOf('.intel-scout-btn');
      ok(!!c && c.hit, 'Scout: the press point is ON the element (elementFromPoint)');
      const yBefore = c.y;
      let shut = true;
      let yDuring = yBefore;
      await slowPress(c.x, c.y, Math.max(600, (await hintLeft()) + 700), null, async () => {
        shut = !(await roomOpen());
        yDuring = (await centerOf('.intel-scout-btn'))?.y ?? -1;
      });
      ok(shut, 'the room for the hint stays shut while a press is on the card');
      ok(Math.abs(yDuring - yBefore) < 2, `Scout did not move under the finger (${yBefore.toFixed(1)} -> ${yDuring.toFixed(1)})`);
      ok(await waitFor(() => [...document.querySelectorAll('.region-card-hintslot')].some((r) => r.dataset.px && r.dataset.px !== '0'), 4000), 'the Attack hint opens its room once the press is over');
    } else {
      console.log(`  note: the Attack hint was due in ${Math.round(await hintLeft())} ms; the press-across-the-hint path was not exercised`);
      await sleep(Math.max(0, (await hintLeft()) + 300));
      await clickReal('.intel-scout-btn', null, 'Scout', { stable: true });
    }
    ok(await waitFor((id) => window.__hd.state.intel[id]?.scouted === true, 4000, target.id), 'a real click on Scout records the scouting');
    ok(await waitFor(() => document.querySelectorAll('.intel-chip').length >= 2, 4000), 'the scouted card reveals the garrison chips');
    await sleep(700);
    await scrollTo('.intel-sabotage-btn');
    await clickReal('.intel-sabotage-btn', null, 'Sabotage (1st)', { stable: true });
    ok(await waitFor((id) => window.__hd.state.intel[id]?.sabotage === 1, 4000, target.id), 'the first Sabotage step lands (level 1)');
    await sleep(900);
    await scrollTo('.intel-sabotage-btn');
    await clickReal('.intel-sabotage-btn', null, 'Sabotage (2nd)', { stable: true });
    ok(await waitFor((id) => window.__hd.state.intel[id]?.sabotage === 2, 4000, target.id), 'the second Sabotage step lands (maxed at level 2)');
    ok(await waitFor(() => { const b = document.querySelector('.intel-sabotage-btn'); return !!b && b.disabled && /already weakened/i.test(b.textContent); }, 3000),
      'the Sabotage button is disabled and says the garrisons are already weakened');
    // the card never outgrows the screen: a phone's sheet is capped at 62% (76% while the tutorial's Attack bubble has opened room above the button), the desktop column at the screen minus the HUD; its body scrolls inside
    ok(await page.eval((phone) => { const d = document.querySelector('.hd-dock'); const open = [...document.querySelectorAll('.region-card-hintslot')].some((r) => r.dataset.px && r.dataset.px !== '0'); return d.getBoundingClientRect().height <= (phone ? innerHeight * (open ? 0.77 : 0.63) : innerHeight - 88); }, mobile), 'the card stays within its height cap (its body scrolls inside)');
    await sleep(600);
    await pressAudit('.hud-btn[aria-label="War Council"]', 'HUD War Council'); // (after Scout: the press on Scout above must start before the Attack hint)

    // 4. Attack, pressed SLOWLY while gold ticks and the card refreshes ------------------------------
    // The card used to rebuild its buttons on every refresh: one landing between pointerdown and pointerup
    // swallowed the click. Let gold tick for 3 s, then hold the press 150 ms and force a refresh (with a gold
    // change) in the middle of it. The very same button node must still be there, and the battle must start.
    await sleep(3000);
    await page.eval(() => { document.querySelector('.region-card-action:not([hidden])').__stable = true; });
    const goldBefore = await page.eval(() => window.__hd.state.gold);
    const atk = await centerOf('.region-card-action', 'Attack');
    ok(!!atk && atk.hit, 'the Attack button is under its own centre point (elementFromPoint)');
    await slowPress(atk.x, atk.y, 150, async () => {
      await page.eval(() => { window.__hd.grantGold(1); window.__hd.refreshCard(); });
    });
    ok(await page.eval((g) => window.__hd.state.gold > g, goldBefore), 'gold was ticking');
    ok(await waitFor(() => window.__hd.scene === 'battle', 8000), 'a battle starts (the slow press was not swallowed)');
    ok(await page.eval(() => [...document.querySelectorAll('.region-card-action')].some((b) => b.__stable)),
      'the Attack button node survived the refreshes (patched in place, never rebuilt)');
    ok(await waitFor(() => window.__hd.battlePhase === 'live', 20000), 'the fly-in lands and the fight goes live');
    ok(await waitFor(() => [...document.querySelectorAll('.toast')].some((t) => /agents weakened/i.test(t.textContent)), 4000), 'a sabotaged region says so in a toast when the battle goes live');
    ok(await waitFor(() => window.__hd.music.getDebug().scene === 'battle', 8000), 'the score crossfaded to the battle bed');
    {
      const b0 = await amb();
      await sleep(600);
      const b1 = await amb();
      ok(!b0.enabled && b1.time === b0.time, 'the ambient layer is OFF in battle and time stands still');
    }
    await sleep(600);
    await pressAudit('.power-btn', 'battle power button (Rally)');
    await pressAudit('.battle-pause', 'battle Pause');
    await pressAudit('.battle-speed', 'battle speed');
    {
      // no power name is ever cut with an ellipsis ("FORCED MAR...", "BULWA..."): the visible form fits its box at this viewport
      const cut = await page.eval(() => [...document.querySelectorAll('.power-name')].filter((n) => n.getClientRects().length && n.scrollWidth > n.clientWidth + 0.5)
        .map((n) => ([...n.children].find((c) => getComputedStyle(c).display !== 'none') || n).textContent));
      ok(cut.length === 0, `every power name fits without an ellipsis${cut.length ? `: ${cut.join(', ')}` : ''}`);
    }
    ok(await page.eval(() => !!window.__hd.battle && window.__hd.battle.stats.sent === 0), 'no troops sent yet');

    // 5. drag from the War Camp to a hostile/neutral site ------------------------------------
    const drag = await page.eval(() => {
      const sites = window.__hd.siteInfo();
      const camp = sites.find((s) => s.type === 'camp');
      const foes = sites.filter((s) => s.owner !== 0 && s.y > 100 && s.y < innerHeight - 170 && s.x > 10 && s.x < innerWidth - 10);
      foes.sort((a, b) => Math.hypot(a.x - camp.x, a.y - camp.y) - Math.hypot(b.x - camp.x, b.y - camp.y));
      return { camp, foe: foes[0] };
    });
    ok(!!drag.camp && !!drag.foe, 'a War Camp and an enemy site are on screen');
    // the tutorial's gold arrow must point at a settlement the camp may actually attack (front lines: never at one with no route)
    ok(await page.eval(() => import(new URL('game/battle/sim.js', document.baseURI).href).then((m) => { const ta = window.__hd.tutorialArrow(); return !ta || m.canRoute(window.__hd.battle, 0, ta.from, ta.to); })), 'the tutorial arrow points at a settlement the camp can route to');
    // Step 3 of the tutorial promises "the arrow tells you if you'll take it": while the drag is held over the target, the
    // arrow must be green for a capture / red for a shortfall (the tooltip says the same in words).
    // the red case first, when a foe the camp cannot take is on screen: hold over it, read the arrow, then let go back on the camp (no send)
    const failFoe = await page.eval(() => import(new URL('game/battle/sim.js', document.baseURI).href).then((m) => {
      const hd = window.__hd;
      const camp = hd.battle.sites.find((s) => s.type === 'camp' && s.owner === 0);
      return hd.siteInfo().find((s) => s.owner !== 0 && s.y > 100 && s.y < innerHeight - 170 && s.x > 10 && s.x < innerWidth - 10
        && m.previewSend(hd.battle, [camp.id], s.id, 0.5).outcome === 'fail') || null;
    }));
    if (failFoe) {
      let heldFail = null;
      await dragTo({ x: drag.camp.x, y: drag.camp.y + 4 }, { x: failFoe.x, y: failFoe.y + 4 }, async () => {
        heldFail = await page.eval(() => ({ info: window.__hd.dragInfo(), tip: document.querySelector('.tooltip')?.textContent || '' }));
      }, { x: drag.camp.x, y: drag.camp.y + 4 });
      ok(!!heldFail && !!heldFail.info && heldFail.info.outcome === 'fail' && heldFail.info.color === DRAG_ARROW.fail, 'the drag arrow is RED while held over a site the send cannot take');
      ok(!!heldFail && /not enough/.test(heldFail.tip), `the tooltip says so ("${heldFail && heldFail.tip}")`);
      ok(await page.eval(() => window.__hd.battle.stats.sent === 0), 'letting go back on the camp cancels the send');
    } else console.log('  note: no foe the camp cannot take is on screen; the red arrow case was not exercised');
    let held = null;
    await dragTo({ x: drag.camp.x, y: drag.camp.y + 4 }, { x: drag.foe.x, y: drag.foe.y + 4 }, async () => {
      // the prediction is taken at the moment of the hold (the camp keeps growing, and a marginal capture can flip within seconds)
      held = await page.eval((foeId, campId) => import(new URL('game/battle/sim.js', document.baseURI).href).then((m) => ({
        info: window.__hd.dragInfo(),
        tip: document.querySelector('.tooltip')?.textContent || '',
        expected: m.previewSend(window.__hd.battle, [campId], foeId, 0.5).outcome,
      })), drag.foe.id, drag.camp.id);
    });
    const expected = held && held.expected;
    ok(!!held && !!held.info && held.info.outcome === expected, `the live drag preview matches the sim's prediction (${expected}; got ${held && held.info && held.info.outcome})`);
    ok(!!held && held.info && held.info.color === (expected === 'capture' ? DRAG_ARROW.capture : expected === 'fail' ? DRAG_ARROW.fail : DRAG_ARROW.neutral), `the drag arrow is ${expected === 'capture' ? 'green' : expected === 'fail' ? 'red' : 'gold'} while held over the target`);
    ok(!!held && (expected === 'capture' ? /capture/ : /not enough/).test(held.tip), `the tooltip says it in words ("${held && held.tip}")`);
    if (mobile) ok(!!held && held.info && held.info.tooltip && held.info.wordDrawn == null && !!held.info.mark, `on touch the canvas outcome word is not drawn while the tooltip says it (word ${held && held.info && held.info.wordDrawn}, mark ${held && held.info && held.info.mark})`);
    else ok(!!held && held.info && held.info.wordDrawn === held.info.word, `with a mouse the outcome word is drawn beside the arrow head ("${held && held.info && held.info.wordDrawn}")`);
    ok(await waitFor(() => window.__hd.battle.stats.sent > 0, 6000), 'a real drag from the War Camp sends troops (battle.stats.sent > 0)');
    ok(await waitFor(() => window.__hd.battle.squads.length > 0, 4000), 'a squad is marching');
    {
      // An ARMED power (Rally waiting for its target) must not turn a send drag from your own settlement into a map pan (RC2: a hint's x ate the Rally
      // target tap on a phone, Rally stayed armed, and from then on every send drag moved the camera instead). Drag from the camp at several places on it.
      const rallyBtn = await centerOf('.power-btn');
      const armed = () => page.eval(() => !!document.querySelector('.power-btn.is-armed'));
      if (await armed()) { await tap(rallyBtn.x, rallyBtn.y); await sleep(250); }
      const ready = await page.eval(() => window.__hd.battle.t >= window.__hd.battle.cooldowns.rally && (window.__hd.battle.player.powers.rally || 0) > 0);
      if (ready) {
        await tap(rallyBtn.x, rallyBtn.y);
        await sleep(350);
        ok(await waitFor(() => !!document.querySelector('.power-btn.is-armed'), 1500), 'Rally is armed (waiting for its target)');
        const cam0 = await page.eval(() => ({ x: window.__hd.camera.x, y: window.__hd.camera.y, z: window.__hd.camera.zoom }));
        const sent0 = await page.eval(() => window.__hd.battle.stats.sent);
        const c = await page.eval(() => window.__hd.siteInfo().find((s) => s.type === 'camp' && s.owner === 0));
        const f = await page.eval((id) => window.__hd.siteInfo().find((s) => s.id === id), drag.foe.id);
        await dragTo({ x: c.x, y: c.y + 4 }, { x: f.x, y: f.y + 4 });
        await sleep(300);
        const cam1 = await page.eval(() => ({ x: window.__hd.camera.x, y: window.__hd.camera.y }));
        const moved = Math.hypot(cam1.x - cam0.x, cam1.y - cam0.y) * cam0.z;
        ok(moved < 4, `with Rally armed, a drag from the War Camp does NOT pan the map (camera moved ${moved.toFixed(1)} px)`);
        ok(!(await armed()), 'the drag stood the armed power down');
        ok(await waitFor((n) => window.__hd.battle.stats.sent > n, 4000, sent0), 'and it sent troops instead');
      } else console.log('  note: Rally not ready; the armed-power drag case was not exercised');
    }

    // 5a. supply lines and front lines (DESIGN 4.3, 4.4), with REAL input: a Ctrl-drag (a long-press drag on touch) makes a standing line that keeps sending; the same
    // gesture on the same target removes it; the Auto toggle turns plain drags into lines; right-click (long-press) on the source removes; a drag held over a settlement
    // with no route is grey and says why, and letting go there shakes it and explains
    {
      const supplyDrag = async (a, b, onHold) => {
        if (mobile) {
          await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
          await sleep(650);
          for (let i = 1; i <= 14; i++) {
            await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 14, y: a.y + ((b.y - a.y) * i) / 14, id: 1 }] });
            await sleep(16);
          }
          await sleep(120);
          if (onHold) await onHold();
          await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          const m = 2; // Ctrl
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y, button: 'none', buttons: 0, modifiers: m });
          await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1, modifiers: m });
          for (let i = 1; i <= 14; i++) {
            await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + ((b.x - a.x) * i) / 14, y: a.y + ((b.y - a.y) * i) / 14, button: 'left', buttons: 1, modifiers: m });
            await sleep(12);
          }
          await sleep(120);
          if (onHold) await onHold();
          await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1, modifiers: m });
        }
      };
      const lines = () => page.eval(() => window.__hd.supplyInfo().lines);
      const plan = await page.eval(() => import(new URL('game/battle/sim.js', document.baseURI).href).then((m) => {
        const hd = window.__hd;
        const info = hd.siteInfo();
        const camp = info.find((x) => x.type === 'camp' && x.owner === 0);
        const onScreen = (x) => x.y > 100 && x.y < innerHeight - 170 && x.x > 10 && x.x < innerWidth - 10;
        const dest = info.filter((x) => x.owner !== 0 && onScreen(x) && m.canRoute(hd.battle, 0, camp.id, x.id)).sort((a, b) => Math.hypot(a.x - camp.x, a.y - camp.y) - Math.hypot(b.x - camp.x, b.y - camp.y))[0] || null;
        const mine = info.filter((x) => x.owner === 0);
        const blocked = info.find((x) => x.owner !== 0 && onScreen(x) && !mine.some((o) => m.canRoute(hd.battle, 0, o.id, x.id))) || null;
        return { camp, dest, blocked };
      }));
      ok(!!plan.camp && !!plan.dest, 'a settlement the camp can route to is on screen');
      if (plan.camp && plan.dest) {
        const from = { x: plan.camp.x, y: plan.camp.y + 4 };
        const to = { x: plan.dest.x, y: plan.dest.y + 4 };
        const sentBefore = await page.eval(() => window.__hd.battle.stats.sent);
        let heldS = null;
        await supplyDrag(from, to, async () => { heldS = await page.eval(() => ({ info: window.__hd.dragInfo(), tip: document.querySelector('.tooltip')?.textContent || '' })); });
        ok(!!heldS && !!heldS.info && heldS.info.supply === true, `${mobile ? 'a long-press drag' : 'a Ctrl-drag'} is a SUPPLY drag while held`);
        ok(!!heldS && /^Supply line: \d+% every \d+ s/.test(heldS.tip), `the tooltip says what a supply line does ("${heldS && heldS.tip}")`);
        ok(await waitFor((c, d) => window.__hd.supplyInfo().lines.some((l) => l.from === c && l.to === d), 3000, plan.camp.id, plan.dest.id), 'the gesture made a standing supply line (battle.supply)');
        ok(await waitFor((n) => window.__hd.battle.stats.sent > n, 9000, sentBefore), 'the line keeps sending on its own (auto sends)');
        await iconMeasure('battle with a supply line');
        let heldRepeat = null;
        await supplyDrag(from, to, async () => { heldRepeat = await page.eval(() => document.querySelector('.tooltip')?.textContent || ''); });
        ok(heldRepeat === 'Remove supply line', `repeating the gesture on the same target offers to remove the line ("${heldRepeat}")`);
        ok(await waitFor(() => window.__hd.supplyInfo().lines.length === 0, 3000), 'and removes it');
        // Auto: plain drags make lines while it is on
        const autoBtn = await centerOf('.battle-auto');
        ok(!!autoBtn && autoBtn.hit, 'the Auto toggle is on screen and under its own centre');
        ok(await page.eval(() => { const b = document.querySelector('.battle-auto'); return b.getAttribute('aria-pressed') === 'false' && /off/i.test(b.textContent); }), 'Auto starts OFF and says so in words');
        await tap(autoBtn.x, autoBtn.y);
        ok(await waitFor(() => { const b = document.querySelector('.battle-auto'); return b.getAttribute('aria-pressed') === 'true' && b.classList.contains('is-on') && /on/i.test(b.textContent); }, 2000), 'pressing Auto turns it ON (aria-pressed, gold, "On")');
        let heldAuto = null;
        await dragTo(from, to, async () => { heldAuto = await page.eval(() => ({ info: window.__hd.dragInfo(), tip: document.querySelector('.tooltip')?.textContent || '' })); });
        ok(!!heldAuto && !!heldAuto.info && heldAuto.info.supply === true, `with Auto on, a plain drag is a supply drag (${JSON.stringify(heldAuto)})`);
        ok(await waitFor((c, d) => window.__hd.supplyInfo().lines.some((l) => l.from === c && l.to === d), 3000, plan.camp.id, plan.dest.id), 'and it made a line');
        await tap((await centerOf('.battle-auto')).x, (await centerOf('.battle-auto')).y);
        ok(await waitFor(() => document.querySelector('.battle-auto').getAttribute('aria-pressed') === 'false', 2000), 'Auto turns OFF again');
        if (!mobile) {
          const key = async (k, code, vk) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); };
          await key('s', 'KeyS', 83);
          ok(await waitFor(() => document.querySelector('.battle-auto').getAttribute('aria-pressed') === 'true', 1500), 'the S key turns Auto on');
          await key('s', 'KeyS', 83);
          ok(await waitFor(() => document.querySelector('.battle-auto').getAttribute('aria-pressed') === 'false', 1500), 'and off again');
        }
        // removal from the source: right-click (mouse) or a long press without dragging (touch)
        if (mobile) {
          await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
          await sleep(720);
          await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
          await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'right', buttons: 2, clickCount: 1 });
          await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x, y: from.y, button: 'right', buttons: 0, clickCount: 1 });
        }
        ok(await waitFor(() => window.__hd.supplyInfo().lines.length === 0, 3000), `${mobile ? 'a long press' : 'a right-click'} on the source removes its line`);
        ok((await lines()).length === 0, 'no standing line is left');
      }
      const blockedNow = await page.eval(() => import(new URL('game/battle/sim.js', document.baseURI).href).then((m) => {
        const hd = window.__hd;
        const info = hd.siteInfo();
        const mine = info.filter((x) => x.owner === 0);
        const onScreen = (x) => x.y > 100 && x.y < innerHeight - 170 && x.x > 10 && x.x < innerWidth - 10;
        return info.find((x) => x.owner !== 0 && onScreen(x) && !mine.some((o) => m.canRoute(hd.battle, 0, o.id, x.id))) || null;
      }));
      if (blockedNow && plan.camp) {
        plan.blocked = blockedNow;
        let heldB = null;
        await dragTo({ x: plan.camp.x, y: plan.camp.y + 4 }, { x: plan.blocked.x, y: plan.blocked.y + 4 }, async () => {
          heldB = await page.eval(() => ({ info: window.__hd.dragInfo(), tip: document.querySelector('.tooltip')?.textContent || '' }));
        });
        ok(!!heldB && !!heldB.info && heldB.info.outcome === 'noRoute' && heldB.info.color === DRAG_ARROW.blocked, `the drag arrow is GREY while held over a settlement with no route (${JSON.stringify(heldB && heldB.info)})`);
        ok(!!heldB && heldB.tip === NO_ROUTE_TEXT, `the tooltip says why ("${heldB && heldB.tip}")`);
        ok(await waitFor((id) => window.__hd.supplyInfo().refused === id, 1500, plan.blocked.id), 'letting go there is refused (the target shakes)');
        ok(await waitFor((t) => { const e = document.querySelector('.tooltip'); return !!e && !e.hidden && e.textContent === t; }, 1500, NO_ROUTE_TEXT), 'and the tooltip explains it over the target');
      } else console.log('  note: every settlement on screen had a route; the no-route case was not exercised here (tools/hints.mjs and the unit tests cover it)');
    }
    // 5b. reload MID-battle: the fight resumes from the save ----------------------------------
    const before = await page.eval(() => ({ sent: window.__hd.battle.stats.sent, t: window.__hd.battle.t, sites: window.__hd.battle.sites.length }));
    await iconMeasure('battle');
    await hintCollect();
    await page.send('Page.navigate', { url: URL });
    ok(await waitFor(() => !!window.__hd && window.__hd.scene === 'title', 30000), 'reload mid-battle: back at the title');
    await hintInstall();
    await clickReal('.title-actions button', 'Continue', 'Continue (mid-battle)');
    ok(await waitFor(() => window.__hd.scene === 'battle', 12000), 'Continue resumes straight into the battle');
    ok(await waitFor(() => window.__hd.battlePhase === 'live', 12000), 'the resumed battle is live');
    ok(await page.eval((b) => window.__hd.battle.stats.sent >= b.sent && window.__hd.battle.t >= b.t * 0.5 && window.__hd.battle.sites.length === b.sites, before),
      'the resumed battle kept its state (troops sent, clock, sites)');
    ok(await page.eval((id) => { const i = window.__hd.state.intel[id]; return !!i && i.scouted === true && i.sabotage === 2; }, target.id), 'scouted and sabotaged state persisted through the reload (state.intel)');
    await sleep(800);

    // 6. win -> victory card -> Continue -> region owned ------------------------------------
    const regionId = target.id;
    await page.eval(() => window.__hd.winBattle());
    ok(await waitFor(() => { const c = document.querySelector('.results-card'); return c && !c.hidden && c.dataset.result === 'victory'; }, 20000), 'the VICTORY card appears');
    ok(await page.eval(() => !!document.querySelector('.results-card .crown-row') && document.querySelectorAll('.results-card .crown-slot').length === 3), 'the victory card has its crown row');
    ok(await waitFor(() => document.querySelectorAll('.results-card .crown-slot[data-state="earned"]').length >= 1, 4000), 'the Victory crown lands');
    ok(await page.eval((p) => [...document.querySelectorAll('.results-card .crown-slot[data-state="earned"] .crown-bonus')].every((b) => b.textContent === '+' + p + '%'), await crownPct()),
      'each earned crown on the victory card shows the config bonus (BOUNTY_FRACTION_PER_CROWN), not a typed number');
    ok(await page.eval(() => !!document.querySelector('.results-card .results-crown-tip')), 'the first victory card explains crowns in one static line');
    await sleep(500);
    await clickReal('.results-action', 'Continue', 'Continue');
    ok(await waitFor(() => window.__hd.scene === 'world', 10000), 'Continue returns to the world');
    ok(await waitFor(() => window.__hd.renderer.ambient.stats().enabled, 4000), 'the ambient layer is back on after the battle');
    ok(await page.eval((id) => window.__hd.state.owner[id] === 0, regionId), 'the conquered region is now ours');
    ok(await page.eval(() => window.__hd.state.stats.battlesWon === 1), 'battlesWon was counted');
    ok(await page.eval((id) => { const c = window.__hd.state.crowns[id]; return !!c && c.victory === true; }, regionId), 'the conquered region kept its crowns (state.crowns)');
    ok(await page.eval(() => window.__hd.state.stats.crownsEarned >= 1), 'the crowns were counted (stats.crownsEarned)');
    ok(await page.eval((id) => !(id in window.__hd.state.intel), regionId), 'a conquered region forgets its intel');
    ok(await waitFor(() => window.__hd.music.getDebug().scene === 'world', 15000), 'the score returned to the world bed after the victory stinger');
    await sleep(3000); // coins fly, clouds part

    // 6b. War Council: real purchases, ONE coalesced toast for a spree, and the Treasury line quoting the economy config -----------
    await page.eval(() => window.__hd.grantGold(5000));
    await clickReal('.hud-btn[aria-label="War Council"]', null, 'War Council (open)');
    ok(await waitFor(() => { const p = document.querySelector('.council'); return !!p && !p.hidden && p.getClientRects().length > 0; }, 4000), 'the War Council opens');
    ok(await page.eval(() => { const tags = [...document.querySelectorAll('.upgrade-card-tag')].filter((t) => !t.hidden); return tags.length === 1 && !!tags[0].closest('.upgrade-card') && tags[0].textContent === 'Best value'; }),
      'exactly one upgrade card wears the "Best value" tag');
    const levels = () => page.eval(() => Object.values(window.__hd.state.upgrades).reduce((x, y) => x + y, 0));
    const lv0 = await levels();
    for (let i = 0; i < 3; i++) {
      const buy = await centerOf('.upgrade-card-buy:not([disabled])');
      if (!buy) break;
      await tap(buy.x, buy.y);
      await sleep(300);
    }
    const lv1 = await levels();
    ok(await page.eval(() => [...document.querySelectorAll('.upgrade-card-tag')].filter((t) => !t.hidden).length === 1), 'still exactly one "Best value" tag after the purchases (it is recomputed on purchase)');
    ok(lv1 >= lv0 + 3, `three real clicks on Buy bought three levels (${lv0} -> ${lv1})`);
    ok(await page.eval(() => { const s = document.querySelector('.council-status'); return !!s && /^Bought .+, level \d+$/.test(s.textContent) && s.getAttribute('aria-live') === 'polite'; }),
      'a purchase says so INSIDE the council (a polite status line under the header: "Bought <name>, level N")');
    ok(await page.eval(() => [...document.querySelectorAll('.toasts > .toast')].filter((t) => !t.classList.contains('is-out')).length === 0),
      'no toast appears over the open council (its feedback is inline)');
    await clickReal('.council-tab', 'Realm', 'Realm tab');
    await sleep(300);
    ok(await page.eval(async () => {
      const { ECONOMY } = await import(new URL('game/config/meta.js', document.baseURI).href);
      const card = [...document.querySelectorAll('.upgrade-card')].find((x) => /treasury/i.test(x.querySelector('.upgrade-card-name')?.textContent || ''));
      // the line shows only what changes ("2 → 3 h offline cap", council.js effectDiff); its label carries the whole values
      const eff = card && card.querySelector('.upgrade-card-effect');
      return !!eff && (eff.getAttribute('aria-label') || '').includes(`now ${ECONOMY.offlineCapHours} h offline cap`) && eff.querySelector('.upgrade-card-current').textContent === String(ECONOMY.offlineCapHours);
    }), 'the Treasury line quotes the offline cap from config (ECONOMY.offlineCapHours), not a typed base');
    await clickReal('.council-close', null, 'War Council (close)');
    await sleep(500);

    // 6c. Region Works (DESIGN 5.8), real input: build through the chooser, upgrade, the demolish confirm (Keep keeps, Demolish refunds half), saved -----------
    {
      const scrollTo = async (sel) => { await page.eval((q) => { const e = document.querySelector(q); if (e) e.scrollIntoView({ block: 'nearest' }); }, sel); await sleep(250); };
      const works = () => page.eval((id) => JSON.parse(JSON.stringify((window.__hd.state.works || {})[id] || [])), regionId);
      await page.eval(() => { window.__hd.hideDev(true); window.__hd.state.settings.hints = false; window.__hd.grantGold(20000); }); // the ?dev=1 panel would sit over a phone's bottom sheet
      await page.eval((id, z) => window.__hd.flyToRegion(id, z, 300), regionId, mobile ? 14 : 18);
      await sleep(1400);
      const pos = await page.eval((id) => window.__hd.regionScreenPos(id), regionId);
      await tap(pos.x, pos.y);
      ok(await waitFor(() => { const w = document.querySelector('.works-panel'); return !!w && !w.hidden && w.getClientRects().length > 0; }, 4000), 'an owned region\'s card has the Works panel');
      ok(await page.eval(() => document.querySelectorAll('.works-panel:not(.is-forts) .works-slot').length === 3), 'three slots, always (built, empty or locked)');
      await scrollTo('.works-build');
      await clickReal('.works-build', null, 'Build... (empty slot)');
      ok(await waitFor(() => document.querySelectorAll('.works-choice').length >= 5, 2000), 'the chooser lists the five Works');
      const goldBefore = await page.eval(() => window.__hd.state.gold);
      await scrollTo('.works-choice');
      await clickReal('.works-choice', 'Barracks', 'Barracks (chooser)');
      ok(await waitFor((id) => ((window.__hd.state.works || {})[id] || []).some((w) => w.type === 'barracks' && w.level === 1), 3000, regionId), 'Barracks I is built (state.works)');
      ok(await page.eval((g) => window.__hd.state.gold < g, goldBefore), 'it cost gold');
      ok(await waitFor(() => [...document.querySelectorAll('.toast')].some((t) => /barracks/i.test(t.textContent)), 2000), 'a toast says so');
      ok(await waitFor(() => !!document.querySelector('.works-upgrade'), 2000), 'the card shows the built row with an Upgrade button');
      await scrollTo('.works-upgrade:not([disabled])');
      await clickReal('.works-upgrade:not([disabled])', null, 'Upgrade (Barracks)');
      ok(await waitFor((id) => ((window.__hd.state.works || {})[id] || []).some((w) => w.type === 'barracks' && w.level === 2), 3000, regionId), 'Barracks II (upgrade)');
      ok(await waitFor((id) => { const raw = localStorage.getItem('hexdominion.v2'); const w = raw ? JSON.parse(raw).works : null; return !!w && Array.isArray(w[id]) && w[id].length > 0; }, 4000, regionId), 'the Works are in the save (localStorage)');
      // demolish: one tap only asks; Keep keeps it
      await scrollTo('.works-more');
      await clickReal('.works-more', null, 'Works "..." (demolish)');
      ok(await waitFor(() => !!document.querySelector('.works-keep') && document.querySelector('.works-keep').getClientRects().length > 0, 1500), 'a single tap opens a confirm (Keep / Demolish), nothing is destroyed yet');
      ok((await works()).length === 1, 'still built while the confirm is open');
      await clickReal('.works-keep', null, 'Keep');
      ok(await waitFor(() => !document.querySelector('.works-keep') || document.querySelector('.works-keep').getClientRects().length === 0, 1500), 'Keep closes the confirm');
      ok((await works()).length === 1, 'Keep keeps the Work');
      const g1 = await page.eval(() => window.__hd.state.gold);
      await scrollTo('.works-more');
      await clickReal('.works-more', null, 'Works "..." (demolish again)');
      await sleep(300);
      await clickReal('.works-demolish', null, 'Demolish');
      ok(await waitFor((id) => ((window.__hd.state.works || {})[id] || []).length === 0, 3000, regionId), 'Demolish removes it');
      ok(await page.eval((g) => window.__hd.state.gold > g, g1), 'and refunds gold');
      // 6d. Fortifications (DESIGN 10.3), the same panel and flow, real input: Build..., the Arrow Tower, it is in state.forts
      ok(await waitFor(() => { const f = document.querySelector('.works-panel.is-forts'); return !!f && !f.hidden && f.getClientRects().length > 0; }, 3000), 'the owned card also has the Fortifications panel');
      await scrollTo('.works-panel.is-forts .works-build');
      await clickReal('.works-panel.is-forts .works-build', null, 'Build... (Fortifications)');
      ok(await waitFor(() => document.querySelectorAll('.works-panel.is-forts .works-choice').length >= 4, 2000), 'the chooser lists the four fortifications');
      await scrollTo('.works-panel.is-forts .works-choice');
      await clickReal('.works-panel.is-forts .works-choice', 'Arrow Tower', 'Arrow Tower (chooser)');
      ok(await waitFor((id) => ((window.__hd.state.forts || {})[id] || []).some((f) => f.type === 'tower' && f.level === 1), 3000, regionId), 'an Arrow Tower is built (state.forts)');
      ok(await waitFor((id) => { const raw = localStorage.getItem('hexdominion.v2'); const f = raw ? JSON.parse(raw).forts : null; return !!f && Array.isArray(f[id]) && f[id].length > 0; }, 4000, regionId), 'the fortifications are in the save');
    }
    // 7. persistence -----------------------------------------------------------------------------
    // Prosperity: two and a half hours of tenure (dev hook) make level II, and the level is saved.
    const bakes0 = await page.eval(() => window.__hd.renderer.terrain.stats().bakes);
    await page.eval(() => window.__hd.advanceTenure(2.5));
    ok(await page.eval(() => { const h = window.__hd; return h.state.prosperity[h.world.startRegion] >= 2; }), 'two and a half hours of tenure give the home region prosperity level II');
    ok(await waitFor((n) => window.__hd.renderer.terrain.stats().bakes > n, 4000, bakes0), 'the map shows it: a level-up re-bakes the terrain chunks that hold the region');
    await hintCollect();
    await page.send('Page.navigate', { url: URL });
    ok(await waitFor(() => !!window.__hd && window.__hd.scene === 'title', 30000), 'reloads to the title');
    await hintInstall();
    ok(await page.eval(() => document.querySelector('.title-actions button')?.hidden === false), 'Continue is offered (a save exists)');
    await clickReal('.title-actions button', 'Continue', 'Continue (title)');
    ok(await waitFor(() => window.__hd.scene === 'world', 10000), 'Continue loads the saved realm');
    await page.eval(() => window.__hd.hideDev(true)); // the ?dev=1 panel comes back with every reload and sits over a phone's bottom sheet
    ok(await page.eval((id) => window.__hd.state.owner[id] === 0, regionId), 'the save persisted: the region is still ours after a reload');
    ok(await page.eval((id) => { const c = window.__hd.state.crowns[id]; return !!c && c.victory === true; }, regionId), "the save persisted the region's crowns");
    ok(await page.eval(() => { const h = window.__hd; return h.state.prosperity[h.world.startRegion] >= 2; }), 'the save persisted prosperity (home region still level II)');
    ok(await page.eval(() => window.__hd.renderer.ambient.stats().enabled), 'the ambient layer is on after the reload');
    ok(await page.eval(() => window.__hd.state.metFactions.length > 0), 'starting neighbours were marked as met silently (no late first-contact line)');

    // 8. an accepted surrender through a real click ---------------------------------------------------
    // A surrender is never offered before the first victory; afterwards it appears once the realm is strong
    // enough. If none is on offer yet, grow strong through the game's own upgrade table (dev-set levels).
    const findSurrender = () => page.eval(async () => {
      const { world, state, camera } = window.__hd;
      const { difficulty } = await import(new URL('game/meta/progression.js', document.baseURI).href);
      const ids = world.regions.filter((r) => state.owner[r.id] !== 0 && r.neighbors.some((n) => state.owner[n] === 0)).map((r) => r.id);
      const id = ids.find((i) => difficulty(state, world, i).surrender);
      if (id == null) return null;
      const keep = world.tiles[world.settlements[world.regions[id].keep].tile];
      const p = camera.worldToScreen(keep.x, keep.y);
      return { id, x: p.x, y: p.y + 6 };
    });
    let sur = await findSurrender();
    if (!sur) {
      await page.eval(async () => {
        const { UPGRADES } = await import(new URL('game/meta/upgrades.js', document.baseURI).href);
        for (const id of Object.keys(UPGRADES)) window.__hd.state.upgrades[id] = UPGRADES[id].max ?? 30;
      });
      await sleep(700);
      sur = await findSurrender();
    }
    if (sur && sur.x > 20 && sur.x < width - 20 && sur.y > 100 && sur.y < height - 20) {
      await tap(sur.x, sur.y);
      await sleep(1100);
      if (await page.eval(() => /surrender/i.test(document.querySelector('.region-card-action:not([hidden])')?.textContent || ''))) {
        await clickReal('.region-card-action', 'Surrender', 'Accept Surrender');
        ok(await waitFor((id) => window.__hd.state.owner[id] === 0, 6000, sur.id), 'accepting a surrender conquers the region');
        ok(await page.eval((id) => { const c = window.__hd.state.crowns[id]; return !!c && c.victory && !c.swift && !c.unbroken; }, sur.id), 'a surrender earns the Victory crown only');
        await sleep(2500);
      } else console.log('  note: the surrendering region was not selectable on screen; surrender path skipped');
    } else console.log('  note: no region offers a surrender right now; the real-click surrender path was not exercised');

    // 8b. welcome-back names the regions that prospered while the player was away ------------------------
    await page.eval(() => {
      const st = window.__hd.state;
      for (let i = 0; i < st.prosperity.length; i++) st.prosperity[i] = 0; // the levels at DEPARTURE
      st.lastSeen -= 3 * 3600 * 1000;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    ok(await waitFor(() => { const p = document.querySelector('.welcome-prospered'); return !!p && !p.hidden && /prospered while you were away/.test(p.textContent); }, 5000),
      'the welcome-back card names the regions that prospered while away');
    await clickReal('.welcome-collect', null, 'Collect', { stable: true }); // aimed once the card's pop (420 ms) has landed
    ok(await waitFor(() => document.querySelector('.welcome-card')?.closest('[hidden]') != null || document.querySelector('.welcome-card')?.offsetParent === null, 4000), 'Collect closes the welcome card');
    await sleep(800);

    // 9. settings: the music controls and the leader-voices toggle work through real input -----------------
    await page.eval(() => window.__hd.openSettings());
    await sleep(400);
    ok(await page.eval(() => !!document.querySelector('.settings-slider')), 'settings has the music volume slider');
    await page.eval(() => {
      const el = document.querySelector('.settings-slider');
      el.value = '70';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    ok(await page.eval(() => Math.abs(window.__hd.state.settings.musicVolume - 0.7) < 0.001 && Math.abs(window.__hd.music.getDebug().volume - 0.7) < 0.001),
      "the volume slider sets settings.musicVolume and the score's volume");
    const rowToggle = (label) => page.eval((l) => {
      const row = [...document.querySelectorAll('.settings-row')].find((r) => r.textContent.trim().startsWith(l));
      const b = row && row.querySelector('.settings-toggle');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, label);
    const lv = await rowToggle('Leader voices');
    ok(!!lv, 'the Leader voices toggle exists');
    if (lv) {
      await tap(lv.x, lv.y);
      ok(await page.eval(() => window.__hd.state.settings.leaderVoices === false), 'the Leader voices toggle turns voices off');
      await tap(lv.x, lv.y);
      ok(await page.eval(() => window.__hd.state.settings.leaderVoices === true), 'and back on');
    }

    // 10. front lines (DESIGN 4.4): in a battle with settlements the camp cannot reach, a drag held over one is GREY with the reason, and letting go is refused, shakes and explains ---
    {
      await clickReal('.settings-close', null, 'Settings (close)');
      await page.eval(() => { window.__hd.state.settings.hints = false; });
      await page.eval(() => window.__hd.conquerRegions(7));
      await sleep(1200);
      const pick = await page.eval(async () => {
        const hd = window.__hd;
        const prog = await import(new URL('game/meta/progression.js', document.baseURI).href);
        const { buildArena } = await import(new URL('game/battle/arena.js', document.baseURI).href);
        const sim = await import(new URL('game/battle/sim.js', document.baseURI).href);
        let best = null;
        for (const id of prog.frontier(hd.state, hd.world)) {
          const pl = prog.playerBattleStats(hd.state, hd.world, id);
          const en = prog.enemyBattleStats(hd.world, hd.state, id);
          const b = sim.createBattle(buildArena(hd.world, hd.state.owner, id, pl, en), pl, en);
          const camp = b.sites.find((x) => x.type === 'camp');
          const cut = b.sites.filter((x) => x.owner !== 0 && !b.sites.some((o) => o.owner === 0 && sim.canRoute(b, 0, o.id, x.id))).length;
          if (!best || cut > best.cut) best = { id, cut };
        }
        return best;
      });
      ok(!!pick && pick.cut > 0, `a frontier battle with cut-off settlements exists (${pick && pick.cut} cut off)`);
      if (pick && pick.cut > 0) {
        await page.eval((id) => window.__hd.startBattle(id), pick.id);
        ok(await waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 25000), 'the battle goes live');
        await sleep(900);
        const cut = await page.eval(() => import(new URL('game/battle/sim.js', document.baseURI).href).then((m) => {
          const hd = window.__hd;
          const info = hd.siteInfo();
          const mine = info.filter((x) => x.owner === 0);
          const camp = info.find((x) => x.type === 'camp');
          const onScreen = (x) => x.y > 100 && x.y < innerHeight - 170 && x.x > 10 && x.x < innerWidth - 10;
          return { camp, site: info.find((x) => x.owner !== 0 && onScreen(x) && !mine.some((o) => m.canRoute(hd.battle, 0, o.id, x.id))) || null };
        }));
        ok(!!cut.site, 'a cut-off settlement is on screen');
        if (cut.site) {
          let held = null;
          await dragTo({ x: cut.camp.x, y: cut.camp.y + 4 }, { x: cut.site.x, y: cut.site.y + 4 }, async () => {
            held = await page.eval(() => ({ info: window.__hd.dragInfo(), tip: document.querySelector('.tooltip')?.textContent || '' }));
          });
          const under = held && held.info ? '' : await page.eval((x, y) => { const e = document.elementFromPoint(x, y); return `${e && e.tagName}.${e && e.className} toasts=${[...document.querySelectorAll('.toast')].map((n) => n.textContent.slice(0, 30)).join('|')}`; }, cut.camp.x, cut.camp.y + 4);
          ok(!!held && !!held.info && held.info.outcome === 'noRoute' && held.info.color === DRAG_ARROW.blocked, `the drag arrow is GREY while held over a settlement with no route (${JSON.stringify(held && held.info)} camp ${Math.round(cut.camp.x)},${Math.round(cut.camp.y)} ${under})`);
          ok(!!held && held.tip === NO_ROUTE_TEXT, `the tooltip says why ("${held && held.tip}")`);
          ok(await waitFor((id) => window.__hd.supplyInfo().refused === id, 1500, cut.site.id), 'letting go there is refused (the target shakes)');
          ok(await waitFor((t) => { const e = document.querySelector('.tooltip'); return !!e && !e.hidden && e.textContent === t; }, 1500, NO_ROUTE_TEXT), 'and the tooltip explains it over the target');
          ok(await page.eval(() => window.__hd.battle.stats.sent === 0), 'nothing was sent');
        }
      }
    }
  } catch (err) {
    ok(false, `unexpected error: ${err && err.message}`);
  } finally {
    allErrors.push(...errors.map((e) => `[${name}] ${e}`));
    await hintCollect();
    ok(hintProblems.length === 0, `every hint was placed by the PLAYFEEL §4 rules (pointer within 8 px of its target, never covering it, on screen, hidden while the target is off screen or covered; ${hintFrames} hint frames measured)${hintProblems.length ? `: ${hintProblems.slice(0, 4).join(' | ')}` : ''}`);
    ok(iconProblems.length === 0, `every icon-only button has its icon centred (within 1 px) and sits inside its bar (${iconSeen.size} measured)${iconProblems.length ? `: ${iconProblems.slice(0, 4).join(' | ')}` : ''}`);
    ok(errors.length === 0, `no console errors in the whole ${name} run${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
    await page.close();
  }
}

/** The deployed shape: assets, worker, manifest, classic.html and an offline reload, all under the subpath. */
async function deployChecks() {
  console.log(`\n== deploy: served under ${SUBPATH}/ (nothing at /) ==`);
  ok((await httpGet(`${ORIGIN}/`)).status === 404, 'nothing is served at / (like a Pages project site)');
  const bare = await httpGet(`${ORIGIN}${SUBPATH}`);
  ok(bare.status === 301 && bare.headers.location === `${SUBPATH}/`, `${SUBPATH} redirects to ${SUBPATH}/`);

  const page = await launch({ url: 'about:blank', width: 1440, height: 900 });
  const requestUrls = new Map();
  let responses = [];
  let failed = [];
  const errors = [];
  page.on((method, params) => {
    if (method === 'Network.requestWillBeSent') requestUrls.set(params.requestId, params.request.url);
    else if (method === 'Network.responseReceived') responses.push({ url: params.response.url, status: params.response.status, mime: params.response.mimeType });
    else if (method === 'Network.loadingFailed' && !params.canceled) failed.push({ url: requestUrls.get(params.requestId), error: params.errorText });
    else if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text);
    else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') errors.push(params.args.map((x) => x.value ?? x.description).join(' '));
  });
  await page.send('Network.enable');
  const waitFor = async (fn, timeout = 20000, ...args) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (await page.eval(fn, ...args)) return true; } catch { /* navigating */ }
      await sleep(100);
    }
    return false;
  };
  const same = (r) => r.url.startsWith(ORIGIN);
  const pathOf = (u) => new globalThis.URL(u).pathname;

  try {
    // 1. the bare project URL (what a visitor types), first visit -------------------------------------------
    const START = `${BASE}/?dev=1&seed=7&sw=1`;
    await page.goto(START);
    ok(await waitFor(() => !!window.__hd && window.__hd.scene === 'title', 30000), 'the game boots from the bare project URL');
    await sleep(2500);
    const mine = responses.filter(same);
    const bad = mine.filter((r) => r.status >= 400);
    ok(mine.length >= 60, `the first load used ${mine.length} same-origin files (modules, styles, icons)`);
    ok(bad.length === 0, `every same-origin file resolves${bad.length ? `; failing: ${bad.slice(0, 3).map((r) => `${r.status} ${pathOf(r.url)}`).join(', ')}` : ''}`);
    ok(mine.every((r) => pathOf(r.url).startsWith(`${SUBPATH}/`)), `every request stays under ${SUBPATH}/ (no absolute paths)`);
    ok(failed.filter((x) => x.url && x.url.startsWith(ORIGIN)).length === 0, 'no same-origin request failed at the network level');
    const badType = mine.filter((r) => (/\.js$/.test(pathOf(r.url)) && !/javascript/.test(r.mime)) || (/\.css$/.test(pathOf(r.url)) && r.mime !== 'text/css'));
    ok(badType.length === 0, `scripts are text/javascript and styles are text/css${badType.length ? `; wrong: ${pathOf(badType[0].url)} is ${badType[0].mime}` : ''}`);
    for (const p of ['game/main.js', 'game/styles/main.css', 'game/app/app.css', 'favicon.svg']) {
      ok(mine.some((r) => pathOf(r.url) === `${SUBPATH}/${p}` && r.status === 200), `${p} was fetched and returned 200`);
    }
    const fonts = responses.filter((r) => /fonts\.(googleapis|gstatic)\.com/.test(r.url));
    console.log(`  note: ${fonts.length} Google Fonts responses (external: ${fonts.some((r) => r.status === 200) ? 'reachable' : 'unreachable from here, the system serif is the fallback'})`);
    ok(errors.length === 0, `no console errors on the first load${errors.length ? `: ${errors[0]}` : ''}`);

    // 2. the worker -------------------------------------------------------------------------------------------
    ok(await waitFor(async () => !!(await navigator.serviceWorker.getRegistration())?.active, 20000), 'the service worker registered and activated');
    const reg = await page.eval(async () => {
      const r = await navigator.serviceWorker.ready;
      return { scope: r.scope, script: r.active.scriptURL, state: r.active.state };
    });
    ok(reg.scope === `${ORIGIN}${SUBPATH}/`, `the worker's scope is the subpath (${reg.scope})`);
    ok(reg.script === `${ORIGIN}${SUBPATH}/sw.js`, `the worker script is ${SUBPATH}/sw.js`);
    const expected = [...new Set(mine.filter((r) => r.status === 200 && !/\/sw\.js$/.test(pathOf(r.url))).map((r) => pathOf(r.url)))];
    ok(await waitFor(async (n) => {
      const c = await caches.open((await caches.keys())[0]);
      return (await c.keys()).length >= n;
    }, 15000, Math.floor(expected.length * 0.95)), 'the page handed the worker its file list and it filled the cache (first visit, before any reload)');
    const cached = await page.eval(async () => {
      const names = await caches.keys();
      const c = await caches.open(names[0]);
      return { names, urls: (await c.keys()).map((r) => new URL(r.url).pathname + (new URL(r.url).origin === location.origin ? '' : ' (external)')) };
    });
    ok(cached.names.length === 1 && /^hexdominion-v2/.test(cached.names[0]), `exactly one cache, ${cached.names.join(', ')}`);
    const internal = cached.urls.filter((u) => !u.endsWith('(external)'));
    ok(internal.every((u) => u.startsWith(`${SUBPATH}/`)), `everything cached lives under ${SUBPATH}/`);
    const missing = expected.filter((p) => !internal.includes(p));
    ok(missing.length === 0, `every file the first load used is cached${missing.length ? ` (missing ${missing.length}: ${missing.slice(0, 3).join(', ')})` : ` (${expected.length} files)`}`);
    ok(internal.includes(`${SUBPATH}/`) || internal.some((u) => u.endsWith('index.html')), 'the page itself is cached');

    // the worker's fallbacks, FOR REAL (the server's test hooks): a 5xx and a captive portal's HTML 200 serve the CACHED file, and the bad answers are never cached
    const fall = await page.eval(async (base) => {
      const real = await (await fetch(`${base}/game/main.js`)).text();
      const r503 = await fetch(`${base}/game/main.js?__respond=503`);
      const t503 = await r503.text();
      const rp = await fetch(`${base}/game/main.js?__portal=1`);
      const tp = await rp.text();
      const name = (await caches.keys()).find((k) => /^hexdominion-/.test(k));
      const keys = (await (await caches.open(name)).keys()).map((q) => q.url);
      return { s503: r503.status, same503: t503 === real, sp: rp.status, ctp: rp.headers.get('content-type'), samep: tp === real, poisoned: keys.some((u) => /__portal|__respond/.test(u)) };
    }, BASE);
    ok(fall.s503 === 200 && fall.same503, 'a 503 from the server serves the CACHED copy of the file, not the error page');
    ok(fall.sp === 200 && /javascript/.test(fall.ctp || '') && fall.samep, 'a captive portal answering a .js request with HTML (200) serves the cached script');
    ok(!fall.poisoned, 'and neither bad answer was put in the cache');
    // ka1e27.github.io is ONE origin for every GitHub Pages project: a fresh worker activation deletes only OLD hexdominion-* caches
    await page.eval(async () => {
      await (await caches.open('other-app-v1')).put('/x', new Response('hello'));
      await (await caches.open('hexdominion-v1')).put('/y', new Response('old'));
      const r = await navigator.serviceWorker.ready;
      await r.unregister();
    });
    await page.send('Page.navigate', { url: START });
    ok(await waitFor(async () => { const names = await caches.keys(); return !!(await navigator.serviceWorker.getRegistration()) && names.includes('other-app-v1') && !names.includes('hexdominion-v1') && names.some((n) => /^hexdominion-v2/.test(n)); }, 25000),
      'a fresh worker activation deletes the OLD hexdominion-* cache and leaves the cache of ANOTHER app alone');
    await sleep(800);
    await page.eval(async () => { await caches.delete('other-app-v1'); });

    // 3. manifest -----------------------------------------------------------------------------------------------
    const man = await page.eval(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      const url = new URL(link.getAttribute('href'), location.href).href;
      const res = await fetch(url);
      const json = await res.json();
      const check = async (src) => {
        const u = new URL(src, url).href;
        const r = await fetch(u);
        let w = 0;
        if (r.ok && /png/.test(r.headers.get('content-type') || '')) w = (await createImageBitmap(await r.blob())).width;
        return { path: new URL(u).pathname, ok: r.ok, type: r.headers.get('content-type'), w };
      };
      return {
        url, ctype: res.headers.get('content-type'), start: new URL(json.start_url, url).pathname, scope: new URL(json.scope, url).pathname,
        icons: await Promise.all(json.icons.map(async (i) => ({ sizes: i.sizes, ...(await check(i.src)) }))),
        start_ok: (await fetch(new URL(json.start_url, url).href)).ok,
      };
    });
    ok(/manifest\+json/.test(man.ctype), `the manifest is served as ${man.ctype}`);
    ok(man.start === `${SUBPATH}/` && man.start_ok, `start_url resolves to ${man.start} (200)`);
    ok(man.scope === `${SUBPATH}/`, `scope resolves to ${man.scope}`);
    ok(man.icons.every((i) => i.ok), `every manifest icon resolves (${man.icons.map((i) => i.path.split('/').pop()).join(', ')})`);
    ok(man.icons.filter((i) => /png/.test(i.type || '')).every((i) => `${i.w}x${i.w}` === i.sizes), 'the PNG icons are the size the manifest declares');

    // 4. OFFLINE straight after the FIRST visit (no online reload in between) ----------------------------------
    ok(await page.eval(() => !!navigator.serviceWorker.controller), 'the worker already controls the first page (clients.claim)');
    // Really offline: STOP THE SERVER. (CDP's offline emulation only covers the page, not the worker's own fetch, so it
    // would pass even with a worker that cached nothing.)
    stopServer();
    await sleep(600);
    ok(await httpGet(`${BASE}/`).then(() => false, () => true), 'the server is gone: the network really is down');
    responses = []; failed = [];
    await page.send('Page.navigate', { url: START });
    ok(await waitFor(() => !!window.__hd && window.__hd.scene === 'title', 30000), 'OFFLINE: a reload boots the game from the cache');
    ok(await waitFor(() => !document.getElementById('boot'), 6000), 'OFFLINE: the boot splash cleared');
    ok(await page.eval(() => !!navigator.serviceWorker.controller), 'OFFLINE: the worker is in control of the page');
    const offlineBad = responses.filter(same).filter((r) => r.status >= 400);
    ok(offlineBad.length === 0, `OFFLINE: no same-origin file failed${offlineBad.length ? ` (${pathOf(offlineBad[0].url)})` : ''}`);
    await sleep(1500);
    const btn = await page.eval(() => {
      const b = [...document.querySelectorAll('.title-actions button')].find((x) => /new realm|continue/i.test(x.textContent) && x.getClientRects().length > 0);
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse('mouseMoved', btn.x, btn.y, 'none', 0);
    await page.mouse('mousePressed', btn.x, btn.y, 'left', 1);
    await page.mouse('mouseReleased', btn.x, btn.y, 'left', 0);
    ok(await waitFor(() => window.__hd.scene === 'world', 12000), 'OFFLINE: New Realm enters the world');
    await startServer();
    await page.send('Page.navigate', { url: START });
    ok(await waitFor(() => !!window.__hd && window.__hd.scene === 'title', 30000), 'back online: a further visit boots');
    ok(await waitFor(() => !!navigator.serviceWorker.controller, 8000), 'the worker controls it');

    // 5. classic.html (the v1 game) ----------------------------------------------------------------------------
    responses = []; failed = []; errors.length = 0;
    await page.goto(`${BASE}/classic.html`);
    // The v1 game boots straight into a battle: its HUD is built and its two board canvases are sized.
    ok(await waitFor(() => { const h = document.getElementById('hud'); const c = document.getElementById('board-bg'); return !!h && h.innerHTML.length > 1000 && !!c && c.width > 100; }, 20000), 'classic.html boots the v1 game (HUD built, board canvas sized)');
    await sleep(1500);
    const classicBad = responses.filter(same).filter((r) => r.status >= 400);
    ok(classicBad.length === 0, `classic.html: every file resolves (${responses.filter(same).length} files)${classicBad.length ? `; failing: ${pathOf(classicBad[0].url)}` : ''}`);
    ok(errors.length === 0, `classic.html: no console errors${errors.length ? `: ${errors[0]}` : ''}`);
  } catch (err) {
    ok(false, `unexpected error in the deploy checks: ${err && err.message}`);
  } finally {
    allErrors.push(...errors.map((e) => `[deploy] ${e}`));
    await page.close();
  }
}

const watchdog = setTimeout(() => {
  console.error('\ncheck.mjs: overall timeout');
  process.exit(1);
}, (SUBPATH ? 20 : 60) * 60 * 1000); // the main flow grew (supply lines, Works, front lines, robustness, keepsakes; Phase 15 added the text audit and the
// layout-shift guard): it passed 32 min on a loaded machine and about 30 on the CI runner. A GitHub job may run 6 h; 60 leaves room without hiding a hang
// (tools/cdp.js bounds Page.navigate at 45 s).

// --only=desktop|phone|robust|keepsakes|playtest|frontier|generals|variety|goals|phase5|phase6|phase7|phase12|phase13|codex|toplane|challenges|options|textaudit|deploy runs one section (a,b runs several) (--shots=<dir> keeps the playtest screenshots). The robustness and keepsake scenarios (tools/robustChecks.mjs, tools/keepsakeChecks.mjs) run in the
// plain mode only: they do not depend on the deployed shape, so --base=... runs the two variants and the deploy checks.
const only = flags.only;
const wants = (name) => !only || String(only).split(',').includes(name); // --only=a,b runs several
// Phase 8: index.html's modulepreload block must list exactly the boot's module graph (tools/modulepreload.mjs writes it)
{
  const { execFileSync } = await import('node:child_process');
  let fresh = true;
  try { execFileSync(process.execPath, ['tools/modulepreload.mjs', '--check'], { cwd: new globalThis.URL('..', import.meta.url), stdio: 'pipe' }); } catch { fresh = false; }
  ok(fresh, 'index.html: the modulepreload block matches the boot module graph (node tools/modulepreload.mjs)');
}
/** Runs one section and then asserts the layout-shift guard over every page it opened. */
async function section(name, fn) {
  currentSection = name;
  const from = shiftLog.length;
  await fn();
  const mine = shiftLog.slice(from).filter((v) => v.section === name);
  const seen = new Set();
  const lines = mine.map((v) => `${v.kind}: ${v.el}${v.d != null ? ` by ${v.d} px (${v.dx}, ${v.dy})` : ''} after ${v.ms} ms at ${v.at}`).filter((l) => !seen.has(l) && seen.add(l));
  ok(mine.length === 0, `[${name}] layout-shift guard: no interactive element moved more than 2 px, hid or vanished under a press${mine.length ? ` (${mine.length}): ${lines.slice(0, 4).join(' | ')}` : ''}`);
}
if (wants('desktop')) await section('desktop', () => variant('desktop', { width: 1440, height: 900, mobile: false }));
if (wants('phone')) await section('phone', () => variant('phone', { width: 390, height: 844, mobile: true }));
if (!SUBPATH && wants('robust')) await section('robust', () => robustChecks({ launch, BASE, ok, sleep, allErrors }));
if (!SUBPATH && wants('keepsakes')) await section('keepsakes', () => keepsakeChecks({ launch, BASE, ok, sleep, allErrors }));
if (!SUBPATH && wants('playtest')) await section('playtest', () => playtestChecks({ launch, BASE, ok, sleep, allErrors, shotsDir: flags.shots || null }));
if (!SUBPATH && wants('frontier')) await section('frontier', () => frontierChecks({ launch, BASE, ok, sleep, allErrors }));
if (!SUBPATH && wants('generals')) await section('generals', () => generalsChecks({ launch, BASE, ok, sleep, allErrors }));
if (!SUBPATH && wants('variety')) await section('variety', () => varietyChecks({ launch, BASE, ok, sleep, allErrors }));
if (!SUBPATH && wants('goals')) await section('goals', () => goalsChecks({ launch, BASE, ok, sleep, allErrors }));
if (!SUBPATH && wants('phase5')) await section('phase5', () => phase5Checks({ launch, BASE, ok, sleep, allErrors }));
if (!SUBPATH && wants('phase6')) await section('phase6', () => phase6Checks({ launch, BASE, ok, sleep, allErrors }));
if (!SUBPATH && wants('phase7')) await section('phase7', () => phase7Checks({ launch, BASE, ok, sleep, allErrors }));
if (!SUBPATH && wants('phase12')) await section('phase12', () => phase12Checks({ launch, BASE, ok, sleep, allErrors }));
if (!SUBPATH && wants('phase13')) await section('phase13', () => phase13Checks({ launch, BASE, ok, sleep, allErrors }));
if (!SUBPATH && wants('codex')) await section('codex', () => codexChecks({ launch, BASE, ok, sleep, allErrors }));
if (!SUBPATH && wants('toplane')) await section('toplane', () => topLaneChecks({ launch, BASE, ok, sleep, allErrors }));
if (!SUBPATH && wants('challenges')) await section('challenges', () => challengeChecks({ launch, BASE, ok, sleep, allErrors }));
if (!SUBPATH && wants('options')) await section('options', () => optionsChecks({ launch, BASE, ok, sleep, allErrors }));
if (!SUBPATH && wants('textaudit')) await section('textaudit', () => textAuditChecks({ launch, BASE, ok, sleep, allErrors }));
if (SUBPATH && wants('deploy')) await section('deploy', () => deployChecks());
clearTimeout(watchdog);
stopServer();

if (allErrors.length) console.log(`\nconsole errors:\n${allErrors.slice(0, 8).map((e) => `  ${String(e).slice(0, 400)}`).join('\n')}`);
console.log(failures || allErrors.length ? `\nFAILED (${failures} failed checks, ${allErrors.length} console errors)` : '\nALL CHECKS PASSED');
process.exit(failures || allErrors.length ? 1 : 0);
