// Phase 5 gallery (screenshots/phase5/): Dynasties that change the rules (docs/PLAN-PHASE5.md). Each page of the founding ceremony (the summary,
// the Legacy tree, the Edict cards with the D1 hint, the Challenges, the last page), the Realm panel's Edict, laurels and Legacy tree, the Quick
// Conquest button on an Easy card and its overlay. Real game on seed 7; dev hooks only to set the stage. Desktop and phone (`p-`).
//
//   npm start
//   node tools/phase5shots.mjs [--variant=desktop|phone|both] [--url=http://localhost:8080] [--out=screenshots/phase5]
import { mkdir } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';

if (!process.env.CHROME_PATH && process.platform === 'win32') process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('./cdp.js');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
const BASE = (flags.url || 'http://localhost:8080').replace(/\/$/, '');
const OUT = flags.out || 'screenshots/phase5';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = makeOpen(launch, sleep);
await mkdir(OUT, { recursive: true });

async function run(variant) {
  const phone = variant === 'phone';
  const P = phone ? 'p-' : '';
  const t = await open(`${BASE}/index.html?dev=1&seed=7`, phone ? { width: 390, height: 844, mobile: true } : { width: 1440, height: 900 });
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const shot = async (name) => { await t.page.screenshot(`${OUT}/${P}${name}.png`); console.log('shot', `${P}${name}`); };
  const next = async () => { await q(() => document.querySelector('.ceremony-next').click()); await sleep(450); };
  try {
    await t.atTitle();
    await t.clickText('button', 'New Realm');
    await t.waitFor(() => window.__hd.scene === 'world', 40000);
    await q(() => {
      const hd = window.__hd;
      hd.hideDev(true);
      hd.state.settings.hints = true; // the D1 hint on the Edict page
      hd.state.tutorial.seen = { M1: true };
      // lifetime records as a played realm would have them (the dev hooks take regions without fighting for them)
      Object.assign(hd.state.stats, { battlesWon: 12, battlesLost: 2, troopsSent: 4300, settlementsTaken: 58, crownsEarned: 19, surrenders: 3, playSec: 5400 });
      hd.grantLegacy(6); // a few points already held, so the tree shows every state
      hd.completeRealm();
    });
    await sleep(2500);
    await q(() => { window.__hd.services.ui.coach.update({ visible: false }); document.querySelector('.hud-btn[aria-label^="Realm"]').click(); });
    await sleep(700);
    await q(() => document.querySelector('.dynasty-found-btn').click());
    await sleep(900);
    await shot('ceremony-1-summary');
    await next();
    await q(() => document.querySelector('.ceremony .legacy-node[data-node="veteranCamp"] .legacy-buy').click());
    await sleep(400);
    await shot('ceremony-2-legacy');
    await next();
    await shot('ceremony-3-edicts-hint');
    await q(() => document.querySelector('.ceremony .edict-card').click());
    await sleep(300);
    await shot('ceremony-3-edict-picked');
    await next();
    await q(() => document.querySelector('.challenge-toggle[data-challenge="ironWill"]').click());
    await sleep(300);
    await shot('ceremony-4-challenges');
    await next();
    await shot('ceremony-5-found');
    await q(() => document.querySelector('.ceremony-found').click());
    await t.waitFor(() => window.__hd.state.dynasty.level === 2 && window.__hd.scene === 'world', 15000);
    await sleep(2600);
    await shot('new-continent');

    // the Realm panel: the Edict, its laurel, the Legacy
    await q(() => document.querySelector('.hud-btn[aria-label^="Realm"]').click());
    await sleep(800);
    await shot('realm-edict');
    await q(() => document.querySelector('.realm-legacy')?.scrollIntoView({ block: 'start' }));
    await sleep(300);
    await shot('realm-legacy');
    await q(() => document.querySelector('.realm-close').click());
    await sleep(400);

    // Quick Conquest on an Easy region
    const easy = await q(async () => {
      const hd = window.__hd;
      hd.grantLegacy(30);
      for (const id of ['oldRoads', 'masons', 'royalTreasury', 'quickConquest']) hd.dynasty.buy(id, 'realm');
      const U = await import(new URL('game/meta/upgrades.js', document.baseURI).href);
      const Q = await import(new URL('game/meta/quick.js', document.baseURI).href);
      const PR = await import(new URL('game/meta/progression.js', document.baseURI).href);
      // an Easy region that does not offer a surrender (a surrender replaces Attack and Quick Conquest on the card)
      const fit = (r) => Q.canQuickConquer(hd.state, hd.world, r.id, {}).ok && !PR.difficulty(hd.state, hd.world, r.id).surrender;
      hd.grantGold(1e8);
      hd.state.settings.hints = false;
      for (let i = 0; i < 24; i++) {
        const id = hd.world.regions.find(fit)?.id;
        if (id != null) return id;
        // stronger a level at a time (every upgrade at once makes the Easy regions surrender instead), and now and then one more region
        for (const u of Object.keys(U.UPGRADES)) U.buy(hd.state, u);
        if (i % 4 === 3) hd.conquerRegions(1);
      }
      return -1;
    });
    if (easy >= 0) {
      await q((id) => { window.__hd.flyToRegion(id, undefined, 1); window.__hd.selectRegion(id); }, easy);
      await sleep(1500);
      await shot('quick-button');
      await q(() => document.querySelector('.region-card-quick').click());
      await sleep(350);
      await shot('quick-overlay');
      await sleep(2500);
      await shot('quick-won');
    } else console.log('no Easy region for the Quick Conquest shots');
  } catch (e) {
    console.error(variant, 'failed:', e && e.message);
  }
  await t.page.close();
}

const v = flags.variant || 'both';
if (v === 'desktop' || v === 'both') await run('desktop');
if (v === 'phone' || v === 'both') await run('phone');
process.exit(0);
