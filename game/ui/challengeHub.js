// The Challenges hub (PLAN-PHASE9 §9A-§9C): Today's Daily, the Scenarios with their stars, the calendar of past Dailies (practice) and the
// banner styles. Pure UI: everything arrives as plain data (game/app/challengeKit.js builds it), callbacks go out. Loaded on first use.
//
//   const hub = createChallengeHub({ onPlayDaily, onResume, onPlayScenario, onPractice, onBanner, onClose });
//   document.body.appendChild(hub.el);  hub.open(data, tab?);  hub.update(data);  hub.close();
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { watchDialog } from './dialogs.js';
import { generalEmblem } from './generalsPanel.js';

const TABS = [['daily', 'Daily', 'sun'], ['scenarios', 'Scenarios', 'castle'], ['calendar', 'Calendar', 'clock'], ['banners', 'Banners', 'banner']];
let seq = 0;

const crownRow = (n, max = 3) => h('span.ch-crowns', { 'aria-label': `${n} of ${max}` },
  ...Array.from({ length: max }, (_, i) => h(`span.ch-crown${i < n ? '.is-on' : ''}`, { 'aria-hidden': 'true' }, icon('crown', 14))));
const starRow = (n, max = 3) => h('span.ch-stars', { 'aria-label': `${n} of ${max} stars` },
  ...Array.from({ length: max }, (_, i) => h(`span.ch-star${i < n ? '.is-on' : ''}`, { 'aria-hidden': 'true' }, icon('star', 15))));

