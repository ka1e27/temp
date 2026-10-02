// Real-browser checks for the fresh-eyes playtest fixes, run by tools/check.mjs (plain mode). Real pointer and key events throughout.
//   1  the W2 hint ("Click a glowing region") keeps clear of the WHOLE region, outlines it brightly on the map, and the click meant for the region reaches it
//   2  the W3 "Attack!" hint covers no card information (it sits in room the card opens above the button), on a phone too
//   3  a phone on its side: the region card fits the screen, scrolls inside, and Attack sits in a footer that never covers a row
//   4  Space after clicking Speed pauses (it used to cycle the speed again)
//   6  pressing 1-4 in the middle of a drag redraws the preview at once
//   7  the Swift countdown beside the battle clock, dimmed once missed
//   8  Settings > Slow battles: the speed button cycles 1x 2x 3x, or 0.5x 1x 2x 3x
//   9  orders given while paused wait for the resume, with a word about it once
//  10  the welcome-back card says "(capped at N h)" beside the figure
//  12  the scout panel explains "weak point" in plain sight; the Works subtitle says what Works do
//  13  phones cannot zoom a region past the screen
//  14  the Copy button in Settings says "Copied"; the council hint names a good first buy
// The hint placement itself is measured after EVERY frame by tools/hintMonitor.js (the same code the full check uses).
import { makeOpen } from './robustChecks.mjs';

