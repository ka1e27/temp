// Enemy AI (DESIGN §4.6, §3.3). Exports `think(battle, t) -> Command[]`: a pure function of
// battle state (it mutates only `battle.ai`, its own documented scratch state — see
// ARCHITECTURE §6) that the caller feeds into `issue()`. Deliberately NOT called by sim.js's
// step() — see the header comment in sim.js for why. The caller invokes it every tick; it does
// real work only every `enemy.thinkSec`, plus a cheap check for scheduled launches.
//
// What it does, in priority order each think:
//   1. DEFEND early. The moment a player squad is marching on one of our sites (or already
//      assaulting it) we compare its strength with the garrison we will have at arrival and
//      send the shortfall from the nearest sites that can get there in time — never more than
//      needed, never from a site that is itself under threat, never stripping the keep.
//   2. COUNTERPUNCH when clearly losing: commit everything to the player's weakest site once.
//   3. ATTACK with concentrated force: pick the best target we can actually beat, pool 2-3
//      sources, and stagger their launches so the squads ARRIVE together (memo.plans). Squads
//      already marching on a target count toward it, so we never double-commit. Sites the
//      player just emptied (over-extension) and a weak War Camp get a big score bonus.
// Personalities (DESIGN §3.3) change how it plays, not just numbers: see PERSONALITY.
//
// Deterministic (no Math.random) and cheap: path costs come from the sim's own memoised path
// cache; memo is plain JSON so a saved battle resumes identically.
//
// The AI never emits `power` commands: EnemyStats has no powers (ARCHITECTURE §6). Everything
// below is phrased as "my faction vs a target site", so an enemy powers pass would be additive.
import { BATTLE, SITE_TYPES, POWERS } from '../config/battle.js';
import { FRONTIER } from '../config/frontier.js';
import { ownerStats, siteDefence, PLAYER_OWNER } from './combat.js';
import { getRuntime } from './runtime.js';
import { routeCost, canRoute } from './routing.js';
import { UNDYING_AI } from '../config/ashen.js';

const SITE_VALUE = { hamlet: 15, village: 35, town: 55, fort: 60, tower: 25, keep: 100, camp: 90, bandit: 40, gate: 60, shrine: 70 };

// Personality tuning. `reserve`: fraction of a site's usual garrison it never sends out (keeps and
// threatened sites hold more, see holdBack). `keepGuard`: the keep insists on holding this
// multiple of the player's total strength (a cautious faction never lets the keep be rushed).
// `margin`: how much stronger than the projected defence an attack must be. `maxCommit`:
// fraction of a source's surplus it will send in one wave. `waves`: attacks in flight at once.
// `open`: fallback opening grace in seconds when EnemyStats carries no `graceSec` (the player
// needs a beat to read the board).
// `extend`: score multiplier for a player site that just emptied itself. `softOnly`: only
// attacks soft or overwhelmed targets (defensive: "counterattacks when you overextend").
// `losing`: counterpunch when our total troops fall below this share of the player's.
const PERSONALITY = {
  aggressive: {
    reserve: 0.15, keepGuard: 0.55, margin: 1.05, maxCommit: 1.0, waves: 2, thinkMult: 0.9, open: 4,
    extend: 2.0, softOnly: false, neutrals: true, losing: 0.45, sources: 3,
  },
  defensive: {
    reserve: 0.45, keepGuard: 1.4, margin: 1.4, maxCommit: 0.7, waves: 1, thinkMult: 1.0, open: 8,
    extend: 3.5, softOnly: true, neutrals: false, losing: 0.3, sources: 3,
  },
  swarm: {
    reserve: 0.25, keepGuard: 0.7, margin: 1.0, maxCommit: 0.5, waves: 3, thinkMult: 0.6, open: 2,
    extend: 1.5, softOnly: false, neutrals: true, losing: 0.4, sources: 2,
  },
  undying: UNDYING_AI.tuning, // the Ashen Host (PLAN-PHASE6): holds thickly, counterattacks once you've spent troops (attritionWindow)
  passive: {
    reserve: 0.6, keepGuard: 1.6, margin: 1.2, maxCommit: 1.0, waves: 0, thinkMult: 1.1, open: 0,
    extend: 1, softOnly: true, neutrals: false, losing: 0, sources: 3,
  },
};
const THREAT_MARGIN = 1.0; // reinforce once an incoming wave is even money
const SOFT_FRACTION = 0.3; // a hostile site below this share of its own recent peak garrison is "soft"
const EMPTIED_DROP = 0.5;  // ...or it fell below this share of what we saw last think
const MAX_SYNC_WAIT = 6;   // never hold a launch back longer than this to sync arrivals
const COUNTER_COOLDOWN = 14;
const PEAK_DECAY = 0.97;  // per think: a site's remembered peak fades so a permanently smaller site stops holding back
const KEEP_TOPUP = 0.9;

