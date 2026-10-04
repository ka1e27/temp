// Phase 3 gallery (screenshots/phase3/): a varied map (DESIGN 10.13). Each region type on the map and on its card, each twist in battle (Night, Blizzard,
// Flooded, Holy Ground, Siege with its Gate, Raid with its Shrines), the Dragon with its telegraph, each world event's toast (and the Merchant's deals,
// the Plague's tint, the Duel and its card), and Dragonscale in the Realm panel. Real game on seed 9 (every type and twist); dev hooks only to set
// the stage. Desktop and phone (`p-`).
//
//   npm start
//   node tools/phase3shots.mjs [--variant=desktop|phone|both] [--only=map,cards,twists,dragon,events,realm] [--url=http://localhost:8080] [--out=screenshots/phase3]
import { mkdir } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';

if (!process.env.CHROME_PATH && process.platform === 'win32') process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('./cdp.js');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
const BASE = (flags.url || 'http://localhost:8080').replace(/\/$/, '');
const OUT = flags.out || 'screenshots/phase3';
const ONLY = flags.only ? new Set(flags.only.split(',')) : null;
const want = (k) => !ONLY || ONLY.has(k);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = makeOpen(launch, sleep);
await mkdir(OUT, { recursive: true });

/** In the page: helpers on window.__p3 (conquer a path to a region, start a battle there, tidy up). */
const HELPERS = () => {
  const hd = window.__hd;
  const P = 0; // PLAYER_FACTION
  window.__p3 = {
    /** Conquers the shortest chain of regions from the realm to a neighbour of `target`, so `target` is on the frontier. */
    reach(target) {
      const w = hd.world;
      const owned = (id) => hd.state.owner[id] === P;
      if (w.regions[target].neighbors.some(owned)) return true;
      const prev = new Map();
      const queue = w.regions.filter((r) => owned(r.id)).map((r) => r.id);
      for (const id of queue) prev.set(id, -1);
      while (queue.length) {
        const cur = queue.shift();
        for (const n of w.regions[cur].neighbors) {
          if (prev.has(n) || n === target) continue;
          prev.set(n, cur);
          if (w.regions[target].neighbors.includes(n)) {
            const chain = [];
            for (let x = n; x !== -1 && !owned(x); x = prev.get(x)) chain.unshift(x);
            for (const id of chain) hd.conquerRegion(id);
            return true;
          }
          queue.push(n);
        }
      }
      return false;
    },
    clear() { for (const r of hd.battles.list()) hd.battles.remove(r.id); },
    find(pred) { return hd.world.regions.find(pred)?.id ?? null; },
  };
  return true;
};

