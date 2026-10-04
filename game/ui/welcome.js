// Welcome-back card (DESIGN §5.1: shown after ≥60s away). Browser only; no
// game-logic imports — gold has already been credited by game/meta/economy
// by the time this is shown (see economy.js's offlineEarnings); Collect is
// a celebration, not a gate.
import { h } from './dom.js';
import { icon } from './icons.js';
import { shortNumber, formatDurationWords } from './format.js';
import { watchDialog } from './dialogs.js';

/**
 * @param {{ onCollect?: () => void }} [callbacks]
 */
export function createWelcome({ onCollect } = {}) {
  const timeEl = h('span.welcome-time', {}, '');
  const goldEl = h('span.welcome-gold.nums', {}, '0');
  const burstEl = h('div.coin-burst', {});

  const collectBtn = h('button.btn.btn-primary.btn-block.welcome-collect', {
    onClick: () => { burst(); onCollect?.(); },
  }, icon('coin', 18), 'Collect');

  // "Winterthorpe and 2 other regions prospered while you were away." (one line, not one celebration per region)
  const prosperedEl = h('p.welcome-prospered', {}, '');
  // the away report (DESIGN 10.10): "While you were away: 4 attacks repelled at Fenwall and Lowshire. Brindle was occupied by the Amber Horde: retake it."
  const awayEl = h('p.welcome-away', { role: 'note' }, '');
  awayEl.hidden = true;
  prosperedEl.hidden = true;
  // "Your treasury pays for up to 2 h away. Treasury upgrades raise it.": only when the absence ran past the cap (hours arrive as data)
  const capEl = h('p.welcome-cap', {}, '');
  // "(capped at 2 h)" right beside the figure, so the number is never read as a full absence's worth
  const capNoteEl = h('span.welcome-capnote', {}, '');
  capNoteEl.hidden = true;
  capEl.hidden = true;

  // the sentence a screen reader gets when the card opens (the dialog's description): the gold, in words
  const summaryEl = h('p.visually-hidden', {}, '');
  const el = h('div.welcome-card.glass-panel', { 'aria-describedby': 'welcome-summary' },
    h('h2.welcome-title', {}, 'Welcome back!'),
    h('p.welcome-away', {}, 'You were away for ', timeEl, '.'),
    summaryEl,
    h('div.welcome-gold-row', {}, icon('coin', 24), goldEl, h('span.visually-hidden', {}, ' gold'), capNoteEl, burstEl),
    prosperedEl,
    awayEl,
    capEl,
    collectBtn,
  );

  // Escape collects (Collect is a celebration, not a gate); Collect takes focus
  collectBtn.dataset.autofocus = '';
  watchDialog(el, { onEscape: () => { burst(); onCollect?.(); } });

  function burst() {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.3;
      const dist = 46 + Math.random() * 30;
      const coin = icon('coin', 14);
      coin.classList.add('coin-burst-piece');
      coin.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
      coin.style.setProperty('--dy', `${Math.sin(a) * dist - 20}px`);
      coin.style.setProperty('--delay', `${Math.random() * 80}ms`);
      burstEl.appendChild(coin);
      setTimeout(() => coin.remove(), 900);
    }
  }

  /** @param {{ timeAwaySec: number, goldEarned: number, prospered?: {name: string}[], capped?: boolean, capHours?: number }} data */
  function update(data) {
    if (!data) return;
    if (data.timeAwaySec != null) timeEl.textContent = formatDurationWords(data.timeAwaySec);
    if (data.goldEarned != null) goldEl.textContent = shortNumber(data.goldEarned);
    summaryEl.id = 'welcome-summary';
    const capped = !!(data.capped && data.capHours > 0);
    const capText = capped ? `capped at ${Number(data.capHours.toFixed(1))} h` : '';
    capNoteEl.hidden = !capped;
    capNoteEl.textContent = capped ? `(${capText})` : '';
    summaryEl.textContent = `You were away for ${timeEl.textContent}. Your realm earned ${goldEl.textContent} gold${capped ? ` (${capText})` : ''}.`;
    capEl.hidden = !capped;
    if (!capEl.hidden) capEl.textContent = `Your treasury pays for up to ${Number(data.capHours.toFixed(1))} h away. Treasury upgrades raise it.`;
    awayEl.hidden = !data.away;
    awayEl.textContent = data.away || '';
    awayEl.classList.toggle('is-loss', !!data.awayLoss);
    if (data.prospered) {
      const list = data.prospered;
      const n = list.length;
      prosperedEl.textContent = n === 0 ? '' : n === 1 ? `${list[0].name} prospered while you were away.`
        : `${list[0].name} and ${n - 1} other ${n === 2 ? 'region' : 'regions'} prospered while you were away.`;
      prosperedEl.hidden = n === 0;
    } else {
      prosperedEl.hidden = true;
    }
  }

  function destroy() {}

  return { el, update, destroy };
}
