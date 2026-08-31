// tools/smoke.mjs steps 1-4: a fresh save reaches a playable battle, the
// canvas is genuinely painted, the HUD controls are hittable, and the
// simulation runs with a working speed control.

/** Step 1. A fresh save must reach a playable battle. */
export async function runBoot(page, h, step, note, compositionSlots) {
  const boot = await h.scene();
  note(`fresh save boots to "${boot}"`);
  if (!await h.reach('battle')) throw new Error(`could not reach a battle from "${boot}"`);
  step('reached a battle from a fresh save');

  const battle = await page.eval(() => {
    const b = window.__game.state.battle;
    if (!b) return null;
    return {
      sites: b.sites.length,
      mine: b.sites.filter((s) => s.owner === 'player').length,
      theirs: b.sites.filter((s) => s.owner === 'enemy').length,
      comp: b.sites.find((s) => s.kind === 'camp')?.garrison || {},
    };
  });
  if (!battle) throw new Error('no battle state');
  if (battle.theirs <= battle.mine) {
    throw new Error(`enemy should start ahead: ${battle.mine} v ${battle.theirs}`);
  }
  // Measured in SLOTS, not bodies. Since units cost 1-8 slots each, a player who
  // spends a 19-slot budget on 3 rams and 4 militia fields 7 soldiers — a
  // headcount floor would call that legitimate army "too small".
  const bodies = Object.values(battle.comp).reduce((a, n) => a + n, 0);
  const slots = compositionSlots(battle.comp);
  if (slots < 12) throw new Error(`expedition too small: ${slots} slots (${bodies} bodies)`);
  step(`battle: ${battle.sites} sites (${battle.mine} mine, ${battle.theirs} enemy), `
    + `expedition ${slots} slots / ${bodies} bodies`);
}

/** Step 2. The canvas is painted. */
export async function runCanvas(page, step, OUT) {
  const painted = await page.eval(() => {
    const c = document.querySelector('#board-bg');
    if (!c?.width) return { ok: false };
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 499) {
      seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      if (seen.size > 8) break;
    }
    return { ok: seen.size > 3, colours: seen.size, w: c.width, h: c.height };
  });
  if (!painted.ok) throw new Error('battle canvas looks blank');
  step(`canvas painted: ${painted.colours}+ colours at ${painted.w}x${painted.h}`);
  await page.screenshot(`${OUT}/01-battle.png`);
}

/** Step 3. HUD controls are genuinely hittable.
 *
 * Located by their own class, NOT by which container they happen to sit in.
 * These read `.hud-dock .chip` and `.hud-dock .booster`, and when the chips
 * and boosters moved to the left rail both silently became "not present" and
 * this step went on reporting ok — the controls were no longer hit-tested by
 * anything. A selector that encodes the layout is a test that stops asserting
 * the moment the layout changes, which is the failure mode CLAUDE.md warns
 * about. `required` is the other half: absent now FAILS.
 */
export async function runHud(h, step, note) {
  for (const [sel, label, required] of [
    ['.seg', 'strength segment', true],
    ['.hud-dragmode', 'drag-mode toggle', true],
    ['.chip', 'unit filter chip', true],
    ['.booster', 'booster button', true],
  ]) {
    if (await h.has(sel)) await h.hitPoint(sel, label);
    else if (required) throw new Error(`${label} (${sel}) is missing from the HUD`);
    else note(`${label} not present`);
  }
  // ...AND BIG ENOUGH TO HIT, which nothing checked on a DESKTOP session.
  // `tools/mobile.mjs` enforces 44px, but only at phone metrics; the HUD's own
  // 44px rule used to live behind `@media (pointer: coarse)`, so a mouse got
  // 32px controls and the audit passed because it never looks at a mouse.
  // Measured before the fix: twelve control classes at 32px — the send
  // fraction, drag mode, pause, the speed slider, the troop chips, Withdraw and
  // all four build buttons — beside boosters that were correctly 44.
  //
  // ...AND EVERY ONE OF THEM, NOT THE FIRST OF EACH CLASS. `hitPoint` takes a
  // selector and `querySelector` answers with the FIRST match, so the loop
  // above proves booster #1 is reachable and says nothing about booster #5 —
  // which is exactly where the defect was. Measured at 1440x900: the top-right
  // HUD column is 641px tall against 657px of content, and the two scrolling
  // rails absorb the 16px shortfall by CLIPPING their last items with their
  // scrollbars hidden, so `tithe` was drawn, looked live, and passed its click
  // through to the canvas. At 1280x800 the shortfall is 100px and two boosters
  // were dead. A size check cannot see this: the button is a full 44px, it is
  // simply not where it appears to be.
  const bad = await h.page.eval((min) => {
    const small = []; const dead = [];
    for (const el of document.querySelectorAll('#hud button, #hud input')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      const name = `${el.className || el.tagName}`.split(' ')[0];
      if (r.height < min) small.push(`${name} ${Math.round(r.height)}px`);
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(x, y);
      if (!(hit === el || el.contains(hit) || hit?.contains(el))) {
        dead.push(`${name}("${el.textContent.trim().slice(0, 12)}")`);
      }
    }
    return { small: [...new Set(small)], dead: [...new Set(dead)] };
  }, 44);
  if (bad.small.length) {
    throw new Error(`${bad.small.length} HUD control(s) under 44px on a desktop session: `
      + bad.small.slice(0, 6).join(', '));
  }
  if (bad.dead.length) {
    throw new Error(`${bad.dead.length} HUD control(s) drawn but not clickable `
      + `(the click lands on something else): ${bad.dead.slice(0, 6).join(', ')}`);
  }
  step('HUD controls hittable, all >= 44px, and none clipped out of reach');
}

/** Step 4. The simulation runs, and speed actually changes it.
 *
 * Speed must scale the SIM but never the idle economy — paying idle income
 * per tick would make the speed control a money printer.
 */
export async function runSimSpeed(page, step) {
  const t0 = await page.eval(() => ({
    earned: window.__game.state.battle.factions.player.goldEarnedCg,
    tick: window.__game.state.battle.tick,
  }));
  await page.sleep(4000);
  const t1 = await page.eval(() => {
    const b = window.__game.state.battle;
    return { earned: b.factions.player.goldEarnedCg, tick: b.tick };
  });
  if (t1.tick - t0.tick < 25) throw new Error(`simulation stalled (${t0.tick}->${t1.tick})`);
  if (t1.earned <= t0.earned) throw new Error('farms are producing no gold');
  const base = t1.tick - t0.tick;
  step(`sim running: ${base} ticks/4s, earned ${t0.earned}->${t1.earned}cg`);

  const fast = await page.eval(async () => {
    const g = window.__game;
    const crowns0 = g.state.meta.crowns;
    const tick0 = g.state.battle.tick;
    g.loop.setSpeed(4);
    await new Promise((r) => setTimeout(r, 3000));
    const out = {
      ticks: g.state.battle.tick - tick0,
      crowns: g.state.meta.crowns - crowns0,
      speed: g.loop.speed,
    };
    g.loop.setSpeed(1);
    return out;
  });
  if (fast.speed !== 4) throw new Error('loop.setSpeed(4) did not take');
  if (fast.ticks < base * 1.5) {
    throw new Error(`4x did not speed the sim: ${fast.ticks} ticks/3s vs ${base}/4s at 1x`);
  }
  step(`speed control: ${fast.ticks} ticks/3s at 4x (vs ${base}/4s at 1x)`);
}
