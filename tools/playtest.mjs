// First-session playtest as a brand-new player: fresh profile, hints ON, speed 1x, REAL input only (dev hooks
// only to read state / positions and to fake the time away). Covers the tutorial, the first victory, the council (prices vs gold at each step,
// "ECON" lines), scout / sabotage affordability, battles 2 and 3, the welcome-back card past the offline cap and the Found a Dynasty flow
// with the first D2 battle (--dynasty=off skips the last). Instruments the page to record every panel that
// appears (timeline), overlaps between panels, panels leaving the viewport, clipped text, and console errors.
//
//   npm start                                           # in another terminal
//   node tools/playtest.mjs --variant=desktop|phone [--prefix=qa] [--seed=7] [--url=http://localhost:8080]
//
// Writes screenshots/game/<prefix>-<d|p>-NN-<step>.png and prints a timeline of the panels that were on screen, every
// overlap between panels, panels that left the viewport, clipped button text and console errors. The "player" is a
// bot that plays like a person: it reads each hint before acting, drags with real input, pushes the keep once its
// garrisons clearly outnumber it and uses Rally when the hint says so. Not a pass/fail test (tools/check.mjs is):
// it exists to be READ, alongside the screenshots. Balance numbers it prints will move as the game is retuned.
if (!process.env.CHROME_PATH && process.platform === 'win32') process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('./cdp.js');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.join('=') || 'true'];
}));
const PHONE = flags.variant === 'phone';
const W = PHONE ? 390 : 1440;
const H = PHONE ? 844 : 900;
const TAG = PHONE ? 'p' : 'd';
const PREFIX = flags.prefix || 'qa';
const SEED = flags.seed || '7';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const since = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6);
const note = (msg) => console.log(`[${since()}s] ${msg}`);

const page = await launch({ url: 'about:blank', width: W, height: H });
const errors = [];
page.on((m, p) => {
  if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
  else if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push(p.args.map((a) => a.value ?? a.description).join(' '));
  else if (m === 'Log.entryAdded' && p.entry.level === 'error') errors.push(`${p.entry.text} ${p.entry.url || ''}`);
});
await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: PHONE });
if (PHONE) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

// ---------------- real input --------------------------------------------------------------------------------
const tap = async (x, y) => {
  if (PHONE) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await sleep(70);
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse('mouseMoved', x, y, 'none', 0);
    await sleep(40);
    await page.mouse('mousePressed', x, y, 'left', 1);
    await sleep(60);
    await page.mouse('mouseReleased', x, y, 'left', 0);
  }
};
const dragTo = async (a, b) => {
  if (PHONE) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
    for (let i = 1; i <= 14; i++) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 14, y: a.y + ((b.y - a.y) * i) / 14, id: 1 }] });
      await sleep(16);
    }
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.drag(a, b, 14);
  }
};
const ev = (fn, ...args) => page.eval(fn, ...args);
const waitFor = async (fn, timeout = 20000, ...args) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await ev(fn, ...args)) return true; } catch { /* navigating */ }
    await sleep(120);
  }
  return false;
};
const centerOf = (sel, txt) => ev((s, t) => {
  const els = [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length > 0 && !e.closest('[hidden]'));
  const el = t ? els.find((e) => e.textContent.toLowerCase().includes(t.toLowerCase())) : els[0];
  if (!el) return null;
  let r = el.getBoundingClientRect();
  // below the fold of a scrolling panel (the phone Realm panel's Found a Dynasty): a player scrolls to it first
  if (r.bottom > innerHeight || r.top < 0) { el.scrollIntoView({ block: 'center' }); r = el.getBoundingClientRect(); }
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const top = document.elementFromPoint(x, y);
  return { x, y, hit: top === el || el.contains(top), cover: top && `${top.tagName}.${top.className}` };
}, sel, txt);
const click = async (sel, txt) => {
  const c = await centerOf(sel, txt);
  if (!c) throw new Error(`nothing to click: ${sel} ${txt || ''}`);
  if (!c.hit) note(`FRICTION: ${sel} ${txt || ''} is covered at its centre by ${c.cover}`);
  await tap(c.x, c.y);
  return c;
};

