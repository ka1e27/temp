// The Pale Margrave's voice (PLAN-PHASE6 §6B): the Ashen Host's leader. Dry, ancient, patient: he has buried better armies than yours
// and is in no hurry. Same rules as config/leaders.js (4-6 lines a trigger, at most 70 characters, only {name} and {region}). All
// writing here is original. config/leaders.js folds these in as LEADERS[5] and LEADER_LINES[5].

export const ASHEN_LEADER = Object.freeze({
  key: 'ashen',
  title: 'Margrave',
  epithet: 'the Pale', // rides only in fullName: "Margrave Osric the Pale"
  champion: 'Barrow Knight', // the Vendetta Champion's name (meta/leaders.js championTitle)
  onset: ['Os', 'Ald', 'Mor', 'Ced', 'Wul', 'Eld', 'Grim', 'Hal', 'Ost', 'Sev', 'Vor', 'Ul', 'Bel', 'Thar'],
  mid: ['e', 'i', 'o', 'a'],
  coda: ['ric', 'wyn', 'dred', 'mund', 'gar', 'ward', 'helm', 'rath', 'vane', 'more', 'bert', 'stan'],
});

export const ASHEN_LINES = Object.freeze({
  firstContact: [
    'Another young realm. I have outlived a dozen of them.',
    'Ah. New neighbours. The barrows are patient. So am I.',
    '{name} greets you. Briefly. Everything is brief, to me.',
    'You smell of fresh paint and hope. Both fade.',
    'Welcome to the border. Most who cross it stay. Below.',
  ],
  battleStart: [
    'Come, then. Every soldier you spend, I keep.',
    'Strike as you like. The fallen change sides here.',
    'I have waited centuries. I can wait out one battle.',
    'Send them in. I will need the company.',
    '{name} does not hurry. Hurry is for the living.',
  ],
  capitalBattleStart: [
    'The Barrow Keep. Its walls are older than your name.',
    'You knock at the Barrow Keep. The dead will answer.',
    'Every stone here was a soldier once. Mind your step.',
    'My hall has room for all of you. It always has.',
    'Listen. The ground beneath {region} is stirring.',
  ],
  keepAssaulted: [
    'At my door already? How very eager.',
    'Pound the gate. The echo pleases them below.',
    'Rise, my faithful. We have guests at the keep.',
    'A siege. How quaint. I remember the first one.',
    'Knock louder. The dead are hard of hearing.',
  ],
  keepLost: [
    'Keep {region}, then. You will be buried in it.',
    'Stone changes hands. Graves do not.',
    'One hall lost. I have others, and time to spare.',
    'Enjoy the keep. Do not dig in the cellars.',
  ],
  surrenderOffer: [
    'Take {region}. I lose nothing that will not return.',
    'Very well. Hold it, while you can still hold things.',
    'I yield {region}. Patience is not surrender.',
    'Have it. The barrows will wait for you instead.',
  ],
  decapitation: [
    'My hall falls. And yet I remain. Curious, is it not?',
    'You took the Barrow Keep. The barrows stay with me.',
    'A crown of ash cannot be broken. Only scattered.',
    'So. The keep is yours. The dead never were.',
  ],
  playerDefeat: [
    'Thank you for the soldiers. I will put them to work.',
    'They fell well. They will rise better.',
    'You have given my garrison a fine new company.',
    'Another army lent to me. I never return them.',
    'Rest. Then send more. I am always recruiting.',
  ],
  playerRetreat: [
    'Leaving? You forgot some of your soldiers. I kept them.',
    'Run along. The dead walk slowly, but they never stop.',
    'Wise. Fewer of you will be joining me today.',
    'Retreat, regroup, return. I have watched it all before.',
  ],
  scouted: [
    'Count my garrison. Then count again tomorrow.',
    'Your scout looked very alive. For now.',
    'See all you like. There is always more below.',
    'Yes, look closely. Remember the faces you see.',
  ],
  sabotaged: [
    'Fire in my stores. Ash on ash. Hardly a change.',
    'You burned my granary. My soldiers do not eat.',
    'A clever sting. I will remember it for a century.',
    'Sabotage. How lively of you.',
  ],
  grudge: [
    'I have begun to keep a ledger of you. It is long.',
    '{name} rarely notices the living. You have managed it.',
    'Careful. I hold a grudge longer than you hold breath.',
    'My patience is vast. It is not endless.',
  ],
  vendetta: [
    '{name} rides for {region}. The dead ride with me.',
    'The Margrave rides in person. The dead ride with him.',
    'A vendetta, then. I have all the time in the world.',
    'I come for {region}. Lock your doors. It will not help.',
  ],
  vendettaWon: [
    'My knight falls. He has done so before. He will again.',
    'You win this hour. I have so many more of them.',
    'Hang my banner, then. It has hung in worse halls.',
    'A rare defeat. I shall savour it, like old wine.',
  ],
  vendettaLost: [
    '{region} is mine. Its graveyard grows by the hour.',
    'I said I would come. I always come, in the end.',
    'Your walls held long enough to be remembered.',
    'Quiet now, {region}. It is easier that way.',
  ],
  plague: [
    'A plague? My soldiers barely notice. The living do.',
    'Sickness in the barrows. It is mostly a formality.',
    'Fever thins my living ranks. Only the living ones.',
    'Plague walks my lands. We are old acquaintances.',
  ],
  merchant: [
    'A merchant. Tell him I pay in old coin. Very old.',
    'Trade if you must. Gold is only metal that waits.',
    'I outlived the last caravan. And its grandchildren.',
    'Buy your trinkets. They will make fine grave goods.',
  ],
  duelWon: [
    'Bested. My champion will be back on his feet. Soon.',
    'A fine blow. He will remember it, when he rises.',
    'You win the duel. Death has been known to wait.',
    'Well struck. I so rarely see that any more.',
  ],
  duelLost: [
    'Down you go. Do not get comfortable down there.',
    'A short duel. They usually are, against the dead.',
    'Yield, little champion. There is no shame in dust.',
    'Done. Shall I send for a stretcher, or a shovel?',
  ],
  deserters: [
    "A few of my living soldiers fled. The others cannot.",
    "Deserters. They will come back to me eventually. Everyone does.",
    "Let them run. I keep the ones that stay. Forever.",
    "The living are so fickle. That is why I prefer the other kind.",
  ],
  harvest: [
    "A harvest festival. I remember those. Vaguely. Centuries ago.",
    "Feast, little realm. The barrows can wait for the leftovers.",
    "Your bonfires warm nothing of mine. Nothing of mine is warm.",
    "Enjoy your bread. The grave has a much simpler menu.",
  ],
});
