// Tiny synchronous event emitter shared by battle (battle.events each step)
// and anything else that wants a decoupled pub/sub without a framework. PURE.

/**
 * @returns {{ on: (type: string, fn: Function) => (() => void), emit: (type: string, payload?: any) => void }}
 */
export function createEmitter() {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();

  function on(type, fn) {
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  function emit(type, payload) {
    const set = listeners.get(type);
    if (!set || set.size === 0) return;
    // Snapshot: a handler unsubscribing itself (or others) mid-emit must not
    // perturb this dispatch.
    for (const fn of Array.from(set)) fn(payload);
  }

  return { on, emit };
}
