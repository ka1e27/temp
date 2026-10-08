// PLAN-PHASE15 scratch: before/after label-audit table (probe rows): per slice, won/promised per band, and the judged misses.
//   node tools/_p15compare.mjs before.json after.json [--src=probe]
import { readFileSync } from 'node:fs';
import { auditTable } from './labelAudit.mjs';
const argv = process.argv.slice(2);
const src = (argv.find((a) => a.startsWith('--src=')) || '--src=probe').slice(6);
const [a, b] = argv.filter((x) => !x.startsWith('--')).map((f) => JSON.parse(readFileSync(f, 'utf8')).filter((r) => src === 'all' || r.src === src));
const ta = auditTable(a); const tb = auditTable(b);
const f = (c) => (c && c.n ? `${Math.round(100 * c.won ?? 0)}` : '');
const cellTxt = (c) => (c.n ? `${Math.round(100 * c.achieved)}/${Math.round(100 * c.promised)}${c.judged && !c.ok ? '!' : ''}` : '-').padStart(8);
console.log(`${'slice'.padEnd(15)}| ${['Easy', 'Fair', 'Hard', 'Deadly'].map((l) => `${l} before -> after`.padEnd(19)).join('| ')}`);
for (const s of [...new Set(ta.map((c) => c.slice))]) {
  const row = ['Easy', 'Fair', 'Hard', 'Deadly'].map((l) => `${cellTxt(ta.find((c) => c.slice === s && c.label === l))} ${cellTxt(tb.find((c) => c.slice === s && c.label === l))}`.padEnd(19));
  console.log(`${s.padEnd(15)}| ${row.join('| ')}`);
}
const miss = (t) => t.filter((c) => c.judged && !c.ok).length;
console.log(`judged misses: before ${miss(ta)} of ${ta.filter((c) => c.judged).length}, after ${miss(tb)} of ${tb.filter((c) => c.judged).length}  (cells: won/promised %, ! = off target)`);
void f;