// ---------------- instrumentation ------------------------------------------------------------------------
const INSTRUMENT = () => {
  if (window.__qa) return;
  const q = (window.__qa = { t0: performance.now(), timeline: [], overlaps: [], fresh: [], clipped: [], off: [], shown: new Map(), seen: new Set() });
  const SELS = {
    hint: '.coach-bubble', toast: '.toast', banner: '.leader-card', dock: '.hd-dock .region-card', hudBar: '.hud-bar, .hud',
    pill: '.battle-top', battleTR: '.battle-topright', bottom: '.battle-bottom', results: '.results-card', council: '.council',
    realm: '.realm', settings: '.settings', welcome: '.welcome', modal: '.modal-panel', help: '.hd-help-panel, .hd-controls', skip: '.hd-skip',
  };
  const vis = (el) => {
    if (!el || el.hidden || el.closest('[hidden]')) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.35) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    return r;
  };
  const inter = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 6 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 6;
  // pairs that are designed to sit together
  const OK = new Set(['hudBar|dock', 'hudBar|hint', 'pill|battleTR', 'bottom|hint']);
  setInterval(() => {
    const now = ((performance.now() - q.t0) / 1000);
    const items = [];
    for (const [k, sel] of Object.entries(SELS)) {
      for (const el of document.querySelectorAll(sel)) {
        const r = vis(el);
        if (r) items.push({ k, el, r, txt: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50) });
      }
    }
    // timeline of what is on screen
    const cur = new Set(items.map((i) => `${i.k}: ${i.txt}`));
    for (const key of cur) if (!q.shown.has(key)) { q.shown.set(key, now); q.timeline.push({ t: +now.toFixed(1), on: key }); }
    for (const key of [...q.shown.keys()]) if (!cur.has(key)) { q.timeline.push({ t: +now.toFixed(1), off: key, after: +(now - q.shown.get(key)).toFixed(1) }); q.shown.delete(key); }
    // overlaps
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]; const b = items[j];
        if (a.k === b.k && a.k !== 'hint') continue;
        const pair = [a.k, b.k].sort().join('|');
        if (OK.has(pair) || OK.has(`${a.k}|${b.k}`) || OK.has(`${b.k}|${a.k}`)) continue;
        if (!inter(a.r, b.r)) continue;
        const sig = `${pair} :: ${a.txt} / ${b.txt}`;
        if (!q.seen.has(sig)) { q.seen.add(sig); q.overlaps.push({ t: +now.toFixed(1), sig }); q.fresh.push(sig); }
      }
    }
    // panels leaving the viewport
    for (const i of items) {
      if (['hudBar', 'bottom', 'pill'].includes(i.k)) continue;
      const sig = `${i.k} ${i.txt}`;
      const outside = i.r.left < -4 || i.r.right > innerWidth + 4 || i.r.top < -4 || i.r.bottom > innerHeight + 4;
      // Only count a panel that STAYS outside for two samples (slide-in animations pass through the edge).
      if (outside && q.pendingOff && q.pendingOff.has(sig) && !q.seen.has(`off ${sig}`)) {
        q.seen.add(`off ${sig}`); q.off.push({ t: +now.toFixed(1), sig, rect: [i.r.left, i.r.top, i.r.right, i.r.bottom].map(Math.round) });
        q.fresh.push(`OFFSCREEN ${sig}`);
      }
      (q.nextOff || (q.nextOff = new Set())).add(outside ? sig : `__in ${sig}`);
    }
    q.pendingOff = q.nextOff; q.nextOff = new Set();
    // clipped text on buttons and chips
    for (const el of document.querySelectorAll('.btn, .power-name, .toast-message, .coach-text, .intel-hint, .region-card-name')) {
      if (!vis(el)) continue;
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible') {
        const sig = `clipped ${el.className}: ${(el.textContent || '').trim().slice(0, 30)}`;
        if (!q.seen.has(sig)) { q.seen.add(sig); q.clipped.push({ t: +now.toFixed(1), sig }); }
      }
    }
  }, 250);
};

let shotN = 0;
const shot = async (name) => {
  shotN += 1;
  const path = `screenshots/game/${PREFIX}-${TAG}-${String(shotN).padStart(2, '0')}-${name}.png`;
  await page.screenshot(path);
  note(`  shot ${path}`);
};
let overlapShots = 0;
const drainFresh = async () => {
  const fresh = await ev(() => { const f = window.__qa ? window.__qa.fresh.splice(0) : []; return f; });
  for (const f of fresh) {
    note(`FRICTION (auto): ${f}`);
    if (overlapShots < 14) { overlapShots += 1; await shot(`auto-${f.split(' ')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)}`); }
  }
};
const settle = async (ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { await sleep(Math.min(400, ms)); await drainFresh(); }
};

// ---------------- the session ----------------------------------------------------------------------------------
const stateNow = () => ev(() => ({
  scene: window.__hd.scene, gold: Math.round(window.__hd.state.gold), owned: window.__hd.state.owner.filter((o) => o === 0).length,
  tut: Object.keys(window.__hd.state.tutorial.seen).join(','), hints: window.__hd.state.settings.hints,
}));

