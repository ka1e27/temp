// Screenshot tour of the REAL game (no gallery mocks) via CDP, on a fresh Chrome
// profile: title, New Realm, region card, War Council, settings, a mid-game world
// (dev hooks conquer ~8 regions), and phone 390x844 variants. Real mouse/touch
// events drive every UI step a player would do; dev hooks (`?dev=1`, window.__hd)
// are used only to fast-forward game state (conquests) and to read positions.
//
//   npm start                      # in another terminal
//   node tools/shots.mjs [--prefix=phaseA] [--out=screenshots/game] [--seed=7]
//                        [--only=desktop|phone|battle|hook|intel|living|rc] [--url=http://localhost:8080] [--dpr=1]
//   --only=rc writes the release-candidate gallery (screenshots/game/rc-*.png, desktop and phone): title, first screen, the tutorial
//   battle with the arrow, a victory with crowns, the War Council with its Best value tag, a scouted card and a mid-game realm with prosperity.
//
// On this machine CHROME_PATH defaults to the local Chrome. Prints frame-time stats
// (CPU ms per frame in the scene code, and the real requestAnimationFrame interval)
// for the world overview, a zoomed-in view and the phone, and writes them to
// <out>/<prefix>-frametimes.json. Exits non-zero if the page logged console errors.
import { mkdir, writeFile } from 'node:fs/promises';

if (!process.env.CHROME_PATH) process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('./cdp.js');

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.join('=') || 'true'];
}));
const BASE = flags.url || 'http://localhost:8080';
const OUT = flags.out || 'screenshots/game';
const PREFIX = flags.prefix || (flags.only === 'rc' ? 'rc' : 'phaseA');
const SEED = flags.seed || '7';
const DPR = Number(flags.dpr || 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const errors = [];
const frameTimes = {};

async function session({ width, height, mobile }, fn) {
  const page = await launch({ url: 'about:blank', width, height });
  page.on((method, params) => {
    if (method === 'Runtime.exceptionThrown') {
      errors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text);
    } else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      errors.push(params.args.map((a) => a.value ?? a.description).join(' '));
    } else if (method === 'Log.entryAdded' && params.entry.level === 'error') {
      errors.push(`${params.entry.text} ${params.entry.url || ''}`);
    }
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: DPR, mobile });
  if (mobile) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const url = `${BASE}/index.html?dev=1&seed=${SEED}`;
  await page.goto(url);

  const api = {
    page,
    url,
    eval: (fn2, ...args) => page.eval(fn2, ...args),
    async shot(name) {
      const path = `${OUT}/${PREFIX}-${name}.png`;
      await page.screenshot(path);
      console.log(`  saved ${path}`);
    },
    async waitFor(pred, timeout = 8000, label = 'condition') {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if (await page.eval(pred)) return true;
        await sleep(100);
      }
      throw new Error(`timed out waiting for ${label}`);
    },
    /** Centre of the first element matching a selector (or text), in CSS px. */
    async centerOf(selector, text) {
      return page.eval((sel, txt) => {
        const els = [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length > 0 && !e.closest('[hidden]'));
        const el = txt ? els.find((e) => e.textContent.trim().toLowerCase().includes(txt.toLowerCase())) : els[0];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el || el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) };
      }, selector, text);
    },
    async mouseClick(x, y) {
      await page.mouse('mouseMoved', x, y, 'none', 0);
      await sleep(30);
      await page.mouse('mousePressed', x, y, 'left', 1);
      await sleep(40);
      await page.mouse('mouseReleased', x, y, 'left', 0);
    },
    async touchTap(x, y) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await sleep(60);
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    async click(x, y) { return mobile ? api.touchTap(x, y) : api.mouseClick(x, y); },
    async drag(a, b) {
      if (!mobile) { await page.drag(a, b, 14); return; }
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
      for (let i = 1; i <= 14; i++) {
        await page.send('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 14, y: a.y + ((b.y - a.y) * i) / 14, id: 1 }],
        });
        await sleep(16);
      }
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    async key(key, code, vk) {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
    },
    async clickSelector(selector, text) {
      const c = await api.centerOf(selector, text);
      if (!c) throw new Error(`no element for ${selector} ${text || ''}`);
      if (!c.hit) console.log(`  warn: ${selector} ${text || ''} is covered at its centre`);
      await api.click(c.x, c.y);
    },
    async sample(label, ms = 2500) {
      const res = await page.eval((m) => window.__hd.perfSample(m), ms);
      frameTimes[label] = res;
      console.log(`  frame times [${label}]`, JSON.stringify(res));
    },
    async hideDev() { await page.eval(() => window.__hd.hideDev(true)); },
  };
  try {
    await api.waitFor(() => !!window.__hd && window.__hd.scene === 'title', 15000, '__hd + title scene');
    await fn(api);
  } finally {
    await page.close();
  }
}

