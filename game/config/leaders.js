// Rival leader voices (DESIGN §3.6): titles, name syllables, timing limits and every line of
// dialogue. All writing here is original. game/meta/leaders.js reads this file and hard-codes
// nothing; game/ui/leaderBanner.js only receives finished strings.
//
// Speaker rules (who says what):
//   firstContact, battleStart, capitalBattleStart, keepAssaulted, keepLost, playerDefeat,
//   playerRetreat  -> the leader of the faction that owns the region being fought
//   surrenderOffer -> the leader of the faction that owns the region on the card
//   decapitation   -> the leader whose capital just fell
//   scouted        -> the leader of the region the player just scouted (DESIGN §5.7)
//   sabotaged      -> the leader of the sabotaged region, at battle start, in place of
//                     battleStart / capitalBattleStart (DESIGN §5.7)
// Phase 4 (PLAN-PHASE4 §4D, §4E):
//   grudge         -> the leader whose Grudge just passed 50 (grudges.js drainGrudgeNews)
//   vendetta       -> the leader swearing a Vendetta ({region}: its target) when it is announced
//   vendettaWon    -> that leader, when the PLAYER beat the Vendetta (a defeated taunt)
//   vendettaLost   -> that leader, when the PLAYER lost it (a gloat; {region}: the region occupied)
//   plague         -> the leader of the plagued faction, when the Plague is announced
//   merchant       -> any neighbouring rival leader, grumbling when the Merchant arrives
//   duelWon        -> the challenger, when the PLAYER won the Duel
//   duelLost       -> the challenger, when the PLAYER lost the Duel
// Free Folk have no capital region, so their capitalBattleStart and decapitation lines are
// written for completeness (and future worlds) but never fire in the current world contract.
//
// Placeholders: {name} is the speaker's own name (leaders talk about themselves in the third
// person when they boast), {region} is the region being fought over. A line that needs a
// placeholder the caller did not supply is never picked.
//
// Length: a raw line is at most VOICE.maxLineChars (70) characters; game/tests/meta.leaders.test.js
// enforces it, and also the worst case after substituting the longest possible name and region.

/** Faction ids that can have a leader (0 is the player realm: no leader). */
import { ASHEN_LEADER, ASHEN_LINES } from './leadersAshen.js';

export const LEADER_FACTIONS = Object.freeze([1, 2, 3, 4, 5]); // 5: the Ashen Host's Pale Margrave (PLAN-PHASE6, config/leadersAshen.js)

/** Every moment a leader may speak. */
export const LEADER_TRIGGERS = Object.freeze([
  'firstContact',
  'battleStart',
  'capitalBattleStart',
  'keepAssaulted',
  'keepLost',
  'surrenderOffer',
  'decapitation',
  'playerDefeat',
  'playerRetreat',
  'scouted',
  'sabotaged',
  // Phase 4 (PLAN-PHASE4 §4D, §4E)
  'grudge',
  'vendetta',
  'vendettaWon',
  'vendettaLost',
  'plague',
  'merchant',
  'duelWon',
  'duelLost',
]);

export const VOICE = Object.freeze({
  minGapSec: 15,        // at least this many (real-time) seconds between two lines
  bannerMs: 4200,       // how long the banner stays up ("about 4 s")
  maxLineChars: 70,     // raw template length limit (enforced by tests)
  maxRegionChars: 14,   // longest generated region name, for the worst-case length test
  // Triggers that ignore the minimum gap (they still record their time, so they still delay the
  // NEXT line). A keep usually falls 8-20 s after keepAssaulted spoke, so without this the payoff
  // lines were often swallowed by the 15 s gap (lead decision, DESIGN §3.6).
  gapExempt: ['keepLost', 'decapitation', 'vendetta'], // a Vendetta's oath must never be swallowed by the gap (PLAN-PHASE4 §4D)
});

/**
 * Fixed titles plus per-faction name syllables. A name is `onset + coda`, or with a `mid`
 * (about a third of the time) `onset + mid + coda`. Tables are picked so any combination is
 * pronounceable and reads in the faction's voice.
 */
