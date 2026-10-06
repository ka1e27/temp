// The Generals panel (DESIGN 10.11, 10.12): the roster as a dialog. Browser only; no game-logic imports: the scene merges meta/generals.js
// generalsPanelData with meta/renown.js renownSpends (the refusal words) and passes plain data in. Built once per General and patched in place (a card
// refresh between pointerdown and pointerup never recreates a button).
//
//   const panel = createGeneralsPanel({ onTrain, onHeal, onRespec, onPick, onHire, onWatch, onClose });
//   panel.update({ renown, generals: [...], hire: { cost, can, reason, slots } });
//
// A skill pick is two buttons (the 1-of-2 choice); pressing one opens a confirm step in the same place ("Take <skill>? It is permanent." Keep / Take it),
// so nothing permanent happens on a single tap.
import { h } from './dom.js';
import { icon } from './icons.js';
import { watchDialog } from './dialogs.js';
import { formatDurationWords } from './format.js';

const KIND_ICON = { marshal: 'shield', crimson: 'sword', violet: 'eye', amber: 'horse', gravewarden: 'skullCrown', admiral: 'admiral', mercenary: 'coin' };
const setText = (n, t) => { if (n.textContent !== t) n.textContent = t; };
const setAttr = (n, k, v) => { if (n.getAttribute(k) !== v) n.setAttribute(k, v); };
const setHidden = (n, v) => { if (n.hidden !== v) n.hidden = v; };

/** The emblem of a General: a round badge in its kind's colour with its kind's glyph (shared with the tray and the recruitment card). */
export function generalEmblem(kind, size = 20) {
  const e = h('span.general-emblem', { dataset: { kind: kind || 'captain' }, 'aria-hidden': 'true' }, icon(KIND_ICON[kind] || 'flag', Math.round(size * 0.62)));
  e.style.setProperty('--emblem-size', `${size}px`);
  return e;
}

/**
 * @param {{ onTrain?: (id: string) => void, onHeal?: (id: string) => void, onRespec?: (id: string) => void, onPick?: (id: string, choice: number) => void,
 *           onHire?: () => void, onWatch?: (id: string) => void, onClose?: () => void }} [callbacks]
 */
