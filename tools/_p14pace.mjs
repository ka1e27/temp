// Phase 14 pacing (scratch, like _p13pace.mjs): whole dynasties D1-D7 and the Crown, at a human pace or the optimal one, per dynasty.
//   node tools/_p14pace.mjs --mode=dyn --policy=human --seeds=1-12 --out=f.json   D1-D6, then D7 and the Crown forked from the same D6 realm
//   node tools/_p14pace.mjs --mode=asc --policy=human --seeds=1-12 --levels=0,1,10 --out=f.json   D3-D4 at Ascension L (forked after D2)
//   node tools/_p14pace.mjs --report a.json b.json ...                      the per-dynasty table (median, worst wait, waits > 30 / 60, worst seeds)
// Any other --flag is passed to the campaign (e.g. --legacy=greedy, --edict=first).
import { writeFileSync, readFileSync } from 'node:fs';
import { runDynasties, foundNext } from './campaign.mjs';

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const range = (s) => String(s).split(',').flatMap((p) => (p.includes('-') ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(p.split('-').map(Number)) : [Number(p)]));
const med = (xs) => { const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

/** One dynasty's row, from a human (runHumanHour whole) or optimal (runCampaign) result. */
function row(seed, r, tag) {
  const bd = r.battleDurations || [];
  const extra = { bwin: med(bd.filter((b) => b.won).map((b) => b.sec)), tosec: bd.filter((b) => b.timedOut).reduce((a, b) => a + b.sec, 0), lostsec: bd.filter((b) => !b.won).reduce((a, b) => a + b.sec, 0) };
  if (r.metrics) {
    const m = r.metrics;
    return { ...extra, seed, tag, d: r.dynasty, time: r.doneAt, wait: m.longestWait, waitAt: m.longestWaitAt, gap: m.longestGapSec, idle: m.longestIdleSec, avail: m.avail,
      battles: m.battles, won: m.won, lost: m.lost, timeouts: m.timeouts, hard: m.hardTries, battleShare: m.battleShare, regions: r.regions,
      edict: r.edict, arch: r.archipelago, crown: r.crown, asc: r.ascension, rivals: r.rivals, stall: r.stallReason,
      waits30: m.waits.filter((w) => w > 1800).length };
  }
  const s = r.summary;
  const st = r.endState ? r.endState.state : null;
  return { ...extra, seed, tag, d: r.dynasty, time: s.milestones.all, wait: s.longestWait, battles: s.battlesWon + s.battlesLost, won: s.battlesWon, lost: s.battlesLost,
    timeouts: s.timeouts, regions: r.totalToConquer, edict: st && st.edict ? st.edict.id : null, arch: st ? !!st.archipelago : null,
    crown: st ? !!st.crownOfAges : null, asc: st ? st.ascension || 0 : 0, stall: r.stallReason,
    battleShare: s.milestones.all ? r.battleDurations.reduce((a, b) => a + b.sec, 0) / s.milestones.all : null };
}

const flags = { ...args };
for (const k of ['mode', 'seeds', 'out', 'levels', 'report']) delete flags[k];
if (args.policy !== 'human') delete flags.policy;
const fork = (r) => structuredClone(r.endState);

if (args.report) {
  const rows = argv.filter((a) => !a.startsWith('--')).flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));
  const tags = [...new Set(rows.map((r) => r.tag))];
  const h = (s) => (s == null ? 'never' : `${(s / 3600).toFixed(2)}h`);
  console.log('tag      n  median   p75    max   | worst wait  >30m >60m | avail  battles won% timeouts | worst seeds (time, wait)');
  for (const tag of tags) {
    const rs = rows.filter((r) => r.tag === tag);
    const times = rs.map((r) => (r.stall ? Infinity : r.time));
    const sorted = [...times].sort((a, b) => a - b);
    const p75 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))];
    const waits = rs.map((r) => r.wait / 60);
    const worst = [...rs].sort((a, b) => (b.stall ? Infinity : b.time) - (a.stall ? Infinity : a.time)).slice(0, 3);
    const won = rs.reduce((a, r) => a + r.won, 0) / Math.max(1, rs.reduce((a, r) => a + r.battles, 0));
    console.log(`${tag.padEnd(7)} ${String(rs.length).padStart(2)}  ${h(med(times)).padStart(6)} ${h(p75).padStart(6)} ${h(Math.max(...times)).padStart(6)} | ${Math.round(Math.max(...waits)).toString().padStart(6)} min ${String(waits.filter((w) => w > 30).length).padStart(4)} ${String(waits.filter((w) => w > 60).length).padStart(4)} | `
      + `${rs[0].avail != null ? `${Math.round(100 * med(rs.map((r) => r.avail)))}%`.padStart(5) : '    -'} ${String(med(rs.map((r) => r.battles))).padStart(7)} ${Math.round(100 * won).toString().padStart(3)}% ${String(rs.reduce((a, r) => a + r.timeouts, 0)).padStart(8)} | `
      + worst.map((r) => `s${r.seed} ${h(r.stall ? null : r.time)} ${Math.round(r.wait / 60)}m`).join(', '));
  }
} else {
  const seeds = range(args.seeds || '1-4');
  const rows = [];
  for (const seed of seeds) {
    const t0 = Date.now();
    if ((args.mode || 'dyn') === 'dyn') {
      const base = runDynasties(seed, 6, flags);
      base.forEach((r) => rows.push(row(seed, r, `D${r.dynasty}`)));
      const d6 = base[5];
      if (d6 && !d6.stallReason) {
        for (const [tag, f] of [['D7', flags], ['Crown', { ...flags, crown: 7 }]]) {
          const carry = foundNext(d6, seed, 6, f, fork(d6));
          const r = runDynasties(seed, 7, f, { carry, level: 7 })[0];
          rows.push(row(seed, r, tag));
        }
      }
    } else {
      const levels = range(args.levels || '0,1,10');
      const base = runDynasties(seed, 2, flags);
      const d2 = base[1];
      for (const L of levels) {
        const f = { ...flags, ascensionForce: L };
        const carry = foundNext(d2, seed, 2, f, fork(d2));
        runDynasties(seed, 4, f, { carry, level: 3 }).forEach((r) => rows.push(row(seed, r, `A${L}-D${r.dynasty}`)));
      }
    }
    const mine = rows.filter((r) => r.seed === seed);
    console.log(`seed ${seed} (${((Date.now() - t0) / 1000).toFixed(0)} s): ` + mine.map((r) => `${r.tag} ${r.time == null ? 'STALL' : (r.time / 3600).toFixed(2) + 'h'} w${Math.round(r.wait / 60)}`).join('  '));
  }
  if (args.out) writeFileSync(args.out, JSON.stringify(rows));
}