// With the War Council open: buy what is affordable (Army tab, then Realm), a real click each, and report what it cost.
async function shop(label, perTab = 4) {
  const before = await ev(() => Math.round(window.__hd.state.gold));
  const names = [];
  for (const tab of ['Army', 'Realm']) {
    await click('.council-tab', tab).catch(() => {});
    await settle(400);
    for (let i = 0; i < perTab; i++) {
      const c = await ev(() => {
        const cards = [...document.querySelectorAll('.upgrade-card')].filter((x) => x.getClientRects().length);
        const x = cards.find((y) => { const b = y.querySelector('.upgrade-card-buy'); return b && !b.disabled; });
        if (!x) return null;
        const r = x.querySelector('.upgrade-card-buy').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: x.querySelector('.upgrade-card-name')?.textContent, cost: x.querySelector('.upgrade-card-buy')?.textContent.replace(/s+/g, ' ').trim() };
      });
      if (!c) break;
      await tap(c.x, c.y);
      names.push(`${c.name} [${c.cost}]`);
      await settle(450);
    }
  }
  const after = await ev(() => Math.round(window.__hd.state.gold));
  note(`SHOP ${label}: gold ${before} -> ${after}; bought ${names.length ? names.join(', ') : 'nothing'}`);
  if (!names.length) note(`FRICTION/INFO: nothing affordable at ${label} (gold ${before})`);
  await econ(`after shopping (${label})`);
}
async function councilVisit(label) {
  await click('.hud-btn[aria-label="War Council"]');
  await settle(900);
  await shop(label);
  await shot(`council-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
  await click('.council-close');
  await settle(600);
}

// What the player can afford right now: gold, income, the cheapest War Council items per tab and (card open) Scout / Sabotage.
const econ = async (label) => {
  const r = await ev(async () => {
    const hd = window.__hd;
    const { UPGRADES, upgradeCost, levelOf } = await import(new URL('game/meta/upgrades.js', document.baseURI).href);
    const { incomePerSec } = await import(new URL('game/meta/economy.js', document.baseURI).href);
    const rows = Object.values(UPGRADES).map((u) => {
      const lvl = levelOf(hd.state, u.id);
      return { id: u.id, tab: u.tab, lvl, max: u.max != null && lvl >= u.max, cost: Math.round(upgradeCost(u.id, lvl)) };
    }).filter((x) => !x.max).sort((a, b) => a.cost - b.cost);
    const btn = (sel) => { const b = document.querySelector(sel); return b && b.getClientRects().length ? { text: b.innerText.replace(/\s+/g, ' ').trim(), disabled: b.disabled } : null; };
    return {
      gold: Math.round(hd.state.gold), income: +incomePerSec(hd.state, hd.world).toFixed(2), cheapest: rows.slice(0, 5).map((x) => `${x.id}:${x.cost}`).join(' '),
      affordable: rows.filter((x) => x.cost <= hd.state.gold).map((x) => x.id).join(','), scout: btn('.intel-scout-btn'), sabotage: btn('.intel-sabotage-btn'),
    };
  });
  const sAfford = r.cheapest ? Math.max(0, Math.ceil((Number(r.cheapest.split(' ')[0].split(':')[1]) - r.gold) / Math.max(0.01, r.income))) : 0;
  note(`ECON ${label}: gold ${r.gold}, +${r.income}/s; cheapest ${r.cheapest}; affordable now: [${r.affordable}]; cheapest item in ${sAfford} s`
    + `${r.scout ? `; scout ${JSON.stringify(r.scout)}` : ''}${r.sabotage ? `; sabotage ${JSON.stringify(r.sabotage)}` : ''}`);
  return r;
};

await page.goto(`${flags.url || 'http://localhost:8080'}/index.html?dev=1&seed=${SEED}`);
await waitFor(() => !!window.__hd && window.__hd.scene === 'title', 30000);
await ev(() => window.__hd.hideDev(true));
await ev(INSTRUMENT);
note('title reached');
await settle(2000);
await shot('title');

// 1. New Realm -----------------------------------------------------------------------------------------------------
const tNew = Date.now();
await click('.title-actions button', 'New Realm');
await waitFor(() => window.__hd.scene === 'world', 8000);
note('world scene entered');
await settle(900);
await shot('world-first-frame');
await settle(3500);
await shot('world-settled-hint0');
note(`state: ${JSON.stringify(await stateNow())}`);
// a new player reads hint 0 (5 s timeout or tap): wait it out, as they would
await waitFor(() => !!window.__hd.state.tutorial.seen.W0, 9000);
note(`hint W0 (your realm) -> W1 (move and zoom the map) after ${((Date.now() - tNew) / 1000).toFixed(1)} s from New Realm`);
await settle(1500);
await shot('hintW1-move-and-zoom');
// W1 asks for a pan and a zoom: a player does both with real input
await dragTo({ x: W * 0.5, y: H * 0.62 }, { x: W * 0.45, y: H * 0.58 });
await sleep(400);
if (PHONE) {
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: W / 2 - 60, y: H * 0.55, id: 1 }, { x: W / 2 + 60, y: H * 0.55, id: 2 }] });
  for (let i = 1; i <= 10; i++) { await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: W / 2 - 60 - i * 7, y: H * 0.55, id: 1 }, { x: W / 2 + 60 + i * 7, y: H * 0.55, id: 2 }] }); await sleep(16); }
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
} else {
  for (let i = 0; i < 4; i++) { await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: W / 2, y: H * 0.55, deltaX: 0, deltaY: -120 }); await sleep(60); }
}
await waitFor(() => !!window.__hd.state.tutorial.seen.W1, 4000);
await settle(1500);
await shot('hint1-click-a-glowing-region');

// 2. click the glowing region -------------------------------------------------------------------------------------------
// the player clicks the glowing region the hint points at (the tutorial region), and it must be ON SCREEN in the first frame
const first = await ev(async () => {
  const { world, state } = window.__hd;
  const { tutorialRegionId } = await import(new URL('game/meta/intel.js', document.baseURI).href);
  const ids = world.regions.filter((r) => state.owner[r.id] !== 0 && r.neighbors.some((n) => state.owner[n] === 0)).map((r) => r.id);
  const pick = tutorialRegionId(state, world);
  const p = window.__hd.regionScreenPos(pick >= 0 ? pick : ids[0]);
  const visible = ids.filter((id) => { const q = window.__hd.regionScreenPos(id); return q && q.x > 0 && q.x < innerWidth && q.y > 0 && q.y < innerHeight; });
  return { ids, pick, p, visible: visible.length, onScreen: !!p && p.x > 0 && p.x < innerWidth && p.y > 0 && p.y < innerHeight };
});
note(`frontier regions at start: ${first.ids.length}, ${first.visible} on screen; the hinted (tutorial) region is ${first.pick} at ${JSON.stringify(first.p)}`);
if (!first.onScreen) {
  note('FRICTION: the region the first hint points at is not on screen (after the W1 pan and zoom): the player has to find it again');
  // a player pans back to it; the bot flies there (dev hook) so the session can go on
  await ev((id) => window.__hd.flyToRegion(id), first.pick);
  await settle(1200);
  first.p = await ev((id) => window.__hd.regionScreenPos(id), first.pick);
  note(`  back on screen at ${JSON.stringify(first.p)}; W2 hint showing: ${await ev(() => !!document.querySelector('.coach:not([hidden])'))}`);
}
await tap(first.p.x, first.p.y);
await settle(1500);
await shot('card-attack-hint2');
note(`card text: ${(await ev(() => document.querySelector('.region-card')?.innerText.replace(/\s+/g, ' ')))}`);

// 3. attack --------------------------------------------------------------------------------------------------------------
const tAtk = Date.now();
await click('.region-card-action:not([hidden])');
await waitFor(() => window.__hd.scene === 'battle', 8000);
note('battle scene entered');
await settle(600);
await shot('battle-flyin');
await waitFor(() => window.__hd.battlePhase === 'live', 12000);
note(`battle live ${((Date.now() - tAtk) / 1000).toFixed(1)} s after pressing Attack`);
await settle(1200);
await shot('battle-live-hint3');

// 4. play the first battle at 1x with real drags ---------------------------------------------------------------------------
async function playBattle(label, maxSec = 200) {
  const t0 = Date.now();
  let firstSend = null;
  let firstCapture = null;
  let rallied = false;
  let lastShot = 0;
  let curFraction = 0.5;
  let waits = 0;
  await settle(2500); // the player reads the hint first
  while (Date.now() - t0 < maxSec * 1000) {
    const st = await ev(() => ({ phase: window.__hd.battlePhase, res: !!document.querySelector('.results-card:not([hidden])'), stats: window.__hd.battle && window.__hd.battle.stats, t: window.__hd.battle && window.__hd.battle.t }));
    if (st.res || st.phase === 'victory' || st.phase === 'defeat') break;
    const info = await ev(() => window.__hd.siteInfo());
    let sent = 0;
    // A player reads the drag tooltip ("Send 15 -> capture, 1 left") before letting go, and waits for the camp to refill rather than
    // dribbling troops into a garrison: ask the sim the question the tooltip asks, and only send what it says will capture.
    const plan = await ev(async (vw, vh) => {
      const { previewSend } = await import(new URL('game/battle/sim.js', document.baseURI).href);
      const hd = window.__hd;
      const b = hd.battle;
      const all = hd.siteInfo();
      const vis = (s) => s.x > 10 && s.x < vw - 10 && s.y > 110 && s.y < vh - 190;
      const mine = all.filter((s) => s.owner === 0 && s.troops >= 7 && vis(s)); // a player drags only from what they can see (a drag that starts off a settlement pans the map)
      const foes = all.filter((s) => s.owner !== 0 && vis(s));
      let best = null;
      for (const f of foes) {
        for (const m of mine) {
          for (const fx of [0.5, 0.75, 1]) {
            const pv = previewSend(b, [m.id], f.id, fx);
            if (pv.outcome !== 'capture') continue;
            const score = pv.arriveSec + (f.type === 'keep' ? -6 : 0) + fx * 4 + f.troops * 0.15;
            if (!best || score < best.score) best = { score, from: m.id, to: f.id, fraction: fx, toType: f.type, sending: pv.sending, left: Math.round(pv.remaining) };
          }
        }
      }
      // the big push: every site we own at once, on the keep
      const keep = foes.find((s) => s.type === 'keep');
      let push = null;
      if (keep) {
        const ids = all.filter((s) => s.owner === 0 && s.troops >= 6 && vis(s)).map((s) => s.id);
        if (ids.length >= 2) {
          const pv = previewSend(b, ids, keep.id, 1);
          if (pv.outcome === 'capture') push = { ids, to: keep.id, sending: pv.sending, left: Math.round(pv.remaining) };
        }
      }
      return { best, push, ownTroops: Math.round(all.filter((s) => s.owner === 0).reduce((a, s) => a + s.troops, 0)), foeTroops: foes.map((s) => `${s.type}${Math.round(s.troops)}`).join(' ') };
    }, W, H);
    const at = (id) => info.find((x) => x.id === id);
    const setFraction = async (f) => {
      if (Math.abs(f - curFraction) < 0.01) return;
      await click('.send-fraction-btn', `${Math.round(f * 100)}%`).catch(() => {});
      curFraction = f;
    };
    if (plan.push) {
      note(`pushing the keep: ${plan.push.sending} troops from ${plan.push.ids.length} sites, predicted capture with ${plan.push.left} left (${plan.foeTroops})`);
      await setFraction(1);
      const to = at(plan.push.to);
      for (const id of plan.push.ids) {
        const from = at(id);
        if (from && to) { await dragTo({ x: from.x, y: from.y + 4 }, { x: to.x, y: to.y + 4 }); await sleep(200); }
      }
      sent += 1;
      await settle(2000);
    } else if (plan.best) {
      await setFraction(plan.best.fraction);
      const from = at(plan.best.from);
      const to = at(plan.best.to);
      if (from && to) {
        const before = await ev(() => ({ x: window.__hd.camera.x, y: window.__hd.camera.y, sent: window.__hd.battle.stats.sent }));
        const under = await ev((x, y, id) => {
          const e = document.elementFromPoint(x, y);
          const hd = window.__hd; const st = hd.siteInfo().find((q) => q.id === id);
          return `${e ? `${e.tagName}.${String(e.className).slice(0, 30)}` : null}; phase ${hd.battlePhase}; armed ${!!document.querySelector('.power-btn.is-armed')}; site now owner ${st && st.owner} troops ${st && Math.round(st.troops)} at ${st && Math.round(st.x)},${st && Math.round(st.y)}; selection ${JSON.stringify(hd.selection())}; dialog ${document.documentElement.hasAttribute('data-dialog')}`;
        }, from.x, from.y + 4, plan.best.from);
        await dragTo({ x: from.x, y: from.y + 4 }, { x: to.x, y: to.y + 4 });
        const after = await ev(() => ({ x: window.__hd.camera.x, y: window.__hd.camera.y, sent: window.__hd.battle.stats.sent, zoom: window.__hd.camera.zoom }));
        const moved = Math.hypot(after.x - before.x, after.y - before.y) * after.zoom;
        // (the sim takes the order on its next tick, so stats.sent is not checked here; a drag that PANNED instead of sending is what strands the bot)
        if (moved > 20) note(`FRICTION: a send drag from site ${plan.best.from} (${Math.round(from.x)},${Math.round(from.y)}; under the finger: ${under}) to ${plan.best.to} panned the map ${Math.round(moved)} px instead of sending`);
        sent += 1;
        if (firstSend == null) { firstSend = (Date.now() - t0) / 1000; note(`first send at ${firstSend.toFixed(1)} s into the fight: ${Math.round(plan.best.fraction * 100)}% to a ${plan.best.toType}, predicted capture with ${plan.best.left} left`); await settle(600); await shot(`${label}-first-send`); }
        await sleep(250);
      }
    } else {
      waits += 1;
      if (waits % 10 === 1) note(`waiting for the camp to refill (nothing is a predicted capture yet): ${plan.ownTroops} troops of ours vs ${plan.foeTroops}`);
    }
    if (firstCapture == null && st.stats && st.stats.captured > 0) { firstCapture = (Date.now() - t0) / 1000; note(`first capture at ${firstCapture.toFixed(1)} s`); await shot(`${label}-first-capture`); }
    // the Rally hint appears at t >= 20 s when Rally is ready: a player would try it
    if (!rallied && st.t >= 22) {
      const ready = await ev(() => { const b = document.querySelectorAll('.power-btn')[0]; return !!b && b.classList.contains('is-ready'); });
      if (ready) {
        rallied = true;
        note('pressing Rally (real click), then tapping the enemy keep');
        await shot(`${label}-rally-hint`);
        await click('.power-btn');
        await sleep(400);
        const keep = (await ev(() => window.__hd.siteInfo())).find((x) => x.type === 'keep' && x.owner !== 0);
        if (keep) await tap(keep.x, keep.y);
        await settle(800);
        await shot(`${label}-after-rally`);
      }
    }
    if (Date.now() - lastShot > 30000) { lastShot = Date.now(); await shot(`${label}-mid`); }
    await settle(sent ? 700 : 1200);
  }
  const res = await ev(() => !!document.querySelector('.results-card:not([hidden])') || ['victory', 'defeat'].includes(window.__hd.battlePhase));
  return { seconds: (Date.now() - t0) / 1000, ended: res, firstSend, firstCapture };
}

const b1 = await playBattle('b1', 240);
note(`battle 1: ${JSON.stringify(b1)} stats=${JSON.stringify(await ev(() => window.__hd.battle && window.__hd.battle.stats))}`);
if (!b1.ended) {
  note('FRICTION: the first battle did not end in 200 s of real time at 1x; forcing the win with the dev hook to continue');
  await ev(() => window.__hd.winBattle());
}
await waitFor(() => !!document.querySelector('.results-card:not([hidden])'), 20000);
await settle(2600);
await shot('results');
const r1 = await ev(() => document.querySelector('.results-card').dataset.result);
note(`result 1: ${r1}`);
note(`results: ${(await ev(() => document.querySelector('.results-card')?.innerText.replace(/\s+/g, ' ')))}`);
await click('.results-action');
await waitFor(() => window.__hd.scene === 'world', 10000);
await settle(1200);
await shot('after-continue-1');
await settle(3500);
await shot('after-continue-2');
note(`state: ${JSON.stringify(await stateNow())}`);
await econ('after the first victory');

// 5. the council -------------------------------------------------------------------------------------------------------------
note('a new player now sees the council hint (step 6)');
await shot('hint6-council');
await click('.hud-btn[aria-label="War Council"]');
await settle(1200);
await shot('council');
note(`council: ${(await ev(() => document.querySelector('.council')?.innerText.replace(/\s+/g, ' ').slice(0, 300)))}`);
await shop('first council visit');
await shot('council-bought');
await click('.council-close');
await settle(700);

// 6. scouting ------------------------------------------------------------------------------------------------------------------
const next = await ev(() => {
  const { world, state } = window.__hd;
  const ids = world.regions.filter((r) => state.owner[r.id] !== 0 && r.neighbors.some((n) => state.owner[n] === 0)).map((r) => r.id);
  return { ids, p: ids.length ? window.__hd.regionScreenPos(ids[0]) : null };
});
note(`frontier regions now: ${next.ids.length}`);
await tap(next.p.x, next.p.y);
await settle(1400);
await shot('next-region-card');
note(`card: ${(await ev(() => document.querySelector('.region-card')?.innerText.replace(/\s+/g, ' ')))}`);
const scoutBtn = await centerOf('.intel-scout-btn');
if (scoutBtn) {
  note(`scout button: ${await ev(() => document.querySelector('.intel-scout-btn').innerText.replace(/\s+/g, ' '))} / hint: ${await ev(() => document.querySelector('.intel-scout-row .intel-hint')?.textContent)}`);
  const affordable = await ev(() => !document.querySelector('.intel-scout-btn').disabled);
  await econ('scout button visible');
  if (affordable) { await tap(scoutBtn.x, scoutBtn.y); await settle(1300); await shot('scouted'); await econ('after scouting (sabotage now visible)'); }
  else { note('FRICTION/INFO: cannot afford Scout right after the first victory'); await shot('scout-unaffordable'); }
}

// 7. the second and third battles: a player picks the easiest frontier region they can see ------------------------------------------
async function nextRegionBattle(n) {
  await settle(800);
  const pick = await ev(async () => {
    const { world, state } = window.__hd;
    const { difficulty } = await import(new URL('game/meta/progression.js', document.baseURI).href);
    const ids = world.regions.filter((r) => state.owner[r.id] !== 0 && r.neighbors.some((x) => state.owner[x] === 0)).map((r) => r.id);
    const rows = ids.map((id) => { const d = difficulty(state, world, id); return { id, label: d.label, ratio: +d.ratio.toFixed(2), surrender: !!d.surrender }; });
    rows.sort((a, b) => b.ratio - a.ratio);
    return { rows, p: rows.length ? window.__hd.regionScreenPos(rows[0].id) : null };
  });
  note(`battle ${n}: frontier ${JSON.stringify(pick.rows.slice(0, 5))}`);
  if (!pick.p) { note('FRICTION: no frontier region to attack'); return null; }
  await tap(pick.p.x, pick.p.y);
  await settle(1400);
  await shot(`b${n}-card`);
  note(`card: ${(await ev(() => document.querySelector('.region-card')?.innerText.replace(/\s+/g, ' ')))}`);
  await econ(`before battle ${n}`);
  const sab = await ev(() => { const b = document.querySelector('.intel-scout-btn'); return b ? { text: b.innerText.replace(/\s+/g, ' '), disabled: b.disabled } : null; });
  if (sab) note(`scout button: ${JSON.stringify(sab)}`);
  const actionText = await ev(() => document.querySelector('.region-card-action:not([hidden])')?.textContent.trim());
  note(`region action: ${actionText}`);
  await click('.region-card-action:not([hidden])');
  if (/surrender/i.test(actionText || '')) {
    await settle(2500);
    await shot(`b${n}-surrendered`);
    return { surrendered: true };
  }
  await waitFor(() => window.__hd.battlePhase === 'live', 14000);
  await settle(1500);
  await shot(`b${n}-live`);
  const res = await playBattle(`b${n}`, 240);
  note(`battle ${n}: ${JSON.stringify(res)} stats=${JSON.stringify(await ev(() => window.__hd.battle && window.__hd.battle.stats))}`);
  if (!res.ended) { note(`FRICTION: battle ${n} did not finish in 240 s at 1x; forcing`); await ev(() => window.__hd.winBattle()); }
  await waitFor(() => !!document.querySelector('.results-card:not([hidden])'), 20000);
  await settle(2500);
  await shot(`b${n}-results`);
  note(`results: ${(await ev(() => document.querySelector('.results-card')?.innerText.replace(/\s+/g, ' ')))}`);
  await click('.results-action');
  await waitFor(() => window.__hd.scene === 'world', 10000);
  await settle(3000);
  await shot(`after-b${n}`);
  await econ(`after battle ${n}`);
  await councilVisit(`after battle ${n}`);
  return res;
}
await nextRegionBattle(2);
await nextRegionBattle(3);

// 8. time away -----------------------------------------------------------------------------------------------------------------------
note('simulating 3 h away (lastSeen moved back) and returning to the tab');
await ev(() => { const s = window.__hd.state; s.lastSeen -= 3 * 3600 * 1000; });
await ev(() => document.dispatchEvent(new Event('visibilitychange')));
await settle(1500);
await shot('welcome-back');
note(`welcome: ${(await ev(() => document.querySelector('[class*="welcome"]')?.innerText.replace(/\s+/g, ' ')))}`);
note(`welcome cap note: ${JSON.stringify(await ev(() => { const c = document.querySelector('.welcome-cap'); return c && !c.hidden ? c.textContent : null; }))}`);
const collect = await centerOf('[class*="welcome"] button');
if (collect) { await tap(collect.x, collect.y); await settle(1500); await shot('after-collect'); }
note(`final state: ${JSON.stringify(await stateNow())}`);

// 9. Found a Dynasty: dev hooks reach it, real input does the rest -------------------------------------------------------------------
if (flags.dynasty !== 'off') {
  const D = () => ev(async () => {
    const hd = window.__hd;
    const { leaderFor } = await import(new URL('game/meta/leaders.js', document.baseURI).href);
    const { DYNASTY } = await import(new URL('game/config/meta.js', document.baseURI).href);
    return {
      seed: hd.state.seed, level: hd.state.dynasty.level, stars: hd.state.dynasty.stars, regions: hd.world.regions.length,
      leaders: [1, 2, 3, 4].map((f) => { const l = leaderFor(hd.state.seed, hd.state.dynasty.level, f); return l && l.fullName; }),
      musicKey: hd.music.getDebug().key, gold: Math.round(hd.state.gold), owned: hd.state.owner.filter((o) => o === 0).length,
      tutorialDone: hd.state.tutorial && hd.state.tutorial.done, hints: hd.state.settings.hints, starBase: DYNASTY.starBase,
      hudStars: (document.querySelector('.hud-stars, .hud-dynasty, [class*="dynasty"]')?.innerText || '').replace(/\s+/g, ' '),
    };
  });
  const d1 = await D();
  note(`dynasty D1: ${JSON.stringify(d1)}`);
  await ev(() => window.__hd.conquerRegions(999));
  await settle(1800);
  note(`after conquering everything: owned ${(await D()).owned} of ${d1.regions}`);
  await click('.hud-btn[aria-label="Realm stats"]');
  await settle(1200);
  await shot('realm-complete');
  note(`realm panel: ${(await ev(() => document.querySelector('.realm')?.innerText.replace(/\s+/g, ' ').slice(0, 600)))}`);
  const foundEnabled = await ev(() => { const b = document.querySelector('.dynasty-found-btn'); return !!b && !b.disabled; });
  note(`Found a Dynasty button enabled: ${foundEnabled}`);
  if (!foundEnabled) note('FRICTION: the Found a Dynasty button is not enabled with every region owned');
  await click('.dynasty-found-btn');
  await settle(900);
  await shot('found-confirm');
  note(`confirm: ${(await ev(() => document.querySelector('.modal-panel')?.innerText.replace(/\s+/g, ' ')))}`);
  await click('.modal-actions button', 'Found it');
  await waitFor(() => window.__hd.state.dynasty.level >= 2 && window.__hd.scene === 'world', 15000);
  await settle(3500);
  await shot('d2-first-screen');
  const d2 = await D();
  note(`dynasty D2: ${JSON.stringify(d2)}`);
  note(`D2 checks: level ${d1.level}->${d2.level}; stars ${d1.stars}->${d2.stars} (expected +${d1.starBase + d1.level}); world seed ${d1.seed}->${d2.seed}; regions ${d1.regions}->${d2.regions}; `
    + `owned ${d2.owned}; gold ${d2.gold}; leaders changed: ${d1.leaders.map((n, i) => n !== d2.leaders[i]).join('/')}; music key ${d1.musicKey}->${d2.musicKey}`);
  if (d2.stars !== d1.stars + d1.starBase + d1.level) note('FRICTION: the stars earned do not match starBase + the dynasty just completed');
  if (d2.seed === d1.seed) note('FRICTION: the new dynasty kept the same seed');
  if (d2.leaders.some((n, i) => n === d1.leaders[i])) note('FRICTION: a rival leader kept their name into the new dynasty');
  note(`D2 hint state: ${JSON.stringify(await ev(() => ({ seen: Object.keys(window.__hd.state.tutorial.seen).join(','), done: window.__hd.state.tutorial.done, coach: document.querySelector('.coach-bubble:not([hidden])')?.innerText || null })))}`);
  // the first region of D2, with real input
  // like D1, the player goes for the region the game points at (the easiest frontier region)
  const first2 = await ev(async () => {
    const { world, state } = window.__hd;
    const { tutorialRegionId } = await import(new URL('game/meta/intel.js', document.baseURI).href);
    const { difficulty } = await import(new URL('game/meta/progression.js', document.baseURI).href);
    const ids = world.regions.filter((r) => state.owner[r.id] !== 0 && r.neighbors.some((n) => state.owner[n] === 0)).map((r) => r.id);
    const pick = tutorialRegionId(state, world);
    const labels = ids.map((id) => { const d = difficulty(state, world, id); return `${id}:${d.label}(${d.ratio.toFixed(2)})`; }).join(' ');
    return { n: ids.length, pick, labels, p: ids.length ? window.__hd.regionScreenPos(pick >= 0 ? pick : ids[0]) : null };
  });
  note(`D2 frontier regions: ${first2.n} [${first2.labels}]; the game points at ${first2.pick}`);
  if (first2.p) {
    await tap(first2.p.x, first2.p.y);
    await settle(1500);
    await shot('d2-card');
    note(`D2 card: ${(await ev(() => document.querySelector('.region-card')?.innerText.replace(/\s+/g, ' ')))}`);
    await econ('D2 start');
    const act2 = await ev(() => document.querySelector('.region-card-action:not([hidden])')?.textContent.trim());
    note(`D2 action: ${act2}`);
    await click('.region-card-action:not([hidden])');
    if (!/surrender/i.test(act2 || '')) {
      await waitFor(() => window.__hd.battlePhase === 'live', 14000);
      await settle(1500);
      await shot('d2-battle-live');
      note(`D2 battle music: ${JSON.stringify(await ev(() => { const m = window.__hd.music.getDebug(); return { scene: m.scene, key: m.key, errors: m.errors }; }))}`);
      const rb = await playBattle('d2b1', 240);
      note(`D2 battle 1: ${JSON.stringify(rb)}`);
      if (!rb.ended) { note('FRICTION: the first D2 battle did not finish in 240 s at 1x; forcing'); await ev(() => window.__hd.winBattle()); }
      await waitFor(() => !!document.querySelector('.results-card:not([hidden])'), 20000);
      await settle(2500);
      await shot('d2-results');
      note(`D2 results: ${(await ev(() => document.querySelector('.results-card')?.innerText.replace(/\s+/g, ' ')))}`);
      await click('.results-action');
      await waitFor(() => window.__hd.scene === 'world', 10000);
      await settle(2500);
      await shot('d2-after-b1');
      await econ('after the first D2 victory');
    } else { await settle(2500); await shot('d2-surrendered'); }
  }
}

// ---------------- report --------------------------------------------------------------------------------------------------------------
const qa = await ev(() => ({ overlaps: window.__qa.overlaps, off: window.__qa.off, clipped: window.__qa.clipped, timeline: window.__qa.timeline }));
console.log('\n== timeline of panels (first 120 events) ==');
for (const e of qa.timeline.slice(0, 120)) console.log(e.on ? `  ${String(e.t).padStart(6)} ON  ${e.on}` : `  ${String(e.t).padStart(6)} off ${e.off} (after ${e.after}s)`);
console.log('\n== overlaps ==');
for (const o of qa.overlaps) console.log(`  ${o.t}s ${o.sig}`);
console.log('\n== offscreen ==');
for (const o of qa.off) console.log(`  ${o.t}s ${o.sig} ${JSON.stringify(o.rect)}`);
console.log('\n== clipped text ==');
for (const o of qa.clipped) console.log(`  ${o.t}s ${o.sig}`);
console.log('\n== console errors ==');
console.log(errors.length ? errors.map((e) => `  ${e}`).join('\n') : '  none');
process.exit(0);
