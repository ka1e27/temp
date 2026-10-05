// The Chronicle (DESIGN §5.9): which moments are worth remembering, how many are kept, and every word of the story. All
// copy lives here; game/meta/chronicle.js decides WHAT is notable and fills the {placeholders}, game/ui/chroniclePanel.js
// only shows finished strings. Balance-neutral: nothing in this file touches the economy or a battle.
//
// Placeholders (filled by chronicleText):
//   {region}   the region's name                       {faction}  the rival faction's name ("Amber Horde")
//   {leader}   the rival's title and name ("Khan Gashrok")
//   {rival}    "{leader}'s {faction}", or just the faction when it has no leader ("Khan Gashrok's Amber Horde")
//   {yields}   "yields", or "yield" for a plural faction (the Free Folk)
//   {time}     a battle time as m:ss                   {prev}     the old record as m:ss
//   {n}        a count (the streak, regions held)      {dynasty}  a dynasty number in Roman numerals
//   {ordinal}  the same count as 3rd, 5th, 12th
//   {stars}    dynasty stars carried over              {years}    the Years the closed dynasty lasted
// A kind may have a `.surrender` variant (used when the region yielded without a fight). Each entry lists 2-3 variants;
// one is picked deterministically from the entry itself, so a line never changes between two views.

export const CHRONICLE = Object.freeze({
  // How many entries a dynasty's chapter keeps. Over the cap, the oldest MINOR entry goes first, then the oldest plain one,
  // then (only if everything left is a highlight) the oldest. 40 keeps a whole continent's story readable in one scroll.
  maxEntries: 40,
  // How many lifetime highlights are carried across dynasties.
  maxHighlights: 60,
  // The realm's "Year": real days since the current dynasty began, so Year 1 is its first 24 hours, Year 2 the next, and so
  // on, restarting at Year 1 with every dynasty. An idle game is played in days, so a Year here is a day of the player's life.
  dayMs: 24 * 60 * 60 * 1000,
  // A triple-crown victory is recorded the first time in a dynasty, and then on these consecutive-victory streaks, so a
  // run of perfect fights reads as a streak instead of a wall of identical lines.
  streakMilestones: Object.freeze([3, 5, 8, 12]),
  // A new fastest battle must beat the old record by at least this many seconds to be worth a line.
  fastestMarginSec: 0.5,

  // Kind -> how it looks and whether it is carried across dynasties.
  //   icon       a name from game/ui/icons.js
  //   minor      evicted first when the chapter is full
  //   highlight  false = this dynasty only, 'first' = also kept in the lifetime highlights the first time it ever happens,
  //              'always' = always kept
  kinds: Object.freeze({
    firstConquest: Object.freeze({ icon: 'flag', minor: false, highlight: 'first' }),
    capital: Object.freeze({ icon: 'throne', minor: false, highlight: 'first' }),
    tripleCrown: Object.freeze({ icon: 'crown', minor: true, highlight: 'first' }),
    fastest: Object.freeze({ icon: 'clock', minor: true, highlight: 'always' }),
    surrender: Object.freeze({ icon: 'scroll', minor: true, highlight: 'first' }),
    prosperity3: Object.freeze({ icon: 'star', minor: false, highlight: 'first' }),
    factionFalls: Object.freeze({ icon: 'sword', minor: true, highlight: false }),
    halfway: Object.freeze({ icon: 'map', minor: false, highlight: false }),
    continent: Object.freeze({ icon: 'castle', minor: false, highlight: 'always' }),
    dynasty: Object.freeze({ icon: 'trophy', minor: false, highlight: 'always' }),
    // Phase 8 (PLAN-PHASE8 §8C): world events the player chose to take (meta/events.js acceptEvent records them)
    deserters: Object.freeze({ icon: 'flag', minor: true, highlight: false }),
    harvest: Object.freeze({ icon: 'wheat', minor: true, highlight: false }),
  }),

  // Factions whose name is plural ({yields} becomes "yield"): the Free Folk.
  pluralFactions: Object.freeze([1]),

  templates: Object.freeze({
    firstConquest: Object.freeze([
      'The first banner of your realm rises over {region}.',
      '{region} is taken from {rival}: the realm’s first conquest.',
      'Your banner flies beyond the home hills for the first time, at {region}.',
    ]),
    'firstConquest.surrender': Object.freeze([
      '{rival} {yields} {region}: your first conquest, won without a fight.',
      'Your first banner rises over {region}, handed over by {rival}.',
    ]),
    capital: Object.freeze([
      '{rival} loses the throne at {region}, and the realm stands taller for it.',
      '{leader}’s throne falls at {region}; the {faction} reels.',
      'The seat of the {faction} at {region} is yours: {leader} is deposed.',
    ]),
    'capital.surrender': Object.freeze([
      '{rival} {yields} {region}, throne and all, and the {faction} reels.',
      '{leader} gives up the throne at {region} without a fight.',
    ]),
    tripleCrown: Object.freeze([
      '{region} falls swiftly and without a loss: three crowns.',
      'A flawless victory at {region}: three crowns.',
      '{rival} cannot stop you at {region}: three crowns, fast and clean.',
    ]),
    'tripleCrown.streak': Object.freeze([
      'Three crowns at {region}, the {ordinal} perfect victory in a row.',
      '{region} makes {n} flawless victories in a row.',
    ]),
    fastest: Object.freeze([
      '{region} falls in {time}, faster than any battle before it ({prev}).',
      'A new record: {region} taken in {time}, beating {prev}.',
    ]),
    surrender: Object.freeze([
      '{rival} {yields} {region}.',
      '{leader} lays down arms at {region} and the {faction} bows out of it.',
      '{leader} opens the gates of {region} to you without a fight.',
    ]),
    prosperity3: Object.freeze([
      '{region} prospers: stone roads, and a market in the square.',
      '{region} is the first of your regions to reach full prosperity.',
    ]),
    factionFalls: Object.freeze([
      'The {faction} hold no land at all now: {region} was their last.',
      'With {region}, the last of the {faction} lands is yours.',
    ]),
    halfway: Object.freeze([
      'Half the continent now flies your banner.',
      'You hold {n} regions: half the continent, and the harder half is behind you.',
    ]),
    continent: Object.freeze([
      'The whole continent is yours. Every banner is the realm’s.',
      '{region} is the last: the continent is united under your banner.',
    ]),
    dynasty: Object.freeze([
      'Dynasty {dynasty} is founded: {stars} stars carried into a new age, and a new continent awaits.',
      'A new age begins: Dynasty {dynasty}, with {stars} stars and a continent to win.',
    ]),
    // `data.variant` picks `kind.variant` when it exists (Deserters: 'raid' reads the plain kind, 'muster' its own lines)
    deserters: Object.freeze([
      'Deserters from {rival} bring word of the next raid: it will come weaker.',
      'Soldiers of the {faction} lay down their spears at your border, and their next raid thins.',
    ]),
    'deserters.muster': Object.freeze([
      'Deserters from {rival} swell the militia of every region.',
      'Soldiers of the {faction} change banners; your militias stand full.',
    ]),
    harvest: Object.freeze([
      'A Harvest Festival: bonfires in every village, and the realm grows richer for it.',
      'The granaries overflow and the realm holds a Harvest Festival.',
    ]),
  }),

  // Shown in the panel when a list is empty.
  empty: Object.freeze({
    dynasty: 'Your story begins with your first conquest.',
    all: 'Nothing to remember yet. Great deeds will be kept here.',
  }),

  // Relative-time wording.
  ago: Object.freeze({ now: 'just now', minute: '{n}m ago', hour: '{n}h ago', day: '{n}d ago' }),

  // The Tapestry's words (game/meta/keepsake.js fills them; game/render/tapestry.js draws finished strings).
  //   {region} the start region's name   {numeral} the dynasty in Roman numerals   {owned} {total} regions held / on the continent
  //   {earned} {possible} the dynasty's crowns
  tapestry: Object.freeze({
    title: 'The Realm of {region}',
    subtitle: 'Dynasty {numeral}',
    regions: '{owned} of {total}',
    crowns: '{earned} / {possible}',
  }),

  // The map inside the saved picture is rendered this many CSS pixels wide, at 2x. Measured (PNG, whole tapestry): 700 gives
  // 1711 x 1436 px and 2.9 MB, 600 gives 1466 x 1230 and 2.3 MB, 900 gives 4.6 MB, 1100 gives 6.2 MB. The picture is shared far more
  // than it is printed, so both stay under 3 MB.
  tapestryWidth: Object.freeze({ desktop: 700, phone: 600 }),

  // "Save the map" (the Realm panel and the Found a Dynasty modal): a button, its busy label, and the two toasts.
  save: Object.freeze({
    button: 'Save the map',
    busy: 'Saving...',
    done: 'Map saved: {file}',
    failed: 'The picture could not be saved.',
    hint: 'Keep a picture of this realm before it resets.',
  }),

  // The panel's labels (the UI never types them).
  labels: Object.freeze({
    title: 'Chronicle',
    thisDynasty: 'This dynasty',
    allTime: 'All time',
    year: 'Year {n}',
    chapter: 'Dynasty {dynasty}',
  }),
});
