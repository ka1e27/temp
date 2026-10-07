// The Usurper-King's voice (PLAN-PHASE13 §13A): the final enemy. Grand, contemptuous, amused: he wears a stolen crown and borrows every
// rival's weapon, and he thinks your whole long reign was a prelude to meeting him. Same rules as config/leaders.js (4-6 lines a
// trigger, at most 70 characters, only {name} and {region}, at least two lines with no placeholder). All writing here is original.
// config/leaders.js folds these in as LEADERS[7] and LEADER_LINES[7]. THRONE_LINES are the Throne of Ages' own moments (battle/throne.js
// events); integration shows them on the banner like any other line.

export const USURPER_LEADER = Object.freeze({
  key: 'usurper',
  title: 'Usurper-King',
  epithet: 'of the Stolen Crown', // rides only in fullName: "Usurper-King Malgrin of the Stolen Crown"
  champion: 'Crown Champion', // a Vendetta Champion's name (meta/leaders.js championTitle)
  onset: ['Mal', 'Vex', 'Aur', 'Cass', 'Dra', 'Leo', 'Sev', 'Var', 'Ort', 'Kael', 'Rho', 'Thes'],
  mid: ['a', 'e', 'i', 'o'],
  coda: ['grin', 'ric', 'mont', 'vane', 'cius', 'dred', 'mar', 'ron', 'thane', 'gast', 'lor', 'mund'],
});

export const USURPER_LINES = Object.freeze({
  firstContact: [
    'So the little house of conquerors arrives at last.',
    'I am {name}, and every crown you have taken was mine first.',
    'Kneel now and I may let you keep a province.',
    'You toppled kings for me. How very thoughtful.',
    'Welcome to the heart of the world. It beats for me.',
  ],
  battleStart: [
    'My banners fly over every land you ever feared.',
    'Come, then. I have studied every war you ever won.',
    'You fight a king. Try to look the part.',
    'Every rival you broke now marches under my flag.',
    '{name} grants you the honour of losing to him.',
  ],
  capitalBattleStart: [
    'The Throne of Ages. Approach on your knees.',
    'Three Champions hold my Gate. Pick your favourite.',
    'Welcome to {region}. Nobody leaves it a ruler.',
    'I borrowed every weapon you ever faced. Watch closely.',
    'This is where the long tale ends. Badly, for you.',
  ],
  keepAssaulted: [
    'At my very door? Fetch the good silver, then.',
    'Hammer on, little conqueror. The Throne is patient.',
    'You storm the keep. I simply take the field.',
    'Bold. Foolish. Mostly foolish.',
    'Is this your whole army? I have bigger stables.',
  ],
  keepLost: [
    'Keep {region}. I have a continent to spare.',
    'A wall. You took a wall. Sing about it.',
    'Every stone you take I paid someone else for.',
    'Loss is a word for people with one keep.',
  ],
  surrenderOffer: [
    'Take {region}. A king must sometimes trim his hedges.',
    'I gift you this land. Remember who gave it.',
    'Have it. Kings do not haggle over farms.',
    'Yielded, not lost. Write that down correctly.',
  ],
  decapitation: [
    'The Throne is only a chair. I am the crown.',
    'You sat in my seat. Did it fit? It did not.',
    'A throne falls. Usurpers rise. It is the custom.',
    'Enjoy the crown. It bites the ones who steal it.',
  ],
  playerDefeat: [
    'There. The natural order, restored.',
    'Run back to your little realm and tell it of me.',
    'You were a rumour. Now you are a footnote.',
    'Another dynasty for my trophy room.',
    'Come back with more ancestors.',
  ],
  playerRetreat: [
    'Leaving before the coronation? How rude.',
    'Retreat is the first wisdom I have seen from you.',
    'Off you go. The Throne will still be here.',
    'Take your banners home. They look tired.',
  ],
  scouted: [
    'Count my soldiers if you like. Then count again.',
    'Spies at court? I hire them all eventually.',
    'Your scouts may look. Kings are made to be seen.',
    'Study {region} closely. You will dream of it.',
  ],
  sabotaged: [
    'You poisoned my wells. I have other kingdoms.',
    'Petty tricks for a petty house.',
    'Sabotage. The tactic of someone losing politely.',
    'You cut a rope at {region}. I own the ship.',
  ],
  grudge: [
    'You begin to annoy me, and kings remember.',
    'I keep a list. Your name climbs it daily.',
    'Every region you take, I add a verse to your dirge.',
    'Careful. My patience is borrowed too.',
  ],
  vendetta: [
    'Enough. My Champions ride for {region} at once.',
    '{name} swears it: your realm will pay in blood.',
    'I have tolerated you long enough. Now I hunt.',
    'A Vendetta, by royal decree. Brace yourselves.',
  ],
  vendettaWon: [
    'Your banner burns at {region}. As decreed.',
    'Justice is whatever the crown says it is.',
    'Let that be a lesson to every upstart house.',
    'My Champions return with your flag. Very nice.',
  ],
  vendettaLost: [
    'My Champions failed? I shall hire better ones.',
    'You held. A pity. I had a speech ready.',
    'A setback. Usurpers thrive on setbacks.',
    'Keep {region}. I will remember it to you.',
  ],
  plague: [
    'A fever at court. Even kings catch colds.',
    'My subjects sicken. There are always more subjects.',
    'Sickness in {region}? It never dared touch me.',
    'Plague is merely a tax collected by heaven.',
  ],
  merchant: [
    'Buy from my merchants. Every coin comes home.',
    'Trade with the crown. The crown always wins.',
    'Silks, steel and a bargain. I am generous today.',
    'Even conquerors need supplies. I sell them.',
  ],
  duelWon: [
    'My champion wins. Did anyone expect otherwise?',
    'A duel, a lesson, and a very short ceremony.',
    'Steel answers questions faster than heralds.',
    'Another of your heroes for my mantelpiece.',
  ],
  duelLost: [
    'One duel. I have lost duels. I still rule.',
    'Your champion fought well. Do not let it go to his head.',
    'Luck. Kings know the difference.',
    'Enjoy it. Victories are rare at court.',
  ],
  deserters: [
    'Deserters? I would have had them hanged anyway.',
    'Take them. They were never loyal to begin with.',
    'Men who leave a king make poor soldiers for you.',
    'Run off to {region}, cowards. See if I care.',
  ],
  harvest: [
    'A fat harvest. The granaries know their master.',
    'Bread for my armies. More armies, then.',
    'The fields of {region} kneel to me as well.',
    'A good year. All years are good years for kings.',
  ],
});

