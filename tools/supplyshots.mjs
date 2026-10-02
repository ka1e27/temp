// Supply lines and front lines, photographed with REAL input (DESIGN 4.3, 4.4): screenshots/game/supply-*.png, desktop and phone-.
//
//   npm start                          # in another terminal
//   node tools/supplyshots.mjs [--only=desktop|phone] [--seed=7] [--url=http://localhost:8080]
//
// Two battles per device, each picked from the real arenas of a mid-game realm by scanning them with the sim's own functions (nothing is faked in the arena):
//   A  the battle where a route from the War Camp crosses the most border-march corridor tiles (neutral land, untinted, dashed), so the standing line's
//      chevrons are seen following the corridor; the lesson hints are off and NO drag is in progress in the standing-line frames.
//   B  the battle with the most settlements the camp may not attack: the drag held over one is grey with "No route", letting go is refused and shakes,
//      and a line whose route has closed WAITS (a short grey stub with a pause mark; the stub is put in `battle.supply` through the dev hook, because the
//      front only closes a route when an intermediate settlement is lost).
// Every gesture is a real press: a Ctrl-drag with the mouse, a long press then a drag with a finger.
import { mkdir } from 'node:fs/promises';

if (!process.env.CHROME_PATH && process.platform === 'win32') process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('./cdp.js');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
const BASE = flags.url || 'http://localhost:8080';
const SEED = flags.seed || '7';
const OUT = flags.out || 'screenshots/game';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(OUT, { recursive: true });

const DEVICES = [
  { tag: 'desktop', w: 1440, h: 900, touch: false, prefix: 'supply-desk' },
  { tag: 'phone', w: 390, h: 844, touch: true, prefix: 'supply-phone' },
];

