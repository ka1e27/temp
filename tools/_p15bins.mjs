// PLAN-PHASE15 scratch: achieved win rate per ln(ratio) bin, per slice key (default: dynasty), probe rows.
//   node tools/_p15bins.mjs rows.json [--key=d|personality|twist|type|tag|policy] [--src=probe]
import { readFileSync } from 'node:fs';
import { winChance } from '../game/meta/progression.js';
const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const rows = argv.filter((a) => !a.startsWith('--')).flatMap((f) => JSON.parse(readFileSync(f, 'utf8'))).filter((r) => r.src === (args.src || 'probe'));
const key = args.key || 'd';
const edges = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.95, 1.1, 1.3, 1.55, 2, 3, Infinity];
console.log(`${key.padEnd(10)} ` + edges.slice(0, -1).map((e) => `>=${e}`.padStart(9)).join(''));
const kv = (r) => (key === 'd' ? `${r.crown ? 'C' : 'D'}${r.d}` : String(r[key]));
for (const k of [...new Set(rows.map(kv))].sort()) {
  const mine = rows.filter((r) => kv(r) === k);
  const cells = edges.slice(0, -1).map((lo, i) => {
    const xs = mine.filter((r) => r.ratio >= lo && r.ratio < edges[i + 1]);
    return xs.length >= 15 ? `${Math.round(100 * xs.filter((r) => r.won).length / xs.length)}/${Math.round(100 * winChance(Math.sqrt(Math.max(lo, 0.1) * Math.min(edges[i + 1], 4))))}`.padStart(9) : '        .';
  });
  console.log(`${k.padEnd(10)} ${cells.join('')}  n ${mine.length}`);
}
