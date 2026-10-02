// The README's two images, shot from the REAL game with real input: docs/img/realm.jpg (a mid-game realm, an owned region's card with
// its Works and prosperity) and docs/img/battle.jpg (a battle with a drag held over a settlement the camp can take: the green,
// check-marked "Capture" arrow). 1440x900 viewport, written as 1200x750 JPEGs. Retake them whenever the look changes.
//
//   npm start                                   # in another terminal
//   node tools/docshots.mjs [--seed=7] [--url=http://localhost:8080] [--out=docs/img] [--png=screenshots/game]
import { mkdir, writeFile } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';

if (!process.env.CHROME_PATH && process.platform === 'win32') process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('./cdp.js');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
const BASE = (flags.url || 'http://localhost:8080').replace(/\/$/, '');
const SEED = flags.seed || '7';
const OUT = flags.out || 'docs/img';
const PNG = flags.png || 'screenshots/game';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = makeOpen(launch, sleep);
await mkdir(OUT, { recursive: true });
await mkdir(PNG, { recursive: true });

const t = await open(`${BASE}/index.html?dev=1&seed=${SEED}`, { width: 1440, height: 900 });
const q = (fn, ...a) => t.page.eval(fn, ...a);
const shoot = async (name) => {
  const png = await t.page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${PNG}/doc-${name}.png`, Buffer.from(png.data, 'base64'));
  const jpg = await t.page.send('Page.captureScreenshot', { format: 'jpeg', quality: 86, clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1200 / 1440 } });
  await writeFile(`${OUT}/${name}.jpg`, Buffer.from(jpg.data, 'base64'));
  console.log('shot', `${OUT}/${name}.jpg`, `${PNG}/doc-${name}.png`);
};
// waits until no leader banner, no toast and no floating "prospers!" text is on screen (a clean frame)
const settle = async (ms = 30000) => {
  await t.waitFor(() => {
    const vis = (s) => [...document.querySelectorAll(s)].some((e) => e.getClientRects().length && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden' && +getComputedStyle(e).opacity > 0.05);
    return !vis('.leader-banner') && !vis('.toasts > .toast');
  }, ms);
  await sleep(3500); // the prosperity cheers on the canvas fade out with the banners
};

await t.atTitle();
await t.clickText('button', 'New Realm');
await t.waitFor(() => window.__hd.scene === 'world', 40000);
await q(() => { window.__hd.hideDev(true); });

// 1. the battle: the tutorial region, a 100% drag from the War Camp held over a settlement it can take ----------------------------------------------------
await q(() => { const s = window.__hd.state; s.settings.hints = false; });
const tid = await q(async () => { const I = await import(new URL('game/meta/intel.js', document.baseURI).href); return I.tutorialRegionId(window.__hd.state, window.__hd.world); });
await q((rid) => window.__hd.startBattle(rid), tid);
await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 40000);
await settle(15000);
const pick = await q(async () => {
  const hd = window.__hd; const sim = await import(new URL('game/battle/sim.js', document.baseURI).href);
  const info = hd.siteInfo(); const camp = info.find((s) => s.type === 'camp' && s.owner === 0);
  const onScreen = (s) => s.y > 140 && s.y < innerHeight - 200 && s.x > 60 && s.x < innerWidth - 60;
  const ok = info.filter((s) => s.owner !== 0 && onScreen(s) && sim.canRoute(hd.battle, 0, camp.id, s.id) && sim.previewSend(hd.battle, [camp.id], s.id, 1).outcome === 'capture')
    .sort((a, b) => Math.hypot(b.x - camp.x, b.y - camp.y) - Math.hypot(a.x - camp.x, a.y - camp.y)); // the longest arrow reads best
  return { camp: { x: camp.x, y: camp.y + 4 }, dest: ok[0] ? { x: ok[0].x, y: ok[0].y + 4 } : null };
});
if (pick.dest) {
  await t.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '4', code: 'Digit4', text: '4' });
  await t.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '4', code: 'Digit4' });
  await t.page.mouse('mouseMoved', pick.camp.x, pick.camp.y, 'none', 0);
  await t.page.mouse('mousePressed', pick.camp.x, pick.camp.y, 'left', 1);
  for (let i = 1; i <= 16; i++) { await t.page.mouse('mouseMoved', pick.camp.x + ((pick.dest.x - pick.camp.x) * i) / 16, pick.camp.y + ((pick.dest.y - pick.camp.y) * i) / 16, 'left', 1); await sleep(20); }
  await sleep(600);
  console.log('drag', JSON.stringify(await q(() => window.__hd.dragInfo())));
  await shoot('battle');
  await t.page.mouse('mouseReleased', pick.dest.x, pick.dest.y, 'left', 0);
} else console.log('no capturable target on screen: battle.jpg NOT retaken');
await sleep(800);
await q(() => window.__hd.winBattle());
await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden; }, 30000);
await sleep(1500);
await t.clickSel('.results-action', 'Continue');
await t.waitFor(() => window.__hd.scene === 'world', 20000);

// 2. a mid-game realm: ten regions, prosperity, an army that can take some of its frontier, Works on a border region ---------------------------------------
const picked = await q(async () => {
  const hd = window.__hd; const s = hd.state;
  hd.conquerRegions(9);
  Object.assign(s.upgrades, { recruitment: 26, steel: 24, armour: 20, logistics: 10, muster: 8, taxes: 16, treasury: 6, plunder: 6, rally: 3, firestorm: 2, bulwark: 1 });
  hd.advanceTenure(9);
  s.gold += 1e6;
  const W = await import(new URL('game/meta/works.js', document.baseURI).href);
  const owned = hd.world.regions.filter((r) => s.owner[r.id] === 0 && r.id !== hd.world.startRegion && r.neighbors.some((n) => s.owner[n] !== 0)).map((r) => r.id);
  let best = null;
  for (const id of owned) {
    if (W.buildWork(s, hd.world, id, 'barracks')) { W.buildWork(s, hd.world, id, 'watchtower'); W.upgradeWork(s, hd.world, id, 0); best = id; break; }
  }
  s.gold = 14250;
  return best;
});
await q(() => window.__hd.goto.world({ cameFromBattle: true }));
await settle();
if (picked != null) { await q((id) => window.__hd.selectRegion(id), picked); await sleep(1600); }
await settle(8000);
console.log('labels', JSON.stringify(await q(async () => { const P = await import(new URL('game/meta/progression.js', document.baseURI).href); const hd = window.__hd; return P.frontier(hd.state, hd.world).map((id) => P.difficulty(hd.state, hd.world, id).label); })));
await shoot('realm');
console.log('errors', JSON.stringify(t.unexpected()));
await t.page.close?.();
process.exit(0);
