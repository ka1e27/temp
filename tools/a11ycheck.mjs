// Accessibility check (DESIGN §7.5a), with REAL input and the browser's own accessibility tree (CDP `Accessibility.getFullAXTree`: what a screen reader is given).
//
//   npm start                                   # in another terminal
//   node tools/a11ycheck.mjs [--only=desktop|phone|motion|keyboard] [--url=http://localhost:8080] [--shots=screenshots/a11y-after]
//
// desktop / phone:
//   * no unnamed buttons, switches, tabs, sliders or text boxes in the title, Settings, the world, the council and the battle (the AX tree, not the DOM)
//   * Settings, the council and a confirmation are real dialogs: focus moves in, everything behind is inert, Tab is trapped, Escape closes, focus is restored
//     (also on the title screen, where the map's input is off)
//   * battle controls say what they are and their state ("Rally, level 1, ready", "Send 50%" pressed, Pause becomes Resume); Space on a focused button toggles
//     once, a dialog pauses the battle and closing it resumes; letter shortcuts stand down in a dialog
//   * the Treasury says "gold" and "per second", the council has real tabs and "Buy ... level N, N gold" buttons
//   * (phone) no interactive element has a touch target under 44 px
// motion: emulated `prefers-reduced-motion: reduce`: Reduce Motion is on from the first boot, the camera cuts, no animation loops forever
// keyboard: the whole core loop without a pointer: New Realm, the Regions list, a region card, Attack, a keyboard send, a win
//
// Evidence: AX-tree snippets are printed; screenshots go to --shots (default screenshots/a11y-after).
import { mkdir } from 'node:fs/promises';

if (!process.env.CHROME_PATH && process.platform === 'win32') process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('./cdp.js');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
const BASE = flags.url || 'http://localhost:8080';
const SHOTS = flags.shots || 'screenshots/a11y-after';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(SHOTS, { recursive: true });

let failed = 0;
const ok = (cond, msg) => { if (!cond) failed += 1; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`); return !!cond; };

const INTERACTIVE = new Set(['button', 'switch', 'checkbox', 'radio', 'tab', 'slider', 'spinbutton', 'textbox', 'combobox', 'link', 'menuitem', 'searchbox']);

async function session({ name, width, height, touch, reduced }, fn) {
  console.log(`\n== ${name}: ${width}x${height}${touch ? ' touch' : ' mouse'}${reduced ? ' prefers-reduced-motion' : ''} ==`);
  const page = await launch({ url: 'about:blank', width, height });
  const errors = [];
  page.on((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
    else if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push(p.args.map((a) => a.value ?? a.description).join(' '));
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch });
  if (touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  if (reduced) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.send('Accessibility.enable').catch(() => {});
  const ev = (f, ...a) => page.eval(f, ...a);
  const api = {
    page, ev, touch, width, height,
    async boot(query = '') {
      await page.goto(`${BASE}/index.html?dev=1&seed=7${query}`);
      for (let i = 0; i < 150; i++) { if (await ev(() => !!window.__hd && window.__hd.scene === 'title').catch(() => false)) break; await sleep(100); }
      await ev(() => window.__hd.hideDev(true));
      await sleep(1200);
    },
    async ax() {
      const { nodes } = await page.send('Accessibility.getFullAXTree');
      return nodes.filter((n) => !n.ignored).map((n) => ({
        role: n.role && n.role.value, name: (n.name && n.name.value) || '', value: n.value && n.value.value,
        props: Object.fromEntries((n.properties || []).map((p) => [p.name, p.value && p.value.value])),
      }));
    },
    /** Interactive nodes with no accessible name, from the accessibility tree. */
    async unnamed() {
      return (await api.ax()).filter((n) => INTERACTIVE.has(n.role) && !n.name.trim());
    },
    async find(role, nameRe) {
      return (await api.ax()).filter((n) => n.role === role && nameRe.test(n.name));
    },
    async key(k, code, vk, modifiers = 0) {
      // Enter and Space carry their character: that is what makes a focused button ACTIVATE (a keypress), exactly as a real keyboard does
      const text = k === 'Enter' ? '\r' : k === ' ' ? ' ' : undefined;
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(text ? { text } : {}) });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
      await sleep(120);
    },
    tab: (back) => api.key('Tab', 'Tab', 9, back ? 8 : 0),
    enter: () => api.key('Enter', 'Enter', 13),
    space: () => api.key(' ', 'Space', 32),
    escape: () => api.key('Escape', 'Escape', 27),
    async shot(n) { await page.screenshot(`${SHOTS}/${n}.png`); },
    active: () => ev(() => { const a = document.activeElement; return a ? { tag: a.tagName, cls: a.className && a.className.toString().slice(0, 60), label: a.getAttribute('aria-label') || (a.textContent || '').trim().slice(0, 40), id: a.id } : null; }),
    async focusSelector(sel) { return ev((s) => { const e = document.querySelector(s); if (!e) return false; e.focus(); return document.activeElement === e; }, sel); },
    async waitFor(fn, ms = 6000, ...a) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(fn, ...a).catch(() => false)) return true; await sleep(100); } return false; },
    async tap(x, y) {
      if (touch) { await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await sleep(70); await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); } else { await page.mouse('mouseMoved', x, y, 'none', 0); await page.mouse('mousePressed', x, y, 'left', 1); await sleep(50); await page.mouse('mouseReleased', x, y, 'left', 0); }
    },
  };
  try { await fn(api); } catch (e) { ok(false, `unexpected error: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); }
  ok(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await page.close();
}

