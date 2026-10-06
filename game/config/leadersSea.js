// The Sea Queen's voice (PLAN-PHASE12 §12B): the Sea Kings' leader. Dry, salt-sharp, mocking: she has never lost sight of land and
// never needed to stand on it. Same rules as config/leaders.js (4-6 lines a trigger, at most 70 characters, only {name} and {region}).
// All writing here is original. config/leaders.js folds these in as LEADERS[6] and LEADER_LINES[6].

export const SEA_LEADER = Object.freeze({
  key: 'sea',
  title: 'Queen',
  epithet: 'of the Grey Tide', // rides only in fullName: "Queen Halvor of the Grey Tide"
  champion: 'Reaver Captain', // the Vendetta Champion's name (meta/leaders.js championTitle)
  onset: ['Hal', 'Sig', 'Ran', 'Thor', 'Gud', 'Ast', 'Ing', 'Bry', 'Hild', 'Sol', 'Ulf', 'Ger', 'Dag', 'Ey'],
  mid: ['a', 'i', 'e', 'o'],
  coda: ['vor', 'run', 'dis', 'frid', 'gerd', 'vi', 'laug', 'borg', 'ny', 'wen', 'rid', 'veig'],
});

export const SEA_LINES = Object.freeze({
  firstContact: [
    'Landlubbers. How quaint. You even have roads.',
    '{name} of the Grey Tide. You will hear me before you see me.',
    'New neighbours on the shore. The tide noticed first.',
    'Your coast is very long. My ships are very patient.',
    'A realm that cannot swim. This should be pleasant.',
  ],
  battleStart: [
    'Come wade in, then. Mind the deep part.',
    'You march. I sail. Guess who arrives first.',
    'Every shore is a door, and I have all the keys.',
    'Fight on the sand if you like. Sand moves.',
    '{name} sends her compliments. And her longships.',
  ],
  capitalBattleStart: [
    'The Tide Fortress. The sea itself stands guard.',
    'Knock at my gate. The water will answer first.',
    'Watch the fords, little general. They watch you.',
    'Welcome to {region}. Wait for the tide, if you dare.',
    'My walls are stone. My moat is the whole ocean.',
  ],
  keepAssaulted: [
    'At my gate? Bold. Do you hear the water rising?',
    'Hammer away. The tide keeps better time than you.',
    'You are wet to the knees and still coming. Admirable.',
    'Hold the gate, lads. The sea will do the rest.',
  ],
  keepLost: [
    'Keep {region}. Rocks make poor company anyway.',
    'A wall lost. I never cared much for walls.',
    'Take the hall. I took the boats.',
    'Enjoy {region}. The damp gets into everything.',
  ],
  surrenderOffer: [
    'Have {region}. I can always take it back at high tide.',
    'Fine. Keep the dirt. I keep the water.',
    'I yield {region}. Do not mistake that for losing.',
    'Take it. The sea has a long memory and a short temper.',
  ],
  decapitation: [
    'My fortress falls. My fleet does not.',
    'You drained my tide pool. The ocean remains.',
    'A queen without a castle is still a queen on a ship.',
    'Well taken. Do not try it again at high water.',
  ],
  playerDefeat: [
    'Washed off the beach. It happens to everyone once.',
    'Swim home, landlubber. It is not far. For a fish.',
    'The sea thanks you for the driftwood.',
    'That was not a battle. That was bath time.',
    'Wring out your banners and try again.',
  ],
  playerRetreat: [
    'Back up the beach already? The water is warm.',
    'Run inland. I will wait on the coast. I always do.',
    'Retreat? Wise. The tide was about to turn.',
    'Off you go. Leave the boats, you cannot sail them.',
  ],
  scouted: [
    'Your scout got his boots wet. Did he see much?',
    'Count my ships. Then count them again, moving.',
    'Look all you like. A fleet is never where you left it.',
    'Spies on my shore. I hope they can swim.',
  ],
  sabotaged: [
    'You sank a rowboat. I have a navy.',
    'Fire in my shipyard. Clever. Salt puts it out.',
    'You cut my nets. I will cut your purse.',
    'A sting from the shore. I will remember the taste.',
  ],
  grudge: [
    'I keep a list of names. Yours is written in tar.',
    '{name} rarely looks inland. She is looking now.',
    'You have earned my attention. Few enjoy it long.',
    'Careful, landlubber. My patience ebbs like the tide.',
  ],
  vendetta: [
    '{name} sails for {region}. Light every beacon you own.',
    'The Queen comes ashore in person. Bow, or drown.',
    'My Reaver Captain has your harbour in his spyglass.',
    'I come for {region}. Count the sails and despair.',
  ],
  vendettaWon: [
    'My captain is fished out of the surf. Again.',
    'You win this tide. There are two of them a day.',
    'Keep my banner. It needed a good drying anyway.',
    'Repelled. I shall tell the fish you were brave.',
  ],
  vendettaLost: [
    '{region} flies my flag now. It looks better wet.',
    'I said I would land. I always land.',
    'Your walls were lovely. Shame about the beach.',
    'Hush now, {region}. Listen to the gulls instead.',
  ],
  plague: [
    'Sickness in my ports. Scurvy, mostly. Pass the limes.',
    'Fever aboard. We throw it overboard with the bilge.',
    'Plague on my coasts. The sea will rinse it out.',
    'My crews are coughing. My cannons are not.',
  ],
  merchant: [
    'A merchant on the road? Mine come by sea. Faster.',
    'Trade with him. I will tax his ships on the way home.',
    'Caravans. Adorable. Like ships that forgot the water.',
    'Buy what you like. I know where he sails next.',
  ],
  duelWon: [
    'Bested on the sand. My champion will want a rematch.',
    'A clean blow. He will feel it at every high tide.',
    'You win the duel. Do not let it go to your head.',
    'Well fought. You may yet make a sailor.',
  ],
  duelLost: [
    'Into the surf with you. Mind the crabs.',
    'Down already? The sand is softer than it looks.',
    'Yield, little champion. The tide is coming in.',
    'Short and salty. Just how I like a duel.',
  ],
  deserters: [
    'A few of my crew jumped ship. They will miss the sea.',
    'Deserters, swimming for your shore. Feed them fish.',
    'Let them go. A ship sails lighter without cowards.',
    'Some sailors prefer dry land. I prefer better sailors.',
  ],
  harvest: [
    'A harvest feast. We prefer the catch of the day.',
    'Bake your bread, landlubbers. We will bring the salt.',
    'Your fields are golden. My nets are fuller.',
    'Feast while you can. Storms do not keep calendars.',
  ],
});
