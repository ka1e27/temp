// The new player of tools/firstHour.mjs: real mouse / touch presses at a human-ish pace. Dev hooks are only READ (positions, the drag preview,
// difficulty labels) plus a camera flight to a region that is off screen; every decision is pressed. One step per call; the driver loops.
export function createBot(page, { touch = false, W, H, log, shopStyle = 'three' }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ev = (fn, ...a) => page.eval(fn, ...a);
  const tap = async (x, y) => {
    if (touch) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await sleep(70);
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse('mouseMoved', x, y, 'none', 0); await sleep(40);
      await page.mouse('mousePressed', x, y, 'left', 1); await sleep(60);
      await page.mouse('mouseReleased', x, y, 'left', 0);
    }
  };
  const drag = async (a, b) => {
    if (!touch) return page.drag(a, b, 14);
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
    for (let i = 1; i <= 14; i++) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 14, y: a.y + ((b.y - a.y) * i) / 14, id: 1 }] });
      await sleep(16);
    }
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  /** Centre of the first visible match (optionally by text); a press only if nothing covers it. */
  const find = (sel, txt) => ev((s, t) => {
    const els = [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length > 0 && !e.closest('[hidden]') && !e.disabled);
    const el = t ? els.find((e) => new RegExp(t, 'i').test(e.textContent)) : els[0];
    if (!el) return null;
    let r = el.getBoundingClientRect();
    if (r.bottom > innerHeight || r.top < 0) { el.scrollIntoView({ block: 'center' }); r = el.getBoundingClientRect(); }
    const x = r.left + r.width / 2; const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return { x, y, hit: !!top && (top === el || el.contains(top)) };
  }, sel, txt || null);
  const press = async (sel, txt) => { const c = await find(sel, txt); if (!c) return false; await tap(c.x, c.y); return true; };
  const key = async (k, code = k) => {
    const vk = k === 'Escape' ? 27 : k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0;
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text: k.length === 1 ? k : undefined });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };

  // --- the War Council: buy what is affordable, "Best value" first (a person reads the tag) -----------------------------------------------
  async function shop(why) {
    if (shopStyle !== 'bot3') return shopThree(why);
    if (!(await press('.hud-btn[aria-label="War Council"]'))) return 0;
    await sleep(1100);
    let bought = 0;
    for (const tab of ['Army', 'Powers', 'Realm']) { // PLAN-PHASE11b: the Best value tag can sit on a Powers card
      await press('.council-tab', tab); await sleep(500);
      for (let i = 0; i < 3; i++) {
        const c = await ev((tagOnly) => {
          const cards = [...document.querySelectorAll('.upgrade-card')].filter((x) => x.getClientRects().length && x.querySelector('.upgrade-card-buy:not([disabled])'));
          const best = cards.find((x) => /best value/i.test(x.textContent)) || (tagOnly ? null : cards[0]); // Powers: only the tagged card
          if (!best) return null;
          const r = best.querySelector('.upgrade-card-buy').getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: best.querySelector('.upgrade-card-name')?.textContent };
        }, tab === 'Powers');
        if (!c) break;
        await tap(c.x, c.y); bought += 1; await sleep(700);
      }
    }
    await press('.council-close'); await sleep(600);
    log(`  council (${why}): bought ${bought}`);
    return bought;
  }

  // PLAN-PHASE11, the default shopper (tools/campaign.mjs --policy=human humanShop): it watches three cards, the Army tab's Best value, the cheapest
  // card of the Powers tab and Taxes, and presses the cheapest of them until the gold runs out. The choice is read from the game's modules; every
  // purchase is a real press on the card in its tab. --shop=bot3 keeps the Phase 10 shopper (three Army buys and three Realm buys per visit).
  async function shopThree(why) {
    if (!(await press('.hud-btn[aria-label="War Council"]'))) return 0;
    await sleep(1100);
    let bought = 0;
    let tab = null;
    for (let i = 0; i < 40; i++) {
      const pick = await ev(async () => {
        const hd = window.__hd;
        const U = await import(new URL('game/meta/upgrades.js', document.baseURI).href);
        const { bestValueUpgrade } = await import(new URL('game/app/bestValue.js', document.baseURI).href);
        const cost = (id) => U.upgradeCost(id, U.levelOf(hd.state, id));
        const best = bestValueUpgrade(hd.state, hd.world);
        const power = U.POWER_IDS.slice().sort((a, b) => cost(a) - cost(b))[0];
        const id = [best && best.id, power, 'taxes'].filter(Boolean).sort((a, b) => cost(a) - cost(b))[0];
        return id && U.canBuy(hd.state, id) ? { id, name: U.UPGRADES[id].name, tab: U.UPGRADES[id].tab } : null;
      });
      if (!pick) break;
      if (pick.tab !== tab) { await press('.council-tab', `^${pick.tab}$`); tab = pick.tab; await sleep(500); }
      const c = await ev((name) => {
        const card = [...document.querySelectorAll('.upgrade-card')].find((x) => x.getClientRects().length && x.querySelector('.upgrade-card-name')?.textContent === name);
        const b = card && card.querySelector('.upgrade-card-buy:not([disabled])');
        if (!b) return null;
        b.scrollIntoView({ block: 'center' });
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, pick.name);
      if (!c) break;
      await tap(c.x, c.y); bought += 1; await sleep(450);
    }
    await press('.council-close'); await sleep(600);
    log(`  council (${why}): bought ${bought}`);
    return bought;
  }

  // --- the map: the best Easy or Fair region (the highest power ratio), else shop and wait ------------------------------------------------
  async function pickTarget(allowHard = false) {
    return ev(async (hard) => {
      const hd = window.__hd;
      const { difficulty, attackableFrontier } = await import(new URL('game/meta/progression.js', document.baseURI).href);
      const { bestFreeGeneral } = await import(new URL('game/meta/generals.js', document.baseURI).href);
      const { commanderFor } = await import(new URL('game/meta/edicts.js', document.baseURI).href);
      // the label the map shows (world.js, PLAN-PHASE11): the card's default commander credited
      const cmd = (id) => { const g = bestFreeGeneral(hd.state, hd.world, id, 'attack', Date.now()); return commanderFor(hd.state, g ? g.id : null); };
      const ids = attackableFrontier(hd.state, hd.world);
      const rows = ids.map((id) => { const d = difficulty(hd.state, hd.world, id, { commander: cmd(id) }); return { id, label: d.label, ratio: d.ratio, surrender: !!d.surrender }; })
        .filter((r) => r.surrender || r.label === 'Easy' || r.label === 'Fair' || (hard && r.label === 'Hard')).sort((a, b) => b.ratio - a.ratio);
      return rows[0] || null;
    }, allowHard);
  }
  async function attack(target) {
    const onScreen = async () => ev((id, w, h) => {
      const p = window.__hd.regionScreenPos(id);
      if (!p || p.x < 60 || p.y < 120 || p.x > w - 420 || p.y > h - 120) return null;
      // the keep's point, or a little beside it when a hint bubble or a label covers it (a person taps the open ground of the region)
      for (const [dx, dy] of [[0, 0], [0, 26], [26, 0], [-26, 0], [0, -26], [20, 20], [-20, 20]]) {
        const e = document.elementFromPoint(p.x + dx, p.y + dy);
        if (e && e.tagName === 'CANVAS') return { x: p.x + dx, y: p.y + dy };
      }
      return null;
    }, target.id, W, H);
    let p = await onScreen();
    if (!p) { await ev((id) => window.__hd.flyToRegion(id), target.id); await sleep(1400); p = await onScreen(); }
    if (!p) { log(`  region ${target.id} not reachable on screen`); return false; }
    await tap(p.x, p.y);
    await sleep(1300); // the card slides in; a person reads it
    const c = await ev(() => { const b = [...document.querySelectorAll('.region-card-action')].find((x) => !x.hidden && x.getClientRects().length); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null; });
    if (!c || c.disabled) { log(`  no Attack on the card (${c ? c.text : 'no card'})`); await key('Escape'); return false; }
    await sleep(900);
    await press('.region-card-action', c.text.slice(0, 12).replace(/[^a-z ]/gi, '.'));
    log(`  ${c.text} -> region ${target.id} (${target.label}, ratio ${target.ratio.toFixed(2)})`);
    return true;
  }

  // --- a battle step: the drag preview says what captures (tools/playtest.mjs's player) ------------------------------------------------------
  async function battleStep(state) {
    const plan = await ev(async (vw, vh) => {
      const { previewSend } = await import(new URL('game/battle/sim.js', document.baseURI).href);
      const hd = window.__hd; const b = hd.battle;
      if (!b || hd.battlePhase !== 'live') return null;
      const all = hd.siteInfo();
      const vis = (s) => s.x > 10 && s.x < vw - 10 && s.y > 110 && s.y < vh - 190;
      const mine = all.filter((s) => s.owner === 0 && s.troops >= 7 && vis(s));
      const foes = all.filter((s) => s.owner !== 0 && vis(s));
      let best = null;
      for (const f of foes) for (const m of mine) for (const fx of [0.5, 0.75, 1]) {
        const pv = previewSend(b, [m.id], f.id, fx);
        if (pv.outcome !== 'capture') continue;
        const score = pv.arriveSec + (f.type === 'keep' ? -6 : 0) + fx * 4 + f.troops * 0.15;
        if (!best || score < best.score) best = { score, from: m, to: f, fx };
      }
      const keep = foes.find((s) => s.type === 'keep');
      let push = null;
      if (keep) {
        const ids = all.filter((s) => s.owner === 0 && s.troops >= 6 && vis(s));
        if (ids.length >= 2 && previewSend(b, ids.map((s) => s.id), keep.id, 1).outcome === 'capture') push = { from: ids, to: keep };
      }
      const frac = Number((document.querySelector('.send-fraction-btn.is-active')?.textContent || '50').replace(/\D.*$/, '')) / 100;
      const powers = [...document.querySelectorAll('.power-btn')].map((x) => { const r = x.getBoundingClientRect(); return { ready: x.classList.contains('is-ready'), x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      const weakest = foes.slice().sort((a, c) => a.troops - c.troops)[0] || null;
      const all6 = all.filter((s) => s.owner === 0 && s.troops >= 6 && vis(s));
      return { t: b.t, best, push, frac, powers, weakest, all6, strongest: foes.sort((a, c) => c.troops - a.troops)[0] || null };
    }, W, H);
    if (!plan) return;
    const setFrac = async (f) => { if (Math.abs(f - plan.frac) > 0.01) { await press('.send-fraction-btn', `${Math.round(f * 100)}%`); await sleep(250); } };
    if (plan.push || plan.best) state.lastSend = plan.t;
    if (plan.push) {
      await setFrac(1);
      for (const s of plan.push.from) { await drag({ x: s.x, y: s.y + 4 }, { x: plan.push.to.x, y: plan.push.to.y + 4 }); await sleep(220); }
    } else if (plan.best) {
      await setFrac(plan.best.fx);
      await drag({ x: plan.best.from.x, y: plan.best.from.y + 4 }, { x: plan.best.to.x, y: plan.best.to.y + 4 });
    } else if (plan.t - (state.lastSend || 0) > 40 && plan.weakest) {
      // stuck for 40 s with nothing the preview calls a capture: everything at the weakest site in sight, like a person losing patience
      // (A selects every settlement of ours, on screen or not; a click on the target sends them all)
      state.lastSend = plan.t;
      await setFrac(1);
      if (touch) { for (const s of plan.all6) { await drag({ x: s.x, y: s.y + 4 }, { x: plan.weakest.x, y: plan.weakest.y + 4 }); await sleep(220); } }
      else { await key('a', 'KeyA'); await sleep(250); await tap(plan.weakest.x, plan.weakest.y + 4); await sleep(250); await key('Escape'); }
    } else if (plan.t > 25 && plan.strongest && plan.powers[1] && plan.powers[1].ready && !state.fired) {
      state.fired = true; // Firestorm on their strongest site, once, when stuck (the hints teach it)
      await tap(plan.powers[1].x, plan.powers[1].y); await sleep(350); await tap(plan.strongest.x, plan.strongest.y);
    } else if (plan.t > 22 && plan.powers[0] && plan.powers[0].ready && !state.rallied && plan.strongest) {
      state.rallied = true;
      await tap(plan.powers[0].x, plan.powers[0].y); await sleep(350); await tap(plan.strongest.x, plan.strongest.y);
    }
  }

  return { sleep, ev, tap, drag, find, press, key, shop, pickTarget, attack, battleStep };
}
