// Title screen overlay (DESIGN §6 step 1). Browser only; no game-logic
// imports. Deliberately has NO opaque background of its own — the living
// map keeps rendering and panning behind it.
import { h } from './dom.js';

/**
 * @param {{ onContinue?: () => void, onNewRealm?: () => void, onSettings?: () => void }} [callbacks]
 */
export function createTitle({ onContinue, onNewRealm, onSettings, onChallenges } = {}) {
  const continueBtn = h('button.btn.btn-primary.btn-block.title-btn', { onClick: () => onContinue?.() }, 'Continue');
  // Phase 9: the Daily and the Scenarios, once the realm has made its first conquest (shown when the challenge kit says so)
  const challengesBtn = h('button.btn.btn-secondary.btn-block.title-btn.title-challenges', { onClick: () => onChallenges?.() }, 'Challenges');
  challengesBtn.hidden = true;
  const versionEl = h('div.title-version', {}, '');

  const el = h('div.title-screen', {},
    h('div.title-logo-wrap', {},
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
  }

  function destroy() {}

  return { el, update, destroy };
}
