// Play your way, the phone part (tools/optionsChecks.mjs): text sizes on a 360x740 phone. Normal and Large must FIT (nothing past the screen's
// edges, nothing clipped); Larger may scroll inside a panel but nothing clips or runs off the screen. Screens: the map with the HUD and a region
// card, Settings, the War Council, a toast, and the battle HUD. The size is chosen by a real press in Settings.

/** In the page: visible elements under the roots that leave the screen sideways, and text boxes that clip their own content. */
const audit = (roots) => {
  const vis = (e) => e.getClientRects().length > 0 && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden';
  const W = innerWidth;
  const off = []; const clipped = [];
  for (const sel of roots) {
    for (const root of document.querySelectorAll(sel)) {
      if (!vis(root)) continue;
      for (const e of [root, ...root.querySelectorAll('*')]) {
        if (!vis(e) || e.closest('svg') || e.tagName === 'CANVAS') continue;
        const r = e.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1 || e.closest('.visually-hidden, .sr-only')) continue; // screen-reader-only text is clipped on purpose
        // skip what is scrolled out of a scrolling ancestor (inside a panel's own scroller it is reachable)
        let sc = e.parentElement; let hiddenByScroll = false;
        while (sc && sc !== root.parentElement) { const s = getComputedStyle(sc); if (/(auto|scroll)/.test(s.overflowX + s.overflowY)) { const pr = sc.getBoundingClientRect(); if (r.bottom < pr.top || r.top > pr.bottom) hiddenByScroll = true; break; } sc = sc.parentElement; }
        if (hiddenByScroll) continue;
        if (r.right > W + 0.5 || r.left < -0.5) off.push(`${e.className || e.tagName} ${Math.round(r.left)}..${Math.round(r.right)}`);
        const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!hasText) continue;
        const s = getComputedStyle(e);
        const clipX = /(hidden|clip)/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1 && s.textOverflow !== 'ellipsis';
        const clipY = /(hidden|clip)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 2 && !/-webkit-box/.test(s.display);
        if (clipX || clipY) clipped.push(`${e.className || e.tagName} "${e.textContent.trim().slice(0, 24)}" ${e.scrollWidth}x${e.scrollHeight} in ${e.clientWidth}x${e.clientHeight}`);
      }
    }
  }
  return { off: [...new Set(off)].slice(0, 6), clipped: [...new Set(clipped)].slice(0, 6), docW: document.documentElement.scrollWidth, W };
};

export async function fitChecks({ open, BASE, ok, sleep, allErrors, helpers }) {
  const t = await open(`${BASE}/index.html?dev=1&seed=7`, { width: 360, height: 740, mobile: true });
  const tag = (s) => `options phone 360: ${s}`;
  const { q, shot, openSettings, closeSettings } = helpers(t, sleep, 'phone');
  const report = (label, a, strict) => {
    ok(a.off.length === 0 && a.docW <= a.W, tag(`${label}: nothing runs off the screen${a.off.length ? `: ${a.off.join(' | ')}` : ''} (page ${a.docW} of ${a.W})`));
    if (strict || a.clipped.length) ok(a.clipped.length === 0, tag(`${label}: no text is clipped${a.clipped.length ? `: ${a.clipped.join(' | ')}` : ''}`));
  };
  try {
    ok(await t.atTitle(), tag('boots'));
    ok(await t.clickText('button', 'New Realm'), tag('New Realm'));
    ok(await t.waitFor(() => window.__hd.scene === 'world', 40000), tag('the world is up'));
    await q(() => { const hd = window.__hd; hd.hideDev(true); hd.state.settings.hints = false; hd.conquerRegions(3); hd.grantGold?.(5000); });
    await sleep(900);
    for (const size of ['normal', 'large', 'larger']) {
      ok(await openSettings(), tag(`${size}: Settings opens`));
      ok(await t.clickSel(`.opt-sizes .opt-radio[data-value="${size}"]`), tag(`${size}: a press on the text size`));
      await sleep(350);
      const fs = await q(() => ({ o: window.__hd.options().textSize, px: parseFloat(getComputedStyle(document.documentElement).fontSize) }));
      ok(fs.o === size, tag(`${size}: chosen (root ${fs.px}px)`));
      report(`${size} Settings`, await q(audit, ['.settings']), true);
      await q(() => document.querySelector('.opt-display').scrollIntoView({ block: 'start' }));
      await sleep(200);
      await shot(`${size}-settings`);
      await closeSettings();
      // the HUD and a frontier card
      const id = await q(async () => { const P = await import(new URL('game/meta/progression.js', document.baseURI).href); return P.attackableFrontier(window.__hd.state, window.__hd.world)[0]; });
      await q((r) => window.__hd.selectRegion(r), id);
      await sleep(1100);
      report(`${size} HUD + region card`, await q(audit, ['.hud', '.region-card-dock', '.region-card']), size !== 'larger');
      await q(() => window.__hd.services.ui.toasts.update({ id: 'opt-fit', type: 'info', icon: 'star', message: 'Bought Steel, level 3: your squads hit harder', duration: 6000 }));
      await sleep(500);
      report(`${size} toast`, await q(audit, ['.toasts']), size !== 'larger');
      await shot(`${size}-map-card`);
      await q(() => window.__hd.selectRegion(null));
      await sleep(300);
      await q(() => window.__hd.openCouncil());
      await sleep(700);
      report(`${size} War Council`, await q(audit, ['.council']), size !== 'larger');
      await shot(`${size}-council`);
      await t.clickSel('.council .btn-icon[aria-label="Close"], .council-close');
      await sleep(400);
      // the battle HUD
      await q((r) => window.__hd.startBattle(r), id);
      ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000), tag(`${size}: a battle is live`));
      await sleep(600);
      report(`${size} battle HUD`, await q(audit, ['.battle-hud']), size !== 'larger');
      const names = await q(() => [...document.querySelectorAll('.power-name')].filter((e) => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim()));
      ok(names.length === 0, tag(`${size}: every power name is whole (no ellipsis)${names.length ? `: ${names.join(', ')}` : ''}`));
      await shot(`${size}-battle`);
      await q(() => window.__hd.loseBattle?.());
      await sleep(400);
      await q(() => { const hd = window.__hd; if (hd.scene === 'battle') { const b = document.querySelector('.results-card button'); if (b) b.click(); } });
      await t.waitFor(() => { const hd = window.__hd; const b = [...document.querySelectorAll('.results-card button')].find((x) => /map/i.test(x.textContent)); if (b) b.click(); return hd.scene === 'world'; }, 15000);
      await sleep(800);
    }
    await q(() => window.__hd.setOption('textSize', 'normal'));
    const errs = t.unexpected();
    ok(errs.length === 0, tag(`no console errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`));
    allErrors.push(...errs);
  } finally {
    await t.page.close();
  }
}
