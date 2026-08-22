// THE COPY A BATTLE SHOWS: the tutorial beats, and what the results screen may
// claim afterwards.
//
// Split out of content/strings.js at the 400-line cap, along the seam that
// matters rather than at a line number: everything left there is copy for a
// screen you visit BETWEEN battles — the world map, the shop, the record, the
// save dialogs — and everything here is copy a battle itself produces.
//
// Re-exported from `strings.js`, so no import path had to learn this file
// exists. It imports nothing from that file, so the pair is not a cycle.
// PURE DATA.

export const COACH = Object.freeze({
  drag: 'Drag from your camp across the map. Your troops march the road you draw.',
  // The rung that was missing; coach.data.js says what went wrong without it.
  tookGround: "Marching holds ground — it doesn't claim it. Drag onto a building"
    + ' to take one.',
  fieldWon: "You've beaten the defenders — now hold position while your troops break the walls.",
  captured: 'Farms fund your army.',
  gold100: 'Strongholds turn gold into soldiers, and take more troops to crack.',
  strongholdTaken: 'Pick what this training ground builds. Switching keeps its progress.',
  buildRams: 'Build rams, then take the castle.',
  siegeStalled: 'Walls repair faster than you break them. Send more, or pull out.',
  retreat: 'Retreat pulls a force home. It cannot be intercepted — you only lose the ground.',
  firstIncome: 'That region now pays you crowns every second — whether or not the'
    + ' tab is open. Crowns buy permanent upgrades, and upgrades take the next one.',
  // Moved out of coach.js COACH_EXTRA, where it was parked with a comment saying
  // it belonged here. It also gained the half that mattered: the old line said
  // "Take the castle to win the region" and never mentioned the gate, so the
  // assault it told the player to make bounced off a SEALED castle they had
  // never heard of.
  // TWO LINES, BECAUSE THE ONE LINE WAS FALSE WHERE IT WAS MOST HEARD. It fired
  // on castle reach in every region and described the gate — and Riverfen, the
  // campaign opener and the one battle a first-timer is guaranteed to play,
  // ships `castleGateFrac: 0`. So the beat written to be trustworthy taught a
  // rule that is inert in the region teaching it, and the panel readout that
  // would have contradicted it (`gateLine` -> "SEALED - holds X% of Y% needed")
  // only renders when the gate is real, so nothing on screen could correct it.
  takeCastle: 'The castle wins the region — but its gate holds until you own most'
    + ' of the map. Take the countryside first, then the throne.',
  takeCastleOpen: 'The castle wins the region, and this one has no gate on it.'
    + ' Break the throne and the map is yours.',
});

export const RESULTS = Object.freeze({
  win: 'Region conquered',
  loss: 'Defeat',
  timeout: 'Time expired',
  retreat: 'Withdrawn',
  // "NOTHING WAS LOST BUT TIME" IS ONLY TRUE IF YOU FIRED NOTHING.
  // `meta/rewards.js applyOutcome` calls `consumeBoosters` unconditionally,
  // before the win/loss branch, and `boosters.js consume()` has no refund path —
  // so a charge fired into a battle you go on to lose is gone. A charge costs
  // 1-3 RELICS, the currency you cannot grind (a raid pays none). So the
  // headline sentence overclaimed directly above the stat row that correctly
  // reported the charges spent. It could never show up in a balance number
  // either: the harness always launches with `boosters: []`.
  lossBody: 'Nothing was lost but time. Change your expedition and try again.',
  lossBodySpent: 'The charges you fired are spent — that is all this cost'
    + ' besides time. Change your expedition and try again.',
  timeoutBody: 'Decided on territory when the hard cap ran out.',
  retreatBody: 'You withdrew. The region is unchanged.',
  // THE BOARD HAS STOPPED MOVING. Raised by `battle-alert.js stalemateCheck` —
  // see there for the measurements. It names Withdraw because Withdraw is free
  // and always on screen, and the whole problem is that nothing ever told the
  // player they were in a position worth using it from.
  stalled: (mins) => `STALLED — no ground has changed hands in ${mins} minutes.`
    + ' Withdraw costs nothing but the time already spent.',
  /**
   * THE ANTI-TURTLE LADDER, IN WORDS. `battle/sim.js attritionPhase` has applied
   * real penalties after 150/210/270 seconds without a capture ANYWHERE on the
   * board for this feature's whole life, and nothing named it: the only mention
   * outside `battle/` and `content/` was a comment. So a player watching their
   * income fall, their walls stop repairing and their garrisons shrink had no
   * cause on screen for any of it, and the third rung — half income, no repair
   * at all, training at double price and half speed — reads as the game breaking.
   *
   * One line per rung, indexed by stage, and each names what that rung actually
   * does rather than warning in the abstract. It applies to BOTH sides, which is
   * the half that makes it fair and is worth saying out loud: the enemy's country
   * is starving too, so pressing is the answer and waiting is not.
   */
  attrition: [
    'THE COUNTRY IS STARVING — farms pay a quarter less until ground changes'
      + ' hands. Both sides.',
    'THE COUNTRY IS STARVING — walls now repair at half rate and garrisons are'
      + ' bleeding. Take something.',
    'THE COUNTRY IS SPENT — half income, walls no longer repair at all, and'
      + ' troops cost double to train. Take something or withdraw.',
  ],
  /**
   * THE SET-PIECE, ANNOUNCED (battle/setpiece.js). A function rather than a
   * constant, because the two numbers ARE the message: how many are coming and
   * how long you have. A line reading "a host is marching on your camp" with no
   * figures is a jump scare, not information, and the whole feature is that
   * this one is answerable.
   *
   * It names the camp, which the player owns and can always see, so the line is
   * FOG-SAFE BY CONSTRUCTION rather than by a check — the same property the six
   * handlers around it in screens/battle-alert.js already have, and it matters
   * because the event bus is emitted regardless of fog.
   */
  muster: (bodies, seconds) => `THE HOST MARCHES — ${bodies} closing on your camp,`
    + ` ${seconds}s out. Their country is thin behind it.`,
  incomeNow: 'Income now',
  bestTime: 'Best time',
  // WHY, not just WHAT. Every one of these is derivable from the outcome the
  // screen already has, and none of them is a guess — see `resultReason` in
  // screens/results.js for the arithmetic and for why it cannot over-claim.
  // The screen showed four to seven stat rows and nothing causal, so a player
  // who lost learned the number of troops they lost and nothing about the
  // decision that lost them.
  whyGateHeld: (held, need) => `The gate held: the throne needs ${need} of the`
    + ` countryside and you finished on ${held}.`,
  // TWO SENTENCES, BECAUSE ONE OF THEM WAS A CLAIM THE GAME COULD NOT MAKE.
  // `whyClockOnly` was reused for BOTH "you cleared the gate and ran out of
  // time" and "this region has no gate to clear" — and its text asserts the
  // countryside was yours. Five regions ship `castleGateFrac: 0` (all of tier 1
  // plus kaldan), so on those every timeout printed it however little ground was
  // held: reproduced at 3 of 11 sites and at 2 of 18. `resultReason`'s own
  // comment on that branch says "there is no territory claim to make, so make
  // none", and the string made one.
  whyClockOnly: 'The countryside was yours and the gate was open — the throne'
    + ' simply outlasted the clock.',
  whyNoGate: 'The clock ran out. This region puts no territory gate on its'
    + ' throne — the castle was there to be taken the whole time.',
  whyCampFell: 'Your camp fell. Hold it: losing it ends the region however well'
    + ' the rest is going.',
  whySweptAway: 'Nothing of yours was left on the board.',
});
