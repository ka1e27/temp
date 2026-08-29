// WHY DID THE CAMPED-DRAG STEP NOT FIND THE ARMY?
//
// Split out of ./smoke-camped.mjs at the 400-line cap, along a seam that was
// worth having anyway: that file drives the GESTURE, this one explains a
// failure. The click path and the press path had grown near-identical copies of
// the same forensics, which is two implementations of "what did the pointer
// actually see" — the shape of bug this project keeps finding in its own code.
//
// "The hit-test missed" is true and useless. Every field below exists because
// it separates two failures that look identical from outside and want opposite
// fixes.

/**
 * Everything known about a point that should have found `squadId` and did not.
 *
 * @param {object} page tools/cdp.js
 * @param {number|string} squadId the army the step is aiming at
 * @param {{x:number,y:number}} at the screen point it pressed
 * @returns {Promise<string>} a one-line report for a thrown Error
 */
export async function whyNotFound(page, squadId, at) {
  const w = await page.eval(async ([id, px, py]) => {
    const { loadStops, routeAt } = await import('/src/render/routePath.js');
    const { squadProgress, squadBow } = await import('/src/render/routes.js');
    const { perceivedSquads } = await import('/src/battle/vision.js');
    const g = window.__game;
    const st = g.state.battle;
    const sq = st.squads.find((x) => x.id === id);
    const wp = g.__view.toWorld(px, py, {});
    const hx = sq && (Array.isArray(sq.hex) ? { q: sq.hex[0], r: sq.hex[1] } : sq.hex);
    const end = sq?.path?.[sq.path.length - 1];
    // WHERE THE PICKER PUTS IT, through the very functions battle-squadpick.js
    // calls. A squad is hit-tested along its DRAWN route, not at its hex, so
    // this is the only number that can say the two have come apart.
    const pick = sq ? (() => {
      const geo = { byId: () => null, pos: () => null,
        hexPos: (q, r, o) => g.__view.hexPos(q, r, o) };
      const stops = loadStops(sq, geo);
      if (!stops) return { err: 'no-stops' };
      const p = { x: 0, y: 0 };
      const f = squadProgress(sq, st.tick);
      routeAt(sq, stops, f, squadBow(sq), p, null);
      return { x: p.x, y: p.y, f, miss: Math.hypot(wp.x - p.x, wp.y - p.y) };
    })() : null;
    const now = hx ? g.__view.siteScreen({ hex: [hx.q, hx.r] }, {}) : null;
    return {
      onBoard: !!sq,
      // THE LAST GATE IN `squadAt`, and the only one left once the geometry
      // checks out: it scans `perceivedSquads`, not `state.squads`. Your own
      // army should never be filtered out of your own view — if it is, the
      // picker is innocent and fog is the bug.
      perceived: perceivedSquads(st, 'player').some((x) => x.id === id),
      perceivedN: perceivedSquads(st, 'player').length,
      squadsN: st.squads.length,
      camped: !!sq?.camped,
      // THE REAL PICKER, through `__ord`. NOT `board.squadAt`, which does not
      // exist — an earlier version of this probe called that and reported
      // `squadAt->null` for every failure: a probe measuring nothing, reading
      // like a smoking gun, and it cost several runs.
      picks: g.__ord?.squadAt?.(st, wp.x, wp.y)?.id ?? null,
      // ...and the same question one layer up, which is what `onDown` asks.
      picksOwn: (() => { const p2 = g.__ord?.squadAt?.(st, wp.x, wp.y);
        return p2 && p2.owner === 'player' ? p2.id : null; })(),
      pickerReachable: typeof g.__ord?.squadAt === 'function',
      // WHAT THE BROWSER WOULD ACTUALLY DELIVER THE PRESS TO. The step checks
      // this before it clicks — but the CLICK opens the site panel, and a panel
      // that lands over the army swallows every press after it. `#screen-root`
      // is pointer-events:none and only the plates opt back in, so this reads
      // CANVAS when the board is clear and a plate's class when it is not.
      hits: (() => { const el = document.elementFromPoint(px, py);
        return el ? `${el.tagName}.${el.className || '-'}` : 'nothing'; })(),
      selected: g.__ui?.selectedSquad ?? null,
      siteNear: g.__view.siteAt(st, wp.x, wp.y)?.id ?? null,
      siteOn: g.__view.siteAt(st, wp.x, wp.y, 1)?.id ?? null,
      fights: st.sites.filter((x) => x.melee).length,
      armed: `${g.__ui?.armedBuild ?? '-'}/${g.__ui?.armedBooster ?? '-'}`
        + `/rally:${!!g.__ui?.rallyMode}`,
      hex: hx ? `${hx.q},${hx.r}` : null,
      pathEnd: end ? `${end.q},${end.r}` : null,
      pathLen: sq?.path?.length ?? null,
      // A camera that moved under the step makes every stored screen point
      // stale, and no amount of picker archaeology would ever explain it.
      moved: now ? Math.hypot(now.x - px, now.y - py) : null,
      radius: g.__view.hexSize * 0.5,
      pick,
    };
  }, [squadId, at.x, at.y]);

  const pick = w.pick && !w.pick.err
    ? `puts it at ${w.pick.x.toFixed(1)},${w.pick.y.toFixed(1)} `
      + `(f=${w.pick.f.toFixed(2)}, ${w.pick.miss.toFixed(1)}px off, radius ${w.radius.toFixed(1)})`
    : `puts it ${w.pick?.err ?? 'nowhere'}`;
  return `onBoard=${w.onBoard} camped=${w.camped} perceivedByOwner=${w.perceived} `
    + `(${w.perceivedN} of ${w.squadsN} squads perceived) `
    + `REAL squadAt->${w.pickerReachable ? w.picks : 'UNREACHABLE'} `
    + `ownSquadAt->${w.picksOwn} pressLandsOn=${w.hits} `
    + `selected=${w.selected} siteNear=${w.siteNear} siteOn=${w.siteOn} `
    + `fights=${w.fights} armed=${w.armed} hex=${w.hex} pathEnd=${w.pathEnd} `
    + `pathLen=${w.pathLen} cameraMoved=${w.moved?.toFixed(1)}px — the picker ${pick}`;
}
