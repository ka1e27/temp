// Phase 7 (docs/PLAN-PHASE7.md §7B): Relics, unique legendary items placed on special regions. Conquering the region claims the Relic
// for the dynasty; the lasting Reliquary (state.generals.reliquary) remembers every Relic ever found. Every number lives here; read by
// game/meta/relics.js (placement, claim, copy) and game/meta/boonsState.js (boonMods folds an owned Relic's `mods`, BOON_NEUTRAL keys).

export const RELIC_LIST = Object.freeze([
  { id: 'dragonBanner', name: 'Dragon Banner', icon: 'banner', mods: { campTroopsMult: 2 },
    text: 'Your War Camp starts every battle with double troops' },
  { id: 'crownOfReeve', name: 'Crown of the Reeve', icon: 'crown', mods: { freeFolkSurrender: 2 },
    text: 'Free Folk regions surrender at {freeFolkSurrender}× instead of 3×' },
  { id: 'sundial', name: 'Sundial', icon: 'clock', mods: { sundial: true },
    text: 'Power cooldowns keep ticking while the battle is paused and during the flight into battle' },
  { id: 'hornOfAges', name: 'Horn of Ages', icon: 'horn', mods: { rallyCdMult: 0.6 },
    text: 'Rally cooldown −{pct:rallyCdMult}' },
  { id: 'seersLens', name: "Seer's Lens", icon: 'eye', mods: { scoutAll: true },
    text: 'Every region is scouted for free' },
  { id: 'blackPennant', name: 'Black Pennant', icon: 'flag', mods: { raidTroopMult: 0.75 }, requires: 'raids',
    text: 'Enemy raids on you are {pct:raidTroopMult} smaller' },
  { id: 'emberHeart', name: 'Ember Heart', icon: 'flame', mods: { firestormMult: 1.4 },
    text: 'Firestorm +{pct:firestormMult} damage' },
  { id: 'gravewardensLantern', name: "Gravewarden's Lantern", icon: 'lantern', mods: { lanternRadius: 5 }, requires: 'ashen',
    text: 'The Fallen Rise never happens within {lanternRadius} hexes of your War Camp' },
].map((r) => Object.freeze({ requires: null, ...r, mods: Object.freeze(r.mods) })));

export const RELICS = Object.freeze({
  perContinent: 4,             // PLAN §7B
  minTier: 2,                  // never on the start region or the first ring (the tutorial stays clean)
  // after the Ruins, the other hosts are untyped regions at least this deep on the continent's tier range (share of the deepest tier),
  // never a capital or the Dragon's Lair (both already carry their own reward)
  deepShare: 0.5,
  preferType: 'ruins',         // Ruins first (PLAN §7B)
  copy: Object.freeze({
    cardLine: 'Relic: {name}. {text}',
    claimed: 'Relic claimed: {name}',
    reliquary: 'Reliquary',
    found: '{n} of {total} Relics found',
    unknown: 'Undiscovered',
  }),
});
