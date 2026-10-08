// PLAN-PHASE15 scratch: the synthetic ladder (balance.mjs sweepRows, as balance.labels.test.js runs it) by label and tier, calibrated card.
import { sweepRows } from './balance.mjs';
const rows = sweepRows({ seeds: [1, 2, 3, 4, 5, 6], own: 'half', regionStride: 2, ladder: [-3, 0, 2, 4, 5, 6, 7, 8, 9, 10, 12, 14, 17, 20, 24, 28] });
const t = {};
for (const r of rows) { const k = `${r.label.padEnd(6)} t${Math.min(r.tier, 5)}${r.capital ? 'C' : ' '} ${r.personality.slice(0, 5)}`; (t[k] = t[k] || [0, 0]); t[k][1]++; if (r.win) t[k][0]++; }
for (const [k, [w, n]] of Object.entries(t).sort()) if (n >= 8) console.log(k, `${Math.round(100 * w / n)}% of ${n}`);
