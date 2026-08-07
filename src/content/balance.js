// ALL tuning constants. No engineer hardcodes a number anywhere else, so a
// balance pass is a single-file diff.
// PURE DATA.

export const UNIT_IDS = ['militia', 'spearmen', 'raiders', 'rams', 'marshal'];

/**
 * Every unit costs 3.0-4.5 gold/sec to run (gold / trainSec), so switching what
 * a stronghold trains changes WHAT ROLE you buy per second, never HOW MUCH you
 * spend. Players experiment with counters freely.
 *
 * Balance anchor: militia attacking a spearwall (0.583 offense/gold) exactly
 * cancels spears defending (0.583 defense/gold). Every other matchup is a
 * deliberate deviation from that.
 */
export const UNITS = {
  militia:  { gold: 12,  trainSec: 8,  batch: 2, speed: 55,  atk: 4,  def: 3,  siege: 0.6,
              counters: { spearmen: 0.75 } },
  spearmen: { gold: 24,  trainSec: 8,  batch: 1, speed: 45,  atk: 5,  def: 8,  siege: 0.4,
              counters: { raiders: 0.75 }, bulwark: 1.75 },
  raiders:  { gold: 45,  trainSec: 12, batch: 1, speed: 105, atk: 13, def: 4,  siege: 0.8,
              counters: { militia: 0.60, rams: 1.0 }, skirmish: 0.5 },
  rams:     { gold: 80,  trainSec: 20, batch: 1, speed: 30,  atk: 6,  def: 2,  siege: 12,
              counters: { spearmen: 2.6 }, base: 0.4 },
  marshal:  { gold: 180, trainSec: 40, batch: 1, speed: 60,  atk: 20, def: 14, siege: 2.0,
              counters: {}, banner: 0.20, trainBuff: 0.30, maxPerSite: 1 },
};

/** Structure HP + regen is the master pacing knob: it sets BOTH battle length
 *  and the minimum-force threshold. A force whose siege DPS is below `hpRegen`
 *  can never breach, which is what stops a handful of troops taking a
 *  stronghold — without an arbitrary "minimum N troops" rule. */
export const SITES = {
  farm:       { gold: 2.0, train: 0,    cap: 30, hp: 100, hpRegen: 2.0, defMult: 1.00 },
  stronghold: { gold: 0,   train: 1.00, cap: 45, hp: 250, hpRegen: 4.0, defMult: 1.25 },
  camp:       { gold: 4.0, train: 1.25, cap: 80, hp: 600, hpRegen: 8.0, defMult: 1.40 },
  castle:     { gold: 4.0, train: 1.25, cap: 80, hp: 600, hpRegen: 8.0, defMult: 1.60 },
};

/** Per-level multipliers for in-battle site upgrades (index 0 = level 1). */
export const SITE_LEVELS = [
  { gold: 1.00, train: 1.00, cap: 0,  hp: 1.0,  regen: 1.0 },
  { gold: 1.75, train: 1.35, cap: 20, hp: 1.4,  regen: 1.4 },
  { gold: 2.75, train: 1.75, cap: 40, hp: 1.96, regen: 1.96 },
];
export const SITE_UPGRADE = [
  { gold: 150, sec: 20 }, // L1 -> L2
  { gold: 400, sec: 35 }, // L2 -> L3
];

/** Territory influence radius by site kind, and the movement effect. */
export const INFLUENCE_RADIUS = { farm: 1, stronghold: 2, camp: 3, castle: 3 };
export const TERRITORY_SPEED = { friendly: 1.4, neutral: 1.0, hostile: 0.75 };

export const AI_TIERS = [
  { reactionTicks: 45, aggression: 0.60, commitRatio: 0.45, safetyMargin: 1.60,
    economyMult: 0.85, concurrent: 1, retreatDiscipline: 0.10, adaptComposition: false,
    ramAppetite: 0.1 },
  { reactionTicks: 32, aggression: 0.85, commitRatio: 0.55, safetyMargin: 1.40,
    economyMult: 1.00, concurrent: 1, retreatDiscipline: 0.35, adaptComposition: false,
    ramAppetite: 0.4 },
  { reactionTicks: 22, aggression: 1.00, commitRatio: 0.70, safetyMargin: 1.25,
    economyMult: 1.15, concurrent: 2, retreatDiscipline: 0.65, adaptComposition: true,
    ramAppetite: 0.8 },
  { reactionTicks: 15, aggression: 1.20, commitRatio: 0.80, safetyMargin: 1.15,
    economyMult: 1.35, concurrent: 3, retreatDiscipline: 0.90, adaptComposition: true,
    ramAppetite: 1.0 },
];

/** Anti-stalemate ladder, keyed off seconds since the last OWNERSHIP CHANGE —
 *  besieging a wall you cannot breach does not reset the clock. */
export const ATTRITION = [
  { afterSec: 150, farmMult: 0.75, regenMult: 1.0,  garrisonBleed: 0 },
  { afterSec: 210, farmMult: 0.75, regenMult: 0.5,  garrisonBleed: 1 },
  { afterSec: 270, farmMult: 0.50, regenMult: 0.0,  garrisonBleed: 1 },
];

export const BOOSTERS = {
  rally:    { charges: 2, cooldownSec: 75,  radius: 2, fraction: 0.5 },
  march:    { charges: 3, cooldownSec: 40,  factor: 0.5 },
  bombard:  { charges: 1, cooldownSec: 120, garrisonFrac: 0.25, hp: 60 },
  fortify:  { charges: 2, cooldownSec: 60,  hp: 100, regenMult: 2, attackerMult: 0.5, sec: 20 },
  tithe:    { charges: 2, cooldownSec: 90,  gold: 250, trainMult: 1.5, sec: 15 },
};

/** Expedition = base + perRegion * regionsConquered + StandingArmy upgrade. */
export const EXPEDITION = { base: 8, perRegion: 4 };

export const RALLY_MIN_GARRISON = 8;
export const SEND_FRACTIONS = [0.25, 0.5, 0.75, 1.0];
export const CENTIGOLD = 100;
