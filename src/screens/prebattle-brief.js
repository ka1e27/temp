// The pre-battle screen's decisions, with no DOM and no clock: labels, the
// region briefing, and the loadout the screen opens with.
//
// Split out of prebattle.js when the slot budget landed — the screen was at 398
// lines against a 400 cap, and these are the parts worth testing directly.

import { h } from '../ui/dom.js';
import { compact, rate, duration, percent } from '../ui/format.js';
import { UNIT_IDS, LOADOUT_TYPES_MAX } from '../content/balance.js';
import { UNITS_UI, ENDGAME, UI } from '../content/strings.js';
import { RAID, GATE_CLAMP } from '../content/regions.data.js';
import {
  expeditionSlots, carryComposition, distributeExpedition,
  compositionSlots, compositionTotal, overBudget, slotCost, typeCount,
} from '../meta/modifiers.js';
import { unlockedUnits } from '../meta/upgrades.js';
import { regionById, effectiveEnemyMult, isConquered, record } from '../meta/world.js';
import {
  planFor, MUTATOR_BY_ID, campaignReplayPlan, campaignTwistPlan, incursionRules,
} from '../meta/incursion.js';
import { legacyResets } from '../meta/legacy.js';
import { commanderFor } from '../meta/marshals.js';
import { previewReward } from '../meta/rewards.js';
import { specialistCallouts } from '../meta/specialists.js';

export { compositionSlots, compositionTotal, overBudget, slotCost, typeCount };

/** Derived from content/strings.js rather than listed, so the loadout screen
 *  and the unit tooltip can never disagree about what a troop is called — and a
 *  new unit cannot ship with a blank label. */
export const UNIT_LABEL = Object.freeze(
  Object.fromEntries(UNIT_IDS.map((u) => [u, UNITS_UI[u].name])),
);

/** Label + what the booster actually does. Shared with the shop. */
export const BOOSTER_LABEL = Object.freeze({
  rally: 'Rally', march: 'Forced March', bombard: 'Bombardment',
  fortify: 'Emergency Fortify', tithe: 'War Tithe',
});

export const BOOSTER_NOTE = Object.freeze({
  rally: 'Every site within 2 hops sends half its garrison, arriving together.',
  march: 'Halves squad travel time for a short window.',
  bombard: 'Kills a quarter of a garrison and 60 structure HP. Never captures.',
  fortify: 'One site: double regen, half incoming damage, for 20s.',
  tithe: 'Instant battle gold plus 15s of faster training.',
});

/** Slots the empire grants this expedition. The screen's whole budget. */
export const loadoutBudget = (meta) => expeditionSlots(meta);

/**
 * The army the screen opens with.
 *
 * CARRIED, not re-fitted: the player's last picks come back as themselves and a
 * budget that grew arrives as militia. Re-fitting here would quietly re-spend
 * the decision — swapping raiders back out because the ratios moved — which is
 * exactly what "carry over my troop selections" asks us not to do.
 * With nothing to carry it falls back to the default spread, never a blank form.
 */
export function initialComposition(meta, composition) {
  return carryComposition(loadoutBudget(meta), unlockedUnits(meta), composition ?? null);
}

/** "Reset to default" — throw the carried picks away and re-spend by weight. */
export function defaultComposition(meta) {
  return distributeExpedition(loadoutBudget(meta), unlockedUnits(meta));
}

/** Everything the budget line renders, in one place so the test can read it. */
export function budgetSummary(chosen, budget) {
  const spent = compositionSlots(chosen);
  const types = typeCount(chosen);
  return {
    spent,
    budget,
    free: budget - spent,
    troops: compositionTotal(chosen),
    over: overBudget(chosen, budget),
    // The second budget on this screen. Slots say how big the army is; types say
    // how many different answers it carries, and the cap is what stops "a bit of
    // everything" — which is both the dullest loadout and, because the
    // specialists are share-scaled, the weakest.
    types,
    typesMax: LOADOUT_TYPES_MAX,
    typesFull: types >= LOADOUT_TYPES_MAX,
  };
}

export function describeComposition(comp, unlocked) {
  return unlocked
    .filter((u) => (comp?.[u] ?? 0) > 0)
    .map((u) => `${comp[u]} ${UNIT_LABEL[u]}`)
    .join(', ') || 'empty';
}

/**
 * Everything the briefing panel shows, with no DOM and no clock. Difficulty,
 * map size, target length and reward all come off the region record.
 */
