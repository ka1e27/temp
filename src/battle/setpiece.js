// THE MUSTER — the enemy's one set-piece, and the only thing it does that the
// player has to answer.
//
// The design argument is in content/setpiece.data.js. This file is the trigger
// and nothing else: it decides WHEN, gathers the host, and hands it to the same
// `launch()` every other assault phase uses. There is no second movement model,
// no scripted path and no special-cased combat — a musterer is an ordinary
// squad from the moment the order is pushed, so every rule that already governs
// a wave (interception on a contested tile, towers on the approach, the melee
// clock, retreat) governs this one for free.
//
// IT IS A PHASE OF `think()`, NOT A PHASE OF `step()`, and that placement is
// deliberate. A hook in the tick loop would fire on a schedule the AI knows
// nothing about, which is how you get an enemy that empties a castle it is
// currently defending. Sitting inside `think()` after `homeGuard` and `defend`
// means the household guard and any site under real threat have already taken
// their troops off the board, and the muster draws from what is genuinely spare.
// PURE.
import { MUSTER } from '../content/setpiece.data.js';
import { EVENTS, pushEvent } from './events.js';
import { total } from './combat.js';
import {
  ME, FOE, sourceFrom, poolOf, launch, threatOn, byId,
} from './aicore.js';
import { distance } from '../core/hex.js';
import { asHex } from './influence.js';

/**
 * Every site that can feed the host, NEAREST THE TARGET FIRST.
 *
 * Shaped on `aihome.js relievers` rather than on `aicore.js adjacentSources`,
 * and the difference is the point: `adjacentSources` is bounded to `site.adj`,
 * which is everything within `MOVEMENT.reachHexes` (4) of the TARGET. The
 * player's camp sits in the corner the enemy does not hold, so on most boards
 * that set is EMPTY and a muster gathered that way could never happen at all —
 * the "built and left unreachable" failure this project has shipped more than
 * once. This walks the whole site list instead.
 *
 * A site holding off its own attack keeps what it has, exactly as `relievers`
 * rules: stripping a gate that is currently being stormed to feed a march
 * across the map loses the gate and thins the host.
 */
export function musterSources(state, target, busy) {
  const here = asHex(target.hex);
  const out = [];
  for (const s of state.sites) {
    if (s.owner !== ME || busy.has(s.id)) continue;
    if (total(threatOn(state, s)) > 0) continue;
    const src = sourceFrom(state, s, 1);
    if (!src) continue;
    out.push({ ...src, d: distance(here, asHex(s.hex)) });
  }
  return out
    .sort((a, b) => a.d - b.d || byId(a.site, b.site))
    .slice(0, MUSTER.maxSources);
}

/** The window, in ticks, derived from this region's own hard cap — see rule 5
 *  in the data table for why there is no per-region column. */
export function musterWindow(state) {
  const cap = state.rules?.hardCapTicks ?? 0;
  if (!(cap > 0)) return null;
  return { from: Math.round(cap * MUSTER.atFrac), to: Math.round(cap * MUSTER.lastFrac) };
}

/**
 * Fire the set-piece if this is the moment and the enemy can raise a host.
 *
 * READS THE TRUE `state`, NOT THE FOGGED `view`, and it is the third deliberate
 * exception beside `homeGuard` and `adapt` — for the same kind of reason. The
 * player's camp is not intelligence: it is where the expedition landed, it is
 * the thing the enemy is defending its country FROM, and its position is the
 * one fact about the player that a defender was never in any doubt about. What
 * the enemy does NOT get from this is the camp's garrison — nothing here reads
 * it, and the host's size is decided entirely by what the enemy itself holds.
 *
 * @returns {boolean} whether it fired
 */
export function muster(state, out, busy) {
  if (state.ai.noMuster) return false;
  // ONCE. See rule 3 — a set-piece that repeats is just another phase.
  if (state.ai.musterTick) return false;
  const win = musterWindow(state);
  if (!win || state.tick < win.from || state.tick > win.to) return false;

  const camp = state.sites.find((s) => s.kind === 'camp' && s.owner === FOE);
  if (!camp) return false;

  const sources = musterSources(state, camp, busy);
  if (!sources.length) return false;
  const host = poolOf(sources, MUSTER.commit);
  const bodies = total(host);
  // A HOST OR NOTHING. Below the floor this returns false WITHOUT setting
  // `musterTick`, so the enemy keeps trying on every think until the window
  // closes — an enemy that is thin at minute eight and rich at minute eleven
  // still gets its moment. A one-shot check at the opening tick would silently
  // spend the whole feature on whichever think happened to land first.
  if (bodies < MUSTER.minBodies) return false;

  const arriveTick = launch(state, out, sources, camp, MUSTER.commit, busy);
  if (!arriveTick) return false;

  state.ai.musterTick = state.tick;
  pushEvent(state, EVENTS.ENEMY_MUSTER, {
    siteId: camp.id,
    // `to` rather than a `defender` field, because `render/fog.js fxVisible`
    // reads exactly `owner`/`attacker`/`from`/`to` — a name it does not know
    // would leave the burst gated on a `canSee` the player passes anyway, which
    // works today and would break the day the camp stops being self-lit.
    to: FOE,
    attacker: ME,
    bodies,
    sources: sources.length,
    arriveTick,
  });
  return true;
}
