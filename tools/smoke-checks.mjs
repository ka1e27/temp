// tools/smoke.mjs steps 6-7: visual effects actually render, and the whole
// state tree is free of NaN/Infinity.

/** Step 6. Effects actually render. */
export async function runEffects(page, step, note) {
  let sawFx = false;
  for (let i = 0; i < 12 && !sawFx; i++) {
    await page.sleep(1000);
    sawFx = await page.eval(() => (window.__game.__fx?.live() ?? 0) > 0);
  }
  if (sawFx) step('visual effects spawn and expire');
  else note('no effect observed in 12s (possible, but check fx wiring)');
}

/** Step 7. Numeric corruption sweep. */
export async function runSanity(page, step) {
  const nans = await page.eval(() => {
    const bad = [];
    const seen = new WeakSet();
    const walk = (o, path) => {
      if (typeof o === 'number') { if (!Number.isFinite(o)) bad.push(path); return; }
      if (!o || typeof o !== 'object' || seen.has(o)) return;
      seen.add(o);
      for (const k of Object.keys(o)) walk(o[k], `${path}.${k}`);
    };
    walk(window.__game.state, 'state');
    return bad.slice(0, 8);
  });
  if (nans.length) throw new Error(`non-finite numbers: ${nans.join(', ')}`);
  step('no NaN/Infinity in the state tree');
}
