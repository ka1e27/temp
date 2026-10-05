// The "?" in a panel's header that opens the Codex at that panel's topic (PLAN-PHASE8 §8B). Pure UI: the shell says what pressing it does.
import { h } from './dom.js';

/**
 * Puts a "?" button into `header`, just before `before` (the close button) or at its end, and returns it.
 * @param {HTMLElement} header @param {HTMLElement|null} before @param {string} topicTitle what it explains ("the War Council") @param {() => void} onPress
 */
export function addHelpButton(header, before, topicTitle, onPress) {
  if (!header) return null;
  const old = header.querySelector(':scope > .codex-help');
  if (old) return old;
  const btn = h('button.codex-help', { type: 'button', 'aria-label': `Help: ${topicTitle} in the Codex`, title: `${topicTitle} in the Codex`, onClick: () => onPress() }, '?');
  if (before && before.parentNode === header) header.insertBefore(btn, before);
  else header.appendChild(btn);
  return btn;
}
