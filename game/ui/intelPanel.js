// Scout and Sabotage panel for the region card (DESIGN §5.7). Browser only; no game-logic
// imports: the integrator builds the data with `intelPanelData(state, world, regionId)` from
// game/meta/intel.js and passes it in on every card refresh (the panel short-circuits when nothing
// it shows has changed, so it is safe to call every few hundred ms).
//
//   const intel = createIntelPanel({ onScout: (id) => ..., onSabotage: (id) => ... });
//   regionCardBody.append(intel.el);            // under the difficulty bar
//   intel.update(intelPanelData(state, world, regionId));
//
// Two states, one element:
//   unscouted  one small secondary "Scout · 34" button (or "Scout · free"), disabled with a visible
//              reason ("Need 12 more gold") when it cannot be paid. Nothing else: the card stays clean.
//   scouted    a report box: composition chips, the leader's personality, the weak point, up to two
//              tactical notes, and a "Sabotage -15% · cost" button with flame pips.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { shortNumber } from './format.js';

/**
 * @typedef {Object} IntelSite
 * @property {string} type
 * @property {number} garrison
 */

/**
 * @typedef {Object} IntelReport   (game/meta/intel.js ScoutReport; only the fields the panel reads)
 * @property {number} regionId
 * @property {{ type: string, label: string, count: number, garrison: number, neutral: boolean }[]} groups
 *   composition chips, most important first ("Tower 14 x2")
 * @property {{ name: string, color: string, emblem: string }} faction
 * @property {string} personalityLine   "Aggressive: attacks early and commits big"
 * @property {string} weakPointType     'village', 'fort', ...
 * @property {string} weakPointReason   one short sentence, shown as a tooltip
 * @property {number} weakPoint         site id (used to mark the matching chip)
 * @property {{ id: number, type: string }[]} sites
 * @property {string[]} notes           at most two short notes
 * @property {number} total
 * @property {number} sabotage
 */

/**
 * @typedef {Object} IntelPanelData   (game/meta/intel.js IntelPanelData)
 * @property {number} regionId
 * @property {number} gold                 current gold, to say how much is missing
 * @property {boolean} scouted
 * @property {number} scoutCost            0 = free
 * @property {IntelReport|null} report     null until scouted
 * @property {number} sabotage             steps applied, 0..sabotageMax
 * @property {number} sabotageMax          2
 * @property {number} sabotageStep         fraction cut per step, 0.15
 * @property {number|null} sabotageCost    gold for the next step; null when maxed
 */

const TYPE_ICONS = { keep: 'castle', fort: 'shield', tower: 'tower' };
const TYPE_NAMES = { keep: 'keep', fort: 'fort', tower: 'tower', town: 'town', village: 'village', hamlet: 'hamlet' };

const pct = (fraction) => Math.round(fraction * 100);
const troops = (n) => (n >= 1000 ? shortNumber(n) : String(Math.round(n)));
const plural = (n, word) => (n === 1 ? word : `${word}s`);

/**
 * @param {{ onScout?: (regionId: number) => void, onSabotage?: (regionId: number) => void }} [callbacks]
 */
