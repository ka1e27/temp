// Ascension (docs/PLAN-PHASE13.md §13C): a lasting difficulty ladder, levels 1-10, unlocked by the ending. Every number lives here; read
// by game/meta/ascension.js (ascensionMods: the cumulative modifiers, folded into edictMods by meta/edicts.js) and game/meta/crown.js.
// A level's `mods` use the EDICT_NEUTRAL keys of config/edicts.js (where each key's meaning and neutral value are documented); level N
// plays with the mods of levels 1..N together. `text` is the ladder's line (templates as config/edicts.js: {pct:key}, {x:key}, {n:key};
// {sec} is the Unrest delay, filled by meta/ascension.js).

export const ASCENSION = Object.freeze({
  maxLevel: 10,
  // PLAN 13C: a founding may choose up to one level above the highest cleared
  aboveCleared: 1,
  // PLAN 13C rewards: +25% Legacy points for each level of the dynasty completed (founding after an Ascension 4 dynasty pays x2)
  legacyPerLevel: 0.25,
  ladder: Object.freeze([
    // 1. PLAN 13C: every enemy garrison +10% (the card shows it: it rides on the troop multiplier)
    Object.freeze({ level: 1, name: 'Hardened Garrisons', icon: 'shield', mods: Object.freeze({ enemyGarrisonMult: 1.1 }), text: 'Enemy garrisons +{pct:enemyGarrisonMult}' }),
    // 2. the raid grace (FRONTIER.graceSec, 20 active minutes) halved: the frontier wakes at 10 minutes
    Object.freeze({ level: 2, name: 'Restless Borders', icon: 'warband', mods: Object.freeze({ raidGraceMult: 0.5 }), text: 'Raids begin after half the grace' }),
    // 3. every Gate's garrison +25% (Siege regions and every capital; on the card)
    Object.freeze({ level: 3, name: 'Iron Gates', icon: 'gate', mods: Object.freeze({ gateTroopMult: 1.25 }), text: 'Gates +{pct:gateTroopMult} garrison' }),
    // 4. Unrest (UNREST.idleSec, 90 s with nothing readable) starts 60 s later: walls stay walls longer
    Object.freeze({ level: 4, name: 'Loyal Subjects', icon: 'unrest', mods: Object.freeze({ unrestIdleAdd: 60 }), text: 'Unrest starts after {sec} s' }),
    // 5. Boon drafts only after a win whose card read Hard or Deadly (no Fair, typed-region or capital drafts)
    Object.freeze({ level: 5, name: 'Lean Fortunes', icon: 'boon', mods: Object.freeze({ boonHardOnly: true }), text: 'Boon drafts only after Hard or Deadly wins' }),
    // 6. rival leaders swear a Vendetta at a Grudge of 75 instead of 100 (GRUDGES.max)
    Object.freeze({ level: 6, name: 'Long Memories', icon: 'grudge', mods: Object.freeze({ vendettaGrudgeMult: 0.75 }), text: 'Vendettas are sworn at a Grudge of {n:vendettaAt}' }),
    // 7. the Dragon and the Usurper +25% health (both on the card)
    Object.freeze({ level: 7, name: 'Elder Foes', icon: 'dragon', mods: Object.freeze({ dragonHpMult: 1.25, throneHpMult: 1.25 }), text: 'The Dragon and the Usurper +{pct:throneHpMult} health' }),
    // 8. PLAN 13C's "starting gold halved" (a founding starts with no gold unless Royal Treasury is owned, so it bit nobody): the
    // conquest bounty, the gold each step of the march pays at once, is halved instead
    Object.freeze({ level: 8, name: 'Empty Coffers', icon: 'coin', mods: Object.freeze({ bountyMult: 0.5 }), text: 'Conquest bounties halved' }),
    // 9. PLAN 13C: the Tide and the Rising every 30 s -> 20 s: the Usurper's borrowing (30 s), the Barrow Keep's Rising (20 s) and the
    // Tide Fortress's Tide (40 s) all come at 2/3 of their interval
    Object.freeze({ level: 9, name: 'Quickening', icon: 'tide', mods: Object.freeze({ hazardIntervalMult: 2 / 3 }), text: 'Risings, Tides and the Usurper\'s borrowing come a third sooner' }),
    // 10. PLAN 13C: all of the above, plus enemy squads +10% speed
    Object.freeze({ level: 10, name: 'The Last Age', icon: 'crown', mods: Object.freeze({ enemySpeedMult: 1.1 }), text: 'Enemy squads march +{pct:enemySpeedMult} faster' }),
  ]),
  copy: Object.freeze({
    title: 'Ascension',
    pick: 'Ascension {n}',
    none: 'No Ascension',
    locked: 'Topple the Usurper to unlock Ascension',
    cleared: 'Cleared',
    legacy: '+{pct}% Legacy at the next founding',
    highest: 'Highest Ascension: {n}',
  }),
});
