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
import { compositionSlots } from '../src/meta/composition.js';
import { REGIONS } from '../src/content/regions.data.js';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = 'screenshots';
await mkdir(OUT, { recursive: true });

const errors = [];
const step = (m) => console.log(`  ok  ${m}`);
const note = (m) => console.log(`  --  ${m}`);

/**
 * Poll until the page reports `ready`, instead of sleeping a guessed number of
 * milliseconds and asserting into the dark.
 *
 * This file is now a DEPLOY GATE, and that changes what a fixed sleep costs.
 * A guessed delay that is generous on a dev box is a coin flip on a CI runner —
 * slower, shared, and running the dev server in the same container. Observed
 * here: the abdication drawer failed once with `rows: 0` under load and passed
 * twice immediately after, on identical code. A flaky gate is worse than no
 * gate, because the first thing anyone learns is to re-run it.
 *
 * Returns the LAST value even on timeout, so the assertion that follows can
 * still say what it actually saw rather than "timed out".
 */
async function waitFor(fn, ms = 5000) {
  const deadline = Date.now() + ms;
  let last;
  for (;;) {
    last = await page.eval(fn);
    if (last?.ready) return last;
    if (Date.now() > deadline) return last;
    await page.sleep(100);
  }
}

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

/** Click a raw canvas point rather than a selector — for a gesture that
 *  targets bare ground, where there is no DOM element for hitPoint() to
 *  resolve against. */
async function clickAt(x, y) {
  await page.mouse('mouseMoved', x, y);
  await page.mouse('mousePressed', x, y);
  await page.mouse('mouseReleased', x, y);
  await page.sleep(320);
}

