// The outcome preview: the design's load-bearing promise, as pure functions.
//
// Combat contains no RNG at all, so this panel is not a prediction — it is a
// guarantee. That only holds because it calls resolveField() and
// breachSeconds() DIRECTLY, the same functions the simulation calls. Nothing
// here re-implements combat maths, and nothing here may.
//
// Split out of battle-hud.js so the maths can be read, tested and reasoned
// about without a DOM anywhere near it. battle-hud.js re-exports all of it, so
// every existing import path still works.
// PURE: no DOM, no clock.
import { UNIT_IDS, UNITS, SITES, SITE_LEVELS } from '../content/balance.js';
import { reachSupport } from '../battle/meleephase.js';
/** Nobody to exclude — same as the sim's own site-melee projection. */
const NO_ENGAGED = new Set();
import { resolveField, breachSeconds, projectHp, scaleComp, total, emptyComp, addComp }
  from '../battle/combat.js';
import { travelTicks, pathBetween } from '../battle/movement.js';
import { projectMarchLosses } from '../battle/towers.js';
import { groundOf, siteDefMultOf, garrisonMultOf } from '../battle/terrain.js';
import { perceivedSite, perceivedSquads } from '../battle/vision.js';
import { TICK_HZ } from '../core/loop.js';
import { fixed, duration, plural } from '../ui/format.js';

export const siteOf = (state, id) => state.sites.find((s) => s.id === id) || null;

export const levelSpec = (site) =>
  SITE_LEVELS[Math.min(SITE_LEVELS.length - 1, Math.max(0, site.level - 1))];

function filtered(comp, filter) {
  const out = emptyComp();
  for (const u of UNIT_IDS) if (!filter || filter.includes(u)) out[u] = comp[u] || 0;
  return out;
}

/**
 * Travel time straight from battle/movement.js — the SAME function the sim uses
 * to stamp a squad's arriveTick. Re-deriving it here would reintroduce exactly
 * the drift the "no RNG, exact preview" promise exists to prevent, so the ETA
 * is a fact for the same reason the combat numbers are.
 *
 * Still injectable (`travelSeconds`) so tests can pin a value.
 */
export function travelSecondsFor(state, from, to, comp) {
  return travelTicks(state, from, to, comp, 'player') / TICK_HZ;
}

/**
 * The force that actually reaches `to`, after every gun on the way in.
 *
 * Kept beside `projectGarrison` because they are the same idea pointed at the
 * two sides of the fight: both project a deterministic process forward over the
 * flight, so the preview describes the battle that will happen rather than the
 * one that would happen if it started now.
 */
function marchArrival(state, from, to, comp, etaSeconds) {
  const path = pathBetween(state, from, to, 'player');
  if (!path || path.length < 2) return comp;
  const spawnTick = state.tick;
  return projectMarchLosses(state, {
    path, owner: 'player', comp, spawnTick, toId: to.id,
    arriveTick: spawnTick + Math.max(1, Math.round(etaSeconds * TICK_HZ)),
  });
}

/** In-progress training is deterministic, so the preview can honestly show the
 *  garrison the attacker will actually meet rather than today's number. */
export function projectGarrison(state, site, seconds) {
  const g = { ...site.garrison };
  const spec = SITES[site.kind];
  if (!spec.train) return g;
  const mods = state.mods?.[site.owner] ?? {};
  const unit = UNITS[site.trainType] || UNITS.militia;
  const speed = spec.train * levelSpec(site).train * (mods.trainSpeedMult ?? 1);
  const cycles = (site.trainProgress || 0) + (seconds * speed) / unit.trainSec;
  const made = Math.floor(cycles) * (unit.batch || 1);
  if (made <= 0) return g;
  const cap = spec.cap + levelSpec(site).cap + (mods.garrisonCapBonus ?? 0);
  const room = Math.max(0, cap - total(g));
  g[site.trainType] = (g[site.trainType] || 0) + Math.min(made, room);
  return g;
}

/**
 * ENEMY COLUMNS ALREADY IN THE AIR FOR THE SAME SITE, and this was a lie the
 * preview told.
 *
 * `projectGarrison` projects the defender's TRAINING forward over the flight,
 * on the correct reasoning that the preview should describe the battle that will
 * happen rather than the one that would happen if it started now. A column the
 * enemy has already dispatched is exactly as deterministic — it has a path, a
 * spawn tick and an arrive tick, none of them random — and it was simply not
 * counted. So the preview would promise a win against thirty defenders while a
 * relief column of twenty landed the tick before the player did.
 *
 * FOG-GATED, through `perceivedSquads` rather than the raw list, for the reason
 * everything else in this file is: a preview that folded in a column the player
 * cannot see would be leaking the position of every enemy army through an
 * arithmetic side channel. What you cannot see does not count — and that is
 * precisely the uncertainty `reinforceMargin` below reports instead.
 */
