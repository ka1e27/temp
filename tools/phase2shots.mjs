// Phase 2 gallery (screenshots/phase2/): the Generals panel, the attack card with its commander picker, a battle with the ability button and its fx, a
// recruitment card, a Festival on the owned card, the tray with commanders. Real game; dev hooks only to set the stage. Desktop and phone (`p-`).
//
//   npm start
//   node tools/phase2shots.mjs [--variant=desktop|phone|both] [--url=http://localhost:8080] [--out=screenshots/phase2]
import { mkdir } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';

if (!process.env.CHROME_PATH && process.platform === 'win32') process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('./cdp.js');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
const BASE = (flags.url || 'http://localhost:8080').replace(/\/$/, '');
const OUT = flags.out || 'screenshots/phase2';
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
  await q(() => { const hd = window.__hd; hd.hideDev(true); hd.state.settings.hints = false; hd.state.stats.battlesWon = 3; hd.conquerRegions(5); hd.advanceTenure(1); hd.state.renown.points = 24; hd.state.renown.earned = 30; });
  await q(() => window.__hd.goto.world({ cameFromBattle: true }));
  await sleep(6000);

  let cap = null;
  await step('recruitment', async () => {
    cap = await q(async () => {
      const hd = window.__hd;
      const P2 = await import(new URL('game/meta/progression.js', document.baseURI).href);
      for (let i = 0; i < 40; i++) {
        const c = P2.attackableFrontier(hd.state, hd.world).find((id) => hd.world.regions[id].isCapital && hd.state.owner[id] >= 2);
        if (c != null) return c;
        if (!hd.conquerRegions(1)) break;
      }
      return null;
    });
    await q((id) => window.__hd.startBattle(id), cap);
    await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000);
    await sleep(800);
    await q(() => window.__hd.winBattle());
    await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden; }, 30000);
    await sleep(2200);
    await t.clickText('.results-action', 'Continue');
    await t.waitFor(() => !!document.querySelector('.is-recruit'), 15000);
    await sleep(1200);
    await shot('recruitment');
    await t.clickText('.modal-actions button', 'Welcome');
    await sleep(3000);
  });

  await step('generals panel', async () => {
    await q(() => { const r = window.__hd.state.generals.roster; r[0].level = 4; r[0].xp = 120; r[0].skills = [1]; });
    await t.clickSel('.hud-generals');
    await sleep(1200);
    await shot('generals-panel');
    await t.clickSel('.generals-close');
    await sleep(500);
  });

  await step('commander picker', async () => {
    const A = await q(async () => { const P2 = await import(new URL('game/meta/progression.js', document.baseURI).href); return P2.attackableFrontier(window.__hd.state, window.__hd.world)[0]; });
    await q((id) => window.__hd.selectRegion(id), A);
    await sleep(1500);
    await q(() => { const s = document.querySelector('.region-card-commander-select'); if (s) s.scrollIntoView({ block: 'center' }); });
    await sleep(400);
    await shot('card-commander');
  });

  await step('ability', async () => {
    await t.clickText('.region-card-action', 'Attack');
    await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000);
    await sleep(2500);
    await shot('battle-ability');
    await t.clickSel('.battle-ability');
    await sleep(350);
    await shot('battle-ability-fx');
  });

  await step('tray with commanders', async () => {
    await t.clickSel('.battle-map');
    await t.waitFor(() => window.__hd.scene === 'world', 8000);
    const B = await q(async () => { const P2 = await import(new URL('game/meta/progression.js', document.baseURI).href); return P2.attackableFrontier(window.__hd.state, window.__hd.world).find((id) => !window.__hd.battles.busy().regions.has(id)); });
    await q((id) => window.__hd.startBattle(id), B);
    await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live' && window.__hd.battles.list().length === 2, 30000);
    await sleep(2000);
    await shot('tray-commanders');
    for (const id of await q(() => window.__hd.battles.list().map((r) => r.id))) await q((x) => window.__hd.battles.remove(x), id);
    await q(() => window.__hd.goto.world({ cameFromBattle: true }));
    await sleep(2500);
  });

  await step('festival', async () => {
    const owned = await q(() => { const hd = window.__hd; return hd.world.regions.find((r) => hd.state.owner[r.id] === 0 && r.id !== hd.world.startRegion)?.id; });
    await q((id) => window.__hd.selectRegion(id), owned);
    await sleep(1500);
    await shot('festival-card');
    await t.clickSel('.region-card-festival');
    await sleep(600);
    await shot('festival-done');
  });
  console.log('errors', JSON.stringify(t.unexpected()));
  await t.page.close();
}

const v = flags.variant || 'both';
if (v === 'desktop' || v === 'both') await run('desktop');
if (v === 'phone' || v === 'both') await run('phone');
process.exit(0);
