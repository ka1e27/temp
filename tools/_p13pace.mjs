// Phase 13 pacing guard (scratch, like _p6pace.mjs): the Crown of Ages at D7 against a normal D7, the Throne fights, Ascension on D3-D4.
//   node tools/_p13pace.mjs --mode=crown --seeds=1-12      the Throne fight lengths, timeouts, the Crown continent vs a normal D7
//   node tools/_p13pace.mjs --mode=asc --seeds=1-12 --levels=0,1,5,10   Ascension forced on D3-D4 (crowned record faked)
import { runDynasties } from './campaign.mjs';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const range = (s) => s.includes('-') ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(s.split('-').map(Number)) : s.split(',').map(Number);
const seeds = range(args.seeds || '1-4');
const med = (xs) => { const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const fm = (s) => (s == null ? '-' : (s / 60).toFixed(1));
const h = (sec) => (sec == null ? 'never' : `${(sec / 3600).toFixed(2)}h`);
if ((args.mode || 'crown') === 'crown') {
  const rows = [];
  for (const seed of seeds) {
    const plain = runDynasties(seed, 7, {});
    const crown = runDynasties(seed, 7, { crown: 7 });
    const p7 = plain[6]; const c7 = crown[6];
    const fights = c7 ? c7.battleDurations.filter((b) => b.throne) : [];
    rows.push({ seed, plain: p7 && p7.summary.milestones.all, crown: c7 && c7.summary.milestones.all, stall: c7 && c7.stallReason, fights, battles: c7 ? c7.battleDurations : [] });
    console.log(`seed ${seed}: D7 ${h(p7 && p7.summary.milestones.all)}  Crown ${h(c7 && c7.summary.milestones.all)}${c7 && c7.stallReason ? ' STALL ' + c7.stallReason : ''}  Throne fights: ${fights.map((f) => `${(f.sec / 60).toFixed(1)}m ${f.won ? "W" : f.timedOut ? "T" : "L"} p${f.thronePhase} ${f.label} ${Math.round((f.winChance || 0) * 100)}% [gate ${fm(f.throneAt && f.throneAt.gate)} field ${fm(f.throneAt && f.throneAt.field)} fell ${fm(f.throneAt && f.throneAt.fell)} b${f.borrows}]`).join(', ') || '-'}`);
  }
  const all = rows.flatMap((r) => r.fights);
  const wins = all.filter((f) => f.won);
  console.log(`\nThrone fights ${all.length}: won ${wins.length}, timeouts ${all.filter((f) => f.timedOut).length}; median length ${(med(all.map((f) => f.sec)) / 60).toFixed(1)} min (wins ${(med(wins.map((f) => f.sec)) / 60).toFixed(1)} min)`);
  // label honesty for the Usurper's other regions and for every Crown battle (won share by the card's label at attack)
  for (const [name, pick] of [['usurper regions', (b) => b.personality === 'usurper' && !b.throne], ['all Crown battles', () => true]]) {
    const bs = rows.flatMap((r) => r.battles).filter(pick);
    const by = {};
    for (const b of bs) { const k = b.label; by[k] = by[k] || { n: 0, won: 0, p: 0 }; by[k].n += 1; by[k].won += b.won ? 1 : 0; by[k].p += b.winChance ?? 0; }
    console.log(`${name}: ` + Object.entries(by).map(([k, v]) => `${k} ${v.won}/${v.n}`).join(', '));
  }
  const pm = med(rows.map((r) => r.plain)); const cm = med(rows.map((r) => r.crown ?? Infinity));
  console.log(`D7 median ${h(pm)}, Crown median ${h(Number.isFinite(cm) ? cm : null)} (${(cm / pm).toFixed(2)}x)`);
}
if (args.mode === 'asc') {
  const levels = (args.levels || '0,1,5,10').split(',').map(Number);
  const table = {};
  for (const L of levels) {
    const rows = seeds.map((seed) => runDynasties(seed, 4, { ascensionForce: L }));
    const d = (k) => rows.map((r) => (r[k] && !r[k].stallReason ? r[k].summary.milestones.all : null));
    const stalls = rows.filter((r) => r.length < 4 || r[2].stallReason || (r[3] && r[3].stallReason)).length;
    const wins = rows.flatMap((r) => r.slice(2).flatMap((x) => x.battleDurations));
    const waits = rows.flatMap((r) => r.slice(2).map((x) => x.summary.longestWait / 60));
    table[L] = { d3: med(d(2)), d4: med(d(3)), stalls, won: wins.filter((b) => b.won).length / Math.max(1, wins.length), worstWait: Math.max(...waits) };
    console.log(`Ascension ${L}: D3 median ${h(table[L].d3)}, D4 median ${h(table[L].d4)}; stalls ${stalls}/${seeds.length}; battles won ${(table[L].won * 100).toFixed(0)}%; worst wait ${Math.round(table[L].worstWait)} min; per seed D3 ${d(2).map((x) => h(x)).join(' ')} | D4 ${d(3).map((x) => h(x)).join(' ')}`);
  }
}
