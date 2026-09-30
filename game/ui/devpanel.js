// Dev panel for `?dev=1` (DESIGN §8). Browser only. Callbacks only — this
// component never touches game state itself, it just asks for things.
import { h, clear } from './dom.js';
import { icon } from './icons.js';

const GOLD_PRESETS = [100, 1000, 10000, 100000];

/**
 * @param {{ onGrantGold?: (amount: number) => void, onRevealMap?: () => void,
 *   onWinBattle?: () => void, onLoseBattle?: () => void, onSpeedX8?: (on: boolean) => void,
 *   onReseed?: (seed: number|undefined) => void }} [callbacks]
 */
export function createDevPanel({ onGrantGold, onRevealMap, onWinBattle, onLoseBattle, onSpeedX8, onReseed } = {}) {
  let collapsed = false;
  let speedX8On = false;

  const seedInput = h('input.devpanel-seed', { type: 'number', placeholder: 'seed (blank = random)' });
  const speedBtn = h('button.btn.btn-secondary.devpanel-speed', {
    onClick: () => { speedX8On = !speedX8On; speedBtn.classList.toggle('is-on', speedX8On); onSpeedX8?.(speedX8On); },
  }, 'Speed ×8: off');

  const body = h('div.devpanel-body', {},
    h('div.devpanel-row', {},
      ...GOLD_PRESETS.map((amount) => h('button.btn.btn-secondary', {
        onClick: () => onGrantGold?.(amount),
      }, `+${amount >= 1000 ? `${amount / 1000}K` : amount}`)),
    ),
    h('div.devpanel-row', {},
      h('button.btn.btn-secondary', { onClick: () => onRevealMap?.() }, icon('map', 14), 'Reveal map'),
      h('button.btn.btn-secondary', { onClick: () => onWinBattle?.() }, icon('trophy', 14), 'Win battle'),
      h('button.btn.btn-secondary', { onClick: () => onLoseBattle?.() }, icon('shield', 14), 'Lose battle'),
    ),
    h('div.devpanel-row', {}, speedBtn),
    h('div.devpanel-row', {},
      seedInput,
      h('button.btn.btn-secondary', {
        onClick: () => onReseed?.(seedInput.value.trim() === '' ? undefined : Number(seedInput.value)),
      }, 'Reseed'),
    ),
  );

  const toggleBtn = h('button.devpanel-toggle', { onClick: () => setCollapsed(!collapsed) }, icon('gear', 16), 'dev');

  const el = h('div.devpanel', {}, toggleBtn, body);

  function setCollapsed(next) {
    collapsed = next;
    body.hidden = collapsed;
    el.classList.toggle('is-collapsed', collapsed);
  }
  setCollapsed(false);

  function update() {} // action-only panel; nothing to reflect back

  function destroy() {
    clear(el);
  }

  return { el, update, destroy };
}
