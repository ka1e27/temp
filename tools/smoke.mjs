// Browser smoke test — boots the real game and walks the core loop.
// This is what catches cross-module integration breakage that unit tests
// structurally cannot see.
//
//   node tools/serve.js &     # or npm start
//   node tools/smoke.mjs
import { mkdir } from 'node:fs/promises';
import { launch } from './cdp.js';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = 'screenshots';
await mkdir(OUT, { recursive: true });

const errors = [];
const step = (m) => console.log(`  ok  ${m}`);

const page = await launch({ url: URL });
page.on((method, params) => {
  if (method === 'Runtime.exceptionThrown') {
    errors.push(params.exceptionDetails?.exception?.description
      || params.exceptionDetails?.text || 'exception');
  }
  if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
    errors.push(params.args.map((a) => a.value ?? a.description).join(' '));
  }
});

try {
  await page.sleep(1200);

  // ---- 1. world map -------------------------------------------------------
  const boot = await page.eval(() => ({
    scene: document.body.dataset.scene,
    hexes: document.querySelectorAll('.wm-hex').length,
    invade: document.querySelectorAll('button.wm-go').length,
    crowns: document.querySelector('.crowns')?.textContent,
  }));
  if (boot.scene !== 'worldmap') throw new Error(`expected worldmap, got "${boot.scene}"`);
  if (boot.hexes !== 18) throw new Error(`expected 18 region hexes, got ${boot.hexes}`);
  if (!boot.invade) throw new Error('no invade button — region 1 should be attackable');
  step(`world map: ${boot.hexes} regions, treasury ${boot.crowns}`);
  await page.screenshot(`${OUT}/01-worldmap.png`);

  // ---- 2. enter a battle --------------------------------------------------
  await page.eval(() => document.querySelector('button.wm-go').click());
  await page.sleep(1500);

  const battle = await page.eval(() => {
    const b = window.__game.state.battle;
    if (!b) return null;
    return {
      sites: b.sites.length,
      mine: b.sites.filter((s) => s.owner === 'player').length,
      theirs: b.sites.filter((s) => s.owner === 'enemy').length,
      expedition: b.sites.find((s) => s.kind === 'camp')?.garrison,
      tick: b.tick,
    };
  });
  if (!battle) throw new Error('battle did not start');
  if (battle.theirs <= battle.mine) {
    throw new Error(`enemy should start ahead: mine=${battle.mine} theirs=${battle.theirs}`);
  }
  const expeditionSize = Object.values(battle.expedition || {}).reduce((a, b) => a + b, 0);
  if (expeditionSize < 8) throw new Error(`expedition too small: ${expeditionSize}`);
  step(`battle: ${battle.sites} sites (${battle.mine} mine, ${battle.theirs} enemy), `
    + `expedition of ${expeditionSize}`);
  await page.screenshot(`${OUT}/02-battle.png`);

  // ---- 3. the canvas is actually painted ----------------------------------
  const painted = await page.eval(() => {
    const c = document.querySelector('#board-bg');
    if (!c?.width) return { ok: false, why: 'no canvas' };
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 499) {
      seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      if (seen.size > 8) break;
    }
    return { ok: seen.size > 3, colours: seen.size, w: c.width, h: c.height };
  });
  if (!painted.ok) throw new Error(`battle canvas looks blank: ${JSON.stringify(painted)}`);
  step(`canvas painted: ${painted.colours}+ distinct colours at ${painted.w}x${painted.h}`);

  // ---- 4. the simulation runs --------------------------------------------
  const t0 = await page.eval(() => ({
    gold: window.__game.state.battle.factions.player.goldCg,
    tick: window.__game.state.battle.tick,
  }));
  await page.sleep(5000);
  const t1 = await page.eval(() => {
    const b = window.__game.state.battle;
    return {
      gold: b.factions.player.goldCg, tick: b.tick, squads: b.squads.length,
      enemySquads: b.squads.filter((s) => s.owner === 'enemy').length,
      status: b.status,
    };
  });
  if (t1.tick - t0.tick < 30) throw new Error(`simulation stalled (${t0.tick} -> ${t1.tick})`);
  if (t1.gold <= t0.gold) throw new Error('player gold is not accruing from farms');
  step(`sim running: tick ${t0.tick}->${t1.tick}, gold ${t0.gold}->${t1.gold}`);

  // ---- 5. a real drag order ----------------------------------------------
  const drag = await page.eval(() => {
    const g = window.__game;
    const b = g.state.battle;
    const camp = b.sites.find((s) => s.kind === 'camp' && s.owner === 'player');
    const target = b.sites.find((s) => camp.adj.includes(s.id));
    const view = g.__view;
    if (!view || !target) return null;
    const a = view.siteScreen(camp, {});
    const z = view.siteScreen(target, {});
    return { from: a, to: z, fromId: camp.id, toId: target.id };
  });
  if (drag) {
    await page.drag(drag.from, drag.to);
    await page.sleep(900);
    const sent = await page.eval(() => window.__game.state.battle.squads
      .filter((s) => s.owner === 'player').length);
    if (!sent) throw new Error('drag produced no squad');
    step(`drag order ${drag.fromId} -> ${drag.toId}: ${sent} squad(s) in flight`);
  } else {
    // Fall back to the command queue so the rest of the run still exercises
    // movement, siege and capture even if the view is not exposed.
    await page.eval(() => {
      const b = window.__game.state.battle;
      const camp = b.sites.find((s) => s.kind === 'camp' && s.owner === 'player');
      b.commands.push({
        t: 'SEND', from: camp.id, to: camp.adj[0], fraction: 1,
        filter: ['militia', 'spearmen', 'raiders', 'rams', 'marshal'],
      });
    });
    await page.sleep(900);
    step('send order issued via the command queue (view not exposed for a real drag)');
  }
  await page.screenshot(`${OUT}/03-squads.png`);

  // ---- 6. let it play out; expect a capture ------------------------------
  await page.sleep(20000);
  const late = await page.eval(() => {
    const b = window.__game.state.battle;
    return b ? {
      tick: b.tick, status: b.status,
      mine: b.sites.filter((s) => s.owner === 'player').length,
      sieges: b.sites.filter((s) => s.siege).length,
      scene: document.body.dataset.scene,
    } : { scene: document.body.dataset.scene, ended: true };
  });
  step(`after 20s: ${JSON.stringify(late)}`);
  await page.screenshot(`${OUT}/04-later.png`);

  // ---- 7. no silent numeric corruption ------------------------------------
  const nans = await page.eval(() => {
    const bad = [];
    const seen = new WeakSet();
    const walk = (o, path) => {
      if (typeof o === 'number') { if (!Number.isFinite(o)) bad.push(path); return; }
      if (!o || typeof o !== 'object' || seen.has(o)) return;
      seen.add(o);
      for (const k of Object.keys(o)) walk(o[k], `${path}.${k}`);
    };
    walk(window.__game.state, 'state');
    return bad.slice(0, 8);
  });
  if (nans.length) throw new Error(`non-finite numbers: ${nans.join(', ')}`);
  step('no NaN/Infinity anywhere in the state tree');

  if (errors.length) throw new Error(`console errors:\n    ${errors.join('\n    ')}`);
  console.log('\nSMOKE PASSED');
} catch (err) {
  await page.screenshot(`${OUT}/99-failure.png`).catch(() => {});
  console.error(`\nSMOKE FAILED: ${err.message}`);
  if (errors.length) console.error(`console errors:\n    ${errors.join('\n    ')}`);
  process.exitCode = 1;
} finally {
  await page.close();
}
