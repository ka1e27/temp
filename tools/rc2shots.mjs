// Release-candidate 2 gallery: the screens the README and the store page talk about, shot from the REAL game with real input
// (screenshots/game/rc2-*.png for desktop, rc2-p-*.png for a phone). Title, the first screen with the W2 hint and the outlined region, the tutorial battle
// with the shape-coded arrow, the victory card with its crowns, a mid-game realm with Works and prosperity, the Regions list, a scouted card, the Realm panel
// with the Chronicle, and the Tapestry PNG.
//
//   npm start                                   # in another terminal
//   node tools/rc2shots.mjs [--variant=desktop|phone|both] [--seed=7] [--url=http://localhost:8080] [--out=screenshots/game]
import { mkdir, writeFile } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';

if (!process.env.CHROME_PATH && process.platform === 'win32') process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('./cdp.js');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
const BASE = (flags.url || 'http://localhost:8080').replace(/\/$/, '');
const SEED = flags.seed || '7';
const OUT = flags.out || 'screenshots/game';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = makeOpen(launch, sleep);
await mkdir(OUT, { recursive: true });

async function run(variant) {
  const phone = variant === 'phone';
  const dims = phone ? { width: 390, height: 844, mobile: true } : { width: 1440, height: 900 };
  const P = phone ? 'rc2-p-' : 'rc2-';
  const t = await open(`${BASE}/index.html?dev=1&seed=${SEED}`, dims);
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const shot = async (name) => { await t.page.screenshot(`${OUT}/${P}${name}.png`); console.log('shot', `${P}${name}`); };
  const press = async (x, y) => {
    if (phone) { await t.page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await sleep(70); await t.page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else { await t.page.mouse('mouseMoved', x, y, 'none', 0); await t.page.mouse('mousePressed', x, y, 'left', 1); await sleep(60); await t.page.mouse('mouseReleased', x, y, 'left', 0); }
  };
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('FAILED step', name, String(e && e.message).slice(0, 160)); } };

  // 1. title ----------------------------------------------------------------------------------------------------------------------------------------------
  await t.atTitle();
  await sleep(2500);
  await shot('title');
  await t.clickText('button', 'New Realm');
  await t.waitFor(() => window.__hd.scene === 'world', 40000);

  // 2. the first screen with the W2 hint and the outlined region ------------------------------------------------------------------------------------------
  await step('first screen', async () => {
    await q(() => { const seen = window.__hd.state.tutorial.seen; seen.W0 = true; seen.W1 = true; });
    await t.waitFor(() => /glowing region/i.test((document.querySelector('.coach:not([hidden]) .coach-text') || {}).textContent || ''), 40000);
    await sleep(1800);
    await shot('first-screen-w2');
  });

  // 3. the tutorial battle: hold a drag over a target the camp can take, the arrow turns green with a check -------------------------------------------------
  await step('tutorial battle', async () => {
    const id = await q(async () => { const I = await import(new URL('game/meta/intel.js', document.baseURI).href); return I.tutorialRegionId(window.__hd.state, window.__hd.world); });
    await q((rid) => window.__hd.startBattle(rid), id);
    await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 40000);
    await sleep(2500);
    const pick = await q(async () => {
      const hd = window.__hd; const sim = await import(new URL('game/battle/sim.js', document.baseURI).href);
      const info = hd.siteInfo(); const camp = info.find((s) => s.type === 'camp' && s.owner === 0);
      const onScreen = (s) => s.y > 130 && s.y < innerHeight - 190 && s.x > 20 && s.x < innerWidth - 20;
      const ok = info.filter((s) => s.owner !== 0 && onScreen(s) && sim.canRoute(hd.battle, 0, camp.id, s.id) && sim.previewSend(hd.battle, [camp.id], s.id, 1).outcome === 'capture').sort((a, b) => a.troops - b.troops);
      return { camp: { x: camp.x, y: camp.y + 4 }, dest: ok[0] ? { x: ok[0].x, y: ok[0].y + 4 } : null };
    });
    if (!pick.dest) { console.log('no capturable target on screen for the arrow shot'); await shot('tutorial-battle'); return; }
    await t.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '4', code: 'Digit4', text: '4' });
    await t.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '4', code: 'Digit4' });
    if (phone) {
      await t.page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pick.camp.x, y: pick.camp.y, id: 1 }] });
      for (let i = 1; i <= 14; i++) { await t.page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pick.camp.x + ((pick.dest.x - pick.camp.x) * i) / 14, y: pick.camp.y + ((pick.dest.y - pick.camp.y) * i) / 14, id: 1 }] }); await sleep(20); }
      await sleep(500);
      await shot('tutorial-battle-arrow');
      await t.page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await t.page.mouse('mouseMoved', pick.camp.x, pick.camp.y, 'none', 0);
      await t.page.mouse('mousePressed', pick.camp.x, pick.camp.y, 'left', 1);
      for (let i = 1; i <= 14; i++) { await t.page.mouse('mouseMoved', pick.camp.x + ((pick.dest.x - pick.camp.x) * i) / 14, pick.camp.y + ((pick.dest.y - pick.camp.y) * i) / 14, 'left', 1); await sleep(20); }
      await sleep(500);
      await shot('tutorial-battle-arrow');
      await t.page.mouse('mouseReleased', pick.dest.x, pick.dest.y, 'left', 0);
    }
    await sleep(1500);
  });

  // 4. the victory card with its crowns, then Continue (the Chronicle gets its first line) -----------------------------------------------------------------
  await step('victory', async () => {
    await q(() => window.__hd.winBattle());
    await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden && c.dataset.result === 'victory'; }, 30000);
    await t.waitFor(() => document.querySelectorAll('.results-card .crown-slot[data-state="earned"]').length >= 1, 8000);
    await sleep(2200);
    await shot('victory-crowns');
    await t.clickSel('.results-action', 'Continue');
    await t.waitFor(() => window.__hd.scene === 'world', 20000);
    await sleep(2000);
  });

  // 5. a mid-game realm: a dozen regions, prosperity III, Works built, the card of a region with its Works --------------------------------------------------
  await step('mid-game realm', async () => {
    await q(() => { const hd = window.__hd; hd.state.settings.hints = false; hd.conquerRegions(9); hd.grantGold(500000); });
    await sleep(800);
    await q(() => window.__hd.advanceTenure(9));
    const picked = await q(async () => {
      const hd = window.__hd;
      const W = await import(new URL('game/meta/works.js', document.baseURI).href);
      const owned = hd.world.regions.filter((r) => hd.state.owner[r.id] === 0 && r.id !== hd.world.startRegion && r.neighbors.some((n) => hd.state.owner[n] !== 0)).map((r) => r.id);
      let best = null;
      for (const id of owned) {
        const a = W.buildWork(hd.state, hd.world, id, 'barracks');
        if (a) { W.buildWork(hd.state, hd.world, id, 'watchtower'); W.buildWork(hd.state, hd.world, id, 'market'); W.upgradeWork(hd.state, hd.world, id, 0); best = id; break; }
      }
      return best;
    });
    console.log('works built in region', picked);
    await q(() => window.__hd.goto.world({ cameFromBattle: true }));
    await sleep(9000); // the rivals' first-contact lines and the prosperity cheers have come and gone: a clean map
    await shot('midgame-realm');
    if (picked != null) {
      await q((id) => window.__hd.selectRegion(id), picked);
      await sleep(1400);
      await shot('midgame-works-card');
      await q(() => window.__hd.selectRegion(null));
      await sleep(500);
    }
  });

  // 6. the Regions list ------------------------------------------------------------------------------------------------------------------------------------
  await step('regions list', async () => {
    await t.clickSel('button[aria-label="Regions list"]');
    await sleep(1000);
    await shot('regions-list');
    await t.clickSel('.regions-close');
    await sleep(500);
  });

  // 7. a scouted card ------------------------------------------------------------------------------------------------------------------------------------
  await step('scouted card', async () => {
    const fid = await q(async () => { const P = await import(new URL('game/meta/progression.js', document.baseURI).href); return P.attackableFrontier(window.__hd.state, window.__hd.world)[0]; });
    await q((id) => window.__hd.selectRegion(id), fid);
    await sleep(1000);
    await t.clickSel('.intel-scout-btn');
    await sleep(1400);
    await shot('scouted-card');
    await q(() => window.__hd.selectRegion(null));
    await sleep(500);
  });

  // 8. the Realm panel with the Chronicle -----------------------------------------------------------------------------------------------------------------
  await step('realm chronicle', async () => {
    await t.clickSel('button[aria-label="Realm stats"]');
    await sleep(1200);
    await shot('realm-chronicle');
    await t.clickSel('.realm-close');
    await sleep(400);
  });

  // 9. the Tapestry PNG, composed by the game's own code ----------------------------------------------------------------------------------------------------
  await step('tapestry', async () => {
    const b64 = await q(async (isPhone) => {
      const hd = window.__hd;
      const { CHRONICLE } = await import(new URL('game/config/chronicle.js', document.baseURI).href);
      const wi = await import(new URL('game/scenes/worldImage.js', document.baseURI).href);
      const tp = await import(new URL('game/render/tapestry.js', document.baseURI).href);
      const ks = await import(new URL('game/meta/keepsake.js', document.baseURI).href);
      await tp.ensureTapestryFonts(1500);
      // the width (and scale) the game's own saveTapestry uses on this kind of screen (scenes/worldImage.js)
      const mapCanvas = wi.renderWorldImage({ world: hd.world, state: hd.state, width: isPhone ? CHRONICLE.tapestryWidth.phone : CHRONICLE.tapestryWidth.desktop, scale: 2 });
      const canvas = tp.composeTapestry({ mapCanvas, ...ks.tapestryData(hd.state, hd.world, Date.now()) });
      return canvas.toDataURL('image/png').split(',')[1];
    }, phone);
    await writeFile(`${OUT}/${P}tapestry.png`, Buffer.from(b64, 'base64'));
    console.log('wrote', `${P}tapestry.png`, Buffer.from(b64, 'base64').length, 'bytes');
  });

  await t.page.close();
}

const which = flags.variant || 'both';
if (which === 'desktop' || which === 'both') await run('desktop');
if (which === 'phone' || which === 'both') await run('phone');
process.exit(0);
