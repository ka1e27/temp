// Phase 8 gallery (PLAN-PHASE8 §8C content UI): the new world events' toasts (Deserters with its two choices, the Harvest Festival with its price),
// a Boon draft of new Boons, the Realm strip and Reliquary with the new marks, and a battle with the Vanguard / War Drums pops. Desktop and phone.
//   node tools/phase8shots.mjs [--url=http://localhost:8080] [--variant=desktop|phone|both]
// The Codex frames come from tools/codexChecks.mjs (check.mjs --only=codex). Dev hooks only set the stage; presses are real where they matter.
import { mkdir } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';

if (!process.env.CHROME_PATH && process.platform === 'win32') process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch: rawLaunch } = await import('./cdp.js');
const launch = async (o) => { const p = await rawLaunch(o); await p.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__HD_TEST_NO_BOON_MOMENTS = true;' }); return p; };
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
const BASE = flags.url || 'http://localhost:8080';
const OUT = 'screenshots/phase8';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(OUT, { recursive: true });
const open = makeOpen(launch, sleep);
const watchdog = setTimeout(() => { console.error('phase8shots: timeout'); process.exit(1); }, 8 * 60 * 1000);

async function run(name, size) {
  const t = await open(`${BASE}/index.html?dev=1&seed=7`, size);
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const shot = async (n) => { await t.page.screenshot(`${OUT}/${name}-${n}.png`); console.log(`shot ${OUT}/${name}-${n}.png`); };
  const step = async (n, fn) => { try { await fn(); } catch (e) { console.log(`step ${n} failed: ${e && e.message}`); } };
  await t.atTitle();
  await t.clickText('button', 'New Realm');
  await t.waitFor(() => window.__hd.scene === 'world', 40000);
  await q(() => { const hd = window.__hd; hd.hideDev(true); hd.state.settings.hints = false; hd.conquerRegions(6); hd.grantGold(20000); hd.state.stats.battlesWon = 6; for (const id of ['rally', 'firestorm', 'bulwark', 'march', 'levy']) hd.state.upgrades[id] = 2; });
  await sleep(1500);
  await step('deserters', async () => { await q(() => window.__hd.offerEvent('deserters')); await sleep(900); await shot('01-event-deserters'); await q(() => { const ev = window.__hd.state.worldEvents.pending; if (ev) window.__hd.events.answer(ev.id, 'muster'); }); await sleep(900); await shot('02-deserters-muster'); });
  await step('harvest', async () => { await sleep(2600); await q(() => window.__hd.offerEvent('harvest')); await sleep(900); await shot('03-event-harvest'); });
  await step('draft', async () => {
    await q(() => { const ev = window.__hd.state.worldEvents.pending; if (ev) window.__hd.events.answer(ev.id, 'decline'); });
    await sleep(600);
    await q(() => window.__hd.offerBoons(['vanguard', 'warDrums', 'lastStand']));
    await q(() => window.__hd.boons.openPending && window.__hd.boons.openPending());
    await sleep(900);
    await shot('04-draft-new-boons');
    await q(() => window.__hd.offerBoons(['towerSappers', 'cartographer', 'spoilsOfWar']));
    await q(() => window.__hd.boons.openPending && window.__hd.boons.openPending());
    await sleep(700);
    await shot('05-draft-new-boons-2');
    await t.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await t.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  });
  await step('realm', async () => {
    await q(() => {
      const hd = window.__hd;
      hd.grantBoons(['vanguard', 'warDrums', 'supplyWagons', 'towerSappers', 'rearguard', 'spoilsOfWar', 'lastStand', 'cartographer']);
      const r = hd.state.reliquary || (hd.state.reliquary = { v: 1, found: [] });
      for (const id of ['merchantsScale', 'wardensBell', 'twinCrowns', 'sealOfMargrave']) if (!r.found.includes(id)) r.found.push(id);
      hd.state.relics.owned = ['merchantsScale', 'twinCrowns'];
    });
    await sleep(400);
    await t.clickSel('.hud-btn[aria-label="Realm stats"]');
    await sleep(900);
    await shot('06-realm-strip');
    await q(() => { const e = document.querySelector('.reliquary'); if (e) e.scrollIntoView({ block: 'center' }); });
    await sleep(500);
    await shot('07-reliquary');
    await t.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await t.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(500);
  });
  await step('battle pops', async () => {
    const id = await q(async () => { const { frontier } = await import(new URL('game/meta/progression.js', document.baseURI).href); const hd = window.__hd; return frontier(hd.state, hd.world)[0]; });
    await q((x) => { window.__hd.selectRegion(null); window.__hd.startBattle(x); }, id);
    await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000);
    await sleep(1200);
    // a real drag from the War Camp: Vanguard's pop on the first squad
    const pts = await q(() => { const hd = window.__hd; const b = hd.battle; const camp = b.sites.find((s) => s.type === 'camp' && s.owner === 0); const tgt = b.sites.filter((s) => s.owner !== 0).sort((a, c) => Math.hypot(hd.world.tiles[a.tile].x - hd.world.tiles[camp.tile].x, hd.world.tiles[a.tile].y - hd.world.tiles[camp.tile].y) - Math.hypot(hd.world.tiles[c.tile].x - hd.world.tiles[camp.tile].x, hd.world.tiles[c.tile].y - hd.world.tiles[camp.tile].y))[0]; return { a: hd.screenPosOfSite(camp.id), b: hd.screenPosOfSite(tgt.id) }; });
    if (size.mobile) {
      await t.page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts.a.x, y: pts.a.y, id: 1 }] });
      for (let k = 1; k <= 10; k++) { await t.page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pts.a.x + ((pts.b.x - pts.a.x) * k) / 10, y: pts.a.y + ((pts.b.y - pts.a.y) * k) / 10, id: 1 }] }); await sleep(20); }
      await t.page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await t.page.drag(pts.a, pts.b, 12);
    await sleep(500);
    await shot('08-battle-vanguard');
    await t.clickSel('.power-btn');
    await sleep(300);
    await shot('09-battle-war-drums');
    console.log('boonFx', JSON.stringify(await q(() => window.__hd.boonFxInfo())));
  });
  await t.page.close();
}

const v = flags.variant || 'both';
if (v !== 'phone') await run('desktop', { width: 1440, height: 900 });
if (v !== 'desktop') await run('phone', { width: 390, height: 844, mobile: true });
clearTimeout(watchdog);
process.exit(0);
