// Battle controls. Pointer Events ONLY — one code path that behaves the same
// for mouse, trackpad and touch, which is why there is no separate touch
// handler anywhere in this file.
//
// THE HARD RULE: presentation never mutates simulation state. Every intent
// here becomes a plain command object appended to `state.commands[]`, which the
// sim validates and applies at the top of the next tick. That buys free input
// buffering, a replayable command log, and a UI that structurally cannot
// corrupt the sim.
//
// The commit-size decision is GLOBAL (strength selector + unit filters), never
// a modal between intent and action — a dialog in a real-time game is a bug.
import { UNIT_IDS, SEND_FRACTIONS } from '../content/balance.js';
import { createDisposer } from '../ui/dom.js';

const TAP_SLOP = 6;       // CSS px of travel still counted as a tap
const TWO_FINGER_MS = 260;
const BOOSTER_KEYS = { z: 'rally', x: 'march', c: 'bombard', v: 'fortify', b: 'tithe' };
const FILTER_KEYS = { q: 'militia', w: 'spearmen', e: 'raiders', r: 'rams', t: 'marshal' };

/** Shared presentation state. Read by the renderer and the HUD, written only
 *  here. Never touched by the simulation. */
export function createView(init = {}) {
  return {
    fraction: 0.5,
    filter: { militia: true, spearmen: true, raiders: true, rams: true, marshal: true },
    selection: [],
    armed: null,        // click-then-click source
    hoverId: null,
    dragFrom: null,
    dragTo: null,
    pointer: { x: 0, y: 0 },
    box: null,
    trainPickerFor: null,
    lastCommand: null,
    ...init,
  };
}

/** Enabled unit ids in canonical order — stable, so the command log hashes
 *  identically across runs. */
export const filterList = (filter) => UNIT_IDS.filter((u) => filter[u] !== false);

/**
 * Command constructors, in one block so the seam with battle/commands.js is a
 * single place to look. Field names match that module's canonical readers —
 * it tolerates aliases, but a clean command log is worth more than leaning on
 * that tolerance, because the log is also the determinism test's input.
 */
export const cmd = {
  send: (from, to, fraction, filter) => ({ t: 'SEND', from, to, fraction, filter }),
  rally: (site, target) => ({ t: 'RALLY', site, target: target ?? null }),
  retreat: (site) => ({ t: 'RETREAT', site }),
  retreatSquad: (squadId) => ({ t: 'RETREAT_SQUAD', squadId }),
  booster: (id, site) => ({ t: 'BOOSTER', id, site: site ?? null }),
  train: (site, unit) => ({ t: 'TRAIN', site, unit }),
  upgrade: (site) => ({ t: 'UPGRADE', site }),
  withdraw: () => ({ t: 'WITHDRAW' }),
};

/**
 * @param {{canvas:HTMLCanvasElement, board:object, view:object,
 *          getState:()=>object, bus?:object}} o
 *   `board` is the battleView (geometry + camera).
 */
