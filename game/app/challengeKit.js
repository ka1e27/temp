// Phase 9 (docs/PLAN-PHASE9.md, docs/briefs/phase9-hookup.md): everything the challenge modes need beyond the boot, loaded on first use by
// app/challengeMode.js (import()). It re-exports the pure API and turns it into the plain data the UI kit draws (the hub, the result screen,
// the tracker). No rules here: the meta modules do the maths, this file only words their answers.
import { createChallengeGame, challengeWorld, challengeSpecOf, tickChallenge, recordChallengeBattle, noteChallengeEvents, serializeChallenge, deserializeChallenge } from '../meta/challenges.js';
import { goalProgress, goalText, challengeResult } from '../meta/challengeGoals.js';
import {
  deserializeRecord, serializeRecord, dailyStreak, recordDailyResult, recordScenarioResult, challengesUnlocked, totalStars, syncBanners, bannerList,
  selectBanner, claimDailyReward, rewardClaimed, shareData, shareText, dailyCalendar,
} from '../meta/challengesState.js';
import { dailySpec } from '../meta/daily.js';
import { scenarioSpec, scenarioList } from '../meta/scenarios.js';
import { edictInfo } from '../meta/edicts.js';
import { boonInfo } from '../meta/boons.js';
import { relicInfo } from '../meta/relics.js';
import { CHALLENGE_MODE, RECORD, BANNERS } from '../config/challenges.js';
import { SCENARIOS } from '../config/scenarios.js';
import { GENERALS } from '../config/generals.js';
import { edictView } from './dynasty.js';
import { boonIcon, relicIcon } from './boons.js';
import { CODEX_TOPICS } from './codexTopics.js';
import { createChallengeHub } from '../ui/challengeHub.js';
import { createChallengeResult } from '../ui/challengeResult.js';
import { createGoalTracker } from '../ui/goalTracker.js';
import { formatClock } from '../ui/format.js';