const snippet = (nodes) => nodes.map((n) => `${n.role}${n.props.checked != null ? `[checked=${n.props.checked}]` : ''}${n.props.pressed != null ? `[pressed=${n.props.pressed}]` : ''}${n.props.selected != null ? `[selected=${n.props.selected}]` : ''} "${n.name}"`).join(' | ');

// ---- the shared pass (desktop and phone) ----------------------------------------------------------------------------------------------------
async function surfaces(a, tag) {
  const { ev } = a;
  // ---- title -------------------------------------------------------------------------------------------------------------------------------------
  ok((await a.unnamed()).length === 0, `title: no unnamed controls (${JSON.stringify((await a.unnamed()).slice(0, 3))})`);
  ok(await ev(() => document.querySelector('h1')?.textContent.includes('DOMINION')), 'title: a level-1 heading names the page');
  await a.shot(`${tag}-title`);
  // Settings through the KEYBOARD: focus its button, press Enter
  const opener = await ev(() => { const b = [...document.querySelectorAll('.title-actions button')].find((x) => /settings/i.test(x.textContent)); b.focus(); return document.activeElement === b; });
  ok(opener, 'title: the Settings button takes keyboard focus');
  await a.enter();
  ok(await a.waitFor(() => !document.querySelector('.settings').hidden), 'Settings opens from the keyboard (on the title screen, where map input is off)');
  const dlg = await a.find('dialog', /^Settings$/);
  ok(dlg.length === 1, `Settings is a dialog named "Settings" in the accessibility tree (${snippet(dlg)})`);
  ok(await ev(() => document.querySelector('.settings').contains(document.activeElement)), 'focus moved INTO the dialog');
  ok(await ev(() => document.getElementById('world').hasAttribute('inert') && document.querySelector('.title-screen').closest('[inert]') != null), 'the canvas and the title behind it are inert');
  const sw = await a.find('switch', /./);
  ok(sw.length >= 5 && sw.every((n) => n.name.trim()), `every switch has a name (${snippet(sw)})`);
  ok((await a.unnamed()).length === 0, `settings: no unnamed controls (${JSON.stringify((await a.unnamed()).slice(0, 3))})`);
  await a.shot(`${tag}-settings-focus`);
  // Tab is trapped
  let trapped = true;
  for (let i = 0; i < 24; i++) { await a.tab(i % 5 === 4); if (!(await ev(() => document.querySelector('.settings').contains(document.activeElement)))) { trapped = false; break; } }
  ok(trapped, 'Tab and Shift+Tab never leave the dialog (24 presses)');
  await a.escape();
  ok(await a.waitFor(() => document.querySelector('.settings').hidden), 'Escape closes Settings, also on the title screen');
  ok(await ev(() => !document.getElementById('world').hasAttribute('inert') && !document.querySelector('.title-screen').closest('[inert]')), 'nothing stays inert afterwards');
  ok(await ev(() => /settings/i.test(document.activeElement?.textContent || '')), `focus is restored to the Settings button (${JSON.stringify(await a.active())})`);

  // ---- world -------------------------------------------------------------------------------------------------------------------------------------
  await ev(() => [...document.querySelectorAll('.title-actions button')].find((x) => /new realm/i.test(x.textContent)).click());
  ok(await a.waitFor(() => window.__hd.scene === 'world', 15000), 'New Realm starts');
  await sleep(2500);
  await ev(() => { window.__hd.state.settings.hints = false; });
  ok((await a.unnamed()).length === 0, `world: no unnamed controls (${JSON.stringify((await a.unnamed()).slice(0, 4))})`);
  const treasury = await a.find('group', /^Treasury$/);
  const ax = await a.ax();
  ok(treasury.length === 1 && ax.some((n) => /\bgold\b/.test(n.name)) && ax.some((n) => /per second/.test(n.name)), 'the Treasury is a group that says "gold" and "per second"');
  ok((await a.find('button', /^Realm stats$/)).length === 1, 'the HUD Realm button is named "Realm stats"');
  // Council through the keyboard
  ok(await ev(() => { const b = document.querySelector('.hud-btn[aria-label="War Council"]'); b.focus(); return document.activeElement === b; }), 'the War Council button takes focus');
  await a.enter();
  ok(await a.waitFor(() => !document.querySelector('.council').hidden), 'the council opens from the keyboard');
  const cd = await a.find('dialog', /^War Council$/);
  ok(cd.length === 1, `the council is a dialog (${snippet(cd)})`);
  const tabs = await a.find('tab', /./);
  ok(tabs.length === 3 && tabs.filter((t) => t.props.selected === true).length === 1, `three council tabs, one selected (${snippet(tabs)})`);
  ok((await a.find('tablist', /./)).length === 1 && (await a.find('tabpanel', /./)).length === 1, 'a tablist and a tabpanel');
  const buys = await a.find('button', /^(Buy|Unlock) .*gold|maximum level/);
  ok(buys.length >= 3 && buys.every((b) => /gold|maximum/.test(b.name)), `the buy buttons read like "Buy Recruitment level 1, 33 gold" (${buys.slice(0, 2).map((b) => b.name).join(' / ')})`);
  ok((await a.unnamed()).length === 0, `council: no unnamed controls (${JSON.stringify((await a.unnamed()).slice(0, 3))})`);
  await a.shot(`${tag}-council`);
  await a.escape();
  ok(await a.waitFor(() => document.querySelector('.council').hidden), 'Escape closes the council');
  ok(await ev(() => document.activeElement?.getAttribute('aria-label') === 'War Council'), 'focus returns to the War Council button');

  // ---- battle ------------------------------------------------------------------------------------------------------------------------------------
  const rid = await ev(async () => { const { tutorialRegionId } = await import(new URL('game/meta/intel.js', document.baseURI).href); return tutorialRegionId(window.__hd.state, window.__hd.world); });
  await ev((id) => window.__hd.startBattle(id), rid);
  ok(await a.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 25000), 'a battle goes live');
  await sleep(1200);
  const un = await a.unnamed();
  ok(un.length === 0, `battle: no unnamed controls (${JSON.stringify(un.slice(0, 4))})`);
  const rally = await a.find('button', /^Rally, level \d+, (ready|recharging|locked)/);
  ok(rally.length === 1, `the Rally power says what it is and its state (${rally.map((n) => n.name).join('')})`);
  const locked = await a.find('button', /, locked$/);
  ok(locked.length >= 3, `locked powers say "locked" (${locked.length})`);
  const fr = await a.find('button', /^Send \d+%$/);
  ok(fr.length === 4 && fr.filter((n) => n.props.pressed === 'true' || n.props.pressed === true).length === 1, `four "Send N%" buttons, exactly one pressed (${snippet(fr)})`);
  ok((await a.find('button', /^Retreat$/)).length === 1, 'Retreat is named even when its word is hidden');
  ok((await a.find('button', /^Battle speed/)).length === 1, 'the speed button is named');
  ok((await a.find('button', /^Pause$/)).length === 1, 'Pause is named "Pause"');
  await a.shot(`${tag}-battle`);
  // Space on a focused button toggles ONCE
  ok(await a.focusSelector('.battle-pause'), 'the Pause button takes focus');
  await a.space();
  await sleep(300);
  ok((await a.find('button', /^Resume$/)).length === 1, 'pressing Space on Pause pauses once: the button now says "Resume"');
  const tp = await ev(() => window.__hd.battle.t);
  await sleep(900);
  ok(Math.abs((await ev(() => window.__hd.battle.t)) - tp) < 0.05, 'the battle clock is stopped');
  ok(await ev(() => !document.querySelector('.battle-paused-tag').hidden), 'a visible "Paused" label shows');
  await a.space();
  await sleep(300);
  ok((await a.find('button', /^Pause$/)).length === 1 && (await ev(() => window.__hd.battle.t)) > tp, 'Space again resumes');
  // a dialog pauses the battle and closing it resumes; letter shortcuts stand down
  await ev(() => window.__hd.openSettings());
  await sleep(500);
  const tb = await ev(() => window.__hd.battle.t);
  await sleep(900);
  ok(Math.abs((await ev(() => window.__hd.battle.t)) - tb) < 0.05, 'the battle is paused while Settings is open');
  await a.key('q', 'KeyQ', 81);
  ok(await ev(() => !document.querySelector('.power-btn.is-armed')), 'the Q shortcut does nothing while a dialog is open');
  await a.shot(`${tag}-battle-dialog`);
  await a.escape();
  ok(await a.waitFor(() => document.querySelector('.settings').hidden), 'Escape closes Settings in a battle');
  await sleep(700);
  ok((await ev(() => window.__hd.battle.t)) > tb + 0.3, 'and the battle resumes');
  // the confirmation dialog: the safe button is focused, Escape dismisses
  await ev(() => document.querySelector('.battle-retreat').click());
  ok(await a.waitFor(() => !!document.querySelector('.modal-backdrop')), 'Retreat asks for confirmation');
  const rd = await a.find('dialog', /^Retreat\?$/);
  ok(rd.length === 1, `the confirmation is a dialog named by its title (${snippet(rd)})`);
  ok(await ev(() => /keep fighting/i.test(document.activeElement?.textContent || '')), 'focus starts on the SAFE choice ("Keep fighting")');
  await a.escape();
  ok(await a.waitFor(() => !document.querySelector('.modal-backdrop')), 'Escape dismisses the confirmation');
  await ev(() => window.__hd.winBattle());
  ok(await a.waitFor(() => { const c = document.querySelector('.results-card'); return c && !c.hidden; }, 20000), 'the results card appears');
  await sleep(600);
  ok(await ev(() => /continue/i.test(document.activeElement?.textContent || '')), 'results: focus is on Continue');
  const rdlg = await a.find('dialog', /victory/i);
  ok(rdlg.length === 1, `results is a dialog named VICTORY (${snippet(rdlg)})`);
  ok(await a.waitFor(() => /^Victory\./.test(document.querySelector('.results-card [role=status]')?.textContent || ''), 3000), 'a polite status says "Victory. ... gold"');
  await a.shot(`${tag}-results`);
}

