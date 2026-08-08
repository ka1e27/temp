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
import { travelTicks } from '../battle/movement.js';
import { groundOf, siteDefMultOf } from '../battle/terrain.js';
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

  const send = scaleComp(filtered(from.garrison, o.filter), o.fraction ?? 0.5);
  const sendN = total(send);
  const eta = (o.travelSeconds || travelSecondsFor)(state, from, to, send);
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
    defenderOwnsSite: !relieving,
    attMult: mods.player?.unitAtkMult ?? 1,
    defMult: mods[relieving ? to.siege.owner : to.owner]?.unitDefMult ?? 1,
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
  const parts = [`AP ${fixed(pv.ap)} / DP ${fixed(pv.dp)}`, pv.verdict];
  if (pv.win) parts.push(plural(pv.survivors, 'survives', 'survive'));
  else if (pv.skirmish > 0) parts.push(`${pv.skirmish} skirmish home`);
  if (pv.win && pv.breachSec !== undefined) parts.push(`BREACH ${duration(pv.breachSec)}`);
  parts.push(`ETA ${duration(pv.eta)}`);
  return parts.join(' · ');
}

/**
 * Gold per second a faction is currently earning.
 *
 * KNOWN WRONG, and no longer on any screen: it re-derives the farm rate instead
 * of calling siteGoldPerSec(), so it disagrees with the treasury in three ways
 * — it ignores the attrition ladder's farmMult, ignores the AI's economy
 * handicap (an enemy on tier 1 really earns 0.65x this), and reads `site.level`
 * where a site mid-upgrade produces at the OLD level. The HUD now reads
 * battle-econ.js `goldFlow()`, which sums the simulation's own per-site
 * function. Delete this and its re-export from battle-hud.js — the only thing
 * holding it up is tests/preview.test.js:191, which asserts the drifted number.
 */
export function income(state, faction) {
  const mods = state.mods?.[faction] ?? {};
  let g = 0;
  for (const s of state.sites) {
    if (s.owner !== faction) continue;
    const spec = SITES[s.kind];
    if (!spec.gold) continue;
    g += spec.gold * levelSpec(s).gold * (mods.goldRateMult ?? 1)
      * (s.kind === 'farm' ? (mods.farmYieldMult ?? 1) : 1);
  }
  return g;
}
