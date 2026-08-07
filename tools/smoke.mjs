// Browser smoke test — boots the real game and walks the core loop.
//
// EVERY interaction goes through real pointer events at real screen
// coordinates, and every click first asserts that the browser's own hit test
// actually lands on the target. A synthetic `el.click()` bypasses hit testing
// entirely, which is exactly how a completely unclickable UI once passed this
// suite green: `#screen-root` was pointer-events:none and no scene opted back
// in, so every button was dead while looking perfectly fine.
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

/**
 * Locate an element and verify the browser would actually deliver a click to
 * it. Returns its centre point.
 */
async function hitPoint(selector, label = selector) {
  const r = await page.eval((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { err: 'not found' };
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) return { err: 'zero size' };
    const cx = Math.round(b.left + b.width / 2);
    const cy = Math.round(b.top + b.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    const ok = hit === el || el.contains(hit) || hit?.contains(el);
    return {
      cx, cy, ok,
      blockedBy: ok ? null : (hit ? `${hit.tagName}.${hit.className}` : 'nothing'),
      pe: getComputedStyle(el).pointerEvents,
    };
  }, selector);

  if (r.err) throw new Error(`${label}: ${r.err}`);
  if (!r.ok) {
    throw new Error(
      `${label} is not clickable — hit test at (${r.cx},${r.cy}) landed on `
      + `${r.blockedBy} instead (pointer-events: ${r.pe})`,
    );
  }
  return r;
}

/** Click the way a player does: real pointer events, hit test asserted first. */
async function click(selector, label = selector) {
  const p = await hitPoint(selector, label);
  await page.mouse('mouseMoved', p.cx, p.cy);
  await page.mouse('mousePressed', p.cx, p.cy);
  await page.mouse('mouseReleased', p.cx, p.cy);
  await page.sleep(250);
  return p;
}

