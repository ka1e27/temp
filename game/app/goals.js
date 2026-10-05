// Phase 4, Goals and Rivals, integration side (docs/PLAN-PHASE4.md): the browser glue between the pure modules (meta/streak.js, meta/deeds.js,
// meta/bounties.js, meta/grudges.js) and the UI. It owns no rules: it feeds the HUD's flame chip, the Regions panel's Bounty Board and rival rows, the
// Realm panel's Deeds grid and Trophy wall, and turns the modules' news into toasts, Chronicle lines and leader lines.
//
//   const goals = createGoals({ getState, getWorld, ui, services });
//   goals.tick(dtSec)                  // every frame (main.js), after the frontier loop: the streak's window, deed and grudge news, the board
//   goals.onFinished(snapshot, out)    // every finished battle (battles.js 'finished')
//   goals.onConquest / onProsperity / onFortBuilt / onScout   // the Bounty Board's hooks; completions are claimed at once
//   goals.hudData() / realmData() / regionsData() / grudgeFor(regionId) / retreatWarning()
import { streakInfo, tickStreak, onStreakBroken } from '../meta/streak.js';
import { deedProgress, drainDeedNews } from '../meta/deeds.js';
import {
  ensureBounties, bountiesUnlocked, bountyText, bountyProgress, rerollInfo, rerollBounty, claimCompleted,
  onConquest as bountyOnConquest, onProsperity as bountyOnProsperity, onFortBuilt as bountyOnFortBuilt, onScout as bountyOnScout,
  onBattleEnd as bountyOnBattleEnd,
} from '../meta/bounties.js';
import { grudgeInfo, trophyCount, drainGrudgeNews } from '../meta/grudges.js';
import { leaderFor } from '../meta/leaders.js';
import { renownPoints } from '../meta/renownState.js';
import { PLAYER_FACTION } from '../meta/state.js';
import { recordChronicle } from '../meta/chronicle.js';
import { edictMods } from '../meta/edicts.js';
import { STREAK } from '../config/streak.js';
import { DEED_COPY } from '../config/deeds.js';
import { BOUNTIES } from '../config/bounties.js';
import { GRUDGES } from '../config/grudges.js';
import { shortNumber } from '../ui/format.js';
import { deedGoalText } from './goalsCopy.js';

const NEWS_EVERY_MS = 400;
const BOARD_EVERY_MS = 2000; // ensureBounties: open the board, fill empty slots, re-price the gold
const FREE_FOLK = 1;
const KNOWN_ICONS = new Set(['banner', 'shield', 'crown', 'dragon', 'throne', 'scroll', 'flame', 'wheat', 'laurel', 'tower', 'swords', 'skull', 'star', 'flag', 'bounty', 'pennant', 'sword', 'trophy']);
const iconOk = (name) => (KNOWN_ICONS.has(name) ? name : 'star');

/**
 * @param {{ getState: () => object, getWorld: () => object, ui: object, services: object }} deps
 */