async function tour(api, tag) {
  const shot = (n) => api.shot(`${tag}${n}`);
  console.log(`[${tag || 'desktop'}] title`);
  await sleep(2600);
  await api.hideDev();
  await shot('title');

  console.log(`[${tag || 'desktop'}] New Realm (real click)`);
  await api.clickSelector('.title-actions button', 'New Realm');
  await api.waitFor(() => window.__hd.scene === 'world', 6000, 'world scene');
  await sleep(3400); // camera flight + mists rolling in
  await api.sample('world-overview' + (tag ? `-${tag}` : ''), 2500);
  await shot('overview');

  // Select the easiest frontier region with a REAL click at its label anchor.
  const target = await api.eval(() => {
    const { world, state } = window.__hd;
    const ids = world.regions.filter((r) => state.owner[r.id] !== 0 && r.neighbors.some((n) => state.owner[n] === 0)).map((r) => r.id);
    return ids.length ? ids[0] : null;
  });
  const p = await api.eval((id) => window.__hd.regionScreenPos(id), target);
  await api.click(p.x, p.y);
  await sleep(1300);
  await shot('region-card');

  console.log(`[${tag || 'desktop'}] War Council`);
  await api.clickSelector('.hud-btn', 'War Council');
  await sleep(700);
  await shot('council');
  await api.clickSelector('.council-close');
  await sleep(300);

  console.log(`[${tag || 'desktop'}] Settings`);
  await api.clickSelector('.btn-icon[aria-label="Settings"]');
  await sleep(700);
  await shot('settings');
  await api.clickSelector('.settings-close');
  await sleep(300);

  console.log(`[${tag || 'desktop'}] mid-game (8 regions conquered via dev hooks)`);
  await api.eval(() => {
    const hd = window.__hd;
    hd.conquerRegions(8);
    hd.grantGold(250000);
  });
  await sleep(200);
  await api.eval(() => window.__hd.services.goto.world({ freshRealm: false, resume: true }));
  await sleep(2800);
  await api.sample('midgame-overview' + (tag ? `-${tag}` : ''), 2500);
  await shot('midgame-overview');

  // Zoom into a conquered settlement cluster.
  await api.eval(() => {
    const hd = window.__hd;
    const owned = hd.world.regions.filter((r) => hd.state.owner[r.id] === 0);
    const r = owned[Math.min(3, owned.length - 1)];
    hd.flyToRegion(r.id, hd.services.isPhone() ? 34 : 46, 700);
  });
  await sleep(1600);
  await api.sample('zoomed-in' + (tag ? `-${tag}` : ''), 2500);
  await shot('midgame-zoom');

  console.log(`[${tag || 'desktop'}] welcome-back (2 h away, reload, Continue)`);
  await sleep(5600); // let the autosave write the mid-game state
  await api.eval(() => {
    const s = JSON.parse(localStorage.getItem('hexdominion.v2'));
    s.lastSeen = Date.now() - 2 * 3600 * 1000;
    localStorage.setItem('hexdominion.v2', JSON.stringify(s));
    // pagehide would re-stamp lastSeen with 'now' on the way out; hold the save still.
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'hexdominion.v2') return undefined; return orig.call(this, k, v); };
  });
  await api.page.send('Page.navigate', { url: api.url });
  await api.waitFor(() => !!window.__hd && window.__hd.scene === 'title', 15000, 'title after reload');
  await sleep(2200);
  await api.hideDev();
  await shot('title-continue');
  await api.clickSelector('.title-actions button', 'Continue');
  await api.waitFor(() => window.__hd.scene === 'world', 6000, 'world after Continue');
  await sleep(2600);
  await shot('welcome-back');
}

