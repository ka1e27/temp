// The Codex's pages (PLAN-PHASE8 §8B): one short page per system, built from config so every number on a page is the game's own number, never
// typed. Pure data for the UI kit (game/ui/codex.js imports nothing from the game): `codexData(state, world)` -> { groups, topics }.
// A topic is locked ("Not yet discovered") until the player has met its system: `seen(state)` reads the save, never mutates it.
import { BATTLE, POWERS, SUPPLY } from '../config/battle.js';
import { ECONOMY } from '../config/meta.js';
import { PAR, BOUNTY_FRACTION_PER_CROWN, CROWN_KEYS } from '../config/crowns.js';
import { PROSPERITY } from '../config/prosperity.js';
import { WORKS, WORK_TYPES } from '../config/works.js';
import { FRONTIER, FORTS, FORT_TYPES } from '../config/frontier.js';
import { GENERALS } from '../config/generals.js';
import { RENOWN } from '../config/renown.js';
import { GRUDGES } from '../config/grudges.js';
import { FEATURES, REGION_TYPES, TWISTS } from '../config/features.js';
import { EVENTS } from '../config/events.js';
import { BOUNTIES } from '../config/bounties.js';
import { STREAK } from '../config/streak.js';
import { DEEDS, DEED_TIERS } from '../config/deeds.js';
import { EDICT_LIST, CHALLENGE_LIST, CHALLENGES } from '../config/edicts.js';
import { LEGACY_BRANCHES, QUICK } from '../config/legacy.js';
import { BOONS, BOON_LIST, DUO_LIST } from '../config/boons.js';
import { RELICS, RELIC_LIST } from '../config/relics.js';
import { ASHEN } from '../config/ashen.js';
import { INTEL } from '../config/intel.js';
import { CHALLENGE_MODE, DAILY, RECORD, BANNERS } from '../config/challenges.js';
import { SCENARIO_LIST, SCENARIOS } from '../config/scenarios.js';
import { UNREST } from '../config/unrest.js';

// --- number words (from config values only) ---
export const pct = (x) => `${Math.round(x * 100)}%`;
export const pctUp = (mult) => `+${Math.round((mult - 1) * 100)}%`;
const secs = (s) => `${Math.round(s)} s`;
const mins = (s) => `${Math.round(s / 60)} min`;
const hours = (ms) => `${Math.round(ms / 3600000)} h`;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const nameOf = (id) => cap(String(id).replace(/([A-Z])/g, ' $1').toLowerCase());

// --- what the player has met (defensive reads of the save; no ensure*, nothing written) ---
const o = (x) => (x && typeof x === 'object' ? x : {});
const seenHint = (state, ...ids) => ids.some((id) => !!o(o(state.tutorial).seen)[id]);
const won = (state) => (o(state.stats).battlesWon | 0) > 0;
const owned = (state) => (Array.isArray(state.owner) ? state.owner.filter((x) => x === 0).length : 0);
const dynastyLevel = (state) => o(state.dynasty).level | 0;
const later = (state) => dynastyLevel(state) > 1;
const fr = (state) => o(state.frontier);
const raids = (state) => (o(fr(state).stats).raids | 0) > 0 || (Array.isArray(fr(state).incoming) && fr(state).incoming.length > 0);
const anyKeys = (x) => Object.keys(o(x)).length > 0;
const anyLevel = (arr) => Array.isArray(arr) && arr.some((v) => (v | 0) > 0);
const gens = (state) => o(state.generals);
const roster = (state) => (Array.isArray(gens(state).roster) ? gens(state).roster : []);
const renownEarned = (state) => (o(state.renown).earned | 0) > 0;
const met = (state) => (Array.isArray(state.metFactions) ? state.metFactions : []);
const evLog = (state) => o(o(state.worldEvents).log);
const evAny = (state) => Object.values(evLog(state)).some((n) => (n | 0) > 0) || !!o(state.worldEvents).pending;
const boons2 = (state) => o(state.boons2);
const relicsFound = (state) => (Array.isArray(o(state.reliquary).found) ? o(state.reliquary).found.length : 0)
  + (Array.isArray(o(state.relics).owned) ? o(state.relics).owned.length : 0);
