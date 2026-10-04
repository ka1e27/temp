// Real-browser checks for Generals and Renown (DESIGN 10.11, 10.12): run by tools/check.mjs (`--only=generals`), desktop and phone. Real pointer / touch /
// keyboard input wherever a press matters; dev hooks only to set the stage (regions, Renown, a level) and to read state.
//   1. the attack card's commander picker: the best free General by default, a keyboard change to the Militia Captain and back, Attack starts the
//      battle under the card's commander (run.commander)
//   2. the ability: a real press on the button (Shield Wall) in one battle, the G key in the next; used once per battle
//   3. save and resume keep the commander and the used ability
//   4. the Generals panel: a real press on the HUD button, a skill pick (two options, a confirm step), Train with Renown
//   5. a Festival from the owned card raises the region's prosperity a level and costs Renown
//   6. a capital won in battle recruits its champion: the recruitment card and a Chronicle line
//   7. Found a Dynasty: the roster keeps its levels and skills, Renown resets
import { makeOpen } from './robustChecks.mjs';

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
  const centre = (sel, txt) => q((s, tx) => {
    const e = [...document.querySelectorAll(s)].find((x) => x.getClientRects().length && !x.closest('[hidden]') && (!tx || x.textContent.includes(tx)));
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel, txt || null);
  const pressSel = async (sel, txt) => { const c = await centre(sel, txt); if (!c) return false; await sleep(150); const c2 = await centre(sel, txt); await press(c2.x, c2.y); return true; };
  const key = async (k, code, vk) => {
    await t.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
    await t.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };
  const winAndContinue = async (label) => {
    await q(() => window.__hd.winBattle());
    ok(await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden && c.dataset.result === 'victory'; }, 30000), `generals ${name}: ${label}: Victory`);
    await sleep(1500);
    ok(await t.clickText('.results-action', 'Continue'), `generals ${name}: ${label}: Continue`);
    ok(await t.waitFor(() => window.__hd.scene === 'world', 15000), `generals ${name}: ${label}: back on the map`);
    await sleep(800);
  };
  try {
    ok(await t.atTitle(), `generals ${name}: boots`);
    ok(await t.clickText('button', 'New Realm'), `generals ${name}: New Realm`);
    ok(await t.waitFor(() => window.__hd.scene === 'world', 40000), `generals ${name}: the world is up`);
    await q(() => { const hd = window.__hd; hd.hideDev(true); hd.state.settings.hints = false; hd.state.stats.battlesWon = 1; hd.state.renown.points = 60; });
    ok(await q(() => window.__hd.state.generals.roster.length >= 1 && window.__hd.state.generals.roster[0].id === 'marshal'), `generals ${name}: a new realm starts with the Marshal`);
    await sleep(600);
    ok(await t.waitFor(() => { const r = document.querySelector('.hud-renown'); return !!r && !r.hidden && /60/.test(r.textContent); }, 3000), `generals ${name}: the HUD shows the Renown laurel (60)`);

    // 1. the commander picker
    const A = await q(async () => { const P = await import(new URL('game/meta/progression.js', document.baseURI).href); return P.attackableFrontier(window.__hd.state, window.__hd.world)[0]; });
    await q((id) => window.__hd.selectRegion(id), A);
    await sleep(1300);
    ok(await q(() => { const s = document.querySelector('.region-card-commander-select'); return !!s && s.getClientRects().length > 0 && s.value === 'marshal'; }), `generals ${name}: the attack card offers "Commander", the Marshal by default`);
    await q(() => document.querySelector('.region-card-commander-select').focus());
    await key('ArrowDown', 'ArrowDown', 40);
    ok(await t.waitFor(() => document.querySelector('.region-card-commander-select').value === '', 1500), `generals ${name}: the keyboard picks the Militia Captain`);
    await key('ArrowUp', 'ArrowUp', 38);
    ok(await t.waitFor(() => document.querySelector('.region-card-commander-select').value === 'marshal', 1500), `generals ${name}: and back to the Marshal`);
    await q(() => document.activeElement && document.activeElement.blur());
    ok(await t.clickText('.region-card-action', 'Attack'), `generals ${name}: a real press on Attack`);
    ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000), `generals ${name}: the battle is live`);
    ok(await q(() => window.__hd.battles.focused().commander === 'marshal'), `generals ${name}: the Marshal commands it (run.commander)`);

    // 2a. the ability by a real press
    await sleep(800);
    ok(await t.waitFor(() => { const b = document.querySelector('.battle-ability'); return !!b && !b.hidden && !b.disabled && /Shield Wall/.test(b.textContent); }, 4000), `generals ${name}: the battle HUD shows the Marshal's Shield Wall`);
    ok(await pressSel('.battle-ability'), `generals ${name}: a real press on Shield Wall`);
    ok(await t.waitFor(() => window.__hd.battle.abilityUsed === true, 3000), `generals ${name}: it is used (battle.abilityUsed)`);
    ok(await q(() => window.__hd.battle.sites.some((s) => s.owner === 0 && (s.bulwarkUntil || 0) > window.__hd.battle.t)), `generals ${name}: your settlements are shielded`);
    ok(await t.waitFor(() => document.querySelector('.battle-ability')?.disabled === true, 2000), `generals ${name}: the button is spent for this battle`);

    // 3. save and resume keep the commander and the used ability
    await q(() => window.__hd.services.autosave.save());
    await sleep(300);
    await t.page.goto(`${BASE}/package.json`);
    await sleep(300);
    await t.page.goto(`${BASE}/index.html?dev=1&seed=7`);
    ok(await t.atTitle(), `generals ${name}: reload`);
    ok(await t.clickText('button', 'Continue'), `generals ${name}: Continue`);
    ok(await t.waitFor(() => window.__hd.scene === 'battle' && !!window.__hd.battles.focused(), 15000), `generals ${name}: the battle resumes`);
    ok(await q(() => window.__hd.battles.focused().commander === 'marshal' && window.__hd.battle.abilityUsed === true), `generals ${name}: with its commander and its ability still used`);
    await q(() => window.__hd.hideDev(true));
    // the tray: the chip shows the commander, and its picker changes it mid-battle (a keyboard change on the select)
    await sleep(600);
    ok(await pressSel('.battle-map'), `generals ${name}: Map (the battle keeps going)`);
    ok(await t.waitFor(() => window.__hd.scene === 'world' && !!document.querySelector('.tray-commander:not([hidden])'), 8000), `generals ${name}: the tray chip has a commander picker`);
    ok(await q(() => /commanded by .*Marshal/i.test(document.querySelector('.tray-chip').getAttribute('aria-label'))), `generals ${name}: the chip names the commander`);
    await q(() => document.querySelector('.tray-commander').focus());
    await key('ArrowDown', 'ArrowDown', 40);
    // a touch phone opens its own native picker, which CDP cannot drive: there the choice is made on the select itself (value + change, as the picker does)
    if (mobile && !(await t.waitFor(() => window.__hd.battles.list()[0].commander === null, 800))) {
      await q(() => { const s = document.querySelector('.tray-commander'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); });
    }
    ok(await t.waitFor(() => window.__hd.battles.list()[0].commander === null, 2000), `generals ${name}: the tray picker hands the battle to the Militia Captain`);
    if (mobile) await q(() => { const s = document.querySelector('.tray-commander'); s.value = 'marshal'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    else await key('ArrowUp', 'ArrowUp', 38);
    ok(await t.waitFor(() => window.__hd.battles.list()[0].commander === 'marshal', 2000), `generals ${name}: and back to the Marshal`);
    ok(await q(() => window.__hd.battles.list()[0].battle.abilityUsed === true), `generals ${name}: the used ability stays used after the change`);
    ok(await pressSel('.tray-chip'), `generals ${name}: back to the battle from its chip`);
    ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 8000), `generals ${name}: watching it again`);
    await winAndContinue('battle 1');

    // 2b. the ability by the G key (desktop), in the next battle
    if (!mobile) {
      const B = await q(async () => { const P = await import(new URL('game/meta/progression.js', document.baseURI).href); return P.attackableFrontier(window.__hd.state, window.__hd.world)[0]; });
      await q((id) => window.__hd.startBattle(id), B);
      ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000), `generals ${name}: battle 2 is live`);
      await sleep(600);
      await q(() => window.__hd.renderer.canvas.focus());
      await key('g', 'KeyG', 71);
      ok(await t.waitFor(() => window.__hd.battle.abilityUsed === true, 3000), `generals ${name}: G fires the ability`);
      await winAndContinue('battle 2');
    }

    // 4. the Generals panel: a skill pick with its confirm step, then Train
    await q(() => { const g = window.__hd.state.generals.roster[0]; g.level = Math.max(g.level, 2); g.skills = []; });
    ok(await pressSel('.hud-generals'), `generals ${name}: a real press on Generals`);
    ok(await t.waitFor(() => { const p = document.querySelector('.generals'); return !!p && !p.hidden && p.getClientRects().length > 0; }, 3000), `generals ${name}: the roster opens`);
    ok(await t.waitFor(() => document.querySelectorAll('.general-skill-option').length === 2, 2000), `generals ${name}: a 1-of-2 skill choice is offered`);
    ok(await pressSel('.general-skill-option'), `generals ${name}: a real press on the first option`);
    ok(await t.waitFor(() => !!document.querySelector('.general-skill-take'), 1500), `generals ${name}: a confirm step, nothing permanent yet`);
    ok(await q(() => window.__hd.state.generals.roster[0].skills.length === 0), `generals ${name}: still unpicked while the confirm is open`);
    ok(await pressSel('.general-skill-take'), `generals ${name}: Take it`);
    ok(await t.waitFor(() => window.__hd.state.generals.roster[0].skills[0] === 0, 2000), `generals ${name}: the skill is picked`);
    const before = await q(() => ({ level: window.__hd.state.generals.roster[0].level, renown: window.__hd.state.renown.points }));
    ok(await pressSel('.general-train'), `generals ${name}: a real press on Train`);
    ok(await t.waitFor((b) => window.__hd.state.generals.roster[0].level === b.level + 1 && window.__hd.state.renown.points < b.renown, 2000, before), `generals ${name}: Train raised the level and spent Renown`);
    ok(await pressSel('.generals-close'), `generals ${name}: close the roster`);
    await sleep(500);

    // 5. a Festival
    const owned = await q(() => { const hd = window.__hd; return hd.world.regions.find((r) => hd.state.owner[r.id] === 0 && r.id !== hd.world.startRegion)?.id ?? hd.world.startRegion; });
    await q((id) => window.__hd.selectRegion(id), owned);
    await sleep(1300);
    const p0 = await q((id) => ({ lv: window.__hd.state.prosperity[id] | 0, renown: window.__hd.state.renown.points }), owned);
    ok(await t.waitFor(() => { const b = document.querySelector('.region-card-festival'); return !!b && !b.hidden && !b.disabled && /^Festival · \d+$/.test(b.textContent.trim()) && !!b.querySelector('.icon-laurel') && /for \d+ Renown/.test(b.getAttribute('aria-label')); }, 3000), `generals ${name}: the owned card offers "Festival · N" with the laurel (named "... for N Renown")`);
    ok(await pressSel('.region-card-festival'), `generals ${name}: a real press on Festival`);
    ok(await t.waitFor((b) => (window.__hd.state.prosperity[b.id] | 0) === b.lv + 1 && window.__hd.state.renown.points < b.renown, 3000, { ...p0, id: owned }), `generals ${name}: the region's prosperity rose a level (${p0.lv} -> ${p0.lv + 1}) for Renown`);
    await q(() => window.__hd.selectRegion(null));
    await sleep(400);

    // 6. a capital won in battle recruits its champion
    const cap = await q(async () => {
      const hd = window.__hd;
      const P = await import(new URL('game/meta/progression.js', document.baseURI).href);
      for (let i = 0; i < 40; i++) {
        const c = P.attackableFrontier(hd.state, hd.world).find((id) => hd.world.regions[id].isCapital && hd.state.owner[id] >= 2);
        if (c != null) return c;
        if (!hd.conquerRegions(1)) break;
      }
      return null;
    });
    ok(cap != null, `generals ${name}: a rival capital can be attacked`);
    if (cap != null) {
      const before2 = await q(() => window.__hd.state.generals.roster.length);
      await q((id) => window.__hd.startBattle(id), cap);
      ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000), `generals ${name}: the capital battle is live`);
      await sleep(500);
      // Phase 7: the post-battle moments go one at a time BEFORE the scene leaves (Relic claim -> recruit card -> Boon draft), so the recruit card
      // now opens over the arena and the map follows its Welcome
      await q(() => window.__hd.winBattle());
      ok(await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden && c.dataset.result === 'victory'; }, 30000), `generals ${name}: the capital: Victory`);
      await sleep(1500);
      ok(await t.clickText('.results-action', 'Continue'), `generals ${name}: the capital: Continue`);
      ok(await t.waitFor(() => { const m = document.querySelector('.modal-backdrop.is-recruit, .is-recruit'); return !!m && /joins your cause/.test(m.textContent); }, 6000), `generals ${name}: the recruitment card says the champion joins your cause`);
      ok(await q((n) => window.__hd.state.generals.roster.length === n + 1 && window.__hd.state.generals.roster.some((g) => g.id.startsWith('champion:')), before2), `generals ${name}: the champion is on the roster`);
      ok(await q(() => window.__hd.state.chronicle.entries.some((e) => e.kind === 'recruit')), `generals ${name}: and in the Chronicle`);
      await t.clickText('.modal-actions button', 'Welcome');
      ok(await t.waitFor(() => window.__hd.scene === 'world', 15000), `generals ${name}: the capital: back on the map`);
      await sleep(800);
    }

    // 7. Found a Dynasty: the Generals persist, Renown resets
    await q(() => { window.__hd.conquerRegions(9999); window.__hd.state.renown.points = 9; }); // (the other capitals recruit their champions too)
    const roster0 = await q(() => JSON.stringify(window.__hd.state.generals.roster.map((g) => [g.id, g.level, g.skills])));
    await sleep(600);
    ok(await pressSel('.hud-btn[aria-label="Realm stats"]'), `generals ${name}: open the Realm`);
    await sleep(1400);
    ok(await pressSel('.dynasty-found-btn'), `generals ${name}: Found a Dynasty`);
    // the founding ceremony (Phase 5): straight through it with an Edict (no Legacy, no Challenge); tools/phase5Checks.mjs presses every page for real
    ok(await t.waitFor(() => { const c = document.querySelector('.ceremony'); return !!c && !c.hidden; }, 3000), `generals ${name}: the founding ceremony`);
    ok(await q(async () => {
      const step = () => new Promise((r) => setTimeout(r, 250));
      for (let i = 0; i < 2; i++) { document.querySelector('.ceremony-next').click(); await step(); }
      const card = document.querySelector('.ceremony .edict-card'); if (card) card.click();
      for (let i = 0; i < 2; i++) { document.querySelector('.ceremony-next').click(); await step(); }
      return document.querySelector('.ceremony').dataset.page === 'found';
    }), `generals ${name}: the ceremony's last page`);
    ok(await pressSel('.ceremony-found'), `generals ${name}: Found the House`);
    ok(await t.waitFor(() => window.__hd.state.dynasty.level === 2, 10000), `generals ${name}: Dynasty II`);
    ok(await q((r) => JSON.stringify(window.__hd.state.generals.roster.map((g) => [g.id, g.level, g.skills])) === r, roster0), `generals ${name}: the roster kept every General, level and skill`);
    // Renown resets for the new dynasty, except what an earned Dragonslayer deed grants at each dynasty start (Phase 4, meta/deeds.js)
    // (plus Patronage's Legacy Renown, and nothing else; the Edict's mods do not grant Renown at the start)
    const renownAfter = await q(async () => { const D = await import(new URL('game/meta/deeds.js', document.baseURI).href); const E = await import(new URL('game/meta/edicts.js', document.baseURI).href); return { points: window.__hd.state.renown.points, start: D.deedBonuses(window.__hd.state).renownAtDynastyStart + (E.edictMods(window.__hd.state).startRenown || 0) }; });
    ok(renownAfter.points === renownAfter.start, `generals ${name}: Renown reset for the new dynasty (${JSON.stringify(renownAfter)})`);
    ok(t.unexpected().length === 0, `generals ${name}: no console errors${t.unexpected().length ? `: ${t.unexpected()[0]}` : ''}`);
  } catch (err) {
    ok(false, `generals ${name}: unexpected error: ${err && err.message}`);
  } finally {
    allErrors.push(...t.unexpected().map((e) => `[generals ${name}] ${e}`));
    await t.page.close();
  }
}

export async function generalsChecks({ launch, BASE, ok, sleep, allErrors }) {
  console.log('\n== generals: commander picker, ability (click and G), save/resume, skill pick, Train, Festival, a recruit, Found a Dynasty ==');
  const open = makeOpen(launch, sleep);
  await scenario(open, BASE, ok, sleep, allErrors, { width: 1440, height: 900, mobile: false, name: 'desktop' });
  await scenario(open, BASE, ok, sleep, allErrors, { width: 390, height: 844, mobile: true, name: 'phone' });
}