// ---- battle frames (start, fight with intent lines + threat chips, capture, firestorm, victory,
// reveal after Continue, defeat, and the phone battle), all driven by real input ---------------------
async function battleTour(api, tag) {
  const shot = (n) => api.shot(`${tag}battle-${n}`);
  const label = tag || 'desktop-';
  const phone = !!tag;
  console.log(`[${label}battle] setup`);
  await sleep(2200);
  await api.hideDev();
  await api.clickSelector('.title-actions button', 'New Realm');
  await api.waitFor(() => window.__hd.scene === 'world', 6000, 'world scene');
  await sleep(3200);

  // Unlock Firestorm through the real council UI so the power shot is possible.
  await api.eval(() => window.__hd.grantGold(400));
  await api.clickSelector('.hud-btn', 'War Council');
  await sleep(500);
  await api.clickSelector('.council-tab', 'Powers');
  await sleep(300);
  const buy = await api.eval(() => {
    const cards = [...document.querySelectorAll('.upgrade-card')].filter((c) => c.getClientRects().length);
    const c = cards.find((x) => x.querySelector('.upgrade-card-name')?.textContent.toLowerCase().includes('firestorm'));
    const b = c && c.querySelector('.upgrade-card-buy');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (buy) await api.click(buy.x, buy.y);
  await sleep(300);
  await api.clickSelector('.council-close');
  await sleep(300);

  // A real click on the first frontier region, then Attack (real click).
  const pickRegion = async () => {
    const id = await api.eval(() => {
      const { world, state } = window.__hd;
      return world.regions.find((r) => state.owner[r.id] !== 0 && r.neighbors.some((n) => state.owner[n] === 0)).id;
    });
    const p = await api.eval((rid) => window.__hd.regionScreenPos(rid), id);
    await api.click(p.x, p.y);
    await sleep(1100);
    return id;
  };
  let regionId = await pickRegion();
  const action = await api.eval(() => document.querySelector('.region-card-action:not([hidden])')?.textContent || '');
  if (/attack/i.test(action)) await api.clickSelector('.region-card-action');
  else await api.eval((id) => window.__hd.startBattle(id), regionId);
  await api.waitFor(() => window.__hd.scene === 'battle', 6000, 'battle scene');
  await sleep(450);
  await shot('entering');
  await api.waitFor(() => window.__hd.battlePhase === 'live', 12000, 'battle live');
  await sleep(400);
  await shot('start');

  // Send from the War Camp with a REAL drag, then look at the fight.
  const orders = async (count) => {
    const info = await api.eval(() => window.__hd.siteInfo());
    const own = info.filter((x) => x.owner === 0 && x.troops >= 6).sort((p, q) => q.troops - p.troops).slice(0, count);
    const H = await api.eval(() => innerHeight);
    const W = await api.eval(() => innerWidth);
    for (const from of own) {
      // Weakest reachable non-keep settlement first (the keep waits for the big push).
      const foes = info.filter((x) => x.owner !== 0 && x.type !== 'keep' && x.x > 10 && x.x < W - 10 && x.y > 100 && x.y < H - 180);
      foes.sort((p, q) => p.troops - q.troops);
      if (foes[0]) { await api.drag({ x: from.x, y: from.y + 4 }, { x: foes[0].x, y: foes[0].y + 4 }); await sleep(150); }
    }
  };
  await api.key('4', 'Digit4', 52); // send 100% (real keyboard)
  await orders(1);
  await sleep(2600);
  await shot('fight');

  // Speed up and keep sending until a couple of settlements are ours.
  await api.eval(() => document.querySelector('.battle-speed')?.click());
  await api.eval(() => document.querySelector('.battle-speed')?.click());
  const t0 = Date.now();
  let captured = false;
  while (Date.now() - t0 < 45000 && !captured) {
    await orders(2);
    await sleep(1400);
    captured = await api.eval(() => window.__hd.battle.stats.captured >= 1);
  }
  await sleep(300);
  await shot('capture');

  // Firestorm: real keyboard hotkey (W) + real click on an enemy site (phone: tap the button, tap twice).
  await api.eval(() => document.querySelector('.battle-speed')?.click()); // back to 1x
  await sleep(300);
  console.log(`[${label}battle] firestorm`);
  const fire = await api.eval(() => {
    const info = window.__hd.siteInfo();
    const foe = info.filter((x) => x.owner !== 0 && x.x > 10 && x.x < innerWidth - 10 && x.y > 100 && x.y < innerHeight - 180)
      .sort((p, q) => q.troops - p.troops)[0];
    return foe ? { x: foe.x, y: foe.y } : null;
  });
  if (phone) {
    const btns = await api.eval(() => [...document.querySelectorAll('.power-btn')].map((b) => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
    if (btns[1] && fire) {
      await api.click(btns[1].x, btns[1].y);
      await sleep(300);
      await api.click(fire.x, fire.y);
      await sleep(400);
      await shot('firestorm-aim');
      await api.click(fire.x, fire.y);
    }
  } else if (fire) {
    await api.key('w', 'KeyW', 87);
    await sleep(300);
    await api.page.mouse('mouseMoved', fire.x + 30, fire.y + 24, 'none', 0); // hover: the blast radius follows the pointer
    await sleep(200);
    await shot('firestorm-aim');
    await api.click(fire.x, fire.y);
  }
  await sleep(900);
  await shot('firestorm');

  // Victory: the dev hook flips the keep; the sequence itself (hit-stop, cascade, flood, card) is the real one.
  console.log(`[${label}battle] victory`);
  await api.eval(() => window.__hd.winBattle());
  await sleep(500);
  await shot('victory-cascade');
  await sleep(650);
  await shot('victory-flood');
  await api.waitFor(() => { const c = document.querySelector('.results-card'); return c && !c.hidden; }, 12000, 'victory card');
  await sleep(700);
  await shot('victory-card');
  await api.clickSelector('.results-action', 'Continue');
  await sleep(650);
  await shot('reveal-1');
  await sleep(900);
  await shot('reveal-2');
  await sleep(2200);
  await shot('after-continue');

  // A RIVAL fight: widen the realm with the dev hook until a rival border is reachable. Rivals counter-
  // attack (Free Folk sit tight), so their squads draw dashed intent lines and the settlements they
  // target show "holds / falls" threat chips. Then lose that battle on purpose for the defeat frames.
  console.log(`[${label}battle] rival fight + defeat`);
  const rival = await api.eval(() => {
    const hd = window.__hd;
    for (let i = 0; i < 14; i++) {
      const r = hd.world.regions.find((x) => hd.state.owner[x.id] >= 2 && x.neighbors.some((n) => hd.state.owner[n] === 0));
      if (r) return r.id;
      if (!hd.conquerRegions(1)) break;
    }
    return null;
  });
  if (rival == null) throw new Error('no rival border reachable');
  await sleep(900);
  await api.eval((id) => window.__hd.startBattle(id), rival);
  await api.waitFor(() => window.__hd.battlePhase === 'live', 12000, 'rival battle live');
  await sleep(500);
  await orders(1);
  const t1 = Date.now();
  let sawIntent = false;
  while (Date.now() - t1 < 45000 && !sawIntent) {
    sawIntent = await api.eval(() => window.__hd.threatInfo().length > 0);
    if (!sawIntent) await sleep(400);
  }
  if (sawIntent) { await sleep(700); await shot('intent'); } else console.log(`[${label}battle] (no enemy counter-attack within 45 s: no intent frame)`);
  await api.eval(() => window.__hd.loseBattle());
  await sleep(300);
  await shot('defeat-banner');
  await api.waitFor(() => { const c = document.querySelector('.results-card'); return c && !c.hidden; }, 8000, 'defeat card');
  await sleep(500);
  await shot('defeat-card');
  await api.clickSelector('.results-action', 'Back');
  await sleep(1800);
}

// ---- crowns + leader voices + music settings: region card (par, empty crowns), victory card with crowns,
// owned card, pips on the map, Realm crowns row, Settings music controls, a first-contact banner on the map and
// a battle-start leader banner (rival fight), all driven by real input --------------------------------------
async function hookTour(api, tag) {
  const shot = (n) => api.shot(`${tag}${n}`);
  const label = tag || 'desktop-';
  const music = async (what) => console.log(`  music [${what}]`, JSON.stringify(await api.eval(() => {
    const d = window.__hd.music.getDebug();
    return {
      started: d.started, paused: d.paused, scene: d.scene, pending: d.pending && d.pending.kind, key: d.key,
      intensity: +(d.intensity || 0).toFixed(2), assault: d.assault, voices: d.activeVoices, errors: d.errors,
    };
  })));
  console.log(`[${label}hook] setup`);
  await sleep(2200);
  await api.hideDev();
  await api.clickSelector('.title-actions button', 'New Realm');
  await api.waitFor(() => window.__hd.scene === 'world', 6000, 'world scene');
  await sleep(3200);
  await music('after New Realm click (real pointerdown unlocked audio)');

  const pickRegion = async () => {
    const id = await api.eval(() => {
      const { world, state } = window.__hd;
      return world.regions.find((r) => state.owner[r.id] !== 0 && r.neighbors.some((n) => state.owner[n] === 0)).id;
    });
    const p = await api.eval((rid) => window.__hd.regionScreenPos(rid), id);
    await api.click(p.x, p.y);
    await sleep(1200);
    return id;
  };
  const regionId = await pickRegion();
  await shot('region-card');

  const action = await api.eval(() => document.querySelector('.region-card-action:not([hidden])')?.textContent || '');
  if (/attack/i.test(action)) await api.clickSelector('.region-card-action');
  else await api.eval((id) => window.__hd.startBattle(id), regionId);
  await api.waitFor(() => window.__hd.battlePhase === 'live', 12000, 'battle live');
  await sleep(900);
  await music('battle live');
  await api.eval(() => window.__hd.winBattle());
  await api.waitFor(() => { const c = document.querySelector('.results-card'); return c && !c.hidden; }, 14000, 'victory card');
  await music('victory sequence (stinger armed)');
  await sleep(2400); // the crowns land one by one
  await shot('victory-card');
  await music('victory card');
  await api.clickSelector('.results-action', 'Continue');
  await sleep(4200);
  await music('back on the map');

  // The conquered region's card shows its earned crowns; the map label wears its pips.
  const p2 = await api.eval((rid) => window.__hd.regionScreenPos(rid), regionId);
  await api.click(p2.x, p2.y);
  await sleep(1200);
  await shot('region-card-owned');
  await api.click(p2.x, p2.y); // toggles the selection off
  await sleep(700);
  await shot('world-pips');

  await api.clickSelector('.hud-btn[aria-label="Realm stats"]');
  await sleep(600);
  await shot('realm');
  await api.clickSelector('.realm-close');
  await sleep(300);
  await api.eval(() => window.__hd.openSettings());
  await sleep(500);
  await shot('settings-music');
  await api.clickSelector('.settings-close');
  await sleep(300);

  // Leaders: widen the realm to a rival border, let the first-contact line play on the map, then fight there.
  console.log(`[${label}hook] first contact + battle-start banners`);
  await api.eval(() => { window.__hd.state.settings.hints = false; window.__hd.state.tutorial.done = true; });
  const rival = await api.eval(() => {
    const hd = window.__hd;
    for (let i = 0; i < 14; i++) {
      const r = hd.world.regions.find((x) => hd.state.owner[x.id] >= 2 && x.neighbors.some((n) => hd.state.owner[n] === 0));
      if (r) return r.id;
      if (!hd.conquerRegions(1)) break;
    }
    return null;
  });
  if (rival == null) throw new Error('no rival border reachable');
  await api.eval((id) => window.__hd.flyToRegion(id, 14, 900), rival);
  await api.waitFor(() => { const b = document.querySelector('.leader-banner'); return b && b.dataset.state === 'in'; }, 9000, 'first-contact banner');
  await sleep(500);
  await shot('leader-contact');
  // Any other faction on the frontier would speak its own first-contact line as soon as the gap allows and
  // take the battle's slot: mark them all met, then let the 15 s gap between lines pass.
  await api.eval(() => { window.__hd.state.metFactions = window.__hd.world.factions.map((_, i) => i); });
  await sleep(16500);
  await api.eval((id) => window.__hd.startBattle(id), rival);
  await api.waitFor(() => window.__hd.battlePhase === 'live', 12000, 'rival battle live');
  await api.waitFor(() => { const b = document.querySelector('.leader-banner'); return b && b.dataset.state === 'in'; }, 5000, 'battle-start banner');
  await sleep(500);
  await shot('leader-battle');
  await music('rival battle');
  await api.eval(() => window.__hd.loseBattle());
  await sleep(2500);
  await shot('defeat-leader');
  await api.clickSelector('.results-action', 'Back');
  await sleep(1500);
}

// ---- Scout and Sabotage: unscouted card (free scout on the tutorial region), scouted card with a leader
// banner, maxed sabotage, the map with garrison badges + the weak-point ring + the torch, and the phone
// bottom-sheet heights, all driven by real input ----------------------------------------------------------
async function intelTour(api, tag) {
  const shot = (n) => api.shot(`${tag}${n}`);
  const label = tag || 'desktop-';
  const heights = {};
  const measure = async (what) => {
    heights[what] = await api.eval(() => {
      const dock = document.querySelector('.hd-dock');
      const card = document.querySelector('.region-card');
      const r = dock.getBoundingClientRect();
      return { dock: Math.round(r.height), content: Math.round(card.scrollHeight), share: +(r.height / innerHeight).toFixed(3), inner: innerHeight };
    });
    console.log(`  card height [${what}]`, JSON.stringify(heights[what]));
  };
  // The phone sheet scrolls: bring a button into view the way a thumb would before pressing it.
  const scrollTo = async (sel) => {
    await api.eval((q) => document.querySelector(q).scrollIntoView({ block: 'nearest' }), sel);
    await sleep(200);
  };
  console.log(`[${label}intel] setup`);
  await sleep(2200);
  await api.hideDev();
  await api.clickSelector('.title-actions button', 'New Realm');
  await api.waitFor(() => window.__hd.scene === 'world', 6000, 'world scene');
  await sleep(3200);

  // The free scout is the easiest tier-1 region: select it with a REAL click.
  const regionId = await api.eval(async () => {
    const { tutorialRegionId } = await import(new URL('game/meta/intel.js', document.baseURI).href);
    return tutorialRegionId(window.__hd.state, window.__hd.world);
  });
  const p = await api.eval((rid) => window.__hd.regionScreenPos(rid), regionId);
  await api.click(p.x, p.y);
  await sleep(1300);
  await shot('card-unscouted');
  await measure('unscouted');

  // Leader lines and hints would gate each other in a fresh tutorial: play the rest as a returning player.
  await api.eval(() => { window.__hd.state.settings.hints = false; window.__hd.state.tutorial.done = true; });
  await api.clickSelector('.intel-scout-btn');
  await sleep(1100);
  await shot('card-scouted');
  await measure('scouted');
  const chips = await api.eval(() => document.querySelectorAll('.intel-chip').length);
  console.log(`  chips revealed: ${chips}`);

  await api.eval(() => window.__hd.grantGold(60000));
  await sleep(300);
  await scrollTo('.intel-sabotage-btn');
  await api.clickSelector('.intel-sabotage-btn');
  await sleep(700);
  await measure('sabotaged once');
  await scrollTo('.intel-sabotage-btn');
  await api.clickSelector('.intel-sabotage-btn');
  await sleep(1200);
  await shot('card-maxed');
  await measure('sabotage maxed');
  const maxed = await api.eval(() => {
    const b = document.querySelector('.intel-sabotage-btn');
    return { disabled: b.disabled, label: b.textContent.trim(), level: window.__hd.state.intel[Object.keys(window.__hd.state.intel)[0]].sabotage };
  });
  console.log(`  maxed: ${JSON.stringify(maxed)}`);

  // The map: garrison badges, the ring on the weak point of the SELECTED scouted region, the torch by the name.
  // (No camera move here: the scene itself keeps the selected region clear of the card after each purchase.)
  await sleep(1400);
  await shot('map-marks');
  // Deselect (tap the region again): badges and torch stay, the ring goes.
  const p2 = await api.eval((rid) => window.__hd.regionScreenPos(rid), regionId);
  await api.click(p2.x, p2.y);
  await sleep(900);
  await shot('map-badges-only');
}

// ---- the living map: the same realm at prosperity 0 and III, caravans and smoke, a level-up celebration, the region
// card's prosperity line and a welcome-back that names the regions that prospered while the player was away ------------
async function livingTour(api, tag) {
  const shot = (n) => api.shot(`${tag}${n}`);
  const label = tag || 'desktop-';
  const phone = !!tag;
  console.log(`[${label}living] setup`);
  await sleep(2200);
  await api.hideDev();
  await api.clickSelector('.title-actions button', 'New Realm');
  await api.waitFor(() => window.__hd.scene === 'world', 6000, 'world scene');
  await sleep(3200);
  await api.eval(() => { const hd = window.__hd; hd.state.settings.hints = false; hd.state.tutorial.done = true; hd.lockAmbientQuality(1); hd.state.metFactions = hd.world.factions.map((_, i) => i); hd.conquerRegions(6); });
  await sleep(1500);
  const ids = await api.eval(() => window.__hd.state.owner.map((o, i) => (o === 0 ? i : -1)).filter((i) => i >= 0));
  const home = ids[0];
  // The owned region nearest the realm's centre, so the frame is filled with the realm, not with sea.
  const focus = await api.eval((list) => {
    const { world } = window.__hd;
    const cs = list.map((i) => world.regions[i].centroid);
    const cx = cs.reduce((a, c) => a + c.x, 0) / cs.length;
    const cy = cs.reduce((a, c) => a + c.y, 0) / cs.length;
    return list.slice().sort((p, q) => Math.hypot(world.regions[p].centroid.x - cx, world.regions[p].centroid.y - cy) - Math.hypot(world.regions[q].centroid.x - cx, world.regions[q].centroid.y - cy))[0];
  }, ids);
  const zoom = phone ? 15 : 21;
  await api.eval((id, z) => window.__hd.flyToRegion(id, z, 400), focus, zoom);
  await sleep(1500);
  await shot('living-level0');
  console.log('  ambient stats (level 0):', JSON.stringify(await api.eval(() => { const st = window.__hd.renderer.ambient.stats(); return { caravans: st.caravans && st.caravans.drawn, smokePlumes: st.smokePlumesDrawn, boats: st.boats, birds: st.birdsActive, totalMs: st.totalMs }; })));
  await api.sample(`${label}living-level0`, 2500);

  // Two and a half hours of tenure: level II, celebrated one region at a time.
  await api.eval(() => window.__hd.advanceTenure(2.5));
  await sleep(1100);
  await shot('living-levelup'); // "<Region> prospers!" and the shimmer while the chunks re-bake
  await sleep(6000);
  await shot('living-level2');
  await api.click(...(await api.eval((id) => { const p = window.__hd.regionScreenPos(id); return [p.x, p.y]; }, focus)));
  await sleep(1500);
  await shot('region-card-prosperity');
  console.log('  card:', await api.eval(() => (document.querySelector('.region-card-prosperity')?.innerText || '').replace(/\s+/g, ' ')));
  await api.click(...(await api.eval((id) => { const p = window.__hd.regionScreenPos(id); return [p.x, p.y]; }, focus))); // deselect
  // The click left the mouse over the region, and a hovered region draws the cream hover rim (PLAYFEEL §2, game/render/overlays.js
  // drawHover): intended, but it reads as a stray white outline in the frames below. Park the pointer over the sea.
  if (!phone) await api.page.mouse('mouseMoved', 70, 840, 'none', 0);

  // Eight hours: level III everywhere.
  await api.eval(() => window.__hd.advanceTenure(6));
  await sleep(7500);
  await shot('living-level3');
  await api.sample(`${label}living-level3`, 2500);
  console.log('  ambient stats (level 3):', JSON.stringify(await api.eval(() => { const st = window.__hd.renderer.ambient.stats(); return { caravans: st.caravans && st.caravans.drawn, smokePlumes: st.smokePlumesDrawn, windmills: st.windmills, boats: st.boats, birds: st.birdsActive, totalMs: st.totalMs }; })));

  // A closer look for the caravans (carts show from about 15 px per hex).
  const cz = phone ? 24 : 34;
  await api.eval((id, z) => window.__hd.flyToRegion(id, z, 400), home, cz);
  await sleep(1800);
  await shot('living-close');

  // Welcome-back: the levels were 0 when the player left and the tenure says III now.
  await api.eval((id, z) => window.__hd.flyToRegion(id, z, 300), focus, zoom);
  await api.eval(() => {
    const s = window.__hd.state;
    for (let i = 0; i < s.prosperity.length; i++) s.prosperity[i] = 0;
    s.lastSeen -= 3 * 3600 * 1000;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(1500);
  await shot('welcome-prospered');
  console.log('  welcome:', await api.eval(() => (document.querySelector('.welcome-card')?.innerText || '').replace(/\s+/g, ' ')));
  await api.clickSelector('.welcome-collect');
  await sleep(1500);
}

// ---- the release-candidate gallery (screenshots/game/rc-*.png): the frames a reader of the README or a reviewer wants, in one
// fresh-profile session with hints ON, real input for every step a player takes (dev hooks only to fast-forward: winning the
// tutorial battle, conquering regions, moving tenure back, granting gold). Desktop names are rc-<name>.png, phone rc-phone-<name>.png.
async function rcTour(api, tag) {
  const shot = (n) => api.shot(`${tag}${n}`);
  const label = tag || 'desktop-';
  const phone = !!tag;
  console.log(`[${label}rc] title`);
  await sleep(2600);
  await api.hideDev();
  await shot('title');

  console.log(`[${label}rc] first screen`);
  await api.clickSelector('.title-actions button', 'New Realm');
  await api.waitFor(() => window.__hd.scene === 'world', 6000, 'world scene');
  await sleep(2400);
  await shot('first-screen'); // hint 0 ("This is your realm")
  await api.waitFor(() => !!window.__hd.state.tutorial.seen.W0, 9000, 'hint W1');
  await sleep(900);
  await shot('move-and-zoom'); // W1: drag to move the map, scroll or pinch to zoom
  // a real pan and a real zoom, like the hint asks
  const vw = await api.eval(() => innerWidth);
  const vh = await api.eval(() => innerHeight);
  await api.drag({ x: vw * 0.5, y: vh * 0.62 }, { x: vw * 0.45, y: vh * 0.58 });
  await sleep(400);
  if (phone) {
    await api.page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: vw / 2 - 60, y: vh * 0.55, id: 1 }, { x: vw / 2 + 60, y: vh * 0.55, id: 2 }] });
    for (let i = 1; i <= 10; i++) { await api.page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: vw / 2 - 60 - i * 7, y: vh * 0.55, id: 1 }, { x: vw / 2 + 60 + i * 7, y: vh * 0.55, id: 2 }] }); await sleep(16); }
    await api.page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    for (let i = 0; i < 4; i++) { await api.page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: vw / 2, y: vh * 0.55, deltaX: 0, deltaY: -120 }); await sleep(60); }
  }
  await api.waitFor(() => !!window.__hd.state.tutorial.seen.W1, 4000, 'W1 seen');
  await sleep(1600);
  await shot('first-hint'); // W2: click a glowing region

  console.log(`[${label}rc] frontier card, Attack, the tutorial battle`);
  const id = await api.eval(async () => {
    const { tutorialRegionId } = await import(new URL('game/meta/intel.js', document.baseURI).href);
    return tutorialRegionId(window.__hd.state, window.__hd.world);
  });
  const p = await api.eval((rid) => window.__hd.regionScreenPos(rid), id);
  await api.click(p.x, p.y);
  await sleep(1500);
  await shot('frontier-card');
  await api.clickSelector('.region-card-action:not([hidden])');
  await api.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 14000, 'battle live');
  await sleep(2600); // the camp drops, hint 3 and the arrow appear
  await shot('tutorial-battle');
  // hold a real drag over the soft target: the arrow turns green (capture) and the tooltip says so
  const plan = await api.eval(() => {
    const hd = window.__hd;
    const arrow = hd.tutorialArrow();
    const info = hd.siteInfo();
    const from = arrow && info.find((s) => s.id === arrow.from);
    const to = arrow && info.find((s) => s.id === arrow.to);
    return from && to ? { from: { x: from.x, y: from.y + 4 }, to: { x: to.x, y: to.y + 4 } } : null;
  });
  if (plan) {
    if (phone) {
      await api.page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: plan.from.x, y: plan.from.y, id: 1 }] });
      for (let i = 1; i <= 14; i++) {
        await api.page.send('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ x: plan.from.x + ((plan.to.x - plan.from.x) * i) / 14, y: plan.from.y + ((plan.to.y - plan.from.y) * i) / 14, id: 1 }],
        });
        await sleep(16);
      }
      await sleep(250);
      await shot('tutorial-drag');
      await api.page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await api.page.mouse('mouseMoved', plan.from.x, plan.from.y, 'none', 0);
      await api.page.mouse('mousePressed', plan.from.x, plan.from.y, 'left', 1);
      for (let i = 1; i <= 14; i++) {
        await api.page.mouse('mouseMoved', plan.from.x + ((plan.to.x - plan.from.x) * i) / 14, plan.from.y + ((plan.to.y - plan.from.y) * i) / 14, 'left', 1);
        await sleep(14);
      }
      await sleep(250);
      await shot('tutorial-drag');
      await api.page.mouse('mouseReleased', plan.to.x, plan.to.y, 'left', 0);
    }
    await sleep(2400);
    await shot('battle-fight');
  }

  console.log(`[${label}rc] victory with crowns`);
  await api.eval(() => window.__hd.winBattle());
  await api.waitFor(() => { const c = document.querySelector('.results-card'); return c && !c.hidden && c.dataset.result === 'victory'; }, 20000, 'victory card');
  await sleep(3400); // the crowns land one by one
  await shot('victory-crowns');
  await api.clickSelector('.results-action');
  await api.waitFor(() => window.__hd.scene === 'world', 10000, 'world after Continue');
  await sleep(3000);
  await shot('after-victory');

  console.log(`[${label}rc] War Council with the Best value tag`);
  await api.clickSelector('.hud-btn', 'War Council');
  await sleep(1100);
  await shot('council');
  await api.clickSelector('.council-close');
  await sleep(500);

  console.log(`[${label}rc] scouted card`);
  const next = await api.eval(async () => {
    const { world, state } = window.__hd;
    const { difficulty } = await import(new URL('game/meta/progression.js', document.baseURI).href);
    const ids = world.regions.filter((r) => state.owner[r.id] !== 0 && r.neighbors.some((n) => state.owner[n] === 0)).map((r) => r.id);
    ids.sort((a, b) => difficulty(state, world, b).ratio - difficulty(state, world, a).ratio);
    return ids[0];
  });
  await api.eval(() => window.__hd.grantGold(3000)); // what ~a scout and a sabotage cost a little later in a real session
  const np = await api.eval((rid) => window.__hd.regionScreenPos(rid), next);
  await api.click(np.x, np.y);
  await sleep(1500);
  await api.eval(() => window.__hd.refreshCard());
  await sleep(500);
  const scout = await api.centerOf('.intel-scout-btn');
  if (scout) {
    await api.click(scout.x, scout.y);
    await sleep(1500);
  }
  await shot('scouted-card');

  console.log(`[${label}rc] mid-game realm with prosperity`);
  await api.eval(() => {
    const hd = window.__hd;
    hd.state.settings.hints = false;
    hd.state.tutorial.done = true;
    hd.state.metFactions = hd.world.factions.map((_, i) => i);
    hd.lockAmbientQuality(1);
    hd.conquerRegions(10);
    hd.advanceTenure(9);
  });
  await api.eval(() => window.__hd.services.goto.world({ freshRealm: false, resume: true }));
  await sleep(2000);
  const focus = await api.eval(() => {
    const hd = window.__hd;
    const ids = hd.world.regions.filter((r) => hd.state.owner[r.id] === 0).map((r) => r.id);
    const cs = ids.map((i) => hd.world.regions[i].centroid);
    const cx = cs.reduce((a, c) => a + c.x, 0) / cs.length;
    const cy = cs.reduce((a, c) => a + c.y, 0) / cs.length;
    return ids.slice().sort((a, b) => Math.hypot(hd.world.regions[a].centroid.x - cx, hd.world.regions[a].centroid.y - cy) - Math.hypot(hd.world.regions[b].centroid.x - cx, hd.world.regions[b].centroid.y - cy))[0];
  });
  await api.eval((rid, z) => window.__hd.flyToRegion(rid, z, 400), focus, phone ? 15 : 21);
  await sleep(7500); // chunks re-bake, caravans fill the roads
  if (!phone) await api.page.mouse('mouseMoved', 70, 840, 'none', 0); // the pointer parked over the sea: no hover rim
  await shot('midgame-realm');
}