async function targets(a) {
  return a.ev(() => {
    const out = [];
    const probe = (b) => {
      const r = b.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hits = (x, y) => { if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return true; const e = document.elementFromPoint(x, y); return !!e && (e === b || b.contains(e)); };
      const reach = (dx, dy) => { let n = 0; while (n < 40 && hits(cx + dx * (n + 1), cy + dy * (n + 1))) n += 1; return n; };
      return { w: reach(-1, 0) + reach(1, 0) + 1, h: reach(0, -1) + reach(0, 1) + 1 };
    };
    for (const b of document.querySelectorAll('button, [role=switch], [role=tab], a[href], input[type=range], select')) {
      if (b.getClientRects().length === 0 || b.closest('[hidden]') || b.closest('[inert]') || getComputedStyle(b).visibility === 'hidden') continue;
      b.scrollIntoView({ block: 'center' }); // a panel that scrolls (Settings, on a phone) is measured with the control in view
      const r = b.getBoundingClientRect();
      if (Math.min(r.width, r.height) >= 43.5) continue;
      const hit = probe(b);
      if (Math.min(hit.w, hit.h) < 43.5) out.push(`${b.tagName.toLowerCase()}.${(b.className || '').toString().split(' ').slice(0, 2).join('.')} "${(b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 22)}" ${Math.round(r.width)}x${Math.round(r.height)} (hit ${hit.w}x${hit.h})`);
    }
    return out;
  });
}

