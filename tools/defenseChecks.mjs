// Real-browser checks for defenses (DESIGN 10.1-10.3, 10.6): run by tools/frontierChecks.mjs (`check.mjs --only=frontier`). Real input where a press matters;
// dev hooks only to set the stage (a realm bordering a rival, a fortification, a Work and prosperity in the target, a raid launched now, a short siege, a
// forced loss / win where the outcome itself is not what is being checked) and to read state.
//   a. a raid is announced: a toast with Go and a countdown, the war band on the map, the region's card says "Under attack"; a real press on Go
//   b. it arrives: the defense opens (Go was pressed), site 0 is the enemy's war-band camp, the HUD counts the siege down ("Hold")
//   c. Map: the defense runs on unwatched and the Captain (the steward) commands it
//   d. a defense won: back on it from the tray, the siege runs out with the keep held: "Defended", Continue pays the reward
//   e. a defense lost: "Region lost", the region is OCCUPIED (its fortification and Work move to the occupier, its prosperity is frozen)
//   f. retaken: the card says Retake; a real press, a won battle, Continue: the region, its fortification, its Work and its prosperity are back

export async function defenseScenario(open, BASE, ok, sleep, allErrors, { width, height, mobile, name }) {
  const t = await open(`${BASE}/index.html?dev=1&seed=7`, { width, height, mobile });
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const press = async (x, y) => {
    if (mobile) {
      await t.page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await sleep(70);
      await t.page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await t.page.mouse('mouseMoved', x, y, 'none', 0);
      await t.page.mouse('mousePressed', x, y, 'left', 1);
      await sleep(70);
      await t.page.mouse('mouseReleased', x, y, 'left', 0);
    }
  };
  const centre = (sel) => q((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.getClientRects().length && !x.closest('[hidden]')); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  const pressSel = async (sel) => { const c = await centre(sel); if (!c) return false; await press(c.x, c.y); return true; };
  const countdown = () => q(() => { const e = [...document.querySelectorAll('.toast')].find((x) => /arrives in/.test(x.textContent)); const m = e && e.textContent.match(/arrives in (\d+)/); return m ? +m[1] : null; });
  try {
    ok(await t.atTitle(), `defense ${name}: boots`);
    ok(await t.clickText('button', 'New Realm'), `defense ${name}: New Realm`);
    ok(await t.waitFor(() => window.__hd.scene === 'world', 40000), `defense ${name}: the world is up`);
    // the stage: hints off, a realm that borders a rival; the target gets an Arrow Tower, a Barracks and some prosperity first
    const stage = await q(async () => {
      const hd = window.__hd;
      hd.state.settings.hints = false;
      hd.state.stats.battlesWon = 1;
      const F = await import(new URL('game/meta/frontier.js', document.baseURI).href);
      const W = await import(new URL('game/meta/works.js', document.baseURI).href);
      const FO = await import(new URL('game/meta/forts.js', document.baseURI).href);
      for (let i = 0; i < 12 && !F.borderingRivals(hd.state, hd.world).length; i++) hd.conquerRegions(1);
      const rivals = F.borderingRivals(hd.state, hd.world);
      if (!rivals.length) return null;
      const home = hd.world.startRegion;
      const pair = rivals.flatMap((r) => r.pairs).find((p) => p.to !== home) || rivals[0].pairs[0];
      hd.state.gold += 1e6;
      hd.advanceTenure(3);
      const fort = FO.buildFort(hd.state, hd.world, pair.to, 'tower');
      const work = W.buildWork(hd.state, hd.world, pair.to, 'barracks');
      return {
        to: pair.to, fort: !!fort, work: !!work, prosperity: hd.state.prosperity[pair.to] | 0,
        forts: JSON.stringify(hd.state.forts[pair.to] || []), works: JSON.stringify(hd.state.works[pair.to] || []),
      };
    });
    ok(!!stage, `defense ${name}: a realm bordering a rival`);
    if (!stage) return;
    ok(stage.fort && stage.work && stage.prosperity >= 1, `defense ${name}: the target has an Arrow Tower, a Barracks and Prosperity ${stage.prosperity}`);
    const T = stage.to;

    // a. the raid is announced
    const raid = await q((to) => window.__hd.raid(to, { sec: 10, first: true }), T);
    ok(!!raid && raid.toRegionId === T, `defense ${name}: a war band sets out against region ${T}`);
    ok(await t.waitFor(() => [...document.querySelectorAll('.toast')].some((e) => /marches on .+: arrives in \d+ s/.test(e.textContent) && e.querySelector('.toast-action')), 3000), `defense ${name}: a toast says who marches where and when, with Go`);
    const c1 = await countdown();
    await sleep(2300);
    const c2 = await countdown();
    ok(c1 != null && c2 != null && c2 < c1, `defense ${name}: the countdown counts down (${c1} -> ${c2} s)`);
    ok(await q(() => (window.__hd.state.frontier.incoming || []).length === 1), `defense ${name}: the war band is on the map (state.frontier.incoming, drawn by render/warBands.js)`);
    ok(await pressSel('.toast .toast-action'), `defense ${name}: a real press on Go`);
    ok(await t.waitFor(() => { const c = document.querySelector('.region-card'); return !!c && c.getClientRects().length > 0 && /arrive in \d+ s/i.test(c.textContent); }, 3000), `defense ${name}: Go opens the region's card: the war band arrives in N s`);

    // b. it arrives: the defense opens (Go was pressed)
    ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live' && window.__hd.battles.list().some((r) => r.kind === 'defense'), 25000), `defense ${name}: on arrival the defense opens`);
    const d = await q(() => { const r = window.__hd.battles.focused(); return r ? { kind: r.kind, region: r.regionId, site0Owner: r.battle.sites[0].owner, site0Type: r.battle.sites[0].type, mode: r.battle.mode, id: r.id } : null; });
    ok(!!d && d.kind === 'defense' && d.region === T && d.mode === 'defense', `defense ${name}: it is the defense of the region (mode ${d && d.mode})`);
    ok(!!d && d.site0Type === 'camp' && d.site0Owner !== 0, `defense ${name}: site 0 is the ENEMY war-band camp (owner ${d && d.site0Owner})`);
    ok(await t.waitFor(() => /Hold \d+:\d\d/.test(document.querySelector('.battle-swift')?.textContent || ''), 3000), `defense ${name}: the HUD counts the siege down`);
    if (!d) return;

    // c. Map: the Captain holds it while nobody watches
    await sleep(400);
    ok(await pressSel('.battle-map'), `defense ${name}: a real press on Map`);
    ok(await t.waitFor(() => window.__hd.scene === 'world', 8000), `defense ${name}: back on the map, the defense still running`);
    await sleep(4000);
    const stew = await q((id) => { const r = window.__hd.battles.get(id); return r ? { memo: !!r.battle.steward, t: r.battle.t, result: r.battle.result || null } : null; }, d.id);
    ok(!!stew && stew.memo, `defense ${name}: the Captain (the steward) commands it while unwatched (its memo is in the battle)`);
    ok(!!stew && stew.result == null, `defense ${name}: and it holds meanwhile (t ${stew && stew.t.toFixed(1)} s)`);
    ok(await q(() => { const c = document.querySelector('.battle-tray'); return !!c && !c.hidden && /^Defense of /.test(c.querySelector('.tray-chip')?.getAttribute('aria-label') || ''); }), `defense ${name}: the tray shows it as a defense`);

    // d. a defense won: back from the tray, the siege runs out with the keep held
    ok(await pressSel('.tray-chip'), `defense ${name}: a real press on its chip`);
    ok(await t.waitFor((id) => window.__hd.scene === 'battle' && window.__hd.battles.focusedId === id, 8000, d.id), `defense ${name}: watching the defense again`);
    await sleep(800);
    const gold0 = await q(() => window.__hd.state.gold);
    await q((id) => { const b = window.__hd.battles.get(id).battle; b.siegeSec = b.t + 1; }, d.id); // a short siege, for the check
    ok(await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden && c.dataset.result === 'defended'; }, 15000), `defense ${name}: the siege runs out with the keep held: "Defended"`);
    await sleep(1200); // the card settles (its crowns land) before a player presses Continue
    ok(await t.clickText('.results-action', 'Continue'), `defense ${name}: Continue`);
    ok(await t.waitFor(() => window.__hd.scene === 'world', 8000), `defense ${name}: back on the map`);
    ok(await q((g) => window.__hd.state.gold > g, gold0), `defense ${name}: the defense paid its reward`);
    ok(await q((to) => window.__hd.state.owner[to] === 0 && !window.__hd.battles.list().length, T), `defense ${name}: the region is still yours; the battle is over`);

    // e. a defense lost: the region is occupied; its fortification and Work now fight for the occupier
    await sleep(500);
    const raid2 = await q((to) => { window.__hd.state.frontier.cooldown = {}; return window.__hd.raid(to, { sec: 3 }); }, T);
    ok(!!raid2, `defense ${name}: a second war band`);
    ok(await pressSel('.toast .toast-action'), `defense ${name}: Go again`);
    ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 25000), `defense ${name}: the second defense opens`);
    await sleep(800);
    await q(() => window.__hd.loseBattle());
    ok(await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden && c.dataset.result === 'occupied'; }, 12000), `defense ${name}: lost: "Region lost"`);
    ok(await t.clickText('.results-action', 'Back to Map'), `defense ${name}: Back to Map`);
    ok(await t.waitFor(() => window.__hd.scene === 'world', 8000), `defense ${name}: on the map`);
    const occ = await q((to) => { const s = window.__hd.state; const o = s.occupation[to]; return { owner: s.owner[to], by: o ? o.by : null, forts: o ? JSON.stringify(o.forts) : '', works: o ? JSON.stringify(o.works) : '', pros: o ? o.prosperity : -1 }; }, T);
    ok(occ.owner !== 0 && occ.by === occ.owner, `defense ${name}: the region is occupied by the attacker (owner ${occ.owner})`);
    ok(occ.forts === stage.forts && occ.works === stage.works, `defense ${name}: its fortification and Work went with it`);
    ok(occ.pros === stage.prosperity, `defense ${name}: its prosperity is frozen, not erased (${occ.pros})`);

    // f. retaken
    await q((to) => window.__hd.selectRegion(to), T);
    await sleep(1300);
    ok(await q(() => /Occupied by the .+: retake it/.test(document.querySelector('.region-card-occupied')?.textContent || '')), `defense ${name}: the card says "Occupied by ...: retake it ..."`);
    // the card says what a retake really pays: "Retake reward N gold", N from the payout's own function (meta/progression.js conquestBounty)
    const reward = await q(async (to) => {
      const P = await import(new URL('game/meta/progression.js', document.baseURI).href);
      const F = await import(new URL('game/ui/format.js', document.baseURI).href);
      const hd = window.__hd;
      const want = P.conquestBounty(hd.state, hd.world, to);
      const line = [...document.querySelectorAll('.region-card-rewards span')].map((e) => e.textContent).find((x) => /reward|bounty/i.test(x)) || '';
      return { line, want, wantText: `Retake reward ${F.shortNumber(want)} gold`, full: P.conquestBounty(hd.state, hd.world, to) < (await import(new URL('game/meta/economy.js', document.baseURI).href)).bounty(hd.state, hd.world, to), crownsShown: !document.querySelector('.region-card-crowns')?.hidden, payable: P.crownsPayable(hd.state, to), gold: hd.state.gold };
    }, T);
    ok(reward.line === reward.wantText && reward.full, `defense ${name}: the card shows the retake reward ("${reward.line}", want "${reward.wantText}", less than a conquest bounty)`);
    ok(reward.crownsShown === reward.payable, `defense ${name}: the crowns row shows only when a retake can pay crowns (payable ${reward.payable}, shown ${reward.crownsShown})`);
    ok(await t.clickText('.region-card-action', 'Retake'), `defense ${name}: a real press on Retake`);
    ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000), `defense ${name}: the retaking battle is live`);
    await sleep(600);
    await q(() => window.__hd.winBattle());
    ok(await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden && c.dataset.result === 'victory'; }, 30000), `defense ${name}: retaken: Victory`);
    // the victory card's bounty is the same retake figure (game/tests/meta.progression.test.js proves conquer pays exactly conquestBounty)
    const cardBounty = await q(() => ([...document.querySelectorAll('.results-stat span')].map((e) => e.textContent).find((x) => /bounty$/.test(x)) || ''));
    ok(cardBounty === reward.wantText.replace(/^Retake reward (.+) gold$/, '+$1 bounty'), `defense ${name}: the victory card shows the same retake figure ("${cardBounty}")`);
    await sleep(1200); // the card settles (its crowns land) before a player presses Continue
    ok(await t.clickText('.results-action', 'Continue'), `defense ${name}: Continue`);
    const yours = await t.waitFor((to) => window.__hd.scene === 'world' && window.__hd.state.owner[to] === 0, 12000, T);
    const why = yours ? '' : await q((to) => JSON.stringify({ scene: window.__hd.scene, owner: window.__hd.state.owner[to], runs: window.__hd.battles.list().map((r) => [r.kind, r.regionId, r.battle.result]), card: document.querySelector('.results-card') && !document.querySelector('.results-card').hidden, phase: window.__hd.battlePhase }), T);
    ok(yours, `defense ${name}: the region is yours again${why ? ` (${why})` : ''}`);
    const back = await q((to) => { const s = window.__hd.state; return { forts: JSON.stringify(s.forts[to] || []), works: JSON.stringify(s.works[to] || []), pros: s.prosperity[to] | 0, occ: !!s.occupation[to] }; }, T);
    ok(back.forts === stage.forts, `defense ${name}: its fortification is back (${back.forts})`);
    ok(back.works === stage.works, `defense ${name}: its Work is back (${back.works})`);
    ok(back.pros === stage.prosperity && !back.occ, `defense ${name}: its prosperity is back (${back.pros}) and the occupation is over`);
    ok(t.unexpected().length === 0, `defense ${name}: no console errors${t.unexpected().length ? `: ${t.unexpected()[0]}` : ''}`);
  } catch (err) {
    ok(false, `defense ${name}: unexpected error: ${err && err.message}`);
  } finally {
    allErrors.push(...t.unexpected().map((e) => `[defense ${name}] ${e}`));
    await t.page.close();
  }
}
