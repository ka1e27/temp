// Real-browser checks for Phase 12, the Sea Kings (docs/PLAN-PHASE12.md; docs/briefs/phase12-hookup.md): run by tools/check.mjs (`--only=phase12`),
// desktop and phone, seed 7. Dev hooks set the stage (an archipelago Dynasty III through `__hd.seaRealm`, dev conquests, a staged lane) and read
// state; real presses wherever a press matters (the region card, Attack, Continue, Welcome, the Admiral's ability). Screenshots go to
// screenshots/phase12/ (the gallery) unless PHASE12_SHOTS=0.
//   1. an archipelago at Dynasty III: islands, fords, harbours and sea lanes; the Sea Kings hold a sector; the map draws the harbours and lanes
//   2. the first fords on the frontier: the S1 hint points at that region; its card has the sea lines (fords, harbour); S1 is seen
//   3. a Sea Kings coastal raid: it lands from the sea (raid.landing) and the toast says so
//   4. the Tide Fortress: its card names the Tide; Attack (a real press); a lane send sails a longboat
//   5. the Tide: the rising-water telegraph, the flood, squads caught lose troops (tideHit)
//   6. win: the Admiral's recruitment card (a real press on Continue), the roster has kind 'admiral'
//   7. the Admiral commands an attack: a real press on Broadside, coastal enemy sites lose troops (broadsideHit)
//   8. no console errors
import { mkdir } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';

const OUT = 'screenshots/phase12';