const raidCache = new Map();

/**
 * The faction's tuning. In a defense battle (DESIGN §10.1: a war band raiding the player) every personality plays as a raider
 * (FRONTIER.raidAI overrides: no keep of its own to guard, little reserve, always attacking), keeping only its think rate.
 */
function tuning(personality, battle) {
  const base = PERSONALITY[personality] || PERSONALITY.aggressive;
  if (!battle || battle.mode !== 'defense') return base;
  let p = raidCache.get(base);
  if (!p) raidCache.set(base, (p = { ...base, ...FRONTIER.raidAI.tuning }));
  return p;
}

/** Defense battles: how hard the raid presses now. 0 for the first half of the siege, rising to 1 as the timer runs out. */
function raidUrgency(battle, t) {
  if (battle.mode !== 'defense' || !(battle.siegeSec > 0)) return 0;
  return Math.max(0, Math.min(1, (t / battle.siegeSec - FRONTIER.raidAI.urgencyFrom) / (1 - FRONTIER.raidAI.urgencyFrom)));
}

// --- geometry / projection ----------------------------------------------------------------
// Front lines (DESIGN §4.4): the cost of a leg is the cost of the route this faction may actually march (Infinity when
// the rule leaves none), memoised by routing.js and dropped whenever a settlement changes hands. The AI is never
// relaxed: a target it cannot route to simply is not a candidate.
function pathCost(battle, a, b) {
  return routeCost(battle, a.owner, a.id, b.id);
}

/** Remaining path cost of a marching squad (cost-1.0-hex equivalents). */
function remainingCost(battle, squad) {
  const byIndex = getRuntime(battle).byIndex;
  let cost = 0;
  for (let j = squad.seg; j < squad.path.length; j++) {
    cost += byIndex.get(squad.path[j]).cost * (j === squad.seg ? 1 - squad.prog : 1);
  }
  return cost;
}

/** Troops a site will hold in `sec` (growth toward the cap, bleed above it) — sim.js's rule. */
function projectTroops(site, sec) {
  if (site.troops < site.cap) return Math.min(site.cap, site.troops + site.growth * sec);
  if (site.troops > site.cap) {
    const bleed = Math.max(BATTLE.minBleed, BATTLE.overCapBleed * (site.troops - site.cap));
    return Math.max(site.cap, site.troops - bleed * sec);
  }
  return site.troops;
}

// --- per-think context ---------------------------------------------------------------------
/** Updates and returns each site's decaying peak garrison: the scale-free yardstick for "how much
 * this site normally holds" (site caps differ by an order of magnitude between types and tiers). */
function updatePeaks(battle) {
  const memo = battle.ai.memo;
  const peak = memo.peak || (memo.peak = {});
  for (const s of battle.sites) peak[s.id] = Math.max(s.troops, (peak[s.id] || 0) * PEAK_DECAY);
  return peak;
}

