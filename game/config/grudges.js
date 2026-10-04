// Grudges and Rival Vendettas (PLAN-PHASE4 §4D). Every number lives here; read by game/meta/grudges.js, game/meta/frontier.js
// (the Vendetta is a frontier raid), game/battle/defenseArena.js and game/battle/champion.js (the Champion squad).
// Times are ACTIVE seconds (state.frontier.activeSec): a grudge never cools, and no Vendetta is sworn, while the game is closed.

export const GRUDGES = Object.freeze({
  max: 100,                    // a Grudge runs 0..100; at max the leader swears a Vendetta
  warnAt: 50,                  // the leader voices a warning (the `grudge` voice trigger) when the Grudge first climbs past this
  warnResetBelow: 35,          // ... and may warn again only after it has cooled below this (no nagging around 50)
  // What raises a rival leader's Grudge against you (PLAN §4D)
  gains: Object.freeze({
    // you took one of their regions. PLAN said +12; at 12 a Grudge almost never reached 100 before the player toppled that
    // faction's capital (which breaks the leader): 1 Vendetta in 12 D1 campaigns. At 16: about one per seed per dynasty.
    region: 16,
    capital: 40,               // ... their capital
    raidBeaten: 8,             // you beat one of their raids
    sabotage: 6,               // you sabotaged one of their regions
    duelDeclined: 10,          // you declined their Duel
    duelWon: 5,                // you beat them in a Duel
  }),
  decayPerSec: 1 / 120,        // -1 per 2 active minutes; frozen while a Vendetta is sworn
  afterWin: 0,                 // a Vendetta beaten: the Grudge resets to this
  afterLoss: 30,               // a Vendetta lost: the region is occupied and the Grudge resets to this
  calledOffAfterSec: 30,       // a sworn Vendetta with no war band marching or fighting for this long is called off (the target fell)
  newsMax: 8,                  // the news queue (warnings, sworn Vendettas) keeps at most this many unread items

  vendetta: Object.freeze({
    telegraphSec: 90,          // double a raid's 45 s march, so the red banner gives time to prepare
    warBandMult: 1.8,          // the war band is this x a normal raid's on the same region (1.5 was held 32 of 34 in the campaign: a formality; 1.8 alone 28 of 33)
    renown: 4,                 // a Vendetta beaten pays this much Renown on top of the defense's own
    trophyAtk: 0.05,           // a Trophy: +5% attack against that faction's regions for the rest of the dynasty ...
    trophyMax: 3,              // ... stacking to 3
    // The Champion: the leader's own squad, flagged `champion: true` in the sim (game/battle/champion.js). It marches on your
    // keep `launchSec` into the battle with `share` x the war-band camp's troops, each worth `power` x a war-band troop. If it
    // takes a site it holds it; when it dies (or the site it holds falls) the war band's attack drops by `attackDrop`.
    champion: Object.freeze({ share: 0.2, power: 2.0, launchSec: 6, attackDrop: 0.2 }), // power 1.5 -> 2.0 with the x1.8 band: Vendettas held 28 of 34 (82%) in the 12-seed campaign
  }),
});
