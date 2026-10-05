// The tables and the targets of tools/firstHour.mjs (PLAN-PHASE10 10A), kept apart so a saved run can be re-read:
//   node tools/firstHourReport.mjs screenshots/phase10/firstHour-before.json [screenshots/phase10/firstHour-after.json]
// Interruptions = tutorial hints + toasts + leader lines + modal moments. The battle's own results card is a modal moment (it opens the
// post-battle queue) but not an interruption: the player asked for that battle. Player-opened panels never count. Unlocks are listed apart.
import { readFileSync } from 'node:fs';

export const TARGETS = Object.freeze({
  avgPerMinAfter5: 3,     // average interruptions per minute after the first 5 minutes
  maxPerMin: 6,           // never more in any one minute
  modalGapSec: 20,        // play between two modal moments (the post-battle queue excepted)
  queueLinkSec: 4,        // a moment that opens within this long of the previous one closing belongs to the same post-battle queue
  unlockGapSec: 150,      // new systems about 3 minutes apart (lead: the pacer's 150 s) ...
  unlockGapSoftSec: 150,  // ... "about": under this is a miss
});
const POST_BATTLE = new Set(['relic', 'recruit', 'draft', 'duo']);

export const counts = (e) => (e.kind === 'hint' || e.kind === 'toast' || e.kind === 'leader' || (e.kind === 'modal' && e.sub !== 'results'));

// systems a tutorial step introduces (the probe logs the step; its first appearance is that system's unlock too)
const HINT_SYSTEMS = { M2: 'scout', M3: 'works', R1: 'festival', V1: 'variety', F4: 'fortify', A1: 'ashen', D2: 'quick', L1: 'relics', H1: 'codex', J1: 'challenges', Q1: 'board', G2: 'generals', Q2: 'vendetta', F1: 'raids' };

/** The run's events with every system's first appearance as an `unlock` (the probe's own, plus those only a hint shows), in time order. */
function withUnlocks(events) {
  const first = new Map(); // system -> its earliest appearance (the probe's own unlock, a hint that introduces it, or the Boon toast)
  const offer = (sub, t, text) => { const f = first.get(sub); if (!f || t < f.t) first.set(sub, { t, kind: 'unlock', sub, text }); };
  for (const e of events) {
    if (e.kind === 'unlock') offer(e.sub, e.t, e.text);
    // ("A Boon awaits": an offer told by a toast, its chip on the map, before any draft opens)
    // (and a Deed told inside a merged post-battle toast, Phase 10A's digest)
    const sys = e.kind === 'hint' ? HINT_SYSTEMS[e.sub] : e.kind === 'toast' && e.sub === 'boon' ? 'boons'
      : e.kind === 'toast' && /Deed earned/.test(e.text) ? 'deeds' : null;
    if (sys) offer(sys, e.t, e.kind === 'hint' ? `hint ${e.sub}` : e.text);
  }
  return events.filter((e) => e.kind !== 'unlock').concat([...first.values()]).sort((x, y) => x.t - y.t);
}

export function analyse(run) {
  run = { ...run, events: withUnlocks(run.events) };
  const minutes = Math.max(1, Math.ceil(run.minutes || 60));
  const rows = Array.from({ length: minutes }, (_, i) => ({ min: i + 1, hint: 0, toast: 0, leader: 0, modal: 0, total: 0, unlocks: [], what: [] }));
  for (const e of run.events) {
    const r = rows[Math.min(minutes - 1, Math.floor(e.t / 60))];
    if (!r) continue;
    if (e.kind === 'unlock') r.unlocks.push(e.sub);
    if (!counts(e)) continue;
    r[e.kind] += 1;
    r.total += 1;
    r.what.push(e.kind === 'toast' ? `t:${e.sub}` : e.kind === 'hint' ? `h:${e.sub}` : e.kind === 'leader' ? 'L' : `m:${e.sub}`);
  }
  const after = rows.filter((r) => r.min > 5);
  const avgAfter5 = after.length ? after.reduce((a, r) => a + r.total, 0) / after.length : 0;
  const maxRow = rows.reduce((a, r) => (r.total > a.total ? r : a), rows[0]);
  // modal moments: group the post-battle queue, then measure the play between groups
  const modals = run.events.filter((e) => e.kind === 'modal').sort((a, b) => a.t - b.t);
  const groups = [];
  for (const m of modals) {
    const g = groups[groups.length - 1];
    const prevEnd = g ? g.end : -1e9;
    if (g && POST_BATTLE.has(m.sub) && g.postBattle && m.t - prevEnd <= TARGETS.queueLinkSec) { g.items.push(m.sub); g.end = Math.max(g.end, m.end ?? m.t); continue; }
    groups.push({ t: m.t, end: m.end ?? m.t + 1, items: [m.sub], postBattle: m.sub === 'results' || POST_BATTLE.has(m.sub) });
  }
  const modalMisses = [];
  for (let i = 1; i < groups.length; i++) {
    const gap = groups[i].t - groups[i - 1].end;
    if (gap < TARGETS.modalGapSec) modalMisses.push({ t: groups[i].t, gap: +gap.toFixed(1), prev: groups[i - 1].items.join('>'), next: groups[i].items.join('>') });
  }
  const unlocks = run.events.filter((e) => e.kind === 'unlock').sort((a, b) => a.t - b.t);
  const unlockMisses = [];
  for (let i = 1; i < unlocks.length; i++) {
    const gap = unlocks[i].t - unlocks[i - 1].t;
    if (gap < TARGETS.unlockGapSec) unlockMisses.push({ a: unlocks[i - 1].sub, b: unlocks[i].sub, gap: +gap.toFixed(1), hard: gap < TARGETS.unlockGapSoftSec });
  }
  const repeats = run.events.filter((e) => e.kind === 'hint' && e.repeat).map((e) => e.sub);
  return {
    rows, avgAfter5: +avgAfter5.toFixed(2), max: maxRow.total, maxMin: maxRow.min, groups, modalMisses, unlocks, unlockMisses, repeats,
    pass: {
      avg: avgAfter5 <= TARGETS.avgPerMinAfter5,
      max: maxRow.total <= TARGETS.maxPerMin,
      modal: modalMisses.length === 0,
      unlock: !unlockMisses.some((m) => m.hard),
      hints: repeats.length === 0,
    },
  };
}

