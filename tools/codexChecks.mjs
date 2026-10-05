// Real-browser checks for the Codex (PLAN-PHASE8 §8B), run by tools/check.mjs (`--only=codex`), desktop 1440x900 and a 360x740 phone, seed 7.
// Real presses for everything a player presses; dev hooks only to set the stage and read state. Screenshots go to screenshots/phase8/ unless PHASE8_SHOTS=0.
//   1. Settings > Codex (a real press) opens the Codex as a dialog: focus moves in, the first page shows, "N of M discovered"
//   2. a locked topic reads "Not yet discovered" and shows no numbers (no spoilers)
//   3. a page's numbers match config (Rally: its share and cooldown from game/config/battle.js, read in the page)
//   4. Escape closes it and focus returns to Settings; the War Council's "?" opens the Codex at the War Council page
//   5. the keyboard: ArrowDown moves through the list, Enter opens a page
//   6. the phone: it fits 360 px (no horizontal overflow, list and page take turns, Back returns to the list)
//   7. "Revisit the tutorial hints" resets the seen hints, turning it off restores them
//   8. no console errors
import { mkdir } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';

const OUT = 'screenshots/phase8';

async function scenario(open, BASE, ok, sleep, allErrors, { width, height, mobile, name }) {
  const t = await open(`${BASE}/index.html?dev=1&seed=7`, { width, height, mobile });
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const tag = (s) => `codex ${name}: ${s}`;
  const shoot = process.env.PHASE8_SHOTS !== '0';
  const shot = async (n) => { if (shoot) { await t.page.screenshot(`${OUT}/codex-${name}-${n}.png`); console.log(`  shot ${OUT}/codex-${name}-${n}.png`); } };
  const shown = (sel) => q((s) => { const e = document.querySelector(s); return !!e && !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0; }, sel);
  const key = async (k, code) => {
    await t.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code || k, ...(k === 'Enter' ? { text: '\r' } : {}), windowsVirtualKeyCode: { Escape: 27, Enter: 13, ArrowDown: 40, ArrowUp: 38 }[k] || 0 });
    await t.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code || k, windowsVirtualKeyCode: { Escape: 27, Enter: 13, ArrowDown: 40, ArrowUp: 38 }[k] || 0 });
    await sleep(200);
  };
  try {
    ok(await t.atTitle(), tag('boots'));
    ok(await t.clickText('button', 'New Realm'), tag('New Realm'));
    ok(await t.waitFor(() => window.__hd.scene === 'world', 40000), tag('the world is up'));
    await q(() => { const hd = window.__hd; hd.hideDev(true); hd.state.settings.hints = false; hd.conquerRegions(2); hd.state.stats.battlesWon = 2; });
    await sleep(900);

    // 1. Settings > Codex
    ok(await t.clickSel('.hud .btn-icon[aria-label="Settings"]'), tag('a press on the gear'));
    ok(await t.waitFor(() => { const s = document.querySelector('.settings'); return !!s && !s.hidden; }, 4000), tag('Settings opens'));
    ok(await t.clickSel('.settings-codex'), tag('a press on Settings > Codex'));
    ok(await t.waitFor(() => { const c = document.querySelector('.codex'); return !!c && !c.hidden && c.getClientRects().length > 0; }, 8000), tag('the Codex opens (loaded on first use)'));
    await sleep(400);
    const d1 = await q(() => {
      const c = document.querySelector('.codex');
      return { modal: c.getAttribute('aria-modal'), role: c.getAttribute('role'), focusIn: c.contains(document.activeElement), count: c.querySelector('.codex-count').textContent, topics: c.querySelectorAll('.codex-topic').length, label: c.getAttribute('aria-labelledby') };
    });
    ok(d1.role === 'dialog' && d1.modal === 'true' && !!d1.label, tag(`it is a named modal dialog (${d1.role}, ${d1.label})`));
    ok(d1.focusIn, tag('focus moved into it'));
    ok(d1.topics >= 30, tag(`${d1.topics} topics listed`));
    ok(/\d+ of \d+ discovered/.test(d1.count) || mobile, tag(`"${d1.count}"`));
    if (mobile) { ok(await shown('.codex-list') && !(await shown('.codex-page')), tag('the phone shows the list first')); await shot('01-list'); }
    else await shot('01-open');

    // 2. a locked topic: Ashen Host (Dynasty I has never met it)
    ok(await t.clickSel('.codex-topic[data-topic="ashen"]'), tag('a press on a locked topic'));
    await sleep(300);
    const locked = await q(() => ({ title: document.querySelector('.codex-page-title').textContent, nums: document.querySelector('.codex-numbers').hidden, label: document.querySelector('.codex-topic[data-topic="ashen"]').getAttribute('aria-label') }));
    ok(locked.title === 'Not yet discovered' && locked.nums, tag(`a locked topic says "${locked.title}" and shows no numbers`));
    ok(/not yet discovered/i.test(locked.label), tag(`its list entry says so to a screen reader ("${locked.label}")`));
    await shot('02-locked');
    if (mobile) { ok(await t.clickSel('.codex-back'), tag('Back')); await sleep(250); ok(await shown('.codex-list'), tag('Back returns to the list')); }

    // 3. Rally's numbers against config
    ok(await t.clickSel('.codex-topic[data-topic="rally"]'), tag('a press on Rally'));
    await sleep(300);
    const rally = await q(async () => {
      const { POWERS } = await import(new URL('game/config/battle.js', document.baseURI).href);
      const dl = [...document.querySelectorAll('.codex-numbers dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]);
      return { dl, share: `${Math.round(POWERS.rally.share * 100)}%`, cd: `${Math.round(POWERS.rally.cooldown)} s`, title: document.querySelector('.codex-page-title').textContent };
    });
    const vals = rally.dl.map((x) => x[1]);
    ok(rally.title === 'Rally' && vals.includes(rally.share) && vals.includes(rally.cd), tag(`Rally's numbers match config (${JSON.stringify(rally.dl)} vs ${rally.share}, ${rally.cd})`));
    await shot('03-rally');

    // 6. phone fit (at every step above, checked here once more on a page)
    const fit = await q(() => {
      const c = document.querySelector('.codex').getBoundingClientRect();
      const over = [...document.querySelectorAll('.codex *')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 0.5).length;
      return { l: c.left, r: c.right, w: innerWidth, docW: document.documentElement.scrollWidth, over };
    });
    ok(fit.l >= 0 && fit.r <= fit.w && fit.docW <= fit.w && fit.over === 0, tag(`fits the screen (${Math.round(fit.l)}..${Math.round(fit.r)} of ${fit.w}, ${fit.over} overflowing)`));

    // 5. keyboard (desktop): the list takes the arrows, Enter opens a page
    if (!mobile) {
      await q(() => document.querySelector('.codex-topic[data-topic="sending"]').focus());
      await key('ArrowDown');
      const f = await q(() => document.activeElement && document.activeElement.dataset.topic);
      ok(f === 'rally', tag(`ArrowDown moves to the next topic (${f})`));
      await key('Enter');
      ok(await q(() => document.querySelector('.codex').dataset.topic === 'rally' && document.activeElement === document.querySelector('.codex-page-title')), tag('Enter opens the page and moves focus to its title'));
    }

    // 7. revisit hints
    const before = await q(() => Object.keys(window.__hd.state.tutorial.seen || {}).length);
    await q(() => { window.__hd.state.tutorial.seen = { ...(window.__hd.state.tutorial.seen || {}), W0: true, W1: true, M1: true }; });
    ok(await t.clickSel('.codex-revisit'), tag('a press on "Revisit the tutorial hints"'));
    await sleep(200);
    const on = await q(() => ({ n: Object.keys(window.__hd.state.tutorial.seen).length, hints: window.__hd.state.settings.hints, aria: document.querySelector('.codex-revisit').getAttribute('aria-checked') }));
    ok(on.n === 0 && on.hints === true && on.aria === 'true', tag(`the hints are reset and on (${JSON.stringify(on)})`));
    ok(await t.clickSel('.codex-revisit'), tag('a second press turns it off'));
    await sleep(200);
    const off = await q(() => ({ seen: window.__hd.state.tutorial.seen, aria: document.querySelector('.codex-revisit').getAttribute('aria-checked') }));
    ok(off.seen.W0 && off.seen.M1 && off.aria === 'false', tag('the seen hints are restored'));
    void before;

    // 4. Escape closes it, focus back in Settings; the Council's "?" opens it at the War Council
    await key('Escape');
    ok(await t.waitFor(() => document.querySelector('.codex').hidden, 2000), tag('Escape closes the Codex'));
    ok(await q(() => { const s = document.querySelector('.settings'); return !s.hidden && s.contains(document.activeElement); }), tag('focus is back in Settings, still open'));
    await key('Escape');
    await t.waitFor(() => document.querySelector('.settings').hidden, 2000);
    await q(() => window.__hd.openCouncil());
    await sleep(500);
    ok(await shown('.council .codex-help'), tag('the War Council has a "?" in its header'));
    ok(await t.clickSel('.council .codex-help'), tag('a press on it'));
    ok(await t.waitFor(() => { const c = document.querySelector('.codex'); return !c.hidden && c.dataset.topic === 'council'; }, 4000), tag('the Codex opens at the War Council page'));
    await sleep(300);
    await shot('04-from-council');
    for (const [sel, nm] of [['.realm', 'Realm'], ['.regions', 'Regions'], ['.generals', 'Generals']]) ok(await q((s) => !!document.querySelector(`${s} .codex-help`), sel), tag(`${nm} has a "?"`));
    await key('Escape');
  } catch (e) {
    ok(false, tag(`unexpected error: ${e && e.stack}`));
  } finally {
    const errs = t.unexpected();
    ok(errs.length === 0, tag(`no console errors${errs.length ? `: ${errs[0]}` : ''}`));
    allErrors.push(...errs.map((e) => `[codex ${name}] ${e}`));
    await t.page.close();
  }
}

export async function codexChecks({ launch, BASE, ok, sleep, allErrors }) {
  console.log('\n== codex: Settings > Codex, a panel "?", locked topics, config numbers, the keyboard, a 360 px phone, revisit hints ==');
  await mkdir(OUT, { recursive: true });
  const open = makeOpen(launch, sleep);
  await scenario(open, BASE, ok, sleep, allErrors, { width: 1440, height: 900, mobile: false, name: 'desktop' });
  await scenario(open, BASE, ok, sleep, allErrors, { width: 360, height: 740, mobile: true, name: 'phone' });
}
