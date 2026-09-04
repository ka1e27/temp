// Post-battle results. This is where a battle's FACTS become the meta layer's
// MONEY — and the only place that conversion is allowed to happen.
//
// Four outcomes reach this screen, not two. `retreat` used to be unreachable
// (nothing called input.withdraw()) and read as a defeat; now that Withdraw is
// a real button it gets its own copy, because "you chose to leave" and "you
// were beaten" are different sentences and only one of them is an instruction.
//
// The retry route goes through the LOADOUT, not straight back into the battle:
// the copy tells a beaten player to change their expedition, so the button had
// better take them somewhere they can.
import { h, mount } from '../ui/dom.js';
import { duration } from '../ui/format.js';
import { UI, RESULTS, WORLD } from '../content/strings.js';
import { applyOutcome } from '../meta/rewards.js';
import { regionById, isAttackable, canRaid, raidCooldownRemaining } from '../meta/world.js';
import { nextDepth, planFor } from '../meta/incursion.js';
import { incomePerSec } from '../meta/idle.js';
import { honourView } from '../meta/milestones.js';
import { resultCopy, resultReason, statRows, actionOrder } from './results-copy.js';

// Re-exported so nothing that imported these from here had to move: four
// suites and the screen itself all address them at this front door. The split
// was the 400-line cap, not a change of ownership.
export { resultCopy, resultReason, statRows, actionOrder };

/** The ids of every honour already standing. Exported so the diff below is a
 *  function with a test rather than four lines inside a scene's `enter()`. */
export const earnedHonourIds = (stats) => new Set(
  honourView(stats).rows.filter((r) => r.done).map((r) => r.id));

/**
 * The honours crossed BETWEEN a snapshot and now, in table order.
 *
 * Lives on the screen side deliberately. `tests/milestones.test.js` walks the
 * source and fails if any simulation, meta or harness file imports the honours
 * table — that is what guarantees an honour can never grant anything and
 * quietly re-tune twenty-four regions. Announcing a threshold is the right side
 * of that line; paying one is not.
 */
export const honoursSince = (before, stats) => honourView(stats).rows
  .filter((r) => r.done && !before.has(r.id));

/** Where the rung after this one is fought. Derived, never remembered: the ring
 *  rotates, so the next depth is usually different ground. */
const nextRungRegion = (meta) => planFor(nextDepth(meta)).regionId;

/** The `dt`/`dd` pairs for one KIND of row. `data-stat` is what the stylesheet
 *  keys the payoff treatment on, replacing a `dd:last-of-type` that was right
 *  on a win by luck and wrong on the other three outcomes. */
const statList = (rows, kind) => rows.filter((r) => r[2] === kind)
  .flatMap(([k, v]) => [
    h('dt.label', { text: k }),
    h('dd.num', { 'data-stat': kind === 'payoff' ? 'payoff' : null, text: v }),
  ]);