export function regionBrief(meta, regionId, depth = null) {
  const region = regionById(regionId);
  if (!region) return null;
  const raid = isConquered(meta, regionId);
  const reward = previewReward(meta, regionId, depth ?? 0);
  // A RUNG'S DIFFICULTY IS THE RUNG'S, NOT THE GROUND'S. `effectiveEnemyMult` is
  // the raid ladder's dial for this region and has nothing to do with the depth,
  // so showing it on an incursion would advertise a fight the player is not about
  // to have — off by a factor that grows with every rung.
  const plan = depth ? planFor(depth) : null;
  const mult = plan ? plan.enemyMult : effectiveEnemyMult(meta, regionId);
  // HARDERPERCLEAR, SURFACED. `mult` above already folds it into the one
  // figure a fresh attack and a tenth raid show identically — see
  // content/regions.rules.js `RAID.harderPerClear`. Broken out here so a
  // player who has been raiding a region can see how much of that number they
  // chose by clearing it again, rather than watching one figure creep with no
  // label on the reason. Never shown on an incursion, which has its own dial
  // and no relationship to this region's `clears`.
  const clears = record(meta, regionId).clears;
  const raidEscalation = !plan && raid && clears > 0
    ? (1 + RAID.harderPerClear) ** clears : null;
  // ABDICATION'S SECOND HALF — see meta/incursion.js `campaignReplayPlan`. A
  // replayed run's own hand, resolved here for the same reason an incursion's
  // is: it must be visible before the loadout is chosen, never discovered
  // mid-battle. Null on a first run (`legacyResets` 0) and whenever this is an
  // incursion instead, which carries its own hand under `incursion.mutators`.
  const replay = plan ? null : campaignReplayPlan(region, legacyResets(meta));
  // ...AND THE HAND THE REGION CARRIES IN ITS OWN RIGHT, which is the one an
  // ordinary player actually meets — see meta/incursion.js `campaignTwistPlan`.
  // Resolved with the SAME precedence buildBattleConfig uses (`replay ?? twist`,
  // never both), because a brief that advertised a different hand from the one
  // the battle carries is the class of defect invariant 3 exists to prevent, one
  // screen further out.
  const twist = plan || replay ? null : campaignTwistPlan(region, clears);
  // THE GATE THE BATTLE WILL ACTUALLY RUN UNDER, not the region's own — an
  // incursion's `sealed` mutator raises it, and quoting the campaign figure at
  // a rung fought under a different one is the same defect as quoting
  // `effectiveEnemyMult` at a rung, which the comment above already fixes.
  // `incursionRules` is asked rather than re-derived, so there is one owner of
  // the ceiling arithmetic.
  // The enemy's own commander for this region — see meta/marshals.js
  // `commanderFor`. Decoration, and a pure function of (region, resets), so a
  // second run of the campaign is fought against a new generation of them.
  const commander = commanderFor(region, legacyResets(meta));
  const gateFrac = plan
    ? (incursionRules({ castleGateFrac: region.castleGateFrac ?? 0 }, plan).castleGateFrac ?? 0)
    : GATE_CLAMP(region.castleGateFrac ?? 0);
  return {
    id: region.id, name: region.name, tier: region.tier, flavour: region.flavour,
    raid, reward, enemyMult: mult,
    incursion: plan ? {
      depth: plan.depth,
      label: ENDGAME.incursionDepth(plan.depth),
      mutators: plan.mutators.map((id) => ({
        id, name: MUTATOR_BY_ID[id].name, note: MUTATOR_BY_ID[id].note,
      })),
    } : null,
    // THE HAND THIS REGION CARRIES, whatever put it there — a replayed run's or
    // its own. Renamed from `replayMutators` when campaign regions grew hands of
    // their own: one field rather than two means the loadout screen keeps ONE
    // render block, and a third near-identical copy of that markup is exactly
    // how a surface drifts out of step with the rule it draws.
    regionMutators: ((replay ?? twist)?.mutators ?? []).map((id) => ({
      id, name: MUTATOR_BY_ID[id].name, note: MUTATOR_BY_ID[id].note,
    })),
    // A pure derivation off the same region row, so a balance pass moving
    // `develop` or `siteCounts.enemyMix` never needs a second table of hints
    // kept in step by hand. See meta/specialists.js for the two rules and why
    // archers are never among them.
    callouts: specialistCallouts(meta, region),
    rows: [
      // WHO YOU ARE FIGHTING, at the top, because it is the only row here that
      // is a fact about a PERSON rather than about the ground — and because it
      // is what makes the muster alert a callback rather than a cold
      // introduction ("MARSHAL MARLOWE'S HOST MARCHES" means something only if
      // you were told, twenty minutes earlier, whose country this is). The
      // TITLE is the information: `Marshal` means this throne fields a banner
      // and refills 40% faster, `Castellan` means it does not. Absent on an
      // incursion, whose arena is a rung rather than a country.
      ...(!plan && commander
        ? [['Defended by', commander.full, UI.commanderHint, 'commander']] : []),
      ['Difficulty', `x${mult.toFixed(2)}`, null, 'difficulty'],
      ...(raidEscalation ? [['Raid escalation', `x${raidEscalation.toFixed(2)} from `
        + `${clears} clear${clears === 1 ? '' : 's'}`]] : []),
      ['Battlefield', `${region.grid.cols} x ${region.grid.rows}`],
      ['Enemy sites', `${region.siteCounts.enemy}`],
      // A THIRD SLOT IS AN OPTIONAL HINT, rendered as a `title` on both halves
      // of the row. "Hard cap" was developer jargon in front of a player, one
      // line under "Typical length" — two numbers that mean opposite things,
      // neither explained. See UI.timeLimitHint.
      ['Typical length', `~${region.targetLengthMin} min`, UI.typicalLengthHint],
      [UI.timeLimit, duration(region.hardCapMs / 1000), UI.timeLimitHint],
      // THE NUMBER THAT DECIDES SEVERAL OF THESE BATTLES, AND IT WAS NEVER SHOWN.
      // `castleGateFrac` is the share of the countryside the throne holds out
      // for, and until now it appeared nowhere before the fight and, in the
      // fight, only inside the castle's own panel and only once the throne was
      // already under siege (`castleSealed` requires an active siege). So a
      // player correctly taking the countryside for twenty minutes had no way to
      // know whether they were two points short of the gate or forty-seven.
      // Measured: every one of thirty-seven timeouts in the castle-gate pass sat
      // below the gate. It leaks nothing — it is a static rule of the region,
      // like its size — and it is omitted rather than shown as 0%% where there is
      // no gate, because "0%%" reads as a requirement rather than as its absence.
      ...(gateFrac > 0 ? [['Throne holds until', `you hold ${percent(gateFrac)} of the map`]] : []),

      [plan ? 'Clearing pays' : raid ? 'Raid pays' : 'Conquest pays', plan || raid
        ? `${compact(reward.crowns)} crowns, once`
        : `${compact(reward.crowns)} crowns and ${rate(reward.incomeAdded)} forever`],
    ],
  };
}

