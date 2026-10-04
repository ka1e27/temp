// Tutorial hint placement, measured with REAL input at seven viewports (PLAYFEEL §4 "Hint placement rules").
//
//   npm start                                   # in another terminal
//   node tools/hints.mjs [--only=1440x900,390x844] [--tag=after] [--seed=7] [--url=http://localhost:8080] [--out=screenshots/game] [--no-shots]
//
// For each viewport it opens a fresh profile (hints on), plays the tutorial with real mouse or touch input (pan and zoom, region click, Attack, a drag from the
// War Camp, send size, selection, Rally, pause and speed, Firestorm, the council, scouting, ...: it does what each hint asks) and, after EVERY frame,
// tools/hintMonitor.js measures the visible hint: the pointer tip within 8 px of its target's box, the bubble never covering the target, fully on screen,
// hidden while the target is off screen or under a panel, one hint at a time. It saves one screenshot per distinct hint and prints a table; any
// violation makes the run exit 1 (use --tag=before to record a run against an older build without failing).
import { mkdir } from 'node:fs/promises';

if (!process.env.CHROME_PATH && process.platform === 'win32') process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch: rawLaunch } = await import('./cdp.js');
// Phase 7: the Relic claim moment and the Boon draft that follow a win would stand in front of every older check's "Continue -> back on the map"; under
// these tools an offer waits on the HUD chip instead (app/boons.js reads this flag in ?dev=1 only). tools/phase7Checks.mjs turns the moments back on.
const launch = async (opts) => {
  const page = await rawLaunch(opts);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__HD_TEST_NO_BOON_MOMENTS = true;' });
  return page;
};

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.join('=') || 'true'];
}));
const BASE = flags.url || 'http://localhost:8080';
const SEED = flags.seed || '7';
const TAG = flags.tag || 'run';
const OUT = flags.out || 'screenshots/game';
const SHOTS = flags['no-shots'] !== 'true';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = [
  { name: '1280x720', w: 1280, h: 720, touch: false },
  { name: '1440x900', w: 1440, h: 900, touch: false },
  { name: '1920x1080', w: 1920, h: 1080, touch: false },
  { name: '1339x863', w: 1339, h: 863, touch: false }, // the in-app pane
  { name: '390x844', w: 390, h: 844, touch: true },
  { name: '844x390', w: 844, h: 390, touch: true },
  { name: '768x1024', w: 768, h: 1024, touch: true },
];
const only = flags.only ? flags.only.split(',') : null;

