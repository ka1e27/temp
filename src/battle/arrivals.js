// PHASE 7: ARRIVALS — what happens when a squad reaches its destination.
//
// Split out of ./sim.js purely for the 400-line cap, the same way ./rally.js
// was, and re-exported from there so the phase order at the top of that file
// still reads as one list. This is the whole of it: the field battle, the
// siege that follows, the skirmishers who get away from a failed probe, and
// the same-tick MERGE that makes synchronised strikes worth coordinating.
// PURE.
import { UNIT_IDS, UNITS } from '../content/balance.js';
import {
  resolveField, siegeDps, emptyComp, addComp, total,
} from './combat.js';
import { siteById, castleSealed } from './state.js';
import { groundOf, siteDefMultOf, garrisonMultOf } from './terrain.js';
import { spawnSquad, retreatTarget } from './movement.js';
import { pushEvent, EVENTS } from './events.js';
import { recordFailedAssault } from './vision.js';

const modOf = (state, faction, key, fallback = 1) => state.mods[faction]?.[key] ?? fallback;
/** Per-troop levels (contract v7). Sparse, and absent in every battle the
 *  balance table was measured with. */
const vetOf = (state, faction) => state.mods[faction]?.unitMult;

/** Both sides' ledgers, from one comparison. Lives here rather than in sim.js
 *  because arrivals is the only phase that kills anybody in a field battle. */
function recordCasualties(state, loser, killer, before, after) {
  const lost = total(before) - total(after);
  if (lost <= 0) return;
  if (state.factions[loser]) state.factions[loser].unitsLost += lost;
  if (state.factions[killer]) state.factions[killer].unitsKilled += lost;
}

// --- phase 7: arrivals ------------------------------------------------------

/**
 * A failed attack sends part of each SKIRMISHING contingent home — why a bad
 * probe costs a fraction, not the squad.
 *
 * Driven off every unit's `skirmish` field, not off `comp.raiders` as it was.
 * The VALUE was already read from the spec, so the hardcoded UNIT was invisible
 * and a second skirmisher would have escaped nothing. tests/units.test.js pins
 * it with a negative control.
 */
export function skirmishHome(state, site, group) {
  for (const sq of group.squads) {
    const escaped = {};
    let back = 0;
    for (const u of UNIT_IDS) {
      const frac = UNITS[u].skirmish;
      if (!frac) continue;
      const n = Math.floor((sq.comp[u] || 0) * frac);
      if (n > 0) { escaped[u] = n; back += n; }
    }
    if (back <= 0) continue;
    const home = siteById(state, sq.from);
    const target = home && home.owner === group.owner
      ? home : retreatTarget(state, site, group.owner);
    if (!target) continue;
    const comp = { ...emptyComp(), ...escaped };
    spawnSquad(state, {
      owner: group.owner, from: site.id, to: target.id, comp, retreating: true,
    });
    state.factions[group.owner].unitsLost -= back;   // they got away after all
    const foe = group.owner === 'player' ? 'enemy' : 'player';
    if (state.factions[foe]) state.factions[foe].unitsKilled -= back;
    pushEvent(state, EVENTS.SKIRMISH_ESCAPE, {
      // `raiders` is kept as the headline count so existing consumers (the HUD
      // toast, tests) keep reading a number rather than becoming undefined; it
      // now means "bodies that got away", which is what it always displayed.
      siteId: site.id, owner: group.owner, raiders: back, escaped, to: target.id,
    });
  }
}

/** Field battle against whoever is holding the ground, not against the walls. */
export function fightStack(state, group, site, holders, holderFaction) {
  // No walls and no bulwark — but the ground is still the ground, so terrain
  // applies here too. Only the FORTIFICATION bonus is absent.
  const r = resolveField(group.comp, holders, {
    siteDefMult: 1, defenderOwnsSite: false,
    attMult: modOf(state, group.owner, 'unitAtkMult'),
    defMult: modOf(state, holderFaction, 'unitDefMult'),
    attUnitMult: vetOf(state, group.owner), defUnitMult: vetOf(state, holderFaction),
    ground: groundOf(state, site),
  });
  recordCasualties(state, group.owner, holderFaction, group.comp, r.attSurvivors);
  recordCasualties(state, holderFaction, group.owner, holders, r.defSurvivors);
  pushEvent(state, EVENTS.FIELD_BATTLE, {
    siteId: site.id, attacker: group.owner, win: r.win,
    attPower: r.attPower, defPower: r.defPower,
  });
  return r;
}