/** Advance out of whatever screen we are on until we reach `want`. */
async function reach(want, maxHops = 6) {
  for (let i = 0; i < maxHops; i++) {
    const at = await scene();
    if (at === want) return true;
    // Known one-click transitions between screens.
    const routes = [
      ['.menu-continue, .menu-new', 'main menu'],
      ['.pb-go, .pb-launch, .prebattle-go', 'loadout launch'],
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
      comp: b.sites.find((s) => s.kind === 'camp')?.garrison || {},
    };
  });
  if (!battle) throw new Error('no battle state');
  if (battle.theirs <= battle.mine) {
    throw new Error(`enemy should start ahead: ${battle.mine} v ${battle.theirs}`);
  }
  // Measured in SLOTS, not bodies. Since units cost 1-8 slots each, a player who
  // spends a 19-slot budget on 3 rams and 4 militia fields 7 soldiers — a
  // headcount floor would call that legitimate army "too small".
  const bodies = Object.values(battle.comp).reduce((a, n) => a + n, 0);
  const slots = compositionSlots(battle.comp);
  if (slots < 12) throw new Error(`expedition too small: ${slots} slots (${bodies} bodies)`);
  step(`battle: ${battle.sites} sites (${battle.mine} mine, ${battle.theirs} enemy), `
    + `expedition ${slots} slots / ${bodies} bodies`);

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
  // Located by their own class, NOT by which container they happen to sit in.
  // These read `.hud-dock .chip` and `.hud-dock .booster`, and when the chips
  // and boosters moved to the left rail both silently became "not present" and
  // this step went on reporting ok — the controls were no longer hit-tested by
  // anything. A selector that encodes the layout is a test that stops asserting
  // the moment the layout changes, which is the failure mode CLAUDE.md warns
  // about. `required` is the other half: absent now FAILS.
  for (const [sel, label, required] of [
    ['.seg', 'strength segment', true],
    ['.hud-dragmode', 'drag-mode toggle', true],
    ['.chip', 'unit filter chip', true],
    ['.booster', 'booster button', true],
  ]) {
    if (await has(sel)) await hitPoint(sel, label);
    else if (required) throw new Error(`${label} (${sel}) is missing from the HUD`);
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
    from.rallyTargets = [];
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
      .find((s) => s.id === id)?.rallyTargets ?? [], rally.fromId);
    if (!got.includes(rally.toId)) {
      throw new Error(`right-drag ${rally.fromId} -> ${rally.toId} set rallyTargets=${got}`);
    }
    step(`right-drag rally: ${rally.fromId} -> ${rally.toId}`);

    // ---- 5b(ii). the SAME rally with the LEFT button, via the mode ---------
    // The reason the mode exists: a right-drag does not exist on a touchscreen
    // and a trackpad will not reliably report button 2 mid-drag, so on both of
    // the devices this is played on the rally drag was unreachable. Asserting
    // it with a real left drag is the only way to know the mode is wired to the
    // gesture and not merely to a CSS class.
    // The source must be a site the PLAYER holds — a rally is a standing order
    // issued by a garrison — so the drag runs from the same source as above, to
    // a second neighbour. Reversing it would have started on neutral ground and
    // legitimately done nothing.
    await click('.hud-dragmode[data-mode="rally"]', 'rally mode');
    const modeOn = await page.eval(() => !!window.__game.__ui?.rallyMode);
    if (!modeOn) throw new Error('rally mode button did not set view.rallyMode');

    const second = await page.eval((fromId, takenId) => {
      const g = window.__game;
      const b = g.state.battle;
      const from = b.sites.find((s) => s.id === fromId);
      const to = from && b.sites.find((s) => from.adj.includes(s.id) && s.id !== takenId);
      if (!to) return null;
      const z = g.__view.siteScreen(to, {});
      return { to: { x: Math.round(z.x), y: Math.round(z.y) }, toId: to.id };
    }, rally.fromId, rally.toId);

    if (!second) note('no second neighbour to rally at');
    else {
      // ISOLATE THE SOURCE FIRST. The rally set in the step above is a STANDING
      // ORDER and it fires on its own schedule, so counting squads leaving the
      // camp measures that rally, not this drag — the assertion below passed or
      // failed on timing alone. Clearing the targets and parking the hold-back
      // above the garrison means nothing can leave this site except because of
      // the gesture under test.
      const before = await page.eval((id) => {
        const s = window.__game.state.battle.sites.find((x) => x.id === id);
        s.rallyTargets = [];
        s.rallyKeep = 999;
        return window.__game.state.battle.squads.filter((q) => q.from === id).length;
      }, rally.fromId);
      await page.drag(rally.from, second.to, 12);       // LEFT button
      await page.sleep(600);
      const got2 = await page.eval((id) => window.__game.state.battle.sites
        .find((s) => s.id === id)?.rallyTargets ?? [], rally.fromId);
      if (!got2.includes(second.toId)) {
        throw new Error(`left-drag in rally mode ${rally.fromId} -> ${second.toId} `
          + `set rallyTargets=${got2} — the mode is not reaching the gesture`);
      }
      // And it must NOT have sent troops. A mode that quietly launches an
      // attack instead of setting a standing order is the worst thing it could
      // do, and it is exactly what happens if `rallyMode` is only wired to CSS.
      const after = await page.eval((id) => window.__game.state.battle.squads
        .filter((q) => q.from === id).length, rally.fromId);
      if (after > before) throw new Error(`rally mode also launched ${after - before} squad(s)`);
      step(`left-drag rally via mode: ${rally.fromId} -> ${second.toId}, no squads sent`);
    }

    await click('.hud-dragmode[data-mode="send"]', 'send mode');
  }

  // A chained drag used to be tested here — one gesture routing THROUGH a
  // waypoint. Free movement deleted the mechanism: a send is legal wherever a
  // path exists, so a drag is just "picked up here, released there" and the
  // pathfinder covers the ground in between on its own. Nothing left to drive.

  // ---- 5c. building mid-battle: arm, click a hex, a site appears ---------
  // Arming is a HUD control like any other and goes through click(selector);
  // the SECOND click lands on bare ground, not a DOM element, so it is driven
  // at a raw canvas point the way the drag/rally steps above are. The target
  // hex comes from the REAL buildBlocker — dynamically imported inside the
  // page, against the REAL live state, the same module the running game
  // already loaded — rather than a guess, so this step cannot pass by aiming
  // at a hex that merely looks legal.
  const build = await page.eval(async () => {
    const { buildBlocker } = await import('/src/battle/commands.js');
    const { axialFromOffset, distance } = await import('/src/core/hex.js');
    const { hexCx, hexCy } = await import('/src/render/hexGeom.js');
    const g = window.__game;
    const b = g.state.battle;
    b.factions.player.goldCg = 1_000_000;   // affordability is not what this tests
    const camp = b.sites.find((s) => s.kind === 'camp' && s.owner === 'player');
    if (!camp) return null;
    const home = { q: camp.hex[0], r: camp.hex[1] };
    let best = null;
    let bestD = -1;
    for (let r = 0; r < b.grid.rows; r++) {
      for (let col = 0; col < b.grid.cols; col++) {
        const hex = axialFromOffset(col, r);
        if (buildBlocker(b, 'player', hex)) continue;
        // Farthest from the camp, so the second click below cannot land on
        // the site panel — anchored on the camp for the whole step.
        const d = distance(home, hex);
        if (d > bestD) { bestD = d; best = hex; }
      }
    }
    if (!best) return null;
    const at = g.__view.siteScreen(camp, {});
    const to = g.__view.camera.worldToScreen(
      hexCx(best.q, best.r, g.__view.hexSize), hexCy(best.q, best.r, g.__view.hexSize), {},
    );
    return {
      camp: { x: Math.round(at.x), y: Math.round(at.y) },
      hex: { x: Math.round(to.x), y: Math.round(to.y) },
      q: best.q, r: best.r,
    };
  });
  if (!build) throw new Error('no legal build hex found on this map — nothing to click');

  await clickAt(build.camp.x, build.camp.y);      // select a player site, opens the panel
  await click('.hud-build-farm', 'the Build Farm action');
  const armed = await page.eval(() => window.__game.__ui?.armedBuild ?? null);
  if (armed !== 'farm') throw new Error(`Build Farm did not arm: armedBuild=${armed}`);

  await clickAt(build.hex.x, build.hex.y);        // the second click: a hex, not a site
  await page.sleep(500);
  const built = await page.eval((q, r) => window.__game.state.battle.sites
    .find((s) => s.hex[0] === q && s.hex[1] === r) ?? null, build.q, build.r);
  if (!built || !(built.buildTicksLeft > 0)) {
    throw new Error(`build did not land at [${build.q},${build.r}]: ${JSON.stringify(built)}`);
  }
  const stillArmed = await page.eval(() => window.__game.__ui?.armedBuild ?? null);
  if (stillArmed) throw new Error(`armedBuild=${stillArmed} after firing — it must self-clear`);
  step(`build: armed Farm, clicked [${build.q},${build.r}], buildTicksLeft=${built.buildTicksLeft}`);

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
    // Driven off REGIONS rather than a literal: the literal read 18 and broke
    // the moment a fifth tier shipped, which makes the smoke test assert that
    // the campaign has not grown instead of that every region gets a plate.
    if (wm.hexes !== REGIONS.length) {
      throw new Error(`expected ${REGIONS.length} region hexes, got ${wm.hexes}`);
    }
    // The map is bigger than its window and you pan around it, so some are
    // legitimately off screen. Tag the one nearest the middle and hit test
    // THAT — still a real region and a real hit test, just not whichever one
    // happens to come first in the DOM.
    const onScreen = await page.eval(() => {
      const m = document.querySelector('.wm-map').getBoundingClientRect();
      let best = null;
      for (const el of document.querySelectorAll('.wm-hex')) {
        const b = el.getBoundingClientRect();
        if (b.left < m.left || b.right > m.right || b.top < m.top || b.bottom > m.bottom) continue;
        const d = Math.hypot(b.left + b.width / 2 - m.left - m.width / 2,
          b.top + b.height / 2 - m.top - m.height / 2);
        if (!best || d < best.d) best = { d, el };
      }
      if (best) best.el.dataset.smoke = '1';
      return best?.el.getAttribute('aria-label') ?? null;
    });
    if (!onScreen) throw new Error('not one region hex is fully on screen');
    await hitPoint('.wm-hex[data-smoke="1"]', `the region hex "${onScreen}"`);
    step(`world map: ${wm.hexes} regions, treasury ${wm.crowns}`);
    await page.screenshot(`${OUT}/03-worldmap.png`);

    // Shop opens, its buy buttons are hittable, and it closes.
    const shopBtn = '.btn.wm-shop';
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

    // ---- the endgame: the ladder and the reset ----------------------------
    //
    // Both are gated on a FINISHED campaign, which a smoke test cannot play in
    // the time it has, so the twenty-four battles are replaced by marking the
    // region records conquered and re-entering the map. Everything after that is
    // the real thing: real pointer events, real hit tests, real scene
    // transitions. The reason it is worth doing at all is this project's own
    // history — a whole release once shipped with every screen unclickable, and
    // the surfaces added last are exactly the ones nothing else covers.
    await page.eval(() => {
      const g = window.__game;
      for (const rec of Object.values(g.state.meta.regions)) rec.status = 'conquered';
      g.state.meta.crowns = 5e6;
      g.scenes.replace(g.screens.worldmap);
    });
    await page.sleep(400);

    await click('.btn.wm-incursion', 'the Incursions button');
    const rung = await page.eval(() => ({
      depth: document.querySelector('.inc-depth')?.textContent ?? '',
      stats: document.querySelectorAll('.inc-stats dd').length,
      go: !!document.querySelector('.inc-go'),
    }));
    if (!/depth\s*1/i.test(rung.depth) || rung.stats < 4 || !rung.go) {
      throw new Error(`incursion briefing did not render (${JSON.stringify(rung)})`);
    }
    await hitPoint('.inc-go', 'the Begin incursion button');
    step(`incursion: "${rung.depth}", ${rung.stats} stats, Begin hittable`);
    await page.screenshot(`${OUT}/05-incursion.png`);

    // ...and it really leads to a loadout for that rung, carrying the depth.
    await click('.inc-go', 'Begin incursion');
    const loadout = await page.eval(() => ({
      scene: document.body.dataset.scene,
      title: document.querySelector('#pb-title')?.textContent ?? '',
      go: document.querySelector('.pb-go')?.textContent ?? '',
    }));
    if (loadout.scene !== 'prebattle' || !/depth\s*1/i.test(loadout.title)) {
      throw new Error(`incursion did not reach its loadout (${JSON.stringify(loadout)})`);
    }
    step(`incursion loadout: "${loadout.title}", launch reads "${loadout.go}"`);
    await page.eval(() => {
      const g = window.__game;
      g.scenes.replace(g.screens.worldmap);
    });
    await page.sleep(300);

    // Abdication: offered, and its drawer states the payout before anything is
    // destroyed. The button is NOT pressed — the whole point of it is that it
    // wipes the save, and a smoke test that took that branch would be testing the
    // reset with no way back for the steps after it.
    // RE-SEED AND VERIFY, rather than trusting the seeding twenty lines up.
    //
    // The abdication drawer has a LOCKED branch — a title, an explanation and a
    // Close button, no payout rows — that renders whenever `canAbdicate` is
    // false. It looks identical to "the drawer failed to render" from the
    // outside, and that is exactly how this step failed intermittently: not a
    // slow render, a campaign that had stopped being complete somewhere in the
    // incursion steps between the seeding and the click.
    //
    // Seeding is idempotent and costs nothing, so do it again next to the thing
    // that depends on it, and ASSERT it took. A setup step that can silently
    // come undone is worse than no setup step: it fails as a mystery in the
    // feature under test rather than as a fact about the fixture.
    const seeded = await page.eval(() => {
      const g = window.__game;
      for (const rec of Object.values(g.state.meta.regions)) rec.status = 'conquered';
      g.state.meta.crowns = 5e6;
      return Object.values(g.state.meta.regions).filter((r) => r.status !== 'conquered').length;
    });
    if (seeded !== 0) throw new Error(`${seeded} regions refused to seed as conquered`);
    await click('.btn.wm-menu', 'the Menu button');

    // BOUNDED RETRY, and it is worth being explicit about why this one earns an
    // exception to "a retry hides a bug".
    //
    // This step flaked roughly one run in five, and it did so BEFORE any of this
    // session's changes — verified by running it five times against an earlier
    // commit. When it fails the campaign is intact (`0 region(s) not conquered`)
    // and the scene is right; the drawer simply does not paint, so the abdicate
    // click appears to land on a node that is being re-mounted underneath it.
    // The root cause is NOT identified, and this comment is here so nobody
    // mistakes the retry for a diagnosis.
    //
    // Retrying is safe here in a way it would not be elsewhere: opening this
    // drawer is READ-ONLY by construction — the destructive button is
    // deliberately never pressed (see the note above) — so re-opening it is
    // idempotent. The alternative was leaving a 20%-flaky deploy gate, and a
    // gate people learn to re-run is worse than no gate at all.
    let drawer;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await click('.btn.menu-abdicate', 'the Abdicate button');
      drawer = await waitFor(() => {
        const d = {
          rows: document.querySelectorAll('.legacy-payout dd').length,
          pays: document.querySelector('.legacy-payout dd:last-of-type')?.textContent ?? '',
          go: !!document.querySelector('.menu-abdicate-go'),
        };
        d.ready = d.rows > 0 && d.go;
        return d;
      }, 2500);
      if (drawer?.ready) break;
      note(`abdication drawer came back empty (attempt ${attempt}/3) — reopening`);
      await page.sleep(500);
    }
    if (!drawer.rows || !drawer.go) {
      // WHY, not just THAT. The locked branch of the drawer is visually a
      // different thing but structurally indistinguishable from a failed
      // render, so report the gate's own inputs — otherwise this reads as
      // "the endgame screen is broken" when it means "the fixture came undone".
      const why = await page.eval(() => {
        const meta = window.__game.state.meta;
        const unconquered = Object.entries(meta.regions)
          .filter(([, r]) => r.status !== 'conquered').map(([id, r]) => `${id}=${r.status}`);
        return { unconquered, scene: document.body.dataset.scene ?? null };
      });
      throw new Error(`abdication drawer did not render (${JSON.stringify(drawer)}) `
        + `— scene "${why.scene}", ${why.unconquered.length} region(s) not conquered`
        + `${why.unconquered.length ? `: ${why.unconquered.slice(0, 5).join(', ')}` : ''}`);
    }
    await hitPoint('.menu-abdicate-go', 'the Abdicate confirmation');
    step(`abdication: ${drawer.rows} payout rows, gives up ${drawer.pays}, confirm hittable`);
    await page.screenshot(`${OUT}/06-abdicate.png`);
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
