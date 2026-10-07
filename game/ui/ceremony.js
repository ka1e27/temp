// The founding ceremony (PLAN-PHASE5, Integration): replaces the old "Found a new dynasty?" confirm with a five-page stepper that fits a 360 px phone.
//   1. "The House of {name} endures": the dynasty's summary, the stars and Legacy points it earns (and the last chance to save a picture of the map)
//   2. the Legacy tree (spend)
//   3. the Edict cards (choose one; the first founding has none)
//   4. the Challenge toggles, with a short "harder" warning
//   5. "Found the House of {name}": what was chosen, and the button that leads to the new continent
// The painted map stays visible behind a dark veil; gold-on-dark panel, Cinzel headings. Built once and patched (THE CLICK RULE). Browser only: the
// scene's glue (app/dynasty.js) builds the data and owns every rule; this file only remembers which Edict and Challenges are ticked until "Found".
import { h } from './dom.js';
import { icon } from './icons.js';
import { watchDialog } from './dialogs.js';
import { createLegacyTree } from './legacyTree.js';
import { createSaveMapButton } from './saveMapButton.js';

/**
 * @typedef {Object} EdictView
 * @property {string} id
 * @property {string} name
 * @property {string} icon      an icons.js name (an Edict crest)
 * @property {string} upside
 * @property {string} cost
 *
 * @typedef {Object} ChallengeView
 * @property {string} id
 * @property {string} name
 * @property {string} icon
 * @property {string} rule
 *
 * @typedef {Object} CeremonyData
 * @property {string} house                 "Thistlefield": the House's name
 * @property {number} level                 the dynasty being completed (its roman numeral is shown)
 * @property {{ label: string, value: string, icon: string }[]} stats
 * @property {number} stars                 stars this founding earns
 * @property {number} starsTotal            stars after it
 * @property {string} [starText]            what one star adds
 * @property {number} legacyEarned          Legacy points this founding grants
 * @property {string} [legacyNote]          "+50% for 1 Challenge completed"
 * @property {import('./legacyTree.js').LegacyView} legacy
 * @property {EdictView[]} edicts           3 or 4; empty = no Edict this time
 * @property {string} [edictNote]           a line under the cards ("Heralds: a fourth choice")
 * @property {ChallengeView[]} challenges
 * @property {string} challengeBonus        "+50% Legacy points at the next founding, each"
 * @property {string} challengeWarning      the "harder" words
 * @property {{ label: string, busyLabel: string, busy: boolean, hint: string }} [save]
 */

const PAGES = [
  { id: 'summary', short: 'Dynasty' },
  { id: 'legacy', short: 'Legacy' },
  { id: 'edict', short: 'Edict' },
  { id: 'challenges', short: 'Challenges' },
  { id: 'found', short: 'Found' },
];
const put = (node, t) => { if (node.textContent !== t) node.textContent = t; };
const setAttr = (node, k, v) => { if (node.getAttribute(k) !== v) node.setAttribute(k, v); };
export function toRoman(n) {
  const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  let v = Math.max(1, Math.round(n));
  for (const [val, sym] of table) while (v >= val) { out += sym; v -= val; }
  return out;
}

/**
 * @param {{ onBuyLegacy?: (id: string) => void, onFound?: (choice: { edict: string|null, challenges: string[] }) => void, onClose?: () => void,
 *   onSaveMap?: () => void, onPage?: (pageId: string) => void }} [callbacks]
 */