export function createResultsScene(ctx) {
  let root = null;

  return {
    id: 'results',

    enter({ outcome, config }) {
      const meta = ctx.state.meta;
      const before = incomePerSec(meta);
      // WHAT THIS BATTLE EARNED YOU, snapshotted before the payout moves the
      // counters. Honours are diffed HERE and not in `meta/rewards.js` on
      // purpose: `tests/milestones.test.js` walks the source and fails if any
      // simulation, meta or harness file imports the honours table, which is
      // what guarantees an honour can never grant anything and quietly re-tune
      // twenty-four regions. A screen is the right side of that line — it is
      // announcing a number, not paying one.
      const hadHonours = earnedHonourIds(meta.stats);

      // meta/rewards.js is the sole authority on rewards; the battle engine
      // reported observations and nothing else.
      const applied = applyOutcome(meta, config, outcome, {
        now: Date.now(), bus: ctx.bus, state: ctx.state,
      });
      const after = applied.incomePerSec;
      const region = regionById(outcome.regionId);
      // Crossed by THIS battle. `honourView` is a pure read of `meta.stats`, so
      // the diff is exact rather than a guess at which counter moved.
      const wonHonours = honoursSince(hadHonours, meta.stats);
      // A NEW FRONT, which `refreshUnlocks` has always returned and nothing has
      // ever read. `WORLD.frontOpened` was written for exactly this moment and
      // had zero readers in the whole tree; meanwhile a conquest silently
      // turned its neighbours from unreachable to attackable, with no comment
      // of any kind. (When this was written the board also swapped a
      // placeholder for the name at that moment — it names every region now,
      // so what a conquest changes is the MODE, and the line is if anything
      // more needed: the board's own tell is a small tag reading OPEN.)
      const fronts = (applied.opened ?? []).map((id) => regionById(id)?.name)
        .filter(Boolean);
      const copy = resultCopy(outcome, applied, region);
      const reason = resultReason(outcome, config);

      const rows = statRows(outcome, applied, before, after);
      const gains = rows.filter((r) => r[2] === 'payoff');

      document.body.dataset.scene = 'results';
      root = h('div.screen.results', {},
        h('div.results-card.panel', {
          'data-result': outcome.result,
          role: 'status', 'aria-live': 'polite', 'aria-labelledby': 'results-title',
        },
        h('h1#results-title.results-title', { text: copy.title }),
        h('p.results-sub', { text: copy.body }),
        // The causal line sits under the outcome copy and above the numbers,
        // because it is the sentence that makes the numbers mean something.
        // `h()` skips a null child, so a win renders exactly as it did.
        reason ? h('p.results-why', { text: reason }) : null,

        // TWO LISTS, NOT ONE, AND THAT IS THE STRUCTURAL DIFFERENCE BETWEEN
        // WINNING A REGION AND WALKING AWAY FROM ONE. Screenshotted through the
        // real pipeline, all four outcomes rendered as the same 560px card with
        // the same rhythm, differing in a 3px top edge, a tag word and the
        // headline — so a victory and a withdrawal were one dashboard in two
        // hues. What the card was already computing and throwing away is that
        // its rows are two KINDS: what happened, and what you got. A win has an
        // earnings list and a loss simply does not, so the two are a different
        // shape on the page before any colour is read.
        //
        // `h()` skips a null child, so an outcome that paid nothing renders one
        // list exactly as it always did.
        h('dl.results-stats', {}, ...statList(rows, 'fact')),
        gains.length
          ? h('dl.results-gains', { 'aria-label': RESULTS.gainedLabel },
            ...statList(rows, 'payoff'))
          : null,

        // Below the numbers and above the buttons: these are things you EARNED
        // rather than things that happened, so they read as the last word.
        // `h()` skips a null child, so a battle that opened nothing and crossed
        // nothing renders exactly as it did before.
        wonHonours.length
          ? h('ul.results-honours', {},
            ...wonHonours.map((r) => h('li', {},
              h('span.results-honour-tag', { text: RESULTS.honourEarned }),
              h('span.results-honour-title', { text: r.title }),
              h('span.results-honour-note', { text: r.note }))))
          : null,
        fronts.length
          ? h('p.results-front', {},
            h('span.results-front-tag', { text: WORLD.frontOpened }),
            h('span.results-front-names', { text: fronts.join(', ') }))
          : null,

        h('div.results-actions', {}, ...actions(outcome, config))));

      mount(ctx.root, root);
      root.querySelector('.results-actions button')?.focus();
      return [() => root?.remove()];
    },

    exit() {
      root = null;
      delete document.body.dataset.scene;
    },
  };

  /**
   * "Fight again" used to fire straight back into a battle even when the region
   * had just been conquered and its raid was on a ten-minute cooldown — an
   * unearned re-run of a fight the world map would have refused.
   */
  function actions(outcome, config) {
    const meta = ctx.state.meta;
    const now = Date.now();
    const id = outcome.regionId;
    const rung = config?.rules?.incursion?.depth ?? 0;

    const map = () => h('button.btn.results-map', {
      text: 'To the map', type: 'button',
      on: { click: () => ctx.scenes.replace(ctx.screens.worldmap) },
    });

    const again = (text, label, depth = 0) => h('button.btn.results-again', {
      text, type: 'button', 'aria-label': label,
      on: {
        click: () => ctx.scenes.replace(ctx.screens.prebattle, {
          regionId: depth ? nextRungRegion(meta) : id,
          ...(depth ? { incursion: depth } : {}),
          // Re-open on the army that just fought, so "change your expedition"
          // starts from the one that failed rather than from the default.
          composition: config?.player?.expedition,
        }),
      },
    });

    // THE PRIMARY BUTTON FOLLOWS THE COPY, AND IT USED NOT TO.
    //
    // `To the map` was `.btn.primary`, first in the row, and therefore the one
    // `enter()` focuses — on every outcome. So a Defeat card read "Change your
    // expedition and try again" over a filled green button that LEAVES, with
    // the action the sentence names sitting beside it in the secondary style
    // and Enter bound to the wrong one. Screenshotted on all four.
    //
    // Which action is primary is a property of the outcome, so it is decided
    // here rather than baked into the first `h()` call: after a defeat or a
    // timeout the game is telling you to go again, and after a win or a
    // withdrawal it is not. A retreat deliberately keeps `To the map` — the
    // player chose to leave and the copy gives them no instruction to reverse.
    //
    // `.results-map` and `.results-again` keep their classes and both are
    // always present, so `tools/smoke-helpers.mjs` — which navigates results by
    // clicking `.results-map` — is unaffected by the reorder.
    const lead = (btn) => { btn.classList.add('primary'); return btn; };

    // THE LADDER IS THE ONE THING WORTH A STRAIGHT-BACK-IN BUTTON, win or lose,
    // and the two cases are different fights: a win advances the rung (and can
    // move to different ground, so the region is re-derived rather than reused),
    // a loss re-offers the same one. There is no cooldown to respect either way —
    // what bounds the ladder is winnability. It leads on both, because going one
    // rung deeper is the entire reason the screen is in front of you.
    if (rung) {
      const next = nextDepth(meta);
      return [lead(again(`Depth ${next}`, `Plan incursion depth ${next}`, next)), map()];
    }

    if (outcome.result === 'win') {
      if (canRaid(meta, id, now)) {
        return [lead(map()), again(UI.raid, `Plan another raid on ${id}`)];
      }
      return [lead(map()), h('p.results-hint.dim', {
        text: `Raid available in ${duration(raidCooldownRemaining(meta, id, now) / 1000)}.`,
      })];
    }

    if (!isAttackable(meta, id)) return [lead(map())];
    const retry = again('Change loadout & retry', 'Change the expedition and try again');
    return actionOrder(outcome) === 'retry' ? [lead(retry), map()] : [lead(map()), retry];
  }
}