async function run(variant) {
  const phone = variant === 'phone';
  const P = phone ? 'p-' : '';
  const t = await open(`${BASE}/index.html?dev=1&seed=9`, phone ? { width: 390, height: 844, mobile: true } : { width: 1440, height: 900 });
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const shot = async (name) => { await t.page.screenshot(`${OUT}/${P}${name}.png`); console.log('shot', `${P}${name}`); };
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('FAILED step', name, String(e && e.message).slice(0, 200)); } };
  const toWorld = async () => {
    await q(() => { window.__p3.clear(); window.__hd.goto.world({ cameFromBattle: true }); });
    await t.waitFor(() => window.__hd.scene === 'world', 10000);
    await sleep(1800);
  };
  const battleAt = async (pred, waitMs = 3500) => {
    const id = await q((src) => { const f = new Function('r', `return (${src})(r)`); const id = window.__p3.find(f); if (id == null) return null; window.__p3.reach(id); return id; }, pred.toString());
    if (id == null) throw new Error(`no region for ${pred}`);
    await q((x) => { window.__hd.selectRegion(null); window.__hd.startBattle(x); }, id);
    await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000);
    await sleep(waitMs);
    return id;
  };
  await t.atTitle();
  await t.clickText('button', 'New Realm');
  await t.waitFor(() => window.__hd.scene === 'world', 40000);
  await q(HELPERS);
  await q(() => { const hd = window.__hd; hd.hideDev(true); hd.state.settings.hints = false; hd.state.stats.battlesWon = 6; hd.conquerRegions(4); hd.state.renown.points = 12; hd.state.renown.earned = 20; hd.grantGold(50000); for (const id of ['rally', 'firestorm', 'bulwark', 'march', 'levy']) hd.state.upgrades[id] = 2; });
  await toWorld();

  if (want('map')) {
    await step('map types', async () => {
      await q(() => window.__hd.revealMap());
      await sleep(1500);
      await shot('map-overview');
      // close-ups: each type's badge by its name, the twist glyphs on the frontier chips
      for (const type of ['goldmine', 'monastery', 'bandit', 'ruins', 'dragon']) {
        const id = await q((ty) => window.__p3.find((r) => r.type === ty && window.__hd.state.owner[r.id] !== 0), type);
        if (id == null) { console.log('no unowned region of type', type); continue; }
        await q((x) => { window.__p3.reach(x); window.__hd.flyToRegion(x, 34, 1); }, id);
        await sleep(1600);
        await shot(`map-type-${type}`);
      }
    });
  }

  if (want('cards')) {
    await step('cards', async () => {
      for (const type of ['goldmine', 'monastery', 'bandit', 'ruins', 'dragon']) {
        const id = await q((ty) => window.__p3.find((r) => r.type === ty && window.__hd.state.owner[r.id] !== 0), type);
        if (id == null) continue;
        await q((x) => { window.__p3.reach(x); window.__hd.flyToRegion(x, 30, 1); window.__hd.selectRegion(x); }, id);
        await sleep(1500);
        await shot(`card-${type}`);
      }
      // a card with a twist (and a type) together, and an owned Gold Mine's card
      const both = await q(() => window.__p3.find((r) => r.type && r.twist && window.__hd.state.owner[r.id] !== 0));
      if (both != null) { await q((x) => { window.__p3.reach(x); window.__hd.selectRegion(x); }, both); await sleep(1300); await shot('card-type-and-twist'); }
      const mine = await q(() => window.__p3.find((r) => r.type === 'goldmine'));
      if (mine != null) { await q((x) => { window.__hd.conquerRegion(x); window.__hd.selectRegion(x); }, mine); await sleep(1300); await shot('card-goldmine-owned'); }
      await q(() => window.__hd.selectRegion(null));
    });
  }

  if (want('twists')) {
    for (const twist of ['night', 'blizzard', 'flooded', 'holy', 'siege', 'raid']) {
      await step(`twist ${twist}`, async () => {
        await battleAt(new Function('r', `return r.twist === '${twist}' && window.__hd.state.owner[r.id] !== 0`), 3500);
        if (twist === 'holy') { await t.clickSel('.power-btn'); await sleep(450); }
        await shot(`twist-${twist}`);
        if (twist === 'siege') {
          // a real drag from the War Camp to the shut keep: the tooltip says "No route: take the Gate first" (desktop: a mouse drag)
          if (!phone) {
            const pts = await q(() => {
              const hd = window.__hd; const b = hd.battle;
              const camp = b.sites.find((s) => s.type === 'camp' && s.owner === 0);
              const keep = b.sites.find((s) => s.type === 'keep' && s.owner !== 0 && hd.world.tiles[s.tile].region === b.arena.regionId);
              return camp && keep ? { a: hd.screenPosOfSite(camp.id), b: hd.screenPosOfSite(keep.id) } : null;
            });
            if (pts) {
              await t.page.mouse('mouseMoved', pts.a.x, pts.a.y, 'none', 0);
              await t.page.mouse('mousePressed', pts.a.x, pts.a.y, 'left', 1);
              for (let k = 1; k <= 12; k++) { await t.page.mouse('mouseMoved', pts.a.x + ((pts.b.x - pts.a.x) * k) / 12, pts.a.y + ((pts.b.y - pts.a.y) * k) / 12, 'left', 1); await sleep(40); }
              await sleep(300);
              await shot('twist-siege-no-route');
              await t.page.mouse('mouseMoved', pts.a.x, pts.a.y, 'left', 1);
              await t.page.mouse('mouseReleased', pts.a.x, pts.a.y, 'left', 0);
            }
          }
          // the Gate falls: a strong send from the War Camp onto an emptied Gate, at 3x
          const ids = await q(() => { const b = window.__hd.battle; return { gate: b.sites.find((s) => s.type === 'gate')?.id, camp: b.sites.find((s) => s.type === 'camp' && s.owner === 0)?.id }; });
          if (ids.gate != null && ids.camp != null) {
            // the front-line rule may keep the Gate out of the War Camp's reach at first: the settlements in the way are handed over until a send can reach it
      await q(async (c, g) => {
        const S = await import(new URL('game/battle/sim.js', document.baseURI).href);
        const b = window.__hd.battle;
        for (let k = 0; k < 8 && !S.canRoute(b, 0, c, g); k++) {
          const next = b.sites.find((s) => s.owner !== 0 && s.type !== 'gate' && s.type !== 'keep' && S.canRoute(b, 0, c, s.id));
          if (!next) break;
          next.owner = 0; next.troops = 30;
        }
      }, ids.camp, ids.gate);
            await q((c, g) => {
              const hd = window.__hd; const b = hd.battle; b.sites[g].troops = 0; b.sites[c].troops = 40000; hd.battles.setSpeed(3);
              window.__gateHold = setInterval(() => { const bb = window.__hd.battle; if (bb && bb.sites[g] && bb.sites[g].owner !== 0) bb.sites[g].troops = 0; }, 100);
              return import(new URL('game/battle/sim.js', document.baseURI).href).then((S) => S.issue(b, { type: 'send', owner: 0, from: [c], to: g, fraction: 0.5 }));
            }, ids.camp, ids.gate);
            const fell = await t.waitFor((g) => window.__hd.battle.sites[g].owner === 0, 40000, ids.gate);
            await q(() => { clearInterval(window.__gateHold); window.__hd.battles.setSpeed(1); });
            if (fell) { await sleep(450); await shot('twist-siege-gate-falls'); } else console.log('the Gate did not fall');
          }
        }
        if (twist === 'raid') {
          await q(() => { const b = window.__hd.battle; for (const s of b.sites) if (s.type === 'shrine') { s.owner = 0; s.troops = 30; } });
          await sleep(4500);
          await shot('twist-raid-holding');
        }
        await toWorld();
      });
    }
  }

  if (want('dragon')) {
    await step('dragon', async () => {
      await battleAt((r) => r.type === 'dragon', 1500);
      await shot('dragon-perched');
      // the telegraph: wait for the warning circle (a breath every 12 s, the first at 6 s)
      await q(() => { const b = window.__hd.battle; for (const s of b.sites) if (s.owner === 0) s.troops = Math.max(s.troops, 60); });
      const ok = await t.waitFor(() => { const d = window.__hd.battle.dragon; return d && d.breath; }, 40000);
      if (ok) { await sleep(700); await shot('dragon-telegraph'); }
      await t.waitFor(() => { const d = window.__hd.battle.dragon; return d && !d.breath; }, 8000);
      await sleep(120);
      await shot('dragon-breath');
      const fly = await t.waitFor(() => { const d = window.__hd.battle.dragon; return d && d.flight; }, 40000);
      if (fly) { await sleep(1200); await shot('dragon-flying'); }
      await toWorld();
    });
  }

  if (want('events')) {
    for (const kind of ['merchant', 'plague', 'duel']) {
      await step(`event ${kind}`, async () => {
        const ev = await q((k) => window.__hd.offerEvent(k), kind);
        if (!ev) throw new Error(`no ${kind} offered`);
        await sleep(1200);
        await shot(`event-${kind}-toast`);
        if (kind === 'merchant') {
          await t.clickSel('.toast-action', 'See deals');
          await sleep(900);
          await shot('event-merchant-deals');
          await t.clickSel('.merchant-buy-renown');
          await sleep(900);
          await shot('event-merchant-bought');
        }
        if (kind === 'plague') {
          await q((f) => { const hd = window.__hd; const id = hd.world.regions.find((r) => hd.state.owner[r.id] === f)?.id; if (id != null) hd.flyToRegion(id, 14, 1); }, ev.faction);
          await sleep(1500);
          await shot('event-plague-tint');
          await t.clickSel('.toast-action', 'OK');
        }
        if (kind === 'duel') {
          await t.clickSel('.toast-action', 'Accept');
          await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000);
          await sleep(3000);
          await shot('event-duel-battle');
          await q(() => window.__hd.winBattle());
          await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden; }, 30000);
          await sleep(1500);
          await shot('event-duel-won');
          await t.clickText('.results-action', 'Continue');
          await t.waitFor(() => window.__hd.scene === 'world', 10000);
          await sleep(1500);
        }
      });
    }
  }

  if (want('realm')) {
    await step('realm dragonscale', async () => {
      await q(() => { window.__hd.state.boons.dragonscale = true; });
      await t.clickSel('.hud-btn[aria-label="Realm stats"]');
      await sleep(1200);
      await shot('realm-dragonscale');
      await t.clickSel('.realm-close');
    });
  }
  console.log('errors', JSON.stringify(t.unexpected()));
  await t.page.close();
}

const v = flags.variant || 'both';
if (v === 'desktop' || v === 'both') await run('desktop');
if (v === 'phone' || v === 'both') await run('phone');
process.exit(0);
