// The enemy commander's composition-adaptation phase: what it trains in
// response to what the player fields.
//
// Split out of ai.js for the line budget; `think()` still calls `adapt()`
// last, right after retreat — the phase list itself stays in ai.js.
// PURE.
import { AI, UNIT_IDS, SITES, MAPGEN } from '../content/balance.js';
import { emptyComp, addComp } from './combat.js';
import { ME, FOE, byId } from './aicore.js';

function playerArmy(state) {
  let comp = emptyComp();
  for (const s of state.sites) {
    if (s.owner === FOE) comp = addComp(comp, s.garrison);
    if (s.siege?.owner === FOE) comp = addComp(comp, s.siege.comp);
  }
  for (const sq of state.squads) if (sq.owner === FOE) comp = addComp(comp, sq.comp);
  return comp;
}

/**
 * Move `want` of `pool` onto `unit`, counting what is already there. Sites past
 * the share go back to the kind's default, so the mix CONVERGES on the share
 * instead of drifting toward whatever was picked last.
 */
function retrain(out, pool, unit, want) {
  const n = Math.max(0, Math.min(pool.length, Math.round(want)));
  const on = pool.filter((s) => s.trainType === unit);
  const off = pool.filter((s) => s.trainType !== unit);
  for (let i = on.length; i < n && off.length; i++) {
    const site = off.shift();
    out.push({ t: 'TRAIN', by: ME, site: site.id, unit });
  }
  for (let i = n; i < on.length; i++) {
    const site = on[i];
    const back = MAPGEN.trainType[site.kind];
    if (back && back !== unit) out.push({ t: 'TRAIN', by: ME, site: site.id, unit: back });
  }
}

/**
 * What the enemy builds. TWO SHARES OF PRODUCTION, NOT TWO COIN FLIPS.
 *
 * `ramTrainShare` and the counter-train share both used to be rolled per think
 * against every eligible site, which RATCHETS — a stronghold that flipped never
 * flipped back — so a few minutes in, every wall in the region was held by
 * def-2 rams or def-4 raiders instead of def-8 spearmen behind a 1.75 bulwark.
 * Only tiers 3 and 4 counter-train at all, so the effect landed exactly on the
 * regions that are supposed to be the hardest: measured at n=48 with the tail
 * dial already re-curved, obsidian won 83% in 5.0m against a 23-minute target
 * while tier-2 highmarch — which cannot adapt and therefore kept its spearwall —
 * won 8%. The enemy was disarming itself, and it looked like a difficulty curve.
 *
 * `adaptComposition: boolean` is now `counterShare: number`, for the same reason
 * `staging: boolean` became `stagingRatio`/`stagingKeep` (see content/ai.data.js):
 * a boolean is a CLIFF. Measured at n=96, turning it off was worth 17 points of
 * win rate on gallowmoor and 32 on karrowmere — the largest difficulty step in
 * the campaign, and an unadvertised flag flipping at a tier boundary.
 *
 * Now the AI answers what you field with a PORTION of its production and keeps a
 * spear backbone behind it, which is what makes "the enemy counter-trains here"
 * (duskfell) a threat rather than a gift.
 */