try {
  await page.sleep(1200);

  // ---- 1. world map, and every control on it is genuinely hittable --------
  const boot = await page.eval(() => ({
    scene: document.body.dataset.scene,
    hexes: document.querySelectorAll('.wm-hex').length,
    crowns: document.querySelector('.crowns')?.textContent,
  }));
  if (boot.scene !== 'worldmap') throw new Error(`expected worldmap, got "${boot.scene}"`);
  if (boot.hexes !== 18) throw new Error(`expected 18 region hexes, got ${boot.hexes}`);
  await hitPoint('button.wm-go', 'Invade button');
  await hitPoint('.wm-hex', 'a region hex');
  await hitPoint('.wm-actions button', 'Upgrades button');
  step(`world map: ${boot.hexes} regions, treasury ${boot.crowns}, controls hittable`);
  await page.screenshot(`${OUT}/01-worldmap.png`);

  // ---- 2. the shop opens, is hittable, and closes -------------------------
  await click('.wm-actions button', 'Upgrades button');
  const shopOpen = await page.eval(() => ({
    rows: document.querySelectorAll('.shop-row').length,
    buys: document.querySelectorAll('.btn.buy').length,
  }));
  if (!shopOpen.rows) throw new Error('shop opened with no upgrade rows');
  await hitPoint('.btn.buy', 'a shop Buy button');
  step(`shop: ${shopOpen.rows} rows, ${shopOpen.buys} buy buttons, all hittable`);
  await page.screenshot(`${OUT}/02-shop.png`);
  await click('.shop-header .btn.ghost', 'shop Close button');
  if (await page.eval(() => !!document.querySelector('.shop-overlay'))) {
    throw new Error('shop did not close');
  }

  // ---- 3. start a battle with a real click -------------------------------
  await click('button.wm-go', 'Invade button');
  await page.sleep(1200);
  const battle = await page.eval(() => {
    const b = window.__game.state.battle;
    if (!b) return null;
    return {
      sites: b.sites.length,
      mine: b.sites.filter((s) => s.owner === 'player').length,
      theirs: b.sites.filter((s) => s.owner === 'enemy').length,
      expedition: Object.values(b.sites.find((s) => s.kind === 'camp')?.garrison || {})
        .reduce((a, n) => a + n, 0),
    };
  });
  if (!battle) throw new Error('battle did not start from a real click');
  if (battle.theirs <= battle.mine) {
    throw new Error(`enemy should start ahead: ${battle.mine} v ${battle.theirs}`);
  }
  step(`battle: ${battle.sites} sites (${battle.mine} mine, ${battle.theirs} enemy), `
    + `expedition ${battle.expedition}`);

  // ---- 4. the canvas is painted ------------------------------------------
  const painted = await page.eval(() => {
    const c = document.querySelector('#board-bg');
    if (!c?.width) return { ok: false };
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 499) {
      seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      if (seen.size > 8) break;
    }
    return { ok: seen.size > 3, colours: seen.size, w: c.width, h: c.height };
  });
  if (!painted.ok) throw new Error('battle canvas looks blank');
  step(`canvas painted: ${painted.colours}+ colours at ${painted.w}x${painted.h}`);
  await page.screenshot(`${OUT}/03-battle.png`);

  // ---- 5. HUD controls are hittable too ----------------------------------
  await hitPoint('.hud-dock .seg', 'strength segment');
  await hitPoint('.hud-dock .chip', 'unit filter chip');
  await hitPoint('.hud-dock .booster', 'booster button');
  step('HUD controls hittable');

  // ---- 6. the simulation runs --------------------------------------------
  const t0 = await page.eval(() => ({
    earned: window.__game.state.battle.factions.player.goldEarnedCg,
    tick: window.__game.state.battle.tick,
  }));
  await page.sleep(5000);
  const t1 = await page.eval(() => {
    const b = window.__game.state.battle;
    return { earned: b.factions.player.goldEarnedCg, tick: b.tick };
  });
  if (t1.tick - t0.tick < 30) throw new Error(`simulation stalled (${t0.tick}->${t1.tick})`);
  if (t1.earned <= t0.earned) throw new Error('farms are producing no gold');
  step(`sim running: tick ${t0.tick}->${t1.tick}, earned ${t0.earned}->${t1.earned}cg`);

  // ---- 7. a real drag order over the canvas -------------------------------
  const drag = await page.eval(() => {
    const g = window.__game;
    const b = g.state.battle;
    const camp = b.sites.find((s) => s.kind === 'camp' && s.owner === 'player');
    const target = b.sites.find((s) => camp.adj.includes(s.id) && s.owner !== 'player');
    if (!g.__view || !target) return null;
    const a = g.__view.siteScreen(camp, {});
    const z = g.__view.siteScreen(target, {});
    return {
      from: { x: Math.round(a.x), y: Math.round(a.y) },
      to: { x: Math.round(z.x), y: Math.round(z.y) },
      fromId: camp.id, toId: target.id,
    };
  });
  if (!drag) throw new Error('could not locate a drag source and target on screen');
  await page.drag(drag.from, drag.to);
  await page.sleep(900);
  const sent = await page.eval(() => window.__game.state.battle.squads
    .filter((s) => s.owner === 'player').length);
  if (!sent) throw new Error('a real drag produced no squad');
  step(`drag ${drag.fromId} -> ${drag.toId}: ${sent} squad(s) in flight`);
  await page.screenshot(`${OUT}/04-squads.png`);

  // ---- 8. play on, then check for numeric corruption ---------------------
  await page.sleep(15000);
  const late = await page.eval(() => {
    const b = window.__game.state.battle;
    return b ? {
      tick: b.tick,
      mine: b.sites.filter((s) => s.owner === 'player').length,
      sieges: b.sites.filter((s) => s.siege).length,
    } : { ended: true, scene: document.body.dataset.scene };
  });
  step(`later: ${JSON.stringify(late)}`);
  await page.screenshot(`${OUT}/05-later.png`);

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
  step('no NaN/Infinity in the state tree');

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
