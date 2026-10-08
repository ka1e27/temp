// PLAN-PHASE15 follow-up scratch: regions that are never won however strong the army (probe rows). Groups by seed/plan/dynasty/region
// signature (rows before regionId was recorded) or regionId; lists groups with no win at raw ratio >= --min (1.5) and >= 3 such fights.
import { readFileSync } from 'node:fs';
const argv = process.argv.slice(2);
const min = Number((argv.find((a) => a.startsWith('--min=')) || '--min=1.5').slice(6));
const rows = argv.filter((a) => !a.startsWith('--')).flatMap((f) => JSON.parse(readFileSync(f, 'utf8'))).filter((r) => r.src === 'probe');
const g = new Map();
for (const r of rows) {
  const k = [r.seed, r.policy, r.tag, r.d, r.regionId ?? `${r.tier}/${r.personality}/${r.twist || '-'}/${r.type || '-'}/${r.capital ? 'C' : ''}${r.throne ? 'T' : ''}`].join(' ');
  if (!g.has(k)) g.set(k, []);
  g.get(k).push(r);
}
const out = [];
for (const [k, xs] of g) {
  const hi = xs.filter((r) => (r.rawRatio ?? r.ratio) >= min);
  if (hi.length >= 3 && !hi.some((r) => r.won)) out.push(`${k}: 0/${hi.length} at raw >= ${min} (max raw ${Math.max(...hi.map((r) => r.rawRatio ?? r.ratio)).toFixed(2)}; all ${xs.filter((r) => r.won).length}/${xs.length})`);
}
console.log(out.length ? out.join('\n') : 'none');
