// THE TWO FREE COMMANDERS — one for each side, granted OUTSIDE the budget that
// pays for everything else.
//
// Split out of ./modifiers.js for the line budget when tier 6 landed, and they
// belong together: they are mirrors of each other, they are both applied after
// the arithmetic they must not disturb, and both exist because a marshal bought
// with slots (or with a stronghold's forty seconds) is a bill rather than a
// reward. modifiers.js re-exports both, so nothing that imports them has to know
// which file they ended up in.
//
// PURE: plain functions over compositions and site arrays. No clock, no
// randomness — `withEnemyMarshal` is deterministic by construction because a
// difficulty grant that moved with the map seed would make a region's win rate
// unmeasurable.

/**
 * THE MARSHAL YOU BOUGHT TURNS UP, and it does not cost you eight militia.
 *
 * Unlocking the marshal used to buy the RIGHT to spend 8 of your expedition
 * slots on one body — 42% of a region-1 budget, 11% of a region-6 one — or to
 * retask a stronghold for forty seconds mid-battle. Both are a bill rather than
 * a reward, which is how a 4,000-crown purchase ended up being something players
 * simply never fielded.
 *
 * So the unlock grants exactly one, OUTSIDE the slot budget, on every landing.
 * `maxPerSite` still binds, so this cannot stack: it is one commander, free,
 * because that is what the price already paid for. More than one is still a
 * decision — buy it in the loadout, or commission it in battle (RECRUIT).
 *
 * Deliberately applied AFTER the budget is fitted, so the free one never
 * displaces a paid unit and never makes the loadout screen's arithmetic wrong.
 */
export function withFreeMarshal(fx, expedition) {
  if (!fx.units.includes('marshal')) return expedition;
  // EXACTLY one, not one more. `banner` is presence-based, so a second marshal
  // in the same camp buys literally nothing, and the loadout screen no longer
  // sells them at all (screens/prebattle-army.js) — which means the 8 slots stay
  // available for troops instead of being a trap for the player who paid 4,000
  // crowns and then paid again.
  return { ...expedition, marshal: Math.max(expedition.marshal ?? 0, 1) };
}

/**
 * ...AND SO DOES THEIRS. The mirror of `withFreeMarshal`, and the fix for a
 * unit that was in the enemy's roster for this project's whole life without
 * ever existing.
 *
 * `ENEMY_UNITS_BY_TIER` has listed `marshal` at tier 4 since tier 4 shipped,
 * and it did nothing: no `MAPGEN.trainType` produces one, `AI.counterPick` maps
 * marshal -> spearmen (what to build AGAINST one, not one to build), and
 * `BASE_GARRISON` never held one. Removing marshal from the tier-4 roster
 * changed thanescar's win rate by exactly 0 points, which is how the gap was
 * found. Ironcrown's flavour text has advertised an enemy Marshal the whole
 * time and it was simply false.
 *
 * Granted the same way the player's is — one commander, free, at the start —
 * because the alternative is worse in both directions. Training one costs a
 * yard forty seconds for a single body, so an AI that bought one would be
 * making the same solver's purchase `tools/simplayer.js` deliberately declines;
 * and a marshal that arrives at minute six is a difficulty spike nobody can
 * see coming.
 *
 * IT STANDS IN THE THRONE, which is the whole design of it:
 *   - `banner` is stack-local (battle/combat.js), so it buys +25% to whatever
 *     comp he is IN. In the castle that is the garrison defending the win
 *     condition — the fight the region is actually about.
 *   - `trainBuff` (battle/training.js) makes the throne produce 40% faster, so
 *     a siege that stalls is refilling the wall it is hitting.
 *   - "until you kill it" is then literally true: the marshal dies with the
 *     garrison, and battle/ai.js never sources an attack from the castle
 *     (`kind === 'castle'` is filtered out of the launch pool), so he cannot
 *     wander off and be picked up cheaply in a field.
 *
 * EXACTLY ONE, and deliberately applied AFTER `normalizeSites` rather than
 * through `MAPGEN.garrison`: that table is multiplied by `enemyMult ^
 * ENEMY_SCALING.garrison` and by the throne bonus, so a marshal placed there
 * would be scaled into two or three of them on the late regions. `maxPerSite`
 * is enforced in battle/training.js, which never sees a garrison mapgen wrote.
 * `banner` is presence-based, so a second is worth nothing anyway — it would
 * only be an invisible difficulty step that rides the difficulty dial.
 */
export function withEnemyMarshal(sites, unlockedUnits, count = 1) {
  if (!unlockedUnits.includes('marshal') || !(count > 0)) return sites;
  // THE THRONE FIRST, ALWAYS, then the best-defended wall — and past one this is
  // a per-tier count (content/regions.rules.js `ENEMY_MARSHALS_BY_TIER`) rather
  // than a second special case. `banner` is stack-local, so the ORDER is the
  // whole design: the first marshal defends the win condition, and the second
  // makes one line of the countryside expensive instead of making the whole map
  // slightly harder.
  //
  // Deterministic by construction — level, then garrison size, then id — because
  // combat has no randomness in it and a difficulty grant that moved with the
  // map seed would make a region's win rate unmeasurable.
  const bodies = (s) => Object.values(s.garrison ?? {}).reduce((a, n) => a + (n || 0), 0);
  // A marshal the map already produced spends the budget, so this stays the
  // statement "the enemy fields `count` of them" rather than "`count` more".
  const held = sites.filter((s) => s.owner === 'enemy' && s.garrison?.marshal > 0).length;
  const want = count - held;
  if (want <= 0) return sites;
  const eligible = sites
    .filter((s) => s.owner === 'enemy' && !(s.garrison?.marshal > 0))
    .sort((a, b) => (a.kind === 'castle' ? -1 : b.kind === 'castle' ? 1 : 0)
      || b.level - a.level || bodies(b) - bodies(a) || (a.id < b.id ? -1 : 1));
  // A castle is required for a valid config, so `eligible[0]` is the throne
  // unless it already holds one. Fewer eligible sites than `count` simply grants
  // fewer: `maxPerSite` is 1, and a second marshal in one garrison is worth
  // nothing at all.
  const chosen = new Set(eligible.slice(0, want).map((s) => s.id));
  if (!chosen.size) return sites;
  return sites.map((s) => (chosen.has(s.id)
    ? { ...s, garrison: { ...s.garrison, marshal: 1 } }
    : s));
}
