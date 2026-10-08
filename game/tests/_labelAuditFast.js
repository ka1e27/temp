// PLAN-PHASE15: the fast label audit shared by balance.audit.test.js and balance.auditTable.test.js (not a test file itself).
// A small version of tools/labelAudit.mjs: a few seeds of real campaign play, every attackable frontier region probed at every
// conquest, the card's promise per label band against what the bot achieved. Small n, so wider tolerances than the full audit's
// (+-5 at the band edges, +-12 on the chance, 12 seeds x 2 policies x D1-D7 + the Crown + Ascension).
import assert from 'node:assert/strict';
import { runJobs, BANDS } from '../../tools/labelAudit.mjs';

export const FAST = Object.freeze({ min: 25, bandSlack: 0.1, chanceSlack: 0.15 });

/**
 * Plays and probes D1..maxD of every seed with both policies (the card serves both: the bot retreats at its patience, the human fights on
 * while ahead), in parallel worker processes. Resolves with the probe rows.
 */
export async function fastRows(seeds, { maxD = 2, probeEvery = 2, jobs = 4 } = {}) { // 4 workers: npm test runs the other files alongside (timing tests)
  const list = [];
  for (const seed of seeds) for (const policy of ['bot', 'human']) list.push({ seed, policy, plan: 'dyn', maxD, probeEvery });
  const rows = await runJobs(list, { jobs });
  assert.ok(rows.length > 0, 'the audit workers produced no rows');
  return rows.filter((r) => r.src === 'probe');
}

/** Asserts every band with enough fights lands within the fast tolerances, and the bands are ordered. Returns the cells. */
export function assertHonest(rows, name) {
  const cells = BANDS.map(([label, lo, hi]) => {
    const xs = rows.filter((r) => r.label === label);
    const n = xs.length;
    return { label, lo, hi, n, won: n ? xs.filter((r) => r.won).length / n : null, said: n ? xs.reduce((s, r) => s + r.promised, 0) / n : null };
  });
  const txt = cells.map((c) => `${c.label} ${c.n ? `${Math.round(100 * c.won)}/${Math.round(100 * c.said)}` : '-'} (n ${c.n})`).join(', ');
  let judged = 0;
  for (const c of cells) {
    if (c.n < FAST.min) continue;
    judged += 1;
    assert.ok(c.won >= c.lo - FAST.bandSlack && c.won <= c.hi + FAST.bandSlack, `${name} ${c.label}: won ${Math.round(100 * c.won)}% outside its band (${txt})`);
    assert.ok(Math.abs(c.won - c.said) <= FAST.chanceSlack, `${name} ${c.label}: won ${Math.round(100 * c.won)}%, the card said ${Math.round(100 * c.said)}% (${txt})`);
  }
  assert.ok(judged >= 3, `${name}: only ${judged} bands had ${FAST.min}+ fights (${txt})`);
  const rates = cells.filter((c) => c.n >= FAST.min).map((c) => c.won);
  for (let i = 1; i < rates.length; i++) assert.ok(rates[i - 1] > rates[i], `${name}: a better label must win more (${txt})`);
  return cells;
}