function buildContext(battle, t) {
  const { player, enemy, arena } = battle;
  const me = arena.enemyFaction;
  const myStats = ownerStats(me, player, me, enemy);
  const p = tuning(enemy.personality, battle);
  const marchMult = t < battle.effects.marchUntil ? POWERS.march.mult : 1;
  const ctx = {
    battle, t, me, p, myStats,
    myUnit: myStats.atk * myStats.def,
    plUnit: player.atk * player.def,
    mySpeed: Math.max(0.01, BATTLE.baseSpeed * myStats.speed),
    plSpeed: Math.max(0.01, BATTLE.baseSpeed * player.speed * marchMult),
    mine: [], hostile: [], neutral: [],
    incoming: new Map(),  // my site id -> { strength, eta }: player squads marching on it
    coverage: new Map(),  // target id -> strength of MY squads already committed to it
    reinf: new Map(),     // player site id -> troops of player squads marching to reinforce it
    plStrength: 0, myTroops: 0, foeTroops: 0,
    peak: updatePeaks(battle),
    planned: new Map(),   // site id -> troops promised to a scheduled launch (see runPlans)
  };
  for (const s of battle.sites) {
    if (s.owner === me) ctx.mine.push(s);
    else if (s.owner === PLAYER_OWNER) ctx.hostile.push(s);
    else ctx.neutral.push(s);
  }
  for (const s of ctx.mine) ctx.myTroops += s.troops;
  for (const s of ctx.hostile) { ctx.foeTroops += s.troops; ctx.plStrength += s.troops * ctx.plUnit; }
  for (const sq of battle.squads) {
    const to = battle.sites[sq.to];
    if (sq.owner === me) {
      ctx.myTroops += sq.count;
      if (to && to.owner !== me) addTo(ctx.coverage, to.id, sq.count * ctx.myUnit);
    } else if (sq.owner === PLAYER_OWNER) {
      ctx.foeTroops += sq.count;
      ctx.plStrength += sq.count * ctx.plUnit;
      if (!to || sq.state !== 'march') continue;
      if (to.owner === me) {
        const eta = remainingCost(battle, sq) / ctx.plSpeed;
        const cur = ctx.incoming.get(to.id) || { strength: 0, eta: Infinity };
        cur.strength += sq.count * ctx.plUnit;
        cur.eta = Math.min(cur.eta, eta);
        ctx.incoming.set(to.id, cur);
      } else if (to.owner === PLAYER_OWNER) {
        addTo(ctx.reinf, to.id, sq.count);
      }
    }
  }
  for (const plan of battle.ai.memo.plans || []) {
    const to = battle.sites[plan.to];
    if (to && to.owner !== me) addTo(ctx.coverage, to.id, plan.count * ctx.myUnit);
    addTo(ctx.planned, plan.from, plan.count);
  }
  if (ctx.p.attrition) ctx.p = attritionWindow(battle, ctx);
  return ctx;
}

/** The 'undying' attrition window (config/ashen.js UNDYING_AI): once the player's strength falls under `spentAt` x its decaying peak,
 * this think plays with the window's overrides (it strikes while you rebuild). The peak lives in memo (plain JSON). */
function attritionWindow(battle, ctx) {
  const memo = battle.ai.memo;
  memo.plPeak = Math.max(ctx.plStrength, (memo.plPeak || 0) * UNDYING_AI.peakDecay);
  if (ctx.plStrength >= UNDYING_AI.spentAt * memo.plPeak) return ctx.p;
  return { ...ctx.p, ...UNDYING_AI.window };
}

function addTo(map, key, amount) {
  map.set(key, (map.get(key) || 0) + amount);
}

function siteDef(site, t) {
  return siteDefence(site) * (t < site.bulwarkUntil ? POWERS.bulwark.mult : 1);
}

/** Per-troop defensive strength of a site for whoever holds it. */
function defUnit(ctx, site) {
  const { battle } = ctx;
  const stats = ownerStats(site.owner, battle.player, ctx.me, battle.enemy);
  return stats.atk * stats.def * siteDef(site, ctx.t);
}

/** Troops a site keeps at home: a share of its usual garrison, and enough to meet whatever is
 * marching on it. */
function holdBack(ctx, site) {
  const p = ctx.p;
  let hold = p.reserve * Math.min(site.troops, ctx.peak[site.id] || 0);
  const inc = ctx.incoming.get(site.id);
  if (inc) hold = Math.max(hold, Math.min(site.troops, (inc.strength * 1.1) / defUnit(ctx, site)));
  hold += ctx.planned.get(site.id) || 0; // troops already promised to a staggered launch stay put
  if (site.assault && site.assault.owner !== ctx.me) hold = site.troops;
  if (site.type === 'keep') hold = Math.max(hold, Math.min(site.troops, keepGuard(ctx, site)));
  return hold;
}

/** Troops the keep insists on holding: keepGuard x the player's total strength, never more than
 * 90% of its cap. */
function keepGuard(ctx, keep) {
  const guard = (ctx.p.keepGuard * ctx.plStrength) / (ctx.myUnit * siteDef(keep, ctx.t));
  return Math.min(KEEP_TOPUP * keep.cap, guard);
}

function sourcesOf(ctx, exclude) {
  const out = [];
  for (const s of ctx.mine) {
    if (exclude && s.id === exclude.id) continue;
    const avail = Math.max(0, s.troops - holdBack(ctx, s)) * ctx.p.maxCommit;
    if (avail >= 1) out.push({ site: s, avail });
  }
  return out;
}

function send(ctx, commands, site, to, count) {
  const n = Math.floor(Math.min(count, site.troops));
  if (n < 1) return 0;
  const fraction = Math.min(1, (n + 0.01) / site.troops);
  commands.push({ type: 'send', owner: ctx.me, from: [site.id], to: to.id, fraction });
  return n;
}

