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
  step('HUD controls hittable');
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