export const LEADERS = Object.freeze({
  1: {
    key: 'freefolk',
    title: 'Reeve',
    onset: ['Hob', 'Wat', 'Tam', 'Bram', 'Cud', 'Ned', 'Ott', 'Pim', 'Gil', 'Dun', 'Har', 'Mil', 'Alf', 'Dud', 'Nib', 'Wilf'],
    mid: ['a', 'e', 'i', 'o'],
    coda: ['by', 'kin', 'ley', 'win', 'ric', 'ton', 'wick', 'ling', 'ben', 'wyn', 'ford', 'ham'],
  },
  2: {
    key: 'crimson',
    title: 'Warlord',
    onset: ['Kor', 'Drak', 'Val', 'Bran', 'Mor', 'Rag', 'Tor', 'Gar', 'Vor', 'Zar', 'Kel', 'Bal', 'Dor', 'Krag', 'Thar', 'Gorn'],
    mid: ['a', 'o', 'e', 'u'],
    coda: ['ash', 'us', 'tar', 'ok', 'gar', 'oth', 'ius', 'dane', 'rak', 'mund', 'vex', 'gor'],
  },
  3: {
    key: 'violet',
    title: 'High Seer',
    onset: ['Ael', 'Sel', 'Ilu', 'Ves', 'Nyx', 'Lun', 'Ser', 'Thal', 'Ely', 'Mor', 'Ama', 'Cal', 'Iri', 'Ora', 'Zel', 'Sil', 'Ver', 'Isol'],
    mid: ['a', 'i', 'e', 'o'],
    coda: ['ara', 'ith', 'ene', 'iel', 'ys', 'ael', 'ora', 'ista', 'isse', 'ian', 'eth', 'iah', 'mira', 'vane', 'dris', 'line', 'wyn', 'sa'],
  },
  4: {
    key: 'amber',
    title: 'Khan',
    onset: ['Jiz', 'Tar', 'Zek', 'Gash', 'Bok', 'Rik', 'Tam', 'Haz', 'Ruk', 'Zib', 'Kaz', 'Pok', 'Brak', 'Yuz', 'Dash', 'Kip'],
    mid: ['a', 'i', 'o', 'u'],
    coda: ['ak', 'ko', 'ab', 'shi', 'ug', 'dek', 'po', 'xan', 'zu', 'lo', 'bek', 'tai', 'gai', 'rok'],
  },
  5: ASHEN_LEADER,
});

/**
 * LEADER_LINES[factionId][trigger] -> 4 to 6 lines.
 * Crimson boasts and threatens. Violet warns in omens. Amber jeers. Free Folk grumble.
 */
