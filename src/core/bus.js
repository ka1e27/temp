// Minimal event bus. Carries NOTIFICATIONS, never control flow — if system A
// needs B to run in a specific order, that is a direct call inside the tick.
//
// The simulation never emits here. sim.js pushes onto state.battle.events[] and
// main.js drains it AFTER the tick completes, so a listener can never mutate
// state mid-iteration.
// PURE.

export function createBus() {
  const map = new Map();
  return {
    /** @returns {() => void} unsubscribe */
    on(type, fn) {
      let set = map.get(type);
      if (!set) map.set(type, (set = new Set()));
      set.add(fn);
      return () => set.delete(fn);
    },
    once(type, fn) {
      const off = this.on(type, (payload) => { off(); fn(payload); });
      return off;
    },
    emit(type, payload) {
      const set = map.get(type);
      if (!set) return;
      // Copy: a listener is allowed to unsubscribe itself while we iterate.
      for (const fn of [...set]) fn(payload, type);
    },
    clear() { map.clear(); },
  };
}
