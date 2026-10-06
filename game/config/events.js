// World events (DESIGN §10.13): the Merchant, the Plague and the Duel; Phase 8 (PLAN-PHASE8 §8C) adds the Deserters and the Harvest
// Festival. Every number lives here; read by game/meta/events.js and
// game/meta/eventsState.js. Times are ACTIVE seconds (the game open and running), like the raid scheduler's.

export const EVENTS = Object.freeze({
  meanSec: 15 * 60,            // about one event every 15 active minutes ...
  jitter: 0.3,                 // ... each gap x (1 +/- this), seeded
  graceSec: 25 * 60,           // none in the first 25 active minutes of a realm or dynasty (the tutorial stays calm)
  minRegions: 4,               // nor before the player holds this many regions
  // Phase 8 adds deserters and harvest at 0.6 each: the mean gap is unchanged, so the older three come a little less often
  // (merchant 1 in 3.8 events instead of 1 in 2.6) and the new ones read as rarer news
  // Phase 12 adds the Shipwreck, on archipelagos only (meta/events.js leaves it out of a land continent's roll: its schedule is unchanged)
  weights: Object.freeze({ merchant: 1, plague: 0.8, duel: 0.8, deserters: 0.6, harvest: 0.6, shipwreck: 0.6 }),
  offerSec: 90,                // an offer waits this long for Accept / Decline (DESIGN: "a caravan offers one deal for 90 s")

  merchant: Object.freeze({
    // Deal 'fort': one free fortification level in a region of your choice, for this share of what that level costs
    fortPriceShare: 0.5,
    // Deal 'renown': this much Renown for gold worth this many seconds of the realm's income
    renown: 3,
    renownIncomeSec: 120,
  }),
  plague: Object.freeze({
    durationSec: 10 * 60,      // a rival's regions are weaker for this long (active seconds)
    strength: 0.8,             // their garrisons x this (DESIGN: -20% strength)
  }),
  duel: Object.freeze({
    renown: 3,                 // the prize (no shame in declining; no loss for losing)
    siegeSec: 60,              // a short fight: hold for this long
    warBand: 0.6,              // the champion's war band x a raid's strength on that region (at 0.8 the campaign won 9 duels of 23)
  }),
  deserters: Object.freeze({
    // Opt-in: a bordering rival's troops desert to you. Choice 'raid': that rival's next raid (not a Vendetta) is x raidMult;
    // choice 'muster': every region you hold has its militia full at once (a Muster everywhere, free; RENOWN.cost.muster each
    // otherwise). Declining costs nothing. 0.7 is the PLAN's "30% smaller".
    raidMult: 0.7,
  }),
  harvest: Object.freeze({
    // Opt-in, for gold: prosperity grows rateMult as fast for durationSec (wall clock, like prosperity's tenure itself). PLAN §8C:
    // twice as fast for 5 minutes, i.e. +5 minutes of tenure in every region held, so the price is kept low (priceIncomeSec of the
    // realm's income) to make it a fair trade early on, when Prosperity I (30 min) is near for many regions.
    durationSec: 10 * 60,      // coordinator after Phase 8 QA: x2 for 5 min (+5 min of tenure) was too weak to matter
    rateMult: 3,               // -> x3 for 10 min: +20 min of tenure in every region held
    priceIncomeSec: 60,
    keep: 12,                  // past festivals remembered (their extra tenure stays counted); the oldest is dropped beyond this
  }),
  shipwreck: Object.freeze({
    // Opt-in (PLAN-PHASE12 §12C): a wreck washes up on one of your coasts. 'salvage' pays salvageIncomeSec of the realm's income at once;
    // 'leave' rolls relicChance for a Relic (an undiscovered one first). Declining does nothing. 90 s is the Merchant's scale of reward;
    // a 1-in-3 Relic is worth more on average but may give nothing.
    salvageIncomeSec: 90,
    relicChance: 0.35,
  }),
  copy: Object.freeze({
    titles: Object.freeze({ merchant: 'A merchant caravan', plague: 'Plague', duel: 'A duel', deserters: 'Deserters', harvest: 'Harvest Festival', shipwreck: 'Shipwreck' }),
    shipwreck: 'A wreck washes up on the coast of {region}: salvage it for {gold} gold, or search it for a Relic ({pct} chance).',
    shipwreckSalvage: 'Salvage it',
    shipwreckLeave: 'Search for a Relic',
    merchantFort: 'A merchant offers a fortification level for {gold} gold.',
    merchantRenown: 'A merchant offers {renown} Renown for {gold} gold.',
    plague: 'Plague in the lands of the {faction}: their regions are weaker for {min} minutes.',
    duel: '{leader} of the {faction} challenges you to a duel at {region}: no powers, {renown} Renown to the victor.',
    deserters: 'Deserters from the {faction} come to your banner: make their next raid {pct} smaller, or muster them into every region.',
    desertersRaid: 'Weaken their next raid',
    desertersMuster: 'Muster everywhere',
    harvest: 'A rich harvest: hold a festival for {gold} gold and prosperity grows {mult}× as fast for {min} minutes.',
    harvestAccept: 'Hold the festival',
  }),
});