const relicSeen = (state) => relicsFound(state) > 0 || anyKeys(o(state.relics).placed) && won(state);

/** The groups, in the plan's order. */
export const CODEX_GROUPS = [
  { id: 'battles', title: 'Battles' },
  { id: 'realm', title: 'Your realm' },
  { id: 'defense', title: 'Defense' },
  { id: 'people', title: 'People and rivals' },
  { id: 'map', title: 'The map' },
  { id: 'goals', title: 'Goals' },
  { id: 'dynasties', title: 'Dynasties' },
  { id: 'boons', title: 'Boons and Relics' },
  { id: 'ashen', title: 'The Ashen Host' },
  { id: 'challenges', title: 'Challenges' },
];
// Phase 9: the Challenges open after the realm's first conquest beyond home (CHALLENGE_MODE.unlockConquests), or in any later dynasty
const challengesOpen = (s) => dynastyLevel(s) > 1 || (o(s.stats).regionsConquered | 0) >= CHALLENGE_MODE.unlockConquests;
const bannerOf = (kind) => BANNERS.filter((b) => b.unlock.kind === kind);

const rally = POWERS.rally;
const fs = POWERS.firestorm;
const bul = POWERS.bulwark;
const mar = POWERS.march;
const levy = POWERS.levy;
const easyAt = ECONOMY.difficultyLabels.find((d) => d.label === 'Easy');