export function createBattleInput(o) {
  const { canvas, board, view, getState, bus } = o;
  const off = createDisposer();
  const cam = board.camera;
  const w = { x: 0, y: 0 };
  const s = { x: 0, y: 0 };
  const pointers = new Map();
  let press = null;
  let panning = false;
  let pinchDist = 0;
  let lastTapAt = 0;
  let lastTapId = null;

  const push = (c) => {
    getState().commands.push(c);
    view.lastCommand = c;
    bus?.emit('ui:command', c);
    return c;
  };

  const site = (id) => getState().sites.find((x) => x.id === id) || null;
  const canSend = (from, to) => !!from && !!to && from.id !== to.id
    && from.owner === 'player' && from.adj.includes(to.id);

  /** Snap the drag to a LEGAL target: a direct hit on an adjacent site, else
   *  the nearest adjacent site the pointer is leaning toward. Snapping is what
   *  teaches the adjacency rule without a tutorial line. */
  function snapTarget(from, wx, wy) {
    const st = getState();
    const hit = board.siteAt(st, wx, wy);
    if (hit && (hit.id === from.id || from.adj.includes(hit.id))) return hit;
    let best = null;
    let bestD = board.hexSize * 2.4;
    for (const id of from.adj) {
      const t = site(id);
      if (!t) continue;
      board.sitePos(t, s);
      const d = Math.hypot(wx - s.x, wy - s.y);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  function issueSend(from, to) {
    if (!canSend(from, to)) return false;
    push(cmd.send(from.id, to.id, view.fraction, filterList(view.filter)));
    return true;
  }

  function selectOnly(id) {
    view.selection.length = 0;
    if (id) view.selection.push(id);
    const st = getState();
    const sel = id ? st.sites.find((x) => x.id === id) : null;
    view.trainPickerFor = sel && sel.owner === 'player' && sel.kind !== 'farm' ? id : null;
    bus?.emit('ui:selection', view.selection);
  }

  /** Double-tap grabs the whole connected friendly front — the fast way to
   *  order a whole flank without a box drag. */
  function selectFront(id) {
    const st = getState();
    const seen = new Set([id]);
    const queue = [id];
    while (queue.length) {
      const cur = st.sites.find((x) => x.id === queue.shift());
      if (!cur) continue;
      for (const n of cur.adj) {
        const nb = st.sites.find((x) => x.id === n);
        if (nb && nb.owner === 'player' && !seen.has(n)) { seen.add(n); queue.push(n); }
      }
    }
    view.selection.length = 0;
    for (const k of seen) view.selection.push(k);
    view.trainPickerFor = null;
    bus?.emit('ui:selection', view.selection);
  }

  function clearDrag() {
    view.dragFrom = null;
    view.dragTo = null;
    view.box = null;
    canvas.classList.remove('is-dragging');
  }

  // ---- pointer ------------------------------------------------------------

  function onDown(ev) {
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, at: performance.now(), moved: 0 });
    canvas.setPointerCapture?.(ev.pointerId);
    board.pointer(ev, s);
    cam.screenToWorld(s.x, s.y, w);

    if (pointers.size === 2) {         // two fingers: pan / pinch, cancel order
      clearDrag();
      panning = true;
      pinchDist = spread();
      return;
    }
    // Right button or middle button: rally and pan respectively.
    if (ev.button === 2) { setRally(w.x, w.y); return; }
    if (ev.button === 1 || ev.shiftKey) { panning = true; return; }

    const st = getState();
    const hit = board.siteAt(st, w.x, w.y);
    press = { id: hit?.id ?? null, sx: s.x, sy: s.y, moved: false, at: performance.now() };
    view.pointer.x = w.x;
    view.pointer.y = w.y;

    if (hit && hit.owner === 'player') {
      view.dragFrom = hit.id;
      view.dragTo = null;
      canvas.classList.add('is-dragging');
    } else if (!hit) {
      view.box = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
    }
  }

  function onMove(ev) {
    const rec = pointers.get(ev.pointerId);
    if (rec) {
      rec.moved += Math.abs(ev.clientX - rec.x) + Math.abs(ev.clientY - rec.y);
      rec.x = ev.clientX;
      rec.y = ev.clientY;
    }
    board.pointer(ev, s);
    cam.screenToWorld(s.x, s.y, w);
    view.pointer.x = w.x;
    view.pointer.y = w.y;

    if (panning) {
      if (pointers.size === 2) {
        const d = spread();
        if (pinchDist > 0 && d > 0) cam.zoomAt(s.x, s.y, d / pinchDist);
        pinchDist = d;
      } else if (ev.movementX !== undefined) {
        cam.panScreen(ev.movementX, ev.movementY);
      }
      board.releaseAutoFit();
      board.markBgDirty();
      return;
    }

    const st = getState();
    if (press && !press.moved && Math.hypot(s.x - press.sx, s.y - press.sy) > TAP_SLOP) {
      press.moved = true;
    }
    const hover = board.siteAt(st, w.x, w.y);
    view.hoverId = hover?.id ?? null;

    if (view.dragFrom) {
      const from = site(view.dragFrom);
      const t = from ? snapTarget(from, w.x, w.y) : null;
      view.dragTo = t && t.id !== from.id ? t.id : null;
    } else if (view.box) {
      view.box.x1 = w.x;
      view.box.y1 = w.y;
    }
  }

  function onUp(ev) {
    const rec = pointers.get(ev.pointerId);
    pointers.delete(ev.pointerId);
    canvas.releasePointerCapture?.(ev.pointerId);

    if (panning) {
      // A quick two-finger tap that never moved is the touch equivalent of a
      // right-click, so rally points work without a keyboard or a second button.
      if (rec && rec.moved < 8 && performance.now() - rec.at < TWO_FINGER_MS && pointers.size === 0) {
        board.pointer(ev, s);
        cam.screenToWorld(s.x, s.y, w);
        setRally(w.x, w.y);
      }
      if (pointers.size === 0) panning = false;
      return;
    }
    if (!press) return;

    board.pointer(ev, s);
    cam.screenToWorld(s.x, s.y, w);
    const st = getState();
    const from = view.dragFrom ? site(view.dragFrom) : null;

    if (from && press.moved) {
      // Drag order. Releasing back on the source is an explicit cancel.
      const to = view.dragTo ? site(view.dragTo) : null;
      if (to && to.id !== from.id) { issueSend(from, to); selectOnly(from.id); }
      else selectOnly(from.id);
      view.armed = from.id;
    } else if (view.box && press.moved) {
      boxSelect();
    } else {
      tap(board.siteAt(st, w.x, w.y));
    }
    clearDrag();
    press = null;
  }

  /** Click-then-click runs through the SAME issueSend path as the drag, so the
   *  two input styles can never disagree about what is legal. */
  function tap(hit) {
    const now = performance.now();
    if (!hit) { view.armed = null; selectOnly(null); return; }

    if (hit.id === lastTapId && now - lastTapAt < 320 && hit.owner === 'player') {
      selectFront(hit.id);
      lastTapAt = 0;
      return;
    }
    lastTapId = hit.id;
    lastTapAt = now;

    const armed = view.armed ? site(view.armed) : null;
    if (armed && armed.id !== hit.id && issueSend(armed, hit)) {
      view.armed = null;
      return;
    }
    view.armed = hit.owner === 'player' ? hit.id : null;
    selectOnly(hit.id);
  }

  function boxSelect() {
    const b = view.box;
    if (!b) return;
    const st = getState();
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1);
    const y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    view.selection.length = 0;
    for (const si of st.sites) {
      if (si.owner !== 'player') continue;
      board.sitePos(si, s);
      if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) view.selection.push(si.id);
    }
    view.armed = view.selection.length === 1 ? view.selection[0] : null;
    view.trainPickerFor = null;
    bus?.emit('ui:selection', view.selection);
  }

  /** Rally makes a site auto-send once its garrison passes the threshold — the
   *  idle affordance inside the battle, and the cure for back-line micro. */
  function setRally(wx, wy) {
    const st = getState();
    const target = board.siteAt(st, wx, wy);
    const sources = view.selection.length ? view.selection.slice()
      : (view.armed ? [view.armed] : []);
    if (!sources.length) return;
    for (const id of sources) {
      const src = site(id);
      if (!src || src.owner !== 'player') continue;
      if (!target || target.id === id) push(cmd.rally(id, null));
      else if (src.adj.includes(target.id)) push(cmd.rally(id, target.id));
    }
  }

  function spread() {
    const it = pointers.values();
    const a = it.next().value;
    const b = it.next().value;
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  // ---- keyboard -----------------------------------------------------------

  function onKey(ev) {
    if (ev.target !== document.body && ev.target?.tagName === 'INPUT') return;
    const k = ev.key.toLowerCase();

    const n = Number(k);
    if (Number.isInteger(n) && n >= 1 && n <= SEND_FRACTIONS.length) {
      view.fraction = SEND_FRACTIONS[n - 1];
      bus?.emit('ui:fraction', view.fraction);
      return;
    }
    if (k === 'escape') { view.armed = null; selectOnly(null); clearDrag(); return; }

    // `R` is documented twice in the design — as retreat and as the rams
    // filter. Resolved by context, which is unambiguous in practice: retreat
    // needs something selected, and you set filters when nothing is.
    // Shift+R always means the filter.
    if (k === 'r' && !ev.shiftKey && view.selection.length) { retreatSelection(); return; }
    if (FILTER_KEYS[k]) {
      const u = FILTER_KEYS[k];
      view.filter[u] = !view.filter[u];
      bus?.emit('ui:filter', view.filter);
      return;
    }
    if (BOOSTER_KEYS[k]) { push(cmd.booster(BOOSTER_KEYS[k])); return; }
    if (k === ' ') { ev.preventDefault(); bus?.emit('ui:slowmo'); return; }
    if (k === 'p') { bus?.emit('ui:pause'); }
  }

  function retreatSelection() {
    for (const id of view.selection) {
      const src = site(id);
      if (!src) continue;
      if (src.owner === 'player' || src.siege?.owner === 'player') push(cmd.retreat(id));
    }
  }

  function onWheel(ev) {
    ev.preventDefault();
    board.pointer(ev, s);
    cam.zoomAt(s.x, s.y, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
    board.releaseAutoFit();
    board.markBgDirty();
  }

  off.listen(canvas, 'pointerdown', onDown);
  off.listen(canvas, 'pointermove', onMove);
  off.listen(canvas, 'pointerup', onUp);
  off.listen(canvas, 'pointercancel', (ev) => { pointers.delete(ev.pointerId); clearDrag(); press = null; panning = pointers.size > 0; });
  off.listen(canvas, 'contextmenu', (ev) => ev.preventDefault());
  off.listen(canvas, 'wheel', onWheel, { passive: false });
  off.listen(window, 'keydown', onKey);

  return {
    view,
    /** Exposed so HUD chips route through exactly the same code as the keys. */
    setFraction(f) { view.fraction = f; bus?.emit('ui:fraction', f); },
    toggleFilter(u) { view.filter[u] = !view.filter[u]; bus?.emit('ui:filter', view.filter); },
    useBooster(id) { push(cmd.booster(id)); },
    setTrain(siteId, unit) { push(cmd.train(siteId, unit)); },
    upgrade(siteId) { push(cmd.upgrade(siteId)); },
    retreat: retreatSelection,
    retreatSquad(id) { push(cmd.retreatSquad(id)); },
    /** Leaves the region unconquered (design section 9). Deliberately NOT bound
     *  to a key: Esc deselects, and ending a battle on a stray keypress is the
     *  kind of thing you only regret once. A HUD button calls this. */
    withdraw() { push(cmd.withdraw()); },
    dispose: off.dispose,
  };
}
