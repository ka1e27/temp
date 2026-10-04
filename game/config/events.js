// World events (DESIGN §10.13): the Merchant, the Plague and the Duel. Every number lives here; read by game/meta/events.js and
// game/meta/eventsState.js. Times are ACTIVE seconds (the game open and running), like the raid scheduler's.

export const EVENTS = Object.freeze({
  meanSec: 15 * 60,            // about one event every 15 active minutes ...
  jitter: 0.3,                 // ... each gap x (1 +/- this), seeded
  graceSec: 25 * 60,           // none in the first 25 active minutes of a realm or dynasty (the tutorial stays calm)
  minRegions: 4,               // nor before the player holds this many regions
  weights: Object.freeze({ merchant: 1, plague: 0.8, duel: 0.8 }),
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
  copy: Object.freeze({
    titles: Object.freeze({ merchant: 'A merchant caravan', plague: 'Plague', duel: 'A duel' }),
    merchantFort: 'A merchant offers a fortification level for {gold} gold.',
    merchantRenown: 'A merchant offers {renown} Renown for {gold} gold.',
    plague: 'Plague in the lands of the {faction}: their regions are weaker for {min} minutes.',
    duel: '{leader} of the {faction} challenges you to a duel at {region}: no powers, {renown} Renown to the victor.',
  }),
});
