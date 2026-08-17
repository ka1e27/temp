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
function findTile(board, cq, cr, min, max) {
  const taken = new Set([...board.blocked, ...board.occupied]);
  for (let d = min; d <= max; d++) {
    for (const [dq, dr] of [[d, 0], [0, d], [d, -1], [1, d], [-d, 0], [0, -d], [d, -2], [-1, d]]) {
      const q = cq + dq;
      const r = cr + dr;
      const col = q + Math.floor(r / 2);
      if (r < 0 || r >= board.rows || col < 0 || col >= board.cols) continue;
      if (taken.has(`${q},${r}`)) continue;
      return { q, r };
    }
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
  const board = await readBoard(page);
  const campPt = await siteHexPoint(page);
  if (!board.camp || !campPt) { note('no player camp to march from'); return; }

  const tile = findTile(board, board.camp[0], board.camp[1], 3, 5);
  if (!tile) { note('no bare tile within reach of the camp'); return; }
  await page.drag(campPt, await hexPoint(page, tile.q, tile.r));

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
  const next = findTile(board2, camped.q, camped.r, 2, 3);
  if (!next) { note('camped force had no second tile to march to'); return; }

  const at = await hexPoint(page, camped.q, camped.r);

  // FIRST PROVE THE HIT-TEST, because the drag alone cannot tell two very
  // different failures apart: a press that finds the army and issues the wrong
  // order, and a press that never finds it at all and quietly starts a box
  // select. The second leaves `lastCommand` holding the SEND from the march
  // above, so the drag assertion below reports "issued SEND" for a gesture that
  // issued nothing. A plain click is the same `squadAt` the drag uses.
  await page.mouse('mouseMoved', at.x, at.y);
  await page.mouse('mousePressed', at.x, at.y);
  await page.mouse('mouseReleased', at.x, at.y);
  await page.sleep(250);
  const picked = await page.eval(() => window.__game.__ui?.selectedSquad ?? null);
  if (picked !== camped.id) {
    throw new Error(`clicking the camped force at [${camped.q},${camped.r}] selected `
      + `${picked === null ? 'nothing' : `squad ${picked}`} — the hit-test does not reach it`);
  }

  await page.drag(at, await hexPoint(page, next.q, next.r));
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
