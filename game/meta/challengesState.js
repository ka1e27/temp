// Phase 9 (PLAN-PHASE9 §9A, §9B, §9C): the lasting record of the challenge modes, stored by the app under CHALLENGE_MODE.recordKey
// (its own key: it survives a New Realm and never rides in the realm's save). Daily results (best, first attempt, attempts, played on
// its own day), scenario stars, the banner unlocks and the chosen banner, the Daily reward dates. Pure: dates are passed in.
//
//   record = { v:1, daily: { [yyyymmdd]: DailyRec }, scenarios: { [id]: ScenarioRec }, banners: { unlocked: string[], selected },
//              rewarded: number[], bestStreak }
//   DailyRec = { attempts, first: Score|null, best: Score|null, onDay: boolean }   Score = { met, sec, crowns, at? }
//   ScenarioRec = { attempts, stars, first: Score|null, best: Score|null }          (scenario Score adds stars, gold, risen)
import { RECORD, BANNERS, CHALLENGE_MODE, DAILY } from '../config/challenges.js';
import { SCENARIO_LIST, SCENARIOS } from '../config/scenarios.js';
import { compareScores } from './challengeGoals.js';
import { isDate, addDays } from './dates.js';
import { dailyNumber } from './daily.js';
import { deedProgress } from './deeds.js';
import { earnRenown } from './renownState.js';

const BANNER_IDS = BANNERS.map((b) => b.id);
const SCEN_IDS = SCENARIO_LIST.map((s) => s.id);

export function defaultRecord() {
  return { v: 1, daily: {}, scenarios: {}, banners: { unlocked: ['plain'], selected: 'plain' }, rewarded: [], bestStreak: 0 };
}

const num = (v, max, d = 0) => (Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : d);

function slimScore(s, scenario) {
  if (!s || typeof s !== 'object') return null;
  const out = { met: s.met === true, sec: num(s.sec, 1e7), crowns: Math.floor(num(s.crowns, 999)) };
  if (scenario) { out.stars = Math.floor(num(s.stars, SCENARIOS.starsEach)); out.gold = Math.floor(num(s.gold, 1e12)); out.risen = Math.floor(num(s.risen, 1e6)); out.goal = typeof s.goal === 'string' ? s.goal.slice(0, 16) : ''; }
  return out;
}

/** A stored record made valid; junk becomes a fresh record. Never throws. */
export function sanitizeRecord(raw) {
  const out = defaultRecord();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const daily = raw.daily && typeof raw.daily === 'object' ? raw.daily : {};
  const dates = Object.keys(daily).map(Number).filter(isDate).sort((a, b) => b - a).slice(0, RECORD.historyMax);
  for (const d of dates) {
    const r = daily[d];
    if (!r || typeof r !== 'object') continue;
    out.daily[d] = { attempts: Math.floor(num(r.attempts, 1e6)), first: slimScore(r.first, false), best: slimScore(r.best, false), onDay: r.onDay === true };
  }
  const sc = raw.scenarios && typeof raw.scenarios === 'object' ? raw.scenarios : {};
  for (const id of SCEN_IDS) {
    const r = sc[id];
    if (!r || typeof r !== 'object') continue;
    out.scenarios[id] = { attempts: Math.floor(num(r.attempts, 1e6)), stars: Math.floor(num(r.stars, SCENARIOS.starsEach)), first: slimScore(r.first, true), best: slimScore(r.best, true) };
  }
  const b = raw.banners && typeof raw.banners === 'object' ? raw.banners : {};
  const unlocked = Array.isArray(b.unlocked) ? b.unlocked.filter((id) => BANNER_IDS.includes(id)) : [];
  out.banners.unlocked = BANNER_IDS.filter((id) => id === 'plain' || unlocked.includes(id));
  out.banners.selected = out.banners.unlocked.includes(b.selected) ? b.selected : 'plain';
  out.rewarded = (Array.isArray(raw.rewarded) ? raw.rewarded : []).filter(isDate).filter((d, i, a) => a.indexOf(d) === i).sort((x, y) => y - x).slice(0, RECORD.rewardedMax);
  out.bestStreak = Math.floor(num(raw.bestStreak, 1e5));
  return out;
}

export function serializeRecord(record) { return JSON.stringify(record); }

/** Parses a stored record (null or junk: a fresh one). */
export function deserializeRecord(str) {
  if (str == null) return defaultRecord();
  try { return sanitizeRecord(JSON.parse(str)); } catch { return defaultRecord(); }
}

/**
 * Days in a row with the Daily completed ON its own day, ending today (or yesterday, when today's is not done yet: the streak is
 * still alive until the day ends). Practice runs of past days never count.
 * @param {object} history record.daily
 * @param {number} today yyyymmdd
 * @returns {number}
 */
