// The Codex (PLAN-PHASE8 §8B): look anything up. A dialog with the topic list (grouped, locked topics greyed "Not yet discovered") and one page
// per topic: its icon, a few plain sentences and the key numbers. Pure UI: the pages arrive as data (game/app/codexTopics.js builds them from config),
// this file imports nothing from the game. Wide screens show the list and the page side by side; below 640 px the list and the page take turns (a
// Back button returns to the list). Keyboard: Tab through the topics, Enter opens one, the arrows move in the list, Escape closes (dialogs.js).
//
//   const codex = createCodex({ onClose, onRevisitHints });
//   document.body.appendChild(codex.el);
//   codex.open(data, topicId?)   // data = codexData(state); topicId = the page to show first (a panel's "?")
//   codex.close();  codex.isOpen()
import { h } from './dom.js';
import { icon } from './icons.js';
import { watchDialog } from './dialogs.js';

let seq = 0;

/**
 * @param {{ onClose?: () => void, onRevisitHints?: (on: boolean) => void }} [callbacks]
 */
export function createCodex({ onClose, onRevisitHints } = {}) {
  const uid = ++seq;
  const titleId = `codex-title-${uid}`;
  const listEl = h('nav.codex-list', { 'aria-label': 'Codex topics' });
  const pageTitle = h('h3.codex-page-title', { id: `codex-page-${uid}`, tabIndex: -1 }, '');
  const pageIcon = h('span.codex-page-icon', { 'aria-hidden': 'true' });
  const pageText = h('div.codex-page-text', {});
  const pageNums = h('dl.codex-numbers', {});
  const back = h('button.btn.btn-secondary.codex-back', { type: 'button', onClick: () => showList() }, '‹ All topics');
  const page = h('article.codex-page', { 'aria-labelledby': `codex-page-${uid}` }, back, h('div.codex-page-head', {}, pageIcon, pageTitle), pageText, pageNums);
  const count = h('span.codex-count', {}, '');
  const revisitLabelId = `codex-revisit-${uid}`;
  const revisit = h('button.settings-toggle.codex-revisit', {
    type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-labelledby': revisitLabelId,
    onClick: () => { const on = revisit.getAttribute('aria-checked') !== 'true'; setRevisit(on); onRevisitHints?.(on); },
  }, h('span.settings-toggle-knob', {}));
  const el = h('div.codex.glass-panel', { hidden: true },
    h('div.codex-header', {},
      h('h2.codex-title', { id: titleId }, icon('scroll', 20), 'Codex'),
      count,
      h('button.btn-icon.codex-close', { type: 'button', onClick: () => close(), 'aria-label': 'Close the Codex' }, icon('close', 16)),
    ),
    h('div.codex-main', {}, listEl, page),
    h('div.codex-foot', {},
      h('span.codex-revisit-label', { id: revisitLabelId }, 'Seen it before? Revisit the tutorial hints'),
      revisit),
  );
  watchDialog(el, { titleEl: el.querySelector('.codex-title'), onEscape: () => close(), initialFocus: () => (el.classList.contains('is-page') ? pageTitle : listEl.querySelector('[aria-current="true"]') || listEl.querySelector('button')) });

  let data = null;
  let current = null;
  const buttons = new Map();

  function setRevisit(on) { revisit.classList.toggle('is-on', !!on); revisit.setAttribute('aria-checked', String(!!on)); }

  function build() {
    buttons.clear();
    const kids = [];
    for (const g of data.groups) {
      const items = g.topics.map((t) => {
        const b = h('button.codex-topic', {
          type: 'button', 'data-topic': t.id, 'aria-current': 'false',
          'aria-label': t.locked ? `${t.title}: not yet discovered` : t.title,
          onClick: () => select(t.id, true),
        }, icon(t.icon, 18), h('span.codex-topic-name', {}, t.locked ? 'Not yet discovered' : t.title));
        b.classList.toggle('is-locked', t.locked);
        buttons.set(t.id, b);
        return h('li', {}, b);
      });
      kids.push(h('section.codex-group', {}, h('h3.codex-group-title', {}, g.title), h('ul', {}, ...items)));
    }
    listEl.replaceChildren(...kids);
    count.textContent = `${data.unlocked} of ${data.total} discovered`;
  }

  function topicOf(id) {
    for (const g of data.groups) for (const t of g.topics) if (t.id === id) return t;
    return null;
  }

  function select(id, fromList) {
    const t = topicOf(id) || data.groups[0].topics[0];
    current = t.id;
    for (const [k, b] of buttons) b.setAttribute('aria-current', String(k === t.id));
    pageIcon.replaceChildren(icon(t.icon, 34));
    el.dataset.topic = t.id;
    page.classList.toggle('is-locked', t.locked);
    if (t.locked) {
      pageTitle.textContent = 'Not yet discovered';
      pageText.replaceChildren(h('p', {}, 'You have not met this part of the realm yet. Keep playing: this page fills in when you do.'));
      pageNums.replaceChildren();
    } else {
      pageTitle.textContent = t.title;
      pageText.replaceChildren(...t.lines.map((l) => h('p', {}, l)));
      pageNums.replaceChildren(...t.numbers.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    }
    pageNums.hidden = t.locked || !t.numbers.length;
    el.classList.add('is-page');
    if (fromList) pageTitle.focus({ preventScroll: true });
    page.scrollTop = 0;
  }

  function showList() {
    el.classList.remove('is-page');
    const b = current && buttons.get(current);
    if (b) b.focus({ preventScroll: true });
  }

  // arrows move through the list (Home / End to its ends)
  listEl.addEventListener('keydown', (e) => {
    const all = [...buttons.values()];
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    let j = -1;
    if (e.key === 'ArrowDown') j = Math.min(all.length - 1, i + 1);
    else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = all.length - 1;
    if (j < 0) return;
    e.preventDefault();
    all[j].focus();
  });

  /** @param {object} d codexData(state) @param {string} [topicId] @param {{ revisit?: boolean }} [opts] */
  function open(d, topicId, opts = {}) {
    data = d;
    build();
    setRevisit(!!opts.revisit);
    select(topicId || (current && topicOf(current) ? current : data.groups[0].topics[0].id), false);
    if (!topicId) el.classList.remove('is-page'); // from Settings: the list first (a phone shows one at a time; wide screens show both)
    el.hidden = false;
  }

  function close() {
    if (el.hidden) return;
    el.hidden = true;
    onClose?.();
  }

  return { el, open, close, isOpen: () => !el.hidden, get topic() { return current; }, setRevisit, destroy: () => el.remove() };
}
