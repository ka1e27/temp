// Post-battle results. This is where a battle's FACTS become the meta layer's
// MONEY — and the only place that conversion is allowed to happen.
import { h, mount } from '../ui/dom.js';
import { compact, rate, duration, integer } from '../ui/format.js';
import { applyOutcome } from '../meta/rewards.js';
import { regionById } from '../meta/world.js';
import { incomePerSec } from '../meta/idle.js';

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
      const won = outcome.result === 'win';

      document.body.dataset.scene = 'results';
      root = h('div.screen.results', {},
        h('div.results-card.panel', { 'data-result': outcome.result },
          h('h1.results-title', {
            text: won ? `${region?.name ?? 'Region'} is yours`
              : outcome.result === 'retreat' ? 'Withdrawn'
                : outcome.result === 'timeout' ? 'Time ran out' : 'Defeated',
          }),
          h('p.results-sub', {
            text: won
              ? 'Your empire grows, and so does its income.'
              : 'Nothing was lost but time — your treasury is untouched.',
          }),

          h('dl.results-stats', {},
            ...statRows(outcome, applied, before, after, won).flatMap(([k, v]) => [
              h('dt', { text: k }), h('dd.num', { text: v }),
            ])),

          h('div.results-actions', {},
            h('button.btn.primary', {
              text: 'To the map', type: 'button',
              on: { click: () => ctx.scenes.replace(ctx.screens.worldmap) },
            }),
            h('button.btn', {
              text: won ? 'Fight again' : 'Retry', type: 'button',
              on: {
                click: () => ctx.scenes.replace(ctx.screens.battle, {
                  regionId: outcome.regionId,
                  boosters: config.boosters,
                }),
              },
            }))));

      mount(ctx.root, root);
      return [() => root?.remove()];
    },

    exit() {
      root = null;
      delete document.body.dataset.scene;
    },
  };
}

function statRows(outcome, applied, before, after, won) {
  const rows = [
    ['Duration', duration(outcome.durationMs / 1000)],
    ['Sites held', `${outcome.stats.sitesHeld} / ${outcome.stats.sitesTotal}`],
    ['Units lost', integer(outcome.stats.unitsLost)],
    ['Enemy losses', integer(outcome.stats.unitsKilled)],
  ];
  if (won) {
    if (applied?.crowns) rows.push(['Crowns', `+${compact(applied.crowns)}`]);
    if (after > before) {
      rows.push(['Income', `${rate(before)} → ${rate(after)}`]);
    }
  }
  return rows;
}
