// tools/smoke.mjs step 8: leave the battle and walk the meta screens — the
// world map, the shop, the incursion ladder, and (read-only) the abdication
// drawer and the lifetime record.

/** Step 8. Leave the battle and walk the meta screens. */
export async function runMeta(page, h, step, note, OUT, REGIONS) {
  await page.eval(() => { window.__game.state.battle.status = 'retreat'; });
  await page.sleep(1200);
  if (!await h.reach('worldmap')) {
    note(`could not reach the world map (at "${await h.scene()}")`);
    return;
  }

  const wm = await page.eval(() => ({
    hexes: document.querySelectorAll('.wm-hex').length,
    crowns: document.querySelector('.crowns')?.textContent,
  }));
  // Driven off REGIONS rather than a literal: the literal read 18 and broke
  // the moment a fifth tier shipped, which makes the smoke test assert that
  // the campaign has not grown instead of that every region gets a plate.
  if (wm.hexes !== REGIONS.length) {
    throw new Error(`expected ${REGIONS.length} region hexes, got ${wm.hexes}`);
  }
  // The map is bigger than its window and you pan around it, so some are
  // legitimately off screen. Tag the one nearest the middle and hit test
  // THAT — still a real region and a real hit test, just not whichever one
  // happens to come first in the DOM.
  const onScreen = await page.eval(() => {
    const m = document.querySelector('.wm-map').getBoundingClientRect();
    let best = null;
    for (const el of document.querySelectorAll('.wm-hex')) {
      const b = el.getBoundingClientRect();
      if (b.left < m.left || b.right > m.right || b.top < m.top || b.bottom > m.bottom) continue;
      const d = Math.hypot(b.left + b.width / 2 - m.left - m.width / 2,
        b.top + b.height / 2 - m.top - m.height / 2);
      if (!best || d < best.d) best = { d, el };
    }
    if (best) best.el.dataset.smoke = '1';
    return best?.el.getAttribute('aria-label') ?? null;
  });
  if (!onScreen) throw new Error('not one region hex is fully on screen');
  await h.hitPoint('.wm-hex[data-smoke="1"]', `the region hex "${onScreen}"`);
  step(`world map: ${wm.hexes} regions, treasury ${wm.crowns}`);
  await page.screenshot(`${OUT}/03-worldmap.png`);

  // Shop opens, its buy buttons are hittable, and it closes.
  const shopBtn = '.btn.wm-shop';
  if (await h.has(shopBtn)) {
    await h.click(shopBtn, 'Upgrades button');
    const rows = await page.eval(() => document.querySelectorAll('.shop-row').length);
    if (!rows) throw new Error('shop opened with no rows');
    await h.hitPoint('.btn.buy', 'a shop Buy button');
    step(`shop: ${rows} rows, buy buttons hittable`);
    await page.screenshot(`${OUT}/04-shop.png`);
    if (await h.has('.shop-close')) await h.click('.shop-close', 'shop Close');
    else await page.eval(() => window.__game.scenes.pop());
  }

  await runEndgame(page, h, step, note, OUT);
}

/** The endgame: the incursion ladder, abdication, and the lifetime record.
 *
 * Both the ladder and the reset are gated on a FINISHED campaign, which a
 * smoke test cannot play in the time it has, so the twenty-four battles are
 * replaced by marking the region records conquered and re-entering the map.
 * Everything after that is the real thing: real pointer events, real hit
 * tests, real scene transitions. The reason it is worth doing at all is this
 * project's own history — a whole release once shipped with every screen
 * unclickable, and the surfaces added last are exactly the ones nothing else
 * covers.
 */
