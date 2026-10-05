// Deeds (PLAN-PHASE4 §4C): persistent milestones in bronze, silver and gold tiers. They are LIFETIME progress, stored with the
// Generals roster (state.generals.deeds) so they survive Found a Dynasty and New Realm the way the roster does. Every number lives
// here; read by game/meta/deeds.js, which folds the rewards into the game in one place (deedBonuses).
//
// Budget (PLAN §4C: at most +10% power-equivalent with everything earned). With every tier earned the army gains +6% garrison
// defence (Warden, settlements only) and +3% attack against a faction whose capital you have toppled (Kingbreaker, one faction per
// fight); the economy +3% income and +3% conquest bounty. Everything else is convenience (rerolls, a longer streak window,
// cheaper Festivals and fortifications, General XP, Renown). The `caps` below enforce the budget whatever the table says.
//
// `key` is the progress counter (game/meta/deeds.js recordDeed): 'sum' keys add up, 'max' keys keep the best value seen.
// 'capitals' is derived: the number of distinct rival factions whose capital you have toppled (keys 'capital:<faction>').

export const DEED_TIERS = Object.freeze(['bronze', 'silver', 'gold']);

export const DEED_KEYS = Object.freeze({
  conquer: 'sum',              // regions conquered (retakes do not count)
  defense: 'sum',              // defenses won
  crowns: 'sum',               // battle crowns earned
  dragon: 'sum',               // Dragons slain
  bounty: 'sum',               // Bounty Board contracts completed
  fortLevels: 'sum',           // fortification levels built (a build or an upgrade is one level)
  duel: 'sum',                 // Duels won
  vendetta: 'sum',             // Vendettas beaten
  streak: 'max',               // the best conquest streak
  prosperity: 'max',           // the highest prosperity level a held region reached
  generalLevel: 'max',         // the highest level a General reached
  relics: 'max',               // Relics in the lifetime Reliquary (PLAN-PHASE7 §7B: each new find is a step)
});

/**
 * One deed: `tiers[i]` is the goal of tier i (bronze, silver, gold); every tier earned adds `per` to the reward `stat`.
 * `text` is the reward line ({v} = the per-tier value, as the UI should format it).
 */
export const DEEDS = Object.freeze([
  { id: 'conqueror', name: 'Conqueror', icon: 'banner', key: 'conquer', tiers: [10, 50, 200], stat: 'incomeMult', per: 0.01, text: '+{v}% income' },
  { id: 'warden', name: 'Warden', icon: 'shield', key: 'defense', tiers: [5, 25, 100], stat: 'defenceMult', per: 0.02, text: '+{v}% settlement defence' },
  { id: 'crowned', name: 'Crowned', icon: 'crown', key: 'crowns', tiers: [25, 100, 300], stat: 'bountyMult', per: 0.01, text: '+{v}% conquest bounty' },
  { id: 'dragonslayer', name: 'Dragonslayer', icon: 'dragon', key: 'dragon', tiers: [1], stat: 'renownAtDynastyStart', per: 1, text: '+{v} Renown at each dynasty start' },
  { id: 'kingbreaker', name: 'Kingbreaker', icon: 'throne', key: 'capitals', tiers: [1, 2, 3], stat: 'attackVs', per: 0.03, text: '+{v}% attack against each faction whose capital you toppled' },
  { id: 'contractor', name: 'Contractor', icon: 'scroll', key: 'bounty', tiers: [10, 40, 120], stat: 'freeRerolls', per: 1, text: '+{v} free reroll each dynasty' },
  { id: 'unstoppable', name: 'Unstoppable', icon: 'flame', key: 'streak', tiers: [3, 5, 8], stat: 'streakWindowSec', per: 30, text: 'Streak window +{v} s' },
  // PLAN said Prosperity III / IV; prosperity tops out at III (config/prosperity.js), so the tiers are II and III
  { id: 'patron', name: 'Patron', icon: 'wheat', key: 'prosperity', tiers: [2, 3], stat: 'festivalDiscount', per: 0.05, text: 'Festivals {v}% cheaper' },
  { id: 'mentor', name: 'Mentor', icon: 'laurel', key: 'generalLevel', tiers: [5, 10], stat: 'xpMult', per: 0.05, text: '+{v}% General XP' },
  { id: 'builder', name: 'Builder', icon: 'tower', key: 'fortLevels', tiers: [10, 40], stat: 'fortCostMult', per: -0.03, text: 'Fortifications {v}% cheaper' },
  { id: 'duellist', name: 'Duellist', icon: 'swords', key: 'duel', tiers: [1, 5], stat: 'renownPerDuel', per: 1, text: '+{v} Renown per Duel won' },
  // PLAN-PHASE7 §7B: the Reliquarian. A convenience reward (Renown), outside the +10% power budget
  { id: 'reliquarian', name: 'Reliquarian', icon: 'chest', key: 'relics', tiers: [1, 6, 12], stat: 'renownPerRelic', per: 1, text: '+{v} Renown for each Relic claimed' },
  { id: 'nemesis', name: 'Nemesis', icon: 'skull', key: 'vendetta', tiers: [1, 3], stat: 'vsVendetta', per: 0.05, text: '+{v}% strength against Vendetta war bands' },
].map((d) => Object.freeze({ ...d, tiers: Object.freeze(d.tiers) })));

/** The most each reward may add in total, whatever the table says (the +10% power-equivalent budget). */
export const DEED_CAPS = Object.freeze({
  incomeMult: 0.03,
  defenceMult: 0.06,
  bountyMult: 0.03,
  attackVs: 0.03,              // per faction
  renownAtDynastyStart: 1,
  freeRerolls: 3,
  streakWindowSec: 90,
  festivalDiscount: 0.1,
  xpMult: 0.1,
  fortCostMult: -0.06,
  renownPerDuel: 2,
  vsVendetta: 0.1,
  renownPerRelic: 3,
});

export const DEED_COPY = Object.freeze({
  earned: 'Deed earned: {name} ({tier})',
  progress: '{progress} / {goal}',
  complete: 'All tiers earned',
});
