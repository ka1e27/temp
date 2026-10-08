// PLAN-PHASE15 follow-up scratch: Quick Conquest's real share of conquests per dynasty at a human pace (D1-D5, seeds 1-6), and whether
// the Legacy node was owned.
import { runDynasties } from './campaign.mjs';
const per = {};
for (const seed of [1, 2, 3, 4, 5, 6]) {
  const rs = runDynasties(seed, 5, { policy: 'human' });
  for (const r of rs) {
    const p = (per[r.dynasty] = per[r.dynasty] || { quick: 0, won: 0, node: 0, n: 0 });
    const won = r.attacks.filter((a) => a.won);
    p.won += won.length; p.quick += won.filter((a) => a.kind === 'quick').length; p.n += 1;
    const st = r.endState ? r.endState.state : null;
    if (st && st.generals && st.generals.legacy && st.generals.legacy.nodes && st.generals.legacy.nodes.quickConquest) p.node += 1;
  }
}
for (const [d, p] of Object.entries(per)) console.log(`D${d}: quick ${p.quick}/${p.won} = ${Math.round(100 * p.quick / p.won)}% of conquests; node owned in ${p.node}/${p.n} realms`);