async function run(dev) {
  const { w: W, h: H, touch, prefix } = dev;
  console.log(`\n== ${dev.tag} ${W}x${H} ${touch ? 'touch' : 'mouse'} ==`);
  const page = await launch({ url: 'about:blank', width: W, height: H });
  const errors = [];
  page.on((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
    else if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push(p.args.map((a) => a.value ?? a.description).join(' '));
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: touch });
  if (touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const ev = (fn, ...a) => page.eval(fn, ...a);
  const shot = async (name) => { const f = `${OUT}/${prefix}-${name}.png`; await page.screenshot(f); console.log('  saved', f); };

  // --- real input --------------------------------------------------------------------------------------------------------------
  const tap = async (x, y) => {
    if (touch) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await sleep(70);
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse('mouseMoved', x, y, 'none', 0);
      await page.mouse('mousePressed', x, y, 'left', 1);
      await sleep(50);
      await page.mouse('mouseReleased', x, y, 'left', 0);
    }
  };
  /** A drag a -> b; `supply` makes it a supply gesture (Ctrl, or a long press first). Returns a function that lets go (so a frame can be taken mid-drag). */
  const hold = async (a, b, supply) => {
    const steps = 14;
    if (touch) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
      if (supply) {
        // the long press fires on the page's own timer: on a software rasteriser a big arena's frames are slow, so wait for the ring (armed) rather than for a fixed time
        for (let i = 0; i < 40; i++) { await sleep(100); if (await ev(() => window.__hd.supplyInfo().armed != null)) break; }
      }
      for (let i = 1; i <= steps; i++) { await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps, id: 1 }] }); await sleep(18); }
      await sleep(150);
      return async () => { await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
    }
    const m = supply ? 2 : 0;
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y, button: 'none', buttons: 0, modifiers: m });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1, modifiers: m });
    for (let i = 1; i <= steps; i++) { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps, button: 'left', buttons: 1, modifiers: m }); await sleep(14); }
    await sleep(150);
    return async () => { await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1, modifiers: m }); };
  };

  // --- a mid-game realm, lesson hints off ----------------------------------------------------------------------------------------
  await page.goto(`${BASE}/index.html?dev=1&seed=${SEED}`);
  for (let i = 0; i < 150; i++) { if (await ev(() => !!window.__hd && window.__hd.scene === 'title').catch(() => false)) break; await sleep(100); }
  await ev(() => window.__hd.hideDev(true));
  await sleep(1200);
  await ev(() => window.__hd.startNewRealm());
  for (let i = 0; i < 60; i++) { if (await ev(() => window.__hd.scene === 'world')) break; await sleep(100); }
  await sleep(600);
  await ev(() => { const hd = window.__hd; hd.conquerRegions(8); hd.state.settings.hints = false; hd.state.tutorial.done = true; hd.state.stats.battlesWon = 8; });
  await sleep(1200);

  /** Scans every frontier region's arena with the sim's own functions and picks by `score(battle, sim)`. */
  const pickRegion = (which) => ev(async (kind) => {
    const hd = window.__hd;
    const prog = await import(new URL('game/meta/progression.js', document.baseURI).href);
    const { buildArena } = await import(new URL('game/battle/arena.js', document.baseURI).href);
    const sim = await import(new URL('game/battle/sim.js', document.baseURI).href);
    let best = null;
    for (const id of prog.frontier(hd.state, hd.world)) {
      const pl = prog.playerBattleStats(hd.state, hd.world, id);
      const en = prog.enemyBattleStats(hd.world, hd.state, id);
      const b = sim.createBattle(buildArena(hd.world, hd.state.owner, id, pl, en), pl, en);
      const camp = b.sites.find((s) => s.type === 'camp');
      const linkSet = new Set(b.arena.tiles.filter((t) => t.link).map((t) => t.i));
      let score = 0;
      if (kind === 'corridor') {
        for (const s of b.sites) {
          if (s.owner === 0) continue;
          const r = sim.routeFor(b, 0, camp.id, s.id);
          if (r) score = Math.max(score, r.tiles.filter((t) => linkSet.has(t)).length * 100 + r.tiles.length);
        }
      } else {
        score = b.sites.filter((s) => s.owner !== 0 && !b.sites.some((o) => o.owner === 0 && sim.canRoute(b, 0, o.id, s.id))).length * 100 + b.sites.length;
      }
      if (!best || score > best.score) best = { id, score };
    }
    return best;
  }, which);
  const enter = async (id) => {
    await ev((rid) => window.__hd.startBattle(rid), id);
    for (let i = 0; i < 120; i++) { if (await ev(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live')) break; await sleep(150); }
    await sleep(1500);
  };
  const sitesNow = () => ev(async () => {
    const sim = await import(new URL('game/battle/sim.js', document.baseURI).href);
    const hd = window.__hd;
    const info = hd.siteInfo();
    const camp = info.find((s) => s.type === 'camp');
    const mine = info.filter((s) => s.owner === 0);
    const onScreen = (s) => s.y > 110 && s.y < innerHeight - 190 && s.x > 12 && s.x < innerWidth - 12;
    const reach = info.filter((s) => s.owner !== 0 && sim.canRoute(hd.battle, 0, camp.id, s.id)).map((s) => ({ ...s, len: sim.routeFor(hd.battle, 0, camp.id, s.id).tiles.length }));
    const cut = info.filter((s) => s.owner !== 0 && onScreen(s) && !mine.some((o) => sim.canRoute(hd.battle, 0, o.id, s.id)));
    return { camp, reach: reach.filter(onScreen).sort((a, b) => b.len - a.len), cut };
  });
  const leave = async () => { await ev(() => window.__hd.winBattle()); await sleep(800); await ev(() => window.__hd.goto.world({ cameFromBattle: true })); await sleep(1500); };

  // ---- battle A: a standing line that follows a route through corridors --------------------------------------------------------------
  const a = await pickRegion('corridor');
  console.log('  battle A (corridors) region', JSON.stringify(a));
  await enter(a.id);
  let s = await sitesNow();
  const far = s.reach[0];
  const from = { x: s.camp.x, y: s.camp.y + 4 };
  // the drag held over a reachable target: the glow on everything the drag could reach (frame 1, the release then sets the line)
  const release = await hold(from, { x: far.x, y: far.y + 4 }, true);
  await shot('1-drag-reach');
  await release();
  await sleep(4200); // two or three automatic sends have left: the chevrons flow and the squads walk the route
  await shot('2-line-standing');
  await sleep(1500);
  await shot('2b-line-standing-later');
  console.log('  lines', JSON.stringify(await ev(() => window.__hd.supplyInfo())));
  // the Auto toggle, on
  const autoAt = await ev(() => { const b = document.querySelector('.battle-auto'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await tap(autoAt.x, autoAt.y);
  await sleep(600);
  await shot('3-auto-on');
  await tap(autoAt.x, autoAt.y);
  await sleep(300);
  await leave();

  // ---- battle B: cut-off settlements, and a line that waits --------------------------------------------------------------------------
  const b = await pickRegion('blocked');
  console.log('  battle B (cut off) region', JSON.stringify(b));
  await enter(b.id);
  s = await sitesNow();
  console.log('  cut off on screen', s.cut.map((x) => x.id), 'reachable', s.reach.map((x) => x.id));
  const fromB = { x: s.camp.x, y: s.camp.y + 4 };
  if (s.cut.length) {
    const cut = s.cut[0];
    const rel = await hold(fromB, { x: cut.x, y: cut.y + 4 }, false);
    await shot('4-drag-no-route');
    await rel();
    await sleep(250);
    await shot('5-refused');
    await sleep(2800);
  }
  if (s.reach.length && s.cut.length) {
    // a real line to a reachable settlement first (azure chevrons), then the waiting one
    const near = s.reach[s.reach.length - 1];
    const rel2 = await hold(fromB, { x: near.x, y: near.y + 4 }, true);
    await rel2();
    await sleep(1500);
    // the route closes: the sim keeps the line, it waits (dev hook: the front would have to move)
    await ev((toId) => { const hd = window.__hd; const b = hd.battle; const l = b.supply.find((x) => x.from === 0); if (l) l.to = toId; }, s.cut[0].id);
    await sleep(900);
    console.log('  waiting line', JSON.stringify(await ev(async () => { const sim = await import(new URL('game/battle/sim.js', document.baseURI).href); const hd = window.__hd; const l = hd.battle.supply.map((x) => ({ from: x.from, to: x.to, route: !!sim.routeFor(hd.battle, 0, x.from, x.to) })); return l; })));
    await shot('6-line-waiting');
  }
  console.log('  errors', JSON.stringify(errors.slice(0, 3)));
  await page.close();
  return errors.length;
}

let bad = 0;
for (const dev of DEVICES) {
  if (flags.only && flags.only !== dev.tag) continue;
  bad += await run(dev);
}
console.log(bad ? `\n${bad} page error(s)` : '\nno page errors');
process.exit(bad ? 1 : 0);