/** @type {Array<{ id, group, title, icon, lines: string[], numbers: Array<[string, string]>, seen: (state) => boolean }>} */
export const CODEX_TOPICS = [
  // --- Battles ---
  { id: 'sending', group: 'battles', title: 'Sending troops', icon: 'swords', seen: () => true,
    lines: ['Drag from one of your settlements to another to send troops. The arrow turns green when they will take it, red when they will not.',
      'Squads that meet on the road fight there; what arrives attacks the garrison. Take the enemy keep to win the battle.',
      'Ctrl-drag (a long press on touch) sets up a supply line that keeps sending on its own.'],
    numbers: [['Send sizes', BATTLE.sendFractions.map(pct).join(' · ')], ['Supply line', `${pct(SUPPLY.fraction)} every ${secs(SUPPLY.intervalSec)}`]] },
  { id: 'rally', group: 'battles', title: 'Rally', icon: 'horn', seen: (s) => won(s) || seenHint(s, 'B4'),
    lines: ['Rally sends troops from every settlement you hold to one target at once.', 'Use it to land one big blow where a trickle would be beaten piecemeal.'],
    numbers: [['Each site sends', pct(rally.share)], ['Cooldown', secs(rally.cooldown)]] },
  { id: 'powers', group: 'battles', title: 'Battle powers', icon: 'flame', seen: (s) => Object.keys(o(s.upgrades)).some((k) => k !== 'rally' && (s.upgrades[k] | 0) > 0) || seenHint(s, 'P1'),
    lines: ['Powers are bought in the War Council and recharge during a battle.', 'Firestorm burns a spot after a short delay, Bulwark hardens a settlement, March speeds your squads and Levy adds troops everywhere.'],
    numbers: [['Firestorm', `${fs.damage} damage, ${secs(fs.cooldown)}`], ['Bulwark', `×${bul.mult} defence for ${secs(bul.duration)}`], ['March', `×${mar.mult} speed for ${secs(mar.duration)}`], ['Levy', `+${levy.troops} troops a site, ${secs(levy.cooldown)}`]] },
  { id: 'crowns', group: 'battles', title: 'Crowns', icon: 'crown', seen: (s) => won(s),
    lines: [`Every battle has ${CROWN_KEYS.length} crowns: Victory for winning, Swift for winning inside the par time, Unbroken for never losing a settlement you started with.`,
      'Each crown adds to the bounty, and crowns earn Renown.'],
    numbers: [['Bounty per crown', `+${pct(BOUNTY_FRACTION_PER_CROWN)}`], ['First regions’ par', mmss(PAR.bands[0].parSec)], ['Capital par', mmss(PAR.capitalSec)]] },

  // --- Your realm ---
  { id: 'income', group: 'realm', title: 'Gold and income', icon: 'coin', seen: () => true,
    lines: ['Every region you hold pays gold every second, deeper regions more. Your treasury keeps earning while you are away, up to a cap.',
      'Conquering a region also pays a one-off bounty.'],
    numbers: [['Away cap', `${ECONOMY.offlineCapHours} h, more with Treasury upgrades`], ['Capitals pay', `×${ECONOMY.capitalIncomeMult}`], ['Bounty', `${ECONOMY.bountySeconds} s of that region's income`]] },
  { id: 'council', group: 'realm', title: 'The War Council', icon: 'castle', seen: (s) => seenHint(s, 'M1') || Object.keys(o(s.upgrades)).length > 1,
    lines: ['The War Council sells upgrades for gold: stronger armies, a bigger War Camp, powers and a deeper treasury.', 'The card marked Best value, in the Army or Powers tab, raises your army power the most for its price.'],
    numbers: [] },
  { id: 'prosperity', group: 'realm', title: 'Prosperity and Festivals', icon: 'wheat', seen: (s) => anyLevel(s.prosperity) || owned(s) > 2,
    lines: ['A region you hold grows over time: fields, then cottages and a windmill, then paved roads and a market. Each level raises its income.',
      'A Festival, paid in Renown, raises a region’s Prosperity at once.'],
    numbers: [['Levels', PROSPERITY.labels.filter(Boolean).join(' · ')], ['Grows after', PROSPERITY.thresholdsMs.map(hours).join(' · ')], ['Income per level', `+${pct(PROSPERITY.incomeBonusPerLevel)}`]] },
  { id: 'works', group: 'realm', title: 'Region Works', icon: 'pick', seen: (s) => anyKeys(s.works) || seenHint(s, 'M3'),
    lines: ['Works are buildings in a region you hold. Each helps battles in the regions next to it.', 'More slots open as the region prospers; a Work can be upgraded or pulled down for part of its price.'],
    numbers: [['Kinds', list(WORK_TYPES.map(nameOf))], ['Levels', String(WORKS.maxLevel)], ['Refund', pct(WORKS.demolishRefund)]] },

  // --- Defense ---
  { id: 'raids', group: 'defense', title: 'Raids', icon: 'flag', seen: raids,
    lines: ['Rivals who border you send war bands against your regions. A raid is announced before it arrives, with a Go button to meet it.',
      'Aggressive rivals raid often, defensive ones seldom; a region just raided is left alone for a while.'],
    numbers: [['Warning', secs(FRONTIER.telegraphSec)], ['A region rests', mins(FRONTIER.regionCooldownSec)], ['Battles at once', `${FRONTIER.maxBattles} (${FRONTIER.maxDefenses} defenses)`]] },
  { id: 'defense', group: 'defense', title: 'Defense battles', icon: 'shield', seen: raids,
    lines: ['In a defense the war band attacks your settlements and you hold out until the siege timer runs down. Hold your keep and the raid fails.',
      'Beating a raid pays a share of a bounty and earns Renown.'],
    numbers: [['Siege timer', `${secs(FRONTIER.siegeSecByTier[0])} to ${secs(FRONTIER.siegeSecByTier[FRONTIER.siegeSecByTier.length - 1])}`], ['Reward', `${pct(FRONTIER.reward.bountyShare)} of a bounty`], ['Renown', `+${RENOWN.earn.defenseWon}`]] },
  { id: 'occupation', group: 'defense', title: 'Occupation', icon: 'lock', seen: (s) => anyKeys(s.occupation) || (o(fr(s).stats).defensesLost | 0) > 0,
    lines: ['A raid you lose leaves the region occupied: it stops paying and its border is drawn hatched in the occupier’s colour.', 'Attack it to take it back; a retake pays and earns Renown.'],
    numbers: [['Retake Renown', `+${RENOWN.earn.retake}`], ['Militia after a retake', pct(FRONTIER.retakeMilitiaFill)]] },
  { id: 'forts', group: 'defense', title: 'Fortifications', icon: 'tower', seen: (s) => anyKeys(s.forts) || seenHint(s, 'F4'),
    lines: ['Fortifications are built in a region you hold and fight only when it is raided.', 'Arrow Towers shoot, Walls harden the settlements, a Militia Hall grows the garrison and a Beacon gives more warning.'],
    numbers: [['Kinds', list(FORT_TYPES.map((t) => (FORTS.copy && FORTS.copy.names && FORTS.copy.names[t]) || nameOf(t)))], ['Slots', `${FORTS.slots.base}, more with Prosperity`], ['Walls', `×${FORTS.effects.walls.defMult[0]} defence`]] },
  { id: 'militia', group: 'defense', title: 'Militia', icon: 'shield', seen: (s) => anyKeys(s.militia) || raids(s),
    lines: ['Each region you hold keeps a militia that stands in its settlements when it is raided.', 'Losses refill slowly; Muster (Renown) fills a militia at once.'],
    numbers: [['Keep militia', String(FRONTIER.militia.perType.keep)], ['Refills over', mins(FRONTIER.militia.refillMs / 1000)], ['Muster', `${RENOWN.cost.muster} Renown`]] },
  { id: 'steward', group: 'defense', title: 'The Steward', icon: 'gear', seen: raids,
    lines: ['A defense you do not watch is fought by a Steward: your General if one is posted there, else a militia captain.', 'A better General defends better; you can always jump in and take over.'],
    numbers: [] },

  // --- People and rivals ---
  { id: 'generals', group: 'people', title: 'Generals and abilities', icon: 'star', seen: (s) => won(s) || roster(s).length > 1,
    lines: ['Generals lead your battles. Each has a passive bonus, a battle ability you trigger yourself and skills picked as it levels.',
      'They gain experience from every battle; a General who loses is wounded for a while.'],
    numbers: [['Top level', String(GENERALS.maxLevel)], ['XP per level', String(GENERALS.xpPerLevel)], ['Wounded for', mins(GENERALS.woundMs / 1000)]] },
  { id: 'renown', group: 'people', title: 'Renown', icon: 'laurel', seen: renownEarned,
    lines: ['Renown is earned by deeds, not bought: crowns, defenses held, retakes and capitals.', 'Spend it on Festivals, training and hiring Generals, Musters and rerolls.'],
    numbers: [['Per crown', `+${RENOWN.earn.crown}`], ['Per capital', `+${RENOWN.earn.capital}`], ['A mercenary', `${RENOWN.cost.mercenary} Renown`]] },
  { id: 'rivals', group: 'people', title: 'Rival leaders', icon: 'pennant', seen: (s) => met(s).some((f) => f > 1),
    lines: ['Each rival faction has a leader with a temper of their own: some raid early and hard, some wait behind their walls.', 'Their capital holds their keep; take it and the faction loses heart.'],
    numbers: [] },
  { id: 'grudges', group: 'people', title: 'Grudges and Vendettas', icon: 'skull', seen: (s) => met(s).some((f) => f > 1) && (Object.keys(o(s.grudges)).some((k) => /^\d+$/.test(k)) || owned(s) > 3),
    lines: ['Every region you take from a rival fills their Grudge. A full Grudge becomes a Vendetta: a big war band led by a Champion.', 'Beat it for a Trophy that strengthens you against that rival.'],
    numbers: [['Region taken', `+${GRUDGES.gains.region}`], ['Capital taken', `+${GRUDGES.gains.capital}`], ['Vendetta at', String(GRUDGES.max)], ['Trophy', `+${pct(GRUDGES.vendetta.trophyAtk)} attack`]] },
  // --- The map ---
  { id: 'regionTypes', group: 'map', title: 'Region types', icon: 'map', seen: (s) => seenHint(s, 'V1') || owned(s) > 3,
    lines: ['Some regions are special: a Gold Mine pays more, a Monastery grants Renown and scouts its neighbours, a Bandit Hold fights harder and pays well, Ruins hide an ancient tower.',
      'One region may be a Dragon’s Lair: optional, dangerous and rich.'],
    numbers: [['Types', list(REGION_TYPES.map((t) => (FEATURES.copy.typeNames && FEATURES.copy.typeNames[t]) || nameOf(t)))], ['Dragon', `${FEATURES.dragon.hp} hp, breath every ${secs(FEATURES.dragon.breathSec)}`]] },
  { id: 'twists', group: 'map', title: 'Battle twists', icon: 'sun', seen: (s) => seenHint(s, 'V1', 'V2', 'V3') || owned(s) > 3,
    lines: ['A twist changes how a battle plays: Night shortens tower range, a Blizzard slows everyone, Holy Ground forbids powers, a Siege shuts the keep behind a Gate, a Raid asks you to hold shrines.',
      'The twist shows on the region’s label before you attack.'],
    numbers: [['Twists', list(TWISTS.map((t) => (FEATURES.copy.twistNames && FEATURES.copy.twistNames[t]) || nameOf(t)))], ['Blizzard speed', pct(FEATURES.blizzard.speed)], ['Night tower range', pct(FEATURES.night.towerRange)]] },
  { id: 'unrest', group: 'map', title: 'Unrest', icon: 'flag', seen: (s) => !!o(s.unrest).toasted || anyKeys(o(s.unrest).thin), // PLAN-PHASE11b
    lines: ['When nothing on your frontier reads Easy or Fair for a while, the weakest region there falls into Unrest: its garrisons thin minute by minute until you attack it or something becomes Easy or Fair.',
      'Its label and its chance of winning already count the thinning. Once calm it slowly recovers. There is no Unrest in a challenge.'],
    numbers: [['Starts after', secs(UNREST.idleSec)], ['Thins', `${pct(UNREST.perMin)} a minute, at most ${pct(UNREST.max)}`], ['Recovers', `${pct(UNREST.recoverPerMin)} a minute`]] },
  { id: 'worldEvents', group: 'map', title: 'World events', icon: 'envelope', seen: evAny,
    lines: ['Now and then something happens in the world: a merchant caravan, a plague among your rivals, a duel, deserters, a rich harvest.',
      'Most are offers: answer in time or they pass. The envelope by the HUD reopens a closed one.'],
    numbers: [['Kinds', list(Object.keys(EVENTS.weights).map((k) => EVENTS.copy.titles[k] || nameOf(k)))], ['Time to answer', secs(EVENTS.offerSec)], ['About every', mins(EVENTS.meanSec)]] },

  // --- Goals ---
  { id: 'bounties', group: 'goals', title: 'The Bounty Board', icon: 'bounty', seen: (s) => !!o(s.bounties).unlocked,
    lines: ['The Bounty Board, at the top of the Regions list, offers contracts: win without powers, take a typed region, hold a defense unbroken.', 'A fulfilled contract pays gold and often Renown; a contract you dislike can be rerolled.'],
    numbers: [['Contracts', String(BOUNTIES.slots)], ['Free reroll every', mins(BOUNTIES.freeRerollSec)], ['Reroll', `${BOUNTIES.rerollRenown} Renown`]] },
  { id: 'streak', group: 'goals', title: 'The Conquest Streak', icon: 'flame', seen: (s) => (o(s.streak).count | 0) >= STREAK.hideBelow || (o(s.stats).battlesWon | 0) >= 2,
    lines: ['Conquests in quick succession build a streak that raises your bounties. The flame by the HUD drains while you wait.', 'Losing or retreating from an attack breaks it.'],
    numbers: [['Window', mins(STREAK.windowSec)], ['Best bonus', `×${Math.max(...STREAK.mult)}`]] },
  { id: 'deeds', group: 'goals', title: 'Deeds', icon: 'trophy', seen: (s) => won(s),
    lines: ['Deeds are lifetime feats with bronze, silver and gold tiers. Each tier grants a small bonus that lasts across dynasties.', 'Their progress is in the Realm panel.'],
    numbers: [['Deeds', String(DEEDS.length)], ['Tiers', DEED_TIERS.map(cap).join(' · ')]] },

  // --- Dynasties ---
  { id: 'founding', group: 'dynasties', title: 'Founding a dynasty', icon: 'crown', seen: (s) => later(s) || seenHint(s, 'M4') || owned(s) >= 8,
    lines: ['When the whole continent is yours you can found a dynasty: a new, tougher continent, with your Generals, stars and Legacy carried over.', 'Each dynasty adds a star, which raises income and bounties for good.'],
    numbers: [] },
  { id: 'edicts', group: 'dynasties', title: 'Edicts', icon: 'scroll', seen: later,
    lines: ['Each new dynasty is founded under an Edict, a rule for that whole continent with a gain and a price.', 'The founding ceremony offers a few to choose from.'],
    numbers: [['Edicts', list(EDICT_LIST.map((e) => e.name))]] },
  { id: 'legacy', group: 'dynasties', title: 'Legacy', icon: 'tree', seen: later,
    lines: ['Founding a dynasty earns Legacy points to spend on a tree of lasting upgrades, at the ceremony or later in the Realm panel.'],
    numbers: [['Branches', list(LEGACY_BRANCHES.map((b) => b.name || nameOf(b.id)))]] },
  { id: 'challenges', group: 'dynasties', title: 'Challenges', icon: 'skull', seen: later,
    lines: ['Challenges make a dynasty harder in exchange for more Legacy at the next founding. They cannot be removed until then.'],
    numbers: [['Challenges', list(CHALLENGE_LIST.map((c) => c.name))], ['Legacy bonus', `+${pct(CHALLENGES.legacyBonus)}`]] },
  { id: 'quick', group: 'dynasties', title: 'Quick Conquest', icon: 'speed', seen: (s) => later(s) && (!!o(o(gens(s).legacy).nodes).quick || seenHint(s, 'D2')),
    lines: ['With the Quick Conquest Legacy, your commander can take an easy region on their own: no battle to fight, a smaller bounty.', 'Capitals, Bandit Holds and the Dragon still need you.'],
    numbers: [['For regions labelled', QUICK.label], ['Bounty', pct(QUICK.bountyShare)]] },

  // --- Boons and Relics ---
  { id: 'boons', group: 'boons', title: 'Boons', icon: 'boonCard', seen: (s) => (Array.isArray(boons2(s).owned) && boons2(s).owned.length > 0) || !!boons2(s).pending,
    lines: ['After a hard-won conquest you pick one of three Boons. They last the whole dynasty and stack.', 'Rarer Boons are stronger; a cursed one has a price. A pick can be left for later from the HUD chip.'],
    numbers: [['Choices', String(BOONS.choices)], ['In the pool', String(BOON_LIST.length)], ['Rarity', Object.entries(BOONS.rarityWeights).map(([k, v]) => `${cap(k)} ${pct(v)}`).join(' · ')], ['Reroll', `${BOONS.rerollRenown} Renown`]] },
  { id: 'duos', group: 'boons', title: 'Duos', icon: 'duoLink', seen: (s) => Array.isArray(boons2(s).owned) && boons2(s).owned.length >= 3,
    lines: ['Two Boons that belong together make a Duo: owning both unlocks a third effect at no cost.'],
    numbers: [['Duos', String(DUO_LIST.length)]] },
  { id: 'relics', group: 'boons', title: 'Relics', icon: 'chest', seen: relicSeen,
    lines: ['A glinting chest by a keep marks a region holding a Relic. Conquer it to claim the Relic for this dynasty.'],
    numbers: [['Per continent', String(RELICS.perContinent)], ['Relics in all', String(RELIC_LIST.length)]] },
  { id: 'reliquary', group: 'boons', title: 'The Reliquary', icon: 'chest', seen: (s) => relicsFound(s) > 0,
    lines: ['Every Relic you have ever found is kept in the Reliquary, in the Realm panel. Filling it takes several dynasties.'],
    numbers: [['Slots', String(RELIC_LIST.length)]] },

  // --- The Ashen Host ---
  { id: 'ashen', group: 'ashen', title: 'The Ashen Host', icon: 'skullCrown', seen: (s) => met(s).includes(ASHEN.factionId),
    lines: ['The Ashen Host is a rival of the dead. Troops you lose at their settlements rise and join them.',
      'Their capital, the Barrow Keep, raises its dead on a timer. Fire burns the dead before they can rise.'],
    numbers: [['Your losses that rise', pct(ASHEN.fallen.share)], ['Barrow Keep rises every', secs(ASHEN.rising.everySec)], ['Burning ground', secs(ASHEN.fallen.burnSec)]] },
  // --- Challenges (Phase 9) ---
  { id: 'daily', group: 'challenges', title: 'The Daily', icon: 'sun', seen: challengesOpen,
    lines: ['Every day brings one challenge that everyone plays: the same small continent, Edict, Boons, General and goal. Play it from the title screen or Settings > Challenges.',
      'Your time is the score (crowns break a tie). Retry as often as you like: your best counts, and your first try is kept apart. It never touches your realm.',
      'Past days can be played as practice. Copy your result to share it.'],
    numbers: [['Regions', `${CHALLENGE_MODE.minRegions} to ${CHALLENGE_MODE.maxRegions}`], ['Boons', list(DAILY.boonCount.map(String)).replace(' and ', ' or ')],
      ['Reward to your realm', `+${RECORD.rewardRenown} Renown, once a day`], ...bannerOf('streak').map((b) => [`${b.name} banner`, `a ${b.unlock.n}-day streak`])] },
  { id: 'scenarios', group: 'challenges', title: 'Scenarios', icon: 'castle', seen: challengesOpen,
    lines: ['Handcrafted challenges that each test one idea: a siege, a defense, the Dragon, the Ashen, several battles at once, and gold.',
      `Each earns up to ${SCENARIOS.starsEach} stars. The first ${SCENARIOS.alwaysOpen} are always open; the others open once you have met their system in your realm.`],
    numbers: [['Scenarios', String(SCENARIO_LIST.length)], ['Stars', String(SCENARIO_LIST.length * SCENARIOS.starsEach)],
      ...bannerOf('stars').map((b) => [`${b.name} banner`, `all ${b.unlock.n} stars`])] },
];

