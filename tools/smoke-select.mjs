// tools/smoke.mjs step 5e: BOX-SELECT and the RALLY CLICK, the two gestures
// that go through screens/battle-select.js.
//
// This file exists because both of them were dead for a release and the whole
// unit suite stayed green. The split that created `battle-select.js` moved two
// functions that closed over battle-orders.js's `board`, `getState` and a
// scratch point; only four of the seven dependencies were destructured, so the
// other three became free variables — which is not a syntax error in a module
// and not a test failure either, unless something calls the path. Nothing did:
// smoke drove the rally DRAG (a different function) and never box-selected at
// all, and `tests/rally.test.js` only caught it after this session added the
// click case.
//
// So the lesson this step encodes is the house one, one layer up from
// "assert `document.elementFromPoint`": A GESTURE WITH NO SMOKE STEP IS A
// GESTURE THAT CAN BE DELETED BY A REFACTOR WITHOUT ANYTHING GOING RED.

/** Every player site's screen point, so the box can be drawn around real ones. */
const playerPoints = (page) => page.eval(() => {
  // `g.__view`, the accessor every other smoke step uses. `g.screens.battle`
  // holds the SCENE, not the renderer, so reading a board off it returns
  // undefined and this step degrades to a silent skip — which is exactly the
  // worthless-but-green shape it was written to prevent.
  const g = window.__game;
  const view = g.__view;
  if (!view) return null;
  return g.state.battle.sites.filter((s) => s.owner === 'player')
    .map((s) => ({ id: s.id, ...view.siteScreen(s, {}) }));
});

/** Does the browser's own hit test land this point on the canvas? The HUD
 *  plates sit OVER the board and are not pointer-transparent, so a press on a
 *  perfectly valid hex can be swallowed by a panel — the exact failure the
 *  camped-drag step spent half a session on. */
const onCanvas = (page, x, y) => page.eval((p) => {
  const el = document.elementFromPoint(p.x, p.y);
  return !!el && el.tagName === 'CANVAS';
}, { x, y });

/**
 * @param {object} page   cdp page
 * @param {(s:string)=>void} step  ok line
 * @param {(s:string)=>void} note  something worth saying that is not a failure
 */
export async function runSelect(page, step, note) {
  // A neutral pointer, for the reason the camped step documents at length: a
  // previous step's leftover mode routes the press somewhere else entirely and
  // the failure looks like a hit-test problem.
  await page.eval(() => {
    const v = window.__game.__ui;
    if (!v) return;
    v.armedBuild = null;
    v.armedBooster = null;
    v.rallyMode = false;
    v.selection.length = 0;
  });
  await page.sleep(150);

  const pts = await playerPoints(page);
  if (!pts || pts.length < 2) { note('fewer than two player sites to box'); return; }

  // A box comfortably around every one of them, clamped to points the pointer
  // can actually reach — a corner under the site panel drags the panel, not the
  // board.
  const pad = 40;
  const x0 = Math.min(...pts.map((p) => p.x)) - pad;
  const y0 = Math.min(...pts.map((p) => p.y)) - pad;
  const x1 = Math.max(...pts.map((p) => p.x)) + pad;
  const y1 = Math.max(...pts.map((p) => p.y)) + pad;
  if (!await onCanvas(page, x0, y0) || !await onCanvas(page, x1, y1)) {
    note('the box corners land on a HUD plate, not the board');
    return;
  }

  await page.drag({ x: x0, y: y0 }, { x: x1, y: y1 });
  await page.sleep(200);

  const sel = await page.eval(() => (window.__game.__ui?.selection ?? []).slice());
  if (!Array.isArray(sel) || sel.length < 2) {
    await tidy(page);
    throw new Error(`box select took ${JSON.stringify(sel)} — expected at least two of `
      + `${pts.length} player sites. boxSelect threw a ReferenceError for a whole release `
      + 'and nothing noticed; check battle-select.js still receives board/getState.');
  }
  step(`box select: ${sel.length} of ${pts.length} player sites selected by one drag`);

  // ...and the RALLY CLICK, the other function in that file, which points the
  // whole selection at one target in a single action. It is deliberately driven
  // with the box's own result still selected, because that is the interaction:
  // box a flank, then aim it.
  const target = pts.find((p) => !sel.includes(p.id)) ?? pts[0];
  if (!await onCanvas(page, target.x, target.y)) {
    note('no rally target the pointer can reach');
    await tidy(page);
    return;
  }
  const before = await page.eval(() => window.__game.state.battle.sites
    .filter((s) => (s.rallyTargets ?? []).length).length);
  await page.eval(() => { window.__game.__ui.rallyMode = true; });
  await page.sleep(120);
  // A real press/release pair, not a synthetic click: `cdp.js` has no
  // `click()` and adding one would be the shortcut this suite exists to refuse.
  await page.mouse('mouseMoved', target.x, target.y, 'none', 0);
  await page.mouse('mousePressed', target.x, target.y);
  await page.mouse('mouseReleased', target.x, target.y);
  await page.sleep(200);
  const after = await page.eval(() => window.__game.state.battle.sites
    .filter((s) => (s.rallyTargets ?? []).length).length);
  await page.eval(() => { window.__game.__ui.rallyMode = false; });
  if (after > before) {
    step(`rally click: sites with a rally went ${before} -> ${after} from one click`);
  } else {
    note(`rally click set nothing (${before} -> ${after}) — no legal pair`);
  }
  await tidy(page);
}

/**
 * LEAVE THE INPUT STATE AS THIS STEP FOUND IT, and the SELECTION is the part
 * that bites. This is the only step that deliberately selects several sites,
 * and a drag that starts on a site already in the selection commits the WHOLE
 * selection (the multi-source send rule) — so leaving three sites selected made
 * the camped-drag step four steps later issue a SEND instead of a MOVE_SQUAD,
 * intermittently, depending on where the army happened to camp.
 *
 * That is verbatim the failure smoke-camped.mjs's own header documents against
 * `rallyMode`, one gesture later and with a different piece of leftover state.
 * Every step that changes a mode owes the next one a clean one.
 */
async function tidy(page) {
  await page.eval(() => {
    const v = window.__game.__ui;
    if (!v) return;
    v.selection.length = 0;
    v.armed = null;
    v.rallyMode = false;
    v.selectedSquad = null;
  });
  await page.sleep(120);
}