/** @param {{ onPlayDaily?, onResume?, onPlayScenario?: (id) => void, onPractice?: (date) => void, onBanner?: (id) => void, onClose? }} cb */
export function createChallengeHub(cb = {}) {
  const uid = ++seq;
  const tabButtons = new Map();
  const panels = new Map();
  const tablist = h('div.ch-tabs', { role: 'tablist', 'aria-label': 'Challenges' });
  for (const [id, label, ic] of TABS) {
    const b = h('button.ch-tab', { type: 'button', role: 'tab', id: `ch-tab-${uid}-${id}`, 'aria-controls': `ch-panel-${uid}-${id}`, 'aria-selected': 'false', tabIndex: -1, 'data-tab': id,
      onClick: () => select(id, true) }, icon(ic, 16), h('span', {}, label));
    tabButtons.set(id, b);
    tablist.appendChild(b);
    panels.set(id, h('div.ch-panel.scroll-y', { role: 'tabpanel', id: `ch-panel-${uid}-${id}`, 'aria-labelledby': `ch-tab-${uid}-${id}`, tabIndex: 0, hidden: true }));
  }
  tablist.addEventListener('keydown', (e) => {
    const ids = TABS.map((t) => t[0]);
    const i = ids.indexOf(current);
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % ids.length;
    else if (e.key === 'ArrowLeft') j = (i + ids.length - 1) % ids.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = ids.length - 1;
    if (j < 0) return;
    e.preventDefault();
    select(ids[j], true);
  });
  const streakEl = h('span.ch-streak', {}, '');
  const el = h('div.ch-hub.glass-panel', { hidden: true },
    h('div.ch-header', {},
      h('h2.ch-title', {}, icon('trophy', 20), 'Challenges'),
      streakEl,
      h('button.btn-icon.ch-close', { type: 'button', onClick: () => close(), 'aria-label': 'Close the Challenges' }, icon('close', 16))),
    tablist,
    h('div.ch-panels', {}, ...panels.values()));
  watchDialog(el, { titleEl: el.querySelector('.ch-title'), onEscape: () => close(), initialFocus: () => tabButtons.get(current) });

  let current = 'daily';
  let data = null;

  function select(id, focus) {
    current = id;
    for (const [k, b] of tabButtons) {
      const on = k === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      panels.get(k).hidden = !on;
    }
    if (focus) tabButtons.get(id).focus({ preventScroll: true });
  }

  function renderDaily(d) {
    const p = panels.get('daily');
    clear(p);
    if (!d) return;
    const facts = h('div.ch-facts', {},
      d.edict ? h('div.ch-fact', { title: `${d.edict.upside} ${d.edict.cost}` }, icon(d.edict.icon, 18), h('span', {}, h('b', {}, 'Edict: '), d.edict.name, h('small', {}, ` ${d.edict.upside}`), h('small.ch-cost', {}, ` Price: ${d.edict.cost}`))) : h('div.ch-fact', {}, icon('scroll', 18), h('span', {}, h('b', {}, 'Edict: '), 'Standard rules')),
      ...d.boons.map((b) => h('div.ch-fact', {}, icon(b.icon, 18), h('span', {}, h('b', {}, 'Boon: '), b.name, h('small', {}, ` ${b.text}`)))),
      d.relic ? h('div.ch-fact', {}, icon(d.relic.icon, 18), h('span', {}, h('b', {}, 'Relic: '), d.relic.name, h('small', {}, ` ${d.relic.text}`))) : null,
      h('div.ch-fact', {}, generalEmblem(d.general.kind, 22), h('span', {}, h('b', {}, 'General: '), d.general.text)));
    const best = h('div.ch-best', {},
      h('div.ch-best-cell', {}, h('span.ch-best-label', {}, 'Your best'), h('span.ch-best-value.nums', {}, d.bestText || '—'), d.bestCrowns != null ? crownRow(d.bestCrowns) : null),
      h('div.ch-best-cell', {}, h('span.ch-best-label', {}, 'First try'), h('span.ch-best-value.nums', {}, d.firstText || '—')),
      h('div.ch-best-cell', {}, h('span.ch-best-label', {}, 'Attempts'), h('span.ch-best-value.nums', {}, String(d.attempts || 0))));
    const play = h('button.btn.btn-primary.btn-block.ch-play', { type: 'button', 'data-autofocus': '', onClick: () => cb.onPlayDaily?.() }, icon('swords', 18), d.playLabel || 'Play');
    const resume = d.resume ? h('button.btn.btn-secondary.btn-block.ch-resume', { type: 'button', onClick: () => cb.onResume?.() }, icon('play', 16), d.resume) : null;
    p.append(...[
      h('div.ch-daily-head', {}, h('span.ch-daily-icon', { 'aria-hidden': 'true' }, icon('sun', 30)),
        h('div', {}, h('h3.ch-daily-name', {}, d.name), h('p.ch-daily-date', {}, d.dateLabel))),
      h('p.ch-goal', {}, icon('flag', 16), h('span', {}, d.goalText)),
      facts, best,
      h('p.ch-reward', {}, icon('laurel', 15), d.rewardText),
      resume, play,
      h('p.ch-note', {}, 'Everyone gets the same Daily today. It never touches your realm; play it as often as you like, your best time counts.')].filter(Boolean));
  }

  function renderScenarios(list, totals) {
    const p = panels.get('scenarios');
    clear(p);
    p.appendChild(h('p.ch-note', {}, `Stars: ${totals.stars} of ${totals.max}. ${totals.rewardText}`));
    const ul = h('ul.ch-scen-list', {});
    for (const s of list) {
      const btn = h('button.btn.ch-scen-play', { type: 'button', disabled: !s.unlocked, 'data-scenario': s.id, onClick: () => cb.onPlayScenario?.(s.id),
        'aria-label': s.unlocked ? `Play ${s.name}` : `${s.name}: locked` }, s.unlocked ? icon('swords', 16) : icon('lock', 16), s.unlocked ? 'Play' : 'Locked');
      ul.appendChild(h(`li.ch-scen${s.unlocked ? '' : '.is-locked'}`, { 'data-scenario': s.id },
        h('span.ch-scen-icon', { 'aria-hidden': 'true' }, icon(s.icon, 26)),
        h('div.ch-scen-body', {},
          h('div.ch-scen-top', {}, h('h3.ch-scen-name', {}, s.name), starRow(s.stars)),
          h('p.ch-scen-idea', {}, s.idea, s.bestText ? h('span.ch-scen-best.nums', {}, ` · best ${s.bestText}`) : null),
          h('p.ch-scen-blurb', {}, s.unlocked ? s.blurb : s.lockText),
          s.unlocked ? h('ol.ch-scen-marks', {}, ...s.marks.map((m, i) => h(`li${i < s.stars ? '.is-on' : ''}`, {}, icon('star', 12), m))) : null),
        btn));
    }
    p.appendChild(ul);
  }

  function renderCalendar(days) {
    const p = panels.get('calendar');
    clear(p);
    p.appendChild(h('p.ch-note', {}, 'Past Dailies play as practice: they keep your best time but never count for the streak.'));
    const grid = h('ul.ch-cal', {});
    for (const d of days) {
      const state = d.met ? (d.onDay ? 'onday' : 'met') : d.played ? 'played' : 'none';
      const label = `${d.label}, Daily #${d.number}: ${d.met ? `best ${d.bestText}${d.onDay ? ', on the day' : ''}` : d.played ? `${d.attempts} tries, not completed` : 'not played'}${d.today ? ' (today)' : ''}`;
      grid.appendChild(h(`li.ch-day.is-${state}${d.today ? '.is-today' : ''}`, {},
        h('button.ch-day-btn', { type: 'button', 'data-date': String(d.date), 'aria-label': label, title: label,
          onClick: () => (d.today ? cb.onPlayDaily?.() : cb.onPractice?.(d.date)) },
        h('span.ch-day-label', {}, d.short),
        h('span.ch-day-num.nums', {}, `#${d.number}`),
        h('span.ch-day-best.nums', {}, d.met ? d.bestText : d.played ? '·' : ''))));
    }
    p.appendChild(grid);
  }

  function renderBanners(list) {
    const p = panels.get('banners');
    clear(p);
    p.appendChild(h('p.ch-note', {}, 'Your realm’s banner style, on every flag you own. Purely for show; also in Settings.'));
    const group = h('div.settings-banners.ch-banners', { role: 'radiogroup', 'aria-label': 'Banner style' });
    for (const b of list) {
      const opt = h('button.settings-banner', { type: 'button', role: 'radio', 'aria-checked': String(!!b.selected), 'aria-disabled': String(!b.unlocked), 'data-banner': b.id,
        onClick: () => { if (b.unlocked && !b.selected) cb.onBanner?.(b.id); } },
      h('span.settings-banner-swatch', { 'aria-hidden': 'true' }, h('span.settings-banner-cloth')),
      h('span.settings-banner-name', {}, b.name),
      h('span.settings-banner-rule', {}, b.unlocked ? (b.selected ? 'In use' : 'Unlocked') : b.text),
      b.unlocked ? null : icon('lock', 14));
      opt.classList.toggle('is-locked', !b.unlocked);
      opt.classList.toggle('is-selected', !!b.selected);
      group.appendChild(opt);
    }
    p.appendChild(group);
  }

  /** @param {object} next the hub's data (challengeKit.hubData) */
  function update(next) {
    if (!next) return;
    data = next;
    streakEl.textContent = data.streakText || '';
    renderDaily(data.daily);
    renderScenarios(data.scenarios || [], data.totals || { stars: 0, max: 18, rewardText: '' });
    renderCalendar(data.calendar || []);
    renderBanners(data.banners || []);
  }

  function open(next, tab) {
    update(next);
    select(tab && tabButtons.has(tab) ? tab : current, false);
    el.hidden = false;
  }
  function close() {
    if (el.hidden) return;
    el.hidden = true;
    cb.onClose?.();
  }
  return { el, open, update, close, isOpen: () => !el.hidden, select: (id) => select(id, false), get tab() { return current; } };
}