export function dailyStreak(history, today) {
  const h = history && typeof history === 'object' ? history : {};
  const done = (d) => !!(h[d] && h[d].onDay);
  let d = done(today) ? today : addDays(today, -1);
  let n = 0;
  for (; done(d) && n < 100000; d = addDays(d, -1)) n += 1;
  return n;
}

/**
 * Records a finished (or abandoned: pass met false) Daily run. MUTATES the record. `today` is the player's date now: a completion
 * counts for the streak only when result.date === today and it is not a practice run.
 * @returns {{ firstAttempt: boolean, newBest: boolean, streak: number, attempts: number }}
 */
export function recordDailyResult(record, result, today) {
  const d = result.date;
  const r = record.daily[d] || (record.daily[d] = { attempts: 0, first: null, best: null, onDay: false });
  r.attempts += 1;
  const s = slimScore(result, false);
  const firstAttempt = r.first == null;
  if (firstAttempt) r.first = s;
  const newBest = s.met && compareScores(s, r.best) < 0;
  if (newBest) r.best = s;
  if (s.met && !result.practice && d === today) r.onDay = true;
  const keys = Object.keys(record.daily).map(Number).sort((a, b) => b - a);
  for (const k of keys.slice(RECORD.historyMax)) delete record.daily[k];
  const streak = dailyStreak(record.daily, today);
  record.bestStreak = Math.max(record.bestStreak || 0, streak);
  return { firstAttempt, newBest, streak, attempts: r.attempts };
}

/** Records a finished scenario run. MUTATES. Returns `{ newBest, stars, starsBefore, firstAttempt }`. */
export function recordScenarioResult(record, result) {
  if (!SCEN_IDS.includes(result.id)) return null;
  const r = record.scenarios[result.id] || (record.scenarios[result.id] = { attempts: 0, stars: 0, first: null, best: null });
  const starsBefore = r.stars;
  r.attempts += 1;
  const s = slimScore(result, true);
  const firstAttempt = r.first == null;
  if (firstAttempt) r.first = s;
  const newBest = s.met && compareScores(s, r.best) < 0;
  if (newBest) r.best = s;
  r.stars = Math.max(r.stars, s.met ? s.stars : 0);
  return { newBest, stars: r.stars, starsBefore, firstAttempt };
}

/** Are the Challenges open? After CHALLENGE_MODE.unlockConquests conquests in the main game, or from Dynasty 2 on. Reads only. */
export function challengesUnlocked(mainState) {
  if (!mainState || typeof mainState !== 'object') return false;
  const level = mainState.dynasty && Number.isFinite(mainState.dynasty.level) ? mainState.dynasty.level : 1;
  const conquered = mainState.stats && Number.isFinite(mainState.stats.regionsConquered) ? mainState.stats.regionsConquered : 0;
  return level > 1 || conquered >= CHALLENGE_MODE.unlockConquests;
}

/** Stars earned over all scenarios (of SCENARIO_LIST.length x 3). */
export function totalStars(record) {
  return SCEN_IDS.reduce((n, id) => n + ((record.scenarios[id] && record.scenarios[id].stars) || 0), 0);
}

/** A Deed at its gold tier in the MAIN save (read only: deedProgress never writes). */
function hasGoldDeed(mainState) {
  try { return deedProgress(mainState).some((d) => d.tiers >= 3 && d.tier >= 3); } catch { return false; }
}

function bannerEarned(b, record, mainState) {
  const u = b.unlock;
  if (u.kind === 'always') return true;
  if (u.kind === 'streak') return (record.bestStreak || 0) >= u.n;
  if (u.kind === 'stars') return totalStars(record) >= u.n;
  if (u.kind === 'deedGold') return !!mainState && hasGoldDeed(mainState);
  return false;
}

/**
 * Unlocks every banner now earned (§9C: streaks of 7 and 30, all 18 stars, a gold Deed in the main save). Unlocks are permanent.
 * MUTATES the record (never the main state). Returns the ids newly unlocked (for a toast).
 */
export function syncBanners(record, mainState) {
  const fresh = [];
  for (const b of BANNERS) {
    if (record.banners.unlocked.includes(b.id) || !bannerEarned(b, record, mainState)) continue;
    record.banners.unlocked.push(b.id);
    fresh.push(b.id);
  }
  record.banners.unlocked = BANNER_IDS.filter((id) => record.banners.unlocked.includes(id));
  return fresh;
}

