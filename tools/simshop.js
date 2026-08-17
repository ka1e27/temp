// WHAT THE EMPIRE BUYS BETWEEN BATTLES.
//
// Split out of ./simplayer.js purely for the 400-line cap and re-exported from
// there, so `import { spendCrowns } from './simplayer.js'` keeps working. The
// division of labour: that file is what the bot does DURING a battle, this one
// is what it owns when the battle starts — and the second is what decides which
// player the twenty-four measured win rates describe.
import { UNIT_IDS } from '../src/content/balance.js';
import { UPGRADES } from '../src/content/upgrades.data.js';
import { shopListing, buy, spendAll } from '../src/meta/upgrades.js';
import { recalcIncome } from '../src/meta/idle.js';

/**
 * Spend a realistic idle budget the way a player would: cheapest useful thing
 * first. Without this the harness tests an unupgraded player against later
 * regions, which is not a case the design claims is winnable.
 */
export function spendCrowns(meta, crowns, fielded = null) {
  meta.crowns += crowns;
  const useless = pointlessUnlocks(fielded);

  // A unit you have DECIDED to field is bought before the generic power, and
  // that ordering is load-bearing rather than cosmetic. Cheapest-affordable-first
  // drains the treasury into the six endless lines, and an unlock only ever gets
  // taken on the tick it happens to be the cheapest thing left — so at gallowmoor
  // the 400-crown outriders and 1200-crown halberds were bought while the
  // 1800-crown sappers never were, and a `--weights=sappers` run silently landed
  // ZERO sappers and reported the default army's win rate under their name.
  // Nobody decides to bring a siege-repair detachment and then spends the money
  // on a treasury level instead.
  for (const unit of fielded ?? []) {
    const id = UNLOCK_FOR[unit];
    if (!id) continue;
    const item = shopListing(meta).flatMap((g) => g.items).find((i) => i.id === id);
    if (item && item.affordable && item.level < item.maxLevel) buy(meta, id, null);
  }

  // THE TWO PURSES ARE SPENT SEPARATELY, and they have to be: cheapest-first is
  // a comparison, and 4 relics against 45 crowns is not one. Sorting them
  // together would drain the relics into whatever had the smallest number
  // printed on it. At zero relics — which is every run in the measured table —
  // the second loop finds nothing affordable and exits on its first pass, so
  // the crown path below is exactly the one the campaign was measured on.
  //
  // `spendAll` is the loop itself, moved to meta/upgrades.js so this file and
  // the shop screen's "Spend all" button share one implementation of "what
  // does the shop buy next" rather than two that can quietly disagree. `skip`
  // is this harness's own reason to withhold a line the run will never field;
  // the shop screen calls the same function with none.
  spendAll(meta, 'crowns', null, useless);
  spendAll(meta, 'relics', null, relicWaste(fielded));
  recalcIncome(meta, null);
}

/**
 * Troop lines for troops this run does not field.
 *
 * The same rule `pointlessUnlocks` encodes, one currency along: buy what you can
 * use. A relic spent levelling sappers an army does not contain is a relic that
 * was not spent on the militia it does, and `--relics=N` would then measure the
 * spread rather than the lever.
 */
function relicWaste(fielded) {
  const bring = new Set(fielded?.length ? fielded : DEFAULT_FIELDED);
  const out = new Set();
  for (const u of UPGRADES) {
    const unitId = u.requires?.startsWith('unit:') ? u.requires.slice(5) : null;
    if (unitId && !bring.has(unitId)) out.add(u.id);
  }
  return out;
}

/** What `distributeExpedition` actually lands when no weights are given. */
const DEFAULT_FIELDED = Object.freeze(['militia', 'spearmen', 'raiders', 'rams']);

/**
 * Unlocks that buy this run nothing, and therefore must not be bought.
 *
 * The bot shops CHEAPEST-AFFORDABLE-FIRST, so a cheap unlock is taken almost
 * immediately — and a specialist it does not field is 3,400 crowns that would
 * otherwise have been Arms and Treasury levels. Measured at n=64 the moment the
 * three were added to the shop, obsidian fell 47% -> 33% and ironcrown 52% ->
 * 38% with no change to any region, any unit stat, or the army actually landed.
 * That is a MEASUREMENT ARTEFACT, not a difficulty change, so the fix belongs
 * here rather than in the balance table.
 *
 * The rule is "buy what you can use", and `fielded` is what makes it a rule
 * rather than a hardcoded list. A `--weights` run that names outriders MUST buy
 * their unlock: `fitComposition` drops any unit missing from `unlocked`, so
 * without this the loadout would be silently discarded and the run would report
 * the default army's win rate under a specialist's name — the exact class of
 * false measurement this whole pass exists to close.
 */
const UNLOCK_FOR = Object.freeze({
  outriders: 'unlockOutriders', halberds: 'unlockHalberds', sappers: 'unlockSappers',
});

function pointlessUnlocks(fielded) {
  const out = new Set(Object.values(UNLOCK_FOR));
  for (const u of fielded ?? []) out.delete(UNLOCK_FOR[u]);
  return out;
}

/** The units a loadout actually asks for — the shop's reason to unlock them. */
export const fieldedUnits = (weights) =>
  (weights ? UNIT_IDS.filter((u) => (weights[u] ?? 0) > 0) : []);
