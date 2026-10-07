// Play your way, desktop part 2 (tools/optionsChecks.mjs): the keyboard map (rebind, swap, reset, a rebound key works in a battle), hold to confirm
// on Retreat (a tap and an early release do nothing, a full hold retreats), the three volume sliders by real presses, mute when hidden, the Codex topic.

export async function controlChecks({ t, ok, sleep, tag, q, shot, key, openSettings, closeSettings }) {
  // --- the keyboard map ---------------------------------------------------------------------------------------------------------------------
  ok(await openSettings(), tag('Settings again'));
  ok(await t.clickSel('.opt-keyboard'), tag('a press on Keyboard controls'));
  ok(await t.waitFor(() => !!document.querySelector('.keybind-modal .keybind-row'), 4000), tag('the keyboard map opens'));
  const rows = await q(() => document.querySelectorAll('.keybind-row').length);
  ok(rows >= 15, tag(`${rows} rebindable actions listed`));
  ok(await t.clickSel('.keybind-key[data-action="power1"]'), tag('a press on Rally\'s key'));
  ok(await q(() => /Press a key/.test(document.querySelector('.keybind-key[data-action="power1"]').textContent)), tag('it waits for the new key'));
  await key('KeyZ');
  let o = await q(() => ({ ...window.__hd.options().keys }));
  ok(o.power1 === 'KeyZ', tag(`Rally is now Z (${o.power1})`));
  await t.clickSel('.keybind-key[data-action="power1"]');
  await key('KeyW'); // W belongs to Firestorm: the two swap
  o = await q(() => ({ ...window.__hd.options().keys }));
  const status = await q(() => document.querySelector('.keybind-status').textContent);
  ok(o.power1 === 'KeyW' && o.power2 === 'KeyZ', tag(`a taken key swaps: Rally W, Firestorm Z ("${status}")`));
  const conflicts = await q(async () => { const K = await import(new URL('game/ui/keymap.js', document.baseURI).href); return K.findConflicts(window.__hd.options().keys).length; });
  ok(conflicts === 0, tag('no conflict is ever left in the map'));
  await t.clickSel('.keybind-key[data-action="pause"]');
  await key('Escape');
  ok(await q(() => window.__hd.options().keys.pause === 'Space' && !!document.querySelector('.keybind-modal')), tag('Escape cancels a capture and keeps the dialog open'));
  await t.clickSel('.keybind-key[data-action="pause"]');
  await key('Tab', 'Tab');
  ok(await q(() => window.__hd.options().keys.pause === 'Space' && document.querySelector('.keybind-status').classList.contains('is-warn')), tag('a reserved key (Tab) is refused in words'));
  await key('Escape');
  await shot('05-keyboard-map');
  ok(await t.clickSel('.keybind-reset'), tag('a press on Reset to defaults'));
  o = await q(async () => { const K = await import(new URL('game/ui/keymap.js', document.baseURI).href); return JSON.stringify(window.__hd.options().keys) === JSON.stringify(K.defaultBindings()); });
  ok(o, tag('every key is back to its default'));
  await t.clickSel('.keybind-key[data-action="send25"]');
  await key('KeyZ');
  ok(await q(() => window.__hd.options().keys.send25 === 'KeyZ'), tag('Send 25% rebound to Z'));
  await t.clickText('.keybind-modal button', 'Done');
  await sleep(250);
  // hold to confirm on, by a real press
  ok(await t.clickSel('.settings-toggle[data-option="holdToConfirm"]'), tag('a press on Hold to confirm'));
  ok(await q(() => window.__hd.options().holdToConfirm && document.documentElement.hasAttribute('data-hold-confirm')), tag('hold to confirm is on'));
  await closeSettings();

  // --- in a battle: the rebound key, then Retreat with hold to confirm -------------------------------------------------------------------------
  const target = await q(async () => { const P = await import(new URL('game/meta/progression.js', document.baseURI).href); return P.attackableFrontier(window.__hd.state, window.__hd.world)[0]; });
  await q((id) => window.__hd.startBattle(id), target);
  ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000), tag('a battle is live'));
  await sleep(500);
  await q(() => { const c = document.querySelector('#world'); c.focus(); });
  const pressed = () => q(() => document.querySelector('.send-fraction-btn[aria-pressed="true"]')?.getAttribute('aria-label'));
  await key('Digit2', '2');
  const p50 = await pressed();
  await key('KeyZ');
  const pz = await pressed();
  await key('Digit2', '2');
  await key('Digit1', '1');
  const p1 = await pressed();
  const labels = await q(() => ({ send: document.querySelector('.send-fraction-key').textContent, power: document.querySelector('.power-hotkey')?.textContent }));
  ok(p50 === 'Send 50%' && pz === 'Send 25%' && p1 === 'Send 50%', tag(`the rebound key works in battle: 2 -> ${p50}, Z -> ${pz}, the old 1 does nothing (${p1})`));
  ok(labels.send === 'Z' && labels.power === 'Q', tag(`the HUD shows the player's keys (25% "${labels.send}", Rally "${labels.power}")`));
  ok(await t.clickSel('.battle-retreat'), tag('a press on Retreat'));
  ok(await t.waitFor(() => !!document.querySelector('.modal-actions .btn-danger.is-hold'), 3000), tag('the confirm offers a hold button'));
  const aria = await q(() => document.querySelector('.modal-actions .btn-danger').getAttribute('aria-label'));
  ok(/press and hold/i.test(aria || ''), tag(`its name says so ("${aria}")`));
  await t.clickSel('.modal-actions .btn-danger'); // an ordinary tap
  await sleep(400);
  ok(await q(() => window.__hd.scene === 'battle' && !!document.querySelector('.modal-actions .btn-danger')), tag('a tap does not retreat'));
  const p = await q(() => { const r = document.querySelector('.modal-actions .btn-danger').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await t.page.mouse('mouseMoved', p.x, p.y, 'none', 0);
  await t.page.mouse('mousePressed', p.x, p.y, 'left', 1);
  await sleep(450);
  await shot('06-hold-to-confirm');
  await t.page.mouse('mouseReleased', p.x, p.y, 'left', 0);
  await sleep(700);
  ok(await q(() => window.__hd.scene === 'battle'), tag('letting go half way does not retreat'));
  await t.page.mouse('mousePressed', p.x, p.y, 'left', 1);
  await sleep(1250);
  await t.page.mouse('mouseReleased', p.x, p.y, 'left', 0);
  ok(await t.waitFor(() => window.__hd.scene === 'world' || window.__hd.battlePhase !== 'live', 8000), tag(`a full hold retreats (${await q(() => window.__hd.battlePhase)})`));
  await sleep(800);
  // the retreat's results card: back to the map by a real press
  for (let i = 0; i < 20 && await q(() => window.__hd.scene) !== 'world'; i++) {
    const b = await q(() => { const x = [...document.querySelectorAll('.results-card button, .results button')].find((e) => e.getClientRects().length && /map|continue/i.test(e.textContent)); return x ? x.textContent.trim() : null; });
    if (b) await t.clickText('.results-card button, .results button', b);
    await sleep(500);
  }
  ok(await t.waitFor(() => window.__hd.scene === 'world', 10000), tag('back on the map after the retreat'));
  await sleep(600);

  // --- audio: the three sliders by real presses, mute when hidden ------------------------------------------------------------------------------
  ok(await openSettings(), tag('Settings for the audio'));
  const voicesBefore = await q(() => window.__hd.voicesSaid());
  for (const [label, read, at] of [['Music volume', 'musicVolume', 0.25], ['Effects volume', 'sfxVolume', 0.5], ['Voices volume', 'voicesVolume', 0.3]]) {
    const pos = await q((l, a) => {
      const e = document.querySelector(`input[aria-label="${l}"]`);
      e.scrollIntoView({ block: 'center' });
      const r = e.getBoundingClientRect();
      return { x: r.left + 8 + (r.width - 16) * a, y: r.top + r.height / 2 };
    }, label, at);
    await sleep(350);
    await t.page.mouse('mouseMoved', pos.x, pos.y, 'none', 0);
    await t.page.mouse('mousePressed', pos.x, pos.y, 'left', 1);
    await sleep(80);
    await t.page.mouse('mouseReleased', pos.x, pos.y, 'left', 0);
    await sleep(250);
    const v = await q((k) => (k === 'voicesVolume' ? window.__hd.options()[k] : window.__hd.state.settings[k]), read);
    ok(Math.abs(v - at) <= 0.1, tag(`${label}: a press at ${Math.round(at * 100)}% sets ${Math.round(v * 100)}%`));
  }
  const voicesAfter = await q(() => window.__hd.voicesSaid());
  ok(voicesAfter > voicesBefore, tag(`letting go of Voices plays a sample voice (${voicesBefore} -> ${voicesAfter})`));
  await shot('07-settings-audio');
  const hid = await q(async () => {
    const set = (v) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); };
    set(true); const hidden = window.__hd.sfxMuted();
    set(false); const shown = window.__hd.sfxMuted();
    window.__hd.setOption('muteHidden', false); set(true); const off = window.__hd.sfxMuted();
    set(false); window.__hd.setOption('muteHidden', true); delete document.hidden;
    return { hidden, shown, off, def: true };
  });
  ok(hid.hidden && !hid.shown && !hid.off, tag(`mute when hidden: silent while hidden (${hid.hidden}), back when shown (${!hid.shown}), and the switch turns it off (${!hid.off})`));

  // --- the Codex's Options topic ------------------------------------------------------------------------------------------------------------
  ok(await t.clickSel('.settings-codex'), tag('Settings > Codex'));
  ok(await t.waitFor(() => !!document.querySelector('.codex-topic[data-topic="options"]'), 8000), tag('the Codex lists Options'));
  await t.clickSel('.codex-topic[data-topic="options"]');
  await sleep(300);
  const page = await q(() => ({ title: document.querySelector('.codex-page-title').textContent, nums: document.querySelectorAll('.codex-numbers dt').length }));
  ok(page.title === 'Options' && page.nums >= 4, tag(`the Options page opens with its numbers ("${page.title}", ${page.nums})`));
  await shot('08-codex-options');
  await key('Escape');
  await sleep(250);
  await closeSettings();
  await q(async () => { const K = await import(new URL('game/ui/keymap.js', document.baseURI).href); window.__hd.setOption('keys', K.defaultBindings()); });
}