export function createIntelPanel({ onScout, onSabotage } = {}) {
  let data = null;
  let lastReportSig = null;
  let lastRegionId = null;
  let lastLevel = 0;
  let wasScouted = false;

  // --- unscouted row -----------------------------------------------------------------------
  const scoutCostEl = h('span.intel-btn-cost', {});
  const scoutBtn = h('button.btn.btn-secondary.intel-btn.intel-scout-btn', {
    type: 'button',
    onClick: () => { if (data && !scoutBtn.disabled) onScout?.(data.regionId); },
  }, icon('eye', 15), h('span.intel-btn-label', {}, 'Scout'), scoutCostEl);
  const scoutHint = h('span.intel-hint', {});
  const scoutRow = h('div.intel-row.intel-scout-row', {}, scoutBtn, scoutHint);

  // --- scouted report ----------------------------------------------------------------------
  const chipsEl = h('div.intel-chips', { role: 'list', 'aria-label': 'Garrisons' });
  const personalityEl = h('p.intel-personality', {});
  const weakEl = h('p.intel-weak', {});
  const notesEl = h('ul.intel-notes', {});

  const pips = [];
  const pipsEl = h('span.intel-pips', { role: 'img' });
  const cutEl = h('span.intel-cut.nums', {});
  const pipsGroup = h('span.intel-pips-group', {}, pipsEl, cutEl);
  const sabCostEl = h('span.intel-btn-cost', {});
  const sabLabelEl = h('span.intel-btn-label', {}, 'Sabotage');
  const sabBtn = h('button.btn.btn-secondary.intel-btn.intel-sabotage-btn', {
    type: 'button',
    onClick: () => { if (data && !sabBtn.disabled) onSabotage?.(data.regionId); },
  }, icon('flame', 15), sabLabelEl, sabCostEl);
  const sabHint = h('p.intel-hint.intel-sabotage-hint', {});
  const sabRow = h('div.intel-row.intel-sabotage-row', {}, sabBtn, pipsGroup);
  const sabBlock = h('div.intel-sabotage', {}, sabRow, sabHint);

  const reportEl = h('div.intel-report', {}, chipsEl, personalityEl, weakEl, notesEl, sabBlock);

  const el = h('div.intel-panel', { role: 'group', 'aria-label': 'Region intel', dataset: { state: 'unscouted' } },
    scoutRow, reportEl);

  // --- rendering -----------------------------------------------------------------------------
  function missing(cost) {
    const gap = Math.max(0, Math.ceil(cost - (data ? data.gold : 0)));
    return `Need ${shortNumber(gap)} more gold`;
  }

  // The cost sits INSIDE a button: rebuild it only when the value changed, or a refresh landing between a
  // player's pointerdown and pointerup would detach the node they pressed and swallow the click.
  function costNodes(target, cost) {
    const key = String(cost);
    if (target.dataset.cost === key && target.firstChild) return;
    target.dataset.cost = key;
    clear(target);
    if (cost === 0) {
      target.appendChild(h('span.intel-free', {}, 'free'));
    } else {
      target.appendChild(icon('coin', 13));
      target.appendChild(h('span.nums', {}, shortNumber(cost)));
    }
  }

  function renderChips(report) {
    clear(chipsEl);
    const weakType = report.weakPointType;
    let weakMarked = false;
    for (const g of report.groups) {
      const name = TYPE_NAMES[g.type] || g.type;
      const weak = !weakMarked && g.type === weakType && !g.neutral && g.type !== 'keep';
      if (weak) weakMarked = true;
      const bits = [];
      if (TYPE_ICONS[g.type]) bits.push(icon(TYPE_ICONS[g.type], 10));
      bits.push(h('span.intel-chip-label', {}, g.label));
      bits.push(h('strong.intel-chip-num.nums', {}, troops(g.garrison)));
      if (g.count > 1) bits.push(h('span.intel-chip-count.nums', {}, `×${g.count}`));
      const each = g.count > 1 ? ' each' : '';
      const chip = h('span.intel-chip', {
        role: 'listitem',
        dataset: { type: g.type, neutral: g.neutral ? '1' : '0', weak: weak ? '1' : '0' },
        title: `${g.count} ${g.neutral ? 'neutral ' : ''}${plural(g.count, name)}, ${troops(g.garrison)} troops${each}${weak ? ' (weak point)' : ''}`,
      }, ...bits);
      chipsEl.appendChild(chip);
    }
  }

  function renderReport(report, scoutedBy) {
    renderChips(report);

    clear(personalityEl);
    personalityEl.style.setProperty('--intel-faction', report.faction.color || '#9a927f');
    personalityEl.appendChild(h('span.intel-emblem', {}, icon(report.faction.emblem || 'flag', 15)));
    personalityEl.appendChild(h('span', { title: report.faction.name }, report.personalityLine));
    if (scoutedBy === 'watchtower') personalityEl.appendChild(h('span.intel-source.pill', { title: 'Scouted for free by a Watchtower next door' }, 'Watchtower'));

    clear(weakEl);
    weakEl.title = report.weakPointReason || '';
    weakEl.appendChild(h('span.intel-ring', { 'aria-hidden': 'true' }));
    weakEl.appendChild(h('span.intel-weak-label', {}, 'Weak point:'));
    weakEl.appendChild(h('strong', {}, (report.weakPointType || '?').replace(/^./, (c) => c.toUpperCase())));
    weakEl.appendChild(h('span.intel-gloss', {}, report.weakPointGloss || '')); // the words, explained in plain sight: touch has no hover

    clear(notesEl);
    notesEl.hidden = !(report.notes && report.notes.length);
    for (const note of report.notes || []) notesEl.appendChild(h('li.intel-note', {}, note));
  }

  function buildPips(max) {
    clear(pipsEl);
    pips.length = 0;
    for (let i = 0; i < max; i += 1) {
      const pip = h('span.intel-pip', {}, icon('flame', 14));
      pips.push(pip);
      pipsEl.appendChild(pip);
    }
  }

  function renderSabotage(d) {
    const step = pct(d.sabotageStep);
    const maxed = d.sabotage >= d.sabotageMax || d.sabotageCost == null;
    if (pips.length !== d.sabotageMax) buildPips(d.sabotageMax);
    pips.forEach((pip, i) => {
      const lit = i < d.sabotage;
      pip.dataset.lit = lit ? '1' : '0';
      // The newest pip flares once when a step is bought (never on first render or a region switch).
      if (lit && i === d.sabotage - 1 && d.sabotage > lastLevel && lastRegionId === d.regionId) {
        pip.classList.remove('is-flaring');
        void pip.offsetWidth;
        pip.classList.add('is-flaring');
      } else if (!lit) {
        pip.classList.remove('is-flaring');
      }
    });
    pipsEl.setAttribute('aria-label', `Sabotage ${d.sabotage} of ${d.sabotageMax}`);
    pipsGroup.title = d.sabotage > 0
      ? `Garrisons cut by ${pct(d.sabotageStep * d.sabotage)}%`
      : `Each step cuts starting garrisons by ${step}%`;
    cutEl.textContent = d.sabotage > 0 ? `−${pct(d.sabotageStep * d.sabotage)}%` : '';

    if (maxed) {
      sabBtn.disabled = true;
      sabLabelEl.textContent = 'Garrisons already weakened';
      clear(sabCostEl);
      sabHint.textContent = '';
      sabBtn.title = 'This region cannot be sabotaged further.';
      sabBtn.setAttribute('aria-label', 'Garrisons already weakened');
      el.dataset.sabotage = 'maxed';
      return;
    }
    const cost = d.sabotageCost;
    const poor = d.gold < cost;
    sabLabelEl.textContent = `Sabotage −${step}%`;
    costNodes(sabCostEl, cost);
    sabBtn.disabled = poor;
    sabHint.textContent = poor ? missing(cost) : '';
    sabBtn.title = poor
      ? `${missing(cost)} to sabotage.`
      : `Cut this region's starting garrisons by ${step}% more, for ${shortNumber(cost)} gold.`;
    sabBtn.setAttribute('aria-label', `Sabotage: cut starting garrisons by ${step}% for ${shortNumber(cost)} gold`
      + (poor ? `. ${missing(cost)}.` : ''));
    el.dataset.sabotage = poor ? 'poor' : 'ready';
  }

  function renderScoutRow(d) {
    const poor = d.gold < d.scoutCost;
    costNodes(scoutCostEl, d.scoutCost);
    scoutBtn.disabled = poor;
    scoutHint.textContent = poor ? missing(d.scoutCost) : 'See garrisons and weak point';
    scoutHint.dataset.tone = poor ? 'poor' : 'calm';
    const cost = d.scoutCost === 0 ? 'free' : `${shortNumber(d.scoutCost)} gold`;
    scoutBtn.title = poor ? `${missing(d.scoutCost)} to scout.` : `Scout this region: ${cost}.`;
    scoutBtn.setAttribute('aria-label', `Scout this region for ${cost}${poor ? `. ${missing(d.scoutCost)}.` : ''}`);
  }

  /** @param {IntelPanelData} next */
  function update(next) {
    if (!next) return;
    data = next;
    const scouted = !!next.scouted && !!next.report;

    if (scouted) {
      const r = next.report;
      const sig = [next.regionId, r.total.toFixed(2), r.weakPoint, r.sabotage, r.groups.length,
        r.notes.join('|'), r.personalityLine, next.scoutedBy || ''].join('#');
      if (sig !== lastReportSig) {
        lastReportSig = sig;
        renderReport(r, next.scoutedBy);
      }
      renderSabotage(next);
      // Slide the report in the moment a scout completes, not when the card merely opens on a scouted region.
      if (!wasScouted && lastRegionId === next.regionId && lastRegionId != null) {
        el.classList.remove('is-revealing');
        void el.offsetWidth;
        el.classList.add('is-revealing');
      }
    } else {
      lastReportSig = null;
      el.classList.remove('is-revealing');
      renderScoutRow(next);
    }

    el.dataset.state = scouted ? 'scouted' : 'unscouted';
    scoutRow.hidden = scouted;
    reportEl.hidden = !scouted;

    wasScouted = scouted;
    lastRegionId = next.regionId;
    lastLevel = scouted ? next.sabotage : 0;
  }

  function destroy() {
    data = null;
    clear(el);
  }

  return { el, update, destroy };
}
