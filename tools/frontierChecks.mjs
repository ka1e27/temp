// Real-browser checks for the Living Frontier's several-battles-at-once (DESIGN 10.5, ARCHITECTURE 10.1): run by tools/check.mjs (`--only=frontier`).
// Real pointer / touch / keyboard input wherever a press matters; dev hooks only to set the stage (a second region next to the realm) and to read state.
//   1. Map from a running battle: the battle keeps running behind the map, the tray shows it, its region wears crossed swords
//   2. a second attack from the map while the first runs: two runs; the tray in a battle shows both
//   3. switching with a real click on a tray chip (the camera flies, the manager's focus moves), and with Tab on the battle map
//   4. the unwatched battle keeps stepping (its clock moves) while you watch the other
//   5. save and resume with 2 running battles (reload, Continue)
//   6. the tray at phone width: on screen, clear of the battle HUD, touch targets >= 44 px
//
// Usage: await frontierChecks({ launch, BASE, ok, sleep, allErrors })
import { makeOpen, settledCentre } from './robustChecks.mjs';
import { defenseScenario } from './defenseChecks.mjs';

async function scenario(open, BASE, ok, sleep, allErrors, { width, height, mobile, name }) {
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
  const centre = (sel) => q((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.getClientRects().length && !x.closest('[hidden]')); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }, sel);
  const pressSel = async (sel) => { const c = await settledCentre(() => centre(sel), sleep); if (!c) return false; await press(c.x, c.y); return true; };
  try {
    ok(await t.atTitle(), `frontier ${name}: boots`);
    ok(await t.clickText('button', 'New Realm'), `frontier ${name}: New Realm`);
    ok(await t.waitFor(() => window.__hd.scene === 'world', 40000), `frontier ${name}: the world is up`);
    // the stage: hints off, a won battle on the record (so "Map" is offered: never in the tutorial fight), two attackable regions
    const targets = await q(async () => {
      const hd = window.__hd;
      hd.state.settings.hints = false;
      hd.state.stats.battlesWon = 1;
      const P = await import(new URL('game/meta/progression.js', document.baseURI).href);
      return P.attackableFrontier(hd.state, hd.world).slice(0, 2);
    });
    ok(targets.length === 2, `frontier ${name}: two regions can be attacked (${targets.join(', ')})`);
    const [A, B] = targets;

    // 1. a battle, then Map: it keeps running behind the map
    await q((id) => window.__hd.startBattle(id), A);
    ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000), `frontier ${name}: battle 1 is live`);
    await sleep(600);
    ok(await t.waitFor(() => { const b = document.querySelector('.battle-map'); return !!b && !b.hidden && b.getClientRects().length > 0; }, 3000), `frontier ${name}: the battle HUD offers "Map" (leave it running)`);
    ok(await pressSel('.battle-map'), `frontier ${name}: a real press on Map`);
    ok(await t.waitFor(() => window.__hd.scene === 'world', 8000), `frontier ${name}: back on the map`);
    const t1 = await q(() => window.__hd.battles.list()[0].battle.t);
    await sleep(1500);
    // (game time steps by the frame clock, dt clamped to 0.25 s: at 2-3 frames a second, --cpu=4 at 1440x900, it runs slower than the wall clock)
    await t.waitFor((a) => { const r = window.__hd.battles.list()[0]; return !r || r.battle.t > a + 0.5; }, 6000, t1);
    const run1 = await q(() => { const r = window.__hd.battles.list()[0]; return r ? { id: r.id, t: r.battle.t, region: r.regionId } : null; });
    ok(!!run1 && run1.region === A, `frontier ${name}: the battle is still running (state.battles has it)`);
    ok(!!run1 && run1.t > t1 + 0.5, `frontier ${name}: and its clock moves while nobody watches (${t1.toFixed(1)} -> ${run1 && run1.t.toFixed(1)} s)`);
    ok(await t.waitFor(() => { const tr = document.querySelector('.battle-tray'); return !!tr && !tr.hidden && tr.querySelectorAll('.tray-chip').length === 1; }, 3000), `frontier ${name}: the tray shows it on the map`);
    const chipName = await q(() => document.querySelector('.tray-chip').getAttribute('aria-label'));
    ok(/^Attack on .+, \d+:\d\d, you hold \d+% of the troops/.test(chipName), `frontier ${name}: the chip has a full name ("${chipName}")`);
    ok(await q((id) => window.__hd.battles.busy().regions.has(id), A), `frontier ${name}: its region is busy (crossed swords are drawn over it)`);

    // 2. a second attack from the map (a real press on the card's Attack)
    await q((id) => window.__hd.selectRegion(id), B);
    await sleep(1200);
    ok(await t.clickText('.region-card-action', 'Attack'), `frontier ${name}: a real press on Attack for a second region`);
    ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live' && window.__hd.battles.list().length === 2, 30000), `frontier ${name}: two battles run`);
    await sleep(500);
    ok(await t.waitFor(() => { const tr = document.querySelector('.battle-tray'); return !!tr && !tr.hidden && tr.querySelectorAll('.tray-chip').length === 2; }, 3000), `frontier ${name}: the tray in a battle shows both`);
    const focused0 = await q(() => window.__hd.battles.focusedId);
    ok(focused0 !== run1.id, `frontier ${name}: the new battle is the one watched`);

    // 3a. switch with a real press on the other chip
    const chipA = await q((id) => { const rows = [...document.querySelectorAll('.tray-row')]; const i = window.__hd.battles.list().findIndex((r) => r.id === id); const b = rows[i] && rows[i].querySelector('.tray-chip'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }, run1.id);
    ok(!!chipA, `frontier ${name}: the first battle's chip is on screen`);
    if (chipA) await press(chipA.x, chipA.y);
    ok(await t.waitFor((id) => window.__hd.battles.focusedId === id && window.__hd.battle && window.__hd.battle.arena.regionId === window.__hd.battles.get(id).regionId, 4000, run1.id), `frontier ${name}: a press on the chip switches to that battle (the view shows its arena)`);
    ok(await t.waitFor(() => document.querySelector('.tray-row.is-focused .tray-chip')?.getAttribute('aria-current') === 'true', 2000), `frontier ${name}: its chip is marked as the one watched`);
    // 4. the unwatched one keeps going
    const other = await q((id) => window.__hd.battles.list().find((r) => r.id !== id).id, run1.id);
    const o0 = await q((id) => window.__hd.battles.get(id).battle.t, other);
    await sleep(1200);
    ok(await q((args) => window.__hd.battles.get(args[0]).battle.t > args[1] + 0.4, [other, o0]), `frontier ${name}: the battle not watched keeps stepping`);

    // 3b. Tab on the battle map switches to the next battle (desktop keyboard)
    if (!mobile) {
      await q(() => window.__hd.renderer.canvas.focus());
      const before = await q(() => window.__hd.battles.focusedId);
      const runs = await q(() => window.__hd.battles.list().map((r) => r.id));
      const expectNext = runs[runs.indexOf(before) + 1];
      await t.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await t.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      if (expectNext != null) {
        ok(await t.waitFor((id) => window.__hd.battles.focusedId === id, 3000, expectNext), `frontier ${name}: Tab on the battle map switches to the next battle`);
        await t.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await t.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await sleep(300);
        ok(await q((id) => window.__hd.battles.focusedId === id && document.activeElement !== window.__hd.renderer.canvas, expectNext), `frontier ${name}: from the last battle Tab moves focus on (the keyboard is never trapped)`);
      } else ok(false, `frontier ${name}: the watched battle was already the last one (order ${runs.join(',')}, focused ${before})`);
    }

    // 6. phone: the tray sits on screen, clear of the battle HUD's top cluster and pill, with 44 px targets
    if (mobile) {
      const lay = await q(() => {
        const box = (s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
        const tray = box('.battle-tray');
        const hits = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
        const chips = [...document.querySelectorAll('.tray-chip, .tray-auto')].map((e) => e.getBoundingClientRect()).map((r) => Math.min(r.width, r.height));
        return { tray, inView: !!tray && tray.l >= 0 && tray.r <= innerWidth && tray.t >= 0, overlap: hits(tray, box('.battle-top')) || hits(tray, box('.battle-topright')) || hits(tray, box('.battle-bottom')), minTarget: Math.min(...chips) };
      });
      ok(lay.inView, `frontier ${name}: the tray is fully on a phone screen`);
      ok(!lay.overlap, `frontier ${name}: and clear of the battle HUD`);
      ok(lay.minTarget >= 44, `frontier ${name}: its chips and Auto toggles are at least 44 px (${Math.round(lay.minTarget)})`);
    }

    // 5. save and resume with 2 running battles
    await q(() => window.__hd.services.autosave.save());
    await sleep(300);
    const saved = await q(() => { const s = JSON.parse(localStorage.getItem('hexdominion.v2')); return (s.battles || []).map((r) => ({ id: r.id, region: r.regionId, t: r.battle.t })); });
    ok(saved.length === 2, `frontier ${name}: both battles are in the save (${saved.length})`);
    await t.page.goto(`${BASE}/package.json`); // leave first (its pagehide autosave is fine: same battles)
    await sleep(300);
    await t.page.goto(`${BASE}/index.html?dev=1&seed=7`);
    ok(await t.atTitle(), `frontier ${name}: reload: the title`);
    ok(await t.clickText('button', 'Continue'), `frontier ${name}: Continue`);
    ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battles.list().length === 2, 15000), `frontier ${name}: the game resumes into a battle with both runs`);
    ok(await t.waitFor(() => { const tr = document.querySelector('.battle-tray'); return !!tr && !tr.hidden && tr.querySelectorAll('.tray-chip').length === 2; }, 4000), `frontier ${name}: the tray shows both after the resume`);
    const back = await q(() => window.__hd.battles.list().map((r) => ({ id: r.id, region: r.regionId, t: r.battle.t })));
    ok(saved.every((s) => back.some((b) => b.region === s.region && b.t >= s.t - 1e-6)), `frontier ${name}: the same battles, at least as far along`);
    ok(t.unexpected().length === 0, `frontier ${name}: no console errors${t.unexpected().length ? `: ${t.unexpected()[0]}` : ''}`);
  } catch (err) {
    ok(false, `frontier ${name}: unexpected error: ${err && err.message}`);
  } finally {
    allErrors.push(...t.unexpected().map((e) => `[frontier ${name}] ${e}`));
    await t.page.close();
  }
}

export async function frontierChecks({ launch, BASE, ok, sleep, allErrors }) {
  console.log('\n== frontier: several battles at once (Map, a second attack, tray switching, Tab, the unwatched battle runs, save and resume, phone tray) ==');
  const open = makeOpen(launch, sleep);
  await scenario(open, BASE, ok, sleep, allErrors, { width: 1440, height: 900, mobile: false, name: 'desktop' });
  await scenario(open, BASE, ok, sleep, allErrors, { width: 390, height: 844, mobile: true, name: 'phone' });
  console.log('\n== frontier: defenses (a raid with Go, the defense, the Captain unwatched, a win, a loss and occupation, a retake) ==');
  await defenseScenario(open, BASE, ok, sleep, allErrors, { width: 1440, height: 900, mobile: false, name: 'desktop' });
  await defenseScenario(open, BASE, ok, sleep, allErrors, { width: 390, height: 844, mobile: true, name: 'phone' });
}