// --- 1. defence ---------------------------------------------------------------------------
function assaultStrength(ctx, site) {
  if (!site.assault || site.assault.owner === ctx.me) return 0;
  let sum = 0;
  for (const id of site.assault.squads) {
    const sq = ctx.battle.squads.find((s) => s.id === id);
    if (sq) sum += sq.count * ctx.plUnit;
  }
  return sum;
}

function friendlyEnRoute(ctx, site) {
  let n = 0;
  for (const sq of ctx.battle.squads) {
    if (sq.owner === ctx.me && sq.to === site.id && sq.state === 'march') n += sq.count;
  }
  return n;
}

/** Sends the shortfall to every threatened site, keep first. Records what it spent. */
function defend(ctx, commands, spent) {
  const order = [...ctx.mine].sort((a, b) => (b.type === 'keep') - (a.type === 'keep') || a.id - b.id);
  for (const site of order) {
    const inc = ctx.incoming.get(site.id);
    const assault = assaultStrength(ctx, site);
    const attack = (inc ? inc.strength : 0) + assault;
    if (attack <= 0) continue;
    if (site.type === 'gate') continue; // the Gate is a wall: it holds with its own garrison, never refilled from the keep (DESIGN §10.13)
    const eta = assault > 0 ? 0 : inc.eta;
    const unit = defUnit(ctx, site);
    const garrison = projectTroops(site, eta) + friendlyEnRoute(ctx, site);
    const deficit = (attack * THREAT_MARGIN - garrison * unit) / unit; // troops still needed
    if (deficit <= 0) continue;

    const helpers = [];
    for (const h of ctx.mine) {
      if (h.id === site.id) continue;
      const helpEta = pathCost(ctx.battle, h, site) / ctx.mySpeed;
      if (!Number.isFinite(helpEta) || helpEta > eta + (assault > 0 ? 8 : 3)) continue;
      const avail = Math.max(0, h.troops - holdBack(ctx, h) - (spent.get(h.id) || 0));
      if (avail >= 1) helpers.push({ site: h, avail, helpEta });
    }
    helpers.sort((a, b) => a.helpEta - b.helpEta || a.site.id - b.site.id);
    const pool = helpers.reduce((sum, h) => sum + h.avail, 0);
    // Do not throw good troops after bad: skip a site we cannot save unless it is the keep.
    if (site.type !== 'keep' && pool < deficit * 0.6) continue;
    let need = deficit;
    for (const h of helpers) {
      if (need <= 0) break;
      const n = send(ctx, commands, h.site, site, Math.min(h.avail, need));
      if (n > 0) {
        need -= n;
        addTo(spent, h.site.id, n);
      }
    }
  }
}

/** Keeps the region's keep near full while it can spare troops (a keep left to regrow alone is
 * the cheapest win a player can find). */
function topUpKeep(ctx, commands, spent) {
  const keep = ctx.mine.find((s) => s.type === 'keep');
  if (!keep) return;
  const target = keepGuard(ctx, keep);
  if (keep.troops + friendlyEnRoute(ctx, keep) >= target) return;
  const helper = sourcesOf(ctx, keep)
    .map((s) => ({ ...s, cost: pathCost(ctx.battle, s.site, keep) }))
    .filter((s) => Number.isFinite(s.cost))
    .sort((a, b) => a.cost - b.cost || a.site.id - b.site.id)[0];
  if (!helper) return;
  const room = target - keep.troops - friendlyEnRoute(ctx, keep);
  const n = send(ctx, commands, helper.site, keep, Math.min(helper.avail - (spent.get(helper.site.id) || 0), room));
  if (n > 0) addTo(spent, helper.site.id, n);
}

// --- 2/3. offence -------------------------------------------------------------------------
function isSoft(ctx, site) {
  const seen = ctx.battle.ai.memo.seen || {};
  const emptied = seen[site.id] !== undefined && site.troops < EMPTIED_DROP * seen[site.id];
  return site.troops < SOFT_FRACTION * (ctx.peak[site.id] || 0) || emptied;
}

/** Evaluates attacking `target` now: the strength it needs, the sources that could go and when
 * each would arrive. Returns null when we cannot beat it with what we can spare. */
