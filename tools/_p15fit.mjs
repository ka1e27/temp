// PLAN-PHASE15 scratch: fit DIFFICULTY.calibration (progression.js calibrateRatio) to label-audit rows by maximum likelihood against the
// card's own winChance curve (coordinate descent, golden section per parameter), then relabel the rows offline and print the audit.
//   node tools/_p15fit.mjs rows.json [more.json] [--src=probe] [--passes=6] [--l2=3] [--current]   (--current: just audit the config)
import { readFileSync } from 'node:fs';
import { winChance, calibrateRatio } from '../game/meta/progression.js';
import { ECONOMY, DIFFICULTY } from '../game/config/meta.js';
import { printTable } from './labelAudit.mjs';

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const all = argv.filter((a) => !a.startsWith('--')).flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));
const rows = all.filter((r) => (args.src === 'all' || r.src === (args.src || 'probe')) && (r.rawRatio ?? r.ratio) > 0 && Number.isFinite(r.rawRatio ?? r.ratio));
const ctxOf = (r) => ({ dynasty: r.d, crown: r.crown, ascension: r.asc, personality: r.personality, twist: r.twist, type: r.type, capital: r.capital, throne: r.throne, tier: r.tier });
const labelAt = (ratio) => (ECONOMY.difficultyLabels.find((l) => ratio >= l.min) || ECONOMY.difficultyLabels[ECONOMY.difficultyLabels.length - 1]).label;
const relabel = (rs, cal) => rs.map((r) => { const q = calibrateRatio(r.rawRatio ?? r.ratio, ctxOf(r), cal); return { ...r, ratio: q, label: labelAt(q), promised: winChance(q) }; });

const show = (cal, title, set = rows) => { const out = relabel(set, cal); printTable(out, { min: Number(args.min || 30), title }); return out; };

if (args.current) { show(DIFFICULTY.calibration, '(current config)'); process.exit(0); }

// --- the parameter vector: [path, lo, hi] in log space for factors, linear for exponents ---------------------------------------
const PERS = ['passive', 'aggressive', 'defensive', 'swarm', 'undying', 'raider', 'usurper'];
const TWISTS = ['night', 'blizzard', 'flooded', 'holy', 'siege', 'raid'];
const TYPES = ['goldmine', 'monastery', 'bandit', 'ruins', 'dragon'];
const params = [];
for (let d = 0; d < 7; d++) params.push({ get: (c) => c.dynasty[d][0], set: (c, v) => { c.dynasty[d][0] = v; }, lo: 0.15, hi: 1.5, log: false, name: `D${d + 1}.exp` });
for (let d = 0; d < 7; d++) params.push({ get: (c) => c.dynasty[d][1], set: (c, v) => { c.dynasty[d][1] = v; }, lo: 0.3, hi: 6, log: true, name: `D${d + 1}.k` });
for (const k of ['crown', 'ascensionPerLevel', 'capital', 'throne']) params.push({ get: (c) => c[k], set: (c, v) => { c[k] = v; }, lo: k === 'ascensionPerLevel' ? 0.9 : 0.25, hi: k === 'ascensionPerLevel' ? 1.1 : 4, log: true, name: k });
for (const [grp, ids] of [['personality', PERS], ['twist', TWISTS], ['type', TYPES], ['tier', [1, 2, 3, 4, 5, 6]]]) {
  for (const id of ids) params.push({ get: (c) => c[grp][id] ?? 1, set: (c, v) => { c[grp][id] = v; }, lo: 0.25, hi: 4, log: true, name: `${grp}.${id}`, prior: true });
}
for (const t of [1, 2, 3, 4, 5, 6]) params.push({ get: (c) => (c.tierExp || {})[t] ?? 1, set: (c, v) => { c.tierExp = { ...(c.tierExp || {}), [t]: v }; }, lo: 0.4, hi: 3, log: true, name: `tierExp.${t}`, prior: true });
const fixed = new Set(String(args.fix || '').split(',').filter(Boolean));

const cal = structuredClone(DIFFICULTY.calibration);
cal.dynasty = cal.dynasty.map((x) => [...x]);
if (args.from) Object.assign(cal, JSON.parse(readFileSync(args.from, 'utf8').split(String.fromCharCode(10)).map((l) => l.trim()).find((l) => l.startsWith('{')))); // start from an earlier fit
for (const g of ['personality', 'twist', 'type', 'tier']) cal[g] = { ...cal[g] };
const l2 = Number(args.l2 ?? 3);
const eps = 1e-4;
function loss(c) {
  let s = 0;
  for (const r of rows) {
    const p = Math.min(1 - eps, Math.max(eps, winChance(calibrateRatio(r.rawRatio ?? r.ratio, r._ctx, c))));
    s -= (r._w ?? 1) * (r.won ? Math.log(p) : Math.log(1 - p));
  }
  for (const p of params) if (p.prior) s += l2 * Math.log(p.get(c)) ** 2;
  return s;
}
for (const r of rows) { r._ctx = ctxOf(r); if (r.src === 'chosen' && args.chosenWeight) r._w = Number(args.chosenWeight); } // --chosenWeight: the fights really picked count more
if (args.balance) { // --balance: every (tier band x label at the start) cell weighs the same in total, so thin cells (deep Deadly) count
  const key = (r) => `${Math.min(r.tier, 5)}:${labelAt(calibrateRatio(r.rawRatio ?? r.ratio, r._ctx, cal))}`;
  const n = {}; for (const r of rows) n[key(r)] = (n[key(r)] || 0) + 1;
  const cells = Object.keys(n).length;
  for (const r of rows) r._w = Math.min(8, rows.length / cells / n[key(r)]);
}

const PHI = (Math.sqrt(5) - 1) / 2;
function golden(p) {
  const tf = (v) => (p.log ? Math.log(v) : v);
  const inv = (x) => (p.log ? Math.exp(x) : x);
  let a = tf(p.lo); let b = tf(p.hi);
  const f = (x) => { p.set(cal, inv(x)); return loss(cal); };
  let x1 = b - PHI * (b - a); let x2 = a + PHI * (b - a); let f1 = f(x1); let f2 = f(x2);
  for (let i = 0; i < 22; i++) {
    if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = b - PHI * (b - a); f1 = f(x1); } else { a = x1; x1 = x2; f1 = f2; x2 = a + PHI * (b - a); f2 = f(x2); }
  }
  p.set(cal, inv((a + b) / 2));
}
console.log(`fitting ${rows.length} rows, start loss ${loss(cal).toFixed(0)}`);
for (let pass = 0; pass < Number(args.passes || 6); pass++) {
  for (const p of params) if (!fixed.has(p.name)) golden(p);
  console.log(`pass ${pass + 1}: loss ${loss(cal).toFixed(0)}`);
}
const r3 = (x) => +x.toFixed(3);
console.log(JSON.stringify({ ...cal, dynasty: cal.dynasty.map(([e, k]) => [r3(e), r3(k)]),
  ...Object.fromEntries(['crown', 'ascensionPerLevel', 'capital', 'throne'].map((k) => [k, r3(cal[k])])),
  ...Object.fromEntries(['personality', 'twist', 'type', 'tier', 'tierExp'].map((g) => [g, Object.fromEntries(Object.entries(cal[g] || {}).map(([k, v]) => [k, r3(v)]))])) }));
show(cal, '(fitted, probe)');
show(cal, '(fitted, chosen)', all.filter((r) => r.src === 'chosen'));
