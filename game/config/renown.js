// Renown, the second currency (DESIGN §10.7, §10.12): what deeds pay and what spends cost. Every number lives here; read by
// game/meta/renown.js. Renown belongs to the dynasty (reset by a new one); Generals keep their levels.

export const RENOWN = Object.freeze({
  // --- Earned (DESIGN §10.12) ---------------------------------------------------------------------------------------------------
  earn: Object.freeze({
    crown: 1,               // each crown won (awardCrowns)
    defenseWon: 2,          // a defense won ...
    defenseUnbroken: 1,     // ... +1 when no settlement was lost
    retake: 2,              // retaking an occupied region
    capital: 3,             // toppling a rival capital
  }),
  // --- Spent (DESIGN §10.12 starting values) --------------------------------------------------------------------------------------
  cost: Object.freeze({
    festivalPerLevel: 3,    // a Festival to prosperity level L costs festivalPerLevel x L ...
    festivalRise: 0.25,     // ... x (1 + this x the festivals already held this dynasty), rounded up
    trainPerLevel: 2,       // Training: 2 x the General's current level
    mercenary: 12,          // hire a mercenary (up to GENERALS.maxMercenaries)
    muster: 1,              // refill a region's militia now
    heal: 2,                // a wounded General returns now
    respec: 5,              // a General picks their skills again
  }),
  copy: Object.freeze({
    names: Object.freeze({ festival: 'Festival', train: 'Train', hire: 'Hire', muster: 'Muster', heal: 'Heal', respec: 'Respec' }),
    reasons: Object.freeze({
      renown: 'Need {n} more Renown', notOwned: 'Hold this region first', maxed: 'Already at the top', full: 'No room for more',
      notWounded: 'Not wounded', noSkills: 'No skills to reset', unknown: 'Not available', full_militia: 'Militia already full',
      busy: 'Commanding a battle',
    }),
  }),
});
