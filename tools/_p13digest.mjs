// Phase 13 guard (scratch): digests of every existing world kind, to prove the Crown of Ages leaves them byte-identical.
import { createHash } from 'node:crypto';
import { generateWorld } from '../game/world/generate.js';
import { challengeWorld } from '../game/meta/challenges.js';
import { dailySpec } from '../game/meta/daily.js';
import { scenarioSpec } from '../game/meta/scenarios.js';
import { SCENARIO_LIST } from '../game/config/scenarios.js';
import { rivalsFor, archipelagoFor } from '../game/meta/rivals.js';
const h = (w) => createHash('sha256').update(JSON.stringify(w)).digest('hex').slice(0, 16);
const out = [];
for (const seed of [1, 2, 3, 7, 42, 1234567]) {
  for (const d of [1, 2, 3, 5, 7, 9]) {
    out.push(`land s${seed} d${d} ${h(generateWorld(seed, { dynasty: d, rivals: rivalsFor(seed, d) }))}`);
    out.push(`arch s${seed} d${d} ${h(generateWorld(seed, { dynasty: d, archipelago: true, rivals: rivalsFor(seed, d, { archipelago: true }) }))}`);
  }
  out.push(`edict s${seed} ${h(generateWorld(seed, { dynasty: 4, edict: 'longWinter' }))}`);
}
for (const date of [20261001, 20261006, 20270115]) out.push(`daily ${date} ${h(challengeWorld(dailySpec(date)))}`);
const ids = SCENARIO_LIST.map((s) => s.id);
for (const id of ids) { try { out.push(`scenario ${id} ${h(challengeWorld(scenarioSpec(id)))}`); } catch (e) { out.push(`scenario ${id} ERR ${e.message}`); } }
console.log(out.join('\n'));
