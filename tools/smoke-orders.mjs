// tools/smoke.mjs steps 5-5c: real drag orders over the canvas — a send, a
// rally (both mouse buttons), and arming + placing a build.

/** Step 5. A real drag order over the canvas. */
export async function runDrag(page, step, OUT) {
  const drag = await page.eval(() => {
    const g = window.__game;
    const b = g.state.battle;
    const camp = b.sites.find((s) => s.kind === 'camp' && s.owner === 'player');
    // KNOWN, not merely present. Since fog hid unclaimed ground too, the first
    // adjacent non-player site is usually one the player cannot SEE — and a
    // drag onto an invisible building does not snap to it, it lands as a march
    // to that tile. The step still passed, because a squad was still in flight,
    // which is precisely the kind of test that stops asserting what it names.
    const seen = b.seen?.player ?? {};
    const target = b.sites.find((s) => camp.adj.includes(s.id) && s.owner !== 'player'
      && (s.owner === 'neutral' || s.owner === 'enemy') && seen[s.id] !== undefined)
      || b.sites.find((s) => camp.adj.includes(s.id) && s.id !== camp.id
        && s.owner === 'player');
    if (!g.__view || !camp) return null;
    // ...AND FAILING THAT, BARE GROUND — which is not a consolation prize, it
    // is the interaction the coach mark now teaches ("drag from your camp
    // across the map"), so the step asserts the shipped gesture either way.
    // It exists because the site branches above are a claim about a LIVE
    // battle ten seconds in and were observed to come up empty: measured, a
    // camp whose whole reach was one unseen neutral farm and one friendly
    // site. A step that cannot find its fixture is a step that stops
    // asserting, which is this project's signature test failure.
    const hexTarget = () => {
      const blocked = new Set(b.grid?.blocked ?? []);
      const occ = b.occupancy ?? {};
      const [cq, cr] = camp.hex;
      // Outward in rings, so the pick is the nearest legal tile rather than a
      // corner of the map — a long drag is a long march and the assertion
      // below only waits 900ms for a squad to exist.
      for (let rad = 2; rad <= 4; rad++) {
        for (let dq = -rad; dq <= rad; dq++) {
          for (let dr = Math.max(-rad, -dq - rad); dr <= Math.min(rad, -dq + rad); dr++) {
            if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) !== rad) continue;
            const q = cq + dq;
            const r = cr + dr;
            const kk = `${q},${r}`;
            if (blocked.has(kk) || occ[kk]) continue;
            const col = q + Math.floor(r / 2);
            if (r < 0 || r >= b.grid.rows || col < 0 || col >= b.grid.cols) continue;
            return { q, r };
          }
        }
      }
      return null;
    };
    const a = g.__view.siteScreen(camp, {});
    if (target) {
      const z = g.__view.siteScreen(target, {});
      return {
        from: { x: Math.round(a.x), y: Math.round(a.y) },
        to: { x: Math.round(z.x), y: Math.round(z.y) },
        fromId: camp.id, toId: target.id,
      };
    }
    const hx = hexTarget();
    if (!hx) return null;
    // `siteScreen` only ever reads `.hex`, so a bare hex projects through the
    // same camera the sites do rather than through a second copy of it.
    const z = g.__view.siteScreen({ hex: [hx.q, hx.r] }, {});
    return {
      from: { x: Math.round(a.x), y: Math.round(a.y) },
      to: { x: Math.round(z.x), y: Math.round(z.y) },
      fromId: camp.id, toId: `hex ${hx.q},${hx.r}`,
    };
  });
  if (!drag) throw new Error('could not locate a drag source and target');
  await page.drag(drag.from, drag.to);
  await page.sleep(900);
  const sent = await page.eval(() => window.__game.state.battle.squads
    .filter((s) => s.owner === 'player').length);
  if (!sent) throw new Error('a real drag produced no squad');
  step(`drag ${drag.fromId} -> ${drag.toId}: ${sent} squad(s) in flight`);
  await page.screenshot(`${OUT}/02-squads.png`);
}

/** Step 5b (and 5b(ii)). A real RIGHT drag sets a rally, and the same rally
 * works with a LEFT drag once rally mode is armed.
 *
 * This is the gesture a player reaches for first, and it used to fire on
 * pointerdown at the press point — so pressing the source and dragging to the
 * target resolved to target===source, which CLEARS a rally. It has to be
 * driven with real right-button events or the regression comes straight back.
 */