const which = flags.only || 'all';
if (which === 'all' || which === 'desktop') {
  await session({ name: 'desktop', width: 1440, height: 900, touch: false }, async (a) => { await a.boot(); await surfaces(a, 'desktop'); });
}
if (which === 'all' || which === 'phone') {
  await session({ name: 'phone', width: 390, height: 844, touch: true }, async (a) => {
    await a.boot();
    await surfaces(a, 'phone');
    // touch targets, measured in the places a thumb goes: the world, the council, settings
    const found = [];
    await a.ev(() => window.__hd.goto.world({ cameFromBattle: true }));
    await sleep(2500);
    await a.ev(() => { window.__hd.state.settings.hints = false; });
    found.push(...await targets(a));
    // a frontier card (Attack, Scout) and an owned card (Works) in the bottom sheet
    await a.ev(async () => { const { tutorialRegionId } = await import(new URL('game/meta/intel.js', document.baseURI).href); window.__hd.selectRegion(tutorialRegionId(window.__hd.state, window.__hd.world)); });
    await sleep(900); found.push(...await targets(a));
    await a.ev(() => window.__hd.selectRegion(window.__hd.world.startRegion));
    await sleep(900); found.push(...await targets(a));
    await a.ev(() => window.__hd.selectRegion(null));
    await sleep(300);
    await a.ev(() => window.__hd.openCouncil()); await sleep(700); found.push(...await targets(a)); await a.ev(() => document.querySelector('.council-close').click()); await sleep(400);
    await a.ev(() => window.__hd.openSettings()); await sleep(700); found.push(...await targets(a)); await a.ev(() => document.querySelector('.settings-close').click()); await sleep(400);
    ok(found.length === 0, `phone: every interactive element has a touch target of at least 44 px${found.length ? `: ${[...new Set(found)].slice(0, 8).join(' | ')}` : ''}`);
  });
}

