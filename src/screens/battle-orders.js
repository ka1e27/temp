// What a gesture MEANS, separated from how the gesture was made.
//
// battle-input.js recognises pointer and key events; this module turns them
// into game orders — selection, sends, rally points, retreats, armed boosters
// and squad picking. The split keeps each file readable and puts every
// state.commands[] append in one place.
//
// THE HARD RULE: presentation never mutates simulation state. Every intent
// becomes a plain command object appended to `state.commands[]`, which the sim
// validates and applies at the top of the next tick. That buys free input
// buffering, a replayable command log, and a UI that structurally cannot
// corrupt the sim.
import { UNIT_IDS } from '../content/balance.js';
import { squadProgress, squadBow } from '../render/routes.js';
import { perceivedSquads } from '../battle/vision.js';
import { loadStops, routeAt } from '../render/routePath.js';
import { needsTarget } from './battle-keys.js';
import { createArmedBuild } from './battle-build.js';

/** Click slop for picking an in-flight squad off its arc, as a fraction of a
 *  hex. Deliberately tight: a stray click near a route must still deselect. */
const SQUAD_PICK = 0.5;

// Module-scope scratch: nothing on the click path allocates.
const _a = { x: 0, y: 0 };
const _p = { x: 0, y: 0 };

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
  // No more `via`: a chained send existed to express several adjacent hops as
  // one order, and free movement (pathBetween) makes that a plain march — see
  // movement.js spawnSquad.
  send: (from, to, fraction, filter) => ({ t: 'SEND', from, to, fraction, filter }),
  // `mode` is omitted entirely when unset rather than sent as undefined: these
  // objects are asserted to be plain serializable data, and a key that only
  // exists sometimes is a worse shape than one that never exists.
  rally: (site, target, mode) => ({
    t: 'RALLY', site, target: target ?? null, ...(mode ? { mode } : {}),
  }),
  rallyKeep: (site, keep) => ({ t: 'RALLY_KEEP', site, keep }),
  retreat: (site) => ({ t: 'RETREAT', site }),
  retreatSquad: (squadId) => ({ t: 'RETREAT_SQUAD', squadId }),
  booster: (id, site) => ({ t: 'BOOSTER', id, site: site ?? null }),
  train: (site, unit) => ({ t: 'TRAIN', site, unit }),
  recruit: (site, unit) => ({ t: 'RECRUIT', site, unit }),
  upgrade: (site) => ({ t: 'UPGRADE', site }),
  build: (kind, hex) => ({ t: 'BUILD', kind, hex }),
  withdraw: () => ({ t: 'WITHDRAW' }),
};

/**
 * @param {{canvas:HTMLCanvasElement, board:object, view:object,
 *          getState:()=>object, bus?:object}} o
 */
