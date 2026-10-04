// The Ashen Host (PLAN-PHASE6 §6B) and rival rotation (§6A). Every number the feature uses lives here, with its reason.
// Read by game/battle/fallen.js (The Fallen Rise, war-band growth, the Barrow Keep Rising), game/meta/rivals.js (the rotation, the
// card line) and the tools. The Gravewarden's numbers live with the other Generals (config/generals.js).

export const ASHEN_FACTION = 5;

export const RIVALS = Object.freeze({
  classic: Object.freeze([2, 3, 4]),    // Dynasty 1: always the classic three (the tutorial and first impressions stay as tuned)
  pool: Object.freeze([2, 3, 4, 5]),    // Dynasty 3+: 3 of these 4, seeded per dynasty
  newcomer: ASHEN_FACTION,              // Dynasty 2: the newcomer always appears, replacing one of the classic three (seeded)
  newcomerDynasty: 2,
});

export const ASHEN = Object.freeze({
  factionId: ASHEN_FACTION,
  // The Fallen Rise: troops the player loses ASSAULTING a settlement of an 'undying' faction join that settlement's garrison at this
  // share (PLAN §6B: 20%). Wasteful over-sending and long attrition fights feed them; decisive blows (the garrison dies) do not: a
  // settlement that falls on the tick gets nothing.
  fallen: Object.freeze({
    share: 0.2,
    // Firestorm burns the dead: none rise at a settlement inside a Firestorm's area for this long after it lands. A Firestorm is an
    // instant blast in the sim; 8 s of burning ground covers the assault it was cast to support (a squad's march to a near site is
    // 4-8 s), so the counterplay is "Firestorm, then strike", not frame-perfect timing.
    burnSec: 8,
    eventMin: 1,          // a fallenRose / fallenBurned event fires once this many whole troops have risen (or burned) at a site
  }),
  // Raids: an 'undying' war band grows by this share of the defenders it kills (PLAN §6B: 20%); the troops join the assaulting squads.
  warBandShare: 0.2,
  // The Barrow Keep (an 'undying' capital): every `everySec` the fallen around the keep rise as a free squad that marches on the
  // player's nearest site. Telegraphed `telegraphSec` before (the `rising` event); a Firestorm landing on the keep inside the
  // telegraph (or in the `everySec` before it) cancels the next Rising.
  rising: Object.freeze({
    everySec: 20,         // PLAN §6B
    telegraphSec: 3,      // PLAN §6B
    radius: 2,            // hexes: the ash ring the UI draws around the keep
    // the squad: this share of the keep's starting garrison (min `minTroops`). 0.12 x a capital keep (about 60-110 troops at D2) is
    // 7-13 troops every 20 s: a steady pressure the player must answer (about one hamlet's worth), never a second army.
    troopsShare: 0.12,
    minTroops: 4,
  }),
  copy: Object.freeze({
    cardLine: 'The Fallen Rise: {pct} of your losses join their garrison',
    capitalLine: 'The Barrow Keep: its dead rise every {sec} s',
    hint: 'The Fallen Rise: your losses join them. Strike decisively, or burn the dead with Firestorm.',
  }),
});

// The 'undying' AI (game/battle/ai.js PERSONALITY.undying + the attrition window): patient and attritional. It holds its sites thickly
// (a high reserve, a well-guarded keep, soft targets only) and counterattacks after you've spent troops: while the player's total
// strength is under `spentAt` x its recent (decaying) peak, the window opens and it plays like an aggressive faction for that think.
export const UNDYING_AI = Object.freeze({
  tuning: Object.freeze({
    reserve: 0.4, keepGuard: 1.2, margin: 1.3, maxCommit: 0.8, waves: 1, thinkMult: 1.0, open: 8,
    extend: 3.0, softOnly: true, neutrals: false, losing: 0.3, sources: 3, attrition: true,
  }),
  peakDecay: 0.985,     // per think: the remembered player peak fades (about half in 45 thinks), so a slowly shrinking army re-arms it
  spentAt: 0.7,         // the window opens when the player holds under 70% of that peak (a big wave spent against the walls)
  window: Object.freeze({ softOnly: false, waves: 2, margin: 1.05, maxCommit: 1.0, extend: 2.0 }),
});