// ---- Reduce Motion: starts from the OS, stills everything, cuts the camera --------------------------------------------------------------------
async function infiniteAnimations(a) {
  return a.ev(() => document.getAnimations().filter((x) => x.playState === 'running' && x.effect && x.effect.getComputedTiming().iterations === Infinity).map((x) => (x.animationName || x.transitionProperty || 'anim')));
}
if (which === 'all' || which === 'motion') {
  await session({ name: 'motion', width: 1440, height: 900, touch: false, reduced: true }, async (a) => {
    const { ev } = a;
    await a.boot();
    ok(await ev(() => window.__hd.state.settings.reduceMotion === true && window.__hd.state.settings.reduceMotionSet === false), 'on the first boot Reduce Motion is ON because the OS asks for it (and it is not a choice the player made yet)');
    ok(await ev(() => document.documentElement.classList.contains('reduce-motion')), 'the page carries .reduce-motion');
    const x0 = await ev(() => window.__hd.camera.x);
    await sleep(900);
    ok(Math.abs((await ev(() => window.__hd.camera.x)) - x0) < 1e-9, 'the title does not drift (the camera stands still)');
    ok((await infiniteAnimations(a)).length === 0, `the title has no infinite animation (${(await infiniteAnimations(a)).join(',')})`);
    await ev(() => [...document.querySelectorAll('.title-actions button')].find((x) => /new realm/i.test(x.textContent)).click());
    ok(await a.waitFor(() => window.__hd.scene === 'world', 15000), 'New Realm starts');
    await sleep(1500);
    ok(await ev(() => { const hd = window.__hd; return hd.camera.instant === true; }), 'the camera is set to cut');
    const target = await ev(() => { const hd = window.__hd; const id = hd.world.regions.find((r) => r.id !== hd.world.startRegion).id; hd.flyToRegion(id, 20, 2500); return id; });
    await sleep(160);
    ok(await ev(() => !window.__hd.camera.isMoving()), `a 2.5 s camera flight is a cut: already there after 160 ms (region ${target})`);
    await ev(() => { window.__hd.state.settings.hints = false; });
    await ev(() => window.__hd.openCouncil());
    await ev(() => window.__hd.grantGold(9999));
    await sleep(800);
    ok((await infiniteAnimations(a)).length === 0, `the council (affordable buy glow) has no infinite animation (${(await infiniteAnimations(a)).join(',')})`);
    await ev(() => document.querySelector('.council-close').click());
    const rid = await ev(async () => { const { tutorialRegionId } = await import(new URL('game/meta/intel.js', document.baseURI).href); return tutorialRegionId(window.__hd.state, window.__hd.world); });
    await ev((id) => window.__hd.startBattle(id), rid);
    ok(await a.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 25000), 'a battle goes live');
    await sleep(1500);
    ok((await infiniteAnimations(a)).length === 0, `the battle (ready power glow, coach ring) has no infinite animation (${(await infiniteAnimations(a)).join(',')})`);
    await a.shot('motion-battle');
    await ev(() => window.__hd.goto.world({ cameFromBattle: true }));
    await sleep(1500);
    // the player's own choice wins over the OS from now on
    await ev(() => window.__hd.openSettings());
    await sleep(500);
    const sw = await ev(() => ({ scene: window.__hd.scene, hidden: document.querySelector('.settings').hidden, checked: [...document.querySelectorAll('.settings-row')].find((r) => /reduce motion/i.test(r.textContent))?.querySelector('.settings-toggle')?.getAttribute('aria-checked'), rm: window.__hd.state.settings.reduceMotion }));
    ok(sw.checked === 'true', `the Settings switch shows Reduce motion ON (${JSON.stringify(sw)})`);
    await ev(() => [...document.querySelectorAll('.settings-row')].find((r) => /reduce motion/i.test(r.textContent)).querySelector('.settings-toggle').click());
    await sleep(300);
    ok(await ev(() => window.__hd.state.settings.reduceMotion === false && window.__hd.state.settings.reduceMotionSet === true && !document.documentElement.classList.contains('reduce-motion')), 'switching it off counts as the player-made own choice');
    await a.page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(500);
    ok(await ev(() => window.__hd.state.settings.reduceMotion === false), 'and the OS preference no longer overrides it');
  });
  // the same game WITHOUT the OS preference: the loops exist (so the check above proves the rule, not an absence)
  await session({ name: 'motion-control', width: 1440, height: 900, touch: false }, async (a) => {
    const { ev } = a;
    await a.boot();
    ok(await ev(() => window.__hd.state.settings.reduceMotion === false), 'without the OS preference Reduce Motion is off');
    await ev(() => [...document.querySelectorAll('.title-actions button')].find((x) => /new realm/i.test(x.textContent)).click());
    await a.waitFor(() => window.__hd.scene === 'world', 15000);
    await sleep(1500);
    await ev(() => { window.__hd.state.settings.hints = false; window.__hd.grantGold(9999); window.__hd.openCouncil(); });
    await sleep(800);
    ok((await infiniteAnimations(a)).length > 0, `control: the council DOES animate when motion is allowed (${(await infiniteAnimations(a)).join(',')})`);
  });
}

