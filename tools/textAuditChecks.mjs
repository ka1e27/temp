// Phase 15B: the Large and Larger text audit (PLAN-PHASE15 §15B.2), run by tools/check.mjs (`--only=textaudit`). On a 360x740 and a 390x844 phone (touch), at
// Large and at Larger, every panel and dialog the checks can reach is opened and audited by auditPanel below: no text clipped or cut by an ellipsis,
// nothing off the screen that cannot be scrolled to, every control reachable and on top. The stage is set with dev hooks; the panels open by real presses
// where a player opens them (the HUD buttons, Settings rows, the Boon chip, the ceremony's Next). Shots: screenshots/phase15/ unless PHASE15_SHOTS=0.
import { mkdir } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';

// auditPanel(rootSel), in the page. For every panel root matching `rootSel` it reports:
//   clipped:     a text run (measured by its own Range boxes, so a word that spills out of a narrow box counts) that is not wholly inside every ancestor
//                that clips (overflow other than visible). An ellipsis counts too: the text is not whole. A scrolling ancestor does not clip (it scrolls).
//   off:         a text run outside the screen with no scrolling ancestor to bring it in, or a scroller / the panel itself sticking out of the screen.
//   unreachable: a button (or link, input, tab, radio) that cannot be brought on screen by scrolling it into view.
//   covered:     such a control on screen whose centre is covered by something else (elementFromPoint misses it).
// The scroll positions it changes to reach controls are put back afterwards.
export function auditPanel(rootSel) {
  const W = innerWidth;
  const H = innerHeight;
  const TOL = 1.5;
  const vis = (e) => e.getClientRects().length > 0 && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden';
  const srOnly = (e) => !!e.closest('.visually-hidden, .sr-only') || (() => { const s = getComputedStyle(e); return s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)'; })();
  const label = (e) => {
    const cls = String(e.className && e.className.baseVal != null ? e.className.baseVal : e.className || '').trim().split(/\s+/).slice(0, 2).join('.');
    return `${e.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
  };
  const roots = [...document.querySelectorAll(rootSel)].filter(vis);
  const out = { root: rootSel, found: roots.length, clipped: [], off: [], unreachable: [], covered: [], texts: 0, controls: 0 };
  if (!roots.length) return out;
  const isScroller = (a) => { const s = getComputedStyle(a); return /(auto|scroll)/.test(s.overflowY) || /(auto|scroll)/.test(s.overflowX); };
  const saved = [];
  const save = (a) => { if (!saved.some((x) => x.a === a)) saved.push({ a, top: a.scrollTop, left: a.scrollLeft }); };
  for (const root of roots) {
    const rr = root.getBoundingClientRect();
    if (rr.left < -TOL || rr.right > W + TOL || rr.top < -TOL || rr.bottom > H + TOL) out.off.push(`${label(root)} (the panel) ${Math.round(rr.left)},${Math.round(rr.top)}..${Math.round(rr.right)},${Math.round(rr.bottom)}`);
    // 1. text runs
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const txt = n.textContent.replace(/\s+/g, ' ').trim();
      const e = n.parentElement;
      if (!txt || !e || !vis(e) || srOnly(e) || e.closest('svg, canvas, style, script')) continue;
      if (+getComputedStyle(e).opacity === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      if (!rects.length) continue;
      out.texts += 1;
      const box = rects.reduce((b, r) => ({ l: Math.min(b.l, r.left), t: Math.min(b.t, r.top), r: Math.max(b.r, r.right), b: Math.max(b.b, r.bottom) }), { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity });
      const say = `"${txt.slice(0, 32)}" (${label(e)})`;
      let scrollerX = false;
      let scrollerY = false;
      let clip = null;
      for (let a = e; a && a !== document.documentElement && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
        const ar = a.getBoundingClientRect();
        const cl = ar.left + a.clientLeft; const ct = ar.top + a.clientTop;
        const cr = cl + a.clientWidth; const cb = ct + a.clientHeight;
        const sx = /(auto|scroll)/.test(s.overflowX); const sy = /(auto|scroll)/.test(s.overflowY);
        // past a scroller, an axis is reachable by scrolling: what clips beyond it (the screen-sized #ui) clips the scroller, which is checked on its own
        const checkX = !scrollerX && !sx; const checkY = !scrollerY && !sy;
        if (sx) scrollerX = true;
        if (sy) scrollerY = true;
        if (checkX && (box.l < cl - TOL || box.r > cr + TOL)) clip = clip || `${say} ${Math.round(box.r - box.l)} px wide in ${label(a)} ${Math.round(cr - cl)} px${s.textOverflow === 'ellipsis' ? ' (ellipsis)' : ''}`;
        if (checkY && (box.t < ct - TOL || box.b > cb + TOL)) clip = clip || `${say} ${Math.round(box.b - box.t)} px tall in ${label(a)} ${Math.round(cb - ct)} px${/-webkit-box/.test(s.display) ? ' (line clamp)' : ''}`;
      }
      if (clip) out.clipped.push(clip);
      if ((!scrollerX && (box.l < -TOL || box.r > W + TOL)) || (!scrollerY && (box.t < -TOL || box.b > H + TOL))) out.off.push(`${say} at ${Math.round(box.l)},${Math.round(box.t)}..${Math.round(box.r)},${Math.round(box.b)}`);
    }
    // scrollers inside the panel must themselves be on screen
    for (const a of root.querySelectorAll('*')) {
      if (!vis(a) || !isScroller(a)) continue;
      let nested = false;
      for (let p = a.parentElement; p && p !== document.body; p = p.parentElement) if (isScroller(p)) { nested = true; break; }
      if (nested) continue; // inside another scroller: reachable by scrolling that one
      const r = a.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.left < -TOL || r.right > W + TOL || r.top < -TOL || r.bottom > H + TOL) out.off.push(`${label(a)} (a scroller) ${Math.round(r.left)},${Math.round(r.top)}..${Math.round(r.right)},${Math.round(r.bottom)}`);
    }
    // 2. controls: scroll each into view, then it must be on screen and on top at its centre
    const CTL = 'button, [role="button"], a[href], input:not([type="hidden"]), select, textarea, [role="tab"], [role="radio"], [role="switch"], [role="checkbox"]';
    for (const c of root.querySelectorAll(CTL)) {
      if (!vis(c) || srOnly(c)) continue;
      const s = getComputedStyle(c);
      let r = c.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || +s.opacity === 0 || s.pointerEvents === 'none') continue;
      out.controls += 1;
      for (let a = c.parentElement; a && a !== document.body; a = a.parentElement) if (isScroller(a)) save(a);
      c.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      r = c.getBoundingClientRect();
      const name = `${label(c)} "${(c.getAttribute('aria-label') || c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28)}"`;
      const vx = Math.max(0, Math.min(W, r.right)) - Math.max(0, r.left);
      const vy = Math.max(0, Math.min(H, r.bottom)) - Math.max(0, r.top);
      if (vx < Math.min(r.width, 24) * 0.9 || vy < Math.min(r.height, 24) * 0.9) { out.unreachable.push(`${name} at ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`); continue; }
      const x = Math.max(1, Math.min(W - 1, r.left + r.width / 2));
      const y = Math.max(1, Math.min(H - 1, r.top + r.height / 2));
      const top = document.elementFromPoint(x, y);
      const lbl = c.id ? document.querySelector(`label[for="${c.id}"]`) : null;
      if (!top || !(top === c || c.contains(top) || (lbl && (top === lbl || lbl.contains(top))) || (c.tagName === 'INPUT' && top.closest('label') === c.closest('label')))) {
        out.covered.push(`${name} under ${top ? label(top) : 'nothing'} at ${Math.round(x)},${Math.round(y)}`);
      }
    }
  }
  for (const { a, top, left } of saved) { a.scrollTop = top; a.scrollLeft = left; }
  for (const k of ['clipped', 'off', 'unreachable', 'covered']) out[k] = [...new Set(out[k])];
  return out;
}

const OUT = 'screenshots/phase15';
const SIZES = ['large', 'larger'];

async function phone(open, BASE, ok, sleep, allErrors, width, height) {
  const name = `${width}x${height}`;
  const t = await open(`${BASE}/index.html?dev=1&seed=7`, { width, height, mobile: true });
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const shoot = process.env.PHASE15_SHOTS !== '0';
  let size = 'normal';
  const tag = (s) => `text audit ${name} ${size}: ${s}`;
  const shot = async (n) => { if (shoot) await t.page.screenshot(`${OUT}/text-${name}-${size}-${n}.png`); };
  const shown = (sel) => q((s) => { const e = document.querySelector(s); return !!e && !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0; }, sel);
  const waitShown = (sel, ms = 5000) => t.waitFor((s) => { const e = document.querySelector(s); return !!e && !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0; }, ms, sel);
  /** Audits one panel root and reports it: the text whole and on screen, every control reachable. */
  const audit = async (what, rootSel, shotName) => {
    await sleep(350);
    const a = await q(auditPanel, rootSel);
    if (!ok(a.found > 0, tag(`${what} is open`))) return a;
    ok(a.clipped.length === 0 && a.off.length === 0, tag(`${what}: all ${a.texts} texts whole and on screen${a.clipped.length ? `; clipped: ${a.clipped.slice(0, 4).join(' | ')}` : ''}${a.off.length ? `; off screen: ${a.off.slice(0, 4).join(' | ')}` : ''}`));
    ok(a.unreachable.length === 0 && a.covered.length === 0, tag(`${what}: all ${a.controls} controls reachable${a.unreachable.length ? `; unreachable: ${a.unreachable.slice(0, 4).join(' | ')}` : ''}${a.covered.length ? `; covered: ${a.covered.slice(0, 4).join(' | ')}` : ''}`));
    if (shotName) await shot(shotName);
    return a;
  };
  /** A HUD-opened panel: a real press on its button, the audit, a real press on its close. */
  const panel = async (what, btnSel, rootSel, closeSel, shotName, inside) => {
    ok(await t.clickSel(btnSel), tag(`a press on ${what}`));
    if (!(await waitShown(rootSel))) { ok(false, tag(`${what} opens`)); return; }
    await audit(what, rootSel, shotName);
    if (inside) await inside();
    await t.clickSel(closeSel);
    await t.waitFor((s) => { const e = document.querySelector(s); return !e || e.hidden || !!e.closest('[hidden]'); }, 3000, rootSel);
    await sleep(250);
  };
  const SETTINGS = '.hud .btn-icon[aria-label="Settings"]';
  try {
    ok(await t.atTitle(), tag('boots'));
    ok(await t.clickText('button', 'New Realm'), tag('New Realm'));
    ok(await t.waitFor(() => window.__hd.scene === 'world', 40000), tag('the world is up'));
    await q(() => {
      const hd = window.__hd;
      hd.hideDev(true);
      hd.state.settings.hints = false;
      hd.state.settings.leaderVoices = false; // a rival's banner would come and go across the audits
      hd.conquerRegions(8);
      hd.state.stats.battlesWon = 8;
      hd.grantGold(5e6);
      hd.services.autosave.save();
    });
    await t.waitFor(() => !!window.__hd.challenge.kit, 15000);
    await sleep(1200);
    for (size of SIZES) {
      await q((s) => window.__hd.setOption('textSize', s), size);
      await sleep(500);
      await panel('Settings', SETTINGS, '.settings', '.settings-close', '01-settings');
      await panel('the Realm panel', '.hud-btn[aria-label="Realm stats"]', '.realm', '.realm-close', '02-realm');
      await panel('Generals', '.hud-generals', '.generals', '.generals-close', '03-generals');
      await panel('the War Council', '.hud-btn[aria-label="War Council"]', '.council', '.council-close', '04-council');
      await panel('Regions', '.hud-regions', '.regions', '.regions-close', '05-regions');
      // Settings > Codex: the list, then a topic page
      await panel('Settings (for the Codex)', SETTINGS, '.settings', '.settings-close', null, async () => {
        ok(await t.clickSel('.settings-codex'), tag('a press on Settings > Codex'));
        if (!(await waitShown('.codex', 8000))) { ok(false, tag('the Codex opens')); return; }
        await audit('the Codex list', '.codex', '06-codex-list');
        ok(await t.clickSel('.codex-topic[data-topic="rally"]'), tag('a press on a Codex topic'));
        await audit('a Codex page', '.codex', '07-codex-page');
        await t.clickSel('.codex-close');
        await sleep(300);
      });
      // Settings > Challenges: every tab of the hub
      await panel('Settings (for the Challenges)', SETTINGS, '.settings', '.settings-close', null, async () => {
        ok(await t.clickSel('.settings-challenges'), tag('a press on Settings > Challenges'));
        if (!(await waitShown('.ch-hub', 8000))) { ok(false, tag('the Challenges hub opens')); return; }
        for (const tab of ['daily', 'scenarios', 'calendar', 'banners']) {
          await t.clickSel(`.ch-tab[data-tab="${tab}"]`);
          await audit(`the Challenges hub (${tab})`, '.ch-hub', `08-hub-${tab}`);
        }
        await t.clickSel('.ch-close');
        await sleep(300);
      });
      await events();
      await boonsAndRelic();
    }
    // the founding ceremony (every page) and the ending: the realm completed at Dynasty VII with the Throne once toppled, so the ceremony shows its
    // Ascension picker and the Crown choice too
    await q(() => {
      const hd = window.__hd;
      hd.completeRealm();
      hd.state.dynasty.level = Math.max(7, hd.state.dynasty.level);
      hd.state.generals.crowned = { dynasty: 6, times: 1, year: 3, at: Date.now() };
      hd.crown.devForget();
    });
    // a toppled Throne not yet seen plays its ending by itself once the map is calm: let it start, skip it (ending() below plays it on purpose)
    if (await t.waitFor(() => window.__hd.crown.playing && !!window.__hd.crown.view && window.__hd.crown.view.playing, 15000)) await q(() => window.__hd.crown.view.skip()); // (the ending's module loads on first use)
    await t.waitFor(() => !window.__hd.crown.playing, 4000);
    await sleep(800);
    for (size of SIZES) {
      await q((s) => window.__hd.setOption('textSize', s), size);
      await sleep(500);
      await ceremony();
      await ending();
    }
    const errs = t.unexpected();
    ok(errs.length === 0, tag(`no console errors${errs.length ? `: ${errs.slice(0, 2).join(' | ')}` : ''}`));
    allErrors.push(...errs.map((e) => `[text audit ${name}] ${e}`));
  } catch (e) {
    ok(false, tag(`unexpected error: ${e && e.stack}`));
  } finally {
    await q(() => window.__hd.setOption('textSize', 'normal')).catch(() => {});
    await t.page.close();
  }

  /** World events: each offer's toast, the Merchant's deals, a Duel accepted (a real press), fought and won: its results card. */
  async function events() {
    for (const kind of ['merchant', 'deserters', 'harvest', 'plague', 'duel']) {
      const ev = await q((k) => window.__hd.offerEvent(k), kind);
      if (!ok(!!ev, tag(`a ${kind} event is offered`))) continue;
      if (!(await waitShown('.toast[data-id="world-event"]:not(.is-out)'))) { ok(false, tag(`the ${kind} toast shows`)); continue; }
      await sleep(500);
      await audit(`the ${kind} offer`, '.toasts', `09-event-${kind}`);
      if (kind === 'merchant') {
        ok(await t.clickSel('.toast[data-id="world-event"]:not(.is-out) .toast-action:not(.toast-secondary)'), tag('a press on See deals'));
        if (await waitShown('.is-merchant .modal-panel', 4000)) await audit("the Merchant's deals", '.is-merchant .modal-panel', '10-merchant');
        else ok(false, tag("the Merchant's deals open"));
        ok(await t.clickSel('.is-merchant .modal-actions button', 'Send it away'), tag('a press on Send it away'));
        await sleep(400);
      } else if (kind === 'duel') {
        ok(await t.clickSel('.toast[data-id="world-event"]:not(.is-out) .toast-action:not(.toast-secondary)'), tag('a press on Accept the duel'));
        if (!(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000))) { ok(false, tag('the Duel is fought')); continue; }
        await sleep(800);
        await audit('the Duel battle HUD', '.battle-hud', '11-duel-hud');
        await q(() => window.__hd.winBattle());
        if (await waitShown('.results-card', 20000)) { await sleep(1400); await audit("the Duel's results card", '.results-card', '12-duel-won'); }
        else ok(false, tag("the Duel's results card"));
        await t.clickSel('.results-card .results-action');
        await t.waitFor(() => window.__hd.scene === 'world', 15000);
        await sleep(1200);
      } else {
        await q(() => { const ev2 = window.__hd.state.worldEvents.pending; if (ev2) window.__hd.events.answer(ev2.id, 'decline'); });
        await sleep(600);
      }
      await q(() => { for (const b of document.querySelectorAll('.toasts .toast-close')) b.click(); });
      await sleep(500);
    }
  }

  /** A Boon offer opened from the HUD chip (a real press), and a Relic's claim with the longest Relic text. */
  async function boonsAndRelic() {
    await q(() => window.__hd.offerBoons());
    if (await waitShown('.hud-boon-chip', 4000)) {
      ok(await t.clickSel('.hud-boon-chip'), tag('a press on the Boon chip'));
      if (await waitShown('.boon-draft', 4000)) { await sleep(700); await audit('the Boon draft', '.boon-draft', '13-boon-draft'); }
      else ok(false, tag('the Boon draft opens'));
      await t.clickSel('.boon-draft-close');
      await sleep(500);
    } else ok(false, tag('a Boon offer shows its chip'));
    await q(async () => {
      const R = await import(new URL('game/config/relics.js', document.baseURI).href);
      const r = [...R.RELIC_LIST].sort((a, b) => b.text.length - a.text.length)[0];
      const longest = [...window.__hd.world.regions].sort((a, b) => b.name.length - a.name.length)[0];
      window.__hd.services.ui.relicClaim.play({ id: r.id, name: r.name, icon: r.icon, text: r.text.replace(/\{\w+\}/g, '2'), isNew: true, regionName: longest.name });
    });
    if (await waitShown('.relic-claim', 3000)) await audit('the Relic claim', '.relic-claim', '14-relic-claim');
    else ok(false, tag('the Relic claim plays'));
    await q(() => window.__hd.services.ui.relicClaim.skip());
    await sleep(400);
  }

  /** Realm > Found a Dynasty (real presses), every ceremony page by Next (an Edict picked on its page), then "Not yet: close". */
  async function ceremony() {
    ok(await t.clickSel('.hud-btn[aria-label="Realm stats"]'), tag('a press on the Realm panel'));
    await waitShown('.realm');
    await waitShown('.dynasty-found-btn', 5000);
    const found = await t.clickSel('.dynasty-found-btn');
    ok(found, tag(`a press on Found a Dynasty${found ? '' : ` ${JSON.stringify(await q(() => ({ realm: !!document.querySelector('.realm:not([hidden])'), btn: !!document.querySelector('.dynasty-found-btn'), dialog: document.documentElement.hasAttribute('data-dialog'), modals: [...document.querySelectorAll('[aria-modal="true"]')].filter((d) => d.getClientRects().length).map((d) => String(d.className).slice(0, 40)) })))}`}`));
    if (!(await waitShown('.ceremony', 5000))) { ok(false, tag('the ceremony opens')); return; }
    for (let i = 0; i < 6; i++) {
      const page = await q(() => document.querySelector('.ceremony').dataset.page);
      await audit(`the ceremony (${page})`, '.ceremony', `15-ceremony-${page}`);
      if (page === 'found') {
        for (const pick of ['.crown-path.is-crown', '.crown-path.is-new']) if (await shown(pick)) { await t.clickSel(pick); await audit(`the ceremony (found, ${pick.slice(12)})`, '.ceremony'); }
        break;
      }
      if (page === 'edict' && await shown('.ceremony .edict-card')) await t.clickSel('.ceremony .edict-card');
      if (page === 'challenges' && await shown('.ascension-level[data-level="1"]')) { await t.clickSel('.ascension-level[data-level="1"]'); await audit('the ceremony (challenges, Ascension 1)', '.ceremony'); }
      ok(await t.clickSel('.ceremony-next'), tag(`Next from ${page}`));
      await sleep(400);
    }
    await t.clickSel('.ceremony-close');
    await t.waitFor(() => document.querySelector('.ceremony').hidden, 3000);
    await sleep(300);
    if (await shown('.realm')) await t.clickSel('.realm-close');
    await sleep(400);
  }

  /** The ending (a toppled Throne not yet seen on this device): the Chronicle scroll and the credits. */
  async function ending() {
    await q(() => { window.__hd.crown.devForget(); window.__hd.crown.playEnding(); });
    if (!(await t.waitFor(() => !!window.__hd.crown.view && window.__hd.crown.playing && window.__hd.crown.view.playing, 15000))) { ok(false, tag('the ending plays')); return; }
    await q(() => window.__hd.crown.view.go('chronicle'));
    await sleep(900);
    await audit('the ending (the Chronicle)', '.ending-scroll', '16-ending-chronicle');
    await q(() => window.__hd.crown.view.go('credits'));
    await sleep(900);
    await audit('the ending (the credits)', '.ending-credits', '17-ending-credits');
    await q(() => window.__hd.crown.view.skip());
    await t.waitFor(() => !window.__hd.crown.playing, 4000);
    await sleep(400);
  }
}

export async function textAuditChecks({ launch, BASE, ok, sleep, allErrors }) {
  console.log('\n== text audit: Large and Larger text on a 360x740 and a 390x844 phone, every panel and dialog ==');
  await mkdir(OUT, { recursive: true });
  const open = makeOpen(launch, sleep);
  for (const [w, h] of [[360, 740], [390, 844]]) await phone(open, BASE, ok, sleep, allErrors, w, h);
}