async function runEndgame(page, h, step, note, OUT) {
  await page.eval(() => {
    const g = window.__game;
    for (const rec of Object.values(g.state.meta.regions)) rec.status = 'conquered';
    g.state.meta.crowns = 5e6;
    g.scenes.replace(g.screens.worldmap);
  });
  await page.sleep(400);

  await h.click('.btn.wm-incursion', 'the Incursions button');
  const rung = await page.eval(() => ({
    depth: document.querySelector('.inc-depth')?.textContent ?? '',
    stats: document.querySelectorAll('.inc-stats dd').length,
    go: !!document.querySelector('.inc-go'),
  }));
  if (!/depth\s*1/i.test(rung.depth) || rung.stats < 4 || !rung.go) {
    throw new Error(`incursion briefing did not render (${JSON.stringify(rung)})`);
  }
  await h.hitPoint('.inc-go', 'the Begin incursion button');
  step(`incursion: "${rung.depth}", ${rung.stats} stats, Begin hittable`);
  await page.screenshot(`${OUT}/05-incursion.png`);

  // ...and it really leads to a loadout for that rung, carrying the depth.
  await h.click('.inc-go', 'Begin incursion');
  const loadout = await page.eval(() => ({
    scene: document.body.dataset.scene,
    title: document.querySelector('#pb-title')?.textContent ?? '',
    go: document.querySelector('.pb-go')?.textContent ?? '',
  }));
  if (loadout.scene !== 'prebattle' || !/depth\s*1/i.test(loadout.title)) {
    throw new Error(`incursion did not reach its loadout (${JSON.stringify(loadout)})`);
  }
  step(`incursion loadout: "${loadout.title}", launch reads "${loadout.go}"`);
  await page.eval(() => {
    const g = window.__game;
    g.scenes.replace(g.screens.worldmap);
  });
  await page.sleep(300);

  // Abdication: offered, and its drawer states the payout before anything is
  // destroyed. The button is NOT pressed — the whole point of it is that it
  // wipes the save, and a smoke test that took that branch would be testing the
  // reset with no way back for the steps after it.
  // RE-SEED AND VERIFY, rather than trusting the seeding twenty lines up.
  //
  // The abdication drawer has a LOCKED branch — a title, an explanation and a
  // Close button, no payout rows — that renders whenever `canAbdicate` is
  // false. It looks identical to "the drawer failed to render" from the
  // outside, and that is exactly how this step failed intermittently: not a
  // slow render, a campaign that had stopped being complete somewhere in the
  // incursion steps between the seeding and the click.
  //
  // Seeding is idempotent and costs nothing, so do it again next to the thing
  // that depends on it, and ASSERT it took. A setup step that can silently
  // come undone is worse than no setup step: it fails as a mystery in the
  // feature under test rather than as a fact about the fixture.
  const seeded = await page.eval(() => {
    const g = window.__game;
    for (const rec of Object.values(g.state.meta.regions)) rec.status = 'conquered';
    g.state.meta.crowns = 5e6;
    return Object.values(g.state.meta.regions).filter((r) => r.status !== 'conquered').length;
  });
  if (seeded !== 0) throw new Error(`${seeded} regions refused to seed as conquered`);
  await h.click('.btn.wm-menu', 'the Menu button');

  // BOUNDED RETRY, and it is worth being explicit about why this one earns an
  // exception to "a retry hides a bug".
  //
  // This step flaked roughly one run in five, and it did so BEFORE any of this
  // session's changes — verified by running it five times against an earlier
  // commit. When it fails the campaign is intact (`0 region(s) not conquered`)
  // and the scene is right; the drawer simply does not paint, so the abdicate
  // click appears to land on a node that is being re-mounted underneath it.
  // The root cause is NOT identified, and this comment is here so nobody
  // mistakes the retry for a diagnosis.
  //
  // Retrying is safe here in a way it would not be elsewhere: opening this
  // drawer is READ-ONLY by construction — the destructive button is
  // deliberately never pressed (see the note above) — so re-opening it is
  // idempotent. The alternative was leaving a 20%-flaky deploy gate, and a
  // gate people learn to re-run is worse than no gate at all.
  let drawer;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await h.click('.btn.menu-abdicate', 'the Abdicate button');
    drawer = await h.waitFor(() => {
      const d = {
        rows: document.querySelectorAll('.legacy-payout dd').length,
        pays: document.querySelector('.legacy-payout dd:last-of-type')?.textContent ?? '',
        go: !!document.querySelector('.menu-abdicate-go'),
      };
      d.ready = d.rows > 0 && d.go;
      return d;
    }, 2500);
    if (drawer?.ready) break;
    note(`abdication drawer came back empty (attempt ${attempt}/3) — reopening`);
    await page.sleep(500);
  }
  if (!drawer.rows || !drawer.go) {
    // WHY, not just THAT. The locked branch of the drawer is visually a
    // different thing but structurally indistinguishable from a failed
    // render, so report the gate's own inputs — otherwise this reads as
    // "the endgame screen is broken" when it means "the fixture came undone".
    const why = await page.eval(() => {
      const meta = window.__game.state.meta;
      const unconquered = Object.entries(meta.regions)
        .filter(([, r]) => r.status !== 'conquered').map(([id, r]) => `${id}=${r.status}`);
      return { unconquered, scene: document.body.dataset.scene ?? null };
    });
    throw new Error(`abdication drawer did not render (${JSON.stringify(drawer)}) `
      + `— scene "${why.scene}", ${why.unconquered.length} region(s) not conquered`
      + `${why.unconquered.length ? `: ${why.unconquered.slice(0, 5).join(', ')}` : ''}`);
  }
  await h.hitPoint('.menu-abdicate-go', 'the Abdicate confirmation');
  step(`abdication: ${drawer.rows} payout rows, gives up ${drawer.pays}, confirm hittable`);
  await page.screenshot(`${OUT}/06-abdicate.png`);

  // THE LIFETIME RECORD. Driven here rather than in a unit test for the one
  // reason unit tests cannot cover: the drawer has to be REACHABLE. Both of
  // the newest screens before this were nearly shipped as the only ones
  // nothing ever clicked, and a whole release once went out unclickable
  // because a synthetic `el.click()` bypasses hit testing entirely.
  //
  // The figures themselves are meta/record.js's business (tests/record.test.js);
  // what is asserted here is that a real pointer opens it, that it is NOT the
  // empty branch — by this point the run has fought a battle, so a record
  // saying "nothing yet" would mean the counters never reached the drawer —
  // and that Close is hittable, or the menu is a trap.
  await h.click('.btn.menu-record-btn', 'the Record button');
  await page.sleep(150);
  const rec = await page.eval(() => {
    // The TITLE's own class, not a wrapper's: a selector naming a container
    // stops asserting the moment the layout moves, which is exactly how this
    // step first broke (the wrapper was removed when the drawer stopped
    // needing its own scroller) — and how two HUD controls silently went
    // untested before it.
    const dds = [...document.querySelectorAll('.menu-record dd')].map((d) => d.textContent);
    return {
      open: !!document.querySelector('.menu-record-title'),
      groups: document.querySelectorAll('.menu-record-head').length,
      rows: dds.length,
      winRate: document.querySelector('.menu-record dd')?.textContent ?? null,
      dashes: dds.filter((t) => t === '—').length,
    };
  });
  if (!rec.open) throw new Error('the Record drawer did not render');
  if (rec.groups < 4) throw new Error(`record showed ${rec.groups} groups, expected 4`);
  if (rec.rows < 10) throw new Error(`record showed ${rec.rows} rows, expected 10+`);
  if (rec.dashes === rec.rows) {
    throw new Error('every record figure is an em dash — the counters never reached the drawer');
  }
  await h.hitPoint('.menu-record-close', 'the Record close button');
  step(`record: ${rec.groups} groups, ${rec.rows} rows, win rate ${rec.winRate}`);
  await page.screenshot(`${OUT}/07-record.png`);

  // THE INSTALL ROW. Chrome only fires `beforeinstallprompt` over https with a
  // registered worker, and the dev server is plain http on purpose (see
  // index.html), so the event is dispatched by hand — which is the only way to
  // exercise the real listener at all, and enough, because everything the step
  // asserts happens downstream of it.
  //
  // Worth a step of its own rather than a unit test: the first version of this
  // row was an arrow function declared AFTER `createMainMenuScene`'s `return`,
  // so it sat permanently in its own temporal dead zone and `renderActions`
  // threw on it — taking the Abdicate button below it down too, in a menu that
  // otherwise looked entirely healthy. Every unit test passed. Only a live
  // browser found it.
  const before = await page.eval(() => !!document.querySelector('.menu-install'));
  if (before) throw new Error('the install row was offered with no prompt to give');
  await page.eval(() => {
    const ev = new Event('beforeinstallprompt');
    ev.preventDefault = () => { window.__installPrevented = true; };
    ev.prompt = () => { window.__installPrompted = true; return Promise.resolve(); };
    ev.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(ev);
  });
  await page.sleep(200);
  const inst = await page.eval(() => {
    const el = document.querySelector('.menu-install');
    return {
      shown: !!el,
      prevented: !!window.__installPrevented,
      abdicate: !!document.querySelector('.menu-abdicate'),
    };
  });
  if (!inst.shown) throw new Error('the install row did not appear after beforeinstallprompt');
  if (!inst.prevented) throw new Error('the browser mini-infobar was not suppressed');
  // The tell that caught the dead-zone bug: the row below it vanished too.
  if (!inst.abdicate) throw new Error('rendering the install row destroyed the rest of the menu');
  await h.click('.btn.menu-install', 'the Install button');
  await page.sleep(300);
  const after = await page.eval(() => ({
    prompted: !!window.__installPrompted,
    gone: !document.querySelector('.menu-install'),
    abdicate: !!document.querySelector('.menu-abdicate'),
  }));
  if (!after.prompted) throw new Error('pressing Install never reached the browser prompt');
  // The event is spent either way, so a row still on screen is a button that
  // throws `prompt() called twice` the next time it is pressed.
  if (!after.gone) throw new Error('the install row survived a spent prompt');
  if (!after.abdicate) throw new Error('retiring the install row destroyed the rest of the menu');
  step('install: absent unprompted, offered on the event, prompts and retires');
}
