// Deeds (PLAN-PHASE4 §4C): persistent milestones with small permanent rewards. A LEAF (config only), so economy.js, progression.js,
// frontier.js, forts.js, renown.js, generals.js and the Bounty Board can all record progress and read the rewards without an import
// cycle. Pure: no DOM, no Date.now, no Math.random, no storage.
//
//   state.generals.deeds = { v:1, progress: { [key]: number }, earned: { [deedId]: tiersEarned }, news: Earned[] }
//     LIFETIME: it lives inside the Generals record, so it survives Found a Dynasty (foundDynasty carries `generals`) and New Realm
//     (the state container carries the roster object) exactly the way the roster does. Settings > Reset (keepGenerals: false)
//     wipes it with the roster.
//   Earned = { id, name, icon, tier (1-based), tierName ('bronze'|'silver'|'gold'), reward (the reward line) }
//
// Progress is recorded inside the meta functions (conquer, awardCrowns, defenseReward, buildFort/upgradeFort, claimCompleted,
// the streak, updateProsperity / festival, settleCommander / train, duelReward): the UI never records deeds itself. It only shows
// deedProgress(state) and toasts what drainDeedNews(state) returns.
import { DEEDS, DEED_KEYS, DEED_CAPS, DEED_TIERS } from '../config/deeds.js';

const NEWS_MAX = 16;
const BY_ID = new Map(DEEDS.map((d) => [d.id, d]));

/** A fresh deeds record. */
export function defaultDeeds() {
  return { v: 1, progress: {}, earned: {}, news: [] };
}

/** Creates (or repairs) `state.generals.deeds` and returns it. Never throws on a state without generals. */
export function ensureDeeds(state) {
  if (!state.generals || typeof state.generals !== 'object') state.generals = { seq: 1, roster: [] }; // ensureGenerals adds the Marshal
  const g = state.generals;
  if (!g.deeds || typeof g.deeds !== 'object' || g.deeds.v !== 1) g.deeds = defaultDeeds();
  const d = g.deeds;
  if (!d.progress || typeof d.progress !== 'object') d.progress = {};
  if (!d.earned || typeof d.earned !== 'object') d.earned = {};
  if (!Array.isArray(d.news)) d.news = [];
  return d;
}

function readDeeds(state) {
  const d = state && state.generals && state.generals.deeds;
  return d && typeof d === 'object' && d.progress ? d : null;
}

/** The factions whose capital has been toppled, ascending. */
function toppled(progress) {
  return Object.keys(progress).filter((k) => /^capital:\d+$/.test(k) && progress[k] >= 1).map((k) => Number(k.slice(8))).sort((a, b) => a - b);
}

function progressOf(deed, progress) {
  if (deed.key === 'capitals') return toppled(progress).length;
  const v = progress[deed.key];
  return Number.isFinite(v) ? v : 0;
}

function tiersReached(deed, value) {
  let n = 0;
  for (const goal of deed.tiers) if (value >= goal) n += 1;
  return n;
}

function rewardLine(deed) {
  const v = Math.abs(deed.per) < 1 ? Math.round(Math.abs(deed.per) * 100) : Math.abs(deed.per);
  return deed.text.replace('{v}', String(v));
}

/**
 * Every deed with its progress toward the next tier, for the Realm panel grid.
 * @returns {{ id, name, icon, tier:number, tiers:number, tierName:string|null, next:number|null, progress:number, goal:number,
 *   reward:string, done:boolean }[]}  tier: tiers earned (0 = none); next: the next goal or null when all are earned
 */
export function deedProgress(state) {
  const d = readDeeds(state) || defaultDeeds();
  return DEEDS.map((deed) => {
    const progress = progressOf(deed, d.progress);
    const tier = Math.min(deed.tiers.length, Math.max(0, Math.floor(d.earned[deed.id] || 0)));
    const next = tier < deed.tiers.length ? deed.tiers[tier] : null;
    return {
      id: deed.id, name: deed.name, icon: deed.icon, tier, tiers: deed.tiers.length, tierName: tier > 0 ? DEED_TIERS[tier - 1] : null,
      next, progress: next == null ? progress : Math.min(progress, next), goal: next == null ? deed.tiers[deed.tiers.length - 1] : next,
      reward: rewardLine(deed), done: next == null,
    };
  });
}

/**
 * Records deed progress. MUTATES `state.generals.deeds`. 'sum' keys add `amount` (default 1), 'max' keys keep the larger value;
 * `capital:<faction>` marks a rival capital toppled. Returns the tiers newly earned (also queued for drainDeedNews).
 * @param {object} state
 * @param {string} key one of DEED_KEYS, or 'capital:<factionId>'
 * @param {number} [amount=1]
 * @returns {{ id, name, icon, tier, tierName, reward }[]}
 */
