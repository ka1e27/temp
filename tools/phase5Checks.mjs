// Real-browser checks for Phase 5, Dynasties that change the rules (docs/PLAN-PHASE5.md; docs/briefs/phase5-hookup.md): run by tools/check.mjs
// (`--only=phase5`), desktop and phone, seed 7. Real pointer / touch presses wherever a press matters; dev hooks only to set the stage (own every
// region, Legacy points, a strong army) and to read state.
//   1. __hd.completeRealm(), then a real press on Realm > Found a Dynasty opens the ceremony ("The House of ... endures", Legacy earned)
//   2. the Legacy page: a real press buys Old Roads on the preview (points drop, the node is owned)
//   3. the Edict page: the D1 hint is drawn over the cards; Next is refused until an Edict is picked; a press picks one (the hint goes)
//   4. the Challenges page: a press ticks Iron Will, the "harder" warning lights; the recap names both; "Found the House of ..." founds
//   5. the new dynasty: level 2, the Edict and Iron Will in state, Old Roads owned (bought in the ceremony), the world made for the Edict
//   6. the Realm panel (real press): the Edict's name, one laurel, the Legacy tree
//   7. Quick Conquest: the node owned, an Easy region's card shows the button (the D2 hint points at it); a real press -> the overlay with
//      its bar -> the region is ours with the Victory crown only, and the toast says so
//   8. no console errors
import { makeOpen } from './robustChecks.mjs';

