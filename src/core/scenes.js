// A scene STACK, not a switch.
//
// Why a stack: the shop is an overlay over the world map, and the map must stay
// drawn behind it. A switch would force the shop to re-render the map, or force
// the map to know the shop exists. A stack costs ~90 lines and removes both.
//
// THE RULE THAT MATTERS: `enter(params)` returns an array of unsubscribe
// functions and the manager calls every one of them on `exit()`. A scene that
// subscribes to the bus and forgets to unsubscribe is the #1 source of "the
// shop updated twice" bugs — this makes the leak structurally impossible,
// because the cleanup list is the return value rather than a habit.
//
// Only the TOP scene updates. Global systems (idle income) tick regardless of
// which scene is up — they are driven from main.js, not from here.
//
// PURE: no DOM. Scenes themselves may touch the DOM; the manager never does.

/**
 * @typedef {object} Scene
 * @property {string} id
 * @property {(params?:object)=>(Array<()=>void>|void)} [enter]  returns unsubscribers
 * @property {()=>void} [exit]
 * @property {(dtMs:number)=>void} [update]   called only when this scene is on top
 * @property {(alpha:number)=>void} [render]  called for every visible scene, bottom-up
 * @property {boolean} [keepVisible]  true = the scene BELOW this one keeps rendering
 */

/**
 * @param {object} [io]
 * @param {(err:Error, phase:string, sceneId:string)=>void} [io.onError]
 *        A throwing scene must not wedge the stack. Defaults to rethrow.
 */
export function createSceneStack({ onError } = {}) {
  /** @type {Array<{scene:Scene, offs:Array<()=>void>}>} */
  const stack = [];

  const fail = (err, phase, sceneId) => {
    if (onError) onError(err, phase, sceneId);
    else throw err;
  };

  function enter(scene, params) {
    let offs = [];
    try {
      const res = scene.enter ? scene.enter(params) : null;
      if (Array.isArray(res)) offs = res.filter((f) => typeof f === 'function');
      else if (typeof res === 'function') offs = [res];
      else if (res != null) {
        fail(new TypeError(`Scene "${scene.id}".enter must return an array of unsubscribe functions`), 'enter', scene.id);
      }
    } catch (err) {
      fail(err, 'enter', scene.id);
    }
    stack.push({ scene, offs });
  }

  function leave(entry) {
    // Unsubscribe FIRST: a listener firing during exit() would run against a
    // half-torn-down scene.
    for (const off of entry.offs) {
      try { off(); } catch (err) { fail(err, 'unsubscribe', entry.scene.id); }
    }
    entry.offs.length = 0;
    try { entry.scene.exit?.(); } catch (err) { fail(err, 'exit', entry.scene.id); }
  }

  return {
    /** Overlay a scene on top. The one below stays alive and may stay visible. */
    push(scene, params) {
      enter(scene, params);
      return scene;
    },

    /** Swap the top scene out entirely (world map -> battle). */
    replace(scene, params) {
      if (stack.length) leave(stack.pop());
      enter(scene, params);
      return scene;
    },

    /** Close the top overlay and hand control back to the scene below. */
    pop() {
      if (!stack.length) return null;
      const entry = stack.pop();
      leave(entry);
      return entry.scene;
    },

    /** Tear the whole stack down, top-down. */
    clear() {
      while (stack.length) leave(stack.pop());
    },

    get top() { return stack.length ? stack[stack.length - 1].scene : null; },
    get depth() { return stack.length; },
    get ids() { return stack.map((e) => e.scene.id); },
    has(id) { return stack.some((e) => e.scene.id === id); },

    /**
     * Scenes that should be drawn, BOTTOM-UP so the painter's algorithm works.
     * Walks down from the top while each scene declares `keepVisible`.
     */
    visible() {
      if (!stack.length) return [];
      let lo = stack.length - 1;
      while (lo > 0 && stack[lo].scene.keepVisible) lo--;
      return stack.slice(lo).map((e) => e.scene);
    },

    /** Only the top scene simulates. Everything below is frozen, not paused-ish. */
    update(dtMs) {
      const entry = stack[stack.length - 1];
      if (!entry) return;
      try { entry.scene.update?.(dtMs); } catch (err) { fail(err, 'update', entry.scene.id); }
    },

    render(alpha) {
      for (const scene of this.visible()) {
        try { scene.render?.(alpha); } catch (err) { fail(err, 'render', scene.id); }
      }
    },
  };
}
