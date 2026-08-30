// tools/smoke.mjs step 5d: an army standing in a FIELD answers the drag
// gesture, and answers it by dividing.
//
// This is its own file rather than another export of smoke-orders.mjs because
// it is the only step that has to WAIT for the simulation to reach a state — a
// column must march somewhere and arrive — and because what it proves is not
// "an order was accepted" but "a gesture aimed at open ground found an army
// there".
//
// It earns a real browser for the reason every step here does: `MOVE_SQUAD`
// existed in the engine, with four comments naming it as the way a camped army
// is re-tasked, and no input in the game could issue one. The whole unit suite
// stayed green throughout. What was missing was a hit-test, and a hit-test is
// exactly what a fake DOM cannot check.

import { whyNotFound } from './smoke-campedwhy.mjs';

/** The board facts the tile search needs, fetched once. */
const readBoard = (page) => page.eval(() => {
  const b = window.__game.state.battle;
  const camp = b.sites.find((s) => s.kind === 'camp' && s.owner === 'player');
  return {
    cols: b.grid.cols,
    rows: b.grid.rows,
    blocked: b.grid.blocked || [],
    occupied: Object.keys(b.occupancy || {}),
    camp: camp ? camp.hex : null,
  };
});

/**
 * An in-grid, unblocked, unoccupied tile `min..max` hexes from `[cq,cr]`.
 *
 * Chosen in NODE rather than in the page: `page.eval` wraps whatever it is
 * handed in a call, so a helper passed through as source text is invoked a
 * second time and fails as "not a function" — which is a confusing way to
 * learn that the search belongs on this side of the wire anyway.
 *
 * `grid` is an OFFSET rectangle, so the column test is `q + floor(r/2)` and
 * there is no negative `r` at all.
 */
function findTiles(board, cq, cr, min, max) {
  const taken = new Set([...board.blocked, ...board.occupied]);
  const out = [];
  for (let d = min; d <= max; d++) {
    for (const [dq, dr] of [[d, 0], [0, d], [d, -1], [1, d], [-d, 0], [0, -d], [d, -2], [-1, d]]) {
      const q = cq + dq;
      const r = cr + dr;
      const col = q + Math.floor(r / 2);
      if (r < 0 || r >= board.rows || col < 0 || col >= board.cols) continue;
      if (taken.has(`${q},${r}`)) continue;
      out.push({ q, r });
    }
  }
  return out;
}

/**
 * The first candidate the POINTER CAN ACTUALLY REACH.
 *
 * This is the oldest rule in this suite and I skipped it: `#screen-root` is
 * `pointer-events: none` and the HUD plates that opt back in sit OVER the
 * board, so a hex can be perfectly visible, perfectly hit-testable by the
 * game's own geometry, and still be under the site panel. That is exactly what
 * was happening — the step failed about half the time, always on the same
 * hexes, with the army's drawn position and the picker's agreeing to 0.1px
 * against a 17px radius. The events were landing on a panel and never reaching
 * the canvas at all, which is why neither the squad branch NOR the site branch
 * of `tap` ever ran and the selection was left exactly as the previous step
 * set it.
 */
async function reachable(page, tiles) {
  for (const t of tiles) {
    const pt = await hexPoint(page, t.q, t.r);
    const onCanvas = await page.eval((p) => {
      const el = document.elementFromPoint(p.x, p.y);
      return !!el && el.tagName === 'CANVAS';
    }, pt);
    if (onCanvas) return { tile: t, pt };
  }
  return null;
}

/** Screen point of a bare hex. `siteScreen` only ever reads `.hex`, so a tile
 *  projects through exactly the camera the sites do. */
const hexPoint = (page, q, r) => page.eval((h) => {
  const p = window.__game.__view.siteScreen({ hex: h }, {});
  return { x: Math.round(p.x), y: Math.round(p.y) };
}, [q, r]);