export function briefPanel(brief) {
  return h('section.pb-brief.panel', { 'aria-labelledby': 'pb-brief-h' },
    h('h2#pb-brief-h', {
      text: brief.incursion ? brief.incursion.label : `Tier ${brief.tier} briefing`,
    }),
    // `stat` IS LOAD-BEARING, and a screenshot is what proved it. prebattle.css
    // styled the DIFFICULTY as this panel's hero figure by position —
    // `dd:first-of-type` — which was right while difficulty was the first row
    // and wrong the instant anything went above it: adding "Defended by" put a
    // commander's NAME in enemy red at display size while the multiplier the
    // loadout is actually weighed against dropped to body text. That is
    // verbatim the defect worldmap-detail.js already carries a paragraph about,
    // in the sibling file, found the same way. Positional selectors over a list
    // that can change length are the bug; naming the row is the fix.
    h('dl.pb-stats', {}, ...brief.rows.flatMap(([k, v, hint, stat]) => [
      h('dt.label', { text: k, ...(hint ? { title: hint } : {}), ...(stat ? { 'data-stat': stat } : {}) }),
      h('dd.num', { text: v, ...(hint ? { title: hint } : {}), ...(stat ? { 'data-stat': stat } : {}) }),
    ])),
    // The complications are the reason this screen matters on a rung: `thinned`
    // lands a smaller army and `ironwall` makes engines the difference between
    // a siege and a stalemate, so they are shown WHERE the army is chosen and
    // not only on the briefing overlay the player has already closed.
    ...(brief.incursion?.mutators?.length
      ? [h('ul.pb-mutators', {}, ...brief.incursion.mutators.map((m) => h('li.pb-mutator', {
        'data-mutator': m.id,
      }, h('strong', { text: m.name }), h('span', { text: ` ${m.note}` }))))]
      : []),
    // THE HAND THIS REGION CARRIES — its own (meta/incursion.js
    // `campaignTwistPlan`, which is what an ordinary player meets from region
    // 10 on) or a replayed run's (`campaignReplayPlan`). ONE block for both,
    // because they are the same statement to the player and a third copy of
    // this markup is how a surface drifts out of step with its own rule.
    // Mutually exclusive with the incursion list above, and shown for the same
    // reason: know before you pick a loadout, not mid-battle.
    ...(brief.regionMutators?.length
      ? [h('ul.pb-mutators.pb-replay-mutators', {},
        ...brief.regionMutators.map((m) => h('li.pb-mutator', {
          'data-mutator': m.id,
        }, h('strong', { text: m.name }), h('span', { text: ` ${m.note}` }))))]
      : []),
    // The specialists are opt-in and easy to forget; meta/specialists.js
    // reads this same region's own data and says when one answers the fight
    // better than the default spread. `data-unlocked` is what tells "bring
    // it" from "consider buying it" apart without repeating the unit's name.
    ...(brief.callouts?.length
      ? [h('ul.pb-tips', {}, ...brief.callouts.map((c) => h('li.pb-tip', {
        'data-unit': c.unit, 'data-unlocked': c.unlocked ? '1' : '0',
      }, h('strong', { text: UNIT_LABEL[c.unit] }), h('span', { text: ` ${c.note}` }))))]
      : []));
}