export async function runRally(page, h, step, note) {
  const rally = await page.eval(() => {
    const g = window.__game;
    const b = g.state.battle;
    // The target need not be yours — a rally into enemy ground is a legal
    // standing attack order — it only has to be adjacent.
    // Same rule as the send above: a rally can only be dragged onto a site the
    // player's board actually shows, so the target has to be one `siteKnown`
    // would admit. Everything the player holds qualifies by definition.
    const seen = b.seen?.player ?? {};
    const known = (s) => s.owner === 'player' || seen[s.id] !== undefined;
    const from = b.sites.find((s) => s.owner === 'player' && s.adj.length > 0
      && b.sites.some((t) => from0(s, t) && known(t)));
    function from0(s, t) { return s.adj.includes(t.id) && t.id !== s.id; }
    const to = from && b.sites.find((s) => from0(from, s) && known(s));
    if (!from || !to) return null;
    from.rallyTargets = [];
    const a = g.__view.siteScreen(from, {});
    const z = g.__view.siteScreen(to, {});
    return {
      from: { x: Math.round(a.x), y: Math.round(a.y) },
      to: { x: Math.round(z.x), y: Math.round(z.y) },
      fromId: from.id, toId: to.id,
    };
  });
  if (!rally) { note('no adjacent friendly pair to rally between'); return; }

  await page.drag(rally.from, rally.to, 12, 'right');
  await page.sleep(600);
  const got = await page.eval((id) => window.__game.state.battle.sites
    .find((s) => s.id === id)?.rallyTargets ?? [], rally.fromId);
  if (!got.includes(rally.toId)) {
    throw new Error(`right-drag ${rally.fromId} -> ${rally.toId} set rallyTargets=${got}`);
  }
  step(`right-drag rally: ${rally.fromId} -> ${rally.toId}`);

  // ---- 5b(ii). the SAME rally with the LEFT button, via the mode ---------
  // The reason the mode exists: a right-drag does not exist on a touchscreen
  // and a trackpad will not reliably report button 2 mid-drag, so on both of
  // the devices this is played on the rally drag was unreachable. Asserting
  // it with a real left drag is the only way to know the mode is wired to the
  // gesture and not merely to a CSS class.
  // The source must be a site the PLAYER holds — a rally is a standing order
  // issued by a garrison — so the drag runs from the same source as above, to
  // a second neighbour. Reversing it would have started on neutral ground and
  // legitimately done nothing.
  await h.click('.hud-dragmode[data-mode="rally"]', 'rally mode');
  const modeOn = await page.eval(() => !!window.__game.__ui?.rallyMode);
  if (!modeOn) throw new Error('rally mode button did not set view.rallyMode');

  const second = await page.eval((fromId, takenId) => {
    const g = window.__game;
    const b = g.state.battle;
    const from = b.sites.find((s) => s.id === fromId);
    // Known, for the same reason the two steps above are: an invisible site
    // cannot be dragged onto, so aiming at one tests the fog and not the mode.
    const seen = b.seen?.player ?? {};
    const to = from && b.sites.find((s) => from.adj.includes(s.id) && s.id !== takenId
      && s.id !== from.id && (s.owner === 'player' || seen[s.id] !== undefined));
    if (!to) return null;
    const z = g.__view.siteScreen(to, {});
    return { to: { x: Math.round(z.x), y: Math.round(z.y) }, toId: to.id };
  }, rally.fromId, rally.toId);

  if (!second) note('no second neighbour to rally at');
  else {
    // ISOLATE THE SOURCE FIRST. The rally set in the step above is a STANDING
    // ORDER and it fires on its own schedule, so counting squads leaving the
    // camp measures that rally, not this drag — the assertion below passed or
    // failed on timing alone. Clearing the targets and parking the hold-back
    // above the garrison means nothing can leave this site except because of
    // the gesture under test.
    const before = await page.eval((id) => {
      const s = window.__game.state.battle.sites.find((x) => x.id === id);
      s.rallyTargets = [];
      s.rallyKeep = 999;
      return window.__game.state.battle.squads.filter((q) => q.from === id).length;
    }, rally.fromId);
    await page.drag(rally.from, second.to, 12);       // LEFT button
    await page.sleep(600);
    const got2 = await page.eval((id) => window.__game.state.battle.sites
      .find((s) => s.id === id)?.rallyTargets ?? [], rally.fromId);
    if (!got2.includes(second.toId)) {
      throw new Error(`left-drag in rally mode ${rally.fromId} -> ${second.toId} `
        + `set rallyTargets=${got2} — the mode is not reaching the gesture`);
    }
    // And it must NOT have sent troops. A mode that quietly launches an
    // attack instead of setting a standing order is the worst thing it could
    // do, and it is exactly what happens if `rallyMode` is only wired to CSS.
    const after = await page.eval((id) => window.__game.state.battle.squads
      .filter((q) => q.from === id).length, rally.fromId);
    if (after > before) throw new Error(`rally mode also launched ${after - before} squad(s)`);
    step(`left-drag rally via mode: ${rally.fromId} -> ${second.toId}, no squads sent`);
  }

  await h.click('.hud-dragmode[data-mode="send"]', 'send mode');

  // A chained drag used to be tested here — one gesture routing THROUGH a
  // waypoint. Free movement deleted the mechanism: a send is legal wherever a
  // path exists, so a drag is just "picked up here, released there" and the
  // pathfinder covers the ground in between on its own. Nothing left to drive.
}

