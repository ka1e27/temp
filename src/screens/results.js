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
import { compact, rate, duration, integer } from '../ui/format.js';
import { UI, RESULTS } from '../content/strings.js';
import { applyOutcome } from '../meta/rewards.js';
import { regionById, isAttackable, canRaid, raidCooldownRemaining } from '../meta/world.js';
import { nextDepth, planFor } from '../meta/incursion.js';
import { incomePerSec } from '../meta/idle.js';

/** Where the rung after this one is fought. Derived, never remembered: the ring
 *  rotates, so the next depth is usually different ground. */
const nextRungRegion = (meta) => planFor(nextDepth(meta)).regionId;

/**
 * Title and body for an outcome. Pure, so the four branches are testable and
 * none of them can quietly stop being reachable again.
 * @param {object} outcome  BattleOutcome
 * @param {object} applied  summary from applyOutcome()
 * @param {object|null} region
 */
export function resultCopy(outcome, applied, region) {
  const name = region?.name ?? 'The region';
  if (outcome.result === 'win') {
    if (applied?.incursion) {
      return {
        title: `Depth ${applied.incursion.depth} cleared`,
        body: 'The ladder goes on. The next rung is harder, and pays more for it.',
      };
    }
    return applied?.raided
      ? { title: `${name} raided`, body: 'A one-time lump. The region was already yours.' }
      : { title: `${name} is yours`, body: 'Your empire grows, and so does its income.' };
  }
  if (outcome.result === 'retreat') {
    return { title: RESULTS.retreat, body: RESULTS.retreatBody };
  }
  if (outcome.result === 'timeout') {
    return { title: RESULTS.timeout, body: RESULTS.timeoutBody };
  }
  return { title: RESULTS.loss, body: RESULTS.lossBody };
}

/** The stat block. `won` decides whether the money lines appear at all. */
export function statRows(outcome, applied, before, after) {
  const rows = [
    ['Duration', duration(outcome.durationMs / 1000) + (applied?.newBest ? ' — best yet' : '')],
    ['Sites held', `${outcome.stats.sitesHeld} / ${outcome.stats.sitesTotal}`],
    ['Units lost', integer(outcome.stats.unitsLost)],
    ['Enemy losses', integer(outcome.stats.unitsKilled)],
  ];
  const spent = applied?.boostersConsumed ?? [];
  if (spent.length) {
    rows.push(['Charges spent', spent.map((b) => `${b.count} ${b.id}`).join(', ')]);
  }
  if (outcome.result === 'win') {
    if (applied?.crowns) rows.push(['Crowns', `+${compact(applied.crowns)}`]);
    if (after > before) rows.push([UI.income, `${rate(before)} → ${rate(after)}`]);
  }
  if (applied?.incursion) rows.push(['Depth', `${applied.incursion.depth}`]);
  return rows;
}

export function createResultsScene(ctx) {
  let root = null;

  return {
    id: 'results',

    enter({ outcome, config }) {
      const meta = ctx.state.meta;
      const before = incomePerSec(meta);

      // meta/rewards.js is the sole authority on rewards; the battle engine
      // reported observations and nothing else.
      const applied = applyOutcome(meta, config, outcome, {
        now: Date.now(), bus: ctx.bus, state: ctx.state,
      });
      const after = applied.incomePerSec;
      const region = regionById(outcome.regionId);
      const copy = resultCopy(outcome, applied, region);

      document.body.dataset.scene = 'results';
      root = h('div.screen.results', {},
        h('div.results-card.panel', {
          'data-result': outcome.result,
          role: 'status', 'aria-live': 'polite', 'aria-labelledby': 'results-title',
        },
        h('h1#results-title.results-title', { text: copy.title }),
        h('p.results-sub', { text: copy.body }),

        h('dl.results-stats', {},
          ...statRows(outcome, applied, before, after).flatMap(([k, v]) => [
            h('dt.label', { text: k }), h('dd.num', { text: v }),
          ])),

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

    const out = [h('button.btn.primary.results-map', {
      text: 'To the map', type: 'button',
      on: { click: () => ctx.scenes.replace(ctx.screens.worldmap) },
    })];

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

    // THE LADDER IS THE ONE THING WORTH A STRAIGHT-BACK-IN BUTTON, win or lose,
    // and the two cases are different fights: a win advances the rung (and can
    // move to different ground, so the region is re-derived rather than reused),
    // a loss re-offers the same one. There is no cooldown to respect either way —
    // what bounds the ladder is winnability.
    if (rung) {
      const next = nextDepth(meta);
      out.push(again(`Depth ${next}`, `Plan incursion depth ${next}`, next));
      return out;
    }

    if (outcome.result === 'win') {
      if (canRaid(meta, id, now)) out.push(again(UI.raid, `Plan another raid on ${id}`));
      else {
        out.push(h('p.results-hint.dim', {
          text: `Raid available in ${duration(raidCooldownRemaining(meta, id, now) / 1000)}.`,
        }));
      }
    } else if (isAttackable(meta, id)) {
      out.push(again('Change loadout & retry', 'Change the expedition and try again'));
    }
    return out;
  }
}