/** The Settings list: `[{ id, name, text, unlocked, selected }]`. */
export function bannerList(record) {
  return BANNERS.map((b) => ({ id: b.id, name: b.name, text: b.text, unlocked: record.banners.unlocked.includes(b.id), selected: record.banners.selected === b.id }));
}

/** Chooses a banner style (only an unlocked one). MUTATES. Returns true when it changed. */
export function selectBanner(record, id) {
  if (!record.banners.unlocked.includes(id) || record.banners.selected === id) return false;
  record.banners.selected = id;
  return true;
}

/**
 * The Daily's reward to the main game (PLAN §9A): +RECORD.rewardRenown Renown to the current dynasty, once per date, only for TODAY's
 * Daily completed today (not a practice run). The claimed dates live in the record (so a New Realm cannot claim a date twice).
 * MUTATES the main state's Renown and the record. Returns `{ renown }` or null when nothing is owed.
 * @param {object} mainState the realm's state (only its Renown is touched)
 * @param {object} record
 * @param {number} date the Daily's date
 * @param {number} today the player's date now
 */
export function claimDailyReward(mainState, record, date, today) {
  if (!mainState || date !== today || record.rewarded.includes(date)) return null;
  const r = record.daily[date];
  if (!r || !r.onDay) return null;
  // reason 'deed': start-of-dynasty style grants are exempt from an Edict's Renown multiplier (Peace of the Crowns would halve 1 to 0)
  const renown = earnRenown(mainState, RECORD.rewardRenown, 'deed');
  record.rewarded.unshift(date);
  record.rewarded = record.rewarded.slice(0, RECORD.rewardedMax);
  return { renown };
}

/** True when today's reward has already been claimed. */
export function rewardClaimed(record, date) {
  return record.rewarded.includes(date);
}

/**
 * The pieces of a Daily share line (the UI formats and copies it; SHARE has the default marks):
 * `{ title, number, date, sec, time, crowns, crownRating, firstTry, attempts, marks: ('attack'|'defense'|'loss')[], met }`.
 * "Hex Dominion Daily #142 · 11:42 · 👑👑👑 · 1st try 🗡️🗡️🛡️🗡️" = title #number · time · crown x crownRating · (firstTry) marks.
 * @param {object} result challengeResult(...)
 * @param {object} [record] for attempts / first try (call after recordDailyResult)
 */
export function shareData(result, record = null) {
  const r = record && result.date != null ? record.daily[result.date] : null;
  const attackWins = result.battles.filter((b) => b.kind === 'attack' && b.won).length;
  const crownRating = Math.max(0, Math.min(3, Math.round(result.crowns / Math.max(1, attackWins))));
  // whole seconds elapsed, like every clock in the game (the result card shows formatClock(Math.floor(sec))): 97.6 s is 1:37 on both (Phase 10B)
  const sec = Math.max(0, Math.floor(result.sec));
  return {
    title: SHARE.title, number: result.date != null ? dailyNumber(result.date) : null, date: result.date, sec,
    time: `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, crowns: result.crowns, crownRating,
    firstTry: !!(r && r.attempts === 1 && result.met), attempts: r ? r.attempts : 1,
    marks: result.battles.slice(-CHALLENGE_MODE.shareMax).map((b) => (!b.won ? 'loss' : b.kind)), met: !!result.met,
  };
}

/** The share line's default copy and marks (the UI may use them as they are). */
export const SHARE = Object.freeze({
  title: 'Hex Dominion Daily', sep: ' · ', crown: '👑', firstTry: '1st try',
  marks: Object.freeze({ attack: '🗡️', defense: '🛡️', loss: '✖️' }),
});

/** A ready share line from shareData (the UI may build its own from the pieces instead). */
export function shareText(data) {
  const parts = [`${data.title} #${data.number}`, data.time, SHARE.crown.repeat(data.crownRating) || '—'];
  const marks = data.marks.map((m) => SHARE.marks[m]).join('');
  parts.push(`${data.firstTry ? `${SHARE.firstTry} ` : ''}${marks}`.trim());
  return parts.join(SHARE.sep);
}

/**
 * The calendar of past Dailies, newest first: `[{ date, number, played, met, onDay, bestSec, attempts, today }]` for `days` days
 * ending today. Past days can be replayed as practice (createChallengeGame(..., { practice: true })).
 */
export function dailyCalendar(record, today, days = 28) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, -i);
    const r = record.daily[d];
    out.push({ date: d, number: dailyNumber(d), played: !!r, met: !!(r && r.best && r.best.met), onDay: !!(r && r.onDay),
      bestSec: r && r.best ? r.best.sec : null, attempts: r ? r.attempts : 0, today: i === 0, beforeEpoch: d < DAILY.epoch });
  }
  return out;
}