/** Region Works (DESIGN 5.8) with REAL input: M3 in its three stages, the owned card, the chooser, demolish, the map marks and the Watchtower's free scout. */
async function worksTour(api, tag) {
  const phone = tag.startsWith('phone');
  const shot = (n) => api.shot(`${tag}${n}`);
  const tapAt = async (x, y) => (phone ? api.touchTap(x, y) : api.mouseClick(x, y));
  const tapSel = async (sel, text) => {
    const c = await api.centerOf(sel, text);
    if (!c) throw new Error(`nothing to press: ${sel} ${text || ''}`);
    await api.eval((q) => { const e = document.querySelector(q); if (e) e.scrollIntoView({ block: 'nearest' }); }, sel);
    await sleep(200);
    const c2 = await api.centerOf(sel, text);
    await tapAt(c2.x, c2.y);
  };
  console.log(`[${tag}works] setup`);
  await sleep(2200);
  await api.hideDev();
  await api.clickSelector('.title-actions button', 'New Realm');
  await api.waitFor(() => window.__hd.scene === 'world', 6000, 'world scene');
  await sleep(2600);
  // a realm that has fought three times: three conquests, the early hints seen (they would gate the Works hint), gold to build with
  await api.eval(() => {
    const hd = window.__hd;
    hd.conquerRegions(3);
    hd.advanceTenure(9); // nine hours of tenure: prosperity III, so all three Works slots are open
    hd.state.stats.battlesWon = 3;
    hd.state.tutorial.seen = { W0: true, W1: true, W2: true, W3: true, B1: true, B2: true, B3: true, B4: true, B5: true, C1: true, C2: true, C3: true, P1: true, P2: true, M1: true, M2: true };
    hd.state.settings.hints = true;
    hd.state.gold = 4000;
  });
  await sleep(4200); // the mists part, the first hint's 1.5 s gap
  await api.eval((z) => { const hd = window.__hd; hd.flyToRegion(hd.state.owner.findIndex((o, i) => o === 0 && i !== hd.world.startRegion), z, 500); }, phone ? 15 : 19);
  await sleep(1800);
  await shot('m3-stage1-region');
  const regionId = await api.eval(async () => {
    const { worksTutorialRegion } = await import(new URL('game/meta/works.js', document.baseURI).href);
    return worksTutorialRegion(window.__hd.state, window.__hd.world);
  });
  console.log('  M3 region', regionId);
  // select it with a real tap on its label (the hint's pointer is on it)
  const p1 = await api.eval((rid) => window.__hd.regionScreenPos(rid), regionId);
  await tapAt(p1.x, p1.y);
  await sleep(1500);
  await shot('m3-stage2-build');
  await tapSel('.works-build');
  await sleep(900);
  await shot('m3-stage3-barracks');
  // the chooser (the hint off so the picture is the panel)
  await api.eval(() => { window.__hd.state.settings.hints = false; });
  await sleep(600);
  await shot('chooser');
  await tapSel('.works-choice', 'Barracks');
  await sleep(1100);
  await shot('card-one-built');
  // a second and a third Work, an upgrade, so the card shows mixed levels
  await tapSel('.works-build');
  await sleep(500);
  await tapSel('.works-choice', 'Watchtower');
  await sleep(900);
  await tapSel('.works-upgrade:not([disabled])');
  await sleep(900);
  await shot('card-works');
  // demolish: the confirm step in the row
  await tapSel('.works-more');
  await sleep(700);
  await shot('demolish-confirm');
  await tapSel('.works-keep');
  await sleep(500);
  // the map: the buildings by the keep, at a zoom where they read
  await api.eval((rid, z) => { window.__hd.flyToRegion(rid, z, 400); }, regionId, phone ? 26 : 30);
  await sleep(2600);
  await shot('map-marks');
  // a Watchtower next to a hostile region: its card shows the garrisons with no purchase, and says who scouted
  const foeId = await api.eval(async () => {
    const { worksScoutedFree } = await import(new URL('game/meta/works.js', document.baseURI).href);
    const hd = window.__hd;
    const r = hd.world.regions.find((x) => hd.state.owner[x.id] !== 0 && worksScoutedFree(hd.state, hd.world, x.id));
    return r ? r.id : -1;
  });
  console.log('  free-scouted region', foeId);
  if (foeId >= 0) {
    await api.eval((rid, z) => window.__hd.flyToRegion(rid, z, 400), foeId, phone ? 14 : 17);
    await sleep(1800);
    const pf = await api.eval((rid) => window.__hd.regionScreenPos(rid), foeId);
    await tapAt(pf.x, pf.y);
    await sleep(1600);
    await shot('watchtower-scout');
  }
  console.log(`[${tag}works] done`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const only = flags.only || 'all';
  const world = only === 'all' || only === 'desktop' || only === 'phone';
  const battle = only === 'all' || only === 'battle';
  const hook = only === 'hook';
  const intel = only === 'intel';
  const living = only === 'living';
  const rc = only === 'rc';
  const works = only === 'works';
  if (world && only !== 'phone') {
    console.log('== desktop 1440x900 ==');
    await session({ width: 1440, height: 900, mobile: false }, (api) => tour(api, ''));
  }
  if (world && only !== 'desktop') {
    console.log('== phone 390x844 (touch) ==');
    await session({ width: 390, height: 844, mobile: true }, (api) => tour(api, 'phone-'));
  }
  if (rc) {
    console.log('== release-candidate gallery, desktop 1440x900 ==');
    await session({ width: 1440, height: 900, mobile: false }, (api) => rcTour(api, ''));
    console.log('== release-candidate gallery, phone 390x844 (touch) ==');
    await session({ width: 390, height: 844, mobile: true }, (api) => rcTour(api, 'phone-'));
  }
  if (living) {
    console.log('== living map, desktop 1440x900 ==');
    await session({ width: 1440, height: 900, mobile: false }, (api) => livingTour(api, ''));
    console.log('== living map, phone 390x844 (touch) ==');
    await session({ width: 390, height: 844, mobile: true }, (api) => livingTour(api, 'phone-'));
  }
  if (intel) {
    console.log('== intel, desktop 1440x900 ==');
    await session({ width: 1440, height: 900, mobile: false }, (api) => intelTour(api, ''));
    console.log('== intel, phone 390x844 (touch) ==');
    await session({ width: 390, height: 844, mobile: true }, (api) => intelTour(api, 'phone-'));
  }
  if (works) {
    console.log('== works, desktop 1440x900 ==');
    await session({ width: 1440, height: 900, mobile: false }, (api) => worksTour(api, ''));
    console.log('== works, phone 390x844 (touch) ==');
    await session({ width: 390, height: 844, mobile: true }, (api) => worksTour(api, 'phone-'));
  }
  if (hook) {
    console.log('== features, desktop 1440x900 ==');
    await session({ width: 1440, height: 900, mobile: false }, (api) => hookTour(api, ''));
    console.log('== features, phone 390x844 (touch) ==');
    await session({ width: 390, height: 844, mobile: true }, (api) => hookTour(api, 'phone-'));
  }
  if (battle) {
    console.log('== battle, desktop 1440x900 ==');
    await session({ width: 1440, height: 900, mobile: false }, (api) => battleTour(api, ''));
    console.log('== battle, phone 390x844 (touch) ==');
    await session({ width: 390, height: 844, mobile: true }, (api) => battleTour(api, 'phone-'));
  }
  await writeFile(`${OUT}/${PREFIX}-frametimes.json`, JSON.stringify(frameTimes, null, 2));
  if (errors.length) {
    console.log(`\nPAGE ERRORS (${errors.length}):`);
    for (const e of errors.slice(0, 20)) console.log('  ' + e);
    process.exit(1);
  }
  console.log('\nno page errors');
}

main().catch((e) => { console.error(e); process.exit(1); });
