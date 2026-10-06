// Phase 5, Dynasties that change the rules (docs/PLAN-PHASE5.md), integration side: the browser glue between the pure modules (meta/edicts.js,
// meta/legacy.js, meta/quick.js) and the UI. It owns no rules and does no maths: it builds the founding ceremony's pages, the Realm panel's Edict,
// laurels and Legacy tree, the UI's view of the modifiers (Iron Will, Lone Banner, Warrior Kings, Bounty Hunters, Peace of the Crowns), and runs
// Quick Conquest's headless battle time-sliced across animation frames.
//
//   const dynasty = createDynasty({ getState, getWorld, container, ui, services });
//   dynasty.realmData()          // { dynasty: { edict, challenges, challengeNote }, legacy } for ui/realm.js
//   dynasty.ceremonyData(seed)   // ui/ceremony.js's data for the founding that will use `seed`
//   dynasty.buyLegacy(id, where) // 'ceremony' | 'realm': the result is said beside the tree
//   dynasty.ui()                 // { ironWill, loneBanner, abilityUses, streak, raids, bountySlots, quickConquest }
import { edictMods, currentEdict, edictChoices, allChallenges, legacyTreeText } from '../meta/edicts.js';
import { legacyInfo, buyLegacy, legacyPointsForFounding, ensureLegacy } from '../meta/legacy.js';
import { CHALLENGES } from '../config/edicts.js';
import { DYNASTY } from '../config/meta.js';
import { PLAYER_FACTION } from '../meta/state.js';
import { crownTotals } from '../meta/crowns.js';
import { shortNumber, formatDurationWords } from '../ui/format.js';
import { archipelagoFor } from '../meta/rivals.js';
import { SEA } from '../config/sea.js';

/**
 * PLAN-PHASE12 §12A: the ceremony's line for a founding onto an archipelago ("The House of X sets sail…"). The island count is only known once the
 * continent is made (the Edict picked in the ceremony can reshape it), so the ceremony says "an archipelago" and the arrival toast gives the count.
 */
export function voyageLine(house, islands) {
  const t = SEA.copy.ceremony.replace('{house}', house);
  return islands ? t.replace('{n}', String(islands)) : t.replace(/ of \{n\} islands/, '');
}

// The config names generic icons; the UI has a crest per Edict, a medallion per Legacy branch and a mark per Challenge (game/ui/icons.js).
const EDICT_ICON = Object.freeze({
  ageOfIron: 'edictIron', merchantPrinces: 'edictMerchant', longWinter: 'edictWinter', ironFrontier: 'edictFrontier', peaceOfCrowns: 'edictPeace',
  ageOfDragons: 'edictDragons', bountyHunters: 'edictBounty', grandFestival: 'edictFestival', warriorKings: 'edictWarriors', openRoads: 'edictRoads',
});
const BRANCH_ICON = Object.freeze({ war: 'legacyWar', realm: 'legacyRealm', court: 'legacyCourt' });
const CHALLENGE_ICON = Object.freeze({ ironWill: 'challengeIronWill', overrun: 'challengeOverrun', loneBanner: 'challengeLoneBanner' });
const REFUSAL = Object.freeze({ owned: 'You already own it.', locked: 'Buy the node above it first.', points: 'Not enough Legacy points.', unknown: 'That cannot be bought.' });

export const edictView = (e) => (e ? { id: e.id, name: e.name, icon: EDICT_ICON[e.id] || 'shield', upside: e.upside, cost: e.cost } : null);
export const challengeView = (c) => (c ? { id: c.id, name: c.name, icon: CHALLENGE_ICON[c.id] || 'laurel', rule: c.text } : null);
const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * @param {{ getState: () => object, getWorld: () => object, container?: object, ui: object, services: object }} deps
 */