function evaluate(ctx, target, sources, spent, margin) {
  const nearest = sources
    .map((s) => ({ ...s, eta: pathCost(ctx.battle, s.site, target) / ctx.mySpeed }))
    .filter((s) => Number.isFinite(s.eta))
    .sort((a, b) => a.eta - b.eta || a.site.id - b.site.id);
  if (nearest.length === 0) return null;
  const stats = ownerStats(target.owner, ctx.battle.player, ctx.me, ctx.battle.enemy);
  const unit = stats.atk * stats.def * siteDef(target, ctx.t);
  const arrive = nearest[0].eta;
  const garrison = projectTroops(target, arrive) + (ctx.reinf.get(target.id) || 0);
  const need = garrison * unit * margin;
  const covered = ctx.coverage.get(target.id) || 0;
  // a raid trusts squads already committed less (they arrive in dribbles a regrowing, Levied, Bulwarked keep eats): FRONTIER.raidAI.coverTrust
  const trust = ctx.battle.mode === 'defense' ? FRONTIER.raidAI.coverTrust : 1;
  if (covered >= need * trust * 0.9) return { covered: true, target };
  const short = need - covered / trust;
  const picked = [];
  let pooled = 0;
  for (const s of nearest) {
    const avail = s.avail - (spent.get(s.site.id) || 0);
    if (avail < 1) continue;
    picked.push({ ...s, avail });
    pooled += avail * ctx.myUnit;
    if (pooled >= short || picked.length >= ctx.p.sources) break;
  }
  if (pooled < short || picked.length === 0) return null;
  return { target, short, picked, pooled, need, unit };
}

function scoreTarget(ctx, ev, p) {
  const t = ev.target;
  let value = SITE_VALUE[t.type] ?? 20;
  if (t.owner !== PLAYER_OWNER) value *= 0.5; // neutral Free Folk hamlet: expansion, not the fight
  const soft = isSoft(ctx, t);
  if (soft) value *= p.extend;
  if (t.type === 'camp' && t.troops < 0.5 * (ctx.peak[t.id] || 0)) value *= 1.5; // the player's lifeline, left weak
  if (ctx.battle.mode === 'defense' && t.owner === PLAYER_OWNER && t.type === 'keep') value *= FRONTIER.raidAI.keepValue; // the raid's objective
  const eta = ev.picked[ev.picked.length - 1].eta;
  const cost = 0.5 + ev.short / Math.max(1, ev.pooled);
  return { score: value / ((eta + 4) * cost), soft };
}

/** Commits `ev.picked` to `ev.target`, staggering launches so the squads arrive together. */
function launch(ctx, commands, spent, ev) {
  const troopsNeeded = ev.short / ctx.myUnit;
  const etaMax = ev.picked.reduce((m, s) => Math.max(m, s.eta), 0);
  let remaining = troopsNeeded * 1.08 + 1;
  const plans = ctx.battle.ai.memo.plans || (ctx.battle.ai.memo.plans = []);
  for (const src of ev.picked) {
    if (remaining <= 0) break;
    const count = Math.floor(Math.min(src.avail, remaining));
    if (count < 1) continue;
    remaining -= count;
    addTo(spent, src.site.id, count);
    const wait = Math.min(MAX_SYNC_WAIT, etaMax - src.eta);
    if (wait < 0.75) send(ctx, commands, src.site, ev.target, count);
    else plans.push({ from: src.site.id, to: ev.target.id, count, at: ctx.t + wait });
  }
  addTo(ctx.coverage, ev.target.id, (troopsNeeded * 1.08) * ctx.myUnit);
}

function liveWaves(ctx) {
  const targets = new Set(ctx.coverage.keys());
  return targets.size;
}

function attack(ctx, commands, spent) {
  const p = ctx.p;
  if (p.waves <= 0) return;
  const sources = sourcesOf(ctx);
  if (sources.length === 0) return;
  const candidates = [...ctx.hostile];
  if (p.neutrals) candidates.push(...ctx.neutral);

  for (let wave = liveWaves(ctx); wave < p.waves; wave++) {
    let best = null;
    for (const target of candidates) {
      const ev = evaluate(ctx, target, sources, spent, p.margin * (1 - FRONTIER.raidAI.urgencyMarginDrop * raidUrgency(ctx.battle, ctx.t)));
      if (!ev || ev.covered) continue;
      const { score, soft } = scoreTarget(ctx, ev, p);
      // A defensive faction does not go looking for a fight: soft targets only, or a target
      // it outmatches so clearly that the margin is generous.
      if (p.softOnly && !soft && ev.pooled < ev.need * 1.5) continue;
      if (!best || score > best.score || (score === best.score && target.id < best.ev.target.id)) {
        best = { ev, score };
      }
    }
    if (!best) break;
    launch(ctx, commands, spent, best.ev);
  }
}

