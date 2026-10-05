// Real-browser checks for Phase 9 (docs/PLAN-PHASE9.md): the Daily Challenge and the Scenarios, run by tools/check.mjs (`--only=challenges`).
// Real presses for what a player presses (Settings > Challenges, Play, Continue, Copy, Back, the tracker's Leave, the banner style); dev hooks only to set
// the stage (a realm with a conquest), to start and win battles fast, and to read state. Screenshots go to screenshots/phase9/ unless PHASE9_SHOTS=0.
//   Desktop (1440x900, mouse), "today" pinned to a capital Daily (?today=):
//   1. the hub opens from Settings > Challenges as a dialog; the Daily card names today's Daily and its goal
//   2. Play: the challenge runs on its own state (the container is in the sandbox), the tracker is on the HUD, the realm's save is not written
//   3. the Daily plays to completion through battles won with the dev hook (real presses on Continue); the result screen shows time, crowns, attempts, streak
//   4. the share line is shareText(shareData(result, record)) and has the plan's form; Copy puts it on the clipboard
//   5. today's reward: the realm gets exactly +1 Renown (saved at once) and nothing else changes in its save but the save bookkeeping
//   6. Back restores the realm: the parked state is unchanged but for that Renown
//   7. a scenario (The Gatekeeper) plays to completion; its stars are saved in the record (memory and storage); the realm is byte-identical before and after
//   8. the banner style: a locked style shows its rule and cannot be chosen; an unlocked one is chosen in Settings and flies on the map (render state + saved)
//   Phone (390x844, touch): from the TITLE, the hub fits the screen, a past day plays as practice, the tracker's Leave (confirmed) returns to the title, the
//   realm's save untouched; the abandoned run counts as an attempt.
//   No console errors anywhere.
import { mkdir } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';
import { dailySpec } from '../game/meta/daily.js';
import { DAILY } from '../game/config/challenges.js';

const OUT = 'screenshots/phase9';
const SAVE_KEY = 'hexdominion.v2';
const RECORD_KEY = 'hexdominion.v2.record';

/** The first Daily from the epoch whose goal is `kind` (a capital Daily is short: a few battles). */
export function dailyWith(kind) {
  for (let d = DAILY.epoch; d < DAILY.epoch + 60; d++) {
    const m = d % 100;
    if (m < 1 || m > 28) continue; // simple: stay inside every month
    if (dailySpec(d).goal.kind === kind) return d;
  }
  return null;
}

/** Leaf paths where two JSON values differ. */
export function diffPaths(a, b, path = '', out = []) {
  if (a === b) return out;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) { out.push(path || '(root)'); return out; }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) diffPaths(a[k], b[k], path ? `${path}.${k}` : k, out);
  return out;
}

function helpers(t, sleep, name) {
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const shoot = process.env.PHASE9_SHOTS !== '0';
  const shot = async (n) => { if (shoot) { await t.page.screenshot(`${OUT}/${name}-${n}.png`); console.log(`  shot ${OUT}/${name}-${n}.png`); } };
  const shown = (sel) => q((s) => { const e = document.querySelector(s); return !!e && !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0; }, sel);
  /** Wins battles until the result screen is up: the next region (the goal's target first), a dev win, a REAL press on Continue. */
  async function playOut(max = 16) {
    let battles = 0;
    for (let i = 0; i < max; i++) {
      if (await shown('.chr')) return battles;
      const id = await q(() => window.__hd.challengeNext());
      if (id == null) { await sleep(700); continue; }
      await q((r) => window.__hd.startBattle(r), id);
      if (!(await t.waitFor(() => window.__hd.scene === 'battle', 8000))) { await sleep(500); continue; }
      await sleep(700);
      await q(() => window.__hd.winBattle());
      if (!(await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden && c.getClientRects().length > 0; }, 20000))) continue;
      await sleep(400);
      await t.clickSel('.results-action', 'Continue');
      battles += 1;
      await t.waitFor(() => window.__hd.scene === 'world' || (() => { const r = document.querySelector('.chr'); return !!r && !r.hidden; })(), 15000);
      await sleep(900);
    }
    return battles;
  }
  return { q, shot, shown, playOut };
}

