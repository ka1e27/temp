// Phase 9 gallery (screenshots/phase9/): the five banner styles on the realm's flags (desktop, close up), and on a phone the Scenarios tab and a
// scenario's result screen with its stars. The check (`check.mjs --only=challenges`) writes the rest (hub tabs, playing, the Daily's result, the phone hub).
//   node tools/phase9shots.mjs [--url=http://localhost:8080]
import { mkdir } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';

if (!process.env.CHROME_PATH && process.platform === 'win32') process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch: rawLaunch } = await import('./cdp.js');
const launch = async (opts) => {
  const page = await rawLaunch(opts);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__HD_TEST_NO_BOON_MOMENTS = true; window.__HD_TEST_NO_PACING = true;' });
  return page;
};
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
const BASE = flags.url || 'http://localhost:8080';
const OUT = 'screenshots/phase9';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = makeOpen(launch, sleep);
await mkdir(OUT, { recursive: true });
const watchdog = setTimeout(() => { console.error('phase9shots: timeout'); process.exit(1); }, 8 * 60 * 1000);

// 1. the banner styles
{
  const t = await open(`${BASE}/index.html?dev=1&seed=7`, { width: 1200, height: 750 });
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  await t.atTitle();
  await q(() => window.__hd.startNewRealm());
  await t.waitFor(() => window.__hd.scene === 'world', 40000);
  await q(() => { const hd = window.__hd; hd.state.settings.hints = false; hd.conquerRegions(5); hd.revealMap(); hd.hideUI(true); hd.hideDev(true); hd.lockAmbientQuality(1); });
  await sleep(1500);
  for (const id of ['plain', 'gilded', 'ember', 'frost', 'ashenBone']) {
    await q(async (style) => {
      const S = await import(new URL('game/render/sprites.js', document.baseURI).href);
      S.setBannerStyle(style);
      const hd = window.__hd;
      const home = hd.state.owner.findIndex((o) => o === 0);
      hd.flyToRegion(home, 150, 10);
    }, id);
    await sleep(1400);
    await t.page.screenshot(`${OUT}/banner-${id}.png`);
    console.log(`  shot ${OUT}/banner-${id}.png`);
  }
  await t.page.close();
}

// 2. the phone: Scenarios and a scenario's result
{
  const t = await open(`${BASE}/index.html?dev=1&seed=7`, { width: 390, height: 844, mobile: true });
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  await t.atTitle();
  await q(() => window.__hd.startNewRealm());
  await t.waitFor(() => window.__hd.scene === 'world', 40000);
  await q(() => { const hd = window.__hd; hd.state.settings.hints = false; hd.conquerRegions(2); hd.hideDev(true); });
  await t.waitFor(() => !!window.__hd.challenge.kit, 15000);
  await q(() => window.__hd.challenge.openHub('scenarios'));
  await sleep(600);
  await t.page.screenshot(`${OUT}/phone-05-scenarios.png`);
  console.log(`  shot ${OUT}/phone-05-scenarios.png`);
  await q(() => window.__hd.challenge.play('scenario', 'gatekeeper'));
  await t.waitFor(() => window.__hd.challenge.active && window.__hd.scene === 'world', 10000);
  await sleep(1200);
  for (let i = 0; i < 6; i++) {
    if (await q(() => { const r = document.querySelector('.chr'); return !!r && !r.hidden; })) break;
    const id = await q(() => window.__hd.challengeNext());
    if (id == null) { await sleep(600); continue; }
    await q((r) => window.__hd.startBattle(r), id);
    await t.waitFor(() => window.__hd.scene === 'battle', 8000);
    await sleep(1500);
    await q(() => window.__hd.winBattle());
    await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden && c.getClientRects().length > 0; }, 20000);
    await sleep(500);
    await t.clickSel('.results-action', 'Continue');
    await t.waitFor(() => window.__hd.scene === 'world', 15000);
    await sleep(1500);
  }
  await sleep(600);
  await t.page.screenshot(`${OUT}/phone-06-scenario-result.png`);
  console.log(`  shot ${OUT}/phone-06-scenario-result.png`);
  await t.page.close();
}
clearTimeout(watchdog);
process.exit(0);
