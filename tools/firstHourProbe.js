// In-page probe for tools/firstHour.mjs (PLAN-PHASE10 10A): logs every interruption a new player meets, with a timestamp in seconds since the
// probe was installed (the driver installs it right after New Realm is pressed). Imported in the page (?dev=1) like tools/hintMonitor.js.
//   kinds: hint (tutorial step id) | toast (by kind) | leader (a rival's line) | modal (a modal moment: results, draft, relic, recruit, duo, welcome,
//          merchant, ceremony, ...; `end` is filled in when it closes) | panel (a panel the player opened: not an interruption) | unlock (a system's
//          first appearance)
// Read it with `window.__fh.drain()` (new events since the last drain) or `window.__fh.events`.
export async function installFirstHourProbe() {
  if (window.__fh) return window.__fh;
  const hd = window.__hd;
  const imp = (p) => import(new URL(p, document.baseURI).href);
  const { bountiesUnlocked } = await imp('game/meta/bounties.js');
  const { challengesUnlocked } = await imp('game/meta/challengesState.js');
  const fh = { t0: performance.now(), events: [], unlocked: {}, read: 0 };
  window.__fh = fh;
  const now = () => +((performance.now() - fh.t0) / 1000).toFixed(1);
  const push = (kind, sub, text, extra) => {
    const e = { t: now(), kind, sub: String(sub || ''), text: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 110), ...extra };
    fh.events.push(e);
    return e;
  };
  fh.drain = () => { const out = fh.events.slice(fh.read); fh.read = fh.events.length; return out; };
  const unlock = (name, how) => { if (fh.unlocked[name] != null) return; fh.unlocked[name] = now(); push('unlock', name, how); };
  const shown = (el) => !!el && !el.hidden && !el.closest('[hidden]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

  // --- toasts: every NEW toast node; a toast that steps back into the queue (a dialog, the phone cap) and comes out again is the same news ---------
  const toastSeen = new Map(); // key -> last time it was on screen
  const toastKind = (n) => {
    const id = n.dataset.id || '';
    if (n.classList.contains('is-event')) return 'event';
    if (/^deed-/.test(id)) return 'deed';
    if (/^bounty-/.test(id)) return 'contract';
    if (/^trophy-/.test(id)) return 'trophy';
    if (/^streak/.test(id)) return 'streak';
    if (n.querySelector('.toast-action')) return 'action';
    if (/^(title-info|sound-toggle)$/.test(id) || /^(Pick|Click|Tap|Choose) (the|where|a) /.test(n.dataset.message || '')) return 'self'; // feedback to the player's own press
    return /^t\d+$/.test(id) ? 'news' : id.replace(/[-:].*$/, '');
  };
  const onToast = (n) => {
    const msg = n.dataset.message || '';
    const key = /^t\d+$/.test(n.dataset.id || '') ? msg : `${n.dataset.id}|${msg}`;
    const last = toastSeen.get(key);
    toastSeen.set(key, now());
    if (last != null && now() - last < 90) return; // re-shown from the queue
    const kind = toastKind(n);
    if (kind === 'self') return; // the player's own tap on a titled chip / the M key
    push('toast', kind, msg);
    if (kind === 'event') unlock('events', msg);
    if (kind === 'deed' || /Deed earned/.test(msg)) unlock('deeds', msg); // (also inside a merged post-battle toast)
    if (kind === 'action' && /war band|raid|march/i.test(msg)) unlock('raids', msg);
    if (/vendetta/i.test(msg)) unlock('vendetta', msg);
  };
  const toastsEl = document.querySelector('.toasts');
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('toast')) onToast(n);
  }).observe(toastsEl, { childList: true });
  setInterval(() => { for (const n of toastsEl.children) { const key = /^t\d+$/.test(n.dataset.id || '') ? n.dataset.message : `${n.dataset.id}|${n.dataset.message}`; if (toastSeen.has(key)) toastSeen.set(key, now()); } }, 1000);

  // --- modal moments and player panels ---------------------------------------------------------------------------------------------------------
  const MODALS = [
    ['results', '.results-card'], ['draft', '.boon-draft'], ['duo', '.duo-reveal'], ['relic', '.relic-claim'], ['welcome', '.welcome-card'],
    ['ceremony', '.ceremony'], ['recruit', '.modal-backdrop.is-recruit'], ['merchant', '.modal-backdrop.is-merchant'], ['quickLoss', '.modal-backdrop.is-quick-loss'],
    ['challengeResult', '.challenge-result'],
  ];
  const PANELS = [['council', '.council'], ['realm', '.realm'], ['regions', '.regions'], ['generals', '.generals'], ['settings', '.settings'], ['codex', '.codex'], ['hub', '.challenge-hub']];
  const open = new Map(); // key -> event
  let lastHint = null;
  let lastHintId = null;
  const seenHints = new Set();
  const markedSeen = new Set(); // steps the controller has marked seen
  let bannerWas = 'idle';
  let bannerLine = '';

  setInterval(() => {
    // modal moments (a generic createModal popup is named by its title)
    const cur = new Map();
    for (const [k, sel] of MODALS) for (const el of document.querySelectorAll(sel)) if (shown(el)) cur.set(k, el);
    for (const el of document.querySelectorAll('.modal-backdrop')) {
      if (!shown(el) || MODALS.some(([, sel]) => el.matches(sel))) continue;
      cur.set(`modal:${(el.querySelector('.modal-title')?.textContent || '').slice(0, 40)}`, el);
    }
    for (const [k, sel] of PANELS) for (const el of document.querySelectorAll(sel)) if (shown(el)) cur.set(`panel:${k}`, el);
    for (const [k, el] of cur) {
      if (open.has(k)) continue;
      const panel = k.startsWith('panel:');
      open.set(k, push(panel ? 'panel' : 'modal', panel ? k.slice(6) : k, el.innerText.slice(0, 110)));
      if (k === 'draft') unlock('boons', 'first Boon draft');
      if (k === 'relic') unlock('relics', 'Relic claimed');
    }
    for (const [k, e] of [...open]) if (!cur.has(k)) { e.end = now(); open.delete(k); }

    // tutorial hints: the step on screen (one at a time)
    // (keyed on the bubble's TEXT: the controller's current step changes up to 1.5 s before the coach draws it, COACH_MIN_SHOW_MS)
    const coach = document.querySelector('.coach');
    const step = hd.services.tutorial.current;
    const text = coach && !coach.hidden ? (coach.querySelector('.coach-bubble')?.innerText || '').trim() : '';
    const id = text && step ? step.id : null;
    if (text && text !== lastHint && id !== lastHintId) { // the same step re-worded (M1's best buy) or re-shown after its target was off screen is not news
      lastHintId = id;
      // a step that is still unseen comes back after another scene's step (M1 after a battle's B4): one hint, counted once. A step shown again
      // AFTER it was marked seen would be a real repeat (hints.mjs checks that; the controller never picks a seen step).
      if (markedSeen.has(id)) push('hint', id, text, { repeat: true });
      else if (!seenHints.has(id)) push('hint', id, text);
      seenHints.add(id);
      if (id === 'H1') unlock('codex', 'hint H1');
      if (id === 'J1') unlock('challenges', 'hint J1');
      if (id === 'Q1') unlock('board', 'hint Q1');
      if (id === 'L1') unlock('relics', 'hint L1');
      if (id === 'F1' || id === 'F2') unlock('raids', `hint ${id}`);
      if (id === 'Q2') unlock('vendetta', 'hint Q2');
      if (id === 'G1' || id === 'G2') unlock('generals', `hint ${id}`);
    }
    if (text) lastHint = text;
    for (const k of Object.keys(hd.state.tutorial.seen || {})) markedSeen.add(k);

    // the leader banner: a new line (sliding in, or a second line swapped in while it is up)
    const banner = document.querySelector('.leader-banner');
    const st = banner ? banner.dataset.state : 'idle';
    const line = banner ? banner.querySelector('.leader-line')?.textContent || '' : '';
    if (st === 'in' && (bannerWas !== 'in' || line !== bannerLine)) push('leader', banner.querySelector('.leader-name')?.textContent, line);
    bannerWas = st;
    bannerLine = line;
  }, 100);

  // --- systems: the first moment each one shows itself ---------------------------------------------------------------------------------------------
  setInterval(() => {
    const state = hd.state;
    if (bountiesUnlocked(state)) unlock('board', 'board open');
    if (shown(document.querySelector('.hud-renown'))) unlock('renown', 'HUD laurel');
    if (shown(document.querySelector('.hud-boon-chip'))) unlock('boons', 'Boon chip');
    if (shown(document.querySelector('.hud-streak'))) unlock('streak', 'streak chip');
    if (shown(document.querySelector('.region-card-relic'))) unlock('relics', 'Relic line on a card');
    if (challengesUnlocked(state) && fh.unlocked.challengesOpen == null) { fh.unlocked.challengesOpen = now(); push('note', 'challengesOpen', 'challengesUnlocked() true (title / Settings button)'); }
  }, 500);
  return fh;
}