export function createGeneralsPanel({ onTrain, onHeal, onRespec, onPick, onHire, onWatch, onClose } = {}) {
  const renownEl = h('span.generals-renown.nums', {}, '0');
  const listEl = h('div.generals-list', { role: 'list' });
  const hireText = h('span.generals-hire-text', {}, 'Hire a mercenary General');
  const hireCost = h('span.generals-hire-cost', {}, '');
  const hireBtn = h('button.btn.btn-secondary.generals-hire', { type: 'button', onClick: () => onHire?.() }, hireText, hireCost, icon('laurel', 14));
  const hireReason = h('p.generals-reason', {}, '');
  const el = h('div.generals.glass-panel', {},
    h('div.generals-header', {},
      h('h2.generals-title', {}, 'Generals'),
      h('span.generals-renown-wrap', { title: 'Renown: earned by crowns, defenses won, retakes and toppled capitals' }, icon('laurel', 16), renownEl, h('span.visually-hidden', {}, ' Renown')),
      h('button.btn-icon.generals-close', { onClick: () => onClose?.(), 'aria-label': 'Close' }, icon('close', 16)),
    ),
    h('div.generals-body.scroll-y', {}, listEl, h('div.generals-hire-row', {}, hireBtn, hireReason)),
  );
  el.hidden = true;
  watchDialog(el, { onEscape: () => onClose?.() });

  const cards = new Map(); // id -> entry
  let confirm = null; // { id, tier, choice }

  function build(g) {
    const emblemSlot = h('span.general-emblem-slot');
    const nameEl = h('strong.general-name', {}, '');
    const titleEl = h('span.general-title', {}, '');
    const styleEl = h('span.pill.general-style', {}, '');
    const levelEl = h('span.pill.general-level', {}, '');
    const xpFill = h('span.general-xp-fill');
    const xpBar = h('span.general-xp', { role: 'progressbar', 'aria-valuemin': '0' }, xpFill);
    const xpText = h('span.general-xp-text', {}, '');
    const passiveEl = h('p.general-line', {}, '');
    const activeEl = h('p.general-line.is-active', {}, '');
    const statusText = h('span.general-status-text', {}, '');
    const watchBtn = h('button.btn.btn-secondary.general-watch', { type: 'button', onClick: () => onWatch?.(g.id) }, icon('eye', 14), 'Watch');
    const statusEl = h('div.general-status', {}, statusText, watchBtn);
    const skillsEl = h('div.general-skills', { role: 'group', 'aria-label': 'Skills' });
    // "Train · 8 [laurel]": the cost in Renown, with the laurel (the full words are the accessible name)
    const costBtn = (cls, fn) => h(`button.btn.${cls}`, { type: 'button', onClick: fn }, h('span.renown-cost-label', {}, ''), icon('laurel', 14));
    const trainBtn = costBtn('btn-primary.general-train', () => onTrain?.(g.id));
    const healBtn = costBtn('btn-secondary.general-heal', () => onHeal?.(g.id));
    const respecBtn = costBtn('btn-secondary.general-respec', () => onRespec?.(g.id));
    const reasonEl = h('p.generals-reason', {}, '');
    const card = h('article.general-card', { role: 'listitem', dataset: { id: g.id } },
      h('div.general-head', {}, emblemSlot, h('div.general-who', {}, h('div.general-name-row', {}, nameEl, levelEl, styleEl), titleEl)),
      h('div.general-xp-row', {}, xpBar, xpText),
      passiveEl, activeEl, statusEl, skillsEl,
      h('div.general-actions', {}, trainBtn, healBtn, respecBtn), reasonEl,
    );
    listEl.appendChild(card);
    const e = { card, emblemSlot, nameEl, titleEl, styleEl, levelEl, xpFill, xpBar, xpText, passiveEl, activeEl, statusText, watchBtn, statusEl, skillsEl, trainBtn, healBtn, respecBtn, reasonEl, kind: null, skillSig: '' };
    cards.set(g.id, e);
    return e;
  }

  /** The skill tiers: picked ones as a line, the open one as two buttons (or its confirm step), later ones as "at level N". */
  function patchSkills(e, g) {
    const sig = JSON.stringify([g.skills, confirm && confirm.id === g.id ? confirm : null]);
    if (sig === e.skillSig) return;
    e.skillSig = sig;
    const rows = [];
    g.skills.forEach((tier, i) => {
      if (tier.picked != null) {
        rows.push(h('p.general-skill.is-picked', {}, icon('star', 12), h('span', {}, tier.options[tier.picked]?.text || '')));
      } else if (tier.open) {
        if (confirm && confirm.id === g.id && confirm.tier === i) {
          const opt = tier.options[confirm.choice];
          rows.push(h('div.general-skill-confirm', { role: 'group', 'aria-label': 'Confirm the skill' },
            h('span.general-skill-confirm-text', {}, `Take "${opt.text}"? It is permanent.`),
            h('button.btn.btn-secondary.general-skill-keep', { type: 'button', onClick: () => { confirm = null; e.skillSig = ''; patchSkills(e, g); } }, 'Not yet'),
            h('button.btn.btn-primary.general-skill-take', { type: 'button', onClick: () => { const c = confirm; confirm = null; e.skillSig = ''; onPick?.(g.id, c.choice); } }, 'Take it')));
        } else {
          rows.push(h('p.general-skill-head', {}, `Level ${tier.level}: choose one`));
          rows.push(h('div.general-skill-choice', {}, ...tier.options.map((opt, c) => h('button.btn.btn-secondary.general-skill-option', {
            type: 'button', 'aria-label': `Skill choice: ${opt.text}`,
            onClick: () => { confirm = { id: g.id, tier: i, choice: c }; e.skillSig = ''; patchSkills(e, g); e.skillsEl.querySelector('.general-skill-take')?.focus({ preventScroll: true }); },
          }, opt.text))));
        }
      } else if (i === g.skills.findIndex((x) => x.picked == null)) {
        rows.push(h('p.general-skill.is-later', {}, icon('lock', 12), h('span', {}, `Next skill at level ${tier.level}`)));
      }
    });
    e.skillsEl.replaceChildren(...rows);
  }

  function patchButton(btn, label, a) {
    setText(btn.querySelector('.renown-cost-label'), label.replace(/ Renown$/, ''));
    label = label.replace(/ · (\d+) Renown$/, ' for $1 Renown');
    if (btn.disabled !== !a.can) btn.disabled = !a.can;
    setAttr(btn, 'title', a.can ? label : a.reason || label);
    setAttr(btn, 'aria-label', a.can ? label : `${label}. ${a.reason || 'Not available'}`);
  }

  /** @param {{ renown: number, generals: object[], hire: { cost: number, can: boolean, reason: string|null, slots: number } }} data */
  function update(data) {
    if (!data) return;
    setText(renownEl, String(Math.floor(data.renown || 0)));
    const want = new Set(data.generals.map((g) => g.id));
    for (const [id, e] of cards) if (!want.has(id)) { e.card.remove(); cards.delete(id); }
    data.generals.forEach((g, i) => {
      const e = cards.get(g.id) || build(g);
      if (listEl.children[i] !== e.card) listEl.insertBefore(e.card, listEl.children[i] || null);
      if (e.kind !== g.kind) { e.emblemSlot.replaceChildren(generalEmblem(g.kind, 40)); e.kind = g.kind; }
      setText(e.nameEl, g.name);
      setText(e.titleEl, g.title);
      setText(e.styleEl, g.styleName);
      setText(e.levelEl, `Lv ${g.level}`);
      const frac = g.xpNext ? Math.max(0, Math.min(1, g.xp / g.xpNext)) : 1;
      const w = `${Math.round(frac * 100)}%`;
      if (e.xpFill.style.width !== w) e.xpFill.style.width = w;
      setAttr(e.xpBar, 'aria-label', g.xpNext ? `Experience ${g.xp} of ${g.xpNext} to level ${g.level + 1}` : 'Highest level');
      setAttr(e.xpBar, 'aria-valuemax', String(g.xpNext || 1));
      setAttr(e.xpBar, 'aria-valuenow', String(g.xpNext ? g.xp : 1));
      setText(e.xpText, g.xpNext ? `${g.xp} / ${g.xpNext} XP` : 'Highest level');
      setText(e.passiveEl, `Passive: ${g.passive}`);
      setText(e.activeEl, `Ability: ${g.active}`);
      const status = g.wounded ? `Wounded: back in ${formatDurationWords(Math.max(1, g.woundedMs / 1000))}`
        : g.busy ? `Commanding the ${g.commandingKind === 'defense' ? 'defense of' : 'attack on'} ${g.commandingName || 'a region'}`
          : g.pendingPicks > 0 ? 'Free · a skill to choose' : 'Free';
      setText(e.statusText, status);
      e.card.classList.toggle('is-wounded', !!g.wounded);
      e.card.classList.toggle('has-pick', g.pendingPicks > 0);
      setHidden(e.watchBtn, !g.busy);
      setAttr(e.watchBtn, 'aria-label', `Watch the battle ${g.name} commands`);
      patchSkills(e, g);
      patchButton(e.trainBtn, `Train · ${g.train.cost} Renown`, g.train);
      setHidden(e.healBtn, !g.wounded);
      patchButton(e.healBtn, `Heal · ${g.heal.cost} Renown`, g.heal);
      setHidden(e.respecBtn, !g.skills.some((s) => s.picked != null));
      patchButton(e.respecBtn, `Respec · ${g.respec.cost} Renown`, g.respec);
      const reason = !g.train.can && g.train.reason ? g.train.reason : '';
      setText(e.reasonEl, reason);
      setHidden(e.reasonEl, !reason);
    });
    const hire = data.hire || { slots: 0 };
    setHidden(hireBtn.parentNode, !(hire.slots > 0));
    setText(hireCost, `· ${hire.cost}`);
    if (hireBtn.disabled !== !hire.can) hireBtn.disabled = !hire.can;
    setAttr(hireBtn, 'aria-label', `Hire a mercenary General for ${hire.cost} Renown${hire.can ? '' : `. ${hire.reason || ''}`}`);
    setText(hireReason, hire.can ? '' : hire.reason || '');
    setHidden(hireReason, hire.can || !hire.reason);
  }

  /** The card of a General (for hints and checks). */
  const cardOf = (id) => (cards.get(id) || {}).card || null;

  return { el, update, cardOf, destroy: () => { listEl.replaceChildren(); cards.clear(); } };
}