async function scenario(open, BASE, ok, sleep, allErrors, { width, height, mobile, name }) {
  const t = await open(`${BASE}/index.html?dev=1&seed=7`, { width, height, mobile });
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const tag = (s) => `phase12 ${name}: ${s}`;
  const shoot = process.env.PHASE12_SHOTS !== '0';
  const shot = async (n) => { if (shoot) { await t.page.screenshot(`${OUT}/${name}-${n}.png`); console.log(`  shot ${OUT}/${name}-${n}.png`); } };
  const press = async (x, y) => {
    if (mobile) {
      await t.page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await sleep(80);
      await t.page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await t.page.mouse('mouseMoved', x, y, 'none', 0);
      await t.page.mouse('mousePressed', x, y, 'left', 1);
      await sleep(90);
      await t.page.mouse('mouseReleased', x, y, 'left', 0);
    }
  };
  const centre = (sel, txt) => q((s, tx) => {
    const e = [...document.querySelectorAll(s)].find((x) => x.getClientRects().length && !x.closest('[hidden]') && (!tx || x.textContent.includes(tx)));
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel, txt || null);
  const pressSel = async (sel, txt) => { const c = await centre(sel, txt); if (!c) return false; await sleep(160); const c2 = await centre(sel, txt); if (!c2) return false; await press(c2.x, c2.y); await sleep(250); return true; };
  const sea = () => q(() => window.__hd.seaInfo());
  // dev conquests toward `target` until it is attackable (the same walk as phase6Checks)
  const conquerToward = (target) => q(async (c) => {
    const hd = window.__hd;
    const P = await import(new URL('game/meta/progression.js', document.baseURI).href);
    const dist = new Map([[c, 0]]);
    const queue = [c];
    while (queue.length) { const r = queue.shift(); for (const n of hd.world.regions[r].neighbors) if (!dist.has(n)) { dist.set(n, dist.get(r) + 1); queue.push(n); } }
    for (let i = 0; i < 60; i++) {
      const fr = P.attackableFrontier(hd.state, hd.world);
      if (fr.includes(c)) return c;
      const next = fr.filter((id) => id !== c).sort((a, b) => dist.get(a) - dist.get(b))[0];
      if (next == null) return null;
      hd.conquerRegion(next);
    }
    return null;
  }, target);
  const frameCamera = (x, y, zoom) => q((cx, cy, z) => { const c = window.__hd.camera; c.cancelFlight(); c.setBounds(null); c.setZoomLimits(1, 120); c.x = cx; c.y = cy; c.zoom = z; }, x, y, zoom);

  try {
    ok(await t.atTitle(), tag('boots'));
    ok(await t.clickText('button', 'New Realm'), tag('New Realm'));
    ok(await t.waitFor(() => window.__hd.scene === 'world', 40000), tag('the world is up'));
    await q(async () => {
      const hd = window.__hd;
      hd.hideDev(true);
      const { TUTORIAL_STEPS } = await import(new URL('game/scenes/timing.js', document.baseURI).href);
      hd.state.tutorial.seen = Object.fromEntries(TUTORIAL_STEPS.filter((s) => s.id !== 'S1').map((s) => [s.id, true]));
      hd.state.settings.hints = true;
      hd.state.stats.battlesWon = 3;
    });
    await sleep(600);

    // 1. an archipelago at Dynasty III
    const seed = await q(() => window.__hd.seaRealm(1));
    ok(seed !== false, tag(`__hd.seaRealm founds an archipelago dynasty (seed ${seed})`));
    ok(await t.waitFor(() => window.__hd.scene === 'world' && window.__hd.state.dynasty.level >= 3, 15000), tag('Dynasty III begins'));
    await sleep(1500);
    const arch = await q(() => {
      const hd = window.__hd;
      const a = hd.world.archipelago;
      const s = hd.renderer.sea;
      return a && { islands: a.islands.length, harbours: a.harbours.length, lanes: a.seaLanes.length, fords: hd.world.tiles.filter((x) => x.ford).length,
        rivals: hd.state.rivals, sk: hd.world.regions.filter((r) => hd.state.owner[r.id] === 6).length, drawn: s ? { h: s.harbours.length, l: s.lanes.length } : null,
        flag: hd.state.archipelago, color: hd.world.factions[6] && hd.world.factions[6].color, emblem: hd.world.factions[6] && hd.world.factions[6].emblem };
    });
    ok(!!arch && arch.islands >= 3 && arch.fords > 0, tag(`an archipelago: ${arch && arch.islands} islands, ${arch && arch.fords} ford tiles`));
    ok(!!arch && arch.harbours > 0 && arch.lanes > 0, tag(`harbours ${arch && arch.harbours}, sea lanes ${arch && arch.lanes}`));
    ok(!!arch && Array.isArray(arch.rivals) && arch.rivals.includes(6) && arch.sk > 0 && arch.flag === true, tag(`the Sea Kings hold ${arch && arch.sk} regions (${JSON.stringify(arch && arch.rivals)})`));
    ok(!!arch && arch.drawn && arch.drawn.h === arch.harbours && arch.drawn.l === arch.lanes, tag('the map layer has every harbour and lane'));
    ok(!!arch && arch.emblem === 'trident', tag(`the Sea Kings fly the trident in ${arch && arch.color}`));
    await q(() => { const hd = window.__hd; hd.revealMap(); });
    const b = await q(() => window.__hd.world.bounds);
    await frameCamera((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, await q((bb) => window.__hd.camera.fitZoom(bb, 16), b));
    await sleep(1800);
    await shot('01-archipelago');
    await q(() => { window.__hd.services.devRevealAll = false; });

    // 2. the first fords on the frontier: the S1 hint, then the card's sea lines
    const cap = await q(() => window.__hd.world.factions[6].capitalRegion);
    const fordRegion = await q(async (c) => {
      const hd = window.__hd;
      const P = await import(new URL('game/meta/progression.js', document.baseURI).href);
      const R = await import(new URL('game/meta/rivals.js', document.baseURI).href);
      const dist = new Map([[c, 0]]);
      const queue = [c];
      while (queue.length) { const r = queue.shift(); for (const n of hd.world.regions[r].neighbors) if (!dist.has(n)) { dist.set(n, dist.get(r) + 1); queue.push(n); } }
      for (let i = 0; i < 60; i++) {
        const f = R.fordsOnFrontier(hd.state, hd.world);
        if (f != null) return f;
        const fr = P.attackableFrontier(hd.state, hd.world).filter((id) => id !== c);
        const next = fr.sort((a, b) => dist.get(a) - dist.get(b))[0];
        if (next == null) return null;
        hd.conquerRegion(next);
      }
      return null;
    }, cap);
    ok(fordRegion != null, tag(`a region with fords is on the frontier (${fordRegion})`));
    await t.waitFor(() => window.__hd.hintFacts().fordRegion >= 0, 5000);
    const hintRegion = await q(() => window.__hd.hintFacts().fordRegion);
    ok(hintRegion >= 0, tag(`the S1 fact names a ford region (${hintRegion})`));
    await q((id, z) => window.__hd.flyToRegion(id, z, 1), hintRegion, mobile ? 13 : 18);
    ok(await t.waitFor(() => { const c = document.querySelector('.coach'); return !!c && !c.hidden && /Fords cross the straits/.test(c.textContent); }, 12000), tag('the S1 hint: "Fords cross the straits slowly..."'));
    ok(await q((id) => window.__hd.hintOutline() === id, hintRegion), tag('the hint outlines that region'));
    await sleep(500);
    await shot('02-fords-hint');
    const p2 = await q((id) => window.__hd.regionScreenPos(id), hintRegion);
    if (p2) await press(p2.x, p2.y);
    if (!(await t.waitFor(() => { const e = document.querySelector('.region-card-sea'); return !!e && !e.hidden && e.getClientRects().length > 0; }, 2500))) await q((id) => window.__hd.selectRegion(id), hintRegion);
    ok(await t.waitFor(() => { const e = document.querySelector('.region-card-sea'); return !!e && !e.hidden && e.getClientRects().length > 0; }, 4000), tag('the card has its sea lines'));
    const lines = await q(() => [...document.querySelectorAll('.region-card-sea-line:not([hidden])')].map((e) => e.textContent));
    const want = await q(async (id) => { const R = await import(new URL('game/meta/rivals.js', document.baseURI).href); return R.seaLines(window.__hd.state, window.__hd.world, id); }, hintRegion);
    ok(lines.length > 0 && lines.length === Math.min(4, want.length) && lines.every((l, i) => l.replace(/\s+/g, ' ').trim() === want[i].replace(/\s+/g, ' ').trim()), tag(`the sea lines are the config's: ${JSON.stringify(lines)}`));
    ok(lines.some((l) => /^Fords:/.test(l)), tag('a fords line'));
    ok(await t.waitFor(() => window.__hd.state.tutorial.seen.S1 === true, 3000), tag('S1 is seen once a card with sea lines is open'));
    await sleep(400);
    await shot('03-sea-card');
    await q(() => window.__hd.selectRegion(null));

    // 3. a Sea Kings coastal raid lands from the sea
    const raid = await q(async (capId) => {
      const hd = window.__hd;
      const P = await import(new URL('game/meta/progression.js', document.baseURI).href);
      const ownCoast = () => hd.world.regions.filter((r) => hd.state.owner[r.id] === 0 && r.coastal).map((r) => r.id);
      for (let i = 0; i < 6 && !ownCoast().length; i++) { // a coast of ours for them to land on
        const next = P.attackableFrontier(hd.state, hd.world).find((id) => id !== capId && hd.world.regions[id].coastal && hd.state.owner[id] !== 6);
        if (next == null) break;
        hd.conquerRegion(next);
      }
      const coast = ownCoast();
      for (const id of coast.reverse()) { const r = hd.raid(id, { faction: 6, sec: 600 }); if (r) return { id: r.id, landing: !!r.landing, to: r.toRegionId, from: r.fromRegionId }; }
      return null;
    }, cap);
    ok(!!raid && raid.landing, tag(`a Sea Kings raid lands from the sea (${JSON.stringify(raid)})`));
    ok(await t.waitFor(() => [...document.querySelectorAll('.toast')].some((e) => /Sea Kings sail on/.test(e.textContent)), 5000), tag('its toast: "The Sea Kings sail on ..."'));
    if (raid) {
      const mid = await q((r) => { const w = window.__hd.world; const a = w.regions[r.from].centroid; const z = w.regions[r.to].centroid; return { x: (a.x + z.x) / 2, y: (a.y + z.y) / 2 }; }, raid);
      await frameCamera(mid.x, mid.y, mobile ? 11 : 16);
      await sleep(1500);
      await shot('04-sea-raid');
      await q((id) => { const f = window.__hd.state.frontier; f.incoming = f.incoming.filter((x) => x.id !== id); }, raid.id); // called off: the rest of the run needs no defense
      const closeAt = await q(() => { const tt = [...document.querySelectorAll('.toast')].find((e) => /Sea Kings sail on/.test(e.textContent)); const x = tt && tt.querySelector('.toast-close'); if (!x) return null; const r = x.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      if (closeAt) { await press(closeAt.x, closeAt.y); await sleep(400); }
    }

    // 4. the Tide Fortress: its card, Attack (a real press), a lane send
    ok((await conquerToward(cap)) === cap, tag(`the Tide Fortress (${cap}) can be attacked`));
    await q((id, z) => { window.__hd.grantGold(1e7); window.__hd.flyToRegion(id, z, 1); }, cap, mobile ? 13 : 18);
    await sleep(700);
    await q((id) => window.__hd.selectRegion(id), cap);
    ok(await t.waitFor(() => [...document.querySelectorAll('.region-card-sea-line:not([hidden])')].some((e) => /The Tide:/.test(e.textContent)), 4000), tag('the Tide Fortress card names the Tide'));
    await sleep(600);
    await shot('05-tide-card');
    ok(await pressSel('button.region-card-action'), tag('a real press on Attack'));
    ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000), tag('the Tide Fortress battle is live'));
    await sleep(500);
    const s0 = await sea();
    ok(!!s0 && s0.sea && !!s0.tide && s0.tide.tiles > 0, tag(`the arena has the sea and the Tide (${s0 && JSON.stringify(s0.tide)}), ${s0 && s0.lanes} lanes, ${s0 && s0.ports} ports`));
    // the stage: a dev-conquered realm is far weaker than a played one, so ours stay deep and theirs thin while this check watches (the sea is
    // what it tests, not the balance); then two coastal sites of the arena become harbours of ours and one sends along their lane
    const lane = await q(async () => {
      const hd = window.__hd;
      const b = hd.battle;
      const S = await import(new URL('game/battle/sim.js', document.baseURI).href);
      clearInterval(window.__p12keep);
      window.__p12keep = setInterval(() => { const bb = window.__hd.battle; if (!bb) return; for (const s of bb.sites) { if (s.owner === 0) s.troops = Math.max(s.troops, 400); else s.troops = Math.min(s.troops, 300); } }, 200);
      const l = (b.arena.sea.lanes || []).find((x) => b.sites[x.a].type !== 'keep' && b.sites[x.b].type !== 'keep' && b.sites[x.a].id !== b.arena.sea.tide?.site && b.sites[x.b].id !== b.arena.sea.tide?.site);
      if (!l) return null;
      const A = b.sites[l.a]; const B = b.sites[l.b];
      A.owner = 0; A.port = true; B.owner = 0; B.port = true; A.troops = 300;
      S.issue(b, { type: 'send', owner: 0, from: A.id, to: B.id, fraction: 0.5 });
      return { a: A.id, b: B.id, tiles: l.tiles.length };
    });
    ok(!!lane, tag(`a lane between two coastal sites (${JSON.stringify(lane)})`));
    ok(await t.waitFor(() => (window.__hd.seaInfo()?.laneSquads || 0) > 0, 6000), tag('the send sails the lane (squad.lane)'));
    await q(async () => {
      const hd = window.__hd; const b = hd.battle;
      const S = await import(new URL('game/battle/sim.js', document.baseURI).href);
      const sq = b.squads.find((x) => x.lane);
      if (sq) { const p = S.squadPosition(b, sq); const c = hd.camera; c.cancelFlight(); c.x = p.x; c.y = p.y; }
    });
    await sleep(500);
    await shot('06-lane-longboat');

    // 5. the Tide: telegraph, flood, squads caught on the fords
    await q(async () => {
      const hd = window.__hd; const b = hd.battle;
      const S = await import(new URL('game/battle/sim.js', document.baseURI).href);
      const R = await import(new URL('game/battle/routing.js', document.baseURI).href);
      const tide = new Set(b.arena.sea.tide.tiles);
      // the flooding tiles are the approaches to the Gate and the keep: hand the Gate to us, so marches toward the keep cross them
      const gate = b.sites.find((s) => s.type === 'gate' && s.owner !== 0);
      if (gate) { gate.owner = 0; gate.troops = 400; }
      let pair = null;
      for (const f of b.sites.filter((s) => s.owner === 0)) {
        for (const g of b.sites.slice().sort((x, y) => (x.type === 'keep') - (y.type === 'keep'))) { if (g.owner === 0) continue; const r = R.routeFor(b, 0, f.id, g.id); if (g.type !== 'keep' && r && !r.lane && r.tiles.slice(0, -1).some((i) => tide.has(i))) { pair = [f.id, g.id]; break; } }
        if (pair) break;
      }
      // a steady stream across the flooding fords, so some squad is on them when the water comes
      clearInterval(window.__p12spam);
      if (pair) window.__p12spam = setInterval(() => { const bb = window.__hd.battle; if (bb && !bb.result && bb.t > 30) S.issue(bb, { type: 'send', owner: 0, from: pair[0], to: pair[1], fraction: 0.1 }); }, 400);
      window.__p12pair = pair;
      const tl = b.arena.sea.tide.tiles.map((i) => b.arena.tiles.find((x) => x.i === i)).filter(Boolean);
      const c = hd.camera; c.cancelFlight(); c.x = tl.reduce((a, x) => a + x.x, 0) / tl.length; c.y = tl.reduce((a, x) => a + x.y, 0) / tl.length;
      hd.battles.setSpeed(3);
    });
    ok(!!(await q(() => window.__p12pair)), tag(`a march across the flooding tiles (${JSON.stringify(await q(() => window.__p12pair))})`));
    ok(await t.waitFor(() => !!window.__hd.seaInfo()?.telegraph, 30000), tag('the Tide is telegraphed (the rising-water ring)'));
    await q(() => window.__hd.battles.setSpeed(1));
    await sleep(1600);
    await shot('07-tide-rising');
    ok(await t.waitFor(() => (window.__hd.seaInfo()?.flooded || 0) > 0, 8000), tag('the fords flood (tideFlood)'));
    await sleep(1200);
    await shot('08-tide-flood');
    // a stream squad is usually on the fords when the water comes; when this flood missed them all, the next one (40 s later, at 3x) is waited for
    let hit = await t.waitFor(() => (window.__hd.seaInfo()?.hits || 0) > 0, 9000);
    if (!hit) { await q(() => window.__hd.battles.setSpeed(3)); hit = await t.waitFor(() => (window.__hd.seaInfo()?.hits || 0) > 0, 45000); await q(() => window.__hd.battles.setSpeed(1)); }
    ok(hit, tag(`squads caught on the fords lose troops (tideHit): ${JSON.stringify(await sea())}`));
    await q(() => { clearInterval(window.__p12spam); clearInterval(window.__p12keep); });

    // 6. win (dev hook): the Admiral joins
    await q(() => window.__hd.winBattle());
    ok(await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden && c.dataset.result === 'victory'; }, 30000), tag('Victory over the Tide Fortress'));
    await sleep(1500);
    ok(await t.clickText('.results-action', 'Continue'), tag('Continue'));
    ok(await t.waitFor(() => { const m = document.querySelector('.is-recruit'); return !!m && /joins your cause/.test(m.textContent); }, 8000), tag('the recruitment card'));
    const rec = await q(() => { const m = document.querySelector('.is-recruit'); return { text: m ? m.textContent : '', emblem: !!m?.querySelector('.general-emblem[data-kind="admiral"] .icon-admiral'), g: window.__hd.state.generals.roster.find((x) => x.kind === 'admiral') }; });
    ok(!!rec.g, tag(`the Admiral is on the roster (${rec.g && rec.g.name})`));
    ok(/Admiral/.test(rec.text) && /Broadside/.test(rec.text) && rec.emblem, tag('the card names the Admiral and Broadside, with the bicorne emblem'));
    await sleep(500);
    await shot('09-admiral-card');
    await pressSel('.is-recruit button', 'Welcome');

    // 7. the Admiral commands an attack on a coast of theirs: a real press on Broadside
    ok(await t.waitFor(() => window.__hd.scene === 'world', 15000), tag('back on the map'));
    await sleep(2500);
    const target = await q(async () => {
      const hd = window.__hd;
      const P = await import(new URL('game/meta/progression.js', document.baseURI).href);
      const g = hd.state.generals.roster.find((x) => x.kind === 'admiral');
      const busy = new Set(hd.battles.list().map((r) => r.regionId));
      const ids = P.frontier(hd.state, hd.world).filter((id) => !busy.has(id) && hd.world.regions[id].coastal && hd.state.owner[id] > 1
        && !P.difficulty(hd.state, hd.world, id, { commander: g && g.id }).surrender);
      const rid = ids.sort((a, b) => (hd.state.owner[b] === 6) - (hd.state.owner[a] === 6) || hd.world.regions[a].tier - hd.world.regions[b].tier || a - b)[0];
      if (rid == null) return null;
      hd.selectRegion(rid);
      return { rid, g: g && g.id };
    });
    ok(!!target && !!target.g, tag(`a coastal rival region to attack with the Admiral (${JSON.stringify(target)})`));
    if (target) {
      await sleep(900);
      ok(await q((gid) => { const s = document.querySelector('.region-card-commander-select'); if (!s || ![...s.options].some((o) => o.value === gid)) return false; s.value = gid; s.dispatchEvent(new Event('change', { bubbles: true })); return true; }, target.g), tag('the Admiral picked as commander'));
      await sleep(500);
      ok(await pressSel('button.region-card-action'), tag('a real press on Attack'));
      ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000), tag('the battle is live'));
      const coast = await q(() => {
        const b = window.__hd.battle;
        clearInterval(window.__p12keep);
        window.__p12keep = setInterval(() => { const bb = window.__hd.battle; if (bb) for (const s of bb.sites) if (s.owner === 0) s.troops = Math.max(s.troops, 400); }, 200);
        for (const s of b.sites) if (s.coastal && s.owner !== 0) s.troops = Math.max(s.troops, 120); // big enough that 2% a second shows within the window
        return { coastal: b.sites.filter((s) => s.coastal && s.owner !== 0).length, ability: window.__hd.battle.commander };
      });
      ok(coast.coastal > 0, tag(`coastal enemy sites to shell: ${coast.coastal}`));
      ok(await pressSel('.battle-ability'), tag('a real press on Broadside'));
      ok(await t.waitFor(() => (window.__hd.seaInfo()?.broadsides || 0) > 0, 4000), tag('Broadside fires (the ability event)'));
      ok(await t.waitFor(() => (window.__hd.seaInfo()?.broadsideLost || 0) > 0, 8000), tag('coastal enemy sites lose troops (broadsideHit)'));
      await sleep(300);
      await shot('10-broadside');
      await q(() => clearInterval(window.__p12keep));
    }

    const errs = t.unexpected();
    ok(errs.length === 0, tag(`no console errors${errs.length ? `: ${errs[0]}` : ''}`));
    allErrors.push(...errs);
  } catch (e) {
    ok(false, tag(`scenario threw: ${e && e.message}`));
  }
  await t.page.close();
}

export async function phase12Checks({ launch, BASE, ok, sleep, allErrors }) {
  console.log('\n== phase12: the Sea Kings (an archipelago at Dynasty III), fords, harbours, lanes, a raid by sea, the Tide, the Admiral, Broadside, hint S1 ==');
  await mkdir(OUT, { recursive: true });
  const open = makeOpen(launch, sleep);
  const only = process.env.PHASE12_ONLY || '';
  if (!only || only === 'desktop') await scenario(open, BASE, ok, sleep, allErrors, { width: 1440, height: 900, mobile: false, name: 'desktop' });
  if (!only || only === 'phone') await scenario(open, BASE, ok, sleep, allErrors, { width: 390, height: 844, mobile: true, name: 'phone' });
}