function inboundDefenders(state, to, etaSeconds) {
  const out = emptyComp();
  const by = state.tick + Math.max(1, Math.round(etaSeconds * TICK_HZ));
  let any = false;
  for (const sq of perceivedSquads(state, 'player')) {
    if (sq.owner === 'player' || sq.to !== to.id) continue;
    if (sq.arriveTick > by) continue;      // lands after the fight is decided
    for (const u of UNIT_IDS) {
      const n = sq.comp?.[u] || 0;
      if (n > 0) { out[u] = (out[u] || 0) + n; any = true; }
    }
  }
  return any ? out : null;
}

/**
 * HOW MANY MORE DEFENDERS WOULD FLIP THIS, and it is the honest half of the
 * "the preview is a guarantee" promise rather than a softening of it.
 *
 * Invariant 3 says the pre-commit preview calls the same functions the
 * simulation runs, so it is a guarantee. That has always been true of the
 * arithmetic and never true of the WORLD: the enemy can dispatch a column
 * during the player's flight, and no amount of determinism makes that knowable.
 * The old preview handled it by not mentioning it, which turns every attack
 * into a solved sum the game has already shown you the answer to.
 *
 * So it reports a THRESHOLD rather than a range: "you win — unless 12 more
 * arrive first". Everything about that number is exact, because it is the same
 * `resolveField` solved for the breakeven; what is uncertain is whether the
 * enemy will, which is a judgement about the board that belongs to the player.
 * The guarantee is kept by saying MORE, not less — the multi-source preview
 * keeps it by saying less, and both are the same rule: never claim what you
 * cannot keep.
 *
 * Bisection over whole bodies of the garrison's own composition, capped so a
 * hopeless margin reports nothing rather than a silly number.
 */
const MARGIN_CAP = 400;
function reinforceMargin(defenders, fight, cap = MARGIN_CAP) {
  const base = total(defenders);
  if (base <= 0) return null;
  // Reinforcements look like the garrison already there: the enemy sends what
  // it trains, and a guess at some other composition would be a second model.
  const scaled = (n) => scaleComp(defenders, n / base);
  let lo = 0;
  let hi = 1;
  while (hi <= cap && fight(scaled(base + hi)).win) hi *= 2;
  if (hi > cap) return null;               // no plausible relief flips it
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fight(scaled(base + mid)).win) lo = mid; else hi = mid;
  }
  return hi;
}

/**
 * The exact outcome of sending `fraction` of `fromId`'s garrison at `toId`.
 * PURE — no DOM, no clock. Tested headlessly.
 * @returns {object|null}
 */