/** Clearly losing: one all-in strike at the player's weakest site (camp/keep preferred). */
function counterpunch(ctx, commands, spent) {
  const memo = ctx.battle.ai.memo;
  const p = ctx.p;
  if (p.waves <= 0 || ctx.hostile.length === 0) return false;
  if (memo.lastCounter !== undefined && ctx.t - memo.lastCounter < COUNTER_COOLDOWN) return false;
  if (ctx.myTroops * ctx.myUnit >= p.losing * ctx.foeTroops * ctx.plUnit) return false;

  let best = null;
  for (const target of ctx.hostile) {
    const unit = defUnit(ctx, target);
    const garrison = projectTroops(target, 6) + (ctx.reinf.get(target.id) || 0);
    const weak = garrison * unit / (SITE_VALUE[target.type] ?? 20);
    if (!best || weak < best.weak) best = { target, weak, need: garrison * unit };
  }
  if (!best) return false;
  const sources = ctx.mine
    .map((s) => ({ site: s, avail: Math.max(0, s.troops - 1), eta: pathCost(ctx.battle, s, best.target) / ctx.mySpeed }))
    .filter((s) => s.avail >= 1 && Number.isFinite(s.eta));
  const pooled = sources.reduce((sum, s) => sum + s.avail, 0) * ctx.myUnit;
  if (pooled < best.need * 0.6) return false;
  const etaMax = sources.reduce((m, s) => Math.max(m, s.eta), 0);
  const plans = memo.plans || (memo.plans = []);
  for (const s of sources) {
    const n = Math.floor(s.avail);
    addTo(spent, s.site.id, n);
    const wait = Math.min(MAX_SYNC_WAIT, etaMax - s.eta);
    if (wait < 0.75) send(ctx, commands, s.site, best.target, n);
    else plans.push({ from: s.site.id, to: best.target.id, count: n, at: ctx.t + wait });
  }
  memo.lastCounter = ctx.t;
  return true;
}

// --- scheduled launches --------------------------------------------------------------------
function runPlans(battle, t, me) {
  const memo = battle.ai.memo;
  if (!memo.plans || memo.plans.length === 0) return [];
  const commands = [];
  const keep = [];
  for (const plan of memo.plans) {
    if (t < plan.at) { keep.push(plan); continue; }
    const from = battle.sites[plan.from];
    const to = battle.sites[plan.to];
    if (!from || !to || from.owner !== me || to.owner === me) continue; // stale: drop it
    if (!canRoute(battle, me, from.id, to.id)) continue; // the front moved: the road is gone
    const n = Math.floor(Math.min(plan.count, from.troops * 0.95));
    if (n < 1) continue;
    commands.push({ type: 'send', owner: me, from: [from.id], to: to.id, fraction: Math.min(1, (n + 0.01) / from.troops) });
  }
  memo.plans = keep;
  return commands;
}

/**
 * Decides this faction's commands for the current tick: any scheduled launches that have come
 * due, plus (once per `enemy.thinkSec`) a fresh defend / counterpunch / attack pass.
 */
export function think(battle, t) {
  const { enemy, arena } = battle;
  const me = arena.enemyFaction;
  if (!battle.ai.memo) battle.ai.memo = {};
  const commands = runPlans(battle, t, me);
  if (t < battle.ai.nextThink) return commands;
  const p = tuning(enemy.personality, battle);
  battle.ai.nextThink = t + Math.max(0.1, (enemy.thinkSec || 2) * p.thinkMult);

  const ctx = buildContext(battle, t);
  if (ctx.mine.length === 0) return commands;
  const spent = new Map();

  // Opening grace (ENEMY_SCALING.graceSecByTier, delivered as enemy.graceSec): defend and top up
  // from the first tick, but no offence until the player has had time to read the board.
  const grace = enemy.graceSec ?? p.open;
  // A faction that is clearly losing throws everything into one counterpunch first; shuffling
  // troops into the keep at the same moment would only fight that order.
  if (t >= grace && counterpunch(ctx, commands, spent)) {
    finishThink(battle);
    return commands;
  }
  defend(ctx, commands, spent);
  topUpKeep(ctx, commands, spent);
  if (t >= grace) attack(ctx, commands, spent);
  finishThink(battle);
  return commands;
}

function finishThink(battle) {

  const seen = {};
  for (const s of battle.sites) seen[s.id] = s.troops;
  battle.ai.memo.seen = seen;
}
