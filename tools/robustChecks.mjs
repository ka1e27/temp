// Real-browser regression checks for the robustness round (bug-hunt items 1-4; item 5, the service worker, is in tools/check.mjs deployChecks).
// Imported and run by tools/check.mjs (both the plain run and --base=...). Each scenario uses its own Chrome with a fresh profile and real pointer events
// where a click matters. The failures they guard against were found by an independent audit:
//   1. Attack on a region whose border is all mountains threw inside the battle scene and left a stale battle HUD on a frozen map (soft-lock).
//   2. A returning player's Welcome-back card (and negative gold) from the REPLACED realm appeared after New Realm; an untouched title tab "earned" gold too.
//   3. A second tab showing only the title overwrote the save of the tab being played (progress and upgrades lost).
//   4. A saved battle that could not be resumed bricked Continue (and was re-saved forever).
//
// Usage: await robustChecks({ launch, BASE, ok, sleep, allErrors })

/** Console errors the checks cause on purpose (the scene manager logs a scene that could not be entered). */
const EXPECTED = /^\[scene\] could not enter|battle resume failed|could not enter battle/;

/** Opens a fresh Chrome (own profile) on `url`; returns the page and the helpers every scenario uses. */
export function makeOpen(launch, sleep) {
  return async function open(url, { width = 1280, height = 800, mobile = false, init } = {}) {
    const page = await launch({ url: 'about:blank', width, height });
    const errors = [];
    page.on((method, params) => {
      if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text);
      else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') errors.push(params.args.map((a) => a.value ?? a.description).join(' '));
    });
    // the real device size (the headless window never goes below about 500 px wide), with touch when it is a phone
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    if (mobile) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    if (init) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: init });
    await page.goto(url);
    const waitFor = async (fn, timeout = 20000, ...args) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        try { if (await page.eval(fn, ...args)) return true; } catch { /* navigating */ }
        await sleep(100);
      }
      return false;
    };
    // a real press: a touch on a phone, a mouse press otherwise
    const press = async (x, y) => {
      if (mobile) {
        await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
        await sleep(70);
        await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse('mouseMoved', x, y, 'none', 0);
        await page.mouse('mousePressed', x, y, 'left', 1);
        await sleep(80);
        await page.mouse('mouseReleased', x, y, 'left', 0);
      }
    };

    const clickText = async (sel, text) => {
      const pos = await page.eval((s, t) => {
        const b = [...document.querySelectorAll(s)].find((e) => e.textContent.trim().toLowerCase() === t.toLowerCase() && e.getClientRects().length && !e.closest('[hidden]'));
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, sel, text);
      if (!pos) return false;
      await press(pos.x, pos.y);
      return true;
    };
    // a real click on the first visible element matching a CSS selector (and, when given, containing the text), scrolled into view first
    const clickSel = async (sel, text) => {
      const pos = await page.eval(async (q, t) => {
        const els = [...document.querySelectorAll(q)].filter((e) => e.getClientRects().length && !e.closest('[hidden]') && (!t || e.textContent.toLowerCase().includes(t.toLowerCase())));
        const el = els[0];
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        await new Promise((r) => setTimeout(r, 120));
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, sel, text || null);
      if (!pos) return false;
      await press(pos.x, pos.y);
      return true;
    };
    const unexpected = () => errors.filter((e) => !EXPECTED.test(String(e)));
    return { page, errors, waitFor, clickText, clickSel, unexpected, atTitle: async () => {
        const there = await waitFor(() => !!window.__hd && window.__hd.scene === 'title', 30000);
        // the ?dev=1 panel sits over a phone's title buttons: real presses need the real layout
        if (there) await page.eval(() => window.__hd.hideDev(true)).catch(() => {});
        return there;
      } };
  };
}

