// Phase 9 (PLAN-PHASE9 §9B): the scenarios' specs (from config/scenarios.js) and their unlocks. Pure.
import { SCENARIO_LIST, SCENARIOS } from '../config/scenarios.js';
import { CHALLENGE_MODE } from '../config/challenges.js';

const BY_ID = new Map(SCENARIO_LIST.map((s) => [s.id, s]));
const memo = new Map();

/** Every scenario id, in the plan's order. */
export const SCENARIO_IDS = Object.freeze(SCENARIO_LIST.map((s) => s.id));

export function isScenarioId(id) {
  return BY_ID.has(id);
}

/**
 * The spec of scenario `id` in the same shape as dailySpec (createChallengeGame takes either). Frozen, memoised. Null for an unknown id.
 * @returns {object|null} { kind:'scenario', id, name, idea, blurb, icon, seed, world, edict, boons, relic, general, start, setup, mods, goal, raids, stars, botConcurrent }
 */
export function scenarioSpec(id) {
  if (!BY_ID.has(id)) return null;
  if (memo.has(id)) return memo.get(id);
  const s = BY_ID.get(id);
  const spec = Object.freeze({
    kind: 'scenario', id: s.id, name: s.name, idea: s.idea, blurb: s.blurb, icon: s.icon, number: SCENARIO_IDS.indexOf(id) + 1,
    seed: s.seed, world: Object.freeze({ ...CHALLENGE_MODE.world, ...s.world }), edict: s.edict, boons: s.boons, relic: s.relic,
    general: s.general, start: s.start, setup: s.setup, mods: Object.freeze({ ...CHALLENGE_MODE.baseMods, ...s.mods }),
    goal: s.goal, raids: s.raids, stars: s.stars, botConcurrent: s.botConcurrent || 1, unlock: s.unlock,
  });
  memo.set(id, spec);
  return spec;
}

/**
 * Is scenario `id` open? The first SCENARIOS.alwaysOpen are; each other one once the main game's Codex has discovered its topic.
 * `seen(topicId) -> boolean` is the app's read of the main save (codexTopics.js); it is only called, never trusted to write.
 */
export function scenarioUnlocked(id, seen) {
  const s = BY_ID.get(id);
  if (!s) return false;
  if (SCENARIO_IDS.indexOf(id) < SCENARIOS.alwaysOpen || !s.unlock) return true;
  try { return typeof seen === 'function' && seen(s.unlock) === true; } catch { return false; }
}

/**
 * The hub's list: `[{ id, name, idea, blurb, icon, unlocked, unlockTopic, stars, best }]` (stars and best from the record).
 * @param {object} record the lasting record (challengesState.js)
 * @param {(topicId:string)=>boolean} seen
 */
export function scenarioList(record, seen) {
  const rec = record && record.scenarios ? record.scenarios : {};
  return SCENARIO_LIST.map((s) => ({
    id: s.id, name: s.name, idea: s.idea, blurb: s.blurb, icon: s.icon, unlocked: scenarioUnlocked(s.id, seen), unlockTopic: s.unlock,
    stars: rec[s.id] ? rec[s.id].stars : 0, best: rec[s.id] ? rec[s.id].best : null, starMarks: s.stars,
  }));
}