async function scenario(open, BASE, ok, sleep, allErrors, { width, height, mobile, name }) {
  const t = await open(`${BASE}/index.html?dev=1&seed=7`, { width, height, mobile });
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const tag = (s) => `phase5 ${name}: ${s}`;
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
  // the element is found, scrolled into view, measured again once settled, then pressed for real
  const pressSel = async (sel, txt) => { const c = await centre(sel, txt); if (!c) return false; await sleep(160); const c2 = await centre(sel, txt); if (!c2) return false; await press(c2.x, c2.y); await sleep(250); return true; };
  const text = (sel) => q((s) => { const e = document.querySelector(s); return e ? e.textContent : null; }, sel);

  try {
    ok(await t.atTitle(), tag('boots'));
    ok(await t.clickText('button', 'New Realm'), tag('New Realm'));
    ok(await t.waitFor(() => window.__hd.scene === 'world', 40000), tag('the world is up'));
    // hints ON: every step but the Phase 5 ones counts as seen
    await q(async () => {
      const hd = window.__hd;
      hd.hideDev(true);
      const { TUTORIAL_STEPS } = await import(new URL('game/scenes/timing.js', document.baseURI).href);
      hd.state.tutorial.seen = Object.fromEntries(TUTORIAL_STEPS.filter((s) => !/^D\d/.test(s.id)).map((s) => [s.id, true]));
      hd.state.settings.hints = true;
      hd.state.stats.battlesWon = 3;
    });
    await sleep(1200);

    // 1. the realm is complete: Realm > Found a Dynasty opens the ceremony
    ok(await q(() => window.__hd.completeRealm()), tag('__hd.completeRealm()'));
    await sleep(500);
    ok(await pressSel('.hud-btn.hud-realm, .hud-btn[aria-label^="Realm"]'), tag('a press opens the Realm panel'));
    ok(await t.waitFor(() => { const b = document.querySelector('.dynasty-found-btn'); return !!b && !b.disabled && b.getClientRects().length; }, 4000), tag('Found a Dynasty is enabled'));
    ok(await pressSel('.dynasty-found-btn'), tag('a press on Found a Dynasty'));
    ok(await t.waitFor(() => { const c = document.querySelector('.ceremony'); return !!c && !c.hidden; }, 4000), tag('the ceremony opens'));
    ok(/^The House of .+ endures$/.test(await text('.ceremony-title') || ''), tag(`page 1 title: "${await text('.ceremony-title')}"`));
    const earned = Number(((await text('.ceremony-earn-item.is-legacy .nums')) || '').replace(/\D/g, ''));
    ok(earned > 0, tag(`Legacy earned is shown (+${earned})`));
    ok(await q(() => { const r = document.querySelector('.ceremony-panel').getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1; }), tag('the ceremony fits the screen'));

    // 2. the Legacy page: buy Old Roads by a real press
    ok(await pressSel('.ceremony-next'), tag('Next -> the Legacy page'));
    ok((await q(() => document.querySelector('.ceremony').dataset.page)) === 'legacy', tag('on the Legacy page'));
    if (mobile) await pressSel('.ceremony .legacy-tab', 'Realm');
    ok(await pressSel('.ceremony .legacy-node[data-node="oldRoads"] .legacy-buy'), tag('a press on Buy (Old Roads)'));
    ok(await t.waitFor(() => document.querySelector('.ceremony .legacy-node[data-node="oldRoads"]')?.dataset.state === 'owned', 2000), tag('Old Roads is owned on the preview'));
    ok(/Bought Old Roads/.test(await text('.ceremony .legacy-status') || ''), tag('the tree says what was bought'));

    // 3. the Edict page: the D1 hint, Next refused until a pick
    ok(await pressSel('.ceremony-next'), tag('Next -> the Edict page'));
    const cards = await q(() => [...document.querySelectorAll('.ceremony .edict-card')].map((c) => c.dataset.edict));
    ok(cards.length >= 3, tag(`${cards.length} Edict cards`));
    ok(await q(() => { const e = document.querySelector('.ceremony-hint'); return !!e && !e.hidden && /Edict/.test(e.textContent); }), tag('the D1 hint is drawn over the Edicts'));
    await pressSel('.ceremony-next');
    ok((await q(() => document.querySelector('.ceremony').dataset.page)) === 'edict' && /Choose an Edict/.test(await text('.ceremony-next-hint') || ''), tag('Next is refused until an Edict is picked'));
    ok(await pressSel(`.ceremony .edict-card[data-edict="${cards[0]}"]`), tag(`a press picks ${cards[0]}`));
    ok(await q((id) => document.querySelector(`.edict-card[data-edict="${id}"]`).getAttribute('aria-checked') === 'true', cards[0]), tag('the card is checked'));
    ok(await q(() => document.querySelector('.ceremony-hint').hidden && window.__hd.state.tutorial.seen.D1 === true), tag('D1 is seen once an Edict is picked'));

    // 4. the Challenges: tick Iron Will, the warning lights, the recap, Found
    ok(await pressSel('.ceremony-next'), tag('Next -> the Challenges page'));
    ok(await pressSel('.challenge-toggle[data-challenge="ironWill"]'), tag('a press ticks Iron Will'));
    ok(await q(() => document.querySelector('.challenge-toggle[data-challenge="ironWill"] input').checked && document.querySelector('.challenge-warning').classList.contains('is-on')), tag('Iron Will is ticked and the "harder" warning lights'));
    ok(await pressSel('.ceremony-next'), tag('Next -> the last page'));
    const recap = await text('.ceremony-recap') || '';
    ok(/Edict: /.test(recap) && /Iron Will/.test(recap), tag(`the recap names the Edict and Iron Will ("${recap.slice(0, 90)}")`));
    ok(/^Found the House of /.test(await text('.ceremony-found') || ''), tag('"Found the House of ..."'));
    ok(await pressSel('.ceremony-found'), tag('a press founds the dynasty'));
    ok(await t.waitFor(() => window.__hd.state.dynasty.level === 2 && window.__hd.scene === 'world', 15000), tag('dynasty II begins'));
    await sleep(1800);

    // 5. the new dynasty's rules
    const st = await q(() => ({ edict: window.__hd.state.edict, nodes: window.__hd.state.generals.legacy.nodes, worldEdict: window.__hd.world.edict ?? null, hidden: document.querySelector('.ceremony').hidden }));
    ok(st.hidden, tag('the ceremony closed'));
    ok(st.edict.id === cards[0], tag(`the Edict is ${st.edict.id}`));
    ok(st.edict.challenges.includes('ironWill'), tag('Iron Will is sworn'));
    ok(st.nodes.oldRoads === true, tag('Old Roads (bought in the ceremony) is owned'));

    // 6. the Realm panel shows the Edict, the laurel and the Legacy
    ok(await pressSel('.hud-btn[aria-label^="Realm"]'), tag('a press opens the Realm panel'));
    await sleep(500);
    const realm = await q(() => { const r = document.querySelector('.realm'); return { name: r.querySelector('.realm-edict-name')?.textContent, laurels: r.querySelectorAll('.realm-laurel').length, legacy: !r.querySelector('.realm-legacy').hidden, owned: !!r.querySelector('.legacy-node[data-node="oldRoads"][data-state="owned"]') }; });
    const want = await q((id) => import(new URL('game/meta/edicts.js', document.baseURI).href).then((m) => m.edictInfo(id).name), cards[0]);
    ok(realm.name === want, tag(`the Realm panel's Edict: ${realm.name}`));
    ok(realm.laurels === 1, tag(`one Challenge laurel (${realm.laurels})`));
    ok(realm.legacy && realm.owned, tag('the Legacy tree, Old Roads owned'));
    await pressSel('.realm-close');

    // 7. Quick Conquest: the node, a strong army, an Easy region
    const easy = await q(async () => {
      const hd = window.__hd;
      hd.grantLegacy(30);
      for (const id of ['oldRoads', 'masons', 'royalTreasury', 'quickConquest']) hd.dynasty.buy(id, 'realm');
      const U = await import(new URL('game/meta/upgrades.js', document.baseURI).href);
      const Q = await import(new URL('game/meta/quick.js', document.baseURI).href);
      const PR = await import(new URL('game/meta/progression.js', document.baseURI).href);
      // an Easy region that does not offer a surrender (a surrender replaces Attack and Quick Conquest on the card)
      const fit = (r) => Q.canQuickConquer(hd.state, hd.world, r.id, {}).ok && !PR.difficulty(hd.state, hd.world, r.id).surrender;
      hd.grantGold(1e8);
      for (let i = 0; i < 24; i++) {
        const id = hd.world.regions.find(fit)?.id;
        if (id != null) return id;
        // stronger a level at a time (every upgrade at once makes the Easy regions surrender instead), and now and then one more region
        for (const u of Object.keys(U.UPGRADES)) U.buy(hd.state, u);
        if (i % 4 === 3) hd.conquerRegions(1);
      }
      return -1;
    });
    ok(easy >= 0, tag(`an Easy region for Quick Conquest (${easy})`));
    if (easy >= 0) {
      await q((id) => { window.__hd.flyToRegion(id, undefined, 1); window.__hd.selectRegion(id); }, easy);
      ok(await t.waitFor(() => { const b = document.querySelector('.region-card-quick'); return !!b && !b.hidden && b.getAttribute('aria-disabled') !== 'true'; }, 4000), tag('the card shows Quick Conquest beside Attack'));
      ok(await t.waitFor(() => { const c = document.querySelector('.coach'); return !!c && !c.hidden && /Quick Conquest/.test(c.textContent); }, 5000), tag('the D2 hint points at it'));
      ok(await pressSel('.region-card-quick'), tag('a real press on Quick Conquest'));
      ok(await t.waitFor(() => { const o = document.querySelector('.quick-overlay'); return !!o && !o.hidden && /marches on/.test(o.textContent); }, 1500), tag('the overlay: "... marches on ..."'));
      ok(await t.waitFor((id) => window.__hd.state.owner[id] === 0 && document.querySelector('.quick-overlay').hidden, 15000, easy), tag('the region is conquered and the overlay gone'));
      const crowns = await q((id) => window.__hd.state.crowns[id], easy);
      ok(!!crowns && crowns.victory && !crowns.swift && !crowns.unbroken, tag('the Victory crown only'));
      // on a phone a toast waits while a leader's banner speaks (a first contact as the mists part): on screen, or posted and waiting, both count
      ok(await t.waitFor((id) => /is yours: Victory crown/.test(document.querySelector('.toasts').textContent) || window.__hd.services.ui.toasts.has(`quick-${id}`), 8000, easy), tag('the toast says so'));
    }

    const errs = t.unexpected();
    ok(errs.length === 0, tag(`no console errors${errs.length ? `: ${errs[0]}` : ''}`));
    allErrors.push(...errs);
  } catch (e) {
    ok(false, tag(`scenario threw: ${e && e.message}`));
  }
  await t.page.close();
}

export async function phase5Checks({ launch, BASE, ok, sleep, allErrors }) {
  console.log('\n== phase5: the founding ceremony (Legacy, Edict, Challenge), the Realm panel, Quick Conquest, hints D1-D2 ==');
  const open = makeOpen(launch, sleep);
  const only = process.env.PHASE5_ONLY || '';
  if (!only || only === 'desktop') await scenario(open, BASE, ok, sleep, allErrors, { width: 1440, height: 900, mobile: false, name: 'desktop' });
  if (!only || only === 'phone') await scenario(open, BASE, ok, sleep, allErrors, { width: 390, height: 844, mobile: true, name: 'phone' });
}
