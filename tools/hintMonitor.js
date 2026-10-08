// In-page placement monitor for tutorial hints (PLAYFEEL §4 "Hint placement rules"). Loaded into the running game by tools/hints.mjs and
// tools/check.mjs; after EVERY frame it measures the visible hint against the rules and records violations:
//   1. the pointer tip ends within 8 px of the hint's target box (an independent resolver below says what the target IS, by the hint's text);
//   2. it follows the target every frame (the measurement is taken each frame against the target's CURRENT box);
//   3. the bubble never covers the target;
//   4. the bubble stays fully on screen;
//   5. the hint is hidden while its target is off screen or under a panel;
//   6. at most one hint at a time;
//   7. in a battle the bubble never covers an enemy keep;
//   8. (not about hints) no toast ever overlaps an open dialog.
// The box definitions are game/app/hintTargets.js (shared with the game). Browser only.
import { siteBox, regionLabelBox, boxOfRect, unionBox, distPointBox, overlapArea, visibleFraction } from '../game/app/hintTargets.js';

const TIP_MAX = 8; // px (PLAYFEEL §4)
const EPS = 0.75; // sub-pixel layout slack

export function installHintMonitor() {
  const hd = window.__hd;
  if (window.__hm) return window.__hm;
  const M = (window.__hm = { frames: 0, shown: 0, hints: {}, violations: [], regionId: null, hadFrameHook: false });

  // the region the W2 hint talks about, computed with the game's own functions: the tutorial region, else the easiest frontier region
  let intelMod = null;
  let progMod = null;
  import(new URL('../game/meta/intel.js', import.meta.url).href).then((x) => { intelMod = x; });
  import(new URL('../game/meta/progression.js', import.meta.url).href).then((x) => { progMod = x; });
  let worksMod = null;
  import(new URL('../game/meta/works.js', import.meta.url).href).then((x) => { worksMod = x; });
  function hintRegion() {
    if (!intelMod || !progMod) return null;
    const { state, world } = hd;
    const t = intelMod.tutorialRegionId(state, world);
    if (t >= 0) return t;
    let best = -1;
    let bestRatio = -Infinity;
    for (const id of progMod.frontier(state, world)) {
      if (!progMod.attackable(state, world, id)) continue; // the lesson never points at a region that cannot be attacked
      const d = progMod.difficulty(state, world, id);
      if (d.ratio > bestRatio) { bestRatio = d.ratio; best = id; }
    }
    return best;
  }

  const isVisible = (el) => !!el && el.getClientRects().length > 0 && !el.closest('[hidden]');
  const first = (sel) => [...document.querySelectorAll(sel)].find(isVisible) || null;
  const uiTarget = (el) => (el ? { box: boxOfRect(el.getBoundingClientRect()), el } : null);
  const sel = (s) => uiTarget(first(s));

  /** What a hint with this text points at, resolved from the live game with its own code: [{ box, el? }, ...] (any of them will do), 'none' or null (not found). */
  function expectedFor(text) {
    const zoom = hd.camera.zoom;
    const sites = hd.scene === 'battle' ? hd.siteInfo() : [];
    const siteT = (s) => (s ? { box: siteBox({ x: s.x, y: s.y }, zoom) } : null);
    const camp = sites.find((s) => s.type === 'camp' && s.owner === 0);
    const enemyKeep = sites.find((s) => s.type === 'keep' && s.owner !== 0);
    const own = sites.filter((s) => s.owner === 0);
    const list = (...xs) => xs.filter(Boolean);
    if (/pay you gold|your realm pays|this is your realm/i.test(text)) return list(sel('.hud-gold-block'));
    if (/drag to move the map|scroll .*zoom/i.test(text)) return 'none';
    if (/glowing region/i.test(text)) {
      const id = M.regionId ?? hintRegion();
      if (id == null) return 'pending'; // the monitor's own imports (intel, progression) have not landed yet: a slow page (--cpu) shows the hint first
      if (id < 0) return null;
      // the whole region on screen (not just its label): the player is looking for the glowing REGION, so a bubble beside the name still sat on it
      const box = hd.regionHintBox ? hd.regionHintBox(id) : null;
      const p = hd.regionScreenPos(id);
      return box && p ? [{ box, probe: p }] : null;
    }
    if (/^attack!/i.test(text)) return list(sel('.region-card-action:not([hidden])'));
    if (/war camp to a settlement/i.test(text)) return list(siteT(camp));
    if (/how much to send/i.test(text)) return list(sel('.send-fraction-selector'));
    if (/captured settlements grow|keep \(the castle\)|take the enemy keep/i.test(text)) return list(siteT(enemyKeep));
    if (/select several|tap your settlements/i.test(text)) {
      const others = own.filter((s) => camp && s.id !== camp.id).sort((a, b) => Math.hypot(a.x - camp.x, a.y - camp.y) - Math.hypot(b.x - camp.x, b.y - camp.y));
      if (!camp || !others.length) return list(siteT(camp));
      return [{ box: unionBox(siteBox({ x: camp.x, y: camp.y }, zoom), siteBox({ x: others[0].x, y: others[0].y }, zoom)) }, siteT(others[0]), siteT(camp)];
    }
    if (/pick where everyone goes/i.test(text)) return list(siteT(enemyKeep));
    if (/rally/i.test(text) && !/stuck/i.test(text)) return list(uiTarget([...document.querySelectorAll('.power-btn')].filter(isVisible)[0]), siteT(enemyKeep));
    if (/space pauses|speed button/i.test(text)) {
      const a = first('.battle-pause');
      const b = first('.battle-speed');
      return a && b ? [{ box: unionBox(boxOfRect(a.getBoundingClientRect()), boxOfRect(b.getBoundingClientRect())), el: a }, uiTarget(a), uiTarget(b)] : null;
    }
    if (/firestorm:/i.test(text) || /stuck\?/i.test(text)) return list(...[...document.querySelectorAll('.power-btn')].filter(isVisible).slice(0, 2).map(uiTarget));
    if (/clears your selection|clear your selection|empty (ground|spot)/i.test(text)) {
      const sel = (hd.selection ? hd.selection() : []).map((id) => sites.find((s) => s.id === id)).filter(Boolean);
      if (!sel.length) return null;
      return [{ box: sel.map((s) => siteBox({ x: s.x, y: s.y }, zoom)).reduce((a, b) => unionBox(a, b)) }];
    }
    if (/war council|a good first buy/i.test(text)) return list(sel('.hud-btn[aria-label="War Council"]'));
    if (/scout a region/i.test(text)) return list(sel('.intel-scout-btn'));
    if (/found a dynasty/i.test(text)) return list(sel('.hud-btn[aria-label="Realm stats"]'));
    if (/supply line/i.test(text)) return list(sel('.battle-auto, .auto-toggle, .supply-toggle'), siteT(camp));
    if (/only attack where your land/i.test(text)) return list(...sites.filter((s) => s.owner !== 0).map(siteT));
    // The Living Frontier (F1-F4): the raid toast's Go; the tray chip of a battle you are not watching; the region to fortify, its Fortifications Build, the Arrow Tower row
    // Goals and Rivals (Q1, Q2): the Regions button (the Bounty Board lives in its panel); a Vendetta banner's Go
    if (/has a codex/i.test(text)) return list(sel('.hud .btn-icon[aria-label="Settings"]')); // Phase 8 (H1)
    if (/^new: challenges/i.test(text)) return list(sel('.hud .btn-icon[aria-label="Settings"]')); // Phase 9 (J1)
    if (/the bounty board/i.test(text)) return list(sel('.hud-regions'));
    if (/a vendetta!/i.test(text)) {
      const btns = [...document.querySelectorAll('.toasts > .toast.is-vendetta:not(.is-out) .toast-action')].filter(isVisible);
      return btns.length ? btns.map(uiTarget) : null;
    }
    if (/war band is coming/i.test(text)) {
      const btns = [...document.querySelectorAll('.toasts > .toast:not(.is-out) .toast-action')].filter((b) => isVisible(b) && /^raid-/.test(b.closest('.toast').dataset.id || ''));
      return btns.length ? btns.map(uiTarget) : null;
    }
    if (/two battles at once/i.test(text)) {
      const chips = [...document.querySelectorAll('.battle-tray:not([hidden]) .tray-row:not(.is-focused) .tray-chip')].filter(isVisible);
      return chips.length ? chips.map(uiTarget) : null;
    }
    // Generals and Renown (G1, G2, R1)
    if (/press g or tap the ability|tap the ability once/i.test(text)) return list(sel('.battle-ability:not([hidden])'));
    if (/open generals to choose a skill/i.test(text)) return list(sel('.hud-generals'));
    if (/renown for a festival/i.test(text)) {
      const id = hd.hintOutline ? hd.hintOutline() : -1;
      const box = id >= 0 && hd.regionHintBox ? hd.regionHintBox(id) : null;
      const p = id >= 0 ? hd.regionScreenPos(id) : null;
      return box && p ? [{ box, probe: p }] : null;
    }
    if (/festival: this region prospers/i.test(text)) return list(sel('.region-card-festival:not([hidden])'));
    // A varied map (V1-V5): the typed or twisted frontier region; the Gate; a Shrine; the Bulwark button under the Dragon's warning; the world event's toast
    if (/treasure or a twist/i.test(text)) {
      const id = hd.hintOutline ? hd.hintOutline() : -1;
      const box = id >= 0 && hd.regionHintBox ? hd.regionHintBox(id) : null;
      const p = id >= 0 ? hd.regionScreenPos(id) : null;
      return box && p ? [{ box, probe: p }] : null;
    }
    // Phase 7 (L1): the frontier region holding a Relic
    if (/a relic lies in this region/i.test(text)) {
      const id = hd.hintOutline ? hd.hintOutline() : -1;
      const box = id >= 0 && hd.regionHintBox ? hd.regionHintBox(id) : null;
      const p = id >= 0 ? hd.regionScreenPos(id) : null;
      return box && p ? [{ box, probe: p }] : null;
    }
    // The Ashen Host (A1): the Ashen frontier region; the sea (S1, Phase 12): the frontier region with fords
    if (/the fallen rise/i.test(text) || /fords cross the straits/i.test(text) || /^the throne of ages: break the gate/i.test(text)) { // + the Usurper's land (U1, Phase 13)
      const id = hd.hintOutline ? hd.hintOutline() : -1;
      const box = id >= 0 && hd.regionHintBox ? hd.regionHintBox(id) : null;
      const p = id >= 0 ? hd.regionScreenPos(id) : null;
      return box && p ? [{ box, probe: p }] : null;
    }
    if (/the usurper borrows a weapon/i.test(text)) { // U2 (Phase 13): the borrowed weapon's ring
      const info = hd.throneInfo ? hd.throneInfo() : null;
      const w = info && info.telegraphPoint;
      if (!w) return null;
      const p = hd.camera.worldToScreen(w.x, w.y);
      return [{ box: siteBox(p, zoom) }];
    }
    if (/take the gate to open the keep/i.test(text)) return list(...sites.filter((s) => s.type === 'gate' && s.owner !== 0).map(siteT));
    if (/hold all three shrines/i.test(text)) return list(...sites.filter((s) => s.type === 'shrine').map(siteT));
    if (/bulwark the target/i.test(text)) return list(uiTarget([...document.querySelectorAll('.power-btn')].filter(isVisible)[2]));
    if (/a world event/i.test(text)) {
      const t = [...document.querySelectorAll('.toasts > .toast:not(.is-out)')].find((n) => n.dataset.id === 'world-event' && isVisible(n));
      return t ? list(uiTarget(t.querySelector('.toast-action:not(.toast-secondary)')), uiTarget(t)) : null;
    }
    if (/fortify your border/i.test(text)) {
      const id = hd.hintOutline ? hd.hintOutline() : -1;
      const box = id >= 0 && hd.regionHintBox ? hd.regionHintBox(id) : null;
      const p = id >= 0 ? hd.regionScreenPos(id) : null;
      return box && p ? [{ box, probe: p }] : null;
    }
    if (/build to fortify/i.test(text)) return list(sel('.works-panel.is-forts .works-build:not([hidden])'));
    if (/arrow tower shoots/i.test(text)) {
      const row = [...document.querySelectorAll('.works-panel.is-forts .works-choice')].filter(isVisible).find((b) => /arrow tower/i.test(b.textContent));
      return row ? [uiTarget(row)] : null;
    }
    // M3 (Works), three stages: the owned region at the edge of the realm, then its Build button, then the Barracks row of the chooser
    if (/build works in your regions/i.test(text)) {
      if (!worksMod) return 'pending';
      const id = worksMod.worksTutorialRegion(hd.state, hd.world);
      const box = id >= 0 && hd.regionHintBox ? hd.regionHintBox(id) : null;
      const p = id >= 0 ? hd.regionScreenPos(id) : null;
      return box && p ? [{ box, probe: p }] : null;
    }
    if (/^tap build/i.test(text)) return list(sel('.works-panel:not(.is-forts) .works-build:not([hidden])'));
    if (/^pick barracks/i.test(text)) {
      const row = [...document.querySelectorAll('.works-choice')].filter(isVisible).find((b) => /barracks/i.test(b.textContent));
      return row ? [uiTarget(row)] : null;
    }
    return null;
  }

  function tipOf(coach) {
    const tail = coach.querySelector('.coach-tail');
    if (tail) {
      if (!isVisible(tail)) return null;
      const r = tail.getBoundingClientRect();
      const side = tail.dataset.side;
      if (side === 'down') return { x: r.left + r.width / 2, y: r.bottom, side };
      if (side === 'up') return { x: r.left + r.width / 2, y: r.top, side };
      if (side === 'left') return { x: r.left, y: r.top + r.height / 2, side };
      return { x: r.right, y: r.top + r.height / 2, side };
    }
    // the pre-rewrite coach: a rotated square centred on the bubble's top or bottom edge
    const b = coach.querySelector('.coach-bubble');
    const r = b.getBoundingClientRect();
    if (b.classList.contains('arrow-down')) return { x: r.left + r.width / 2, y: r.bottom + 10, side: 'down' };
    if (b.classList.contains('arrow-up')) return { x: r.left + r.width / 2, y: r.top - 10, side: 'up' };
    return null;
  }

  const covered = (t) => {
    // a group target (two buttons) is probed at its element's own centre, not the gap between its parts
    const pb = t.el ? boxOfRect(t.el.getBoundingClientRect()) : t.box;
    const c = t.probe || { x: pb.x + pb.w / 2, y: pb.y + pb.h / 2 }; // a region is probed at its label
    if (c.x < 0 || c.y < 0 || c.x > innerWidth || c.y > innerHeight) return false; // off screen is its own check
    const top = document.elementFromPoint(c.x, c.y);
    if (!top) return false;
    if (t.el) return !(t.el === top || t.el.contains(top) || top.contains(t.el) && top === document.body);
    return top.id !== 'world' && !top.closest('#world');
  };

  function note(text, kind, detail) {
    const h = M.hints[text] || (M.hints[text] = { frames: 0, worstTip: 0, overlaps: 0, problems: {} });
    const p = h.problems[kind] || (h.problems[kind] = { n: 0, detail });
    p.n += 1;
    if (M.violations.length < 400 && p.n === 1) M.violations.push({ text, kind, detail, scene: hd.scene, vw: innerWidth, vh: innerHeight });
  }

  const bb0 = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });
  /** The z-index of the stacking context an element sits in (0 when none is set on the way up). */
  const stackOf = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.position !== 'static' && st.zIndex !== 'auto') return Number(st.zIndex);
    }
    return 0;
  };

  function sample() {
    M.frames += 1;
    // no toast may ever overlap an open dialog (they queue while one is open: ui/toasts.js setHeld)
    const dialogs = [...document.querySelectorAll('[aria-modal="true"]')].filter((d) => isVisible(d) && !d.closest('[inert]'));
    if (dialogs.length) {
      for (const t of document.querySelectorAll('.toasts > .toast')) {
        if (!isVisible(t) || t.classList.contains('is-out') || +getComputedStyle(t).opacity < 0.05) continue;
        const tb = boxOfRect(t.getBoundingClientRect());
        for (const d of dialogs) {
          const db = boxOfRect(d.getBoundingClientRect());
          if (overlapArea(tb, db, 0) > 0) note('(toasts)', 'a toast overlaps an open dialog', `"${t.textContent.trim().slice(0, 40)}" at ${Math.round(tb.x)},${Math.round(tb.y)} over ${(d.className || d.tagName).toString().slice(0, 30)}`);
        }
      }
    }
    // the top lane (main.js layoutTopLane): the leader banner and the toasts never overlap, and a phone shows at most two of them. Layout boxes (offsets in #ui),
    // so a notice's slide-in transform does not count.
    {
      const ui = document.getElementById('ui');
      const lane = [];
      const banner = document.querySelector('.leader-banner');
      const card = banner && banner.firstElementChild;
      if (banner && banner.dataset.state === 'in' && card && card.offsetHeight > 0) lane.push({ name: 'leader banner', x: banner.offsetLeft + card.offsetLeft, y: banner.offsetTop + card.offsetTop, w: card.offsetWidth, h: card.offsetHeight });
      const col = document.querySelector('.toasts');
      if (col && ui) for (const t of col.children) {
        if (t.classList.contains('is-out') || !t.offsetHeight) continue;
        lane.push({ name: `toast "${t.textContent.trim().slice(0, 30)}"`, x: col.offsetLeft + t.offsetLeft, y: col.offsetTop + t.offsetTop, w: t.offsetWidth, h: t.offsetHeight });
      }
      for (let i = 0; i < lane.length; i++) for (let j = i + 1; j < lane.length; j++) {
        const a = lane[i]; const b = lane[j];
        if (a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5) note('(top lane)', 'two top notices overlap', `${a.name} and ${b.name}`);
      }
      if (innerWidth < 768 && lane.length > 2) note('(top lane)', 'more than two top notices on a phone', lane.map((x) => x.name).join(' | '));
    }
    const coaches = [...document.querySelectorAll('.coach')].filter((c) => !c.hidden);
    if (coaches.length === 0) return;
    const coach = coaches[0];
    const bubbles = [...document.querySelectorAll('.coach:not([hidden]) .coach-bubble')].filter(isVisible);
    const text = (coach.querySelector('.coach-text')?.textContent || '').trim();
    if (!text) return;
    M.shown += 1;
    const h = M.hints[text] || (M.hints[text] = { frames: 0, worstTip: 0, overlaps: 0, problems: {} });
    h.frames += 1;
    if (coaches.length > 1 || bubbles.length > 1) note(text, 'more than one hint on screen', `${coaches.length} coaches, ${bubbles.length} bubbles`);
    const bubble = bubbles[0];
    if (!bubble) return;
    const br = bubble.getBoundingClientRect();
    if (br.left < -EPS || br.top < -EPS || br.right > innerWidth + EPS || br.bottom > innerHeight + EPS) {
      note(text, 'bubble off screen', `${Math.round(br.left)},${Math.round(br.top)} ${Math.round(br.right)},${Math.round(br.bottom)} in ${innerWidth}x${innerHeight}`);
    }
    // the bubble must not sit over a control the player might press (other than what the hint is about): more than a quarter of it covered is a miss
    const expNow = expectedFor(text);
    const targetEls = Array.isArray(expNow) ? expNow.map((t) => t.el).filter(Boolean) : [];
    for (const ctl of document.querySelectorAll('button, [role="button"], a[href], input, select, textarea')) {
      if (!isVisible(ctl) || ctl.closest('.coach') || ctl.closest('.results-card')) continue;
      if (targetEls.some((te) => te === ctl || te.contains(ctl) || ctl.contains(te))) continue;
      if (stackOf(ctl) > stackOf(coach)) continue; // a toast or banner stacked ABOVE the hint is not covered by it (the hint goes under it)
      const cb = boxOfRect(ctl.getBoundingClientRect());
      if (cb.w < 4 || cb.h < 4) continue;
      if (overlapArea(bb0(br), cb, 0) > 0.25 * cb.w * cb.h) note(text, 'bubble covers a control', `${(ctl.getAttribute('aria-label') || ctl.textContent || ctl.className).toString().trim().slice(0, 30)} (${ctl.className}) at ${Math.round(cb.x)},${Math.round(cb.y)} ${Math.round(cb.w)}x${Math.round(cb.h)}; bubble ${Math.round(br.left)},${Math.round(br.top)} ${Math.round(br.width)}x${Math.round(br.height)}; toasts ${(() => { const t = document.querySelector('.toasts'); if (!t) return 'none'; const r = t.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} kids ${t.children.length}`; })()}`);
    }
    const exp = expNow;
    if (exp === 'none' || exp === 'pending') return; // a card with no pointer; or the monitor is still loading what it measures with
    if (exp == null || exp.length === 0) { note(text, 'hint shown but its target does not exist', ''); return; }
    const tip = tipOf(coach);
    const bb = boxOfRect(br);
    // the target the pointer is aimed at: the expected box nearest to the tip
    let best = null;
    for (const t of exp) {
      const d = tip ? distPointBox(tip, t.box) : Infinity;
      if (!best || d < best.d) best = { t, d };
    }
    if (!tip) { note(text, 'no pointer', ''); return; }
    h.worstTip = Math.max(h.worstTip, best.d);
    if (best.d > TIP_MAX + EPS) {
      note(text, 'pointer misses its target', `tip ${Math.round(tip.x)},${Math.round(tip.y)} (${tip.side}) is ${best.d.toFixed(1)} px from the box ${Math.round(best.t.box.x)},${Math.round(best.t.box.y)} ${Math.round(best.t.box.w)}x${Math.round(best.t.box.h)}`);
    }
    if (overlapArea(bb, best.t.box, -2) > 0) {
      h.overlaps += 1;
      note(text, 'bubble covers its target', `bubble ${Math.round(bb.x)},${Math.round(bb.y)} ${Math.round(bb.w)}x${Math.round(bb.h)} over box ${Math.round(best.t.box.x)},${Math.round(best.t.box.y)} ${Math.round(best.t.box.w)}x${Math.round(best.t.box.h)}`);
    }
    // in a battle the bubble never sits on an enemy keep (the castle the fight is about), whatever the hint is pointing at
    if (hd.scene === 'battle') {
      for (const k of hd.siteInfo().filter((s) => s.type === 'keep' && s.owner !== 0)) {
        if (k.x < 0 || k.y < 0 || k.x > innerWidth || k.y > innerHeight) continue;
        const kb = siteBox({ x: k.x, y: k.y }, hd.camera.zoom);
        if (overlapArea(bb, kb, -2) > 0) note(text, 'bubble covers an enemy keep', `keep at ${Math.round(k.x)},${Math.round(k.y)}; bubble ${Math.round(bb.x)},${Math.round(bb.y)} ${Math.round(bb.w)}x${Math.round(bb.h)}`);
      }
    }
    if (/war camp to a settlement/i.test(text) && hd.tutorialArrow) {
      // the gold arrow's destination is part of the lesson: the bubble must not sit on it
      const ta = hd.tutorialArrow();
      const dest = ta ? hd.siteInfo().find((s) => s.id === ta.to) : null;
      if (dest && overlapArea(bb, siteBox({ x: dest.x, y: dest.y }, hd.camera.zoom), -2) > 0) note(text, 'bubble covers the arrow destination', `settlement at ${Math.round(dest.x)},${Math.round(dest.y)}`);
    }
    // "Attack!" and the scout hint sit in the card's own footer room: they never cover a number the player is deciding on (the bounty, par, income, strength, tags)
    if (/^attack!|scout a region/i.test(text)) {
      const own = best.t.el || null;
      for (const row of document.querySelectorAll('.region-card-header, .region-card-body > *')) {
        if (!isVisible(row) || row.classList.contains('region-card-hintslot') || (own && (row === own || row.contains(own)))) continue; // the slot is the empty room the bubble sits in
        const rb = boxOfRect(row.getBoundingClientRect());
        if (rb.w < 4 || rb.h < 4) continue;
        if (overlapArea(bb, rb, -1) > 0) note(text, 'bubble covers card information', `${(row.className || row.tagName).toString().slice(0, 40)} at ${Math.round(rb.x)},${Math.round(rb.y)} ${Math.round(rb.w)}x${Math.round(rb.h)}; bubble ${Math.round(bb.x)},${Math.round(bb.y)} ${Math.round(bb.w)}x${Math.round(bb.h)}`);
      }
    }
    if (visibleFraction(best.t.box, innerWidth, innerHeight) < 0.5) note(text, 'hint visible while its target is off screen', `box ${Math.round(best.t.box.x)},${Math.round(best.t.box.y)}`);
    else if (covered(best.t)) note(text, 'hint visible while its target is under a panel', `top element ${document.elementFromPoint(best.t.box.x + best.t.box.w / 2, best.t.box.y + best.t.box.h / 2)?.className || '?'}`);
  }

  // After EVERY frame, in the same animation-frame slot as the game's own update, so a pan/zoom/flight is measured against the coach as that
  // frame left it (the coach re-places itself at the end of the frame); fall back to our own rAF for a build without the hook.
  if (Array.isArray(hd.afterFrame)) {
    hd.afterFrame.push(sample);
    M.hadFrameHook = true;
  } else {
    const loop = () => { sample(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  M.report = () => ({
    frames: M.frames, shown: M.shown, hadFrameHook: M.hadFrameHook,
    hints: Object.entries(M.hints).map(([text, h]) => ({ text, frames: h.frames, worstTip: +h.worstTip.toFixed(1), overlaps: h.overlaps, problems: Object.fromEntries(Object.entries(h.problems).map(([k, v]) => [k, { n: v.n, detail: v.detail }])) })),
    violations: M.violations.slice(0, 60),
  });
  return M;
}

/**
 * The layout-shift guard (Phase 15B): no interactive element under an active pointer may move more than SHIFT_MAX px (its centre), be hidden or be
 * removed between pointerdown and pointerup. That is the whole class of the Phase 10 bug (b694eb8: a hint opened room in the phone's bottom sheet
 * 2.5 s after the card opened, and a tap at that moment landed on whatever slid under the finger) and of THE CLICK RULE (a node replaced under a
 * press swallows the click). Self-contained, so tools/check.mjs injects `(${installShiftGuard})()` into EVERY page of every section at document start;
 * a violation is reported through the CDP binding `__hdShift` (JSON) when present, and always kept in `window.__shiftLog`.
 * Measured at window capture phase, BEFORE any of the game's own handlers run (a pointerup handler that closes the panel is not a shift).
 * The centre, not the edges: a pressed `.btn` scales 0.98 and drops 1 px (base.css), a power button scales 0.94; both keep the centre within 2 px.
 */
export function installShiftGuard() {
  if (window.__shiftGuard) return;
  window.__shiftGuard = true;
  const SHIFT_MAX = 2;
  const INTERACTIVE = 'button, [role="button"], [role="tab"], [role="switch"], [role="menuitem"], a[href], input, select, textarea, summary, label[for]';
  const log = (window.__shiftLog = []);
  const presses = new Map();
  const centre = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  };
  const name = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const cls = String(el.className || '').trim().split(/\s+/).slice(0, 2).join('.');
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} "${t}"`;
  };
  const report = (v) => {
    if (log.length < 200) log.push(v);
    try { if (typeof window.__hdShift === 'function') window.__hdShift(JSON.stringify(v)); } catch { /* the binding is optional */ }
  };
  addEventListener('pointerdown', (e) => {
    const el = e.target instanceof Element ? e.target.closest(INTERACTIVE) : null;
    if (!el || el.disabled) return;
    presses.set(e.pointerId, { el, c: centre(el), label: name(el), t: performance.now(), x: e.clientX, y: e.clientY, hold: el.classList.contains('is-hold') });
  }, true);
  addEventListener('pointerup', (e) => {
    const p = presses.get(e.pointerId);
    if (!p) return;
    presses.delete(e.pointerId);
    const ms = Math.round(performance.now() - p.t);
    const at = `${Math.round(p.x)},${Math.round(p.y)} in ${innerWidth}x${innerHeight}`;
    // a hold-to-confirm button (ui/holdConfirm.js) acts when the hold completes, before the release: its dialog closing then is the press working
    const held = p.hold && document.documentElement.hasAttribute('data-hold-confirm');
    if (!p.el.isConnected) { if (!held) report({ kind: 'removed under the press', el: p.label, ms, at }); return; }
    const c = centre(p.el);
    if (c.w === 0 && c.h === 0) { if (!held) report({ kind: 'hidden under the press', el: p.label, ms, at }); return; }
    const d = Math.hypot(c.x - p.c.x, c.y - p.c.y);
    if (d > SHIFT_MAX) report({ kind: 'moved under the press', el: p.label, ms, at, d: +d.toFixed(1), dx: +(c.x - p.c.x).toFixed(1), dy: +(c.y - p.c.y).toFixed(1) });
  }, true);
  addEventListener('pointercancel', (e) => { presses.delete(e.pointerId); }, true);
}
