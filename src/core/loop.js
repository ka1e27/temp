// Fixed-timestep game loop. All time and scheduling is INJECTED, so the loop
// runs headless in node tests and in tools/simrunner.js with no DOM at all.
// PURE: no performance.now, no requestAnimationFrame references.

export const TICK_HZ = 10;
export const TICK_MS = 1000 / TICK_HZ; // 100ms

const MAX_FRAME_MS = 250; // clamp: a backgrounded tab must not replay minutes
const MAX_STEPS = 5;      // death-spiral guard; <= MAX_FRAME_MS / TICK_MS

/**
 * @param {object} io
 * @param {(dtMs:number, simTimeMs:number)=>void} io.update fixed-step simulation
 * @param {(alpha:number, frameMs:number)=>void} io.render alpha in [0,1)
 * @param {()=>number} io.now monotonic ms
 * @param {(cb:()=>void)=>number} io.raf
 * @param {(id:number)=>void} io.cancelRaf
 */
export function createLoop({ update, render, now, raf, cancelRaf }) {
  let running = false;
  let rafId = 0;
  let last = 0;
  let acc = 0;
  let simTime = 0;
  let speed = 1;

  function frame() {
    if (!running) return;
    rafId = raf(frame);

    const t = now();
    let frameMs = t - last;
    last = t;
    // Clamp both ends: a stepped-back clock must not produce negative time.
    if (frameMs > MAX_FRAME_MS) frameMs = MAX_FRAME_MS;
    else if (frameMs < 0) frameMs = 0;

    acc += frameMs * speed;

    let steps = 0;
    while (acc >= TICK_MS && steps < MAX_STEPS) {
      update(TICK_MS, simTime);
      simTime += TICK_MS;
      acc -= TICK_MS;
      steps++;
    }
    // Budget exhausted: drop the backlog rather than queueing ever more work.
    if (steps === MAX_STEPS) acc = 0;

    render(acc / TICK_MS, frameMs);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = now();
      acc = 0;
      rafId = raf(frame);
    },
    stop() {
      running = false;
      if (rafId) cancelRaf(rafId);
      rafId = 0;
    },
    setSpeed(s) { speed = Math.max(0, Math.min(64, s)); },
    get speed() { return speed; },
    get simTimeMs() { return simTime; },
    get isRunning() { return running; },
    /** Headless: advance N ticks with no rendering. Tests and simrunner. */
    runTicks(n) {
      for (let i = 0; i < n; i++) {
        update(TICK_MS, simTime);
        simTime += TICK_MS;
      }
    },
  };
}