export function createOrders(o) {
  const { canvas, board, view, getState, bus } = o;

  // The geometry bundle routePath.js wants, built ONCE so squad hit-testing can
  // reuse the renderer's own route walk instead of keeping a second copy of it.
  const geo = { byId: (id) => site(id), pos: (s, out) => board.sitePos(s, out) };

  const push = (c) => {
    getState().commands.push(c);
    view.lastCommand = c;
    bus?.emit('ui:command', c);
    return c;
  };

  const site = (id) => getState().sites.find((x) => x.id === id) || null;
  // Reach used to be `from.adj`, the authored edge list a send could not cross;
  // legality now belongs entirely to cmdSend's pathBetween check, so the UI only
  // has to rule out the senseless pairs (nothing, yourself, someone else's site).
  const canSend = (from, to) => !!from && !!to && from.id !== to.id && from.owner === 'player';

  /** Snap the drag to whatever the pointer is actually over, else the nearest
   *  site of ANY owner nearby. It used to magnet only toward `from.adj`
   *  members, because that was the whole legal set; free movement makes every
   *  pair a candidate, so snapping is now purely about forgiving a sloppy
   *  drag, not about teaching an adjacency rule. */
  function snapTarget(from, wx, wy) {
    const hit = board.siteAt(getState(), wx, wy);
    if (hit) return hit;
    let best = null;
    let bestD = board.hexSize * 2.4;
    for (const t of getState().sites) {
      if (t.id === from.id) continue;
      board.sitePos(t, _a);
      const d = Math.hypot(wx - _a.x, wy - _a.y);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  /** A send is legal wherever the sim can actually route one — cmdSend's own
   *  pathBetween check is what refuses it, so there is nothing left to mirror
   *  here. There used to be one: `canChain` re-validated a whole waypoint list
   *  exactly the way commands.js did, because a chain could otherwise die on
   *  arrival if the two checks ever disagreed. Free movement deleted the thing
   *  they both validated. */
  function issueSend(from, to) {
    if (!canSend(from, to)) return false;
    push(cmd.send(from.id, to.id, view.fraction, filterList(view.filter)));
    return true;
  }

  /**
   * A chained RALLY is not one long standing order — it is a rally on EVERY
   * site along the road. Rallies already cascade (A→B and B→C flows troops
   * through B), so setting the chain is all it takes, and the sim needs no
   * concept of a multi-hop rally at all. It also degrades honestly: break the
   * middle site and the front half of the chain simply stops.
   * @returns {boolean} true when every link was legal and issued.
   */
  function issueRallyChain(from, chain, to) {
    const stops = [from, ...chain.map((id) => site(id)), to].filter(Boolean);
    if (stops.length < 2) return false;
    for (let i = 0; i < stops.length - 1; i++) {
      // The last hop may target ground we do not hold — a standing attack order
      // — but every site DOING the rallying has to be ours.
      if (stops[i].owner !== 'player') return false;
      if (!stops[i].adj.includes(stops[i + 1].id)) return false;
    }
    // Toggle per link, so re-dragging a route you already set cancels it — the
    // same "drag it again to undo" the single-link gesture has.
    for (let i = 0; i < stops.length - 1; i++) toggleRally(stops[i], stops[i + 1]);
    return true;
  }

  /**
   * Set — or clear — ONE site's rally. Targeting `to === from` clears it, which
   * is what releasing a rally drag back on its source means, mirroring the send
   * drag's "release on the source is an explicit cancel".
   *
   * Both rally input paths (the right-button drag and the older
   * select-then-right-click) funnel through here, so they cannot disagree about
   * what is legal any more than the drag and click-then-click sends can.
   * @returns {boolean} true when a command was issued.
   */
  function issueRally(from, to) {
    if (!from || from.owner !== 'player') return false;
    if (!to || to.id === from.id) { push(cmd.rally(from.id, null)); return true; }
    if (!from.adj.includes(to.id)) return false;
    push(cmd.rally(from.id, to.id));
    return true;
  }

  /**
   * What a rally DRAG along a link means, which is not simply "set it".
   *
   * Each LINK is independently on or off, and dragging it flips that — so a
   * second neighbour is added by dragging to it, and a link is removed by
   * dragging it again. That is what lets one site feed two fronts (the sim
   * alternates between them; see battle/rally.js).
   *
   *   A -> B when A already feeds B    ...removes that link
   *   A -> B when A feeds C only       ...adds B, so A now feeds C and B
   *   A -> B when it is currently B -> A ...flips it, because the sim drops the
   *                                        reciprocal link whenever it sets one
   *   A -> A (release on the source)   ...clears every link
   *
   * The reciprocal-drop invariant lives in the SIM, not here, so it holds for
   * the rally chain and for a resumed save too. With lists it drops only the one
   * offending link, so a site feeding two neighbours keeps the innocent one.
   * @returns {boolean} true when an order was issued.
   */
  function toggleRally(from, to) {
    if (!from || from.owner !== 'player') return false;
    if (!to || to.id === from.id) { push(cmd.rally(from.id, null)); return true; }
    if (!from.adj.includes(to.id)) return false;
    push(cmd.rally(from.id, to.id, 'toggle'));
    return true;
  }

  /**
   * How many troops that site's rally leaves at home. A separate order from the
   * rally itself, so changing the number never disturbs the destination — and
   * like every other intent it is only ever a command object. The sim owns the
   * clamp; this refuses to address a site that is not yours, the same way
   * issueRally does, rather than shipping an order that can only be rejected.
   * @returns {boolean} true when a command was issued.
   */
  function issueRallyKeep(from, keep) {
    const src = typeof from === 'string' ? site(from) : from;
    if (!src || src.owner !== 'player') return false;
    if (!Number.isInteger(keep)) return false;
    push(cmd.rallyKeep(src.id, keep));
    return true;
  }

  function selectOnly(id) {
    view.selection.length = 0;
    if (id) view.selection.push(id);
    view.selectedSquad = null;
    const sel = id ? site(id) : null;
    // The picker is for sites that can actually train. Farms cannot, and used
    // to open NOTHING at all as a result — they now open the site panel, which
    // hangs off `selection` and so covers every site on the board.
    view.trainPickerFor = sel && sel.owner === 'player' && sel.kind !== 'farm' ? id : null;
    bus?.emit('ui:selection', view.selection);
  }

  /** Double-tap grabs the whole connected friendly front — the fast way to
   *  order a whole flank without a box drag. */
  function selectFront(id) {
    const seen = new Set([id]);
    const queue = [id];
    while (queue.length) {
      const cur = site(queue.shift());
      if (!cur) continue;
      for (const n of cur.adj) {
        if (!seen.has(n) && site(n)?.owner === 'player') { seen.add(n); queue.push(n); }
      }
    }
    view.selection.length = 0;
    for (const k of seen) view.selection.push(k);
    view.trainPickerFor = null;
    view.selectedSquad = null;
    bus?.emit('ui:selection', view.selection);
  }

  function boxSelect(box) {
    if (!box) return;
    const st = getState();
    const x0 = Math.min(box.x0, box.x1); const x1 = Math.max(box.x0, box.x1);
    const y0 = Math.min(box.y0, box.y1); const y1 = Math.max(box.y0, box.y1);
    view.selection.length = 0;
    for (const si of st.sites) {
      if (si.owner !== 'player') continue;
      board.sitePos(si, _a);
      if (_a.x >= x0 && _a.x <= x1 && _a.y >= y0 && _a.y <= y1) view.selection.push(si.id);
    }
    view.armed = view.selection.length === 1 ? view.selection[0] : null;
    view.trainPickerFor = null;
    view.selectedSquad = null;
    bus?.emit('ui:selection', view.selection);
  }

  /** Rally makes a site auto-send once its garrison passes the threshold — the
   *  idle affordance inside the battle, and the cure for back-line micro.
   *
   *  The click form: whatever is selected rallies to the site under the pointer.
   *  Kept because it is the only way to point a whole flank at one target in a
   *  single action; the drag form (battle-input.js) handles one site at a time. */
  function setRally(wx, wy) {
    const target = board.siteAt(getState(), wx, wy);
    // Copied: a `ui:command` listener is allowed to change the selection.
    const sources = view.selection.length ? view.selection.slice()
      : (view.armed ? [view.armed] : []);
    if (!sources.length) return;
    for (const id of sources) issueRally(site(id), target);
  }

  function retreatSelection() {
    for (const id of view.selection) {
      const src = site(id);
      if (!src) continue;
      if (src.owner === 'player' || src.siege?.owner === 'player') push(cmd.retreat(id));
    }
  }

  // ---- armed boosters -----------------------------------------------------
  // Rally, Bombard and Fortify all answer 'needs-target', and every input path
  // in the game sent `site: null` — three of five boosters were unreachable
  // through the keyboard AND the HUD. Pressing one now ARMS it, and the next
  // site click fires it there.

  function syncArm() {
    canvas?.classList.toggle('is-targeting', !!view.armedBooster);
    bus?.emit('ui:armed-booster', view.armedBooster);
  }

  /** @returns {boolean} true when the booster is now armed and waiting. */
  function armBooster(id) {
    if (!needsTarget(id)) {           // march and tithe act on what you already have
      view.armedBooster = null;
      syncArm();
      push(cmd.booster(id, null));
      return false;
    }
    view.armedBooster = view.armedBooster === id ? null : id;  // press again to cancel
    syncArm();
    return !!view.armedBooster;
  }

  function cancelBooster() {
    if (!view.armedBooster) return false;
    view.armedBooster = null;
    syncArm();
    return true;
  }

  function fireBooster(siteId) {
    const id = view.armedBooster;
    if (!id) return false;
    view.armedBooster = null;
    syncArm();
    push(cmd.booster(id, siteId));
    return true;
  }

  // Armed construction (arm a kind, resolve the next click to a hex, push
  // BUILD) is the same one-shot shape as an armed booster above but needs
  // `fromPixel`, so it moved to ./battle-build.js at the 400-line cap.
  const { armBuild, cancelBuild, fireBuild } = createArmedBuild({
    view, canvas, bus, board, cancelBooster, pushBuild: (kind, hex) => push(cmd.build(kind, hex)),
  });

  // ---- squads -------------------------------------------------------------

  /** Nearest in-flight squad to a world point, so `R` can reach one. Squads are
   *  drawn along the bowed arcs routes.js walks, so hit-testing reuses that
   *  geometry rather than guessing at it. */
  function squadAt(st, wx, wy) {
    const r = board.hexSize * SQUAD_PICK;
    let best = null;
    let bestD = r * r;
    // FOG, and it follows straight from the comment above: hit-testing reuses
    // the renderer's geometry so a squad is clickable exactly where it is
    // DRAWN — and a squad outside vision is not drawn at all. Scanning the raw
    // list would leave an invisible enemy column pickable out of empty dark,
    // which is a worse tell than drawing it would have been, because the player
    // learns the army is there by finding it with the cursor.
    //
    // Unlike a SITE, whose position and kind are common knowledge (so clicking
    // a ghost to aim a blind attack is intended), a squad's existence is
    // precisely what fog hides.
    const squads = perceivedSquads(st, 'player');
    for (let i = 0; i < squads.length; i++) {
      const sq = squads[i];
      // Through the SAME geometry the renderer walks, so a squad drawn mid-arc
      // is clickable exactly where it is drawn.
      const stops = loadStops(sq, geo);
      if (!stops) continue;
      routeAt(sq, stops, squadProgress(sq, st.tick), squadBow(sq), _p, null);
      const dx = wx - _p.x;
      const dy = wy - _p.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = sq; }
    }
    return best;
  }

  /** Order the selected squad home. A squad that has already ARRIVED is no
   *  longer in `state.squads`, so forget it rather than sending an order the
   *  sim can only answer with 'unknown-squad'.
   *  @returns {boolean} true when a live squad was turned around. */
  function retreatSelectedSquad() {
    const id = view.selectedSquad;
    if (id == null) return false;
    const sq = getState().squads.find((x) => x.id === id);
    if (!sq) { view.selectedSquad = null; return false; }
    push(cmd.retreatSquad(sq.id));
    return true;
  }

  function selectSquad(sq) {
    view.selection.length = 0;
    view.trainPickerFor = null;
    view.armed = null;
    view.selectedSquad = sq.id;
    bus?.emit('ui:selection', view.selection);
  }

  return {
    push, site, canSend, snapTarget, issueSend,
    issueRally, toggleRally, issueRallyChain, issueRallyKeep,
    selectOnly, selectFront, boxSelect, setRally, retreatSelection,
    armBooster, cancelBooster, fireBooster, squadAt, selectSquad, retreatSelectedSquad,
    armBuild, cancelBuild, fireBuild,
  };
}
