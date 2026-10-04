// WHEN each tutorial step may show (PLAYFEEL §4 table), as pure predicates over the facts a scene hands the controller. The steps themselves
// (text, anchor, what marks them seen) are TUTORIAL_STEPS in game/scenes/timing.js; `after` (prerequisite steps) and `needs` (a feature flag) are
// checked by the controller, everything else is here. Nothing in this file touches the DOM or the game state.
//
// World facts:  { scene: 'world', panelsClosed, cardOpen, cardAttackable, cardUnscouted, frontierCount, battlesWon, conquests, realmComplete,
//                 ownedFrontierCount, worksDue, worksRegion, seen(id), features }
// Battle facts: { scene: 'battle', live, t, battlesBefore, ownSites, enemySites, captured, rallyReady, firestormReady, selectedCount,
//                 noRouteSeen, hasBlocked, seen(id), features }

export const RULES = Object.freeze({
  W0: (c) => c.panelsClosed,
  // "drag to move the map" only while the player has not already found a region on their own
  W1: (c) => c.panelsClosed && !c.cardOpen && !c.seen('W2'),
  W2: (c) => c.panelsClosed && !c.cardOpen && c.frontierCount > 0,
  W3: (c) => c.cardOpen && c.cardAttackable,
  B1: (c) => c.live,
  B2: (c) => c.live,
  // explains captures: once the first send has landed and the size hint has had its turn, or the moment the first capture happens
  B3: (c) => c.live && (c.seen('B2') || c.captured >= 1) && c.enemySites > 0,
  B4: (c) => c.live && c.ownSites >= 2,
  B5: (c) => c.live && c.t >= 15 && c.rallyReady,
  // after the player's first capture in THIS battle (it used to fire at 0:02 of the second battle, before anything had been taken)
  C1: (c) => c.live && c.battlesBefore >= 1 && c.captured >= 1,
  // the first refusal ("No route") or 20 s in, and only while there really is a settlement cut off to point at
  C2: (c) => c.live && c.battlesBefore >= 1 && c.hasBlocked && (c.noRouteSeen || c.t >= 20),
  C3: (c) => c.live && c.battlesBefore >= 1 && c.t >= 8 && (!c.features.supply || c.seen('C1')),
  P1: (c) => c.live && c.firestormReady,
  P2: (c) => c.live && c.selectedCount >= 2,
  M1: (c) => c.panelsClosed && c.battlesWon >= 1,
  M2: (c) => c.panelsClosed && c.cardOpen && c.cardUnscouted && c.battlesWon >= 1,
  // after the third conquest, while no Work has ever been built, and only while some owned region has a free slot and a hostile border to point at
  M3: (c) => c.panelsClosed && c.conquests >= 3 && c.ownedFrontierCount > 0 && c.worksDue && c.worksRegion >= 0,
  M4: (c) => c.panelsClosed && c.realmComplete,
  // a war band on its way and its toast's Go on screen (F1 on the map, F2 in a battle elsewhere)
  F1: (c) => c.incoming > 0 && c.raidToast,
  F2: (c) => c.live && c.incoming > 0 && c.raidToast,
  // the first time two battles run at once, while the one you are not watching is in the tray
  F3: (c) => c.live && c.runs >= 2,
  // after the first raid, on a region of yours that borders a rival and still has a free fortification slot
  F4: (c) => c.panelsClosed && c.raids >= 1 && c.fortRegion >= 0 && c.incoming === 0,
  // the commander's ability, in the first battle where it can be used (not the tutorial fight's first seconds)
  G1: (c) => c.live && c.battlesBefore >= 1 && c.abilityReady && c.t >= 4,
  // a skill to choose (after the first level-up)
  G2: (c) => c.panelsClosed && c.pendingPicks > 0,
  // the first time Renown pays for a Festival somewhere
  R1: (c) => c.panelsClosed && c.festivalRegion >= 0,
  // a varied map (DESIGN 10.13): a typed or twisted region on the frontier; the first Siege while its Gate stands; the first Raid; the Dragon's
  // warning while it is on the ground (and the Bulwark is unlocked); a world event's offer on screen
  V1: (c) => c.panelsClosed && !c.cardOpen && c.featureRegion >= 0,
  V2: (c) => c.live && c.gateStanding,
  V3: (c) => c.live && c.raid,
  V4: (c) => c.live && c.telegraph && c.bulwarkUnlocked,
  V5: (c) => c.eventToast,
  // Goals and Rivals (PLAN-PHASE4): the board has opened (after the first conquest beyond home); a Vendetta's banner with its Go on screen
  Q1: (c) => c.panelsClosed && !c.cardOpen && !!c.boardUnlocked,
  Q2: (c) => !!c.vendettaToast,
  // Phase 5: D1 lives in the ceremony (never picked by a scene); D2 while an open card shows a Quick Conquest button that can go
  D1: () => false,
  D2: (c) => c.panelsClosed && c.cardOpen && !!c.quickReady,
  // Phase 6: an Ashen region on the frontier (its label), while no card or panel is open
  A1: (c) => c.panelsClosed && !c.cardOpen && c.ashenRegion >= 0,
  // Phase 7: K1 lives in the first Boon draft (never picked by a scene); L1 a Relic's region on the frontier, while no card or panel is open
  K1: () => false,
  L1: (c) => c.panelsClosed && !c.cardOpen && c.relicRegion >= 0,
});
