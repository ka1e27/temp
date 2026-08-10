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
      const before = await page.eval((id) => window.__game.state.battle.squads
        .filter((q) => q.from === id).length, rally.fromId);
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

  // ---- 5c. a chained drag routes THROUGH a waypoint -----------------------
  // Waypoints require a DIRECT HIT rather than snapTarget's forgiving lean, so
  // this has to be a real drag that actually passes over the middle site. A
  // unit test cannot show that: it is the gesture that is under test here.
  const chain = await page.eval(() => {
    const g = window.__game;
    const b = g.state.battle;
    const byId = (id) => b.sites.find((s) => s.id === id);
    // camp -> some site we own -> anything beyond it.
    const src = b.sites.find((s) => s.kind === 'camp' && s.owner === 'player');
    let mid = null; let dst = null;
    for (const m of src.adj.map(byId)) {
      if (!m) continue;
      const d = m.adj.map(byId).find((x) => x && x.id !== src.id && !src.adj.includes(x.id));
      if (d) { mid = m; dst = d; break; }
    }
    if (!mid || !dst) return null;
    // A waypoint must be ground we hold, and a fresh map does not reliably hand
    // us a camp -> owned -> beyond path. The GESTURE is what is under test, so
    // the precondition is set up rather than waited for.
    mid.owner = 'player';
    const pt = (s) => { const p = g.__view.siteScreen(s, {}); return { x: Math.round(p.x), y: Math.round(p.y) }; };
    return { from: pt(src), mid: pt(mid), to: pt(dst), fromId: src.id, midId: mid.id, toId: dst.id };
  });
  if (!chain) note('no camp -> owned -> beyond path on this map to chain along');
  else {
    // Identify the new squad by ID, never by index: squads are REMOVED from the
    // array when they arrive, so an index taken before the drag can point past
    // the end by the time it lands.
    const before = await page.eval(() => window.__game.state.battle.nextSquadId);
    // Drag in two straight runs so the pointer genuinely crosses the middle site.
    await page.mouse('mouseMoved', chain.from.x, chain.from.y, 'none', 0);
    await page.mouse('mousePressed', chain.from.x, chain.from.y, 'left', 1);
    for (const leg of [[chain.from, chain.mid], [chain.mid, chain.to]]) {
      for (let i = 1; i <= 10; i++) {
        await page.mouse('mouseMoved',
          leg[0].x + ((leg[1].x - leg[0].x) * i) / 10,
          leg[0].y + ((leg[1].y - leg[0].y) * i) / 10, 'left', 1);
        await page.sleep(16);
      }
    }
    await page.mouse('mouseReleased', chain.to.x, chain.to.y, 'left', 0);
    await page.sleep(700);

    const got = await page.eval((minId) => {
      const sq = window.__game.state.battle.squads.filter((s) => s.id >= minId).at(-1);
      return sq ? { route: sq.route ?? null, to: sq.to, legs: sq.legEnds?.length ?? 0 } : null;
    }, before);
    if (!got) throw new Error('a chained drag produced no squad');
    if (!got.route || got.route.length < 3) {
      throw new Error(`drag ${chain.fromId}->${chain.midId}->${chain.toId} did not chain: `
        + `route=${JSON.stringify(got.route)} to=${got.to}`);
    }
    step(`chained drag: ${got.route.join(' -> ')} (${got.legs} legs)`);
    await page.screenshot(`${OUT}/05-chain.png`);
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
    await click('.btn.wm-menu', 'the Menu button');
    await click('.btn.menu-abdicate', 'the Abdicate button');
    const drawer = await page.eval(() => ({
      rows: document.querySelectorAll('.legacy-payout dd').length,
      pays: document.querySelector('.legacy-payout dd:last-of-type')?.textContent ?? '',
      go: !!document.querySelector('.menu-abdicate-go'),
    }));
    if (!drawer.rows || !drawer.go) {
      throw new Error(`abdication drawer did not render (${JSON.stringify(drawer)})`);
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
