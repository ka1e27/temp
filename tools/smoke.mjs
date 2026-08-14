// Browser smoke test — boots the real game and walks the whole loop.
//
// EVERY interaction goes through real pointer events at real screen
// coordinates, and every click first asserts that the browser's own hit test
// actually lands on the target. A synthetic `el.click()` bypasses hit testing
// entirely, which is exactly how a completely unclickable UI once passed this
// suite green: `#screen-root` was pointer-events:none and no scene opted back
// in, so every button was dead while looking perfectly fine.
//
//   node tools/serve.js &     # or npm start
//   node tools/smoke.mjs
//
// Split across tools/smoke-*.mjs purely for the 400-line cap — this file is
// the entry point CI invokes and stays that, and it runs every phase in
// exactly the order it always did. Each phase file owns the steps its own
// comments describe; nothing here re-implements them.
import { mkdir } from 'node:fs/promises';
import { launch } from './cdp.js';
import { compositionSlots } from '../src/meta/composition.js';
import { REGIONS } from '../src/content/regions.data.js';
import { makeHelpers } from './smoke-helpers.mjs';
import { runBoot, runCanvas, runHud, runSimSpeed } from './smoke-battle.mjs';
import { runDrag, runRally, runBuild } from './smoke-orders.mjs';
import { runEffects, runSanity } from './smoke-checks.mjs';
import { runMeta } from './smoke-meta.mjs';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = 'screenshots';
await mkdir(OUT, { recursive: true });

const errors = [];
const step = (m) => console.log(`  ok  ${m}`);
const note = (m) => console.log(`  --  ${m}`);

const page = await launch({ url: URL });
page.on((method, params) => {
  if (method === 'Runtime.exceptionThrown') {
    errors.push(params.exceptionDetails?.exception?.description
      || params.exceptionDetails?.text || 'exception');
  }
  if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
    errors.push(params.args.map((a) => a.value ?? a.description).join(' '));
  }
});

const h = makeHelpers(page);

try {
  await page.sleep(1600);

  // ---- 1. a fresh save must reach a playable battle ----------------------
  await runBoot(page, h, step, note, compositionSlots);

  // ---- 2. the canvas is painted ------------------------------------------
  await runCanvas(page, step, OUT);

  // ---- 3. HUD controls are genuinely hittable ----------------------------
  await runHud(h, step, note);

  // ---- 4. the simulation runs, and speed actually changes it -------------
  await runSimSpeed(page, step);

  // ---- 5. a real drag order over the canvas -------------------------------
  await runDrag(page, step, OUT);

  // ---- 5b. a real RIGHT drag sets a rally ---------------------------------
  await runRally(page, h, step, note);

  // A chained drag used to be tested here — one gesture routing THROUGH a
  // waypoint. Free movement deleted the mechanism: a send is legal wherever a
  // path exists, so a drag is just "picked up here, released there" and the
  // pathfinder covers the ground in between on its own. Nothing left to drive.

  // ---- 5c. building mid-battle: arm, click a hex, a site appears ---------
  await runBuild(page, h, step);

  // ---- 6. effects actually render ----------------------------------------
  await runEffects(page, step, note);

  // ---- 7. numeric corruption sweep ---------------------------------------
  await runSanity(page, step);

  // ---- 8. leave the battle and walk the meta screens ---------------------
  await runMeta(page, h, step, note, OUT, REGIONS);

  if (errors.length) throw new Error(`console errors:\n    ${errors.join('\n    ')}`);
  console.log('\nSMOKE PASSED');
} catch (err) {
  await page.screenshot(`${OUT}/99-failure.png`).catch(() => {});
  console.error(`\nSMOKE FAILED: ${err.message}`);
  if (errors.length) console.error(`console errors:\n    ${errors.join('\n    ')}`);
  process.exitCode = 1;
} finally {
  await page.close();
}
