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
import { DRAG_ARROW } from '../game/scenes/timing.js';

if (!process.env.CHROME_PATH && process.platform === 'win32') {
  process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
}
const { launch } = await import('./cdp.js');

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
  const args = ['tools/serve.js', `--base=${SUBPATH}/`, `--port=${SERVER_PORT}`];
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
  /** A real press whose pointerdown and pointerup are `holdMs` apart, with `during()` run between them. */
  const slowPress = async (x, y, holdMs, during) => {
    if (mobile) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await sleep(holdMs * 0.3);
      if (during) await during();
      await sleep(holdMs * 0.7);
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse('mouseMoved', x, y, 'none', 0);
      await sleep(30);
      await page.mouse('mousePressed', x, y, 'left', 1);
      await sleep(holdMs * 0.3);
      if (during) await during();
      await sleep(holdMs * 0.7);
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
      for (let i = 1; i <= 14; i++) {
        await page.send('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 14, y: a.y + ((b.y - a.y) * i) / 14, id: 1 }],
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
  const clickReal = async (sel, txt, label) => {
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
    ok(await waitFor(() => { const m = window.__hd.music.getDebug(); return m.started && m.activeVoices > 0 && m.errors === 0; }, 8000),
      'the first click unlocked audio and the music is playing (voices > 0, no errors)');

    // 3. select the first frontier region by clicking its keep ---------------------------------
    const frontierTarget = () => page.eval(async () => {
      const { world, state, camera } = window.__hd;
      const { difficulty } = await import(new URL('game/meta/progression.js', document.baseURI).href);
      const ids = world.regions.filter((r) => state.owner[r.id] !== 0 && r.neighbors.some((n) => state.owner[n] === 0)).map((r) => r.id);
      const id = ids.find((i) => !difficulty(state, world, i).surrender) ?? ids[0];
      const keep = world.tiles[world.settlements[world.regions[id].keep].tile];
      const p = camera.worldToScreen(keep.x, keep.y);
      return { id, name: world.regions[id].name, x: p.x, y: p.y + 6 };
    });
    const target = await frontierTarget();
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
      // the Attack hint's bubble hangs clear of the card's bottom edge instead of overlapping its padding (when the hint is up)
      ok(await page.eval(() => { const b = document.querySelector('.coach:not([hidden]) .coach-bubble'); const card = document.querySelector('.region-card'); if (!b || !card) return true; return b.getBoundingClientRect().top >= card.getBoundingClientRect().bottom + 4; }),
        'the Attack hint bubble clears the region card edge');
      ok(await page.eval((p) => (document.querySelector('.region-card')?.textContent || '').includes('Crowns: +' + p + '% bounty each'), await crownPct()),
        'the desktop card label quotes the crown bonus from config (BOUNTY_FRACTION_PER_CROWN)');
    }

    await pressAudit('.hud-btn[aria-label="War Council"]', 'HUD War Council');

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
    await clickReal('.intel-scout-btn', null, 'Scout');
    ok(await waitFor((id) => window.__hd.state.intel[id]?.scouted === true, 4000, target.id), 'a real click on Scout records the scouting');
    ok(await waitFor(() => document.querySelectorAll('.intel-chip').length >= 2, 4000), 'the scouted card reveals the garrison chips');
    await sleep(700);
    await scrollTo('.intel-sabotage-btn');
    await clickReal('.intel-sabotage-btn', null, 'Sabotage (1st)');
    ok(await waitFor((id) => window.__hd.state.intel[id]?.sabotage === 1, 4000, target.id), 'the first Sabotage step lands (level 1)');
    await sleep(900);
    await scrollTo('.intel-sabotage-btn');
    await clickReal('.intel-sabotage-btn', null, 'Sabotage (2nd)');
    ok(await waitFor((id) => window.__hd.state.intel[id]?.sabotage === 2, 4000, target.id), 'the second Sabotage step lands (maxed at level 2)');
    ok(await waitFor(() => { const b = document.querySelector('.intel-sabotage-btn'); return !!b && b.disabled && /already weakened/i.test(b.textContent); }, 3000),
      'the Sabotage button is disabled and says the garrisons are already weakened');
    ok(await page.eval(() => { const d = document.querySelector('.hd-dock'); return d.getBoundingClientRect().height <= innerHeight * 0.63; }), 'the card stays within its height cap (the sheet scrolls beyond it)');
    await sleep(600);

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
    ok(await waitFor(() => window.__hd.battle.stats.sent > 0, 6000), 'a real drag from the War Camp sends troops (battle.stats.sent > 0)');
    ok(await waitFor(() => window.__hd.battle.squads.length > 0, 4000), 'a squad is marching');

    // 5b. reload MID-battle: the fight resumes from the save ----------------------------------
    const before = await page.eval(() => ({ sent: window.__hd.battle.stats.sent, t: window.__hd.battle.t, sites: window.__hd.battle.sites.length }));
    await page.send('Page.navigate', { url: URL });
    ok(await waitFor(() => !!window.__hd && window.__hd.scene === 'title', 30000), 'reload mid-battle: back at the title');
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
    ok(await page.eval(() => [...document.querySelectorAll('.toast')].filter((t) => /→ level/.test(t.textContent)).length === 1),
      'a spree of purchases is ONE toast (updated in place), not a pile');
    await clickReal('.council-tab', 'Realm', 'Realm tab');
    await sleep(300);
    ok(await page.eval(async () => {
      const { ECONOMY } = await import(new URL('game/config/meta.js', document.baseURI).href);
      const card = [...document.querySelectorAll('.upgrade-card')].find((x) => /treasury/i.test(x.querySelector('.upgrade-card-name')?.textContent || ''));
      return !!card && card.textContent.includes(`${ECONOMY.offlineCapHours} h offline cap`);
    }), 'the Treasury line quotes the offline cap from config (ECONOMY.offlineCapHours), not a typed base');
    await clickReal('.council-close', null, 'War Council (close)');
    await sleep(500);

    // 7. persistence -----------------------------------------------------------------------------
    // Prosperity: two and a half hours of tenure (dev hook) make level II, and the level is saved.
    const bakes0 = await page.eval(() => window.__hd.renderer.terrain.stats().bakes);
    await page.eval(() => window.__hd.advanceTenure(2.5));
    ok(await page.eval(() => { const h = window.__hd; return h.state.prosperity[h.world.startRegion] >= 2; }), 'two and a half hours of tenure give the home region prosperity level II');
    ok(await waitFor((n) => window.__hd.renderer.terrain.stats().bakes > n, 4000, bakes0), 'the map shows it: a level-up re-bakes the terrain chunks that hold the region');
    await page.send('Page.navigate', { url: URL });
    ok(await waitFor(() => !!window.__hd && window.__hd.scene === 'title', 30000), 'reloads to the title');
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
    await clickReal('.welcome-collect', null, 'Collect');
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
  } catch (err) {
    ok(false, `unexpected error: ${err && err.message}`);
  } finally {
    allErrors.push(...errors.map((e) => `[${name}] ${e}`));
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
}, (SUBPATH ? 9 : 6) * 60 * 1000);

if (flags.only !== 'phone') await variant('desktop', { width: 1440, height: 900, mobile: false });
if (flags.only !== 'desktop') await variant('phone', { width: 390, height: 844, mobile: true });
if (SUBPATH) await deployChecks();
clearTimeout(watchdog);
stopServer();

console.log(failures || allErrors.length ? `\nFAILED (${failures} failed checks, ${allErrors.length} console errors)` : '\nALL CHECKS PASSED');
process.exit(failures || allErrors.length ? 1 : 0);