export function createDynasty({ getState, getWorld, ui, services }) {
  /** The Legacy tree as ui/legacyTree.js draws it. */
  function legacyView(state = getState()) {
    const info = legacyInfo(state);
    const tree = legacyTreeText();
    const byId = new Map();
    for (const b of tree) for (const n of b.nodes) byId.set(n.id, n);
    return {
      available: info.available, spent: info.spent,
      branches: tree.map((b) => ({
        id: b.id, name: b.name, icon: BRANCH_ICON[b.id] || 'tree',
        nodes: b.nodes.map((n) => {
          const st = info.nodes[n.id];
          const state2 = st === 'owned' ? 'owned' : st === 'buyable' ? 'affordable' : st === 'locked' ? 'locked' : 'short';
          const short = Math.max(0, n.cost - info.available);
          const reason = state2 === 'locked' ? `Needs ${byId.get(n.requires)?.name || 'the node above'}` : state2 === 'short' ? `${short} more point${short === 1 ? '' : 's'}` : '';
          return { id: n.id, name: n.name, cost: n.cost, effect: n.effectText, state: state2, reason };
        }),
      })),
    };
  }

  /** The Realm panel: this dynasty's Edict and Challenge laurels, and the Legacy tree once Legacy exists (the first founding grants it). */
  function realmData() {
    const state = getState();
    const cur = currentEdict(state);
    const info = legacyInfo(state);
    const showLegacy = info.points > 0 || (state.dynasty && state.dynasty.level > 1);
    return {
      dynastyRules: {
        edict: edictView(cur.edict),
        challenges: cur.challenges.map(challengeView).filter(Boolean),
        challengeNote: `Complete this dynasty with them for +${pct(CHALLENGES.legacyBonus)} Legacy points each at the next founding.`,
      },
      legacy: showLegacy ? legacyView() : null,
    };
  }

  /** The House's name: its home region on this continent. */
  function houseName() {
    const world = getWorld();
    const r = world && world.regions[world.startRegion];
    return r ? r.name : 'the Realm';
  }

  /** The founding ceremony's pages for a founding onto `nextSeed`. */
  function ceremonyData(nextSeed, save) {
    const state = getState();
    const preview = session ? session.preview : state;
    const world = getWorld();
    const stars = DYNASTY.starBase + state.dynasty.level;
    const sworn = currentEdict(state).challenges.length;
    const owned = state.owner.filter((o) => o === PLAYER_FACTION).length;
    const crowns = crownTotals(state, world);
    const pts = legacyPointsForFounding(state);
    return {
      house: houseName(),
      voyage: archipelagoFor(nextSeed, state.dynasty.level + 1) ? voyageLine(houseName()) : '', // PLAN-PHASE12: the next continent is an archipelago
      level: state.dynasty.level,
      stats: [
        { icon: 'flag', label: 'Regions held', value: `${owned} / ${world.regions.length}` },
        { icon: 'crown', label: 'Dynasty crowns', value: `${crowns.earned} / ${crowns.possible}` },
        { icon: 'trophy', label: 'Battles won', value: shortNumber(state.stats.battlesWon || 0) },
        { icon: 'clock', label: 'Time played', value: formatDurationWords(state.stats.playSec || 0) },
      ],
      stars,
      starsTotal: state.dynasty.stars + stars,
      starText: services.starText ? services.starText() : '',
      legacyEarned: pts,
      legacyNote: sworn ? `${stars} for the stars, +${pct(CHALLENGES.legacyBonus * sworn)} for ${sworn} Challenge${sworn === 1 ? '' : 's'} kept` : 'Spend them on the next page',
      legacy: legacyView(preview),
      edicts: edictChoices(preview, nextSeed).map(edictView),
      edictNote: edictMods(preview).edictChoicesAdd > 0 ? 'Your Heralds bring one more Edict to choose from.' : '',
      challenges: allChallenges().map(challengeView),
      challengeBonus: `Tick any number. Each one kept until the next founding adds +${pct(CHALLENGES.legacyBonus)} Legacy points then.`,
      challengeWarning: 'Harder: Challenges cannot be removed until the next founding.',
      save,
    };
  }

  // --- the ceremony's session: the Legacy page spends the points this founding grants (they exist only once foundDynasty returns), so it buys on a
  // PREVIEW of the Legacy record (points + legacyPointsForFounding); "Found" replays those buys on the new state before the world is made. Heralds bought
  // there already changes the Edict draw (edictChoices reads the preview's nodes).
  let session = null;
  function beginSession(seed) {
    const state = getState();
    const real = legacyInfo(state);
    const nodes = { ...((state.generals && state.generals.legacy && state.generals.legacy.nodes) || {}) };
    const legacy = { v: 1, points: real.points + legacyPointsForFounding(state), spent: real.spent, nodes, pendingBonus: real.pendingBonus };
    session = { seed, bought: [], preview: { ...state, generals: { ...(state.generals || {}), legacy } } };
    return session;
  }
  const endSession = () => { session = null; };

  /** A Legacy node bought from the ceremony (on the preview) or the Realm panel (for real); the result is said beside that tree. */
  function buy(nodeId, where) {
    const inCeremony = where === 'ceremony' && session;
    const state = inCeremony ? session.preview : getState();
    const res = buyLegacy(state, nodeId);
    if (res.ok && inCeremony) session.bought.push(nodeId);
    const tree = where === 'ceremony' ? ui.ceremony.tree : ui.realm.legacyTree;
    if (res.ok) {
      const name = legacyTreeText().flatMap((b) => b.nodes).find((n) => n.id === nodeId)?.name || 'it';
      services.sfx?.play('upgrade', { pitch: 1.1 });
      tree?.setStatus(`Bought ${name}. It is yours for every dynasty to come.`);
      if (!inCeremony) services.autosave?.save();
    } else {
      services.sfx?.play('error');
      tree?.setStatus(REFUSAL[res.reason] || REFUSAL.unknown, 'warning');
    }
    return res;
  }

  /** What the UI must show differently under this dynasty's rules. */
  function uiMods() {
    const state = getState();
    const m = edictMods(state);
    const ch = new Set(currentEdict(state).challenges.map((c) => c.id));
    return {
      ironWill: ch.has('ironWill'), loneBanner: ch.has('loneBanner'), abilityUses: m.abilityUses || 1,
      streak: m.streak !== false, raids: m.raids !== false, bountySlots: m.bountySlots, quickConquest: !!m.quickConquest,
    };
  }

  /** Dev: add Legacy points. */
  function devGrant(n = 10) { const l = ensureLegacy(getState()); l.points += Math.max(0, n | 0); return legacyInfo(getState()); }

  return { devGrant, legacyView, realmData, ceremonyData, houseName, buy, ui: uiMods, beginSession, endSession, get session() { return session; } };
}