export function createCeremony({ onBuyLegacy, onFound, onClose, onSaveMap, onPage, onPick } = {}) {
  let data = null;
  let page = 0;
  let edict = null;
  const challenges = new Set();
  let crownPick = false; // PLAN-PHASE13: "Seek the Crown of Ages" chosen on the last page (dynasty 7+)
  let ascension = 0; // PLAN-PHASE13 §13C: the Ascension level picked on the Challenges page (after the ending)

  // --- the stepper -------------------------------------------------------------------------------------------------------------------------
  const steps = PAGES.map((p, i) => h('li.ceremony-step', { 'data-page': p.id }, h('span.ceremony-step-dot.nums', { 'aria-hidden': 'true' }, String(i + 1)), h('span.ceremony-step-word', {}, p.short)));
  const stepper = h('ol.ceremony-steps', { 'aria-label': 'Founding steps' }, ...steps);
  const titleEl = h('h2.ceremony-title', {}, '');
  const kickerEl = h('p.ceremony-kicker', {}, '');
  const closeBtn = h('button.btn-icon.ceremony-close', { type: 'button', onClick: () => onClose?.(), 'aria-label': 'Not yet: close' }, icon('close', 16));

  // --- page 1: the summary ----------------------------------------------------------------------------------------------------------------
  const statsGrid = h('div.ceremony-stats');
  const starsNum = h('span.nums', {}, '+0');
  const starsLine = h('span.ceremony-earn-sub', {}, '');
  const legacyNum = h('span.nums', {}, '+0');
  const legacyLine = h('span.ceremony-earn-sub', {}, '');
  const earnEl = h('div.ceremony-earn', {},
    h('div.ceremony-earn-item.is-stars', {}, icon('star', 26), h('div', {}, h('div.ceremony-earn-big', {}, starsNum, h('span', {}, ' stars')), starsLine)),
    h('div.ceremony-earn-item.is-legacy', {}, icon('tree', 26), h('div', {}, h('div.ceremony-earn-big', {}, legacyNum, h('span', {}, ' Legacy')), legacyLine)));
  const saveBtn = createSaveMapButton({ onSave: () => onSaveMap?.() });
  const saveNote = h('p.keepsake-save-note', {}, '');
  const resetNote = h('p.ceremony-note', {}, 'Gold, upgrades and the map reset. Stars, Legacy, Deeds, your Generals and your lifetime records carry over forever.');
  const voyageEl = h('p.ceremony-voyage', {}, icon('seaLane', 18), h('span', {}, '')); // PLAN-PHASE12: "The House of X sets sail…"
  voyageEl.hidden = true;
  const pageSummary = h('section.ceremony-page', { 'data-page': 'summary' }, earnEl, voyageEl, statsGrid, resetNote,
    h('div.keepsake-save-box.ceremony-save', {}, saveNote, saveBtn.el, saveBtn.statusEl));

  // --- page 2: the Legacy tree ------------------------------------------------------------------------------------------------------------
  const tree = createLegacyTree({ onBuy: (id) => onBuyLegacy?.(id) });
  const pageLegacy = h('section.ceremony-page', { 'data-page': 'legacy' },
    h('p.ceremony-lead', {}, 'Spend Legacy points on lasting unlocks. Nodes are kept forever; each needs the one above it. You can also spend later, from the Realm panel.'), tree.el);

  // --- page 3: the Edicts -----------------------------------------------------------------------------------------------------------------
  const edictList = h('div.edict-cards', { role: 'radiogroup', 'aria-label': 'Choose an Edict' });
  const edictNote = h('p.ceremony-note', {}, '');
  const edictNone = h('p.ceremony-lead', {}, 'No Edict this time: the next dynasty keeps the standard rules.');
  // the tutorial's first-ceremony hint (step D1) is drawn here, inside the dialog (the coach layer sits under dialogs)
  const hintText = h('span', {}, '');
  const hintEl = h('p.ceremony-hint', { role: 'note' }, icon('scroll', 16), hintText);
  hintEl.hidden = true;
  const pageEdict = h('section.ceremony-page', { 'data-page': 'edict' },
    h('p.ceremony-lead.edict-lead', {}, 'An Edict changes the rules for the whole dynasty: a real gain, at a real price. Choose one.'), hintEl, edictList, edictNote, edictNone);
  const edictCards = new Map();

  // --- page 4: the Challenges -------------------------------------------------------------------------------------------------------------
  const challengeList = h('div.challenge-toggles', { role: 'group', 'aria-label': 'Challenges' });
  const challengeBonus = h('p.ceremony-lead', {}, '');
  const warningText = h('span', {}, '');
  const warningEl = h('p.challenge-warning', { role: 'note' }, icon('flame', 16), warningText);
  // PLAN-PHASE13 §13C: the Ascension picker, once the Crown of Ages has been won (levels up to one above the highest cleared)
  const ascLevels = h('div.ascension-levels', { role: 'radiogroup', 'aria-label': 'Ascension level' });
  const ascTitle = h('span.ascension-detail-title', {}, '');
  const ascBonus = h('span.ascension-detail-bonus', {}, '');
  const ascAdded = h('p.ascension-detail-added', {}, '');
  const ascAll = h('ul.ascension-detail-all');
  const ascNote = h('p.ceremony-note', {}, '');
  const ascEl = h('section.ascension-pick', { 'aria-label': 'Ascension' },
    h('h3.ascension-pick-title', {}, icon('ascension', 18), h('span', {}, 'Ascension')), ascNote, ascLevels,
    h('div.ascension-detail', { 'aria-live': 'polite' }, h('div.ascension-detail-head', {}, ascTitle, ascBonus), ascAdded, ascAll));
  ascEl.hidden = true;
  const ascButtons = [];
  const pageChallenges = h('section.ceremony-page', { 'data-page': 'challenges' }, challengeBonus, challengeList, warningEl, ascEl);
  const challengeEls = new Map();

  // --- page 5: found it ---------------------------------------------------------------------------------------------------------------------
  const recap = h('ul.ceremony-recap');
  const foundBtnLabel = h('span', {}, 'Found the House');
  const foundBtn = h('button.btn.btn-primary.btn-block.ceremony-found', { type: 'button', onClick: () => found() }, icon('crown', 18), foundBtnLabel);
  // PLAN-PHASE13 §13A: at a dynasty 7+ founding, a distinct final choice in a regal frame: an ordinary new continent, or the Crown of Ages
  const crownWarn = h('p.crown-choice-warning', { role: 'note' }, icon('flame', 14), h('span', {}, ''));
  const crownLines = h('ul.crown-choice-lines');
  const pathNew = h('button.crown-path.is-new', { type: 'button', role: 'radio', 'data-path': 'new', onClick: () => pickCrown(false) },
    icon('map', 26), h('span.crown-path-text', {}, h('span.crown-path-name', {}, 'A new continent'), h('span.crown-path-line', {}, 'Found another dynasty, as before.')));
  const pathCrown = h('button.crown-path.is-crown', { type: 'button', role: 'radio', 'data-path': 'crown', onClick: () => pickCrown(true) },
    h('span.crown-path-emblem', { 'aria-hidden': 'true' }, icon('crownChains', 34)),
    h('span.crown-path-text', {}, h('span.crown-path-name', {}, 'Seek the Crown of Ages'), h('span.crown-path-line', {}, '')));
  for (const b of [pathNew, pathCrown]) b.addEventListener('keydown', (ev) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(ev.key)) return;
    pickCrown(!crownPick); (crownPick ? pathCrown : pathNew).focus(); ev.preventDefault();
  });
  const crownEl = h('section.crown-choice', { 'aria-label': 'The final choice' },
    h('p.crown-choice-kicker', {}, 'A final choice'), h('div.crown-paths', { role: 'radiogroup', 'aria-label': 'Where the House goes' }, pathNew, pathCrown), crownLines, crownWarn);
  crownEl.hidden = true;
  const foundLead = h('p.ceremony-lead', {}, 'A new continent awaits, with tougher enemies. Your House goes with you.');
  const pageFound = h('section.ceremony-page', { 'data-page': 'found' }, foundLead, crownEl, recap, foundBtn);

  const pages = [pageSummary, pageLegacy, pageEdict, pageChallenges, pageFound];
  const bodyEl = h('div.ceremony-body.scroll-y', {}, ...pages);

  // --- the footer: Back / Next ---------------------------------------------------------------------------------------------------------------
  const backBtn = h('button.btn.btn-secondary.ceremony-back', { type: 'button', onClick: () => go(page - 1) }, 'Back');
  const nextLabel = h('span', {}, 'Next');
  const nextBtn = h('button.btn.btn-primary.ceremony-next', { type: 'button', onClick: () => next() }, nextLabel);
  const nextHint = h('span.ceremony-next-hint', { role: 'status' }, '');
  const footer = h('div.ceremony-footer', {}, backBtn, nextHint, nextBtn);

  const panel = h('div.ceremony-panel', { role: 'dialog' },
    h('div.ceremony-header', {}, h('div.ceremony-heading', {}, kickerEl, titleEl), closeBtn),
    stepper, bodyEl, footer);
  const el = h('div.ceremony', {}, h('div.ceremony-veil', { 'aria-hidden': 'true' }), panel);
  el.hidden = true;
  watchDialog(el, { labelEl: panel, titleEl, onEscape: () => onClose?.(), initialFocus: () => nextBtn });

  function next() {
    if (page === 2 && data && data.edicts.length && !edict) {
      put(nextHint, 'Choose an Edict first');
      edictList.classList.remove('is-nudge'); void edictList.offsetWidth; edictList.classList.add('is-nudge');
      return;
    }
    go(page + 1);
  }

  function go(i) {
    const p = Math.max(0, Math.min(PAGES.length - 1, i));
    page = p;
    render();
    bodyEl.scrollTop = 0;
    onPage?.(PAGES[p].id);
    // focus follows the page for a keyboard (the panel heading is announced; the Next button keeps the rhythm)
    const target = p === PAGES.length - 1 ? foundBtn : nextBtn;
    if (document.activeElement && el.contains(document.activeElement) && document.activeElement !== target) target.focus({ preventScroll: true });
  }

  function found() {
    if (!data) return;
    if (data.edicts.length && !edict) { go(2); return; }
    onFound?.({ edict: data.edicts.length ? edict : null, challenges: [...challenges], crownOfAges: !!(data.crown && crownPick), ascension: data.ascension ? ascension : 0 });
  }

  function titleFor(id) {
    const house = data ? data.house : '';
    switch (id) {
      case 'summary': return `The House of ${house} endures`;
      case 'legacy': return 'The Legacy';
      case 'edict': return 'Proclaim an Edict';
      case 'challenges': return 'Raise the stakes';
      default: return data && data.crown && crownPick ? 'Seek the Crown of Ages' : `Found the House of ${house}`;
    }
  }

  function render() {
    PAGES.forEach((p, i) => {
      pages[i].hidden = i !== page;
      steps[i].classList.toggle('is-current', i === page);
      steps[i].classList.toggle('is-done', i < page);
      if (i === page) setAttr(steps[i], 'aria-current', 'step'); else steps[i].removeAttribute('aria-current');
    });
    el.dataset.page = PAGES[page].id;
    put(titleEl, titleFor(PAGES[page].id));
    put(kickerEl, data ? `Dynasty ${toRoman(data.level)} · step ${page + 1} of ${PAGES.length}` : '');
    backBtn.hidden = page === 0;
    nextBtn.hidden = page === PAGES.length - 1;
    put(nextLabel, page === PAGES.length - 2 ? 'Review' : 'Next');
    const needEdict = page === 2 && data && data.edicts.length && !edict;
    nextBtn.classList.toggle('is-waiting', !!needEdict);
    if (!needEdict) put(nextHint, '');
    renderRecap();
  }

  function renderRecap() {
    if (!data) return;
    put(foundBtnLabel, data.crown && crownPick ? 'Seek the Crown of Ages' : `Found the House of ${data.house}`);
    foundBtn.classList.toggle('is-crown', !!(data.crown && crownPick));
    const e = data.edicts.find((x) => x.id === edict);
    const items = [
      [icon('star', 16), `Dynasty ${toRoman(data.level + 1)}: ${data.starsTotal} stars`],
      e ? [icon(e.icon, 16), `Edict: ${e.name}`] : [icon('scroll', 16), 'No Edict: the standard rules'],
      challenges.size
        ? [icon('laurel', 16), `Challenges: ${data.challenges.filter((c) => challenges.has(c.id)).map((c) => c.name).join(', ')}`]
        : [icon('laurel', 16), 'No Challenges'],
      [icon('tree', 16), `${data.legacy.available} Legacy point${data.legacy.available === 1 ? '' : 's'} left to spend`],
    ];
    if (data.voyage && !(data.crown && crownPick)) items.unshift([icon('seaLane', 16), data.voyage]);
    if (data.crown && crownPick) items.unshift([icon('crownChains', 16), data.crown.recap]);
    if (data.ascension && ascension) items.push([icon('ascension', 16), `Ascension ${ascension}: ${data.ascension.levels.find((x) => x.level === ascension)?.legacy || ''}`]);
    recap.replaceChildren(...items.map(([ic, t]) => h('li', {}, ic, h('span', {}, t))));
  }

  function buildEdict(e) {
    const name = h('span.edict-name', {}, '');
    const up = h('span.edict-up', {}, '');
    const cost = h('span.edict-cost', {}, '');
    const crest = h('span.edict-crest', { 'aria-hidden': 'true' });
    const card = h('button.edict-card', { type: 'button', role: 'radio', 'data-edict': e.id, onClick: () => pickEdict(e.id) },
      crest,
      h('span.edict-text', {}, name,
        h('span.edict-line.is-up', {}, icon('star', 12), up),
        h('span.edict-line.is-cost', {}, icon('flame', 12), cost)));
    card.addEventListener('keydown', (ev) => {
      const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
      if (!(ev.key in keys)) return;
      const ids = data.edicts.map((x) => x.id);
      const i = ids.indexOf(e.id);
      const nid = ids[(i + keys[ev.key] + ids.length) % ids.length];
      pickEdict(nid);
      edictCards.get(nid).card.focus();
      ev.preventDefault();
    });
    const rec = { card, name, up, cost, crest, iconName: '' };
    edictCards.set(e.id, rec);
    return rec;
  }

  function pickEdict(id) {
    edict = id;
    for (const [eid, r] of edictCards) {
      const on = eid === id;
      r.card.classList.toggle('is-picked', on);
      setAttr(r.card, 'aria-checked', on ? 'true' : 'false');
      r.card.tabIndex = on || (!edict && eid === data.edicts[0].id) ? 0 : -1;
    }
    put(nextHint, '');
    nextBtn.classList.remove('is-waiting');
    hintEl.hidden = true;
    renderRecap();
    onPick?.(id);
  }

  function buildChallenge(c) {
    const box = h('input.challenge-input', { type: 'checkbox', onChange: () => { if (box.checked) challenges.add(c.id); else challenges.delete(c.id); syncChallenges(); } });
    const name = h('span.challenge-name', {}, '');
    const rule = h('span.challenge-rule', {}, '');
    const badge = h('span.challenge-badge', { 'aria-hidden': 'true' }, icon('laurel', 34), h('span.challenge-badge-mark', {}, icon(c.icon, 14)));
    const label = h('label.challenge-toggle', { 'data-challenge': c.id }, box, badge, h('span.challenge-text', {}, name, rule), h('span.challenge-switch', { 'aria-hidden': 'true' }));
    const rec = { label, box, name, rule };
    challengeEls.set(c.id, rec);
    return rec;
  }

  // --- PLAN-PHASE13: the Crown of Ages path and the Ascension level --------------------------------------------------------------------------------
  function pickCrown(on) {
    crownPick = !!(on && data && data.crown);
    for (const [b, v] of [[pathNew, false], [pathCrown, true]]) {
      b.classList.toggle('is-picked', crownPick === v);
      setAttr(b, 'aria-checked', crownPick === v ? 'true' : 'false');
      b.tabIndex = crownPick === v ? 0 : -1;
    }
    crownEl.classList.toggle('is-crown', crownPick);
    el.classList.toggle('is-crown', crownPick);
    crownWarn.hidden = !crownPick;
    if (PAGES[page].id === 'found') put(titleEl, titleFor('found'));
    put(foundLead, crownPick && data.crown ? data.crown.lead : 'A new continent awaits, with tougher enemies. Your House goes with you.');
    renderRecap();
  }

  function pickAscension(n) {
    const a = data && data.ascension;
    if (!a) { ascension = 0; return; }
    ascension = Math.max(0, Math.min(a.max, n | 0));
    ascButtons.forEach((b, i) => {
      const on = i === ascension;
      b.classList.toggle('is-picked', on);
      setAttr(b, 'aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    const lv = a.levels.find((x) => x.level === ascension);
    put(ascTitle, ascension ? `Ascension ${ascension}` : 'No Ascension');
    put(ascBonus, ascension && lv ? lv.legacy : '');
    put(ascAdded, ascension && lv ? lv.text : 'The standard rules. Pick a level to add its modifier, and every one below it.');
    const below = a.levels.filter((x) => x.level > 0 && x.level < ascension);
    const sig = below.map((x) => x.level).join(',');
    if (ascAll.dataset.sig !== sig) {
      ascAll.dataset.sig = sig;
      ascAll.replaceChildren(...below.map((x) => h('li', {}, h('span.nums', {}, `${x.level}`), h('span', {}, x.text))));
    }
    ascAll.hidden = !below.length;
    el.classList.toggle('is-ascended', ascension > 0);
    renderRecap();
  }

  function renderAscension(a) {
    ascEl.hidden = !a;
    if (!a) return;
    put(ascNote, a.note || '');
    if (ascLevels.dataset.max !== String(a.max)) {
      ascLevels.dataset.max = String(a.max);
      ascButtons.length = 0;
      for (let i = 0; i <= a.max; i++) {
        const b = h('button.ascension-level', { type: 'button', role: 'radio', 'data-level': String(i), onClick: () => pickAscension(i),
          'aria-label': i ? `Ascension ${i}` : 'No Ascension' }, i ? h('span.nums', {}, String(i)) : h('span', {}, 'Off'));
        b.addEventListener('keydown', (ev) => {
          const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
          if (!step) return;
          pickAscension((ascension + step + a.max + 1) % (a.max + 1)); ascButtons[ascension].focus(); ev.preventDefault();
        });
        ascButtons.push(b);
      }
      ascLevels.replaceChildren(...ascButtons);
    }
    pickAscension(Math.min(ascension, a.max));
  }

  function syncChallenges() {
    for (const [id, r] of challengeEls) {
      r.box.checked = challenges.has(id);
      r.label.classList.toggle('is-on', challenges.has(id));
    }
    warningEl.classList.toggle('is-on', challenges.size > 0);
    renderRecap();
  }

  /** @param {CeremonyData} d */
  function update(d) {
    if (!d) return;
    data = d;
    // summary
    const statSig = JSON.stringify(d.stats);
    if (statsGrid.dataset.sig !== statSig) {
      statsGrid.dataset.sig = statSig;
      statsGrid.replaceChildren(...d.stats.map((s) => h('div.ceremony-stat', {}, icon(s.icon, 16), h('span.ceremony-stat-label', {}, s.label), h('span.ceremony-stat-value.nums', {}, s.value))));
    }
    voyageEl.hidden = !d.voyage;
    put(voyageEl.lastChild, d.voyage || '');
    put(starsNum, `+${d.stars}`);
    put(starsLine, `${d.starsTotal} in all${d.starText ? ` · each: ${d.starText}` : ''}`);
    put(legacyNum, `+${d.legacyEarned}`);
    put(legacyLine, d.legacyNote || 'Spend them on the next page');
    if (d.save) { saveBtn.update(d.save); put(saveNote, d.save.hint || ''); }
    // legacy
    tree.update(d.legacy);
    // edicts
    const ids = d.edicts.map((e) => e.id);
    if (edictList.dataset.ids !== ids.join(',')) {
      edictList.dataset.ids = ids.join(',');
      edictCards.clear();
      edictList.replaceChildren(...d.edicts.map((e) => buildEdict(e).card));
      if (edict && !ids.includes(edict)) edict = null;
    }
    for (const e of d.edicts) {
      const r = edictCards.get(e.id);
      put(r.name, e.name);
      put(r.up, e.upside);
      put(r.cost, e.cost);
      if (r.iconName !== e.icon) { r.iconName = e.icon; r.crest.replaceChildren(icon(e.icon, 44)); }
      setAttr(r.card, 'aria-label', `${e.name}. Gain: ${e.upside}. Price: ${e.cost}`);
    }
    if (d.edicts.length) pickEdictTabStops();
    edictList.hidden = !d.edicts.length;
    edictNone.hidden = !!d.edicts.length;
    put(edictNote, d.edictNote || '');
    edictNote.hidden = !d.edictNote;
    // challenges
    put(challengeBonus, d.challengeBonus || '');
    for (const c of d.challenges) {
      const r = challengeEls.get(c.id) || buildChallenge(c);
      if (r.label.parentNode !== challengeList) challengeList.appendChild(r.label);
      put(r.name, c.name);
      put(r.rule, c.rule);
    }
    put(warningText, d.challengeWarning || '');
    syncChallenges();
    renderAscension(d.ascension || null);
    crownEl.hidden = !d.crown;
    if (d.crown) {
      put(pathCrown.querySelector('.crown-path-line'), d.crown.line);
      put(crownWarn.lastChild, d.crown.warning);
      const sig = d.crown.lines.join('|');
      if (crownLines.dataset.sig !== sig) { crownLines.dataset.sig = sig; crownLines.replaceChildren(...d.crown.lines.map((x) => h('li', {}, icon('crown', 12), h('span', {}, x)))); }
    }
    pickCrown(crownPick);
    render();
  }

  function pickEdictTabStops() {
    for (const [eid, r] of edictCards) {
      const on = eid === edict;
      r.card.classList.toggle('is-picked', on);
      setAttr(r.card, 'aria-checked', on ? 'true' : 'false');
      r.card.tabIndex = on || (!edict && eid === data.edicts[0].id) ? 0 : -1;
    }
  }

  /** Opens on page 1 with nothing chosen. */
  function open(d) {
    edict = null;
    challenges.clear();
    crownPick = false;
    ascension = 0;
    page = 0;
    update(d);
    el.hidden = false;
    onPage?.(PAGES[0].id);
  }

  function close() { el.hidden = true; }

  return {
    el, open, update, close, go,
    tree,
    saveMap: saveBtn,
    setSaveStatus: (message, kind) => saveBtn.setStatus(message, kind),
    get page() { return PAGES[page].id; },
    get choice() { return { edict, challenges: [...challenges], crownOfAges: crownPick, ascension }; },
    pickCrown, pickAscension, // dev / checks
    crownPath: (which) => (crownEl.hidden ? null : which === 'crown' ? pathCrown : pathNew),
    ascensionLevel: (n) => (ascEl.hidden ? null : ascButtons[n] || null),
    /** The Edict cards (the tutorial points at them). */
    edictList: () => (pageEdict.hidden || !data || !data.edicts.length ? null : edictList),
    stepButton: (kind) => (kind === 'next' ? nextBtn : kind === 'back' ? backBtn : foundBtn),
    pickEdict, // dev / checks
    /** The first-ceremony hint over the Edict cards (null hides it). */
    setEdictHint: (text) => { put(hintText, text || ''); hintEl.hidden = !text; },
  };
}