export {
  createChallengeGame, challengeWorld, challengeSpecOf, tickChallenge, recordChallengeBattle, noteChallengeEvents, serializeChallenge, deserializeChallenge,
  goalProgress, challengeResult, deserializeRecord, serializeRecord, recordDailyResult, recordScenarioResult, challengesUnlocked, syncBanners, bannerList,
  selectBanner, claimDailyReward, shareData, shareText, dailySpec, scenarioSpec, createChallengeHub, createChallengeResult, createGoalTracker,
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ymd = (d) => ({ y: Math.floor(d / 10000), m: Math.floor(d / 100) % 100, d: d % 100 });
/** "Oct 4" */
export function shortDate(date) { const p = ymd(date); return `${MONTHS[p.m - 1]} ${p.d}`; }
/** "Sunday, Oct 4, 2026" (the weekday from the calendar, computed with UTC so no clock is read) */
export function longDate(date) {
  const p = ymd(date);
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${DAYS[wd]}, ${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
}

/** The words of a scenario's star condition (spec.stars[i]); every number is the config's own. */
export function starMarkText(m) {
  switch (m && m.kind) {
    case 'met': return 'Meet the goal';
    case 'time': return `Within ${formatClock(m.sec)}`;
    case 'risen': return `Fewer than ${m.max} of your dead rise`;
    case 'unbroken': return 'Every defense unbroken';
    case 'unbrokenShare': return `${Math.round(m.share * 100)}% of defenses unbroken`;
    case 'gold': return `${m.n} gold`;
    case 'crowns': return `${m.n} crowns`;
    case 'losses': return m.max === 0 ? 'No battle lost' : `At most ${m.max} battles lost`;
    case 'crown': return m.crown === 'unbroken' ? 'The Unbroken crown' : `The ${m.crown} crown`;
    default: return '';
  }
}

const topicTitle = (id) => (CODEX_TOPICS.find((t) => t.id === id) || {}).title || id;
const generalText = (g) => `the ${(GENERALS.kinds[g.kind] || {}).title || 'Marshal'}, level ${g.level}`;
const scoreText = (s) => (s && s.met ? formatClock(s.sec) : null);

let worldMemo = { id: null, world: null };
function specWorld(spec) {
  if (worldMemo.id !== spec.id) worldMemo = { id: spec.id, world: challengeWorld(spec) };
  return worldMemo.world;
}

/** Today's Daily card. `resume`: the label of a saved, unfinished run of today's Daily (or null). */
export function dailyCard(record, today, resume) {
  const spec = dailySpec(today);
  const r = record.daily[today] || null;
  const e = spec.edict ? edictView(edictInfo(spec.edict)) : null;
  const claimed = rewardClaimed(record, today);
  return {
    name: spec.name, number: spec.number, dateLabel: longDate(today), goalText: goalText(spec, specWorld(spec)),
    edict: e, boons: spec.boons.map((id) => { const b = boonInfo(id) || { name: id, text: '' }; return { name: b.name, icon: boonIcon(id, b.icon), text: b.text }; }),
    relic: spec.relic ? (() => { const x = relicInfo(spec.relic) || { name: spec.relic, text: '' }; return { name: x.name, icon: relicIcon(spec.relic, x.icon), text: x.text }; })() : null,
    general: { kind: spec.general.kind, text: generalText(spec.general) },
    bestText: scoreText(r && r.best), bestCrowns: r && r.best ? Math.min(3, r.best.crowns) : null,
    firstText: r && r.first ? (r.first.met ? formatClock(r.first.sec) : 'not completed') : null, attempts: r ? r.attempts : 0,
    rewardText: claimed ? `Today’s reward is claimed: +${RECORD.rewardRenown} Renown went to your realm.` : `Complete it today: +${RECORD.rewardRenown} Renown for your realm (once a day).`,
    resume, playLabel: r && r.attempts ? 'Play again' : 'Play',
  };
}

/** The whole hub. `seen(topicId)`: the main save's Codex (scenario unlocks). */
export function hubData(record, today, seen, resume) {
  const streak = dailyStreak(record.daily, today);
  const max = SCENARIOS.starsEach * scenarioList(record, seen).length;
  return {
    streakText: streak > 0 ? `Streak: ${streak} ${streak === 1 ? 'day' : 'days'}` : (record.bestStreak ? `Best streak: ${record.bestStreak}` : ''),
    daily: dailyCard(record, today, resume && resume.kind === 'daily' && resume.key === today ? resume.label : null),
    scenarios: scenarioList(record, seen).map((s) => ({
      id: s.id, name: s.name, idea: s.idea, blurb: s.blurb, icon: s.icon, unlocked: s.unlocked, stars: s.stars,
      lockText: s.unlockTopic ? `Opens once you have met ${topicTitle(s.unlockTopic)} in your realm (see the Codex).` : '',
      bestText: s.best && s.best.met ? (s.best.goal === 'gold' ? `${s.best.gold} gold` : formatClock(s.best.sec)) : null,
      marks: (s.starMarks || []).map(starMarkText),
      resume: resume && resume.kind === 'scenario' && resume.key === s.id ? resume.label : null,
    })),
    totals: { stars: totalStars(record), max, rewardText: `All ${max}: the ${(BANNERS.find((b) => b.unlock.kind === 'stars') || {}).name || 'Gilded'} banner.` },
    calendar: dailyCalendar(record, today, 28).filter((d) => !d.beforeEpoch || d.today).map((d) => ({
      ...d, label: longDate(d.date), short: shortDate(d.date), bestText: d.bestSec != null ? formatClock(d.bestSec) : '',
    })),
    banners: bannerList(record),
  };
}

/** The tracker's line for the running challenge. */
export function trackerData(state, world) {
  const spec = challengeSpecOf(state);
  if (!spec) return { visible: false };
  const p = goalProgress(state, world, spec);
  const sec = state.challenge.done ? state.challenge.done.atSec : state.challenge.activeSec;
  return { visible: true, name: spec.name, time: formatClock(Math.floor(sec)), sec, line: p.line, goal: p.text, met: p.met, failed: p.failed };
}

/** The result screen's data from a finished run: { result, spec, rec, reward, share, shareText, banners }. */
export function resultData(o) {
  const { result, spec } = o;
  const daily = result.kind === 'daily';
  const notes = [];
  if (o.rec && o.rec.newBest && result.met) notes.push(daily ? 'A new best time for this Daily.' : 'A new best for this scenario.');
  if (o.reward && o.reward.renown > 0) notes.push(`+${o.reward.renown} Renown for your realm (today’s reward).`);
  if (daily && result.practice) notes.push('Practice: a past Daily keeps your best time but not the streak.');
  for (const id of o.banners || []) { const b = BANNERS.find((x) => x.id === id); if (b) notes.push(`New banner style: ${b.name}. Choose it in Settings.`); }
  const attackWins = result.battles.filter((b) => b.kind === 'attack' && b.won).length;
  const crownRating = o.share ? o.share.crownRating : Math.max(0, Math.min(3, Math.round(result.crowns / Math.max(1, attackWins))));
  const stars = !daily && Array.isArray(spec.stars) ? {
    n: result.stars, max: spec.stars.length,
    marks: spec.stars.map((m, i) => ({ text: starMarkText(m), on: i < result.stars })),
  } : null;
  const extra = [];
  if (spec.goal.kind === 'gold') extra.push(['Gold', String(result.gold)]);
  if (spec.stars && spec.stars.some((m) => m.kind === 'risen')) extra.push(['Risen', String(result.risen)]);
  return {
    met: result.met,
    title: result.met ? `${spec.name}: done!` : `${spec.name}: not this time`,
    sub: goalText(spec, specWorld(spec)),
    time: formatClock(Math.floor(result.sec)), crowns: result.crowns, crownRating,
    attempts: o.attempts || 1,
    streak: daily ? (o.rec ? o.rec.streak : 0) : null,
    stars, share: daily && result.met ? o.shareText : null, notes, extra,
  };
}

export { CHALLENGE_MODE, CODEX_TOPICS };
