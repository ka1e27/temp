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
import { runCampedDrag } from './smoke-camped.mjs';
import { runSelect } from './smoke-select.mjs';
import { runKeyboard } from './smoke-keyboard.mjs';
import { runEffects, runSanity } from './smoke-checks.mjs';
import { runMeta } from './smoke-meta.mjs';

// A FIXED WORLD, SO A RED RUN MEANS SOMETHING. This suite boots a blank save,
// and the game's boot seed was `Math.random()` — so every run played a
// different board and every step that picks its fixture out of that board
// (the drag's target, the rally's neighbour pair, the build's legal hex, the
// keyboard walk's source) was intermittent. Measured: two different steps went
// red on two runs and green on the next three with no change between them.
//
// The seed is PRINTED rather than merely pinned, and overridable, so the
// random-board coverage is still available on purpose (`SMOKE_SEED=random`)
// and any failure is reproducible by hand at the same URL.
//
// 99991 IS CHOSEN FOR COVERAGE, NOT FOR GREEN. Pinning a board trades
// flakiness for the risk of a step that quietly stops asserting — the failure
// smoke-select.mjs already records, where a step placed after the beachhead
// shrank reported "fewer than two player sites to box" and passed, worthless.
// Five seeds were run and compared by how many steps ACTUALLY RAN:
//
//     seed 99991   27 ok   0 skipped steps     <- shipped
//     seed 7       26 ok   1 (no rally pair)
//     seed 42      26 ok   1
//     seed 20260829 25 ok  2
//     seed 1234    FAILS   — see below
//
// AND PINNING DOES NOT MAKE THE OTHER BOARDS PASS. `SMOKE_SEED=1234`
// reproduces a real camped-drag failure every time, which is the whole value
// of this change: what looked like one-run-in-four flakiness is a
// deterministic, board-dependent defect that can now be put under a debugger.
// Do not raise the seed to dodge a red run.
const SEED = process.env.SMOKE_SEED === 'random'
  ? (Math.random() * 0xffffffff) >>> 0
  : Number(process.env.SMOKE_SEED ?? 99991);
const BASE = process.env.URL || 'http://localhost:8080/';
const URL = `${BASE}${BASE.includes('?') ? '&' : '?'}seed=${SEED}`;
const OUT = 'screenshots';
await mkdir(OUT, { recursive: true });

const errors = [];
const step = (m) => console.log(`  ok  ${m}`);
const note = (m) => console.log(`  --  ${m}`);

console.log(`  ..  world seed ${SEED} (SMOKE_SEED=random for a fresh board)`);
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

  // ---- 5a. box select, and the rally CLICK -------------------------------
  // Both live in screens/battle-select.js and both were dead for a release
  // after a split left three of their dependencies as free variables. Nothing
  // in this suite drove either one, which is why it stayed green.
  //
  // FIRST, deliberately: this step needs two player sites to draw a box round,
  // and by the end of the order phase the landing force has usually spent or
  // lost some of its beachhead — placed last it reported "fewer than two
  // player sites to box" and asserted nothing, which is the same worthless
  // -but-green shape as a selector that stops matching.
  await runSelect(page, step, note);

  // ---- 5b. a real RIGHT drag sets a rally ---------------------------------
  await runRally(page, h, step, note);

  // A chained drag used to be tested here — one gesture routing THROUGH a
  // waypoint. Free movement deleted the mechanism: a send is legal wherever a
  // path exists, so a drag is just "picked up here, released there" and the
  // pathfinder covers the ground in between on its own. Nothing left to drive.

  // ---- 5c. building mid-battle: arm, click a hex, a site appears ---------
  await runBuild(page, h, step);

  // ---- 5d. an army in a FIELD drags like one in a building ---------------
  // The gesture no unit test can check: `MOVE_SQUAD` was in the engine for a
  // long time with nothing in the game able to issue one, and the whole suite
  // stayed green. What was missing was a hit-test.
  await runCampedDrag(page, step, note);
  // LAST among the order steps, and after the camped drag on purpose: it leaves
  // the board deselected and unfocused, which is what the steps after it expect.
  await runKeyboard(page, step, note);

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