/** Step 5c. Building mid-battle: arm, click a hex, a site appears.
 *
 * Arming is a HUD control like any other and goes through h.click(selector);
 * the SECOND click lands on bare ground, not a DOM element, so it is driven
 * at a raw canvas point the way the drag/rally steps above are. The target
 * hex comes from the REAL buildBlocker — dynamically imported inside the
 * page, against the REAL live state, the same module the running game
 * already loaded — rather than a guess, so this step cannot pass by aiming
 * at a hex that merely looks legal.
 */
export async function runBuild(page, h, step) {
  const camp = await page.eval(() => {
    const g = window.__game;
    const b = g.state.battle;
    b.factions.player.goldCg = 1_000_000;   // affordability is not what this tests
    const c = b.sites.find((s) => s.kind === 'camp' && s.owner === 'player');
    if (!c) return null;
    const at = g.__view.siteScreen(c, {});
    return { x: Math.round(at.x), y: Math.round(at.y) };
  });
  if (!camp) throw new Error('no player camp to build from');

  await h.clickAt(camp.x, camp.y);                // select a player site, opens the panel
  await h.click('.hud-build-farm', 'the Build Farm action');
  const armed = await page.eval(() => window.__game.__ui?.armedBuild ?? null);
  if (armed !== 'farm') throw new Error(`Build Farm did not arm: armedBuild=${armed}`);

  // THE HEX IS CHOSEN AFTER THE PANEL IS OPEN, and that ordering is the fix for
  // a flake this step shipped with. It used to pick the legal hex FARTHEST from
  // the camp — reasoned as "far enough that the click cannot land on the site
  // panel" — and on a map whose camp sits in a corner, farthest is the opposite
  // corner: sometimes off-screen, sometimes under the HUD, sometimes under the
  // panel that had not opened yet when the choice was made. It failed on one
  // generated map and passed on the next with no code change between, which is
  // the worst kind of red.
  //
  // `document.elementFromPoint` is the honest question and this file already
  // answers it everywhere else — a release once shipped completely unclickable
  // because a synthetic `el.click()` bypassed hit testing. So: farthest legal
  // hex WHOSE POINT ACTUALLY REACHES THE BOARD, asked of the layout as it will
  // be at the moment of the click.
  const build = await page.eval(async () => {
    const { buildBlocker } = await import('/src/battle/commands.js');
    const { axialFromOffset, distance } = await import('/src/core/hex.js');
    const { hexCx, hexCy } = await import('/src/render/hexGeom.js');
    const g = window.__game;
    const b = g.state.battle;
    const c = b.sites.find((s) => s.kind === 'camp' && s.owner === 'player');
    const home = { q: c.hex[0], r: c.hex[1] };
    let best = null;
    let bestD = -1;
    for (let r = 0; r < b.grid.rows; r++) {
      for (let col = 0; col < b.grid.cols; col++) {
        const hex = axialFromOffset(col, r);
        if (buildBlocker(b, 'player', hex)) continue;
        const pt = g.__view.camera.worldToScreen(
          hexCx(hex.q, hex.r, g.__view.hexSize), hexCy(hex.q, hex.r, g.__view.hexSize), {},
        );
        const x = Math.round(pt.x);
        const y = Math.round(pt.y);
        const el = document.elementFromPoint(x, y);
        if (!el || el.tagName !== 'CANVAS') continue;
        const d = distance(home, hex);
        if (d > bestD) { bestD = d; best = { q: hex.q, r: hex.r, x, y }; }
      }
    }
    return best;
  });
  if (!build) throw new Error('no legal build hex on this map reaches the board — nothing to click');

  await h.clickAt(build.x, build.y);              // the second click: a hex, not a site
  await page.sleep(500);
  const built = await page.eval((q, r) => window.__game.state.battle.sites
    .find((s) => s.hex[0] === q && s.hex[1] === r) ?? null, build.q, build.r);
  if (!built || !(built.buildTicksLeft > 0)) {
    throw new Error(`build did not land at [${build.q},${build.r}]: ${JSON.stringify(built)}`);
  }
  const stillArmed = await page.eval(() => window.__game.__ui?.armedBuild ?? null);
  if (stillArmed) throw new Error(`armedBuild=${stillArmed} after firing — it must self-clear`);
  step(`build: armed Farm, clicked [${build.q},${build.r}], buildTicksLeft=${built.buildTicksLeft}`);
}