export const LEADER_LINES = Object.freeze({
  // --- Free Folk (Reeve): put-upon farmers -----------------------------------------------
  1: {
    firstContact: [
      'Another lot at the fence? Mind the turnips, if you please.',
      'Visitors. And me with a leaky roof and a fussy cow.',
      "We're not looking for trouble. We're looking for our other boot.",
      'Right, so you are the new neighbours. Wipe your feet.',
      "Selling something? The answer's no. Soldiers? Also no.",
    ],
    battleStart: [
      "Of all the days to fight. I've hay down, you know.",
      'Grab your pitchforks, lads. And the good spade.',
      "I'm a farmer, not a fighter. But I'm a very annoyed farmer.",
      'Mind the chickens! They have been through enough.',
      '{name} is tired, cross and a bit damp. Consider that a warning.',
      'Sigh. Fetch the big rake. The one with the ugly handle.',
    ],
    capitalBattleStart: [
      "That's the village hall you're at, mind. We had a raffle in there.",
      "Not the meeting hall! We've only just re-thatched it!",
      'You have reached the good bit of {region}. Please do not stomp.',
      "This is where we keep the cheese. You'll regret it.",
      'Ring the bell! Ring it hard! And somebody find my other hat.',
    ],
    keepAssaulted: [
      "Oi! That's the keep! The council meets there on Thursdays!",
      'Mind the gate, it sticks. Also, stop attacking it.',
      "Somebody go and tell them we haven't had our supper.",
      'Not the keep! It took three summers to whitewash.',
      "Right, that's it. Put the kettle down, grab the pitchforks.",
    ],
    keepLost: [
      "Well, there goes the keep. Who's going to fix the roof now?",
      "That's the third gate this year. I'm charging someone.",
      'Fine. Take it. Just leave the goats alone.',
      'There goes {region}. And the good chair with it.',
      "Grumble, grumble. That'll be paperwork for weeks.",
    ],
    surrenderOffer: [
      'All right, all right. Take {region}. We have beans to boil.',
      "We give in. The barley won't wait for arguments.",
      'Take it, then. Just mind the vegetable patch.',
      "You've a lot of soldiers. We've a lot of chores. You win.",
      'Fine. Have the place. Someone put the kettle on.',
    ],
    decapitation: [
      "The hall's gone quiet. Not a good quiet, mind.",
      'No head, no hat, no idea what to do next.',
      "Well, that's the council done for. Who's for tea?",
      'Leaderless, and nearly harvest. Marvellous.',
      'We will manage. We managed the great flood. Mostly.',
    ],
    playerDefeat: [
      'Oh dear. Hope you brought a cart for the rest of you.',
      "There, there. Have a turnip. It won't help, but it's a turnip.",
      'Off you go, then. Mind the mud on the way out.',
      "We didn't even want the fight, and still we won.",
      'Well, that is tidy. Now, about my trampled cabbages...',
    ],
    playerRetreat: [
      "Off already? You'll want the far gate. The near one squeaks.",
      'Mind the puddles on your way out.',
      'Wise choice. Most fights are worse than they look.',
      "Fine, go on. We'll fix the fence. Again.",
      "Right. That's the ruckus over. Who's for a spot of tea?",
    ],
    scouted: [
      "There's a stranger in the hedge. Again. Somebody fetch a rake.",
      "Counting our goats, are you? They're very shy.",
      'Nosy neighbours. Mind you do not tread on the marrows.',
      'A scout. In my cabbages. I am writing to someone about this.',
      'Take a look, then. Just do not tell the tax man.',
      'If you want the numbers, ask. We count everything twice.',
    ],
    sabotaged: [
      'Somebody has been at the haystacks with a torch. Honestly.',
      "Half the pitchforks are gone and the barn's all singed. Marvellous.",
      'Sneaking about at night! I heard the geese complain.',
      "We're short on lads and long on grumbles. Mostly grumbles.",
      "Who's been at the storehouse? The crows. It's always the crows.",
      'A torch in the thatch! At this time of year!',
    ],
    grudge: [
      "We've a long memory in these parts. Longer than our fences.",
      "Keep on like this and I'll stop lending you the good ladder.",
      'The village is muttering about you. We mutter rather well.',
      '{name} has started a list. Your name is near the top.',
    ],
    vendetta: [
      "That's it! Fetch every pitchfork! We're coming for {region}!",
      'Enough is enough. {name} rides out in person. On the mule.',
      "We've had it up to here with you. Marching now. Slowly.",
      'Ring the bell! Not the supper bell, the angry one!',
    ],
    vendettaWon: [
      'Well. That went worse than the turnip festival.',
      'Back to the fields, lads. Mind the cow on the way.',
      "We tried. Nobody can say we didn't try. Mostly.",
      'Fine, fine. Grudge set down. Picked up again later, mind.',
    ],
    vendettaLost: [
      "Ha! That'll teach you to trample our hedges!",
      '{region} is ours again. Someone fetch the bunting.',
      'Not bad for a bunch of farmers, eh? Not bad at all.',
      "Put the kettle on. We've earned a proper brew.",
    ],
    plague: [
      'Half the village is coughing and the other half is sneezing.',
      'The cows are poorly, the hens are poorly, and so am I.',
      'Sickness in the barns. Keep your boots out of our lanes.',
      "Fever's going round. Don't you dare take advantage.",
    ],
    merchant: [
      'A merchant, is it? He sold me a bucket with a hole in it.',
      'Caravans for them, none for us. Typical.',
      'Mind that trader. His scales lean like a drunk ox.',
      'Fancy carts rolling past my turnips. Not even a wave.',
    ],
    duelWon: [
      "Fair's fair. You won. Don't let it go to your head.",
      "Beaten in a fair fight. Well, fairish. I'll allow it.",
      "My best lad lost to you. He's sulking in the hayloft.",
      "All right, you win the duel. You're not winning the fete.",
    ],
    duelLost: [
      'Ha! Farm hands are tougher than they look, see?',
      'Our champion milks cows every morning. Strong arms.',
      'Go on home. Tell them a farmer bested you.',
      "That's a duel won and the hay still in. Lovely day.",
    ],
  },

  // --- Crimson Legion (Warlord): boasts and threatens ------------------------------------
  2: {
    firstContact: [
      'A new banner on my border. How brave. How brief.',
      'Neighbour, I hear you are fond of your fields. Enjoy them.',
      '{name} sees you now. Sleep lightly.',
      "Plant your flag wherever you like. I'll collect it later.",
      'My scouts say you are small. My scouts are rarely wrong.',
    ],
    battleStart: [
      'Hear that drumming? Those are my boots, coming for yours.',
      'Bring everything you have. It will make a better story.',
      'Every road in {region} ends at my sword.',
      'You marched all this way just to lose? Efficient.',
      "Form up, Legion. Let's show this visitor the door.",
      'Let the drums begin. They love an audience.',
    ],
    capitalBattleStart: [
      'You knock on my gate? Then stay for the funeral.',
      'This is my throne room. Wipe your feet, then your dreams.',
      'Nine wars built {region}. You are a footnote.',
      'The Legion does not fall back. There is nowhere to fall back to.',
      'Come closer. I save my best welcomes for those who lose.',
    ],
    keepAssaulted: [
      'Get away from my keep! I only just polished it.',
      'That wall stood before your grandfather. Try not to scratch it.',
      'Hold the gate! Hold it with your teeth if you must!',
      'Ha! You reached my walls. Now try to leave.',
      'Bold. Foolish. Bold again. I almost admire it.',
    ],
    keepLost: [
      "Enjoy {region}. You'll be handing it back in pieces.",
      'One keep. A single, lonely, temporary keep.',
      'You have won a wall. I still own the rest of the world.',
      "Remember this moment. It's the peak.",
      "A fine trophy. It'll look lovely on my list of things to retake.",
    ],
    surrenderOffer: [
      'Fine. Take {region}. The Legion is merely reconsidering.',
      'We yield. Note the word yield, not lose.',
      "Take it and be quick. I'll be back when you're less impressive.",
      'A tactical withdrawal. Carve that on your monument.',
      "My officers say 'surrender'. I say 'temporary donation'.",
    ],
    decapitation: [
      'You took my throne, and half my army\'s nerve. Clever.',
      "My banners fall, but my grudge doesn't. It's a sturdy grudge.",
      'So the head is gone. Watch what the fists do.',
      'The Legion staggers. It has staggered before, and rose angrier.',
      "Enjoy my chair. It's uncomfortable on purpose.",
    ],
    playerDefeat: [
      "Ha! Come back when you've grown a spine. And an army.",
      'That was not a battle. That was a delivery of troops.',
      'The Legion thanks you for the practice.',
      "Crawl home and count your losses. It won't take long.",
      'Another banner for the pile. I do like a tidy collection.',
    ],
    playerRetreat: [
      'Running? Run faster. The Legion is very patient.',
      'There goes the brave one. Wave, everyone.',
      'A retreat! The smartest thing you have done all day.',
      "Go on, flee. I'll leave the gate open for your return.",
      'Smart. Cowardly, but smart.',
    ],
    scouted: [
      'Scouts, is it? Count fast. My army outnumbers your list.',
      'Peek all you like. Knowing the wall will not lift the wall.',
      'Your spy waved at me. I waved back with a sword.',
      'Take good notes. They will read well at your surrender.',
      'Count my banners. Go on. Then count your excuses.',
      'Your scouts are very brave and very visible.',
    ],
    sabotaged: [
      'Someone lit my barracks on fire. Someone will pay for that.',
      'Half my sword racks are empty. That was no accident.',
      'Cowards strike at night. I strike at dawn. Remember that.',
      'You cut my ranks and call it clever? It is merely rude.',
      'Missing troops, singed boots. Very well. I will fight barefoot.',
      "A saboteur's trick. I still have enough to finish you.",
    ],
    grudge: [
      'I am counting your insults. My count is getting long.',
      'Push me further and I will come for you myself.',
      '{name} does not forget. {name} keeps a ledger in blood.',
      'Every banner you take, I will take back twice.',
    ],
    vendetta: [
      'No more captains. {name} rides for {region} in person!',
      'I swear it on my blade: {region} burns by sundown.',
      'The Warlord marches. Clear the road or line it with graves.',
      'Vengeance, neighbour. I brought it myself, with friends.',
    ],
    vendettaWon: [
      'My champion fell? Impossible. Count the bodies again.',
      'Retreat! This is not over. It is merely postponed.',
      'You broke my charge. Next time I bring a bigger one.',
      'Bah! Hang my banner, then. It will haunt your hall.',
    ],
    vendettaLost: [
      "Kneel in what is left of {region}. I told you I'd come.",
      'That is how a Warlord settles a debt. Remember it.',
      'Your walls cracked like eggs. The Legion is pleased.',
      "Vengeance tastes better than wine. I'll have another.",
    ],
    plague: [
      'Plague in my barracks! Even sickness fears my sword.',
      'My soldiers cough, but they still march. Mostly.',
      'Some rot creeps through my camps. It will pass. I will not.',
      'Sick or not, the Legion holds. Do not test us.',
    ],
    merchant: [
      "A merchant favours you? I'll tax his wheels off.",
      'Gold for trinkets. Buy all you like; I take it back later.',
      'That caravan crossed my road without paying. Bold.',
      'Merchants are just raiders who learned to smile.',
    ],
    duelWon: [
      "You beat my champion. I'll have him flogged, then promoted.",
      'A lucky blow. I will remember the face behind it.',
      'Take your prize. The next duel will be my own blade.',
      'Fine work. Do not expect a rematch to be so kind.',
    ],
    duelLost: [
      'Ha! That is what Legion steel does to a challenger.',
      'My champion yawned through that. Bring a real fighter.',
      'Down you go. Mind the blood, it stains.',
      'A duel to the Legion. Write it under the other forty.',
    ],
  },

  // --- Violet Covenant (High Seer): warns, speaks in omens --------------------------------
  3: {
    firstContact: [
      'The stars sighed the day you arrived. They rarely sigh.',
      'Two banners, one horizon. The omens are not encouraging.',
      'We watched you in the still water. You blink too much.',
      'I saw your borders in a dream. It ended poorly.',
      'A new neighbour. The candles just guttered on their own.',
    ],
    battleStart: [
      'The tea leaves said Tuesday. They were correct.',
      'Every step you take was foretold. Most end badly.',
      'The crows above {region} have chosen. Not you.',
      'Walk carefully. The ground remembers who did not.',
      'Three ravens, a broken mirror, and now you. Fitting.',
      'I have read this battle. The last page is missing. How thrilling.',
    ],
    capitalBattleStart: [
      'You stand upon my seat of prophecy. It has heard your ending.',
      'Every star above {region} is looking down at you. Not kindly.',
      'This spire has waited an age. It can wait ten minutes more.',
      'Turn back. That is not a threat. It is a very quiet mercy.',
      'Come inside. The omens are easier to read up close.',
    ],
    keepAssaulted: [
      'The keep trembles. I felt it in my teeth, which is unusual.',
      'Ah. The walls are singing the low note. That is never good.',
      'I foresaw the breach. I did not foresee how rude it would be.',
      "Something old is stirring in the stones. I'd stop, if I were you.",
      'You knock on doors that remember every visitor.',
    ],
    keepLost: [
      'So it is written. I wrote it. In pencil.',
      'The keep falls, as the smoke predicted. Smoke is never wrong.',
      'Take {region}. It comes with a curse. Several, actually.',
      'The candles just went out. That is rarely about the draught.',
      'A door closes. Another opens. Behind it, me, waiting.',
    ],
    surrenderOffer: [
      'The signs are clear. Yield {region}, and sleep well tonight.',
      'The omens beg me to lay down my staff. I shall listen. Once.',
      'We yield. Even the stars tired of arguing about it.',
      'Take it. The alternative was in every card I drew.',
      'The bones agree: better to bow than to break.',
    ],
    decapitation: [
      'The throne falls silent. Every candle in the Covenant flickered.',
      'The Spire is dim. Yours, however, is about to be tested.',
      'Our eyes stay open. It takes only one seer to see you.',
      'You cut the thread. Threads, in my experience, tangle.',
      'The chorus is broken, but each voice remembers your name.',
    ],
    playerDefeat: [
      'It was written, dear. In three omens. You ignored all three.',
      'The stars have turned from you. Perhaps ask them nicely.',
      'I told the mirror you would lose. The mirror was smug about it.',
      'Fate hands you this lesson. It is heavy. Carry it well.',
      'Another verse for the book. Yours is the sad one.',
    ],
    playerRetreat: [
      'Wise. The omens were already packing.',
      'You leave. The crows, disappointed, follow a little way.',
      'A retreat, foretold. I shall note it in your file.',
      'The path back is open. It will not stay that way.',
      'Go with the wind. It is not fond of you either.',
    ],
    scouted: [
      'Someone is counting my candles. The flames have noticed.',
      'A curious eye at the window. Eyes can be closed, you know.',
      'The stars saw your scout arrive. They found him charming.',
      'Read what you like. Some pages are written in shadow.',
      'Look at the Covenant closely. Just do not blink first.',
      'Your scout tiptoes well. The crows still told me.',
    ],
    sabotaged: [
      'Something stirred in the dark and took half my guards.',
      'The omens spoke of fire. I assumed they meant supper.',
      'A quiet blade at night. The stars did not blink. Nor shall I.',
      'My garrison thins like mist. Mist is hard to catch.',
      'You sabotage what you cannot break. The stars note the difference.',
      'Hands worked in secret. The candles saw everything.',
    ],
    grudge: [
      'The candles burn your name now. They burn it slowly.',
      'Each wrong you do is written in ash. The page fills.',
      'I have begun to dream of you. You will not like it.',
      '{name} drew your card twice tonight. The Tower, both times.',
    ],
    vendetta: [
      'The omens are settled. {name} comes for {region} in person.',
      'The stars have sworn it: {region} falls before the moon.',
      'I walk out of the Spire for you. Few have earned that.',
      'Every candle is lit. Every seer is marching. For you.',
    ],
    vendettaWon: [
      'My champion has fallen. The cards did not show this.',
      'The mirror cracked. That is twice now. I am counting.',
      'A setback, foretold in small print. I missed the small print.',
      'You win. The stars are pretending not to have seen.',
    ],
    vendettaLost: [
      '{region} is ours, as the ravens promised. They are smug.',
      'I told you the stars were watching. They applauded.',
      'The prophecy is fulfilled. You may stop resisting now.',
      'Vengeance, served cold, at the hour the bones named.',
    ],
    plague: [
      'A sickness walks my halls. It came without an omen. Rude.',
      'Fever in the Covenant. The candles are weeping wax.',
      'My seers cough through their visions. Most unbecoming.',
      'This plague was not in any reading. I am displeased.',
    ],
    merchant: [
      'A merchant at your gates. I foresaw it. I disapprove.',
      "That caravan's wheels creak with bad luck. Enjoy it.",
      'Coins change hands; fortunes do not. Remember that.',
      'Merchants follow the gold. Omens follow the merchants.',
    ],
    duelWon: [
      'You won the duel. The stars blinked. That is rare.',
      'My champion fell, as a feather falls. Gently. Annoyingly.',
      'A victory, then. Fate grants loans, not gifts.',
      'Well struck. I shall reread the omens with my glasses on.',
    ],
    duelLost: [
      'The bones said you would stumble. You stumbled beautifully.',
      'My champion won, as written. I do so love being right.',
      'Fate holds the blade. Today it did not hold yours.',
      'You lost the duel. The candles did a small dance.',
    ],
  },

  // --- Amber Horde (Khan): jeers and taunts ------------------------------------------------
  4: {
    firstContact: [
      'Ha! Look at the little border. So cute. So crossable.',
      "New neighbour! We'll be borrowing your stuff. Permanently.",
      "{name}'s riders spotted you from six hills away. You're loud.",
      "You painted your fence blue? We'll paint it faster.",
      'Welcome to the neighbourhood. Hide your goats.',
    ],
    battleStart: [
      'Ride hard, ride laughing! They are already sweating.',
      'Hey, blue banner! We brought snacks and swords. Pick one.',
      "Watch the dust cloud, friends. That's the whole show.",
      "You brought how many troops? Aww. Aim high, little one.",
      "Race you to the keep! We'll wait. Actually, we won't.",
      'The Horde does not march. The Horde arrives.',
    ],
    capitalBattleStart: [
      "The great tent of {name} is open! Don't trip on the rugs.",
      "You came to the Khan's own camp? Bring cushions. It'll be long.",
      'Every horse in the Horde is looking at you. They are judging.',
      "Ha! The whole Horde came to watch. Don't disappoint us.",
      'Welcome to the big party. You are the entertainment.',
    ],
    keepAssaulted: [
      'Hey! Get off the porch! We just swept!',
      "Someone's poking the keep! Somebody poke them back!",
      "You're at our door? Rude. Riders, go say hello!",
      'Quick, back to the walls! Bring the pointy sticks!',
      'Ha! Look at you, all up in our business.',
    ],
    keepLost: [
      'Enjoy {region}! The horses hate it. Bad grass.',
      'One keep, and you are dancing? Cute. We have more.',
      'Fine, you got the keep. We got faster horses.',
      'Aww, you took the boring one. We kept the good tents.',
      'It is a fine keep. It smells like you now. Ew.',
    ],
    surrenderOffer: [
      "Okay, okay! You win {region}. Don't gloat. Gloat quietly.",
      'We give up! For now! Mostly to see your face!',
      'Take it, take it. We were bored of this place anyway.',
      "Too many of you, not enough of us. That's fair. Ugh.",
      "Fine! Have it. We're keeping the good cushions.",
    ],
    decapitation: [
      'You got my tent! Somebody get me another tent!',
      "The Khan's chair, gone! Fine. I'll stand. I'm faster.",
      "Ha... ha. That wasn't funny. Riders, the fun's over.",
      'So you found the big tent. Now try the many small ones.',
      "Cut off the head? We're a Horde. We have dozens.",
    ],
    playerDefeat: [
      'Ha! Nice try! Really! Ten out of ten for enthusiasm!',
      'Was that everything? We barely got dusty.',
      "Go on, send more! We haven't warmed up!",
      'You fell down. We can see from here. Very funny.',
      "Better luck next time! We'll be here. Laughing.",
    ],
    playerRetreat: [
      'Off you scurry! Mind the hills, they are rude.',
      'Look at that speed! Slow, but committed!',
      'Leaving already? We were about to open the good snacks!',
      'Tell your mum we said hello. And that we won.',
      'A retreat! Someone write a song about it. A short one.',
    ],
    scouted: [
      'Spying? Ha! We would have given you the tour for free!',
      'Your scout ducks like a hen. Very stylish!',
      'Take notes! Draw pictures! We will pose!',
      'Aww, a little scout! Somebody give him a snack.',
      'Count all you want. We move too fast to be counted.',
      'Psst, scout! The good tents are at the back. Ignore those. Ha!',
    ],
    sabotaged: [
      'Who stole my riders? Give them back! They have snacks!',
      'Half the camp is missing and the tents smell of smoke!',
      'You snuck in while we were out? Rude! Impressive! Rude!',
      'Fewer riders, more speed. Fine. Try to catch us.',
      "Someone's been in the grain tent with a torch. Ha ha ha... ha.",
      'A sneak attack? On the Horde? We invented those!',
    ],
    grudge: [
      "Hey! We're getting annoyed. You won't like us annoyed.",
      'Keep poking the Horde and the Horde pokes back. Hard.',
      "{name} is making a list. Your name's in big letters.",
      'Not funny anymore, blue banner. Okay, a bit funny. Stop it.',
    ],
    vendetta: [
      "That's it! {name} is riding out! Hide {region}!",
      "Vendetta! Great word. Means we're coming for {region}.",
      'The Khan is saddling up in person. Nobody saddles faster.',
      "Whole Horde, one target. Guess who? Hint: it's you.",
    ],
    vendettaWon: [
      'Our champion fell? Somebody check the horse.',
      "Okay, okay, you win this one. We're counting, though.",
      'Ow. That hurt our pride. And our riders. Mostly pride.',
      'Fine, hang our banner. It looked better in our tent.',
    ],
    vendettaLost: [
      "Ha! {region} is ours! Told you we'd come!",
      'Vengeance! Tastes like victory and dust. Mostly dust.',
      'Ride, laugh, win. Same as always. Thanks for playing!',
      "We said we'd come for you. We always keep that promise.",
    ],
    plague: [
      'Half the riders are sneezing and the horses hate it.',
      "Ugh, plague. Everyone's coughing on the snacks.",
      "We're sick! Don't you dare attack while we're sick!",
      'Fever in the camp. Riders are grumpy. Horses grumpier.',
    ],
    merchant: [
      'A merchant? We usually just take the cart. Saves time.',
      'Ooh, shiny caravan. Bet we could outrun it. Easily.',
      'That trader skipped our tents! Hurtful!',
      "Buy all you want. We'll come and borrow it after.",
    ],
    duelWon: [
      'You beat our champion? Aww. Okay, that was cool.',
      'Wow! Lucky swing! Teach us that one later.',
      "Our best rider, down! He's fine. He's sulking.",
      'Fine, you win the duel. We still win at racing.',
    ],
    duelLost: [
      "Ha! Down you go! Our champion didn't even sweat!",
      'That was quick! Want to go again? We have snacks.',
      'Duel over! Horde wins! Somebody play the drums!',
      "You fell over. We all saw. We're telling everyone.",
    ],
  },
  5: ASHEN_LINES, // the Pale Margrave (PLAN-PHASE6): dry, ancient, patient
});
