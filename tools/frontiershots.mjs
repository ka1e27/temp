// The Living Frontier gallery (screenshots/frontier/): an incoming raid toast with the marching war band, the region's "Under attack" card, a defense battle
// with fortifications, the tray with two battles, an occupied region and its card, the retake, the Fortifications panel and the away report. Real game, dev
// hooks only to set the stage. Desktop 1440x900 and phone 390x844 (`p-` prefix).
//
//   npm start                                   # in another terminal
//   node tools/frontiershots.mjs [--variant=desktop|phone|both] [--url=http://localhost:8080] [--out=screenshots/frontier]
import { mkdir } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';

if (!process.env.CHROME_PATH && process.platform === 'win32') process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('./cdp.js');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
const BASE = (flags.url || 'http://localhost:8080').replace(/\/$/, '');
const OUT = flags.out || 'screenshots/frontier';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = makeOpen(launch, sleep);
await mkdir(OUT, { recursive: true });

async function run(variant) {
  const phone = variant === 'phone';
  const P = phone ? 'p-' : '';
  const t = await open(`${BASE}/index.html?dev=1&seed=7`, phone ? { width: 390, height: 844, mobile: true } : { width: 1440, height: 900 });
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const shot = async (name) => { await t.page.screenshot(`${OUT}/${P}${name}.png`); console.log('shot', `${P}${name}`); };
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('FAILED step', name, String(e && e.message).slice(0, 160)); } };
  await t.atTitle();
  await t.clickText('button', 'New Realm');
  await t.waitFor(() => window.__hd.scene === 'world', 40000);
  // the stage: a realm of several regions bordering rivals; the target has Walls and an Arrow Tower, a Barracks, some prosperity
  const T = await q(async () => {
    const hd = window.__hd;
    hd.hideDev(true);
    hd.state.settings.hints = false;
    hd.state.stats.battlesWon = 3;
    const F = await import(new URL('game/meta/frontier.js', document.baseURI).href);
    const FO = await import(new URL('game/meta/forts.js', document.baseURI).href);
    const W = await import(new URL('game/meta/works.js', document.baseURI).href);
    for (let i = 0; i < 12 && F.borderingRivals(hd.state, hd.world).length < 1; i++) hd.conquerRegions(1);
    hd.conquerRegions(2);
    const rivals = F.borderingRivals(hd.state, hd.world);
    const pair = rivals.flatMap((r) => r.pairs).find((p) => p.to !== hd.world.startRegion);
    hd.state.gold += 1e6;
    hd.advanceTenure(3);
    FO.buildFort(hd.state, hd.world, pair.to, 'walls');
    FO.buildFort(hd.state, hd.world, pair.to, 'tower');
    W.buildWork(hd.state, hd.world, pair.to, 'barracks');
    hd.state.gold = 4200;
    return pair.to;
  });
  await q(() => window.__hd.goto.world({ cameFromBattle: true }));
  await sleep(6000); // first-contact lines and prosperity cheers come and go

  await step('fortifications panel', async () => {
    await q((id) => window.__hd.selectRegion(id), T);
    await sleep(1500);
    await q(() => { const f = document.querySelector('.works-panel.is-forts'); if (f) f.scrollIntoView({ block: 'center' }); });
    await sleep(500);
    await shot('forts-panel');
    await q(() => window.__hd.selectRegion(null));
    await sleep(500);
  });

  await step('incoming', async () => {
    await q((to) => window.__hd.raid(to, { sec: 40, first: true }), T);
    await sleep(phone ? 6500 : 3500); // (a phone shows the leader line first)
    await shot('incoming-toast');
    await t.clickSel('.toast .toast-action');
    await sleep(1800);
    await shot('incoming-card');
  });

  await step('defense battle', async () => {
    await q(() => { const f = window.__hd.state.frontier; for (const r of f.incoming) r.arriveAt = f.activeSec + 0.5; });
    await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000);
    await sleep(6000);
    await shot('defense-battle');
  });

  await step('tray with two battles', async () => {
    await t.clickSel('.battle-map');
    await t.waitFor(() => window.__hd.scene === 'world', 8000);
    await sleep(2500);
    await shot('tray-map');
    const A = await q(async () => { const P = await import(new URL('game/meta/progression.js', document.baseURI).href); return P.attackableFrontier(window.__hd.state, window.__hd.world).find((id) => !window.__hd.battles.busy().regions.has(id)); });
    await q((id) => window.__hd.startBattle(id), A);
    await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live' && window.__hd.battles.list().length === 2, 30000);
    await sleep(2500);
    await shot('tray-two-battles');
  });

  await step('occupied', async () => {
    // switch back to the defense and lose it: the region is occupied
    const def = await q(() => window.__hd.battles.list().find((r) => r.kind === 'defense')?.id);
    if (def != null) { await q((id) => window.__hd.services.switchToBattle(id), def); await sleep(1500); }
    await q(() => window.__hd.loseBattle());
    await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden; }, 12000);
    await sleep(900);
    await shot('defense-lost');
    await t.clickText('.results-action', 'Back to Map');
    await t.waitFor(() => window.__hd.scene === 'world', 8000);
    await sleep(2000);
    await q((id) => window.__hd.selectRegion(id), T);
    await sleep(1600);
    await shot('occupied-card');
  });

  await step('retake', async () => {
    await t.clickText('.region-card-action', 'Retake');
    await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000);
    await sleep(3000);
    await shot('retake-battle');
    await q(() => window.__hd.winBattle());
    await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden && c.dataset.result === 'victory'; }, 30000);
    await sleep(2500);
    await t.clickText('.results-action', 'Continue');
    await t.waitFor(() => window.__hd.scene === 'world', 12000);
    await sleep(4000);
    await q((id) => window.__hd.selectRegion(id), T);
    await sleep(1500);
    await shot('retaken-card');
    await q(() => window.__hd.selectRegion(null));
  });

  await step('away report', async () => {
    // five hours away, out of grace: the gentle trickle of raids resolved on return, on the welcome card
    for (const r of await q(() => window.__hd.battles.list().map((x) => x.id))) await q((id) => window.__hd.battles.remove(id), r);
    await q(() => { const s = window.__hd.state; s.frontier.activeSec = Math.max(s.frontier.activeSec, 3600); s.frontier.cooldown = {}; s.lastSeen = Date.now() - 5 * 3600 * 1000; });
    await q(() => document.dispatchEvent(new Event('visibilitychange')));
    await t.waitFor(() => { const w = document.querySelector('.welcome-away'); return !!w && !w.hidden; }, 6000);
    await sleep(1200);
    await shot('away-report');
  });
  console.log('errors', JSON.stringify(t.unexpected()));
  await t.page.close();
}

const v = flags.variant || 'both';
if (v === 'desktop' || v === 'both') await run('desktop');
if (v === 'phone' || v === 'both') await run('phone');
process.exit(0);