// ---- keyboard only: New Realm, the map cursor, the Regions list, a region's card, Attack, a keyboard send, a win, back on the map -------------------------------------------------
async function keyboardFlow(a, tag) {
  const { ev } = a;
  const said = () => ev(async () => (await import(new URL('game/ui/live.js', document.baseURI).href)).lastAnnouncement());
  const arrow = (name) => a.key(name, name, { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 }[name]);
  await a.boot();
  await ev(() => { window.__hd.state.settings.hints = false; });
  // title: Tab to New Realm, Enter
  for (let i = 0; i < 6; i++) { const f = await a.active(); if (/new realm/i.test((f && f.label) || '')) break; await a.tab(); }
  ok(/new realm/i.test(((await a.active()) || {}).label || ''), `${tag}: Tab reaches New Realm on the title`);
  await a.enter();
  ok(await a.waitFor(() => window.__hd.scene === 'world', 20000), `${tag}: Enter on New Realm starts the realm`);
  await sleep(1800);
  ok(await ev(() => document.activeElement && document.activeElement.id === 'world'), `${tag}: focus lands on the map (no Tab hunt)`);
  const mapNode = (await a.ax()).find((n) => n.role === 'group' && /world map/i.test(n.name));
  ok(!!mapNode, `${tag}: the map is a named group in the accessibility tree (${mapNode ? snippet([mapNode]).slice(0, 70) : 'missing'})`);
  // the cursor: ] picks the first region to attack and says what it is
  await a.key(']', 'BracketRight', 221);
  const s1 = await said();
  ok(/can be attacked|surrender|cannot be attacked/i.test(s1) && /your chance to win|surrender|conquer a neighbour/i.test(s1), `${tag}: ] moves the cursor to a region and says it ("${s1.slice(0, 100)}")`);
  const c1 = await ev(() => window.__hd.mapCursor());
  await a.shot(`keyboard-${tag}-map-cursor`);
  await arrow('ArrowRight'); await arrow('ArrowLeft'); await arrow('ArrowDown'); await arrow('ArrowUp');
  const s2 = await said();
  ok(typeof s2 === 'string' && s2.length > 5, `${tag}: arrow keys move the cursor and speak ("${s2.slice(0, 80)}")`);
  ok((await ev(() => window.__hd.mapCursor())) >= 0 && c1 >= 0, `${tag}: the cursor rests on a region`);
  // the Regions list: Tab to its button, Enter, read the rows, choose the first (a region to attack)
  for (let i = 0; i < 10; i++) { const f = await a.active(); if (/regions list/i.test((f && f.label) || '')) break; await a.tab(); }
  ok(/regions list/i.test(((await a.active()) || {}).label || ''), `${tag}: Tab reaches the Regions button`);
  await a.enter();
  ok(await a.waitFor(() => { const r = document.querySelector('.regions'); return !!r && !r.hidden; }, 4000), `${tag}: Enter opens the Regions list`);
  await sleep(400);
  const dlg = (await a.ax()).filter((n) => n.role === 'dialog');
  ok(dlg.some((n) => /regions/i.test(n.name)), `${tag}: it is a dialog named Regions`);
  const rows = (await a.ax()).filter((n) => n.role === 'button' && /: .*tier|: yours/i.test(n.name));
  ok(rows.length >= 3, `${tag}: every region is a button named by a sentence (${rows.length}); e.g. "${(rows[0] || {}).name || ''}"`);
  ok((await a.unnamed()).length === 0, `${tag}: no unnamed controls in the Regions list`);
  ok(await ev(() => document.activeElement && document.activeElement.classList.contains('region-row')), `${tag}: focus is on the first row`);
  await a.shot(`keyboard-${tag}-regions-list`);
  const rowName = ((await a.active()) || {}).label;
  await a.enter();
  ok(await a.waitFor(() => !document.querySelector('.regions') || document.querySelector('.regions').hidden, 3000), `${tag}: choosing a row closes the list`);
  ok(await a.waitFor(() => { const d = document.querySelector('.hd-dock'); return !!d && !d.hidden && !!document.querySelector('.region-card-action:not([hidden])'); }, 4000), `${tag}: and opens that region's card ("${(rowName || '').slice(0, 40)}")`);
  const f2 = await a.active();
  ok(/attack/i.test((f2 && f2.label) || ''), `${tag}: focus is on the Attack button (${f2 && f2.label})`);
  await a.shot(`keyboard-${tag}-card`);
  // Escape returns to the map; Enter on the map cursor re-opens the card; Enter on Attack starts the battle
  await a.escape();
  ok(await ev(() => document.activeElement && document.activeElement.id === 'world'), `${tag}: Escape closes the card and returns focus to the map`);
  await a.key('Enter', 'Enter', 13);
  ok(await a.waitFor(() => !!document.querySelector('.region-card-action:not([hidden])'), 3000), `${tag}: Enter on the map cursor re-opens the card`);
  await a.enter();
  ok(await a.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000), `${tag}: Enter on Attack starts the battle`);
  await sleep(800);
  ok(await ev(() => document.activeElement && document.activeElement.id === 'world'), `${tag}: focus lands on the battle map`);
  // a keyboard send: move the cursor to a settlement the War Camp can send to, press Enter
  const plan = await ev(async () => {
    const hd = window.__hd;
    const sim = await import(new URL('game/battle/sim.js', document.baseURI).href);
    const info = hd.siteInfo();
    const camp = info.find((x) => x.type === 'camp' && x.owner === 0);
    const dests = info.filter((x) => x.owner !== 0 && sim.canRoute(hd.battle, 0, camp.id, x.id)).sort((p, q) => Math.hypot(p.x - camp.x, p.y - camp.y) - Math.hypot(q.x - camp.x, q.y - camp.y));
    return dests.length ? { target: dests[0].id } : null;
  });
  ok(!!plan, `${tag}: a settlement the War Camp can send to exists`);
  if (plan) {
    let guard = 0;
    while (guard++ < 14) {
      const at = await ev(() => window.__hd.siteCursor());
      if (at === plan.target) break;
      const v = await ev((t, from) => { const info = window.__hd.siteInfo(); const c = info.find((x) => x.id === (from < 0 ? info.find((y) => y.type === 'camp').id : from)); const d = info.find((x) => x.id === t); return { dx: d.x - c.x, dy: d.y - c.y }; }, plan.target, at);
      const names = Math.abs(v.dx) > Math.abs(v.dy) ? [v.dx > 0 ? 'ArrowRight' : 'ArrowLeft', v.dy > 0 ? 'ArrowDown' : 'ArrowUp'] : [v.dy > 0 ? 'ArrowDown' : 'ArrowUp', v.dx > 0 ? 'ArrowRight' : 'ArrowLeft'];
      await arrow(names[0]);
      if ((await ev(() => window.__hd.siteCursor())) === at) await arrow(names[1]);
    }
    const here = await ev(() => window.__hd.siteCursor());
    const said2 = await said();
    ok(here === plan.target, `${tag}: the arrow keys bring the cursor to the settlement (cursor ${here}, wanted ${plan.target})`);
    ok(/Enter sends from the War Camp/i.test(said2), `${tag}: the live region says what Enter would do ("${said2.slice(0, 110)}")`);
    await a.shot(`keyboard-${tag}-battle-cursor`);
    const sent0 = await ev(() => window.__hd.battle.stats.sent);
    await a.enter();
    ok(await a.waitFor((n) => window.__hd.battle.stats.sent > n, 6000, sent0), `${tag}: Enter sends the troops (a keyboard send)`);
  }
  // win via the dev hook, then Continue by keyboard: back on the map, the region is ours
  const targetRegion = await ev(() => window.__hd.battle.arena.regionId);
  await ev(() => window.__hd.winBattle());
  ok(await a.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden && c.dataset.result === 'victory'; }, 20000), `${tag}: the victory card shows`);
  await sleep(1200);
  ok(await ev(() => document.activeElement && /results-action/.test(document.activeElement.className)), `${tag}: focus is on Continue`);
  await a.enter();
  ok(await a.waitFor(() => window.__hd.scene === 'world', 15000), `${tag}: Enter on Continue returns to the map`);
  ok(await ev((id) => window.__hd.state.owner[id] === 0, targetRegion), `${tag}: the region is ours (a whole conquest with no pointer)`);
  await sleep(800);
  ok(await ev(() => document.activeElement && document.activeElement.id === 'world'), `${tag}: focus is back on the map`);
}
if (which === 'all' || which === 'keyboard') {
  await session({ name: 'keyboard', width: 1440, height: 900, touch: false }, async (a) => { await keyboardFlow(a, 'keyboard'); });
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL ACCESSIBILITY CHECKS PASSED');
process.exit(failed ? 1 : 0);