async function desktop(open, BASE, ok, sleep, allErrors) {
  const today = dailyWith('capital');
  const t = await open(`${BASE}/index.html?dev=1&seed=7&today=${today}`, { width: 1440, height: 900 });
  const { q, shot, shown, playOut } = helpers(t, sleep, 'desktop');
  const tag = (s) => `challenges desktop: ${s}`;
  const main = () => q((k) => localStorage.getItem(k), SAVE_KEY);
  try {
    ok(today != null, tag(`a capital Daily to play (${today})`));
    await t.page.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
    ok(await t.atTitle(), tag('boots'));
    ok(await t.clickText('button', 'New Realm'), tag('New Realm'));
    ok(await t.waitFor(() => window.__hd.scene === 'world', 40000), tag('the world is up'));
    await q(() => { const hd = window.__hd; hd.state.settings.hints = false; hd.conquerRegions(2); hd.services.autosave.save(); });
    ok(await t.waitFor(() => !!window.__hd.challenge.kit, 15000), tag('the challenge kit loads after the boot'));
    ok(await q(() => window.__hd.challenge.unlocked()), tag('the Challenges are open after the first conquest'));

    // 1. Settings > Challenges
    ok(await t.clickSel('.hud .btn-icon[aria-label="Settings"]'), tag('a press on the gear'));
    ok(await t.waitFor(() => { const b = document.querySelector('.settings-challenges'); return !!b && !b.hidden && b.getClientRects().length > 0; }, 4000), tag('Settings shows Challenges'));
    ok(await t.clickSel('.settings-challenges'), tag('a press on Settings > Challenges'));
    ok(await t.waitFor(() => { const h = document.querySelector('.ch-hub'); return !!h && !h.hidden && h.getClientRects().length > 0; }, 8000), tag('the hub opens'));
    await sleep(300);
    const hub = await q(() => { const h = document.querySelector('.ch-hub'); return { role: h.getAttribute('role'), modal: h.getAttribute('aria-modal'), name: h.querySelector('.ch-daily-name').textContent, goal: h.querySelector('.ch-goal').textContent, focusIn: h.contains(document.activeElement), scen: h.querySelectorAll('.ch-scen').length, days: h.querySelectorAll('.ch-day').length }; });
    const spec = dailySpec(today);
    ok(hub.role === 'dialog' && hub.modal === 'true' && hub.focusIn, tag(`a modal dialog with focus inside (${hub.role}, ${hub.modal})`));
    ok(hub.name === spec.name, tag(`the Daily card names ${spec.name} ("${hub.name}")`));
    ok(/capital/i.test(hub.goal), tag(`its goal reads "${hub.goal}"`));
    ok(hub.scen === 6 && hub.days >= 4, tag(`6 scenarios and ${hub.days} calendar days listed`));
    await shot('01-hub-daily');
    for (const tab of ['scenarios', 'calendar', 'banners']) { await t.clickSel(`.ch-tab[data-tab="${tab}"]`); await sleep(250); await shot(`01-hub-${tab}`); }
    await t.clickSel('.ch-tab[data-tab="daily"]');
    await sleep(200);

    // 2. Play
    ok(await t.clickSel('.ch-play'), tag('a press on Play'));
    ok(await t.waitFor(() => window.__hd.challenge.active && window.__hd.scene === 'world' && !!window.__hd.state.challenge, 10000), tag('the Daily runs on its own state'));
    const before = await main(); // the realm was saved as it was parked
    const renownBefore = await q(() => (window.__hd.services.container.main().state.renown || {}).points || 0);
    ok(before === (await q(() => window.__hd.challenge.dev.parkSig)), tag("the realm's save is exactly the parked realm"));
    await sleep(1200);
    const inside = await q(() => ({ id: window.__hd.state.challenge.id, regions: window.__hd.world.regions.length, tracker: (() => { const g = document.querySelector('.gt'); return !!g && !g.hidden && g.getClientRects().length > 0 ? g.textContent : null; })() }));
    ok(inside.id === `daily:${today}` && inside.regions <= 13, tag(`a small continent (${inside.regions} regions), challenge ${inside.id}`));
    ok(!!inside.tracker && inside.tracker.includes(spec.name), tag(`the tracker is on the HUD ("${inside.tracker}")`));
    await shot('02-playing');

    // 3. play it out
    const n = await playOut(16);
    ok(await shown('.chr'), tag(`the result screen after ${n} battles won`));
    await sleep(500);
    const res = await q(() => ({ title: document.querySelector('.chr-title').textContent, stats: [...document.querySelectorAll('.chr-stats dt')].map((d) => [d.textContent, d.nextElementSibling.textContent]), share: (document.querySelector('.chr-share-text') || {}).textContent || null }));
    const stats = Object.fromEntries(res.stats);
    ok(/done/i.test(res.title), tag(`"${res.title}"`));
    ok(/^\d+:\d\d$/.test(stats.Time || '') && stats.Attempts === '1' && /\d/.test(stats.Crowns || '') && /1 day/.test(stats['Daily streak'] || ''), tag(`time, crowns, attempts, streak shown (${JSON.stringify(stats)})`));
    await shot('03-result');

    // 4. the share line
    const expect = await q(async () => {
      const kit = window.__hd.challenge.kit;
      const o = window.__hd.challenge.dev.lastOutcome;
      return kit.shareText(kit.shareData(o.result, window.__hd.challenge.record));
    });
    ok(res.share === expect, tag(`the share line is shareText(shareData(...)) ("${res.share}")`));
    ok(/^Hex Dominion Daily #\d+ · \d+:\d\d · (👑{1,3}|—) · 1st try [🗡️🛡️✖️]+$/u.test(res.share || ''), tag('it has the plan\'s form: "Hex Dominion Daily #N · mm:ss · 👑 · 1st try 🗡️..."'));
    ok((res.share || '').split(' · ')[1] === stats.Time, tag(`the share line's time is the result's time (${stats.Time})`)); // Phase 10B: 1:37 vs 1:38
    ok(await t.clickSel('.chr-copy'), tag('a press on Copy'));
    ok(await t.waitFor(() => /copied|select/i.test(document.querySelector('.chr-copy-msg').textContent), 3000), tag('Copy answers'));
    const clip = await q(async () => { try { return await navigator.clipboard.readText(); } catch { return null; } });
    ok(clip === null || clip === res.share, tag(`the clipboard holds the share line${clip === null ? ' (not readable headless: the message was checked)' : ''}`));

    // 5. the reward
    const after = await main();
    const renownAfter = await q(() => (window.__hd.services.container.main().state.renown || {}).points || 0);
    ok(renownAfter === renownBefore + 1, tag(`the realm got +1 Renown (${renownBefore} -> ${renownAfter})`));
    const d5 = diffPaths(JSON.parse(before), JSON.parse(after)).filter((p) => !/^(lastSeen|saveSeq)$/.test(p));
    ok(d5.length > 0 && d5.every((p) => p.startsWith('renown')), tag(`the realm's save changed only in its Renown (${d5.join(', ')})`));

    // 6. Back
    ok(await t.clickSel('.chr-back'), tag('a press on Back'));
    ok(await t.waitFor(() => !window.__hd.challenge.active && window.__hd.scene === 'world', 8000), tag('back on the realm\'s map'));
    const sigs = await q(() => ({ a: window.__hd.challenge.dev.parkSig, b: window.__hd.challenge.dev.unparkSig }));
    const d6 = diffPaths(JSON.parse(sigs.a), JSON.parse(sigs.b)).filter((p) => !/^(lastSeen|saveSeq)$/.test(p));
    ok(d6.every((p) => p.startsWith('renown')), tag(`the parked realm came back unchanged but for the Renown (${d6.join(', ') || 'nothing'})`));
    ok(await q(() => window.__hd.world.regions.length > 20 && !window.__hd.state.challenge), tag('the realm\'s own continent is back'));

    await scenarioAndBanner(t, { q, shot, shown, playOut, ok: (c, s) => ok(c, tag(s)), sleep, main });
  } catch (e) {
    ok(false, tag(`unexpected error: ${e && e.stack}`));
  } finally {
    const errs = t.unexpected();
    ok(errs.length === 0, tag(`no console errors${errs.length ? `: ${errs[0]}` : ''}`));
    allErrors.push(...errs.map((e) => `[challenges desktop] ${e}`));
    await t.page.close();
  }
}

async function scenarioAndBanner(t, { q, shot, shown, playOut, ok, sleep, main }) {
  // 7. a scenario: The Gatekeeper (always open)
  await sleep(1500);
  await q(() => window.__hd.challenge.openHub('scenarios'));
  ok(await t.waitFor(() => { const h = document.querySelector('.ch-hub'); return !!h && !h.hidden; }, 5000), 'the hub opens at the Scenarios');
  const locked = await q(() => [...document.querySelectorAll('.ch-scen.is-locked .ch-scen-blurb')].map((e) => e.textContent));
  ok(locked.length >= 1 && locked.every((s) => /opens once/i.test(s)), `locked scenarios say why (${locked.length}: "${locked[0]}")`);
  ok(await t.clickSel('.ch-scen-play[data-scenario="gatekeeper"]'), 'a press on Play The Gatekeeper');
  ok(await t.waitFor(() => window.__hd.challenge.active && window.__hd.scene === 'world' && window.__hd.state.challenge && window.__hd.state.challenge.id === 'gatekeeper', 10000), 'The Gatekeeper runs');
  const before = await main(); // saved as it was parked
  ok(before === (await q(() => window.__hd.challenge.dev.parkSig)), "the realm's save is exactly the parked realm");
  await sleep(1500);
  ok((await main()) === before, "the realm's save is not written while the scenario runs");
  const n = await playOut(8);
  ok(await shown('.chr'), `its result screen after ${n} battles won`);
  await sleep(400);
  const r = await q(() => ({ stars: document.querySelectorAll('.chr-star.is-on').length, marks: document.querySelectorAll('.chr-marks li').length, rec: window.__hd.challenge.record.scenarios.gatekeeper,
    stored: JSON.parse(localStorage.getItem('hexdominion.v2.record')).scenarios.gatekeeper, share: !!document.querySelector('.chr-share-text') }));
  ok(r.stars >= 1 && r.marks === 3 && !r.share, `stars on the result (${r.stars} of ${r.marks}), no share line for a scenario`);
  ok(r.rec && r.rec.stars === r.stars && r.stored && r.stored.stars === r.stars && r.stored.attempts === 1, `the stars are saved (memory ${r.rec && r.rec.stars}, storage ${r.stored && r.stored.stars})`);
  await shot('04-scenario-result');
  ok((await main()) === before, "the realm's save is still untouched");
  ok(await t.clickSel('.chr-back'), 'Back');
  ok(await t.waitFor(() => !window.__hd.challenge.active && window.__hd.scene === 'world', 8000), 'back on the realm');
  const sigs = await q(() => ({ a: window.__hd.challenge.dev.parkSig, b: window.__hd.challenge.dev.unparkSig }));
  ok(!!sigs.a && sigs.a === sigs.b, `the realm is byte-identical before and after (${sigs.a ? sigs.a.length : 0} bytes)`);
  ok(await q((k) => !localStorage.getItem(k), 'hexdominion.v2.challenge'), 'a finished challenge leaves no save to resume');

  // 8. banner styles
  await q(() => { const rec = window.__hd.challenge.record; if (!rec.banners.unlocked.includes('gilded')) rec.banners.unlocked.push('gilded'); });
  ok(await t.clickSel('.hud .btn-icon[aria-label="Settings"]'), 'the gear');
  ok(await t.waitFor(() => { const s = document.querySelector('.settings-banner-section'); return !!s && !s.hidden; }, 4000), 'Settings shows the banner styles');
  const lockedRule = await q(() => { const b = document.querySelector('.settings .settings-banner[data-banner="frost"]'); return { dis: b.getAttribute('aria-disabled'), rule: b.querySelector('.settings-banner-rule').textContent }; });
  ok(lockedRule.dis === 'true' && /30-day/.test(lockedRule.rule), `a locked style shows its rule ("${lockedRule.rule}")`);
  await t.clickSel('.settings .settings-banner[data-banner="frost"]');
  await sleep(200);
  ok(await q(() => window.__hd.challenge.record.banners.selected !== 'frost'), 'a press on a locked style chooses nothing');
  ok(await t.clickSel('.settings .settings-banner[data-banner="gilded"]'), 'a press on Gilded');
  await sleep(300);
  const st = await q(async () => {
    const S = await import(new URL('game/render/sprites.js', document.baseURI).href);
    return { style: S.getBannerStyle(), checked: document.querySelector('.settings .settings-banner[data-banner="gilded"]').getAttribute('aria-checked'), stored: JSON.parse(localStorage.getItem('hexdominion.v2.record')).banners.selected };
  });
  ok(st.style === 'gilded' && st.checked === 'true' && st.stored === 'gilded', `the Gilded banner is chosen, drawn and saved (${JSON.stringify(st)})`);
  await shot('05-settings-banners');
  await q(() => { document.querySelector('.settings .settings-close').click(); });
  await sleep(300);
  // the home keep's flag, close up: a gold hem on the player's banners
  await q(() => { const hd = window.__hd; const home = hd.state.owner.findIndex((o) => o === 0); hd.flyToRegion(home, 160, 10); });
  await sleep(1200);
  await shot('06-gilded-flags');
}

async function phone(open, BASE, ok, sleep, allErrors) {
  const t = await open(`${BASE}/index.html?dev=1&seed=7`, { width: 390, height: 844, mobile: true });
  const { q, shot, shown } = helpers(t, sleep, 'phone');
  const tag = (s) => `challenges phone: ${s}`;
  try {
    ok(await t.atTitle(), tag('boots'));
    ok(await t.clickText('button', 'New Realm'), tag('New Realm'));
    ok(await t.waitFor(() => window.__hd.scene === 'world', 40000), tag('the world is up'));
    await q(() => { const hd = window.__hd; hd.state.settings.hints = false; hd.conquerRegions(1); hd.services.autosave.save(); });
    await t.page.goto(`${BASE}/index.html?dev=1&seed=7`);
    ok(await t.atTitle(), tag('reloaded to the title'));
    ok(await t.waitFor(() => { const b = document.querySelector('.title-challenges'); return !!b && !b.hidden && b.getClientRects().length > 0; }, 15000), tag('the title offers Challenges'));
    const before = await q((k) => localStorage.getItem(k), SAVE_KEY);
    ok(await t.clickSel('.title-challenges'), tag('a touch on Challenges'));
    ok(await t.waitFor(() => { const h = document.querySelector('.ch-hub'); return !!h && !h.hidden && h.getClientRects().length > 0; }, 8000), tag('the hub opens over the title'));
    await sleep(300);
    const fits = () => q(() => { const r = document.querySelector('.ch-hub').getBoundingClientRect(); const over = [...document.querySelectorAll('.ch-hub *')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 0.5).length; return { l: r.left, r: r.right, w: innerWidth, over, doc: document.documentElement.scrollWidth }; });
    let f = await fits();
    ok(f.l >= 0 && f.r <= f.w && f.over === 0 && f.doc <= f.w, tag(`the Daily fits 390 px (${Math.round(f.l)}..${Math.round(f.r)}, ${f.over} overflowing)`));
    await shot('01-hub-daily');
    ok(await t.clickSel('.ch-tab[data-tab="calendar"]'), tag('the Calendar tab'));
    await sleep(250);
    f = await fits();
    ok(f.over === 0, tag(`the calendar fits (${f.over} overflowing)`));
    await shot('02-calendar');
    const past = await q(() => { const b = [...document.querySelectorAll('.ch-day:not(.is-today) .ch-day-btn')][0]; return b ? Number(b.dataset.date) : null; });
    ok(past != null, tag(`a past day to practise (${past})`));
    ok(await t.clickSel(`.ch-day-btn[data-date="${past}"]`), tag('a touch on it'));
    ok(await t.waitFor(() => window.__hd.challenge.active && window.__hd.scene === 'world' && !!window.__hd.state.challenge, 10000), tag('the practice Daily runs'));
    ok(await q(() => window.__hd.state.challenge.practice === true), tag('it is practice'));
    ok(await t.waitFor(() => window.__hd.state.challenge.activeSec >= 2, 8000), tag('the active-play clock runs'));
    await sleep(300);
    ok(await shown('.gt'), tag('the tracker is on the phone HUD'));
    await shot('03-playing');
    ok(await t.clickSel('.gt-leave'), tag("a touch on the tracker's Leave"));
    ok(await t.waitFor(() => !!document.querySelector('.modal-panel'), 3000), tag('it asks first'));
    await shot('04-leave-confirm');
    ok(await t.clickSel('.modal-actions button', 'Leave'), tag('Leave'));
    ok(await t.waitFor(() => !window.__hd.challenge.active && window.__hd.scene === 'title', 8000), tag('back on the title, where it was opened'));
    const after = await q((k) => localStorage.getItem(k), SAVE_KEY);
    ok(after === before, tag("the realm's save is byte-identical"));
    const att = await q((d) => (window.__hd.challenge.record.daily[d] || {}).attempts || 0, past);
    ok(att === 1, tag(`the abandoned practice run counted as an attempt (${att})`));
    ok(await q(() => window.__hd.challenge.dev.parkSig === window.__hd.challenge.dev.unparkSig), tag('the parked realm came back unchanged'));
  } catch (e) {
    ok(false, tag(`unexpected error: ${e && e.stack}`));
  } finally {
    const errs = t.unexpected();
    ok(errs.length === 0, tag(`no console errors${errs.length ? `: ${errs[0]}` : ''}`));
    allErrors.push(...errs.map((e) => `[challenges phone] ${e}`));
    await t.page.close();
  }
}

export async function challengeChecks({ launch, BASE, ok, sleep, allErrors }) {
  console.log("\n== challenges: the hub, a Daily to completion, the share line, a scenario's stars, the realm untouched, banner styles, the phone ==");
  await mkdir(OUT, { recursive: true });
  const open = makeOpen(launch, sleep);
  await desktop(open, BASE, ok, sleep, allErrors);
  await phone(open, BASE, ok, sleep, allErrors);
}