export async function playtestChecks({ launch, BASE, ok, sleep, allErrors, shotsDir }) {
  const open = makeOpen(launch, sleep);
  const URL0 = `${BASE}/index.html?dev=1`;
  const shot = async (t, name) => { if (shotsDir) await t.page.screenshot(`${shotsDir}/${name}.png`).catch(() => {}); };
  const keyPress = async (t, key, code, text) => {
    await t.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: text ?? (key.length === 1 ? key : undefined), windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : undefined });
    await t.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
  };

  // ---- 1, 2, 3: where the first hints sit, on three screens -------------------------------------------------------------------------------------------------
  const screens = [
    ['desktop', { width: 1440, height: 900 }, [7, 43]],
    ['phone', { width: 390, height: 844, mobile: true }, [7, 3]],
    ['landscape phone', { width: 844, height: 390, mobile: true }, [7]],
  ];
  for (const [name, dims, seeds] of screens) {
    for (const seed of seeds) {
      const tag = `${name} seed ${seed}`;
      console.log(`\n== playtest: the first hints on ${tag} ==`);
      const t = await open(`${URL0}&seed=${seed}`, dims);
      const q = (fn, ...a) => t.page.eval(fn, ...a);
      try {
        ok(await t.atTitle(), `${tag}: boots`);
        ok(await t.clickText('button', 'New Realm'), `${tag}: New Realm`);
        ok(await t.waitFor(() => window.__hd.scene === 'world', 30000), `${tag}: the realm starts`);
        await q(async () => { const m = await import(new URL('tools/hintMonitor.js', document.baseURI).href); m.installHintMonitor(); });
        // W0 (the welcome line) and W1 (drag the map) come first: mark them seen, as a player who has read them would, so the W2 hint is the one under test
        // (clicking their x raced the W2 hint: a late click dismissed W2 itself)
        await q(() => { const seen = window.__hd.state.tutorial.seen; seen.W0 = true; seen.W1 = true; });
        ok(await t.waitFor(() => /glowing region/i.test((document.querySelector('.coach:not([hidden]) .coach-text') || {}).textContent || ''), 25000), `${tag}: the W2 hint shows`);
        await sleep(1200);
        const w2 = await q(async () => {
          const hd = window.__hd;
          const I = await import(new URL('game/meta/intel.js', document.baseURI).href);
          const P = await import(new URL('game/meta/progression.js', document.baseURI).href);
          const id = I.tutorialRegionId(hd.state, hd.world);
          const b = document.querySelector('.coach:not([hidden]) .coach-bubble').getBoundingClientRect();
          const box = hd.regionHintBox(id);
          const ov = Math.min(b.right, box.x + box.w) - Math.max(b.left, box.x);
          const oh = Math.min(b.bottom, box.y + box.h) - Math.max(b.top, box.y);
          return { id, attackable: P.attackable(hd.state, hd.world, id), outline: hd.hintOutline(), overlap: ov > 0 && oh > 0 ? Math.round(ov * oh) : 0, pos: hd.regionScreenPos(id), name: hd.world.regions[id].name };
        });
        ok(w2.attackable, `${tag}: the hinted region (${w2.name}) can be attacked (the lesson never points at a walled-off one)`);
        ok(w2.outline === w2.id, `${tag}: the region is outlined on the map while the hint is up`);
        ok(w2.overlap === 0, `${tag}: the bubble covers none of the region's on-screen extent (${w2.overlap} px2)`);
        await shot(t, `fix1-w2-${name.replace(/ /g, '-')}-seed${seed}`);
        // the click meant for the region reaches the region
        const press = async (x, y) => {
          if (dims.mobile) {
            await t.page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
            await sleep(70);
            await t.page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          } else {
            await t.page.mouse('mouseMoved', x, y, 'none', 0);
            await t.page.mouse('mousePressed', x, y, 'left', 1);
            await sleep(60);
            await t.page.mouse('mouseReleased', x, y, 'left', 0);
          }
        };
        await press(w2.pos.x, w2.pos.y);
        ok(await t.waitFor((n) => { const d = document.querySelector('.hd-dock'); return !!d && !d.hidden && (document.querySelector('.region-card-name') || {}).textContent === n; }, 5000, w2.name), `${tag}: a real click on the glowing region opens its card (the bubble took no click)`);
        ok(await t.waitFor(() => /^attack!/i.test(((document.querySelector('.coach:not([hidden]) .coach-text') || {}).textContent || '').trim()), 12000), `${tag}: the W3 "Attack!" hint shows`);
        await sleep(1500);
        const card = await q(() => {
          const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, b: b.bottom, r: b.right }; };
          const dock = r(document.querySelector('.hd-dock'));
          const body = r(document.querySelector('.region-card-body'));
          const act = document.querySelector('.region-card-action:not([hidden])');
          return { vw: innerWidth, vh: innerHeight, dock, body, attack: act ? r(act) : null, bodyScrolls: document.querySelector('.region-card-body').scrollHeight > document.querySelector('.region-card-body').clientHeight + 1 };
        });
        ok(card.dock.y >= 0 && card.dock.b <= card.vh + 1, `${tag}: the card fits the screen (${Math.round(card.dock.y)} to ${Math.round(card.dock.b)} of ${card.vh})`);
        ok(!!card.attack && card.attack.y >= 0 && card.attack.b <= card.vh + 1 && card.attack.y >= card.body.b - 1, `${tag}: Attack is fully on screen, in a footer below the card body (it covers no row)`);
        // the hint monitor ran after every frame of all of this
        const rep = await q(() => window.__hm.report());
        const problems = rep.hints.flatMap((h) => Object.entries(h.problems).map(([k, v]) => `"${h.text.slice(0, 32)}": ${k} (${v.n} frames) ${v.detail}`));
        ok(problems.length === 0, `${tag}: no hint placement problems in ${rep.shown} frames${problems.length ? `: ${problems[0]}` : ''}`);
        await shot(t, `fix2-w3-${name.replace(/ /g, '-')}-seed${seed}`);
        // 13: a phone cannot zoom a region past the screen
        if (dims.mobile && dims.width < 600) {
          const z = await q(() => { const c = window.__hd.camera; c.zoomAt(1000, innerWidth / 2, innerHeight / 2); return { zoom: c.zoom, max: c._maxZoom }; });
          ok(z.zoom <= 28.01 && z.max <= 28.01, `${tag}: the zoom stops at ${z.zoom.toFixed(1)} (a region never fills the phone screen)`);
        }
        // 14d: the council hint names a good first buy once the first battle is won
        if (name === 'desktop' && seed === 7) {
          await q(() => { window.__hd.state.stats.battlesWon = 1; window.__hd.selectRegion(window.__hd.world.startRegion); });
          await q(() => { window.__hd.selectRegion(null); });
          await sleep(300);
          ok(await t.waitFor(() => /good first buy/i.test((document.querySelector('.coach:not([hidden]) .coach-text') || {}).textContent || ''), 8000), `${tag}: the council hint names a good first buy ("${await q(() => (document.querySelector('.coach:not([hidden]) .coach-text') || {}).textContent)}")`);
        }
        ok(t.unexpected().length === 0, `${tag}: no console errors${t.unexpected().length ? `: ${t.unexpected()[0]}` : ''}`);
      } catch (err) {
        ok(false, `${tag}: unexpected error: ${err && err.message}`);
      } finally {
        allErrors.push(...t.unexpected().map((e) => `[playtest ${tag}] ${e}`));
        await t.page.close();
      }
    }
  }

  // ---- 4, 6, 7, 8, 9: the battle ---------------------------------------------------------------------------------------------------------------------------------
  {
    console.log('\n== playtest: battle controls ==');
    const t = await open(`${URL0}&seed=7`, { width: 1440, height: 900 });
    const q = (fn, ...a) => t.page.eval(fn, ...a);
    try {
      ok(await t.atTitle(), 'battle: boots');
      ok(await t.clickText('button', 'New Realm'), 'battle: New Realm');
      ok(await t.waitFor(() => window.__hd.scene === 'world', 30000), 'battle: the realm starts');
      await q(() => { window.__hd.state.settings.hints = false; });
      const target = await q(async () => {
        const hd = window.__hd;
        const P = await import(new URL('game/meta/progression.js', document.baseURI).href);
        return P.attackableFrontier(hd.state, hd.world)[0];
      });
      await q((id) => window.__hd.startBattle(id), target);
      ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000), 'battle: the battle goes live');
      await sleep(600);
      // 7: the Swift countdown
      const swift = await q(() => { const e = document.querySelector('.battle-timer'); const s = document.querySelector('.battle-swift'); return { text: e.textContent.trim(), shown: !!s && !s.hidden, missed: !!s && s.classList.contains('is-missed') }; });
      ok(swift.shown && /^\d+:\d\d\s*·\s*Swift\s+\d+:\d\d$/.test(swift.text.replace(/\s+/g, ' ')), `7: the timer reads clock and Swift countdown ("${swift.text}")`);
      ok(!swift.missed, '7: it is not dimmed while Swift is still possible');
      // 4: click Speed with the mouse, then Space: it pauses, the speed stays
      await t.clickSel('.battle-speed');
      await sleep(250);
      const afterClick = await q(() => ({ active: document.activeElement && document.activeElement.className, speed: document.querySelector('.battle-speed').textContent.trim() }));
      ok(!/battle-speed/.test(afterClick.active || ''), `4: a mouse click on Speed leaves focus off the button (focus: ${afterClick.active || 'body'})`);
      ok(/2×/.test(afterClick.speed), `4: the click made it 2x (${afterClick.speed})`);
      await keyPress(t, ' ', 'Space', ' ');
      await sleep(300);
      const afterSpace = await q(() => ({ speed: document.querySelector('.battle-speed').textContent.trim(), paused: !!document.querySelector('.battle-paused-tag') && !document.querySelector('.battle-paused-tag').hidden }));
      ok(afterSpace.paused && /2×/.test(afterSpace.speed), `4: Space after clicking Speed PAUSES the battle (paused ${afterSpace.paused}, speed still ${afterSpace.speed})`);
      // 9: an order while paused waits, with a toast once; the ghost arrow is drawn (the queued command is visible state)
      const plan = await q(async () => {
        const hd = window.__hd;
        const sim = await import(new URL('game/battle/sim.js', document.baseURI).href);
        const info = hd.siteInfo();
        const camp = info.find((s) => s.type === 'camp' && s.owner === 0);
        const onScreen = (x) => x.y > 100 && x.y < innerHeight - 170 && x.x > 10 && x.x < innerWidth - 10;
        const dest = info.find((s) => s.owner !== 0 && onScreen(s) && sim.canRoute(hd.battle, 0, camp.id, s.id));
        return camp && dest ? { camp: { x: camp.x, y: camp.y + 4 }, dest: { x: dest.x, y: dest.y + 4 } } : null;
      });
      ok(!!plan, '9: a settlement the War Camp can send to is on screen');
      if (plan) {
        const sentBefore = await q(() => window.__hd.battle.stats.sent);
        await t.page.drag(plan.camp, plan.dest, 14);
        await sleep(500);
        const queued = await q(() => ({ commands: window.__hd.battle.commands.length, sent: window.__hd.battle.stats.sent, toast: [...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | ') }));
        ok(queued.commands >= 1 && queued.sent === sentBefore, `9: the order waits in the queue while paused (${queued.commands} queued, nothing sent yet)`);
        ok(/orders go out when you resume/i.test(queued.toast), `9: a toast says so ("${queued.toast.slice(0, 50)}")`);
        await keyPress(t, ' ', 'Space', ' ');
        ok(await t.waitFor((n) => window.__hd.battle.stats.sent > n, 6000, sentBefore), '9: on resume the order goes out');
      }
      // 6: 1-4 mid-drag redraws the preview at once
      const plan2 = await q(async () => {
        const hd = window.__hd;
        const sim = await import(new URL('game/battle/sim.js', document.baseURI).href);
        const info = hd.siteInfo();
        const camp = info.find((s) => s.type === 'camp' && s.owner === 0);
        const onScreen = (x) => x.y > 100 && x.y < innerHeight - 170 && x.x > 10 && x.x < innerWidth - 10;
        const dest = info.find((s) => s.owner !== 0 && onScreen(s) && sim.canRoute(hd.battle, 0, camp.id, s.id));
        return camp && dest ? { camp: { x: camp.x, y: camp.y + 4 }, dest: { x: dest.x, y: dest.y + 4 } } : null;
      });
      if (plan2) {
        await t.page.mouse('mouseMoved', plan2.camp.x, plan2.camp.y, 'none', 0);
        await t.page.mouse('mousePressed', plan2.camp.x, plan2.camp.y, 'left', 1);
        for (let i = 1; i <= 14; i++) { await t.page.mouse('mouseMoved', plan2.camp.x + ((plan2.dest.x - plan2.camp.x) * i) / 14, plan2.camp.y + ((plan2.dest.y - plan2.camp.y) * i) / 14, 'left', 1); await sleep(15); }
        await sleep(200);
        await keyPress(t, '1', 'Digit1', '1');
        await sleep(150);
        const tip1 = await q(() => document.querySelector('.tooltip').textContent);
        await keyPress(t, '4', 'Digit4', '4');
        await sleep(150);
        const tip2 = await q(() => document.querySelector('.tooltip').textContent);
        const held = await q(() => window.__hd.dragInfo());
        await t.page.mouse('mouseReleased', plan2.dest.x, plan2.dest.y, 'left', 0);
        ok(!!tip1 && !!tip2 && tip1 !== tip2, `6: pressing 4 after 1 in mid-drag changes the preview at once ("${tip1.slice(0, 34)}" -> "${tip2.slice(0, 34)}")`);
        ok(!!held && !!held.outcome, `6: the arrow outcome is still known after the key (${held && held.outcome})`);
        const expectShape = { capture: ['solid', 'check'], fail: ['dashed', 'cross'], noRoute: ['dotted', null], reinforce: ['solid', null] }[held && held.outcome];
        ok(!!expectShape && held.shape === expectShape[0] && held.mark === expectShape[1], `M5: the arrow is shape-coded as well as coloured (${held && held.outcome}: ${held && held.shape}, mark ${held && held.mark}, word "${held && held.word}")`);
      }
      // 7: dimmed once missed (the battle clock is pushed past the deadline)
      await q(() => { window.__hd.battle.t += 400; });
      await sleep(400);
      const missed = await q(() => { const s = document.querySelector('.battle-swift'); return { text: s.textContent.trim(), missed: s.classList.contains('is-missed') }; });
      ok(missed.missed && /missed/i.test(missed.text), `7: once missed it dims and says so ("${missed.text}")`);
      // 8: the speed cycle, with and without Slow battles
      await q(() => { window.__hd.state.settings.slowBattles = false; });
      await sleep(200);
      const cycle = async (n) => { const seen = []; for (let i = 0; i < n; i++) { await t.clickSel('.battle-speed'); await sleep(200); seen.push(await q(() => document.querySelector('.battle-speed').textContent.trim())); } return seen; };
      const base = await cycle(4);
      ok(base.join(' ') === '1× 2× 3× 1×' || base.join(' ') === '3× 1× 2× 3×' || /^(1×|2×|3×)( (1×|2×|3×)){3}$/.test(base.join(' ')) && !base.includes('0.5×'), `8: without Slow battles the speed button cycles 1x 2x 3x (${base.join(' ')})`);
      await q(() => { window.__hd.state.settings.slowBattles = true; });
      await sleep(200);
      const slowSeq = await cycle(5);
      ok(slowSeq.includes('0.5×'), `8: with Slow battles on, 0.5x joins the cycle (${slowSeq.join(' ')})`);
      ok(t.unexpected().length === 0, `battle: no console errors${t.unexpected().length ? `: ${t.unexpected()[0]}` : ''}`);
    } catch (err) {
      ok(false, `battle: unexpected error: ${err && err.message}`);
    } finally {
      allErrors.push(...t.unexpected().map((e) => `[playtest battle] ${e}`));
      await t.page.close();
    }
  }

  // ---- 10, 12, 14: welcome, scout panel, Works, Settings ----------------------------------------------------------------------------------------------------------
  {
    console.log('\n== playtest: welcome card, scout panel, Works, Settings ==');
    const t = await open(`${URL0}&seed=7`, { width: 1440, height: 900 });
    const q = (fn, ...a) => t.page.eval(fn, ...a);
    try {
      ok(await t.atTitle(), 'cards: boots');
      ok(await t.clickText('button', 'New Realm'), 'cards: New Realm');
      ok(await t.waitFor(() => window.__hd.scene === 'world', 30000), 'cards: the realm starts');
      await q(() => { window.__hd.state.settings.hints = false; window.__hd.conquerRegions(2); });
      // 12: scout the tutorial region for free (real click) and read the explanation
      const rid = await q(async () => { const I = await import(new URL('game/meta/intel.js', document.baseURI).href); return I.tutorialRegionId(window.__hd.state, window.__hd.world); });
      void rid;
      const fid = await q(async () => { const P = await import(new URL('game/meta/progression.js', document.baseURI).href); return P.attackableFrontier(window.__hd.state, window.__hd.world)[0]; });
      await q((id) => { window.__hd.grantGold(5000); window.__hd.selectRegion(id); }, fid);
      await sleep(900);
      ok(await t.clickSel('.intel-scout-btn'), '12: Scout clicked');
      ok(await t.waitFor(() => !!document.querySelector('.intel-gloss') && document.querySelector('.intel-gloss').textContent.length > 8, 5000), '12: the scouted card explains "weak point" in a visible line');
      const gloss = await q(() => ({ text: document.querySelector('.intel-gloss').textContent, shown: document.querySelector('.intel-gloss').getClientRects().length > 0, personality: (document.querySelector('.intel-personality') || {}).textContent }));
      ok(gloss.shown, `12: the line is visible, no hover needed ("${gloss.text}")`);
      ok(!/reinforces/i.test(gloss.personality || ''), `12: the personality line avoids the word "reinforces" ("${(gloss.personality || '').slice(0, 60)}")`);
      // Works subtitle on an owned region's card
      const owned = await q(() => window.__hd.state.owner.findIndex((o, i) => o === 0 && i !== window.__hd.world.startRegion));
      await q((id) => window.__hd.selectRegion(id), owned);
      await sleep(900);
      const sub = await q(() => (document.querySelector('.works-sub') || {}).textContent || '');
      ok(/helps battles in the regions next to this\sone/i.test(sub), `12: the Works subtitle reads "${sub}"`);
      // 14: Settings Copy
      await q(() => window.__hd.selectRegion(null));
      await t.page.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
      await q(() => window.__hd.openSettings());
      ok(await t.waitFor(() => !!document.querySelector('.settings-copy'), 4000), '14: Settings has a Copy button');
      await t.clickSel('.settings .btn', 'Export');
      await sleep(300);
      ok(await t.clickSel('.settings-copy'), '14: Copy clicked');
      ok(await t.waitFor(() => /copied/i.test([...document.querySelectorAll('.settings-import-msg')].map((e) => e.textContent).join(' ')), 4000), '14: it says "Copied"');
      ok(await q(() => !!document.querySelector('.settings') && [...document.querySelectorAll('.settings .settings-row-label, .settings-row')].some((e) => /slow battles/i.test(e.textContent))), '8: Settings has the Slow battles switch');
      await shot(t, 'fix8-settings-slow-battles');
      ok(t.unexpected().length === 0, `cards: no console errors${t.unexpected().length ? `: ${t.unexpected()[0]}` : ''}`);
    } catch (err) {
      ok(false, `cards: unexpected error: ${err && err.message}`);
    } finally {
      allErrors.push(...t.unexpected().map((e) => `[playtest cards] ${e}`));
      await t.page.close();
    }
    // 10: the welcome card, away longer than the cap
    const w = await open(`${URL0}&seed=7`, { width: 1440, height: 900 });
    try {
      ok(await w.atTitle(), 'welcome: boots');
      ok(await w.clickText('button', 'New Realm'), 'welcome: New Realm');
      ok(await w.waitFor(() => window.__hd.scene === 'world', 30000), 'welcome: the realm starts');
      await w.page.eval(() => window.__hd.conquerRegions(2));
      ok(await w.waitFor(() => { try { return JSON.parse(localStorage.getItem('hexdominion.v2')).owner.filter((o) => o === 0).length >= 3; } catch { return false; } }, 15000), 'welcome: the realm is saved');
      await w.page.send('Page.addScriptToEvaluateOnNewDocument', { source: '(() => { const rn = Date.now.bind(Date); Date.now = () => rn() + 30 * 3600 * 1000; })();' });
      await w.page.goto(`${URL0}&seed=7`);
      ok(await w.atTitle(), 'welcome: reloaded 30 hours later');
      ok(await w.clickText('button', 'Continue'), 'welcome: Continue');
      ok(await w.waitFor(() => { const c = document.querySelector('.welcome-card'); return !!c && !c.closest('[hidden]') && c.getClientRects().length > 0; }, 8000), 'welcome: the Welcome back card shows');
      const cap = await w.page.eval(async () => {
        const { ECONOMY } = await import(new URL('game/config/meta.js', document.baseURI).href);
        const n = document.querySelector('.welcome-capnote');
        return { text: n && !n.hidden ? n.textContent : '', hours: ECONOMY.offlineCapHours, row: document.querySelector('.welcome-gold-row').textContent };
      });
      ok(/capped at/.test(cap.text) && cap.text.includes(`${cap.hours} h`), `10: "${cap.text}" sits beside the figure, derived from the real cap (${cap.hours} h)`);
      await shot(w, 'fix10-welcome-capped');
    } catch (err) {
      ok(false, `welcome: unexpected error: ${err && err.message}`);
    } finally {
      allErrors.push(...w.unexpected().map((e) => `[playtest welcome] ${e}`));
      await w.page.close();
    }
  }
}