export async function robustChecks({ launch, BASE, ok, sleep, allErrors }) {
  console.log('\n== robustness: attack soft-lock, stale welcome, two tabs, unresumable battle ==');
  const URL0 = `${BASE}/index.html?dev=1`;
  const open = makeOpen(launch, sleep);

  const visible = (sel) => (s) => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && e.getClientRects().length > 0; };

  // ---- 1. Attack soft-lock ------------------------------------------------------------------------------------------------------------------------------
  {
    const t = await open(`${URL0}&seed=3`);
    try {
      ok(await t.atTitle(), 'robust 1: the game boots');
      // a frontier region the arena cannot be built for (mountains all along the border): the scan tries a few seeds and conquest counts
      const found = await t.page.eval(async () => {
        const hd = window.__hd;
        const A = await import(new URL('game/battle/arena.js', document.baseURI).href);
        const P = await import(new URL('game/meta/progression.js', document.baseURI).href);
        for (const seed of [3, 1, 2, 4, 5, 6, 8, 9, 10, 11, 12]) {
          hd.reseed(seed);
          await new Promise((r) => setTimeout(r, 700));
          for (let n = 0; n <= 2; n++) {
            if (n > 0) hd.conquerRegions(1);
            const fr = P.frontier(hd.state, hd.world);
            const bad = fr.filter((id) => !A.canBuildArena(hd.world, hd.state.owner, id));
            if (bad.length) return { seed, conquered: n, bad: bad[0], good: fr.find((id) => A.canBuildArena(hd.world, hd.state.owner, id)) ?? null };
          }
        }
        return null;
      });
      ok(!!found, `robust 1: a region the arena cannot be built for exists to test with${found ? ` (seed ${found.seed}, region ${found.bad})` : ''}`);
      if (found) {
        const { bad, good } = found;
        t.page.eval((id) => window.__hd.selectRegion(id), bad);
        await sleep(1200);
        const card = await t.page.eval(() => {
          const vis = (e) => !!e && !e.closest('[hidden]') && !e.hidden && e.getClientRects().length > 0;
          return {
            note: vis(document.querySelector('.region-card-blocked')) ? document.querySelector('.region-card-blocked').textContent.trim() : null,
            attack: vis(document.querySelector('.region-card-action')),
          };
        });
        ok(/no passable border/i.test(card.note || '') && !card.attack, `robust 1: the card of an unattackable region says "${card.note}" and offers no Attack button`);
        // the dev hook and the Attack handler share the guard: nothing starts, the world stays live
        await t.page.eval((id) => window.__hd.startBattle(id), bad);
        await sleep(800);
        let st = await t.page.eval(() => ({ scene: window.__hd.scene, hud: !!document.querySelector('.hud') && document.querySelector('.hud').getClientRects().length > 0, battleHud: !!document.querySelector('.battle-hud') && !document.querySelector('.battle-hud').hidden && document.querySelector('.battle-hud').getClientRects().length > 0 }));
        ok(st.scene === 'world' && st.hud && !st.battleHud, `robust 1: Attack on it starts nothing (scene ${st.scene}, no stale battle HUD)`);
        // and even when something DOES throw while entering the battle (a bug elsewhere), the player is put back on the map with a word, not left on a frozen one
        await t.page.eval((id) => window.__hd.goto.battle({ regionId: id }), bad);
        await sleep(900);
        st = await t.page.eval(() => ({
          scene: window.__hd.scene,
          hud: !!document.querySelector('.hud') && document.querySelector('.hud').getClientRects().length > 0,
          battleHud: !!document.querySelector('.battle-hud') && !document.querySelector('.battle-hud').hidden && document.querySelector('.battle-hud').getClientRects().length > 0,
          toast: [...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | '),
          battle: !!window.__hd.battle && window.__hd.battlePhase !== undefined && (window.__hd.state.battles || []).length > 0,
        }));
        ok(st.scene === 'world' && st.hud && !st.battleHud, `robust 1: a battle that throws on entry puts the player back on the map (scene ${st.scene}; the world HUD is up, the battle HUD is gone)`);
        ok(/couldn.t start that battle/i.test(st.toast), `robust 1: and a toast says so ("${st.toast.slice(0, 60)}")`);
        // the map still works afterwards: a real click on Attack of a valid frontier region starts a real battle
        if (good != null) {
          await t.page.eval((id) => window.__hd.selectRegion(id), good);
          await sleep(1000);
          ok(await t.clickText('.region-card-action', 'Attack') || await t.clickText('.region-card button', 'Attack'), 'robust 1: after the failure a real click on Attack of another region lands');
          ok(await t.waitFor(() => window.__hd.scene === 'battle', 12000), 'robust 1: ... and starts a battle (the game was not left in a broken state)');
        }
        ok(t.unexpected().length === 0, `robust 1: no unexpected console errors${t.unexpected().length ? `: ${t.unexpected()[0]}` : ''}`);
      }
    } catch (err) {
      ok(false, `robust 1: unexpected error: ${err && err.message}`);
    } finally {
      allErrors.push(...t.unexpected().map((e) => `[robust 1] ${e}`));
      await t.page.close();
    }
  }

  // ---- 2. a welcome belongs to the realm it was made for -------------------------------------------------------------------------------------------------
  {
    // A: a returning player (save on disk, 3 h away) presses NEW REALM instead of Continue
    const first = await open(`${URL0}&seed=7`);
    let savedOwned = 0;
    try {
      ok(await first.atTitle(), 'robust 2: boots');
      ok(await first.clickText('button', 'New Realm'), 'robust 2: New Realm clicked');
      ok(await first.waitFor(() => window.__hd.scene === 'world', 12000), 'robust 2: the first realm starts');
      await first.page.eval(() => { window.__hd.conquerRegions(2); window.__hd.grantGold(500); });
      ok(await first.waitFor(() => { try { const s = JSON.parse(localStorage.getItem('hexdominion.v2')); return s.owner.filter((o) => o === 0).length >= 3; } catch { return false; } }, 15000), 'robust 2: the realm is saved');
      savedOwned = await first.page.eval(() => JSON.parse(localStorage.getItem('hexdominion.v2')).owner.filter((o) => o === 0).length);
      const profile = first.page; // keep this Chrome: the same profile is reloaded "3 hours later"
      await profile.send('Page.addScriptToEvaluateOnNewDocument', { source: '(() => { const rn = Date.now.bind(Date); Date.now = () => rn() + 3 * 3600 * 1000; })();' });
      await profile.goto(`${URL0}&seed=7`);
      ok(await first.atTitle(), 'robust 2: reloaded 3 hours later: the title shows');
      ok(await first.waitFor(() => !!window.__hd.services && !!window.__hd.services.pendingWelcome, 4000), 'robust 2: (control) a welcome card was prepared for the resumed realm');
      ok(await first.clickText('button', 'New Realm'), 'robust 2: New Realm pressed instead of Continue (opens the confirmation)');
      await sleep(600);
      ok(await first.clickText('.modal button, [role=dialog] button', 'New Realm') || await first.clickText('button', 'New Realm'), 'robust 2: the confirmation is accepted');
      ok(await first.waitFor(() => window.__hd.scene === 'world', 12000), 'robust 2: the new realm starts');
      await sleep(2500);
      const w = await first.page.eval(() => ({
        gold: document.querySelector('.hud-gold-value') ? document.querySelector('.hud-gold-value').textContent : null,
        stateGold: window.__hd.state.gold,
        welcome: !!document.querySelector('.welcome-card') && !document.querySelector('.welcome-card').closest('[hidden]') && document.querySelector('.welcome-card').getClientRects().length > 0,
        pending: !!window.__hd.services.pendingWelcome,
        owned: window.__hd.state.owner.filter((o) => o === 0).length,
      }));
      ok(w.owned === 1, `robust 2: it really is a NEW realm (owns ${w.owned} region)`);
      ok(!w.welcome && !w.pending, 'robust 2: no Welcome-back card from the replaced realm (none shown, none pending)');
      ok(w.stateGold >= 0 && !/^[-−]/.test(String(w.gold || '')), `robust 2: gold is not negative (HUD "${w.gold}", state ${Math.round(w.stateGold)})`);
      ok(first.unexpected().length === 0, `robust 2A: no console errors${first.unexpected().length ? `: ${first.unexpected()[0]}` : ''}`);
    } catch (err) {
      ok(false, `robust 2A: unexpected error: ${err && err.message}`);
    } finally {
      allErrors.push(...first.unexpected().map((e) => `[robust 2A] ${e}`));
      await first.page.close();
    }

    // B: a first-ever visit, the tab hidden for 10 minutes on the title, then New Realm: nothing was earned by an untouched realm
    const b = await open(`${URL0}&seed=7`);
    try {
      ok(await b.atTitle(), 'robust 2B: fresh profile boots to the title');
      await b.page.eval(() => { const rn = Date.now.bind(Date); Date.now = () => rn() + 10 * 60 * 1000; document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(500);
      ok(await b.clickText('button', 'New Realm'), 'robust 2B: New Realm clicked');
      ok(await b.waitFor(() => window.__hd.scene === 'world', 12000), 'robust 2B: the realm starts');
      await sleep(2000);
      const w = await b.page.eval(() => ({
        welcome: !!document.querySelector('.welcome-card') && !document.querySelector('.welcome-card').closest('[hidden]') && document.querySelector('.welcome-card').getClientRects().length > 0,
        gold: window.__hd.state.gold,
      }));
      ok(!w.welcome && w.gold >= 0 && w.gold < 100, `robust 2B: no welcome-back for an untouched realm and no gold for the time the title was open (gold ${Math.round(w.gold)})`);
    } catch (err) {
      ok(false, `robust 2B: unexpected error: ${err && err.message}`);
    } finally {
      allErrors.push(...b.unexpected().map((e) => `[robust 2B] ${e}`));
      await b.page.close();
    }
    void savedOwned;
  }

  // ---- 3. two tabs, one save -----------------------------------------------------------------------------------------------------------------------------
  {
    const a = await open(`${URL0}&seed=7`, { width: 1100, height: 700 });
    try {
      ok(await a.atTitle(), 'robust 3: tab A boots');
      await a.page.eval(() => window.__hd.reseed(7));
      ok(await a.waitFor(() => window.__hd.scene === 'world', 12000), 'robust 3: tab A is in a session');
      await a.page.eval(() => { window.__hd.grantGold(100000); window.__hd.conquerRegions(1); });
      const savedOwned = () => a.page.eval(() => { const s = JSON.parse(localStorage.getItem('hexdominion.v2')); return s.owner.filter((o) => o === 0).length; });
      ok(await a.waitFor(() => { try { return JSON.parse(localStorage.getItem('hexdominion.v2')).owner.filter((o) => o === 0).length >= 2; } catch { return false; } }, 15000), 'robust 3: tab A saved its first conquest');
      // "open the game in a second tab": an iframe on the same origin shares localStorage exactly like a second tab
      await a.page.eval((u) => { const f = document.createElement('iframe'); f.id = 'tabB'; f.src = u; f.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:200px;opacity:0.01;z-index:-1'; document.body.appendChild(f); }, `${URL0}`);
      ok(await a.waitFor(() => { const w = document.getElementById('tabB').contentWindow; return !!w.__hd && w.__hd.scene === 'title'; }, 30000), 'robust 3: tab B boots from the save and sits on the title');
      // the player carries on in tab A: three more conquests and an upgrade
      await a.page.eval(async () => { const hd = window.__hd; hd.conquerRegions(3); const U = await import(new URL('game/meta/upgrades.js', document.baseURI).href); U.buyMax(hd.state, 'steel'); });
      ok(await a.waitFor(() => { try { return JSON.parse(localStorage.getItem('hexdominion.v2')).owner.filter((o) => o === 0).length >= 5; } catch { return false; } }, 15000), 'robust 3: tab A saved its further progress (5 regions)');
      // tab B is told at once (storage event) and shows the persistent banner with a Reload button
      ok(await a.waitFor(() => { const d = document.getElementById('tabB').contentDocument; const b = d.querySelector('.tab-banner'); return !!b && !!b.querySelector('button') && /another tab/i.test(b.textContent); }, 6000), 'robust 3: the idle tab B shows "open in another tab" with a Reload button');
      // tab B now starts a session from its stale copy (Continue) and has all the time in the world to autosave: it must not
      await a.page.eval(() => { const d = document.getElementById('tabB').contentDocument; [...d.querySelectorAll('button')].find((x) => /continue/i.test(x.textContent)).click(); });
      await sleep(900);
      const sceneB = await a.page.eval(() => document.getElementById('tabB').contentWindow.__hd.scene);
      await sleep(12000); // more than two autosave intervals in both tabs
      const owned = await savedOwned();
      const upg = await a.page.eval(() => JSON.parse(localStorage.getItem('hexdominion.v2')).upgrades.steel || 0);
      ok(owned >= 5 && upg >= 1, `robust 3: tab B (scene ${sceneB}) never overwrote tab A's progress: the save still has ${owned} regions and steel ${upg}`);
      // tab A is not disturbed: it keeps saving and shows no banner
      await a.page.eval(() => window.__hd.conquerRegions(1));
      ok(await a.waitFor(() => { try { return JSON.parse(localStorage.getItem('hexdominion.v2')).owner.filter((o) => o === 0).length >= 6; } catch { return false; } }, 15000), 'robust 3: tab A keeps saving (a 6th region reaches the save)');
      ok(await a.page.eval(() => !document.querySelector('.tab-banner')), 'robust 3: tab A shows no banner');
      // reloading A (the "Reload" button's effect) continues from the newest save
      await a.page.goto(`${URL0}`);
      ok(await a.atTitle(), 'robust 3: reload A');
      ok(await a.page.eval(() => window.__hd.state.owner.filter((o) => o === 0).length >= 6), 'robust 3: after a reload tab A has all its regions');
      ok(a.unexpected().length === 0, `robust 3: no console errors${a.unexpected().length ? `: ${a.unexpected()[0]}` : ''}`);
    } catch (err) {
      ok(false, `robust 3: unexpected error: ${err && err.message}`);
    } finally {
      allErrors.push(...a.unexpected().map((e) => `[robust 3] ${e}`));
      await a.page.close();
    }
  }

  // ---- 4. an unresumable battle never bricks Continue ---------------------------------------------------------------------------------------------------
  {
    const t = await open(`${URL0}&seed=7`);
    try {
      ok(await t.atTitle(), 'robust 4: boots');
      await t.page.eval(() => window.__hd.reseed(7));
      ok(await t.waitFor(() => window.__hd.scene === 'world', 12000), 'robust 4: a session starts');
      await t.page.eval(() => { const id = window.__hd.world.regions.find((r) => r.tier === 1).id; window.__hd.startBattle(id); });
      ok(await t.waitFor(() => window.__hd.scene === 'battle', 12000), 'robust 4: a battle starts');
      ok(await t.waitFor(() => { try { const s = JSON.parse(localStorage.getItem('hexdominion.v2')); return Array.isArray(s.battles) && !!s.battles[0] && s.battles[0].battle.version === 1; } catch { return false; } }, 15000), 'robust 4: the battle is in the save');
      const good = await t.page.eval(() => localStorage.getItem('hexdominion.v2'));
      // leave the game page (its pagehide autosave would overwrite what the next steps write), then edit the save
      const variants = [
        ['control (an untouched battle)', () => {}, 'resumes'],
        ['a save from before the battle manager (a single state.battle)', 'legacy', 'resumes'],
        ['arena missing', (b) => { delete b.arena; }, 'dropped'],
        ['empty object', () => ({}), 'dropped'],
        ['plausible shape, broken inside (arena tiles)', (b) => { b.arena.tiles = [1]; }, 'reverted'],
        ['plausible shape, broken inside (a null squad)', (b) => { b.squads = [null]; }, 'reverted'],
      ];
      for (const [name, edit, expect] of variants) {
        await t.page.goto(`${BASE}/package.json`);
        await sleep(400);
        const save = JSON.parse(good);
        if (edit === 'legacy') { save.battle = save.battles[0].battle; delete save.battles; } // ARCHITECTURE 10.2: migrates into a one-element state.battles
        else {
          const r = edit(save.battles[0].battle);
          if (r !== undefined) save.battles[0].battle = r;
        }
        await t.page.eval((s) => localStorage.setItem('hexdominion.v2', s), JSON.stringify(save));
        await t.page.goto(`${URL0}`);
        ok(await t.atTitle(), `robust 4 [${name}]: the title shows (the save loads)`);
        const clicked = await t.clickText('button', 'Continue');
        ok(clicked, `robust 4 [${name}]: Continue is offered and clicked`);
        await sleep(2800);
        const st = await t.page.eval(() => ({
          scene: window.__hd.scene,
          hasBattleState: (window.__hd.state.battles || []).length > 0,
          worldHud: !!document.querySelector('.hud') && document.querySelector('.hud').getClientRects().length > 0,
          toast: [...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | '),
        }));
        if (expect === 'resumes') ok(st.scene === 'battle' && st.hasBattleState, `robust 4 [${name}]: a real saved battle still resumes (scene ${st.scene})`);
        else {
          ok(st.scene === 'world' && st.worldHud && !st.hasBattleState, `robust 4 [${name}]: Continue lands on the map and the broken battle is cleared (scene ${st.scene})`);
          if (expect === 'reverted') ok(/couldn.t be resumed/i.test(st.toast), `robust 4 [${name}]: a toast explains it ("${st.toast.slice(0, 70)}")`);
        }
      }
      // a battle for a region the player has meanwhile taken is dropped too (a ghost fight)
      await t.page.goto(`${BASE}/package.json`);
      await sleep(400);
      const owned = JSON.parse(good);
      owned.owner[owned.battles[0].battle.arena.regionId] = 0;
      await t.page.eval((s) => localStorage.setItem('hexdominion.v2', s), JSON.stringify(owned));
      await t.page.goto(`${URL0}`);
      ok(await t.atTitle(), 'robust 4 [region already owned]: the title shows');
      ok(await t.clickText('button', 'Continue'), 'robust 4 [region already owned]: Continue clicked');
      await sleep(2500);
      ok(await t.page.eval(() => window.__hd.scene === 'world' && !(window.__hd.state.battles || []).length), 'robust 4 [region already owned]: lands on the map with no ghost battle');
      // and the autosave does not write the dead battle back
      await sleep(6500);
      const stored = await t.page.eval(() => { const s = JSON.parse(localStorage.getItem('hexdominion.v2')); return !!s.battle || (Array.isArray(s.battles) && s.battles.length > 0); });
      ok(!stored, 'robust 4: the save no longer carries an unresumable battle after the next autosave');
    } catch (err) {
      ok(false, `robust 4: unexpected error: ${err && err.message}`);
    } finally {
      allErrors.push(...t.unexpected().map((e) => `[robust 4] ${e}`));
      await t.page.close();
    }
  }
}
