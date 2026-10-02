// The Regions list panel (DESIGN 7.5a): every region the player can see as a real button, frontier first, so the whole realm can be played without pointing at the
// map. Each row is one button named by a full sentence ("Greenreach: Free Folk, tier 1. Easy: your chance to win is about 4 in 5. Can be attacked."); choosing it
// opens that region's card exactly as clicking the map would. Browser only; the rows arrive as plain data (game/app/regionsList.js).
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { watchDialog } from './dialogs.js';

/**
 * @param {{ onSelect?: (id: number) => void, onClose?: () => void }} [callbacks]
 */
export function createRegionsPanel({ onSelect, onClose } = {}) {
  const listEl = h('div.regions-list', {});
  const el = h('div.regions.glass-panel', {},
    h('div.regions-header', {},
      h('h2.regions-title', {}, 'Regions'),
      h('button.btn-icon.regions-close', { onClick: () => onClose?.(), 'aria-label': 'Close' }, icon('close', 16)),
    ),
    h('div.regions-body.scroll-y', {}, h('p.regions-hint', {}, 'Choose a region to open its card. The ones you can attack come first.'), listEl),
  );
  watchDialog(el, { onEscape: () => onClose?.() });

  let lastSig = '';

  function emblemEl(r) {
    const e = h('span.region-row-emblem', {}, icon(r.owner.emblem || 'flag', 16));
    e.style.setProperty('--chip-color', r.owner.colorLight || r.owner.color);
    return e;
  }

  function rowEl(r) {
    const btn = h('button.region-row', {
      type: 'button',
      'data-region': String(r.id),
      'data-kind': r.kind,
      'aria-label': r.summary,
      onClick: () => onSelect?.(r.id),
    },
    emblemEl(r),
    h('span.region-row-main', {},
      h('span.region-row-name', {}, r.name),
      h('span.region-row-sub', {}, r.kind === 'owned' ? `Yours · ${r.tier === 0 ? 'Home' : `Tier ${r.tier}`}` : `${r.owner.name} · Tier ${r.tier}`),
    ),
    r.kind === 'owned'
      ? h('span.region-row-status.is-owned', {}, r.crowns != null ? `${r.crowns}/3 crowns` : 'Home')
      : h('span.region-row-status', {},
        r.surrender
          ? h('span.matchup-chip.pill.diff-easy', {}, 'Surrender')
          : r.blocked
            ? h('span.pill.region-row-blocked', {}, 'Walled off')
            : h(`span.matchup-chip.pill.diff-${String(r.label).toLowerCase()}`, {}, r.label),
        r.blocked && !r.surrender ? h('span.region-row-chance', {}, 'No passable border') : h('span.region-row-chance', {}, r.surrender ? 'No battle needed' : r.chanceText || ''),
      ));
    // the visible words are the label; the sentence is the accessible name, so the row never reads as a pile of fragments
    for (const c of btn.querySelectorAll('.region-row-main, .region-row-status, .region-row-emblem')) c.setAttribute('aria-hidden', 'true');
    return btn;
  }

  /** @param {{ rows: import('../app/regionsList.js').RegionRow[] }} data */
  function update(data) {
    if (!data) return;
    const rows = data.rows || [];
    const sig = rows.map((r) => `${r.id}|${r.summary}|${r.chanceText}|${r.label}`).join(';');
    if (sig === lastSig) return;
    lastSig = sig;
    const focusedId = el.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.region : null;
    clear(listEl);
    const front = rows.filter((r) => r.kind === 'frontier');
    const own = rows.filter((r) => r.kind === 'owned');
    const group = (title, list, cls) => {
      if (!list.length) return;
      listEl.appendChild(h(`h3.regions-group.${cls}`, {}, title, h('span.regions-count.nums', {}, String(list.length))));
      const ul = h('ul.regions-group-list', { role: 'list' });
      for (const r of list) ul.appendChild(h('li', {}, rowEl(r)));
      listEl.appendChild(ul);
    };
    group('Frontier', front, 'is-frontier');
    group('Your regions', own, 'is-owned');
    // the first row takes focus when the panel opens (the most useful place to start)
    const first = listEl.querySelector('.region-row');
    if (first) first.dataset.autofocus = '';
    if (focusedId != null) { const again = listEl.querySelector(`.region-row[data-region="${focusedId}"]`); if (again) again.focus({ preventScroll: true }); }
  }

  function destroy() { clear(el); }

  return { el, update, destroy };
}