async function runViewport(vp) {
  const { w: W, h: H, touch } = vp;
  console.log(`\n=== ${vp.name} ${touch ? 'touch' : 'mouse'} ===`);
  const page = await launch({ url: 'about:blank', width: W, height: H });
  const errors = [];
  page.on((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
    else if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push(p.args.map((a) => a.value ?? a.description).join(' '));
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: touch });
  if (touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  // ---- real input ---------------------------------------------------------------------------------------------------------------
  const tap = async (x, y) => {
    if (touch) {
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
  const drag = async (a, b, steps = 14) => {
    if (touch) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
      for (let i = 1; i <= steps; i++) {
        await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps, id: 1 }] });
        await sleep(16);
      }
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.drag(a, b, steps);
    }
  };
  // a supply-line gesture: Ctrl-drag with the mouse, a long press then a drag with a finger
  const supplyDrag = async (a, b, steps = 14) => {
    if (touch) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
      await sleep(650);
      for (let i = 1; i <= steps; i++) {
        await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps, id: 1 }] });
        await sleep(16);
      }
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      const m = 2; // Ctrl
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y, button: 'none', buttons: 0, modifiers: m });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1, modifiers: m });
      for (let i = 1; i <= steps; i++) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps, button: 'left', buttons: 1, modifiers: m });
        await sleep(16);
      }
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1, modifiers: m });
    }
  };
  const zoomBy = async (x, y, dir) => {
    if (touch) {
      const s0 = 60;
      const s1 = dir > 0 ? 130 : 30;
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - s0, y, id: 1 }, { x: x + s0, y, id: 2 }] });
      for (let i = 1; i <= 10; i++) {
        const s = s0 + ((s1 - s0) * i) / 10;
        await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - s, y, id: 1 }, { x: x + s, y, id: 2 }] });
        await sleep(16);
      }
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      for (let i = 0; i < 4; i++) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dir > 0 ? -120 : 120 });
        await sleep(60);
      }
    }
  };
  const key = async (k, code, vk) => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };
  const ev = (fn, ...args) => page.eval(fn, ...args);
  const centerOf = (selector, text) => ev((s, t) => {
    const els = [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length > 0 && !e.closest('[hidden]'));
    const el = t ? els.find((e) => e.textContent.toLowerCase().includes(t.toLowerCase())) : els[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector, text);
  const click = async (selector, text) => { const c = await centerOf(selector, text); if (c) await tap(c.x, c.y); return !!c; };

  // ---- boot ---------------------------------------------------------------------------------------------------------------------
  await page.goto(`${BASE}/index.html?dev=1&seed=${SEED}`);
  for (let i = 0; i < 150; i++) { if (await ev(() => !!window.__hd && window.__hd.scene === 'title').catch(() => false)) break; await sleep(100); }
  await ev(() => window.__hd.hideDev(true));
  await ev(async () => { const m = await import(new URL('tools/hintMonitor.js', document.baseURI).href); m.installHintMonitor(); });
  await sleep(1800);
  await click('.title-actions button', 'New Realm');
  for (let i = 0; i < 60; i++) { if (await ev(() => window.__hd.scene === 'world')) break; await sleep(100); }
  const tutorialRegion = await ev(async () => { const { tutorialRegionId } = await import(new URL('game/meta/intel.js', document.baseURI).href); return tutorialRegionId(window.__hd.state, window.__hd.world); });
  await ev((id) => { window.__hm.regionId = id; }, tutorialRegion);

  // ---- screenshots: one per distinct hint ---------------------------------------------------------------------------------------
  const shotOf = new Set();
  let shotN = 0;
  const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28).replace(/^-|-$/g, '');
  async function maybeShot(text) {
    if (!SHOTS || !text || shotOf.has(text)) return;
    shotOf.add(text);
    shotN += 1;
    await sleep(450); // the pointer settles (and the coach wrapper's reading time passes)
    const cur = await ev(() => document.querySelector('.coach:not([hidden]) .coach-text')?.textContent.trim() || '');
    if (cur !== text) return;
    await page.screenshot(`${OUT}/hints-${TAG}-${vp.name}-${String(shotN).padStart(2, '0')}-${slug(text)}.png`);
  }

  // ---- the player ---------------------------------------------------------------------------------------------------------------
  const acted = new Set();
  let battleNo = 0;
  let battleStartWall = 0;
  let regionTries = 0;
  let lastAim = 0;
  let lastText = '';
  let lastTextAt = Date.now();
  let lastBotSend = 0;
  const seenTexts = [];
  const snap = () => ev(() => {
    const hd = window.__hd;
    const c = document.querySelector('.coach:not([hidden]) .coach-text');
    return {
      scene: hd.scene, phase: hd.battlePhase, text: c ? c.textContent.trim() : '',
      t: hd.battle ? hd.battle.t : 0, won: hd.state.stats.battlesWon, owned: hd.state.owner.filter((o) => o === 0).length,
      cardOpen: !!document.querySelector('.hd-dock:not([hidden]) .region-card') && !document.querySelector('.hd-dock').hidden,
      results: !!document.querySelector('.results-card:not([hidden])'),
    };
  });

  async function botSend(fraction = 0.5) {
    const plan = await ev(async (vw, vh) => {
      const { previewSend } = await import(new URL('game/battle/sim.js', document.baseURI).href);
      const hd = window.__hd;
      const b = hd.battle;
      const all = hd.siteInfo();
      const vis = (s) => s.x > 10 && s.x < vw - 10 && s.y > (vh < 520 ? 84 : 110) && s.y < vh - (vh < 520 ? 130 : 190);
      const mine = all.filter((s) => s.owner === 0 && s.troops >= 7);
      const foes = all.filter((s) => s.owner !== 0 && vis(s));
      let best = null;
      for (const f of foes) for (const m of mine) for (const fx of [0.5, 0.75, 1]) {
        const pv = previewSend(b, [m.id], f.id, fx);
        if (pv.outcome !== 'capture') continue;
        const score = pv.arriveSec + (f.type === 'keep' ? -6 : 0) + fx * 4 + f.troops * 0.15;
        if (!best || score < best.score) best = { score, from: { x: m.x, y: m.y + 4 }, to: { x: f.x, y: f.y + 4 } };
      }
      return best;
    }, W, H);
    if (plan) { await drag(plan.from, plan.to); return true; }
    return false;
  }

  const start = Date.now();
  const LIMIT = Number(flags.limit || 300) * 1000;
  let done = false;
  while (!done && Date.now() - start < LIMIT) {
    await sleep(200);
    const s = await snap().catch(() => null);
    if (!s) continue;
    if (s.text !== lastText) { lastText = s.text; lastTextAt = Date.now(); if (s.text) { seenTexts.push(s.text); maybeShot(s.text).catch(() => {}); } }
    const since = (Date.now() - lastTextAt) / 1000;
    const t = s.text;
    if (s.scene === 'world') {
      await ev(() => { const hd = window.__hd; if (hd.state.owner.filter((o) => o === 0).length === 1) { /* the first realm: the hinted region stays the tutorial region */ } });
      if (/move the map|zoom/i.test(t) && !acted.has('pan')) {
        acted.add('pan');
        await sleep(600);
        await drag({ x: W * 0.5, y: H * 0.62 }, { x: W * 0.44, y: H * 0.58 });
        await sleep(500);
        await zoomBy(W * 0.5, H * 0.55, 1);
        await sleep(500);
        await zoomBy(W * 0.5, H * 0.55, -1);
      } else if (/glowing region/i.test(t) && since > 0.8) {
        let p = await ev((id) => window.__hd.regionScreenPos(id), tutorialRegion);
        const inBand = (q) => q && q.x > 40 && q.x < W - 40 && q.y > (H < 520 ? 100 : 130) && q.y < H - (H < 520 ? 60 : 200);
        if (p && !inBand(p)) {
          // the pan/zoom left the region under a bar: a player drags it back into view first
          await drag({ x: W * 0.5, y: H * 0.58 }, { x: W * 0.5 + Math.max(-W * 0.4, Math.min(W * 0.4, W * 0.4 - p.x)), y: H * 0.58 + Math.max(-H * 0.3, Math.min(H * 0.3, H * 0.45 - p.y)) });
          await sleep(900);
          p = await ev((id) => window.__hd.regionScreenPos(id), tutorialRegion);
        }
        // the label sits on one hex of a small region; if that exact spot is a neighbour's tile (elevated hexes overlap), a player would tap a little to the side
        const spiral = [[0, 0], [0, -9], [-11, 0], [11, 0], [0, 10], [-9, -14], [10, -14], [-14, 9], [14, 9]];
        const off = spiral[regionTries++ % spiral.length];
        if (p) await tap(p.x + off[0], p.y + off[1]);
        await sleep(900);
      } else if (/^attack!/i.test(t) && since > 0.8) {
        await click('.region-card-action:not([hidden])');
        await sleep(1500);
      } else if (/war council|a good first buy/i.test(t) && since > 1) {
        await click('.hud-btn[aria-label="War Council"]');
        await sleep(1200);
        await click('.council-close');
        await sleep(600);
      } else if (/scout a region/i.test(t) && since > 1) {
        await ev(() => window.__hd.grantGold(500));
        await ev(() => window.__hd.refreshCard());
        await sleep(400);
        await click('.intel-scout-btn');
        await sleep(1000);
      } else if (/found a dynasty/i.test(t) && since > 2) {
        done = true;
      } else if (s.results) {
        await click('.results-action');
        await sleep(1500);
      } else if (!t && since > 7 && s.won === 0 && !s.cardOpen && !acted.has('autoregion')) {
        acted.add('autoregion'); // no hint for a while: a player who ignores the hints still plays on
        const p = await ev((id) => window.__hd.regionScreenPos(id), tutorialRegion);
        if (p) await tap(p.x, p.y);
      } else if (!t && s.cardOpen && s.won === 0 && since > 6 && !acted.has('atk1')) {
        acted.add('atk1'); // no Attack hint could be drawn (the button was out of reach): the player presses it anyway
        await click('.region-card-action:not([hidden])');
        await sleep(1500);
      } else if (!t && s.won >= 1 && since > 5 && !s.cardOpen && !acted.has('b2go')) {
        // after the first victory the council and scouting hints have had their turn: attack the next region (battle 2: pause and speed, Firestorm,
        // clearing a selection), then jump to the end of the campaign for the dynasty hint
        acted.add('b2go');
        const pick = await ev(async () => {
          const { world, state } = window.__hd;
          const { difficulty } = await import(new URL('game/meta/progression.js', document.baseURI).href);
          const ids = world.regions.filter((r) => state.owner[r.id] !== 0 && r.neighbors.some((n) => state.owner[n] === 0)).map((r) => r.id);
          ids.sort((x, y) => difficulty(state, world, y).ratio - difficulty(state, world, x).ratio);
          return ids.length ? window.__hd.regionScreenPos(ids[0]) : null;
        });
        if (pick) { await tap(pick.x, pick.y); await sleep(1400); await click('.region-card-action:not([hidden])'); }
      } else if (!t && s.won >= 2 && since > 5 && !acted.has('end')) {
        acted.add('end');
        await ev(() => { window.__hd.conquerRegions(999); });
        await sleep(3500);
      } else if (!t && acted.has('end') && since > 14) done = true;
      else if (acted.has('end') && /found a dynasty/i.test(t) && since > 2) done = true;
    } else if (s.scene === 'battle') {
      if (s.phase === 'live' && battleStartWall === 0) { battleStartWall = Date.now(); battleNo += 1; }
      if (s.results) { await click('.results-action'); battleStartWall = 0; await sleep(1500); continue; }
      if (s.phase !== 'live') { if (s.phase === 'victory' || s.phase === 'defeat') battleStartWall = battleStartWall || Date.now(); continue; }
      if (battleNo === 2 && !acted.has('fire')) { acted.add('fire'); await ev(() => { window.__hd.state.upgrades.firestorm = 1; }); }
      if (battleNo === 2 && s.t > 12 && !acted.has('sel2') && !t) {
        acted.add('sel2');
        const two = await ev(() => window.__hd.siteInfo().filter((x) => x.owner === 0).slice(0, 2));
        for (const x of two) { await tap(x.x, x.y + 4); await sleep(250); }
      }
      const battleSec = (Date.now() - battleStartWall) / 1000;
      if (/war camp to a settlement/i.test(t) && since > 1.2) {
        const arrow = await ev(() => { const hd = window.__hd; const a = hd.tutorialArrow(); if (!a) return null; const info = hd.siteInfo(); const f = info.find((x) => x.id === a.from); const to = info.find((x) => x.id === a.to); return f && to ? { from: { x: f.x, y: f.y + 4 }, to: { x: to.x, y: to.y + 4 } } : null; });
        if (flags.debug && arrow) console.log(' top', await ev((x, y) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + '.' + e.className : null; }, arrow.from.x, arrow.from.y));
        if (flags.debug) console.log('drag', JSON.stringify(arrow), JSON.stringify(await ev(() => { const hd = window.__hd; return { ta: hd.tutorialArrow(), phase: hd.battlePhase, t: hd.battle && hd.battle.t, sel: hd.selection && hd.selection() }; })));
        if (arrow && flags.debug) {
          await ev(() => { if (window.__pl) return; window.__pl = []; const c = document.querySelector('canvas'); for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) c.addEventListener(t, (e) => { if (window.__pl.length < 12) window.__pl.push([t, e.pointerId, e.pointerType, Math.round(e.clientX), Math.round(e.clientY)]); }, true); });
          await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: arrow.from.x, y: arrow.from.y, id: 1 }] });
          for (let i = 1; i <= 6; i++) { await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: arrow.from.x + ((arrow.to.x - arrow.from.x) * i) / 14, y: arrow.from.y + ((arrow.to.y - arrow.from.y) * i) / 14, id: 1 }] }); await sleep(16); }
          console.log(' mid', JSON.stringify(await ev(() => ({ drag: window.__hd.dragInfo(), cam: [window.__hd.camera.x, window.__hd.camera.y], moving: window.__hd.camera.isMoving && window.__hd.camera.isMoving() }))));
          console.log(' events', JSON.stringify(await ev(() => { const r = window.__pl.slice(); window.__pl.length = 0; return r; })));
          await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else if (arrow) await drag(arrow.from, arrow.to);
        if (flags.debug && arrow) console.log(' after', JSON.stringify(await ev(() => { const hd = window.__hd; const c = hd.siteInfo()[0]; return { camp: [Math.round(c.x), Math.round(c.y)], troops: hd.siteInfo().filter((s) => s.owner === 0).map((s) => Math.round(s.troops)), squads: hd.battle.squads.length, cam: [hd.camera.x, hd.camera.y, hd.camera.zoom].map((v) => +v.toFixed(2)) }; })));
      } else if (/set up a supply line/i.test(t) && since > 1.2 && !acted.has(`supply${battleNo}`)) {
        acted.add(`supply${battleNo}`);
        const plan = await ev(async () => { const { canRoute } = await import(new URL('game/battle/sim.js', document.baseURI).href); const hd = window.__hd; const info = hd.siteInfo(); const camp = info.find((x) => x.type === 'camp' && x.owner === 0); const to = info.filter((x) => x.owner !== 0 && canRoute(hd.battle, 0, camp.id, x.id)).sort((a, b) => Math.hypot(a.x - camp.x, a.y - camp.y) - Math.hypot(b.x - camp.x, b.y - camp.y))[0]; return to ? { from: { x: camp.x, y: camp.y + 4 }, to: { x: to.x, y: to.y + 4 } } : null; });
        if (plan) await supplyDrag(plan.from, plan.to);
      } else if (/how much to send/i.test(t) && since > 1) {
        if (touch) await click('.send-fraction-btn', '75%'); else await key('3', 'Digit3', 51);
        await sleep(500);
      } else if (/select several|tap your settlements/i.test(t) && since > 1.2) {
        const pair = await ev(async (vw, vh) => {
          const { previewSend } = await import(new URL('game/battle/sim.js', document.baseURI).href);
          const hd = window.__hd; const info = hd.siteInfo(); const b = hd.battle;
          const mine = info.filter((x) => x.owner === 0 && x.troops >= 5).slice(0, 2);
          const foes = info.filter((x) => x.owner !== 0 && x.x > 10 && x.x < vw - 10 && x.y > (vh < 520 ? 84 : 110) && x.y < vh - (vh < 520 ? 130 : 190));
          if (mine.length < 2 || !foes.length) return null;
          let best = null;
          for (const f of foes) { const pv = previewSend(b, mine.map((m) => m.id), f.id, 1); const score = (pv.outcome === 'capture' ? 0 : 1000) + f.troops; if (!best || score < best.score) best = { score, f }; }
          return { a: mine[0], b: mine[1], f: best.f };
        }, W, H);
        if (pair) { await tap(pair.a.x, pair.a.y + 4); await sleep(250); await tap(pair.b.x, pair.b.y + 4); await sleep(250); await tap(pair.f.x, pair.f.y + 4); }
      } else if (/pick where everyone goes/i.test(t) && since > 1.5 && Date.now() - lastAim > 2500) {
        lastAim = Date.now(); // armed but not yet aimed (the first tap can land on a bar): aim again at the keep
        const keep2 = await ev(() => { const k = window.__hd.siteInfo().find((x) => x.type === 'keep' && x.owner !== 0); return k ? { x: k.x, y: k.y + 4 } : null; });
        if (keep2) await tap(keep2.x, keep2.y);
      } else if (/rally/i.test(t) && !/stuck/i.test(t) && since > 1.2) {
        if (!acted.has(`rally${battleNo}`)) {
          acted.add(`rally${battleNo}`);
          if (touch) await click('.power-btn'); else await key('q', 'KeyQ', 81);
          await sleep(700);
          const keep = await ev(() => { const k = window.__hd.siteInfo().find((x) => x.type === 'keep' && x.owner !== 0); return k ? { x: k.x, y: k.y } : null; });
          if (keep) await tap(keep.x, keep.y);
        }
      } else if (/space pauses|speed button/i.test(t) && since > 1.2 && !acted.has(`pause${battleNo}`)) {
        acted.add(`pause${battleNo}`);
        if (touch) { await click('.battle-pause'); await sleep(600); await click('.battle-pause'); } else { await key(' ', 'Space', 32); await sleep(600); await key(' ', 'Space', 32); }
      } else if (/firestorm:/i.test(t) && since > 1.2 && !acted.has(`fire${battleNo}`)) {
        acted.add(`fire${battleNo}`);
        if (touch) { const btns = await ev(() => [...document.querySelectorAll('.power-btn')].map((b) => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })); if (btns[1]) await tap(btns[1].x, btns[1].y); } else await key('w', 'KeyW', 87);
        await sleep(500);
        const foe = await ev((vw, vh) => { const f = window.__hd.siteInfo().filter((x) => x.owner !== 0 && x.x > 10 && x.x < vw - 10 && x.y > (vh < 520 ? 84 : 110) && x.y < vh - (vh < 520 ? 130 : 190)).sort((a, b) => b.troops - a.troops)[0]; return f ? { x: f.x, y: f.y } : null; }, W, H);
        if (foe) { await tap(foe.x, foe.y); if (touch) { await sleep(400); await tap(foe.x, foe.y); } }
      } else if (/clear/i.test(t) && since > 1.2) {
        if (touch) { await tap(W * 0.5, H * 0.45); } else await key('Escape', 'Escape', 27);
      } else if (Date.now() - lastBotSend > 2500) {
        lastBotSend = Date.now();
        await botSend();
      }
      // leave the battle once its hints have had their turn, or after a while
      if (battleSec > (battleNo === 1 ? 75 : 55) && !s.results) { await ev(() => window.__hd.winBattle()); await sleep(3500); }
    }
  }

  const report = await ev(() => window.__hm.report());
  await page.close();
  return { vp, report, seenTexts, errors };
}