export function resolveArrival(state, group) {
  const site = siteById(state, group.to);
  if (!site) return;
  const owner = group.owner;

  if (site.owner === owner) {
    const besieged = site.siege && site.siege.owner !== owner;
    if (group.mode === 'return' || !besieged) {
      site.garrison = addComp(site.garrison, group.comp);
      pushEvent(state, EVENTS.SQUAD_ARRIVED, {
        siteId: site.id, owner, count: total(group.comp), retreating: group.mode === 'return',
      });
      return;
    }
    // Relief: the besiegers are camped in the open, so no walls and no bulwark.
    const besieger = site.siege.owner;
    const r = fightStack(state, group, site, site.siege.comp, besieger);
    if (r.win) {
      site.siege = null;
      site.garrison = addComp(site.garrison, r.attSurvivors);
      pushEvent(state, EVENTS.SIEGE_LIFTED, { siteId: site.id, by: owner });
    } else {
      site.siege.comp = r.defSurvivors;
    }
    return;
  }

  if (site.siege && site.siege.owner === owner) {
    site.siege.comp = addComp(site.siege.comp, group.comp);
    pushEvent(state, EVENTS.SIEGE_REINFORCED, { siteId: site.id, owner });
    return;
  }
  if (site.siege && total(site.siege.comp) > 0) {
    // Three-way: whoever holds the field outside the walls owns the siege.
    const holder = site.siege.owner;
    const r = fightStack(state, group, site, site.siege.comp, holder);
    if (r.win) site.siege = { owner, comp: r.attSurvivors };
    else site.siege.comp = r.defSurvivors;
    return;
  }

  // READ BEFORE resolveField MUTATES ANYTHING — "the garrison that was there"
  // is this number, not whatever survives the fight. See the loss branch below.
  const defendersBefore = total(site.garrison);
  const r = resolveField(group.comp, site.garrison, {
    // siteDefMultOf, not SITES[kind].defMult: the mountains around a fort are
    // part of how hard it is to take, and sim/preview/AI/harness all read the
    // same function rather than each drifting their own way.
    siteDefMult: siteDefMultOf(state, site),
    garrisonMult: garrisonMultOf(state, site),
    defenderOwnsSite: true,
    attMult: modOf(state, owner, 'unitAtkMult'),
    defMult: modOf(state, site.owner, 'unitDefMult'),
    attUnitMult: vetOf(state, owner), defUnitMult: vetOf(state, site.owner),
    shielded: site.shieldTicks > 0,
    ground: groundOf(state, site),
  });
  recordCasualties(state, owner, site.owner, group.comp, r.attSurvivors);
  recordCasualties(state, site.owner, owner, site.garrison, r.defSurvivors);
  pushEvent(state, EVENTS.FIELD_BATTLE, {
    siteId: site.id, attacker: owner, win: r.win,
    attPower: r.attPower, defPower: r.defPower,
  });

  if (r.win) {
    // Beating the garrison does NOT capture: the siege begins.
    site.garrison = emptyComp();
    site.siege = { owner, comp: r.attSurvivors };
    // `owner` is the BESIEGER; `defender` is whose ground is being taken, and
    // the HUD needs both. Without the second one an enemy siege of a NEUTRAL
    // farm is indistinguishable from an assault on the player, and the alert
    // strip duly cried "UNDER SIEGE" within seconds of every battle opening —
    // while the tutorial was still telling a new player where to drag.
    pushEvent(state, EVENTS.SIEGE_BEGUN, {
      siteId: site.id, kind: site.kind, owner, defender: site.owner, hp: site.hp,
    });
  } else {
    // A FAILED ASSAULT LEAVES A MEMORY — the one deliberate, narrow exception
    // to "a ghost carries nothing that changes" (battle/vision.js
    // `recordFailedAssault`). `owner` is the ATTACKER, and it lost, so this is
    // the size of the force that just beat it — witnessed firsthand, not a
    // sightline snapshot going stale.
    recordFailedAssault(state, owner, site.id, defendersBefore);
    site.garrison = r.defSurvivors;
    skirmishHome(state, site, group);
  }
}

export function arrivalsPhase(state) {
  if (!state.squads.length) return;
  // A CAMPED SQUAD HAS ALREADY ARRIVED and must never arrive again. Its
  // `arriveTick` is in the past forever, so without this filter it would be
  // re-resolved on every single tick from the moment it made camp — which is
  // the shape of bug that reads as "the army is fine" right up until something
  // consumes the duplicate events.
  const landed = state.squads.filter((sq) => !sq.camped && sq.arriveTick <= state.tick);
  if (!landed.length) return;
  state.squads = state.squads.filter((sq) => sq.camped || sq.arriveTick > state.tick);

  // MARCHES ONTO BARE GROUND MAKE CAMP; they resolve nothing and fight nobody.
  // They go back into `state.squads` rather than into a second collection, so
  // every existing consumer — fog, the renderer, the selection, the AI's threat
  // scan — sees them without being taught a new container to look in.
  const groups = {};
  for (const sq of landed) {
    // TWO WAYS TO END UP HOLDING OPEN GROUND, and the second one closes a real
    // hole. `to == null` is the order: march onto bare ground and stay there.
    // A destination that no longer EXISTS is the accident — `razedByCapture`
    // strikes a half-built site off the board mid-flight — and `resolveArrival`
    // answers a missing site with a bare `return`, by which point these squads
    // are already off `state.squads` and simply cease to exist, with no event.
    // The razing path works around that by turning marching armies around
    // first; camping where they stand makes the workaround unnecessary and
    // covers every other way a site can disappear under an order.
    const dest = sq.to == null ? null : siteById(state, sq.to);
    if (!dest) {
      sq.camped = true;
      sq.to = null;
      sq.hex = sq.path?.length ? sq.path[sq.path.length - 1] : sq.hex;
      state.squads.push(sq);
      pushEvent(state, EVENTS.SQUAD_CAMPED, {
        squadId: sq.id, owner: sq.owner, hex: sq.hex, count: total(sq.comp),
      });
      continue;
    }
    const site = siteById(state, sq.to);
    // A retreat is a clean escape only into friendly ground. If the haven fell
    // while they were in the air they have to fight for it after all.
    const mode = sq.retreating && site && site.owner === sq.owner ? 'return' : 'engage';
    const key = `${sq.to}|${sq.owner}|${mode}`;
    const g = groups[key] ?? (groups[key] = {
      to: sq.to, owner: sq.owner, mode, comp: emptyComp(), squads: [],
    });
    g.comp = addComp(g.comp, sq.comp);
    g.squads.push(sq);
  }
  // Sorted keys: deterministic, and 'engage' resolves before 'return' so a
  // retreating stack never gets dragged into someone else's relief battle.
  for (const key of Object.keys(groups).sort()) resolveArrival(state, groups[key]);
}