// The Throne of Ages' own moments (battle/throne.js events, PLAN 13A): the banner may speak one of these on the matching event.
export const THRONE_LINES = Object.freeze({
  throneChampion: [
    'One Champion down. They were the cheap ones.',
    'You felled a Champion. I have a drawer of them.',
    'Mourn him later. Two more hold my Gate.',
  ],
  gateFallen: [
    'The Gate? Merely decorative. Now the real lesson.',
    'You broke my Gate. Let me show you what I borrowed.',
    'Through the Gate. Welcome to my court.',
  ],
  borrowRising: [
    'The Margrave lent me his dead. Rise, my lovelies.',
    'Every grave on this field answers to me now.',
    'The dead are the most loyal subjects of all.',
  ],
  borrowTide: [
    'The Queen of the Grey Tide sends her regards.',
    'Even the sea bows to the Throne. Mind your feet.',
    'Here comes the water. Can conquerors swim?',
  ],
  borrowPlague: [
    'A little fever for your garrisons, with my compliments.',
    'Feeling weak? It is the air at court.',
    'Sicken, all of you. It suits your colouring.',
  ],
  field: [
    'Enough of Champions. The King takes the field.',
    'You wanted the Usurper? Here I am.',
    'Kneel, or be knelt upon.',
  ],
  usurperFell: [
    'Impossible. I borrowed everything. Everything.',
    'The crown slips. Take it, then. It was never mine.',
    'Remember me when it starts to bite.',
  ],
});