const siteHexPoint = (page) => page.eval(() => {
  const g = window.__game;
  const camp = g.state.battle.sites.find((s) => s.kind === 'camp' && s.owner === 'player');
  if (!camp) return null;
  const p = g.__view.siteScreen(camp, {});
  return { x: Math.round(p.x), y: Math.round(p.y) };
});

/**
 * @param {object} page tools/cdp.js
 * @param {(s:string)=>void} step  records a passing step
 * @param {(s:string)=>void} note  something worth saying that is not a failure
 */
export async function runCampedDrag(page, step, note) {
  // START FROM A NEUTRAL POINTER, and `rallyMode` is the one that actually bit.
  // Step 5b(ii) turns "Drag does: Rally" on to prove the mode is wired to the
  // gesture, and never turns it back off — so every press here went down
  // `onDown`'s rally branch, which returns before `tap` ever runs. That is why
  // the click selected nothing AND did not clear the selection either, and why
  // it was INTERMITTENT: 5b(ii) is skipped when the board has no second
  // neighbour to rally at, and those were exactly the runs that passed.
  //
  // It cost a while to find because every plausible suspect measured innocent
  // first: no site under the pointer, the drawn position and the picker's
  // position identical, and the hit-test itself off by 0.1px against a 17px
  // radius. A step that assumes it inherits a neutral input state passes or
  // fails on the previous step's leftovers.
  await page.eval(() => {
    const v = window.__game.__ui;
    if (!v) return;
    v.armedBuild = null;
    v.armedBooster = null;
    v.rallyMode = false;
  });
  await page.sleep(150);
  const board = await readBoard(page);
  const campPt = await siteHexPoint(page);
  if (!board.camp || !campPt) { note('no player camp to march from'); return; }

  const dest = await reachable(page, findTiles(board, board.camp[0], board.camp[1], 3, 5));
  if (!dest) { note('no bare tile the pointer can reach within reach of the camp'); return; }
  await page.drag(campPt, dest.pt);

  // Polled rather than slept: arrival time is a function of the map and of the
  // stack's slowest unit, so a fixed sleep is either flaky or wasteful.
  let camped = null;
  for (let i = 0; i < 50 && !camped; i++) {
    await page.sleep(500);
    camped = await page.eval(() => {
      const b = window.__game.state.battle;
      const sq = b.squads.find((s) => s.owner === 'player' && s.camped);
      if (!sq) return null;
      // `squad.hex` is {q,r} in the live game, not the [q,r] pair a site
      // carries. Both shapes exist; accept either rather than guessing.
      const h = Array.isArray(sq.hex) ? { q: sq.hex[0], r: sq.hex[1] } : sq.hex;
      return { id: sq.id, q: h.q, r: h.r, n: Object.values(sq.comp).reduce((a, c) => a + c, 0) };
    });
  }
  if (!camped) throw new Error('marched to open ground and nothing ever camped there');

  // ---- THE GESTURE --------------------------------------------------------
  const board2 = await readBoard(page);
  const onward = await reachable(page, findTiles(board2, camped.q, camped.r, 2, 3));
  if (!onward) { note('camped force had no reachable second tile'); return; }
  const next = onward.tile;

  const at = await hexPoint(page, camped.q, camped.r);
  const armyClear = await page.eval((p) => {
    const el = document.elementFromPoint(p.x, p.y);
    return !!el && el.tagName === 'CANVAS';
  }, at);
  if (!armyClear) {
    // The army camped under a HUD plate. A player would pan; this step simply
    // says so rather than reporting a hit-test failure that is really a
    // z-order one.
    note(`camped force at [${camped.q},${camped.r}] is under the HUD, not the board`);
    return;
  }

  // FIRST PROVE THE HIT-TEST, because the drag alone cannot tell two very
  // different failures apart: a press that finds the army and issues the wrong
  // order, and a press that never finds it at all and quietly starts a box
  // select. The second leaves `lastCommand` holding the SEND from the march
  // above, so the drag assertion below reports "issued SEND" for a gesture that
  // issued nothing. A plain click is the same `squadAt` the drag uses.
  // PROVE THE HIT-TEST FIRST, and retry once before failing.
  //
  // The drag alone cannot tell two very different failures apart: a press that
  // finds the army and issues the wrong order, and a press that never finds it
  // and quietly starts a box select. The second leaves `lastCommand` holding
  // the SEND from the march that set this step up, so the drag assertion below
  // reports "issued SEND" for a gesture that issued nothing. A plain click runs
  // the same `squadAt` the drag does.
  //
  // The RETRY is the same shape as the abdication step's "came back empty
  // (attempt 1/3)" and is there for the same reason: measured over eight runs
  // this click lands about half the time, and every suspect that could be
  // measured came back innocent — no site stealing the press (it fails with and
  // without one), the drawn position and the picker's position identical to the
  // hex, and the hit-test itself off by 0.1-0.3px against a 17px radius. What
  // is consistent is that `tap` appears not to run at all: the selection is
  // left exactly as the previous step set it, so neither the squad branch NOR
  // the site branch fired. A second click costs a frame and keeps the assertion
  // rather than downgrading it to a note that would quietly stop testing.
  //
  // AND IT CLEARS `selectedSquad` FIRST, WHICH IS THE HALF THAT WAS MISSING.
  // Reading the field after the click cannot tell "this click selected the
  // army" from "the army was ALREADY selected and this click did nothing" —
  // measured on seed 1234, the assertion passed on a selection left over from
  // an earlier step while the pointer was not picking the army at all, so the
  // step sailed past its own hit-test proof and failed one line later at the
  // press. A test that can pass without doing its work is this project's
  // recurring failure mode, not a rare one.
  const clickAt = async () => {
    await page.eval(() => {
      const v = window.__game.__ui;
      if (v) v.selectedSquad = null;
    });
    await page.mouse('mouseMoved', at.x, at.y);
    await page.mouse('mousePressed', at.x, at.y);
    await page.mouse('mouseReleased', at.x, at.y);
    await page.sleep(250);
    return page.eval(() => window.__game.__ui?.selectedSquad ?? null);
  };
  let picked = await clickAt();
  if (picked !== camped.id) picked = await clickAt();
  if (picked !== camped.id) {
    // SAY WHAT IT SAW. "The hit-test does not reach it" is true and useless —
    // the two ways it happens look identical from here and want opposite
    // fixes: a SITE under the pointer means `tap` took the site branch and
    // never asked about squads, while no site and no squad means the squad
    // hit-test itself missed.
    throw new Error(`clicking the camped force at [${camped.q},${camped.r}] selected `
      + `${picked === null ? 'nothing' : `squad ${picked}`}. `
      + `${await whyNotFound(page, camped.id, at)}`);
  }

  // THE PANEL MUST NOT HAVE LANDED ON THE ARMY IT JUST SELECTED. This is the
  // regression guard for battle-status.js `squadAnchor`: before it, a camped
  // squad anchored the panel to `squad.to`, which is null, so `place` returned
  // early and the plate fell back to the stylesheet — often straight onto the
  // force. Asserted AFTER the click, because the click is what opens it; the
  // check before the click was measuring a board the click then changed.
  const clearNow = await page.eval((p) => {
    const el = document.elementFromPoint(p.x, p.y);
    return el ? `${el.tagName}.${el.className || '-'}` : 'nothing';
  }, at);
  if (!clearNow.startsWith('CANVAS')) {
    throw new Error(`selecting the camped force put ${clearNow} on top of it at `
      + `[${camped.q},${camped.r}] — the panel must anchor clear of the army it describes`);
  }

  // ...AND PROVE THE PRESS TOO, not only the click. The retry above guards
  // `tap`, and the drag's own `pointerdown` is a SECOND, independently flaky
  // hit-test that nothing was checking: observed once in CI, the click selected
  // the army and the drag that followed reported `SEND` — which is the exact
  // signature this step's header describes for a press that found nothing at
  // all, because `lastCommand` is still holding the march that set the step up.
  // `page.drag` is decomposed here so the press can be inspected before the
  // gesture is committed to; `view.dragFromSquad` is the one field that says
  // which of `onDown`'s four branches ran.
  await dragFromArmy(page, camped.id, at, onward.pt);
  await page.sleep(700);

  const after = await page.eval((id) => {
    const b = window.__game.state.battle;
    const n = (c) => Object.values(c).reduce((a, x) => a + x, 0);
    const src = b.squads.find((s) => s.id === id);
    return {
      last: window.__game.__ui?.lastCommand?.t ?? null,
      source: src ? { camped: src.camped, n: n(src.comp) } : null,
    };
  }, camped.id);

  // A drag off open ground used to start a BOX SELECT, so the tell for that
  // regression returning is the COMMAND issued, not the state that followed.
  if (after.last !== 'MOVE_SQUAD') {
    throw new Error(`drag off a camped force issued ${after.last}, not MOVE_SQUAD`);
  }
  // ...and the SPLIT, which the command name alone cannot prove: at the default
  // send strength the remainder must still be standing where it was.
  if (!after.source || !after.source.camped) {
    throw new Error('the half that was not ordered anywhere did not stay camped');
  }
  if (!(after.source.n < camped.n)) {
    throw new Error(`the camp still holds all ${camped.n} troops — nothing divided`);
  }
  step(`camped drag: ${camped.n} at [${camped.q},${camped.r}] -> `
    + `${after.source.n} held, ${camped.n - after.source.n} marched to [${next.q},${next.r}]`);
}

