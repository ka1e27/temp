// The Sea Kings (docs/PLAN-PHASE12.md): archipelago continents, fords, harbours, sea lanes, the Sea Kings faction, the Tide Fortress
// and Broadside. Every number the feature uses lives here, with its reason. Read by game/world/archipelago.js (generation),
// game/battle/sea.js + routing.js + arena.js (the sim), game/meta/rivals.js (the rotation) and the tools. The Admiral's numbers sit
// with the other Generals (config/generals.js), the Sea Queen's lines in config/leadersSea.js.

export const SEA_FACTION = 6;

export const ARCHIPELAGO = Object.freeze({
  fromDynasty: 3,         // PLAN 12A: from dynasty 3 ...
  chanceOneIn: 3,         // ... a seeded 1-in-3 chance per founding
  islands: Object.freeze([3, 5]), // PLAN 12A: 3-5 islands
  // The start island grows this much faster than the others while the regions are dealt out, so it is always the largest (PLAN 12A:
  // the start region is on the largest island); 1.6 leaves room for the three rival sectors on the other islands.
  startWeight: 1.6,
  minIslandRegions: 3,    // an island of 1-2 regions reads as a stray rock, not a place to conquer: fewer islands instead
});

export const FORD = Object.freeze({
  // PLAN 12A: shallow sea tiles squads cross at x2.5 march cost. Open ground costs 1.0 (config/world.js TERRAIN_COST.grass), so a ford
  // tile costs 2.5 whatever it was before the strait was cut (a road across a strait does not make it a bridge).
  marchMult: 2.5,
  baseCost: 1.0,
  // A strait is cut along the boundary between two islands: the boundary tile on EACH side becomes a ford (a strait two tiles wide).
  // Settlement tiles stay dry land (a landing point on the strait).
});

export const HARBOUR = Object.freeze({
  perIsland: Object.freeze([1, 2]), // PLAN 12A: 1-2 harbours per island ...
  secondFromRegions: 6,   // ... the second only on an island of at least this many regions
  minGap: 6,              // hexes between two harbours of one island (the second sits on another stretch of coast)
  // The harbour site of a battle arena (PLAN 12A): a coastal region of an archipelago gets one. Its own harbour settlement is it; a
  // region without one gets a small quay site on its coast with this garrison x the troop multiplier (a hamlet's 8: one more soft
  // target, not a second keep).
  quayTroops: 8,
});

export const LANE = Object.freeze({
  // PLAN 12A: a sea lane is a fast path along the coast at x0.6 march cost: each sea tile on it costs 0.6 (open ground 1.0).
  tileCost: 0.6,
  worldMaxTiles: 40,      // world map: two ports further apart than this many sea tiles get no lane (a dotted arc across the map reads as noise)
  battleMaxTiles: 18,     // a battle's lane between two coastal sites: at most this many sea tiles (longer is no longer "along the coast")
  battlePad: 3,           // hexes of sea around the arena's land a battle lane may use
});

export const TIDE = Object.freeze({
  // PLAN 12B: the Tide Fortress (a 'raider' capital). Every 40 s the ford tiles around it flood for 10 s; squads caught on them lose 30%,
  // telegraphed 4 s ahead (the tideRising event, then tideFlood). The fortress's own squads know the tide and are spared.
  everySec: 40,
  floodSec: 10,
  telegraphSec: 4,
  loss: 0.3,
  radius: 4,              // hexes from the fortress's keep: the fords that flood when no approach route wades (see routeRadius)
  // The tide floods where the attack wades: the TIDAL tiles (fords, and land touching open sea or a ford) on the cheapest paths from every
  // other site to the Gate and the keep, within this many hexes of the keep (coordinator after Phase 12: fords off the attack path drowned
  // nobody). Measured on 12 campaign fortresses: the tide touches a squad in every fight, costs >= 1% of the attack in 8 and >= 2% in 4,
  // 3.1% of all troops sent overall (at most 9.3% in one fight), no timeouts.
  routeRadius: 5,
  keepShore: 2,           // ... plus the fords and shore tiles this close to the keep (where every assault on it ends)
  // A fortress with no ford within `radius` floods the coastal shore tiles of its region instead (the tide still comes in), at most this many
  fallbackTiles: 8,
  // Holding the fortress's harbour site stops its reinforcements arriving by sea (PLAN 12B). While the Sea Kings hold it, a boat lands
  // `growthSec` seconds of the keep's own growth at the keep every `everySec` (min `minTroops`): +40% regrowth, a trickle the player cuts by
  // taking the harbour. Measured on the keep's growth, not its garrison: 5% of the starting garrison every 20 s (0.25%/s) out-grew the keep
  // 10x at D3 and timed out the bot on 3 of 17 Tide Fortress fights (one seed 900 s three times).
  reinforce: Object.freeze({ everySec: 20, growthSec: 8, minTroops: 3 }),
});

export const BROADSIDE = Object.freeze({
  // The Admiral's ability (PLAN 12B): for 8 s every coastal enemy site loses 2% of its troops per second
  duration: 8,
  perSec: 0.02,
});

// The 'raider' AI (game/battle/ai.js PERSONALITY.raider): holds its land lightly and slips away by sea. Like an aggressive faction with a
// thin keep guard; `longships` adds the evacuation move (a coastal site it cannot save sends its garrison by lane to another).
export const RAIDER_AI = Object.freeze({
  tuning: Object.freeze({
    reserve: 0.12, keepGuard: 0.6, margin: 1.1, maxCommit: 0.9, waves: 2, thinkMult: 0.9, open: 5,
    extend: 2.5, softOnly: false, neutrals: true, losing: 0.4, sources: 3, longships: true,
  }),
  evacuateAt: 1.3,        // a coastal site facing an attack this many times its garrison's strength (and no help in time) evacuates
  evacuateShare: 0.9,     // the share of the garrison that sails away
});

export const SEA = Object.freeze({
  factionId: SEA_FACTION,
  copy: Object.freeze({
    ceremony: 'The House of {house} sets sail: an archipelago of {n} islands awaits.',
    cardFords: 'Fords: {n} shallow crossings at ×{mult} march cost',
    cardLane: 'Sea lanes: your harbours sail troops at ×{mult} march cost',
    cardHarbour: 'Harbour: holding it opens the sea lanes',
    cardTide: 'The Tide: every {sec} s the fords flood for {flood} s (−{pct} to squads on them)',
    cardRaider: 'Raiders: they strike from the sea at any coast of yours',
    hint: 'Fords cross the straits slowly. Hold two harbours and your troops sail between them.',
  }),
});
