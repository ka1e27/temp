// PLAN-PHASE15 follow-up scratch: the label-keyed systems at the end of D1 (12 seeds): Boons owned, and the share of battle conquests
// that would qualify for Quick Conquest (label Easy at the attack, not a capital or an excluded type), bot (runCampaign) and human.
import { runCampaign, runHumanHour } from './campaign.mjs';
import { QUICK } from '../game/config/legacy.js';
const seeds = (process.argv.find((a) => a.startsWith('--seeds=')) || '--seeds=1,2,3,4,5,6,7,8,9,10,11,12').slice(8).split(',').map(Number);
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
for (const [name, run] of [['bot', (s) => runCampaign(s, {})], ['human', (s) => runHumanHour(s, { whole: true })]]) {
  const boons = []; let q = 0; let n = 0; const labels = {};
  for (const seed of seeds) {
    const r = run(seed);
    const st = r.endState.state;
    boons.push(st.boons2 ? st.boons2.owned.length : 0);
    for (const b of r.battleDurations) {
      if (!b.won) continue;
      n += 1; labels[b.label] = (labels[b.label] || 0) + 1;
      if (b.label === QUICK.label && !b.capital && !QUICK.excludedTypes.includes(b.type)) q += 1;
    }
  }
  console.log(`${name}: Boons owned at the end of D1 median ${med(boons)} (min ${Math.min(...boons)}, max ${Math.max(...boons)}) [${boons.join(' ')}]; quick-eligible ${q}/${n} = ${Math.round(100 * q / n)}% of battle conquests; labels ${JSON.stringify(labels)}`);
}