export function computePreview(state, fromId, toId, o = {}) {
  const from = siteOf(state, fromId);
  const to = siteOf(state, toId);
  if (!from || !to || from.id === to.id) return null;

  const sent = scaleComp(filtered(from.garrison, o.filter), o.fraction ?? 0.5);
  const eta = (o.travelSeconds || travelSecondsFor)(state, from, to, sent);

  // WHAT ARRIVES, NOT WHAT SETS OFF. Towers shoot a column all the way in
  // (battle/towers.js), so an army that walks up to a stronghold reaches it
  // smaller — and the DEFENDER's power is a function of the attacker's
  // composition, because `counters` scale by the share of the foe that is the
  // countered type. Previewing the force that departed would quietly break the
  // one promise this file exists to keep: measured, a column of 30 militia and
  // 6 raiders lost a single body on the approach, which moved the raider share
  // by 0.4 points, which moved the defending spearwall's power by 1%.
  //
  // Projectable rather than guessable for exactly the reason `projectGarrison`
  // below can project the defender's training: the route is known at commit
  // time and nothing in it is random.
  const send = marchArrival(state, from, to, sent, eta);
  const sendN = total(send);

  // AN UNSCOUTED TARGET GETS NO PREVIEW — decision 10, and it collides with
  // this file's own header on purpose. The guarantee below only holds because
  // every number past this point comes off the SAME functions the simulation
  // resolves combat with, and that cannot extend to a garrison the player has
  // never seen. sendN and eta are exempt: they describe the player's own
  // troops and the ground under them, neither of which fog hides, so a blind
  // send still gets those two numbers and nothing else.
  if (perceivedSite(state, 'player', to).ghost) {
    const pv = {
      from: from.id, to: to.id, sendN, send, eta, kind: 'unscouted', verdict: 'UNSCOUTED',
    };
    pv.line = previewLine(pv);
    return pv;
  }

  const mods = state.mods || {};
  const regenMult = mods[to.owner]?.structureRegenMult ?? 1;
  const siegeMult = mods.player?.siegeDmgMult ?? 1;
  const pv = { from: from.id, to: to.id, sendN, send, eta, hpMax: to.hpMax };

  const relieving = to.siege && to.siege.owner !== 'player';
  if (to.owner === 'player' && !relieving) {
    pv.kind = 'reinforce';
    pv.verdict = 'REINFORCE';
    pv.line = `REINFORCE +${sendN} · ETA ${duration(eta)}`;
    return pv;
  }

  // Relieving your own besieged site means fighting the besiegers in the open:
  // no walls, no bulwark. Sieges being interruptible is what makes reinforcing
  // dramatic, so the preview has to model it.
  // Terrain is read through the SAME two functions the simulation uses. A
  // preview that ignored the ground would be a lie in exactly the places the
  // player most needs the truth — the mountain fort and the river farm.
  const ground = groundOf(state, to);
  const atHex = { q: to.hex[0], r: to.hex[1] };
  // THE FIGHT AS IT STANDS, and the inbound column is deliberately NOT folded
  // into it. Folding was the first cut and it quietly downgraded the guarantee
  // to an estimate: a relief that lands MID-MELEE does not resolve as though
  // both sides had been present from the start — `reprojectDefender` banks the
  // casualties so far and re-projects from the merged force with the remaining
  // clock, so `resolveField(send, garrison + inbound)` is a different sum from
  // what the simulation will actually do.
  //
  // So the column is REPORTED rather than absorbed, which is this file's own
  // established rule arriving one branch along: `computeMultiPreview` keeps the
  // promise by withholding a verdict it cannot keep instead of softening one,
  // and so does the unscouted branch above. The player gets both numbers — what
  // is coming, and how much would flip it — and makes the comparison the game
  // used to make silently and wrongly.
  const inbound = relieving ? null : inboundDefenders(state, to, eta);
  const defenders = relieving ? to.siege.comp : projectGarrison(state, to, eta);
  const fightOpts = {
    siteDefMult: relieving ? 1 : siteDefMultOf(state, to),
    // Same conditional as siteDefMult, same reason: relief is fought in the
    // open, so the garrison's own-site bonus does not apply either. Diverging
    // from arrivals.js here is exactly the drift this file exists to prevent.
    garrisonMult: relieving ? 1 : garrisonMultOf(state, to),
    defenderOwnsSite: !relieving,
    attMult: mods.player?.unitAtkMult ?? 1,
    defMult: mods[relieving ? to.siege.owner : to.owner]?.unitDefMult ?? 1,
    // Per-troop levels, on BOTH sides — the preview is a guarantee, not an
    // estimate, and it only stays one if every term the sim reads reaches here.
    attUnitMult: mods.player?.unitMult,
    defUnitMult: mods[relieving ? to.siege.owner : to.owner]?.unitMult,
    shielded: !relieving && (to.shieldTicks || 0) > 0,
    ground,
    // Archers a hex back, on BOTH sides, for the same reason the per-troop
    // levels above are here: the preview is a guarantee, and it only stays one
    // if every term the sim reads reaches this call. The sim reads its support
    // fresh at projection time, so a bowman who has not moved is counted the
    // same way here — and a squad standing ON the site is refused by
    // `reachSupport` in both places, so the two cannot disagree about who is
    // shooting and who is fighting.
    attSupport: reachSupport(state, 'player', atHex, NO_ENGAGED),
    defSupport: reachSupport(state, relieving ? to.siege.owner : to.owner, atHex, NO_ENGAGED),
  };
  const res = resolveField(send, defenders, fightOpts);

  pv.kind = relieving ? 'relieve' : 'assault';
  pv.ap = res.attPower;
  pv.dp = res.defPower;
  pv.win = res.win;
  pv.survivors = total(res.attSurvivors);
  pv.attSurvivors = res.attSurvivors;
  pv.defSurvivors = total(res.defSurvivors);
  pv.skirmish = res.win ? 0 : Math.floor((send.raiders || 0) * (UNITS.raiders.skirmish ?? 0));
  // WHAT THE PLAYER IS ACTUALLY BETTING ON. Only on a win: telling somebody
  // already losing how much worse it could get is noise, and the decision it
  // informs — commit now or wait — only exists on the other side.
  pv.inboundN = inbound ? total(inbound) : 0;
  pv.margin = res.win
    ? reinforceMargin(defenders, (d) => resolveField(send, d, fightOpts))
    : null;
  // AND A WIN THAT VISIBLE INFORMATION CONTRADICTS IS NOT CLAIMED AT ALL. The
  // arithmetic still says `win`, and it is still exactly right about the fight
  // it describes — but a column the player can SEE, big enough to cross the
  // margin, will make that a different fight. Printing WIN FIELD over the top
  // of it is the preview lying in the most prominent place it has.
  pv.contested = !!(res.win && pv.margin !== null && pv.inboundN >= pv.margin);
  pv.verdict = pv.contested
    ? 'CONTESTED'
    : (res.win ? (relieving ? 'BREAK SIEGE' : 'WIN FIELD') : 'LOSE FIELD');

  if (res.win && !relieving) {
    const hp = projectHp(to.hp, eta, to.kind, to.level, regenMult);
    pv.hp = hp;
    pv.breachSec = breachSeconds(
      res.attSurvivors, hp, to.kind, to.level, siegeMult, regenMult, ground,
    );
    pv.insufficient = !Number.isFinite(pv.breachSec);
  }
  pv.line = previewLine(pv);
  return pv;
}

