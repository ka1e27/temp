// Browser smoke test — boots the real game and walks the whole loop.
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
const note = (m) => console.log(`  --  ${m}`);

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

const scene = () => page.eval(() => document.body.dataset.scene ?? null);
const has = (sel) => page.eval((s) => !!document.querySelector(s), sel);

/** Locate an element and verify the browser would actually deliver a click. */
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
  await page.sleep(320);
  return p;
}

/** Advance out of whatever screen we are on until we reach `want`. */
async function reach(want, maxHops = 6) {
  for (let i = 0; i < maxHops; i++) {
    const at = await scene();
    if (at === want) return true;
    // Known one-click transitions between screens.
    const routes = [
      ['.mm-continue, .mm-new', 'main menu'],
      ['.pb-launch, .prebattle-go', 'loadout launch'],
      ['.results-map', 'results → map'],
      ['button.wm-go', 'invade'],
    ];
    let moved = false;
    for (const [sel] of routes) {
      if (await has(sel)) { await click(sel); moved = true; break; }
    }
    if (!moved) return false;
  }
  return (await scene()) === want;
}

try {
  await page.sleep(1600);

  // ---- 1. a fresh save must reach a playable battle ----------------------
  const boot = await scene();
  note(`fresh save boots to "${boot}"`);
  if (!await reach('battle')) throw new Error(`could not reach a battle from "${boot}"`);
  step('reached a battle from a fresh save');

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
  if (!battle) throw new Error('no battle state');
  if (battle.theirs <= battle.mine) {
    throw new Error(`enemy should start ahead: ${battle.mine} v ${battle.theirs}`);
  }
  if (battle.expedition < 8) throw new Error(`expedition too small: ${battle.expedition}`);
  step(`battle: ${battle.sites} sites (${battle.mine} mine, ${battle.theirs} enemy), `
    + `expedition ${battle.expedition}`);

  // ---- 2. the canvas is painted ------------------------------------------
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
  await page.screenshot(`${OUT}/01-battle.png`);

  // ---- 3. HUD controls are genuinely hittable ----------------------------
  for (const [sel, label] of [
    ['.hud-dock .seg', 'strength segment'],
    ['.hud-dock .chip', 'unit filter chip'],
    ['.hud-dock .booster', 'booster button'],
  ]) {
    if (await has(sel)) await hitPoint(sel, label);
    else note(`${label} not present`);
  }
  step('HUD controls hittable');

  // ---- 4. the simulation runs, and speed actually changes it -------------
  const t0 = await page.eval(() => ({
    earned: window.__game.state.battle.factions.player.goldEarnedCg,
    tick: window.__game.state.battle.tick,
  }));
  await page.sleep(4000);
  const t1 = await page.eval(() => {
    const b = window.__game.state.battle;
    return { earned: b.factions.player.goldEarnedCg, tick: b.tick };
  });
  if (t1.tick - t0.tick < 25) throw new Error(`simulation stalled (${t0.tick}->${t1.tick})`);
  if (t1.earned <= t0.earned) throw new Error('farms are producing no gold');
  const base = t1.tick - t0.tick;
  step(`sim running: ${base} ticks/4s, earned ${t0.earned}->${t1.earned}cg`);

  // Speed must scale the SIM but never the idle economy — paying idle income
  // per tick would make the speed control a money printer.
  const fast = await page.eval(async () => {
    const g = window.__game;
    const crowns0 = g.state.meta.crowns;
    const tick0 = g.state.battle.tick;
    g.loop.setSpeed(4);
    await new Promise((r) => setTimeout(r, 3000));
    const out = {
      ticks: g.state.battle.tick - tick0,
      crowns: g.state.meta.crowns - crowns0,
      speed: g.loop.speed,
    };
    g.loop.setSpeed(1);
    return out;
  });
  if (fast.speed !== 4) throw new Error('loop.setSpeed(4) did not take');
  if (fast.ticks < base * 1.5) {
    throw new Error(`4x did not speed the sim: ${fast.ticks} ticks/3s vs ${base}/4s at 1x`);
  }
  step(`speed control: ${fast.ticks} ticks/3s at 4x (vs ${base}/4s at 1x)`);

  // ---- 5. a real drag order over the canvas -------------------------------
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
  if (!drag) throw new Error('could not locate a drag source and target');
  await page.drag(drag.from, drag.to);
  await page.sleep(900);
  const sent = await page.eval(() => window.__game.state.battle.squads
    .filter((s) => s.owner === 'player').length);
  if (!sent) throw new Error('a real drag produced no squad');
  step(`drag ${drag.fromId} -> ${drag.toId}: ${sent} squad(s) in flight`);
  await page.screenshot(`${OUT}/02-squads.png`);

  // ---- 5b. a real RIGHT drag sets a rally ---------------------------------
  // This is the gesture a player reaches for first, and it used to fire on
  // pointerdown at the press point — so pressing the source and dragging to the
  // target resolved to target===source, which CLEARS a rally. It has to be
  // driven with real right-button events or the regression comes straight back.
  const rally = await page.eval(() => {
    const g = window.__game;
    const b = g.state.battle;
    // The target need not be yours — a rally into enemy ground is a legal
    // standing attack order — it only has to be adjacent.
    const from = b.sites.find((s) => s.owner === 'player' && s.adj.length > 0);
    const to = from && b.sites.find((s) => from.adj.includes(s.id));
    if (!from || !to) return null;
    from.rallyTarget = null;
    const a = g.__view.siteScreen(from, {});
    const z = g.__view.siteScreen(to, {});
    return {
      from: { x: Math.round(a.x), y: Math.round(a.y) },
      to: { x: Math.round(z.x), y: Math.round(z.y) },
      fromId: from.id, toId: to.id,
    };
  });
  if (!rally) note('no adjacent friendly pair to rally between');
  else {
    await page.drag(rally.from, rally.to, 12, 'right');
    await page.sleep(600);
    const got = await page.eval((id) => window.__game.state.battle.sites
      .find((s) => s.id === id)?.rallyTarget ?? null, rally.fromId);
    if (got !== rally.toId) {
      throw new Error(`right-drag ${rally.fromId} -> ${rally.toId} set rallyTarget=${got}`);
    }
    step(`right-drag rally: ${rally.fromId} -> ${rally.toId}`);
  }

  // ---- 6. effects actually render ----------------------------------------
  let sawFx = false;
  for (let i = 0; i < 12 && !sawFx; i++) {
    await page.sleep(1000);
    sawFx = await page.eval(() => (window.__game.__fx?.live() ?? 0) > 0);
  }
  if (sawFx) step('visual effects spawn and expire');
  else note('no effect observed in 12s (possible, but check fx wiring)');

  // ---- 7. numeric corruption sweep ---------------------------------------
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

  // ---- 8. leave the battle and walk the meta screens ---------------------
  await page.eval(() => { window.__game.state.battle.status = 'retreat'; });
  await page.sleep(1200);
  if (!await reach('worldmap')) note(`could not reach the world map (at "${await scene()}")`);
  else {
    const wm = await page.eval(() => ({
      hexes: document.querySelectorAll('.wm-hex').length,
      crowns: document.querySelector('.crowns')?.textContent,
    }));
    if (wm.hexes !== 18) throw new Error(`expected 18 region hexes, got ${wm.hexes}`);
    await hitPoint('.wm-hex', 'a region hex');
    step(`world map: ${wm.hexes} regions, treasury ${wm.crowns}`);
    await page.screenshot(`${OUT}/03-worldmap.png`);

    // Shop opens, its buy buttons are hittable, and it closes.
    const shopBtn = '.wm-actions button';
    if (await has(shopBtn)) {
      await click(shopBtn, 'Upgrades button');
      const rows = await page.eval(() => document.querySelectorAll('.shop-row').length);
      if (!rows) throw new Error('shop opened with no rows');
      await hitPoint('.btn.buy', 'a shop Buy button');
      step(`shop: ${rows} rows, buy buttons hittable`);
      await page.screenshot(`${OUT}/04-shop.png`);
      if (await has('.shop-close')) await click('.shop-close', 'shop Close');
      else await page.eval(() => window.__game.scenes.pop());
    }
  }

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
