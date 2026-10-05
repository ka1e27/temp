// Phase 4 gallery (screenshots/phase4/): Goals and Rivals (docs/PLAN-PHASE4.md). The Bounty Board, a completed contract's seal toast, the streak's flame
// chip, the Deeds grid, the Trophy wall, a grudge meter (card and Regions panel), the Vendetta banner, the Champion in battle and its fall. Real game on
// seed 9; dev hooks only to set the stage. Desktop and phone (`p-`).
//
//   npm start
//   node tools/phase4shots.mjs [--variant=desktop|phone|both] [--url=http://localhost:8080] [--out=screenshots/phase4]
import { mkdir } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';

if (!process.env.CHROME_PATH && process.platform === 'win32') process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch: rawLaunch } = await import('./cdp.js');
// the gallery stages the Phase 4 systems in seconds: the first-hour pacing (app/pacer.js) would hold the streak chip and the Deeds back
const launch = async (opts) => { const page = await rawLaunch(opts); await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__HD_TEST_NO_PACING = true;' }); return page; };
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
const BASE = (flags.url || 'http://localhost:8080').replace(/\/$/, '');
const OUT = flags.out || 'screenshots/phase4';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = makeOpen(launch, sleep);
await mkdir(OUT, { recursive: true });

async function run(variant) {
  const phone = variant === 'phone';
  const P = phone ? 'p-' : '';
  const t = await open(`${BASE}/index.html?dev=1&seed=9`, phone ? { width: 390, height: 844, mobile: true } : { width: 1440, height: 900 });
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const shot = async (name) => { await t.page.screenshot(`${OUT}/${P}${name}.png`); console.log('shot', `${P}${name}`); };
  const close = () => q(() => { for (const s of ['.regions-close', '.realm-close']) { const b = document.querySelector(s); if (b && !b.closest('[hidden]')) b.click(); } });
  try {
    await t.atTitle();
    await t.clickText('button', 'New Realm');
    await t.waitFor(() => window.__hd.scene === 'world', 40000);
    await q(() => {
      const hd = window.__hd;
      hd.hideDev(true);
      hd.state.settings.hints = false;
      hd.state.stats.battlesWon = 3;
      hd.grantGold(20000);
      for (let i = 0; i < 2; i++) { const id = hd.world.regions.find((r) => hd.state.owner[r.id] !== 0 && r.neighbors.some((n) => hd.state.owner[n] === 0) && hd.state.owner[r.id] === 1)?.id; if (id != null) hd.conquerRegion(id, { hooks: true }); }
    });
    await sleep(2500);

    // the board
    await q(() => document.querySelector('.hud-regions').click());
    await sleep(900);
    await shot('board');
    await q(() => { const b = document.querySelector('.rivals-strip'); if (b) b.scrollIntoView({ block: 'center' }); });
    await sleep(300);
    await shot('grudge-regions-panel');
    await close();
    await sleep(400);

    // the streak chip (two quick conquests already) and a completed contract's seal toast
    const typed = await q(() => window.__hd.bounty('typed'));
    if (typed) {
      await q((type) => {
        const hd = window.__hd;
        const target = hd.world.regions.find((r) => hd.state.owner[r.id] !== 0 && r.type === type);
        if (!target) return;
        // a path to it, then the region itself
        const owned = (id) => hd.state.owner[id] === 0;
        const prev = new Map(); const queue = hd.world.regions.filter((r) => owned(r.id)).map((r) => r.id); for (const id of queue) prev.set(id, -1);
        while (queue.length && !target.neighbors.some(owned)) {
          const cur = queue.shift();
          for (const n of hd.world.regions[cur].neighbors) {
            if (prev.has(n) || n === target.id) continue; prev.set(n, cur);
            if (target.neighbors.includes(n)) { const chain = []; for (let x = n; x !== -1 && !owned(x); x = prev.get(x)) chain.unshift(x); for (const id of chain) hd.conquerRegion(id); queue.length = 0; break; }
            queue.push(n);
          }
        }
        hd.conquerRegion(target.id, { hooks: true });
      }, typed.contract.params.type);
      await sleep(phone ? 900 : 700);
      await shot('contract-complete-toast');
    }
    await sleep(4500);
    await shot('streak-chip');
    await t.page.screenshot(`${OUT}/${P}streak-chip-hud.png`, {});

    // a rival's region card with its grudge meter (raise it a little first)
    await q(() => {
      const hd = window.__hd;
      const id = hd.world.regions.find((r) => hd.state.owner[r.id] > 1 && r.neighbors.some((n) => hd.state.owner[n] === 0))?.id;
      if (id == null) return;
      const f = hd.state.owner[id];
      hd.state.grudges[String(f)] = { ...(hd.state.grudges[String(f)] || {}), value: 72, warnedAt: hd.state.frontier.activeSec, vendettaAt: null, orphanSince: null };
      hd.selectRegion(id);
    });
    await sleep(1400);
    await shot('grudge-card');
    await q(() => window.__hd.selectRegion(null));
    await sleep(500);

    // the Vendetta banner
    const raid = await q(() => { const r = window.__hd.vendetta(undefined, { sec: 12 }); return r && { id: r.id }; });
    if (raid) {
      await t.waitFor(() => !!document.querySelector('.toast.is-vendetta.is-in'), 8000);
      await sleep(5200); // the leader's line goes first on a phone
      await t.waitFor(() => !!document.querySelector('.toast.is-vendetta.is-in'), 8000);
      await sleep(600);
      await shot('vendetta-banner');
      await q(() => document.querySelector('.toast.is-vendetta .toast-action')?.click());
      await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 40000);
      await t.waitFor(() => window.__hd.battle.squads.some((s) => s.champion), 15000);
      // Phase 10B: a staged fight in which the Champion is seen. It marches out of the war band's camp as one big squad under its leader's
      // swallow-tailed pennant: the battle is paused the moment it is on the field and the camera closes in on it. Then the defense is held
      // standing (the war band is strong) and the Champion's squad dies on the keep's walls, with the camera on it when it falls.
      // where the Champion is: its squad on the march, or the site it holds (a camp with no way in: it waits there)
      const champ = () => q(async () => {
        const hd = window.__hd; const b = hd.battle; if (!b) return null;
        const sq = b.squads.find((s) => s.champion);
        if (sq) {
          const P = await import(new URL('game/battle/position.js', document.baseURI).href);
          const p = P.squadPosition(b, sq);
          const sp = hd.camera.worldToScreen(p.x, p.y);
          return { x: p.x, y: p.y, sx: sp.x, sy: sp.y, count: Math.round(sq.count), state: sq.state };
        }
        const site = b.sites.find((s) => s.champion);
        if (!site) return null;
        const sp = hd.screenPosOfSite(site.id);
        const w = hd.camera.screenToWorld(sp.x, sp.y);
        return { x: w.x, y: w.y, sx: sp.x, sy: sp.y, site: site.id, count: Math.round(site.troops) };
      });
      const look = (p) => q((x, y) => window.__hd.camera.flyTo({ x, y, zoom: 200 }, 200), p.x, p.y); // clamped to the battle's own zoom limit
      await t.waitFor(() => { const c = window.__hd.battle.champion; return !!c && c.launched; }, 20000);
      await sleep(1600); // on the march (or settled in its camp)
      await q(() => window.__hd.battles.setPaused(true));
      const c0 = await champ();
      if (c0) await look(c0);
      await sleep(700);
      console.log('  champion:', JSON.stringify(c0));
      await shot('champion');
      await q(() => { window.__p4hold = setInterval(() => { const b = window.__hd.battle; if (!b || b.result) return; for (const s of b.sites) if (s.owner === 0) s.troops = Math.max(s.troops, 1500); }, 300); });
      await q(() => window.__hd.battles.setPaused(false));
      // its fall, on camera: a marching Champion is struck down when it reaches the walls; one holding a site loses the site
      for (let i = 0; i < 40; i++) {
        const c = await champ();
        if (!c) break;
        await look(c);
        if (c.site != null) {
          // the camp it holds is overrun (staged: our troops take it outright; a marching Champion would die at the walls instead)
          await q((id) => { const st = window.__hd.battle.sites[id]; st.owner = 0; st.troops = 60; }, c.site);
          break;
        }
        if (c.state === 'fight' || i === 39) { await q(() => { const sq = window.__hd.battle.squads.find((s) => s.champion); if (sq) sq.count = 0.01; }); break; }
        await sleep(400);
      }
      await t.waitFor(() => { const b = document.querySelector('.battle-champion-banner'); return !!b && !b.hidden; }, 15000);
      await sleep(350);
      await shot('champion-fallen');
      await q(() => { clearInterval(window.__p4hold); window.__hd.winBattle(); });
      await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden; }, 30000);
      await sleep(1000);
      await t.clickText('.results-action', 'Continue');
      await t.waitFor(() => window.__hd.scene === 'world', 15000);
      await sleep(1500);
      await shot('trophy-toast');
    }

    // the Realm panel: the Trophy wall and the Deeds grid
    await q(() => document.querySelector('.hud-btn[aria-label="Realm stats"]').click());
    await sleep(900);
    await q(() => document.querySelector('.realm-trophies')?.scrollIntoView({ block: 'start' }));
    await sleep(300);
    await shot('trophy-wall');
    await q(() => document.querySelector('.realm-deeds')?.scrollIntoView({ block: 'start' }));
    await sleep(300);
    await shot('deeds-grid');
    await close();
  } catch (e) {
    console.error(variant, 'failed:', e && e.message);
  }
  await t.page.close();
}

const v = flags.variant || 'both';
if (v === 'desktop' || v === 'both') await run('desktop');
if (v === 'phone' || v === 'both') await run('phone');
process.exit(0);