/** `AP 239.8 / DP 238.8 · WIN FIELD · 3 survive · BREACH 31s · ETA 4.2s` */
export function previewLine(pv) {
  if (!pv) return '';
  if (pv.kind === 'reinforce') return `REINFORCE +${pv.sendN} · ETA ${duration(pv.eta)}`;
  // No AP/DP/verdict on a garrison nobody has seen — see the ghost branch above.
  if (pv.kind === 'unscouted') return `UNSCOUTED · ETA ${duration(pv.eta)}`;
  const parts = [`AP ${fixed(pv.ap)} / DP ${fixed(pv.dp)}`, pv.verdict];
  // A contested fight claims no survivor count, for the reason a multi-source
  // send claims no verdict: the number would be confident and wrong.
  if (pv.win && !pv.contested) parts.push(plural(pv.survivors, 'survives', 'survive'));
  else if (pv.skirmish > 0) parts.push(`${pv.skirmish} skirmish home`);
  if (pv.win && !pv.contested && pv.breachSec !== undefined) parts.push(`BREACH ${duration(pv.breachSec)}`);
  // WHAT THE PLAYER IS BETTING ON. The verdict above is exact arithmetic over a
  // world that can change while the column is in the air, and saying so is what
  // turns a solved sum back into a decision. Only on a win, and only when a
  // plausible relief could flip it — a margin of four hundred is not a bet.
  if (pv.margin) parts.push(`unless +${pv.margin} arrive`);
  if (pv.inboundN > 0) parts.push(`${pv.inboundN} inbound`);
  parts.push(`ETA ${duration(pv.eta)}`);
  return parts.join(' · ');
}

/**
 * CONCENTRATING FORCE: the preview for a drag that commits every player-owned
 * site in the selection, not just the one under the pointer.
 *
 * NO COMBINED OUTCOME, and that is the point rather than a gap. Summing the
 * comps and calling `resolveField` once would be a plausible, confident,
 * WRONG number: the columns are at different distances, so `travelTicks`
 * differs per source and they arrive as SEPARATE waves — and since the melee
 * layer, a later wave REINFORCES an ongoing fight rather than joining one
 * simultaneous one. Invariant 3 is that the preview never claims a number it
 * cannot keep; withholding the outcome here is how a multi-source send keeps
 * that promise the same way a single send keeps it by calling `resolveField`
 * directly.
 *
 * What IS honestly knowable at commit time: how many columns, how many
 * troops in total, and the arrival SPREAD — first and last ETA, off the same
 * `travelTicks` the sim will stamp on every squad (`travelSecondsFor` is the
 * exact function the single-source preview above already wraps).
 * @param {object} state @param {string[]} fromIds every candidate source
 * @param {string} toId @param {{fraction?:number, filter?:string[],
 *          travelSeconds?:Function}} [o]
 * @returns {object|null} null when nothing would actually be sent
 */
export function computeMultiPreview(state, fromIds, toId, o = {}) {
  const to = siteOf(state, toId);
  if (!to) return null;
  const fraction = o.fraction ?? 0.5;
  let send = emptyComp();
  let etaMin = Infinity;
  let etaMax = 0;
  let columns = 0;
  for (const fromId of fromIds) {
    const from = siteOf(state, fromId);
    if (!from || from.owner !== 'player' || from.id === to.id) continue;
    const sent = scaleComp(filtered(from.garrison, o.filter), fraction);
    if (total(sent) <= 0) continue;
    const eta = (o.travelSeconds || travelSecondsFor)(state, from, to, sent);
    send = addComp(send, sent);
    if (eta < etaMin) etaMin = eta;
    if (eta > etaMax) etaMax = eta;
    columns++;
  }
  if (columns === 0) return null;
  const sendN = total(send);
  return {
    kind: 'multi', to: to.id, columns, send, sendN, etaMin, etaMax,
    line: multiPreviewLine(columns, sendN, etaMin, etaMax),
  };
}

/** `3 columns · 214 troops · arriving 4.2s–9.8s` */
export function multiPreviewLine(columns, sendN, etaMin, etaMax) {
  const spread = etaMax > etaMin ? `${duration(etaMin)}–${duration(etaMax)}` : duration(etaMin);
  return `${plural(columns, 'column', 'columns')} · ${sendN} troops · arriving ${spread}`;
}
