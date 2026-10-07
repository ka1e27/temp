// Title screen overlay (DESIGN §6 step 1). Browser only; no game-logic
// imports. Deliberately has NO opaque background of its own — the living
// map keeps rendering and panning behind it.
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @param {{ onContinue?: () => void, onNewRealm?: () => void, onSettings?: () => void }} [callbacks]
 */
export function createTitle({ onContinue, onNewRealm, onSettings, onChallenges } = {}) {
  const continueBtn = h('button.btn.btn-primary.btn-block.title-btn', { onClick: () => onContinue?.() }, 'Continue');
  // Phase 9: the Daily and the Scenarios, once the realm has made its first conquest (shown when the challenge kit says so)
  const challengesBtn = h('button.btn.btn-secondary.btn-block.title-btn.title-challenges', { onClick: () => onChallenges?.() }, 'Challenges');
  challengesBtn.hidden = true;
  const versionEl = h('div.title-version', {}, '');
  // PLAN-PHASE13 §13B: the lasting Crown once the Throne of Ages has fallen ("Crowned in Year N"), with crown pips for Ascensions cleared
  const crownLine = h('span.title-crown-line', {}, '');
  const crownPips = h('span.title-crown-pips', { 'aria-hidden': 'true' });
  const crownEl = h('div.title-crown', { role: 'note' }, h('span.title-crown-icon', { 'aria-hidden': 'true' }, icon('crown', 28)), crownLine, crownPips);
  crownEl.hidden = true;

  const el = h('div.title-screen', {},
    h('div.title-logo-wrap', {},
      crownEl,
      h('h1.title-logo', {}, 'HEX', h('br'), 'DOMINION'),
      h('p.title-tagline', {}, 'Idle conquest on a living hex world. Real-time battles. Paint the map in your colour.'),
    ),
    h('div.title-actions', {},
      continueBtn,
      challengesBtn,
      h('button.btn.btn-secondary.btn-block.title-btn', { onClick: () => onNewRealm?.() }, 'New Realm'),
      h('button.btn.btn-secondary.btn-block.title-btn', { onClick: () => onSettings?.() }, 'Settings'),
    ),
    versionEl,
  );

  /** @param {{ hasSave?: boolean, version?: string }} data */
  function update(data) {
    if (!data) return;
    if (data.hasSave != null) continueBtn.hidden = !data.hasSave;
    if (data.version != null) versionEl.textContent = `v${data.version}`;
    if (data.challenges != null) challengesBtn.hidden = !data.challenges;
    if (data.crown !== undefined) {
      crownEl.hidden = !data.crown;
      if (data.crown) {
        if (crownLine.textContent !== data.crown.line) crownLine.textContent = data.crown.line;
        const n = Math.max(0, data.crown.pips | 0);
        if (crownPips.childElementCount !== n) crownPips.replaceChildren(...Array.from({ length: n }, () => h('span.title-crown-pip')));
        crownEl.setAttribute('aria-label', `${data.crown.line}${n ? `, Ascension ${n} cleared` : ''}`);
      }
    }
  }

  function destroy() {}

  return { el, update, destroy };
}