export function recordDeed(state, key, amount = 1) {
  const capital = typeof key === 'string' && /^capital:\d+$/.test(key);
  const mode = capital ? 'max' : DEED_KEYS[key];
  const n = Number(amount);
  if (!mode || !state || !Number.isFinite(n)) return [];
  const d = ensureDeeds(state);
  const before = Number.isFinite(d.progress[key]) ? d.progress[key] : 0;
  if (mode === 'sum') { if (n <= 0) return []; d.progress[key] = before + n; }
  else if (capital) d.progress[key] = 1;
  else if (n > before) d.progress[key] = n;
  else return [];
  const out = [];
  for (const deed of DEEDS) {
    if (deed.key !== key && !(capital && deed.key === 'capitals')) continue;
    const reached = tiersReached(deed, progressOf(deed, d.progress));
    const had = Math.max(0, Math.floor(d.earned[deed.id] || 0));
    for (let t = had + 1; t <= reached; t++) {
      out.push({ id: deed.id, name: deed.name, icon: deed.icon, tier: t, tierName: DEED_TIERS[t - 1], reward: rewardLine(deed) });
    }
    if (reached > had) d.earned[deed.id] = reached;
  }
  if (out.length) {
    d.news.push(...out);
    if (d.news.length > NEWS_MAX) d.news.splice(0, d.news.length - NEWS_MAX);
  }
  return out;
}

/** The deeds earned since the last call (toast them, add a Chronicle line), and clears the queue. MUTATES. */
export function drainDeedNews(state) {
  const d = readDeeds(state);
  if (!d || !Array.isArray(d.news) || !d.news.length) return [];
  const out = d.news.slice();
  d.news.length = 0;
  return out;
}

const NEUTRAL = Object.freeze({
  incomeMult: 1, defenceMult: 1, bountyMult: 1, attackVs: Object.freeze({}), renownAtDynastyStart: 0, freeRerolls: 0,
  streakWindowSec: 0, festivalDiscount: 0, xpMult: 1, fortCostMult: 1, renownPerDuel: 0, vsVendetta: 1,
});

const clampCap = (stat, v) => {
  const cap = DEED_CAPS[stat];
  if (cap == null) return v;
  return cap < 0 ? Math.max(cap, v) : Math.min(cap, v);
};

/**
 * Everything the earned deeds add, capped by DEED_CAPS. Folded in by the meta functions in ONE place each (no UI math):
 *   incomeMult (economy.incomePerSec), defenceMult (playerBattleStats garrisonMult), bountyMult (economy.bounty),
 *   attackVs {[faction]: mult} (playerBattleStats atk vs the target's owner), renownAtDynastyStart (foundDynasty),
 *   freeRerolls (a new Bounty Board), streakWindowSec (streak.js), festivalDiscount (renown.festivalCost), xpMult
 *   (settleCommander), fortCostMult (forts.fortCost), renownPerDuel (events.duelReward), vsVendetta (frontier.defenseRunFor).
 */
export function deedBonuses(state) {
  const d = readDeeds(state);
  if (!d) return NEUTRAL;
  const sums = {};
  for (const deed of DEEDS) {
    const t = Math.min(deed.tiers.length, Math.max(0, Math.floor(d.earned[deed.id] || 0)));
    if (t > 0) sums[deed.stat] = (sums[deed.stat] || 0) + t * deed.per;
  }
  if (!Object.keys(sums).length) return NEUTRAL;
  const v = (stat) => clampCap(stat, sums[stat] || 0);
  const attackVs = {};
  const kb = BY_ID.get('kingbreaker');
  const kbTiers = Math.min(kb.tiers.length, Math.max(0, Math.floor(d.earned.kingbreaker || 0)));
  for (const f of toppled(d.progress).slice(0, kbTiers)) attackVs[f] = 1 + clampCap('attackVs', kb.per);
  return {
    incomeMult: 1 + v('incomeMult'),
    defenceMult: 1 + v('defenceMult'),
    bountyMult: 1 + v('bountyMult'),
    attackVs,
    renownAtDynastyStart: Math.floor(v('renownAtDynastyStart')),
    freeRerolls: Math.floor(v('freeRerolls')),
    streakWindowSec: v('streakWindowSec'),
    festivalDiscount: v('festivalDiscount'),
    xpMult: 1 + v('xpMult'),
    fortCostMult: 1 + v('fortCostMult'),
    renownPerDuel: Math.floor(v('renownPerDuel')),
    vsVendetta: 1 + v('vsVendetta'),
  };
}

/** A save's deeds, made valid: known keys only, finite non-negative numbers, earned tiers never above what progress supports. */
export function sanitizeDeeds(raw) {
  const out = defaultDeeds();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  if (raw.progress && typeof raw.progress === 'object') {
    for (const [k, v] of Object.entries(raw.progress)) {
      if (!(k in DEED_KEYS) && !/^capital:\d{1,2}$/.test(k)) continue;
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out.progress[k] = Math.min(1e9, k.startsWith('capital:') ? 1 : n);
    }
  }
  if (raw.earned && typeof raw.earned === 'object') {
    for (const deed of DEEDS) {
      const n = Math.floor(Number(raw.earned[deed.id]));
      const reached = tiersReached(deed, progressOf(deed, out.progress));
      if (Number.isFinite(n) && n > 0 && reached > 0) out.earned[deed.id] = Math.min(n, reached);
    }
  }
  return out;
}