const pad = (s, n) => String(s).padEnd(n);
export function render(run, a = analyse(run)) {
  const out = [];
  out.push(`first hour: seed ${run.seed}, ${run.variant}, ${run.minutes} min, ${run.battles ?? '?'} battles, ${run.label || ''}`);
  out.push('min | hint toast lead modal | total | unlocks / what');
  for (const r of a.rows) {
    out.push(`${pad(r.min, 3)} | ${pad(r.hint, 4)} ${pad(r.toast, 5)} ${pad(r.leader, 4)} ${pad(r.modal, 5)} | ${pad(r.total, 5)} | ${r.unlocks.length ? `[${r.unlocks.join(', ')}] ` : ''}${r.what.join(' ')}`);
  }
  out.push('');
  out.push('unlock timeline:');
  for (const u of a.unlocks) out.push(`  ${(u.t / 60).toFixed(1).padStart(5)} min  ${pad(u.sub, 11)} ${u.text}`);
  out.push('');
  const flag = (b) => (b ? 'ok  ' : 'MISS');
  out.push(`${flag(a.pass.avg)} average after minute 5: ${a.avgAfter5}/min (target <= ${TARGETS.avgPerMinAfter5})`);
  out.push(`${flag(a.pass.max)} busiest minute: ${a.max} in minute ${a.maxMin} (target <= ${TARGETS.maxPerMin})`);
  out.push(`${flag(a.pass.modal)} modal moments with < ${TARGETS.modalGapSec} s of play between them: ${a.modalMisses.length}${a.modalMisses.map((m) => `\n       at ${m.t}s: ${m.prev} -> ${m.next} (${m.gap}s)`).join('')}`);
  out.push(`${flag(a.pass.unlock)} unlocks closer than ~3 min: ${a.unlockMisses.length}${a.unlockMisses.map((m) => `\n       ${m.a} -> ${m.b}: ${m.gap}s${m.hard ? ' (MISS)' : ' (about)'}`).join('')}`);
  out.push(`${flag(a.pass.hints)} hints shown twice: ${a.repeats.length ? a.repeats.join(', ') : 'none'}`);
  return out.join('\n');
}

/** Before / after, side by side (minute totals and the summary lines). */
export function compare(before, after) {
  const A = analyse(before);
  const B = analyse(after);
  const out = ['min | before | after'];
  for (let i = 0; i < Math.max(A.rows.length, B.rows.length); i++) out.push(`${pad(i + 1, 3)} | ${pad(A.rows[i]?.total ?? '', 6)} | ${B.rows[i]?.total ?? ''}`);
  out.push(`avg after 5: ${A.avgAfter5} -> ${B.avgAfter5}; busiest: ${A.max} -> ${B.max}; modal misses: ${A.modalMisses.length} -> ${B.modalMisses.length}; unlock misses: ${A.unlockMisses.length} -> ${B.unlockMisses.length}`);
  return out.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('firstHourReport.mjs')) {
  const [a, b] = process.argv.slice(2).map((p) => JSON.parse(readFileSync(p, 'utf8')));
  console.log(render(a));
  if (b) { console.log(`\n${render(b)}\n\n${compare(a, b)}`); }
}