/** Which topic each panel's "?" opens. */
export const PANEL_TOPICS = {
  council: 'council', realm: 'prosperity', regions: 'bounties', generals: 'generals', settings: 'sending', boonDraft: 'boons',
  ceremony: 'founding', reliquary: 'reliquary', works: 'works', forts: 'forts', battle: 'sending', merchant: 'worldEvents', challenges: 'daily',
};

/**
 * The Codex as plain data for the UI kit: { groups: [{ id, title, topics: [{ id, title, icon, locked, lines, numbers }] }], unlocked, total }.
 * A locked topic carries no lines or numbers (no spoilers).
 */
export function codexData(state) {
  let unlocked = 0;
  const groups = CODEX_GROUPS.map((g) => ({
    id: g.id, title: g.title,
    topics: CODEX_TOPICS.filter((t) => t.group === g.id).map((t) => {
      let open = false;
      try { open = !!t.seen(state || {}); } catch { open = false; }
      if (open) unlocked += 1;
      return open ? { id: t.id, title: t.title, icon: t.icon, locked: false, lines: t.lines, numbers: t.numbers }
        : { id: t.id, title: t.title, icon: 'lock', locked: true, lines: [], numbers: [] };
    }),
  }));
  return { groups, unlocked, total: CODEX_TOPICS.length };
}