const results = [];
for (const vp of VIEWPORTS) {
  if (only && !only.includes(vp.name)) continue;
  try { results.push(await runViewport(vp)); } catch (e) { console.log(`  viewport ${vp.name} failed: ${e.message}`); results.push({ vp, report: null, seenTexts: [], errors: [String(e.message)] }); }
}

console.log('\n================ hint placement ================');
let bad = 0;
for (const r of results) {
  console.log(`\n${r.vp.name}${r.report ? `: ${r.report.shown} hint frames measured (${r.report.hadFrameHook ? 'after every game frame' : 'own rAF'}), ${r.report.hints.length} distinct hints` : ': no report'}`);
  if (!r.report) { bad += 1; continue; }
  for (const h of r.report.hints) {
    const probs = Object.entries(h.problems);
    bad += probs.length;
    console.log(`  ${probs.length ? 'FAIL' : 'ok  '} "${h.text.slice(0, 70)}"  frames ${h.frames}, worst tip distance ${h.worstTip} px${probs.length ? '\n        ' + probs.map(([k, v]) => `${k} (${v.n} frames) e.g. ${v.detail}`).join('\n        ') : ''}`);
  }
  if (r.errors.length) { console.log(`  console errors: ${r.errors.slice(0, 3).join(' | ')}`); bad += 1; }
}
console.log(bad ? `\n${bad} problem(s)${TAG === 'before' ? ' (a run against an older build: not failing)' : ''}` : '\nALL HINTS PLACED');
process.exit(bad && TAG !== 'before' ? 1 : 0);