export function createGoals({ getState, getWorld, ui, services }) {
  let newsAtMs = 0;
  let boardAtMs = -1e9;
  let seenIds = null; // contract ids the player has seen on the board (in memory): a new one lights the Regions button's dot
  let wasUnlocked = null;

  function chronicle(text, { regionId, hl = false } = {}) {
    try { recordChronicle(getState(), { kind: 'event', t: Date.now(), hl, data: { text, regionId } }); } catch (err) { console.warn('[chronicle] a goals line was skipped:', err); }
  }
  const changed = (opts) => services.onGoalsChanged?.(opts);

  // --- Deeds ---------------------------------------------------------------------------------------------------------------------
  /** Toasts every deed tier earned since the last look (the meta functions record them; drainDeedNews hands them over once). */
  function flushDeeds() {
    // never over a battle: a toast's close button there sits over the field (it covered a War Camp on a phone); the news waits for the map
    if (services.sceneName && services.sceneName() === 'battle') return;
    // Phase 10A: the first Deed is a new system: its news waits (kept, not lost) until the pacer gives the Deeds their turn
    const pacer = services.pacer;
    if (pacer && !pacer.ready('deeds')) return;
    let news = [];
    try { news = drainDeedNews(getState()); } catch { news = []; }
    for (const d of news) {
      const message = `${DEED_COPY.earned.replace('{name}', d.name).replace('{tier}', d.tierName)}: ${d.reward}`;
      ui.toasts.update({ id: `deed-${d.id}`, type: 'success', icon: iconOk(d.icon), className: 'is-deed', seal: iconOk(d.icon), message, duration: 6000, digest: true });
      chronicle(`The realm earned a Deed: ${d.name}, ${d.tierName}.`, { hl: d.tier >= 3 });
      services.sfx?.play('upgrade', { pitch: 1.2, volume: 0.7 });
    }
    if (news.length) { pacer?.introduce('deeds'); changed(); }
  }

  /** The Realm panel's grid: every deed, its tier, the bar toward the next goal and what that tier grants. */
  function deedCells() {
    return deedProgress(getState()).map((d) => ({
      id: d.id, name: d.name, icon: iconOk(d.icon), tier: d.tier, maxTier: d.tiers, progress: d.progress, goal: d.goal,
      line: d.done ? `${DEED_COPY.complete} · ${d.reward} each` : `${deedGoalText(d.id, d.next)} · ${d.reward}`,
    }));
  }

  // --- the Conquest Streak ------------------------------------------------------------------------------------------------------
  /** For the HUD's flame chip (null hides it). */
  function streakData() {
    if (edictMods(getState()).streak === false) return null; // Bounty Hunters (PLAN-PHASE5 §5A): no Conquest Streak, no chip
    const s = streakInfo(getState());
    if (!s.visible) return null;
    const pacer = services.pacer; // Phase 10A: the chip is a new system; it waits its turn (the streak itself counts all along)
    if (pacer && !pacer.ready('streak')) return null;
    pacer?.introduce('streak');
    return { count: s.count, mult: s.mult, remainingSec: s.remainingSec, windowSec: s.windowSec };
  }

  /** The words the Retreat confirmation adds while a streak is alive (PLAN-PHASE4 §4B), or ''. */
  function retreatWarning() {
    if (edictMods(getState()).streak === false) return '';
    const s = streakInfo(getState());
    if (!(s.count >= 1)) return '';
    return s.count >= 2 ? `${STREAK.copy.retreatWarning} (${s.count} in a row, bounty ×${s.mult.toFixed(1)})` : STREAK.copy.retreatWarning;
  }

  function streakEnded(res) {
    // Phase 8: Rearguard keeps the streak through a retreat (onStreakBroken returns kept: true)
    if (res && res.kept) { ui.toasts.update({ id: 'streak-end', type: 'info', icon: 'boonRetreat', message: 'Rearguard: the streak holds.', duration: 2800 }); return; }
    if (!res || !(res.was >= 2)) return;
    const word = STREAK.copy.broken[res.reason] || STREAK.copy.broken.lost;
    ui.toasts.update({ id: 'streak-end', type: 'info', icon: 'flame', message: `${word}: ${res.was} conquests in a row.`, duration: 3200 });
    changed();
  }

  // --- the Bounty Board -----------------------------------------------------------------------------------------------------------
  const slotsOf = () => { const b = getState().bounties; return b && Array.isArray(b.slots) ? b.slots : []; };

  function refreshBoard(force = false) {
    const nowMs = performance.now();
    if (!force && nowMs - boardAtMs < BOARD_EVERY_MS) return;
    boardAtMs = nowMs;
    const state = getState();
    // Phase 10A: the board's opening is a new system; until the pacer gives it its turn it stays shut (ensureBounties is what opens it)
    // (never the first system: it opens at the first conquest, the same moment as the first victory's Renown laurel, which goes first)
    if (!bountiesUnlocked(state) && force !== 'dev' && services.pacer && ((!services.pacer.known('renown') && !services.noPacing?.()) || !services.pacer.ready('board'))) return;
    try { ensureBounties(state, getWorld()); } catch (err) { console.warn('[bounties] ensureBounties failed:', err); return; }
    if (bountiesUnlocked(state)) services.pacer?.introduce('board');
    const unlocked = bountiesUnlocked(state);
    if (wasUnlocked === null) {
      // first look this session: a board already open counts as seen (no dot after a reload); one that opens later lights the dot
      wasUnlocked = unlocked;
      if (unlocked) seenIds = new Set(slotsOf().filter(Boolean).map((c) => c.id));
    } else if (unlocked && !wasUnlocked) {
      wasUnlocked = true;
      if (!seenIds) seenIds = new Set();
      services.tutorial?.notify('boardUnlocked');
      changed();
    }
  }

  const boardNews = () => bountiesUnlocked(getState()) && slotsOf().some((c) => c && !c.done && !(seenIds && seenIds.has(c.id)));

  /** The board was opened (the Regions panel): every contract on it is now seen. */
  function markBoardSeen() {
    if (!seenIds) seenIds = new Set();
    for (const c of slotsOf()) if (c) seenIds.add(c.id);
  }

  function rerollNote(info) {
    if (info.free) return info.extraFree > 0 && info.freeInSec > 0 ? `Free rerolls: ${info.extraFree}` : 'Free reroll ready';
    return `Free reroll in ${Math.max(1, Math.ceil(info.freeInSec / 60))} min`;
  }

  /** The Regions panel's board: null until it opens (never in the tutorial). */
  function boardData() {
    refreshBoard();
    const state = getState();
    const world = getWorld();
    if (!bountiesUnlocked(state)) return null;
    const info = rerollInfo(state);
    const renown = renownPoints(state);
    const contracts = [];
    slotsOf().forEach((c, slot) => {
      if (!c) return;
      const { progress, goal } = bountyProgress(state, world, c);
      const reward = c.reward || {};
      contracts.push({
        slot, id: c.id, text: bountyText(c, world, state), progress, goal, reward: { gold: reward.gold || 0, renown: reward.renown || 0, xp: reward.xp || 0 },
        rerollCost: info.cost, canReroll: !c.done && (info.free || renown >= BOUNTIES.rerollRenown), isNew: !(seenIds && seenIds.has(c.id)),
      });
    });
    return { unlocked: true, rerollNote: rerollNote(info), contracts };
  }

  /** The Reroll button of a slot: the result is said in the board (never a toast over the open panel). */
  function reroll(slot) {
    const state = getState();
    const res = rerollBounty(state, getWorld(), slot);
    if (res.ok) {
      if (seenIds && res.contract) seenIds.add(res.contract.id);
      services.sfx?.play('click');
      ui.regions.setBoardStatus?.(`New contract: ${bountyText(res.contract, getWorld(), state)}${res.cost === 'free' ? '' : ` (${res.cost} Renown)`}`);
      services.autosave?.save();
    } else {
      services.sfx?.play('error');
      ui.regions.setBoardStatus?.(BOUNTIES.copy.reasons[res.reason] || 'Not now', 'warning');
    }
    changed();
    return res;
  }

  /**
   * Pays what an on* hook completed (claimCompleted) and celebrates each one: a toast with a seal stamped on it, a Chronicle line, the gold on the HUD.
   * @param {object[]} completed
   */
  function claim(completed) {
    if (!completed || !completed.length) return null;
    const state = getState();
    const world = getWorld();
    const texts = new Map(completed.map((c) => [c.contract && c.contract.id, bountyText(c.contract, world, state)]));
    let res;
    try { res = claimCompleted(state, world, completed, Date.now()); } catch (err) { console.warn('[bounties] claimCompleted failed:', err); return null; }
    return celebrate(res, texts);
  }

  /** Celebrates contracts already claimed (claimCompleted's result): a stamped toast and a Chronicle line each. Quick Conquest's meta claims them itself. */
  function celebrate(res, texts = new Map()) {
    if (!res || !Array.isArray(res.claimed)) return res || null;
    const state = getState();
    const world = getWorld();
    for (const c of res.claimed) {
      const text = texts.get(c.id) || bountyText(c, world, state);
      const parts = [`+${shortNumber(c.reward.gold || 0)} gold`];
      if (c.reward.renown > 0) parts.push(`+${c.reward.renown} Renown`);
      if (c.reward.xp > 0 && res.general) parts.push(`+${c.reward.xp} XP`);
      ui.toasts.update({ id: `bounty-${c.id}`, type: 'success', icon: 'bounty', seal: 'bounty', message: `${BOUNTIES.copy.completed.replace('{text}', text)}! ${parts.join(', ')}`, duration: 5600, digest: true });
      chronicle(`A contract was fulfilled: ${text}.`);
    }
    if (res.claimed.length) {
      services.sfx?.play('coin', { volume: 0.8 });
      services.onRenownChanged?.();
      changed({ pulse: true });
      services.autosave?.save();
    }
    flushDeeds(); // Contractor
    return res;
  }

  const guard = (fn) => { try { return fn() || []; } catch (err) { console.warn('[bounties] a hook failed:', err); return []; } };
  const onConquest = (regionId, result) => claim(guard(() => bountyOnConquest(getState(), getWorld(), regionId, result)));
  const onProsperity = (ups) => (ups && ups.length ? claim(guard(() => bountyOnProsperity(getState(), getWorld(), ups))) : null);
  const onFortBuilt = (regionId, type) => claim(guard(() => bountyOnFortBuilt(getState(), getWorld(), regionId, type)));
  const onScout = (regionId) => { guard(() => bountyOnScout(getState(), getWorld(), regionId)); };
  const onBattleEnd = (run, result, summary) => claim(guard(() => bountyOnBattleEnd(getState(), getWorld(), run, result, summary)));

  /**
   * A finished battle (battles.js 'finished'): the board hears it; a lost or retreated attack breaks the streak; a Vendetta's
   * end hangs a Trophy (or not) and its leader speaks; a Duel's end gets its leader's line.
   */
  function onFinished(snapshot, out) {
    if (!snapshot) return;
    const { kind, result } = snapshot;
    if (snapshot.summary) onBattleEnd({ kind, commander: snapshot.commander, regionId: snapshot.regionId }, result, snapshot.summary);
    // only an ATTACK lost or retreated breaks the streak (PLAN-PHASE5 §5E): retreating a defense already costs the fight
    if (kind === 'attack' && (result === 'lose' || result === 'retreat')) {
      streakEnded(onStreakBroken(getState(), result === 'retreat' ? 'retreat' : 'lost'));
    }
    const v = out && out.reward && out.reward.vendetta;
    if (kind === 'defense' && v) vendettaSettled(v, snapshot);
    if (kind === 'duel' && out) {
      const f = out.attackerFaction ?? snapshot.attackerFaction;
      if (f > FREE_FOLK) services.speak?.(out.won ? 'duelWon' : 'duelLost', f, snapshot.regionId, `duel-${snapshot.regionId}-${Date.now()}`);
    }
    changed();
  }

  // --- Vendettas ----------------------------------------------------------------------------------------------------------------
  /** A rival leader swore a Vendetta (frontierLoop announced the raid): the leader's line, a Chronicle entry. The red banner is the raid's toast. */
  function onVendettaSworn(raid) {
    const world = getWorld();
    const f = raid.vendetta.faction;
    services.speak?.('vendetta', f, raid.toRegionId, `vendetta-${raid.id}`);
    chronicle(`${raid.vendetta.leader || leaderName(f)} of ${factionTitle(world.factions[f])} swore a Vendetta against the realm and marched on ${world.regions[raid.toRegionId] ? world.regions[raid.toRegionId].name : 'your land'}.`, { regionId: raid.toRegionId, hl: true });
    changed();
  }

  /** A Vendetta's end: won -> a Trophy (toast + Chronicle) and the leader's defeated line; lost -> the leader gloats. */
  function vendettaSettled(v, snapshot) {
    const world = getWorld();
    const f = v.faction;
    const fac = world.factions[f];
    const region = world.regions[snapshot.regionId] ? world.regions[snapshot.regionId].name : 'the border';
    // the leader speaks BEFORE the toast (on a phone the toast then waits for the banner)
    services.speak?.(v.won ? 'vendettaWon' : 'vendettaLost', f, snapshot.regionId, `vendetta-end-${snapshot.regionId}-${Date.now()}`);
    if (v.won) {
      const pct = Math.round(GRUDGES.vendetta.trophyAtk * (v.trophy || 1) * 100);
      ui.toasts.update({ id: `trophy-${f}`, type: 'success', icon: 'pennant', className: 'is-deed', seal: 'pennant', accent: fac ? fac.color : undefined, message: `Vendetta beaten! ${factionTitle(fac).replace(/^the /, 'The ')}'s banner hangs in your Realm: +${pct}% attack against them`, duration: 7000 });
      chronicle(`${leaderName(f)}'s Vendetta broke at ${region}. Their banner hangs in the hall.`, { regionId: snapshot.regionId, hl: true });
    } else {
      chronicle(`${leaderName(f)}'s Vendetta took ${region}.`, { regionId: snapshot.regionId });
    }
  }

  // --- rivals, Grudges, Trophies ------------------------------------------------------------------------------------------------
  const factionTitle = (f) => (f ? (/^the /i.test(f.name) ? f.name : `the ${f.name}`) : 'the rivals');
  function leaderName(faction) {
    const st = getState();
    const l = leaderFor(st.seed, st.dynasty ? st.dynasty.level : 1, faction);
    return l ? l.fullName : 'Their leader';
  }
  function grudgeData(faction) {
    const g = grudgeInfo(getState(), faction, getWorld());
    return { value: g.value, max: g.max, warned: g.warned || g.sworn, broken: g.broken, leader: leaderName(faction) };
  }
  /** The Regions panel's rival rows: every rival leader you have met who still holds land or has lost a banner to you (the Free Folk keep no Grudge). */
  function rivalsData() {
    const state = getState();
    const world = getWorld();
    // met leaders, plus any rival whose land touches yours (a first contact can wait behind a hint or the voice gap)
    const metSet = new Set(Array.isArray(state.metFactions) ? state.metFactions : []);
    for (const r of world.regions) {
      if (state.owner[r.id] !== PLAYER_FACTION) continue;
      for (const n of r.neighbors) if (state.owner[n] > FREE_FOLK) metSet.add(state.owner[n]);
    }
    const met = [...metSet];
    const alive = new Set(state.owner);
    return met.filter((f) => f > FREE_FOLK && world.factions[f] && (alive.has(f) || trophyCount(state, f) > 0)).sort((a, b) => a - b).map((f) => {
      const fac = world.factions[f];
      return { faction: f, name: factionTitle(fac), leader: leaderName(f), emblem: fac.emblem, color: fac.colorLight || fac.color, grudge: edictMods(state).raids === false ? null : grudgeData(f) };
    });
  }
  /** A rival region's card: its owner's Grudge, or null (yours, the Free Folk's). */
  function grudgeFor(regionId) {
    const owner = getState().owner[regionId];
    if (!(owner > FREE_FOLK) || owner === PLAYER_FACTION) return null;
    return grudgeData(owner);
  }
  /** The Realm panel's Trophy wall: shown once a rival leader has been met (an empty wall says how to fill it), a banner per faction beaten. */
  function trophyData() {
    const state = getState();
    const world = getWorld();
    const trophies = [];
    for (let f = FREE_FOLK + 1; f < world.factions.length; f++) {
      const n = trophyCount(state, f);
      if (n <= 0) continue;
      const fac = world.factions[f];
      const pct = Math.round(GRUDGES.vendetta.trophyAtk * n * 100);
      trophies.push({ faction: f, name: factionTitle(fac), emblem: fac.emblem, color: fac.colorLight || fac.color, count: n, bonus: `+${pct}% attack against them this dynasty` });
    }
    const met = Array.isArray(state.metFactions) && state.metFactions.some((f) => f > FREE_FOLK);
    return { show: met || trophies.length > 0, trophies };
  }

  /** The leaders' 50-warnings (the `grudge` voice trigger): one line per warning. */
  function flushGrudges() {
    let news = [];
    try { news = drainGrudgeNews(getState()); } catch { news = []; }
    for (const n of news) {
      if (n.kind !== 'warn') continue;
      services.speak?.('grudge', n.faction, undefined, `grudge-${n.faction}-${Math.floor((getState().frontier && getState().frontier.activeSec) || 0)}`);
      changed();
    }
  }

  /** @param {number} dtSec */
  function tick(dtSec) {
    void dtSec;
    const nowMs = performance.now();
    if (nowMs - newsAtMs < NEWS_EVERY_MS) return;
    newsAtMs = nowMs;
    const state = getState();
    if (!state) return;
    streakEnded(tickStreak(state));
    flushDeeds();
    flushGrudges();
    refreshBoard();
  }

  /**
   * Dev / checks only: puts a contract of `kind` on the board (slot 0 is rerolled, for free, until that kind comes up; a slot already holding it is kept).
   * Returns `{ slot, contract }` or null when that kind is not possible now.
   */
  function devBounty(kind) {
    const state = getState();
    const world = getWorld();
    refreshBoard('dev'); // a check's contract: the board opens now, whatever the pacer says
    if (!bountiesUnlocked(state)) return null;
    const b = state.bounties;
    const have = slotsOf().findIndex((c) => c && !c.done && c.kind === kind);
    if (have >= 0) return { slot: have, contract: b.slots[have] };
    const saved = { at: b.freeRerollAt, extra: b.extraFree };
    let hit = null;
    for (let i = 0; i < 80 && !hit; i++) {
      b.freeRerollAt = 0;
      const res = rerollBounty(state, world, 0);
      if (!res.ok) break;
      if (res.contract && res.contract.kind === kind) hit = { slot: 0, contract: res.contract };
    }
    b.freeRerollAt = saved.at;
    b.extraFree = saved.extra;
    if (hit && seenIds) seenIds.add(hit.contract.id);
    changed();
    return hit;
  }

  /** A new realm, an import, a new dynasty: the board's "seen" memory starts again. */
  function reset() { seenIds = null; wasUnlocked = null; boardAtMs = -1e9; }

  return {
    tick, onFinished, retreatWarning, reset, onVendettaSworn, onStreakEnded: streakEnded,
    hudData: () => ({ streak: streakData(), boardNews: boardNews() }),
    realmData: () => ({ deeds: deedCells(), trophies: trophyData() }),
    regionsData: () => ({ board: boardData(), rivals: rivalsData() }),
    grudgeFor, markBoardSeen, reroll, claim, celebrateClaims: celebrate, onConquest, onProsperity, onFortBuilt, onScout, onBattleEnd, flushDeeds, refreshBoard,
    leaderName, factionTitle, devBounty,
  };
}
