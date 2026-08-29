// tools/smoke.mjs: THE KEYBOARD PATH TO THE BOARD.
//
// The lesson `smoke-select.mjs` encodes, applied to the newest gesture: A
// GESTURE WITH NO SMOKE STEP IS A GESTURE THAT CAN BE DELETED BY A REFACTOR
// WITHOUT ANYTHING GOING RED. That is not hypothetical for this one — the
// board's keys live in `battle-hotkeys.js`, the ordering in
// `battle-keynav.js`, the focus hop in `battle-panel.js` and the send in
// `battle-select.js`, and `tests/keynav.test.js` can only reach the second of
// those. Everything between a keypress and a squad is browser-only.
//
// REAL KEY EVENTS, dispatched through CDP, for the same reason every click
// here is a real pointer event: the handler is bound on `window` and reads
// `ev.target`, so a `new KeyboardEvent` fired from page script can be made to
// say anything and proves nothing about where the listener actually is.

const ui = (page) => page.eval(() => {
  const v = window.__game.__ui;
  const b = window.__game.state.battle;
  const panel = document.querySelector('.hud-selection');
  const a = document.activeElement;
  return {
    hoverId: v?.hoverId ?? null,
    selection: (v?.selection ?? []).slice(),
    kbAiming: !!v?.kbAiming,
    // SQUAD IDS, NOT A COUNT. A count is racy in a live battle and this step
    // failed on it once: columns arrive and resolve every tick, so `squads`
    // read 8 before the send and 7 after while the send itself was perfectly
    // fine. What proves a send happened is a squad that did not exist before
    // and whose `from` is the source that was selected.
    ids: b.squads.map((q) => q.id),
    from: Object.fromEntries(b.squads.map((q) => [q.id, q.from ?? null])),
    mine: b.sites.filter((s) => s.owner === 'player').length,
    panelOpen: !!panel?.classList.contains('is-open'),
    focusInPanel: !!a?.closest?.('.hud-selection'),
  };
});

export async function runKeyboard(page, step, note) {
  const before = await ui(page);
  if (before.mine < 2) { note('fewer than two player sites for the keyboard walk'); return; }

  // 1. `]` CYCLES AND SELECTS. Before this existed the keyboard could not make
  //    a selection at all, so the site panel never opened and every verb
  //    behind it — train, upgrade, build, rally, retreat, the send — was
  //    mouse-only.
  const seen = [];
  for (let i = 0; i < before.mine; i++) {
    await page.press(']');
    await page.sleep(160);
    seen.push((await ui(page)).hoverId);
  }
  const distinct = new Set(seen.filter(Boolean));
  if (distinct.size !== before.mine) {
    throw new Error(`']' visited ${distinct.size} of ${before.mine} owned sites: ${seen.join(',')}`);
  }
  const open = await ui(page);
  if (!open.panelOpen) throw new Error('cycling selected a site but the panel never opened');
  if (!open.selection.length) throw new Error('cycling moved the cursor without selecting');
  step(`keyboard: ']' walked all ${before.mine} owned sites and opened the panel`);

  // 2. AND FOCUS FOLLOWS, or the panel it just opened is twelve-plus Tab stops
  //    away and the whole thing is theatre.
  if (!open.focusInPanel) throw new Error('the panel opened but never took focus');
  await page.press('Tab');
  await page.sleep(150);
  const tabbed = await ui(page);
  if (!tabbed.focusInPanel) throw new Error('Tab from the panel left it instead of entering it');
  step('keyboard: the panel takes focus, and one Tab reaches its buttons');

  // 3. Back to the board, then AIM AND SEND — the core verb, keyboard-only.
  //    Shift+Tab returns to the panel container, which is not a "control" and
  //    so lets the board's keys through again.
  await page.press('Shift');   // no-op, keeps the sequence readable
  await page.eval(() => document.querySelector('.hud-selection')?.focus());
  await page.sleep(120);
  const start = await ui(page);
  await page.press('Enter');
  await page.sleep(200);
  const aiming = await ui(page);
  if (!aiming.kbAiming) throw new Error('Enter on a selected site did not start aiming');
  if (!aiming.hoverId) throw new Error('aiming started with no target under the cursor');
  if (JSON.stringify(aiming.selection) !== JSON.stringify(start.selection)) {
    throw new Error('aiming moved the SELECTION — the source must stay put');
  }
  await page.press('Enter');
  await page.sleep(400);
  const sent = await ui(page);
  if (sent.kbAiming) throw new Error('Enter committed but left the reticle up');
  const had = new Set(start.ids);
  const fresh = sent.ids.filter((id) => !had.has(id));
  const fromSource = fresh.filter((id) => start.selection.includes(sent.from[id]));
  if (!fromSource.length) {
    throw new Error(`Enter committed and nothing marched from ${start.selection.join('/')}: `
      + `${fresh.length} new squad(s), none of them from the source`);
  }
  step(`keyboard: Enter aimed and sent — ${fromSource.length} column(s) left `
    + `${start.selection.join('/')}`);

  // 4. NEGATIVE CONTROL. A focused BUTTON owns its own keys; if `]` walked the
  //    board from there, every panel control would move the cursor under the
  //    player while they were trying to press it.
  await page.press('Tab');
  await page.sleep(150);
  const onBtn = await ui(page);
  await page.press(']');
  await page.sleep(200);
  const after = await ui(page);
  if (after.hoverId !== onBtn.hoverId) {
    throw new Error(`']' walked the board from a focused control: ${onBtn.hoverId} -> ${after.hoverId}`);
  }
  step("keyboard: a focused control keeps ']' to itself");

  // Leave the board as this step found it, so later steps do not inherit a
  // selection — the mistake smoke-select.mjs already records once.
  await page.eval(() => document.activeElement?.blur?.());
  await page.press('Escape');
  await page.press('Escape');
  await page.sleep(120);
}
