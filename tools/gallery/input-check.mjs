// Drives tools/gallery/input.html with REAL CDP mouse/touch/wheel events (not
// synthetic clicks or direct function calls) and asserts on `window.test`.
// Exercises: mouse drag pan (+ inertia), drag-from-settlement = send, a plain
// click = tap, wheel zoom anchored at the cursor, and touch pinch zoom.
//
//   CHROME_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe" \
//     node tools/gallery/input-check.mjs
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME_PATH_DEFAULT = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// cdp.js reads CHROME_PATH into a module-level const at import time, so the
// env var must be set BEFORE the (dynamic) import, exactly like pageshot.mjs.
if (!process.env.CHROME_PATH) process.env.CHROME_PATH = CHROME_PATH_DEFAULT;
const { launch } = await import('../cdp.js');

let failures = 0;
function ok(cond, label) {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}`);
  }
}
function approx(a, b, eps, label) {
  ok(Math.abs(a - b) <= eps, `${label} (${a.toFixed ? a.toFixed(4) : a} ~= ${b.toFixed ? b.toFixed(4) : b}, eps=${eps})`);
}

async function waitForTestHooks(page) {
  for (let i = 0; i < 40; i++) {
    const has = await page.eval(() => !!(window.test && window.test.camera));
    if (has) return;
    await sleep(100);
  }
  throw new Error('window.test never appeared');
}

async function waitUntilSettled(page, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const moving = await page.eval(() => window.test.camera().moving);
    if (!moving) return true;
    await sleep(100);
  }
  return false;
}

async function main() {
  const page = await launch({ url: 'http://localhost:8080/tools/gallery/input.html', width: 1280, height: 800 });
  const pageErrors = [];
  page.on((method, params) => {
    if (method === 'Runtime.exceptionThrown') pageErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text);
  });

  try {
    await waitForTestHooks(page);

    // -------------------------------------------------------------------
    console.log('mouse drag on empty space pans the camera (+ inertia on release)');
    const before = await page.eval(() => window.test.camera());
    await page.drag({ x: 150, y: 150 }, { x: 330, y: 300 }, 16);
    const justReleased = await page.eval(() => window.test.camera());
    ok(justReleased.x < before.x, `camera.x decreased (dragged down-right): ${before.x.toFixed(2)} -> ${justReleased.x.toFixed(2)}`);
    ok(justReleased.y < before.y, `camera.y decreased (dragged down-right): ${before.y.toFixed(2)} -> ${justReleased.y.toFixed(2)}`);
    ok(justReleased.moving === true, 'camera reports isMoving() right after release (inertia)');
    const settledOk = await waitUntilSettled(page, 4000);
    ok(settledOk, 'inertia decays to a stop within 4s');
    const afterSettle = await page.eval(() => window.test.camera());
    ok(afterSettle.x <= justReleased.x + 1e-6, 'inertia continued the same direction, did not reverse (x)');
    ok(afterSettle.y <= justReleased.y + 1e-6, 'inertia continued the same direction, did not reverse (y)');

    // -------------------------------------------------------------------
    console.log('dragging from a settlement yields a send, ending on the target');
    const sites = await page.eval(() => window.test.settlements());
    const src = sites[0];
    const dst = sites[4];
    await page.drag({ x: src.screen.x, y: src.screen.y }, { x: dst.screen.x, y: dst.screen.y }, 14);
    const afterSend = await page.eval(() => window.test.state());
    ok(afterSend.lastIntent.startsWith('drag-end:send'), `lastIntent reflects a completed send drag (got "${afterSend.lastIntent}")`);
    ok(!!afterSend.lastSend && afterSend.lastSend.from === src.i, `lastSend.from === ${src.i} (got ${JSON.stringify(afterSend.lastSend)})`);
    ok(!!afterSend.lastSend && afterSend.lastSend.to === dst.i, `lastSend.to === ${dst.i} (got ${JSON.stringify(afterSend.lastSend)})`);
    ok(afterSend.lastSend && afterSend.lastSend.cancelled === false, 'send was not cancelled');
    // shakeX/Y is a decaying sinusoid (see camera.js), so a single sample can
    // land near a zero-crossing by chance — poll a few frames instead of
    // reading once.
    let sawShake = false;
    for (let i = 0; i < 8 && !sawShake; i++) {
      const c = await page.eval(() => window.test.camera());
      if (Math.abs(c.shakeX) > 0.01 || Math.abs(c.shakeY) > 0.01) sawShake = true;
      else await sleep(25);
    }
    ok(sawShake, 'a successful send triggers camera.shake() (nonzero shakeX/Y on at least one frame)');

    // -------------------------------------------------------------------
    console.log('flyTo buttons animate to a far corner and back');
    const camBeforeFly = await page.eval(() => window.test.camera());
    await page.eval(() => window.test.flyFar());
    ok((await page.eval(() => window.test.camera())).moving === true, 'isMoving() is true just after starting a flight');
    const flewOk = await waitUntilSettled(page, 2000);
    ok(flewOk, 'flyFar settles within 2s (900ms animation)');
    const camFar = await page.eval(() => window.test.camera());
    approx(camFar.zoom, 60, 0.05, 'flyFar reaches its exact target zoom (60)');
    ok(Math.abs(camFar.x - camBeforeFly.x) > 5 || Math.abs(camFar.y - camBeforeFly.y) > 5, 'flyFar actually moved the camera to a different point');

    await page.eval(() => window.test.flyHome());
    const homeOk = await waitUntilSettled(page, 2000);
    ok(homeOk, 'flyHome settles within 2s');

    // -------------------------------------------------------------------
    console.log('a plain click (no movement) yields a tap, selecting a hex');
    await page.eval(() => window.test.flyHome());
    await waitUntilSettled(page, 3000);
    const clickAt = { x: 250, y: 250 }; // well clear of every settlement icon
    await page.mouse('mouseMoved', clickAt.x, clickAt.y, 'none', 0);
    await page.mouse('mousePressed', clickAt.x, clickAt.y, 'left', 1);
    await page.mouse('mouseReleased', clickAt.x, clickAt.y, 'left', 0);
    const afterTap1 = await page.eval(() => window.test.state());
    ok(afterTap1.lastIntent.startsWith('tap'), `lastIntent is a tap (got "${afterTap1.lastIntent}")`);
    ok(!!afterTap1.selectedHex && Number.isInteger(afterTap1.selectedHex.col), `a hex got selected (${JSON.stringify(afterTap1.selectedHex)})`);

    const clickAt2 = { x: 900, y: 550 };
    await page.mouse('mouseMoved', clickAt2.x, clickAt2.y, 'none', 0);
    await page.mouse('mousePressed', clickAt2.x, clickAt2.y, 'left', 1);
    await page.mouse('mouseReleased', clickAt2.x, clickAt2.y, 'left', 0);
    const afterTap2 = await page.eval(() => window.test.state());
    ok(
      afterTap2.selectedHex.col !== afterTap1.selectedHex.col || afterTap2.selectedHex.row !== afterTap1.selectedHex.row,
      `a second tap elsewhere selects a different hex (${JSON.stringify(afterTap1.selectedHex)} -> ${JSON.stringify(afterTap2.selectedHex)})`,
    );

    // -------------------------------------------------------------------
    console.log('wheel zooms in, keeping the world point under the cursor fixed');
    const anchor = { x: 700, y: 450 };
    const camBeforeWheel = await page.eval(() => window.test.camera());
    const worldBeforeWheel = await page.eval((x, y) => window.test.screenToWorld(x, y), anchor.x, anchor.y);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: anchor.x, y: anchor.y, deltaX: 0, deltaY: -240 });
    await sleep(150);
    const camAfterWheel = await page.eval(() => window.test.camera());
    const worldAfterWheel = await page.eval((x, y) => window.test.screenToWorld(x, y), anchor.x, anchor.y);
    ok(camAfterWheel.zoom > camBeforeWheel.zoom, `zoom increased (${camBeforeWheel.zoom.toFixed(2)} -> ${camAfterWheel.zoom.toFixed(2)})`);
    approx(worldAfterWheel.x, worldBeforeWheel.x, 0.01, 'anchor world.x unchanged by the wheel zoom');
    approx(worldAfterWheel.y, worldBeforeWheel.y, 0.01, 'anchor world.y unchanged by the wheel zoom');

    // -------------------------------------------------------------------
    console.log('touch pinch zooms in, keeping the pinch midpoint fixed');
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: true });
    await sleep(100);
    const mid = { x: 640, y: 420 };
    const camBeforePinch = await page.eval(() => window.test.camera());
    const worldBeforePinch = await page.eval((x, y) => window.test.screenToWorld(x, y), mid.x, mid.y);

    const touchPoint = (dx, id) => ({ x: mid.x + dx, y: mid.y, id, radiusX: 8, radiusY: 8 });
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(-40, 0), touchPoint(40, 1)] });
    const spreadSteps = [-60, -80, -100, -120];
    for (const d of spreadSteps) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPoint(d, 0), touchPoint(-d, 1)] });
      await sleep(30);
    }
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(150);

    const camAfterPinch = await page.eval(() => window.test.camera());
    const worldAfterPinch = await page.eval((x, y) => window.test.screenToWorld(x, y), mid.x, mid.y);
    ok(camAfterPinch.zoom > camBeforePinch.zoom, `pinch-out zoomed in (${camBeforePinch.zoom.toFixed(2)} -> ${camAfterPinch.zoom.toFixed(2)})`);
    approx(worldAfterPinch.x, worldBeforePinch.x, 0.5, 'pinch midpoint world.x roughly unchanged');
    approx(worldAfterPinch.y, worldBeforePinch.y, 0.5, 'pinch midpoint world.y roughly unchanged');

    // -------------------------------------------------------------------
    console.log('touch hold (450ms, no movement) yields a long-press, not a tap');
    const lp = { x: 300, y: 500 };
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: lp.x, y: lp.y, id: 9, radiusX: 8, radiusY: 8 }] });
    await sleep(650); // > LONG_PRESS_MS (450)
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const afterLongPress = await page.eval(() => window.test.state());
    ok(afterLongPress.lastIntent.includes('long-press'), `lastIntent reflects the long-press (got "${afterLongPress.lastIntent}")`);
    ok(!!afterLongPress.selectedHex, `long-press selected a hex (${JSON.stringify(afterLongPress.selectedHex)})`);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

    // -------------------------------------------------------------------
    console.log('shift-drag on empty space yields a lasso');
    await page.eval(() => window.test.flyHome());
    await waitUntilSettled(page, 3000);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 150, y: 150, button: 'none', buttons: 0 });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 150, y: 150, button: 'left', buttons: 1, clickCount: 1, modifiers: 8 });
    for (const [x, y] of [[250, 200], [380, 320]]) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 1, modifiers: 8 });
      await sleep(20);
    }
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 380, y: 320, button: 'left', buttons: 0, modifiers: 8 });
    const afterLasso = await page.eval(() => window.test.state());
    ok(afterLasso.lastIntent.startsWith('drag-end:lasso'), `lastIntent reflects a completed lasso (got "${afterLasso.lastIntent}")`);

    // -------------------------------------------------------------------
    console.log('right-click cancels (and the context menu never appears)');
    await page.mouse('mouseMoved', 500, 400, 'none', 0);
    await page.mouse('mousePressed', 500, 400, 'right', 2);
    await page.mouse('mouseReleased', 500, 400, 'right', 0);
    const afterRightClick = await page.eval(() => window.test.state());
    ok(afterRightClick.lastIntent === 'cancel', `lastIntent is cancel (got "${afterRightClick.lastIntent}")`);
    ok(afterRightClick.selectedHex === null && afterRightClick.selectedSettlement === null, 'selection was cleared by cancel');

    console.log(pageErrors.length ? `\npage errors seen:\n${pageErrors.map((e) => '  ' + e).join('\n')}` : '');
  } finally {
    await page.close();
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('input-check crashed:', err);
  process.exit(1);
});