/**
 * A drag that starts on a camped army, with the PRESS asserted rather than
 * assumed. Mirrors `cdp.js drag` step for step; the only addition is reading
 * `view.dragFromSquad` between the press and the move, and starting over once
 * if `onDown` took some other branch.
 *
 * Releasing before the retry matters: a press left down would make the second
 * attempt a continuation of the first gesture rather than a new one, and a box
 * select already under way swallows it.
 */
async function dragFromArmy(page, squadId, from, to, steps = 12) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    // FLUSH ANY POINTER STILL DOWN BEFORE PRESSING. `onDown`'s FIRST branch
    // returns on `pointers.size === 2` and treats the gesture as a two-finger
    // pan, so one unbalanced press left behind by an earlier step makes every
    // later drag silently do nothing — no order, no rejection, no error. The
    // step already has a "start from a neutral pointer" rule for `rallyMode`
    // and this is the same rule for the pointer map itself.
    await page.mouse('mouseReleased', from.x, from.y, 'left', 0);
    await page.mouse('mouseMoved', from.x, from.y, 'none', 0);
    await page.mouse('mousePressed', from.x, from.y);
    const took = await page.eval(() => window.__game.__ui?.dragFromSquad ?? null);
    if (took !== squadId) {
      await page.mouse('mouseReleased', from.x, from.y);
      await page.eval(() => {
        const v = window.__game.__ui;
        if (v) { v.box = null; v.dragFrom = null; v.dragFromSquad = null; }
      });
      await page.sleep(150);
      if (attempt === 2) {
        // SAY WHAT IT SAW, the rule the click path already follows. The press
        // and the click run the SAME `squadAt`, so "the hit-test missed" is
        // never the whole story — ./smoke-campedwhy.mjs reports the two things
        // that separate the real causes: whether the CAMERA moved under the
        // step, and where the picker actually places the army against the
        // radius it is allowed.
        throw new Error(`pressing the camped force began ${took === null ? 'no squad drag' : `a drag off ${took}`}`
          + ' — the press found something other than the army the click just '
          + `selected. ${await whyNotFound(page, squadId, from)}`);
      }
      continue;
    }
    for (let i = 1; i <= steps; i++) {
      await page.mouse('mouseMoved',
        from.x + ((to.x - from.x) * i) / steps,
        from.y + ((to.y - from.y) * i) / steps, 'left', 1);
      await page.sleep(12);
    }
    await page.mouse('mouseReleased', to.x, to.y, 'left', 0);
    return;
  }
}
