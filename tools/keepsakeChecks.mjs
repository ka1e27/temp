// Keepsakes in the REAL game (docs/briefs/keepsakes-hookup.md), run by tools/check.mjs: a won battle writes a Chronicle line that survives a reload, Prosperity III
// writes one, the Realm panel shows the story and "Save the map" produces a picture, the Found a Dynasty confirmation has the same button and the new chapter opens with
// its line; on a phone the stats are two columns so the Chronicle starts on the first screen. (The components themselves: tools/gallery/keepsakes-check.mjs.)
import { makeOpen } from './robustChecks.mjs';

export async function keepsakeChecks({ launch, BASE, ok, sleep, allErrors, only }) {
  const open = makeOpen(launch, sleep);
  const URL0 = `${BASE}/index.html?dev=1&seed=7`;
  for (const [name, opts] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844, mobile: true }]]) {
    if (only && only !== name) continue;
    console.log(`\n== keepsakes (${name}): the Chronicle and Save the map in the real game ==`);
    const t = await open(URL0, opts);
    const q = (fn, ...a) => t.page.eval(fn, ...a);
    const openRealm = async () => {
      await t.clickSel('button[aria-label="Realm stats"]');
      return t.waitFor(() => { const r = document.querySelector('.realm'); return !!r && !r.hidden && r.getClientRects().length > 0; }, 4000);
    };
    const closeRealm = async () => { await t.clickSel('.realm-close'); await sleep(250); };
    try {
      ok(await t.atTitle(), `keepsakes ${name}: boots`);
      ok(await t.clickText('button', 'New Realm'), `keepsakes ${name}: New Realm clicked`);
      ok(await t.waitFor(() => window.__hd.scene === 'world', 30000), `keepsakes ${name}: a realm starts`);
      await q(() => { window.__hd.hideDev(true); window.__hd.state.settings.hints = false; });
      // a real battle, won: the conquest line is written by the battle scene
      const target = await q(async () => {
        const hd = window.__hd;
        const A = await import(new URL('game/battle/arena.js', document.baseURI).href);
        const P = await import(new URL('game/meta/progression.js', document.baseURI).href);
        const id = P.frontier(hd.state, hd.world).find((i) => A.canBuildArena(hd.world, hd.state.owner, i));
        return { id, name: hd.world.regions[id].name };
      });
      await q((id) => window.__hd.startBattle(id), target.id);
      ok(await t.waitFor(() => window.__hd.scene === 'battle', 15000), `keepsakes ${name}: a battle starts`);
      ok(await t.waitFor(() => window.__hd.battlePhase === 'live', 20000), `keepsakes ${name}: the battle is live (the fly-in is over)`);
      await q(() => window.__hd.winBattle());
      ok(await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden && c.dataset.result === 'victory'; }, 20000), `keepsakes ${name}: victory`);
      await sleep(600);
      ok(await t.clickSel('.results-action', 'Continue'), `keepsakes ${name}: Continue clicked`);
      ok(await t.waitFor(() => window.__hd.scene === 'world', 15000), `keepsakes ${name}: back on the map`);
      ok(await q((id) => window.__hd.state.owner[id] === 0, target.id), `keepsakes ${name}: the region is ours`);
      const lines = await q(() => window.__hd.state.chronicle.entries.map((e) => e.kind));
      ok(lines.includes('firstConquest'), `keepsakes ${name}: the battle victory wrote the first-conquest line (${lines.join(', ')})`);
      // Prosperity III (a region held for 8+ hours): the wrapper around every prosperity tick writes it
      await q(() => window.__hd.advanceTenure(9));
      await sleep(300);
      ok(await q(() => window.__hd.state.chronicle.entries.some((e) => e.kind === 'prosperity3')), `keepsakes ${name}: the first Prosperity III wrote its line`);
      // the Realm panel shows the story
      ok(await openRealm(), `keepsakes ${name}: the Realm panel opens`);
      await sleep(500);
      const shown = await q(() => ({
        rows: [...document.querySelectorAll('.realm .chron-row')].map((r) => r.dataset.kind),
        text: [...document.querySelectorAll('.realm .chron-text')].map((r) => r.textContent).join(' | '),
        saveBtn: !!document.querySelector('.realm .keepsake-save'),
      }));
      ok(shown.rows.includes('firstConquest') && shown.rows.includes('prosperity3'), `keepsakes ${name}: the Chronicle lists both lines (${shown.rows.join(', ')})`);
      ok(shown.text.includes(target.name), `keepsakes ${name}: and the first names the region ("${shown.text.slice(0, 90)}")`);
      ok(shown.saveBtn, `keepsakes ${name}: the Realm panel has a Save the map button`);
      // the phone layout: two stat columns, the story on the first screen, nothing sideways
      const lay = await q(() => {
        const grid = document.querySelector('.realm-stats-grid');
        const chron = document.querySelector('.realm .chron');
        const body = document.querySelector('.realm-body');
        return {
          cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          chronTop: Math.round(chron.getBoundingClientRect().top),
          vh: innerHeight,
          overflow: body.scrollWidth - body.clientWidth,
        };
      });
      if (opts.mobile) {
        ok(lay.cols === 2, `keepsakes ${name}: the stats grid has two columns below 480 px (${lay.cols})`);
        ok(lay.chronTop < lay.vh, `keepsakes ${name}: the Chronicle starts on the first screen (top ${lay.chronTop} of ${lay.vh})`);
      } else ok(lay.cols === 2, `keepsakes ${name}: the stats grid keeps its two columns (${lay.cols})`);
      ok(lay.overflow <= 1, `keepsakes ${name}: nothing scrolls sideways in the Realm panel (${lay.overflow})`);
      // reload: the story is in the save
      await closeRealm();
      await sleep(5800); // an autosave tick; leaving the page saves too
      await t.page.goto(URL0);
      ok(await t.atTitle(), `keepsakes ${name}: reload`);
      ok(await t.waitFor(() => [...document.querySelectorAll('.title-actions button')].some((b) => /continue/i.test(b.textContent) && !b.hidden && b.getClientRects().length > 0), 10000), `keepsakes ${name}: Continue is offered`);
      ok(await t.clickText('button', 'Continue'), `keepsakes ${name}: Continue`);
      ok(await t.waitFor(() => window.__hd.scene === 'world', 12000), `keepsakes ${name}: the realm is back`);
      ok(await q(() => window.__hd.state.chronicle.entries.length >= 2), `keepsakes ${name}: the Chronicle survived the reload`);
      // Save the map: a real click, then a success toast naming the file
      await q(() => window.__hd.hideDev(true));
      ok(await openRealm(), `keepsakes ${name}: the Realm panel opens again`);
      ok(await t.clickSel('.realm .keepsake-save'), `keepsakes ${name}: Save the map clicked`);
      ok(await t.waitFor(() => { const s = document.querySelector('.realm .keepsake-save-status'); return !!s && !s.hidden && /map saved/i.test(s.textContent) && s.getAttribute('aria-live') === 'polite'; }, 30000), `keepsakes ${name}: the Realm panel says "Map saved: hex-dominion-dynasty-1-....png" beside the button (a polite status, not a toast over the dialog)`);
      ok(await q(() => [...document.querySelectorAll('.toasts > .toast')].filter((n) => !n.classList.contains('is-out')).length === 0), `keepsakes ${name}: no toast over the open Realm panel`);
      ok(await q(() => { const b = document.querySelector('.realm .keepsake-save'); return !b.disabled && b.getAttribute('aria-busy') === 'false'; }), `keepsakes ${name}: the button is ready again`);
      // Found a Dynasty (the whole continent is ours): the confirmation carries the same button, the new chapter opens with its line
      await closeRealm();
      await q(() => window.__hd.conquerRegions(9999));
      await sleep(500);
      ok(await q(() => window.__hd.state.owner.every((o) => o === 0)), `keepsakes ${name}: the whole continent is ours (dev)`);
      ok(await openRealm(), `keepsakes ${name}: the Realm panel opens (continent won)`);
      await sleep(1300); // the 1 s refresh enables the button
      ok(await q(() => { const body = document.querySelector('.realm .realm-body'); const b = document.querySelector('.dynasty-found-btn'); const r = b.getBoundingClientRect(); return body.firstElementChild.classList.contains('dynasty-panel') && r.top >= 0 && r.bottom <= innerHeight; }),
        `keepsakes ${name}: with the continent won the Dynasty section comes first and Found a Dynasty is on screen without scrolling`);
      ok(await t.clickSel('.dynasty-found-btn'), `keepsakes ${name}: Found a Dynasty clicked`);
      // the founding ceremony (Phase 5) carries the Save button on its first page, as the old confirmation did
      ok(await t.waitFor(() => !!document.querySelector('.ceremony:not([hidden]) .keepsake-save'), 4000), `keepsakes ${name}: the founding ceremony has a Save the map button`);
      ok(await t.clickSel('.ceremony .keepsake-save'), `keepsakes ${name}: Save the map clicked inside the ceremony`);
      ok(await t.waitFor(() => { const s = document.querySelector('.ceremony .keepsake-save-status'); return !!s && !s.hidden && /map saved/i.test(s.textContent); }, 30000), `keepsakes ${name}: the picture of the OLD continent is saved (said inside the ceremony)`);
      ok(await q(() => !document.querySelector('.ceremony').hidden), `keepsakes ${name}: saving did not close the ceremony`);
      ok(await q(async () => {
        const step = () => new Promise((r) => setTimeout(r, 250));
        for (let i = 0; i < 2; i++) { document.querySelector('.ceremony-next').click(); await step(); }
        document.querySelector('.ceremony .edict-card')?.click();
        for (let i = 0; i < 2; i++) { document.querySelector('.ceremony-next').click(); await step(); }
        return document.querySelector('.ceremony').dataset.page === 'found';
      }), `keepsakes ${name}: through the ceremony to its last page`);
      ok(await t.clickSel('.ceremony-found'), `keepsakes ${name}: Found the House clicked`);
      ok(await t.waitFor(() => window.__hd.state.dynasty.level === 2, 8000), `keepsakes ${name}: Dynasty II begins`);
      const after = await q(() => window.__hd.state.chronicle.entries.map((e) => e.kind));
      ok(after.includes('dynasty'), `keepsakes ${name}: the new chapter holds the dynasty line (${after.join(', ')})`);
      const life = await q(() => window.__hd.state.chronicle.lifetime.map((e) => e.kind));
      ok(life.includes('firstConquest'), `keepsakes ${name}: the lifetime highlights kept the first conquest (${life.join(', ')})`);
      ok(t.unexpected().length === 0, `keepsakes ${name}: no console errors${t.unexpected().length ? `: ${t.unexpected()[0]}` : ''}`);
    } catch (err) {
      ok(false, `keepsakes ${name}: unexpected error: ${err && err.message}`);
    } finally {
      allErrors.push(...t.unexpected().map((e) => `[keepsakes ${name}] ${e}`));
      await t.page.close();
    }
  }
}
