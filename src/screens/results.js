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
import { compact, rate, duration, integer, percent } from '../ui/format.js';
import { UI, RESULTS, COACH } from '../content/strings.js';
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
    if (applied?.raided) {
      return { title: `${name} raided`, body: 'A one-time lump. The region was already yours.' };
    }
    // THE FIRST CONQUEST IS WHERE THE TWO HALVES OF THE GAME CONNECT, and the
    // game had never once said so. `COACH.firstIncome` was written for exactly
    // this moment and wired to nothing; the screen said "so does its income" and
    // stopped, so a first-timer played this as a small RTS with a confusing shop
    // attached and never learned the idle half existed until they happened to
    // leave for a minute and come back.
    if (applied?.firstConquest) {
      return { title: `${name} is yours`, body: COACH.firstIncome };
    }
    return { title: `${name} is yours`, body: 'Your empire grows, and so does its income.' };
  }
  if (outcome.result === 'retreat') {
    return { title: RESULTS.retreat, body: RESULTS.retreatBody };
  }
  if (outcome.result === 'timeout') {
    return { title: RESULTS.timeout, body: RESULTS.timeoutBody };
  }
  return { title: RESULTS.loss, body: RESULTS.lossBody };
}

/**
 * WHY the battle ended the way it did — one sentence, or null on a win.
 *
 * The screen showed four to seven stat rows and nothing causal: no "your siege
 * stalled", no "the gate needed more territory", no "you were out-fought at the
 * wall". Every fact needed for the three statements below is already in the
 * outcome the screen is holding, so this needed no contract field and no new
 * observation — which is also the constraint that keeps it honest.
 *
 * IT ONLY SAYS WHAT IT CAN PROVE. Each branch is a certainty, not a diagnosis:
 *
 *  - A `loss` is one of exactly two things (battle/sim.js): the camp changed
 *    hands, or the player held nothing and had nothing in flight. `sitesHeld`
 *    tells them apart.
 *  - A `timeout` either finished below the castle gate or it did not, and that
 *    is decidable, because on any outcome the player did not WIN they do not
 *    hold the castle — so `sitesHeld` is exactly their non-castle count and
 *    `sitesTotal - 1` is exactly the non-castle total. That ratio IS
 *    `battle/siteinfo.js siteControlFraction`, the same number `castleSealed`
 *    compares against, rather than an approximation of it.
 *
 * There is deliberately no "you were out-fought" branch: casualties do not say
 * who was winning, and a sentence that guesses is worse than no sentence. A
 * retreat gets none either — the player knows why they left.
 *
 * @param {object} outcome BattleOutcome
 * @param {object|null} config the BattleConfig it was fought under; the gate
 *   is read from here rather than from the region table, so an incursion
 *   mutator that moved it is reflected.
 * @returns {string|null}
 */
export function resultReason(outcome, config) {
  const r = outcome?.result;
  if (r === 'win' || r === 'retreat') return null;
  const held = outcome.stats?.sitesHeld ?? 0;
  const total = outcome.stats?.sitesTotal ?? 0;
  if (r === 'loss') return held > 0 ? RESULTS.whyCampFell : RESULTS.whySweptAway;
  if (r !== 'timeout') return null;

  const need = config?.rules?.castleGateFrac ?? 0;
  // No gate on this region, or a board with nothing but a castle on it: there
  // is no territory claim to make, so make none.
  if (need <= 0 || total <= 1) return RESULTS.whyClockOnly;
  const frac = held / (total - 1);
  return frac < need
    ? RESULTS.whyGateHeld(percent(frac), percent(need))
    : RESULTS.whyClockOnly;
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
    // Only ever on a first conquest or a cleared rung, so its presence is
    // itself the news: a raid on ground you already hold never shows this row.
    if (applied?.relics) rows.push([UI.relics, `+${applied.relics}`]);
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
      const reason = resultReason(outcome, config);

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