export function adapt(state, knobs, out) {
  const seen = state.ai.seenPlayerComp ?? emptyComp();
  const now = playerArmy(state);
  const sample = emptyComp();
  const d = AI.sampleDecay;
  for (const u of UNIT_IDS) sample[u] = (seen[u] || 0) * d + (now[u] || 0) * (1 - d);
  state.ai.seenPlayerComp = sample;

  const unlocked = state.mods[ME]?.unlockedUnits ?? [];
  const trainers = state.sites
    .filter((s) => s.owner === ME && SITES[s.kind].train > 0).sort(byId);

  // Rams are a tier knob, not an adaptation: even T1 brings one occasionally.
  // They are also worthless on defence, so the appetite only applies while there
  // is a wall to knock down — when the siege ends, the yards go back to spears.
  const sieging = state.sites.some((s) => s.siege?.owner === ME);
  // THE YARDS, and they are `trainingGround` now rather than `stronghold`. The
  // two used to be one building, so "the sites that adapt" and "the sites that
  // defend" were the same list by accident. A stronghold trains nothing at all
  // any more, and this filter reading `stronghold` after the split would have
  // left the whole adaptation phase quietly ordering zero sites about — the
  // counter-pick, the ram appetite and the spear backbone, all silently off, on
  // exactly the tiers whose difficulty they carry.
  const yards = trainers.filter((s) => s.kind === 'trainingGround');
  // THE SPEAR BACKBONE IS RESERVED BEFORE EITHER PASS SPENDS ANYTHING. Rams and
  // the counter-pick are two independent shares of the same strongholds, and
  // nothing used to add them up: measured on obsidian, a 50% ram appetite over
  // seven walls took four, the counter share took the fifth, and two captured
  // neutral forts were already on the counter unit — seven walls, not one of
  // them a wall. Reserving one first is a cap on the SUM, which is the only
  // place the guarantee can live; `retrain` walks the surplus back to spearmen
  // on its own, so this also un-does a backbone an earlier think spent.
  const spendable = Math.max(0, yards.length - (yards.length >= 2 ? 1 : 0));
  let rams = 0;
  if (unlocked.includes('rams')) {
    // A share, but never a share that rounds to nothing: on a small map two
    // strongholds times 0.4 is zero engines, and "the enemy brings its own
    // rams" would silently be false for exactly the maps you can see it on.
    const want = sieging
      ? Math.max(1, yards.length * AI.ramTrainShare * knobs.ramAppetite) : 0;
    rams = Math.min(Math.round(want), spendable);
    retrain(out, yards, 'rams', rams);
  }

  if (!(knobs.counterShare > 0)) return;
  const dominant = UNIT_IDS
    .filter((u) => sample[u] > 0)
    .sort((a, b) => sample[b] - sample[a] || (a < b ? -1 : 1))[0];
  if (!dominant) return;
  const pick = AI.counterPick[dominant];
  if (!pick || !unlocked.includes(pick)) return;
  // STRONGHOLDS adapt; the castle does not. The throne is the win condition, so
  // it builds the kind's default and keeps building it — chasing the player's
  // composition with the one garrison that cannot be allowed to lose is how an
  // AI talks itself into holding its capital with siege engines.
  // A stronghold ALREADY building rams is off the table too, not just one that
  // was ordered this think: filtering only on `out` let the two passes consume
  // the same wall between them. The ram pass frees them again when the siege
  // ends, by ordering them back to spearmen.
  const pool = yards.filter((s) => s.trainType !== 'rams'
    && !out.some((c) => c.t === 'TRAIN' && c.site === s.id));
  // Same floor as the ram appetite, and for the same reason — but it does not
  // get to spend the wall the ram appetite left standing.
  const want = Math.max(1, pool.length * knobs.counterShare);
  retrain(out, pool, pick, Math.min(Math.round(want), Math.max(0, spendable - rams)));

  // Finally, anything still building an OLD pick. `retrain` only walks back the
  // one unit it was asked about, so when the player switches army the previous
  // answer is ORPHANED and that yard builds it forever. Measured on obsidian:
  // two captured forts sat on militia long after the spearmen they answered
  // were gone, which is how seven strongholds ended up with no spearwall.
  for (const s of yards) {
    const ordered = out.find((c) => c.t === 'TRAIN' && c.site === s.id);
    const unit = ordered ? ordered.unit : s.trainType;
    const back = MAPGEN.trainType[s.kind];
    if (unit === back || unit === pick || unit === 'rams') continue;
    if (ordered) ordered.unit = back;
    else out.push({ t: 'TRAIN', by: ME, site: s.id, unit: back });
  }
}
