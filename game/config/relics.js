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
    text: 'The Fallen Rise never happens within {lanternRadius} hexes of your War Camp, so Firestorm finds no dead to burn there' }, // Phase 10B: confirmed as intended; the text says so
  // Phase 8 (PLAN-PHASE8 §8C): four more, so the Reliquary (12) takes several dynasties to fill at 4 a continent
  { id: 'merchantsScale', name: "Merchant's Scale", icon: 'scale', mods: { merchantPriceMult: 0.7 },
    text: "The Merchant's deals cost {pct:merchantPriceMult} less" },
  { id: 'wardensBell', name: "Warden's Bell", icon: 'bell', mods: { siegeSecMult: 0.8 }, requires: 'raids',
    text: 'You hold out {pct:siegeSecMult} shorter in every defense: the siege timer runs out sooner' },
  { id: 'twinCrowns', name: 'Twin Crowns', icon: 'crowns', mods: { swiftParAdd: 20 },
    text: "Swift's par is {swiftParAdd} s longer" },
  { id: 'sealOfMargrave', name: 'Seal of the Margrave', icon: 'seal', mods: { risingIntervalMult: 1.5 }, requires: 'ashen',
    text: "The Barrow Keep's dead rise every {rising} s instead of every {risingBase} s" },
  // Phase 12 (PLAN-PHASE12 §12C): the sea, archipelago continents only
  { id: 'astrolabe', name: 'Astrolabe', icon: 'astrolabe', mods: { laneCostMult: 2 / 3 }, requires: 'archipelago', // lanes x0.4 instead of x0.6
    text: 'Sea lanes cost your squads {pct:laneCostMult} less to sail' },
  // The Drowned Crown is never placed on the map: only a Shipwreck gives it up (meta/relics.js wreckRelic). Placed, it was claimed before the
  // Tide Fortress on 8 of 12 campaign archipelagos (undiscovered Relics are placed first), and the Tide then never drowned anyone.
  { id: 'drownedCrown', name: 'The Drowned Crown', icon: 'drownedCrown', mods: { tideImmune: true }, requires: 'archipelago', wreckOnly: true,
    text: 'The Tide never floods your squads' },
].map((r) => Object.freeze({ requires: null, wreckOnly: false, ...r, mods: Object.freeze(r.mods) })));

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
