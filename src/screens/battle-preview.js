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
import { resolveField, breachSeconds, projectHp, scaleComp, total, emptyComp }
  from '../battle/combat.js';
import { travelTicks, pathBetween } from '../battle/movement.js';
import { projectMarchLosses } from '../battle/towers.js';
import { groundOf, siteDefMultOf, garrisonMultOf } from '../battle/terrain.js';
import { perceivedSite } from '../battle/vision.js';
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
  const defenders = relieving ? to.siege.comp : projectGarrison(state, to, eta);
  const res = resolveField(send, defenders, {
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
  });

  pv.kind = relieving ? 'relieve' : 'assault';
  pv.ap = res.attPower;
  pv.dp = res.defPower;
  pv.win = res.win;
  pv.survivors = total(res.attSurvivors);
  pv.attSurvivors = res.attSurvivors;
  pv.defSurvivors = total(res.defSurvivors);
  pv.skirmish = res.win ? 0 : Math.floor((send.raiders || 0) * (UNITS.raiders.skirmish ?? 0));
  pv.verdict = res.win ? (relieving ? 'BREAK SIEGE' : 'WIN FIELD') : 'LOSE FIELD';

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
  if (pv.win) parts.push(plural(pv.survivors, 'survives', 'survive'));
  else if (pv.skirmish > 0) parts.push(`${pv.skirmish} skirmish home`);
  if (pv.win && pv.breachSec !== undefined) parts.push(`BREACH ${duration(pv.breachSec)}`);
  parts.push(`ETA ${duration(pv.eta)}`);
  return parts.join(' · ');
}
