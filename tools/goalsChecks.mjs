// Real-browser checks for Phase 4, Goals and Rivals (docs/PLAN-PHASE4.md; docs/briefs/phase4-hookup.md): run by tools/check.mjs (`--only=goals`),
// desktop and phone, seed 9. Real pointer / touch input wherever a press matters; dev hooks only to set the stage (conquests, a forced contract, a
// forced Vendetta, a world event) and to read state.
//   1. the Bounty Board opens after the first conquest beyond home: the Q1 hint on the Regions button, its dot; a real press opens the board (3 rows)
//   2. Reroll by a real press: the slot gets a new contract, the next reroll costs Renown
//   3. a contract completes and pays: a "Conquer a {type}" contract, the region taken -> seal toast, gold paid, the slot redrawn, a Chronicle line
//   4. a battle contract: "Win a battle without using a power", won -> paid through onBattleEnd
//   5. the streak: two quick conquests -> the flame chip "×1.1 · 2"; the Retreat confirm warns about it
//   6. the envelope pip: a Duel's toast closed by a real press -> the pip; a real press on it -> the toast is back
//   7. grudges: the meter on a rival's card and in the Regions panel
//   8. a Vendetta (dev hook): the red banner with Go, the Q2 hint; Go by a real press -> the defense with a Champion squad; the champion falls ->
//      "{Leader}'s champion has fallen!"; won -> the Trophy (toast, Realm wall), the grudge back to 0
//   9. the Realm panel: the Deeds grid; an earned Deed's toast
//  10. the hint monitor's verdict on Q1 / Q2
import { makeOpen, settledCentre } from './robustChecks.mjs';
import { TOASTS_DIGEST } from '../game/scenes/timing.js';

async function scenario(open, BASE, ok, sleep, allErrors, { width, height, mobile, name }) {
  const t = await open(`${BASE}/index.html?dev=1&seed=9`, { width, height, mobile });
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const tag = (s) => `goals ${name}: ${s}`;
  const press = async (x, y) => {
    if (mobile) {
      await t.page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await sleep(80);
      await t.page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await t.page.mouse('mouseMoved', x, y, 'none', 0);
      await t.page.mouse('mousePressed', x, y, 'left', 1);
      await sleep(90);
      await t.page.mouse('mouseReleased', x, y, 'left', 0);
    }
  };
  const centre = (sel, txt) => q((s, tx) => {
    const e = [...document.querySelectorAll(s)].find((x) => x.getClientRects().length && !x.closest('[hidden]') && (!tx || x.textContent.includes(tx)));
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel, txt || null);
  const pressSel = async (sel, txt) => { const c2 = await settledCentre(() => centre(sel, txt), sleep); if (!c2) return false; await press(c2.x, c2.y); return true; };
  const closePanels = () => q(() => { for (const s of ['.regions-close', '.realm-close']) { const b = document.querySelector(s); if (b && !b.closest('[hidden]')) b.click(); } });

  const HELPERS = () => {
    const hd = window.__hd;
    window.__g = {
      // take a path of regions (with the Bounty Board's hook) until `target` borders the realm
      reach(target) {
        const w = hd.world;
        const owned = (id) => hd.state.owner[id] === 0;
        if (w.regions[target].neighbors.some(owned)) return true;
        const prev = new Map();
        const queue = w.regions.filter((r) => owned(r.id)).map((r) => r.id);
        for (const id of queue) prev.set(id, -1);
        while (queue.length) {
          const cur = queue.shift();
          for (const n of w.regions[cur].neighbors) {
            if (prev.has(n) || n === target) continue;
            prev.set(n, cur);
            if (w.regions[target].neighbors.includes(n)) {
              const chain = [];
              for (let x = n; x !== -1 && !owned(x); x = prev.get(x)) chain.unshift(x);
              for (const id of chain) hd.conquerRegion(id);
              return true;
            }
            queue.push(n);
          }
        }
        return false;
      },
      clear() { for (const r of hd.battles.list()) hd.battles.remove(r.id); },
      region(pred) { const r = hd.world.regions.find((x) => hd.state.owner[x.id] !== 0 && pred(x)); return r ? r.id : null; },
      slots() { return (hd.state.bounties && hd.state.bounties.slots || []).map((c) => c && { id: c.id, kind: c.kind, done: !!c.done, params: c.params }); },
      coach() { const c = document.querySelector('.coach'); return c && !c.hidden ? c.textContent : ''; },
    };
    return true;
  };
  const toWorld = async () => {
    await q(() => { window.__g.clear(); window.__hd.battles.setSpeed(1); window.__hd.goto.world({ cameFromBattle: true }); });
    await t.waitFor(() => window.__hd.scene === 'world', 10000);
    await sleep(1000);
  };

  try {
    ok(await t.atTitle(), tag('boots'));
    ok(await t.clickText('button', 'New Realm'), tag('New Realm'));
    ok(await t.waitFor(() => window.__hd.scene === 'world', 40000), tag('the world is up'));
    await q(HELPERS);
    // hints ON: every step before Phase 4 counts as seen, so only Q1 / Q2 can show
    await q(async () => {
      const hd = window.__hd;
      hd.hideDev(true);
      const { TUTORIAL_STEPS } = await import(new URL('game/scenes/timing.js', document.baseURI).href);
      hd.state.tutorial.seen = Object.fromEntries(TUTORIAL_STEPS.filter((s) => !/^Q/.test(s.id)).map((s) => [s.id, true]));
      hd.state.settings.hints = true;
      hd.state.stats.battlesWon = 3;
      hd.grantGold(50000);
      const m = await import(new URL('tools/hintMonitor.js', document.baseURI).href); m.installHintMonitor();
    });
    ok(await q(() => !(window.__hd.state.bounties && window.__hd.state.bounties.unlocked)), tag('no board before the first conquest beyond home'));

    // 1. the board opens
    await q(() => window.__hd.conquerRegions(1));
    ok(await t.waitFor(() => !!(window.__hd.state.bounties && window.__hd.state.bounties.unlocked), 8000), tag('the board opens after the first conquest'));
    ok(await t.waitFor(() => { const d = document.querySelector('.hud-regions .hud-dot'); return !!d && !d.hidden; }, 5000), tag('the Regions button wears a dot'));
    ok(await t.waitFor(() => /bounty board/i.test(window.__g.coach()), 15000), tag('Q1: "New: the Bounty Board" hint shows'));
    ok(await pressSel('.hud-regions'), tag('a real press on Regions'));
    ok(await t.waitFor(() => { const b = document.querySelector('.bounty-board'); return !!b && !b.hidden && document.querySelectorAll('.bounty-row').length === 3; }, 5000), tag('the board shows three contracts'));
    const kinds = await q(() => window.__g.slots().map((c) => c && c.kind));
    ok(new Set(kinds).size === kinds.length, tag(`no two contracts share a kind (${kinds.join(', ')})`));
    ok(await t.waitFor(() => document.querySelector('.hud-regions .hud-dot').hidden, 3000), tag('the dot goes out once the board is seen'));
    ok(await t.waitFor(() => !/bounty board/i.test(window.__g.coach()), 4000), tag('Q1 leaves once the board is opened'));

    // 2. reroll
    const before = await q(() => window.__g.slots()[0]);
    ok(await pressSel('.bounty-row[data-slot="0"] .bounty-reroll'), tag('a real press on Reroll'));
    await sleep(500);
    const after = await q(() => window.__g.slots()[0]);
    ok(after && before && after.id !== before.id && after.kind !== before.kind, tag(`Reroll draws a different contract (${before && before.kind} -> ${after && after.kind})`));
    ok(await q(() => /new contract/i.test(document.querySelector('.bounty-status').textContent)), tag('the board says so'));
    ok(await q(() => /1/.test(document.querySelector('.bounty-row[data-slot="0"] .bounty-reroll-cost').textContent)), tag('the next reroll costs Renown'));
    await closePanels();
    await sleep(400);

    // 3. a "Conquer a {type}" contract completes and pays
    const typed = await q(() => window.__hd.bounty('typed'));
    ok(!!typed, tag('a "Conquer a {type}" contract is on the board'));
    if (typed) {
      const target = await q((type) => window.__g.region((r) => r.type === type), typed.contract.params.type);
      await q((id) => window.__g.reach(id), target);
      const gold0 = await q(() => window.__hd.state.gold);
      const reward = typed.contract.reward.gold;
      const conquest = await q(async (id) => {
        const P = await import(new URL('game/meta/progression.js', document.baseURI).href);
        return P.conquestBounty(window.__hd.state, window.__hd.world, id);
      }, target);
      await q((id) => window.__hd.conquerRegion(id, { hooks: true }), target);
      ok(await t.waitFor(() => [...document.querySelectorAll('.toast.is-sealed')].some((n) => /contract complete/i.test(n.textContent)), 5000 + TOASTS_DIGEST.windowMs), tag('the completion toast wears the seal')); // (+ the post-battle digest window, Phase 10A)
      const gold1 = await q(() => window.__hd.state.gold);
      ok(gold1 - gold0 >= reward * 0.9 + conquest * 0.9, tag(`the contract paid (gold +${Math.round(gold1 - gold0)}, reward ~${Math.round(reward)} + conquest ${Math.round(conquest)})`));
      const slot = await q((s) => window.__g.slots()[s], typed.slot);
      ok(slot && slot.id !== typed.contract.id, tag('a new contract fills the slot'));
      ok(await q(() => JSON.stringify(window.__hd.state.chronicle).includes('contract was fulfilled')), tag('a Chronicle line'));
    }

    // 5. the streak: that conquest and one more, quickly
    await q(() => { const id = window.__g.region((r) => r.neighbors.some((n) => window.__hd.state.owner[n] === 0)); window.__hd.conquerRegion(id, { hooks: true }); });
    ok(await t.waitFor(() => { const c = document.querySelector('.hud-streak'); return !!c && !c.hidden && /×1\.\d · \d/.test(c.textContent); }, 4000), tag('the flame chip shows after quick conquests'));
    const chip = await q(() => document.querySelector('.hud-streak').textContent);
    ok(/×1\.[1-5] · [2-9]/.test(chip), tag(`the chip reads ${chip}`));

    // 4. a battle contract: no powers
    const np = await q(() => window.__hd.bounty('noPowers'));
    ok(!!np, tag('"Win a battle without using a power" is on the board'));
    const fightId = await q(() => { const id = window.__g.region((r) => r.neighbors.some((n) => window.__hd.state.owner[n] === 0) && !r.twist); window.__hd.selectRegion(null); window.__hd.startBattle(id); return id; });
    ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000), tag('a battle starts'));
    await sleep(800);
    // the Retreat confirm warns about the streak (a real press on Retreat, then "Stay")
    ok(await pressSel('.battle-retreat'), tag('a real press on Retreat'));
    ok(await t.waitFor(() => /conquest streak/i.test(document.querySelector('.modal-panel')?.textContent || ''), 3000), tag('the Retreat confirm warns about the streak'));
    await q(() => { const m = document.querySelector('.modal-panel'); const b = m && [...m.querySelectorAll('button')].find((x) => /stay|keep|cancel|not/i.test(x.textContent)); if (b) b.click(); else if (m) m.querySelector('.modal-close')?.click(); });
    await sleep(500);
    const gold2 = await q(() => window.__hd.state.gold);
    await q(() => window.__hd.winBattle());
    ok(await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden; }, 30000), tag('the victory card'));
    await sleep(900);
    await t.clickText('.results-action', 'Continue');
    ok(await t.waitFor(() => window.__hd.scene === 'world', 15000), tag('back on the map'));
    ok(await t.waitFor(() => [...document.querySelectorAll('.toast.is-sealed')].some((n) => /without using a power/i.test(n.textContent)), 6000 + TOASTS_DIGEST.windowMs), tag('"Win a battle without using a power" completes and pays'));
    ok(await q((g) => window.__hd.state.gold > g, gold2), tag('gold went up'));
    void fightId;

    // 9. deeds: the streak passed 3 -> Unstoppable (bronze)
    ok(await q(() => (window.__hd.state.generals.deeds.earned.unstoppable || 0) >= 1), tag('the Unstoppable deed is earned'));
    ok(await pressSel('.hud-btn[aria-label="Realm stats"]'), tag('a real press on Realm'));
    await sleep(800);
    const realm = await q(() => ({ deeds: document.querySelectorAll('.deed').length, earned: document.querySelectorAll('.deed[data-tier="1"], .deed[data-tier="2"], .deed[data-tier="3"]').length, wall: !document.querySelector('.realm-trophies').hidden }));
    ok(realm.deeds >= 12 && realm.earned >= 1, tag(`the Deeds grid (${realm.deeds} deeds, ${realm.earned} earned)`));
    await closePanels();
    await sleep(400);

    // 6. the envelope pip
    await q(() => window.__hd.offerEvent('duel'));
    ok(await t.waitFor(() => !!document.querySelector('.toast.is-event .toast-close'), 12000), tag('a Duel is offered'));
    ok(await pressSel('.toast.is-event .toast-close'), tag('a real press closes the offer'));
    ok(await t.waitFor(() => { const p = document.querySelector('.hud-event-pip'); return !!p && !p.hidden; }, 4000), tag('the envelope pip shows while the offer is open'));
    ok(await pressSel('.hud-event-pip'), tag('a real press on the pip'));
    ok(await t.waitFor(() => !!document.querySelector('.toast.is-event:not(.is-out)'), 3000), tag('the offer is back'));
    await q(() => { const ev = window.__hd.state.worldEvents.pending; if (ev) window.__hd.events.answer(ev.id, 'decline'); });
    await sleep(500);

    // 7. grudges: a rival's card and the Regions panel
    const rival = await q(() => window.__g.region((r) => window.__hd.state.owner[r.id] > 1 && r.neighbors.some((n) => window.__hd.state.owner[n] === 0)));
    if (rival != null) {
      await q((id) => window.__hd.selectRegion(id), rival);
      ok(await t.waitFor(() => { const g = document.querySelector('.region-card-grudge:not([hidden]) .grudge-meter'); return !!g && /\d+\/100|Broken/.test(g.textContent); }, 4000), tag('the grudge meter on a rival region card'));
      await q(() => window.__hd.selectRegion(null));
    } else ok(true, tag('(no rival borders the realm yet: card meter skipped)'));
    ok(await pressSel('.hud-regions'), tag('Regions again'));
    ok(await t.waitFor(() => document.querySelectorAll('.rival-row .grudge-meter').length >= 1, 3000), tag('rival leaders with their grudge meters'));
    await closePanels();
    await sleep(300);

    // 8. a Vendetta
    const raid = await q(() => { const r = window.__hd.vendetta(undefined, { sec: 14 }); return r && { id: r.id, faction: r.vendetta.faction, leader: r.vendetta.leader, to: r.toRegionId }; });
    ok(!!raid, tag(`a Vendetta is sworn (${raid && raid.leader})`));
    if (raid) {
      ok(await t.waitFor(() => { const n = document.querySelector('.toast.is-vendetta:not(.is-out)'); return !!n && /swears vengeance/i.test(n.textContent) && !!n.querySelector('.toast-action'); }, 12000), tag('the red Vendetta banner with Go'));
      ok(await t.waitFor(() => /a vendetta!/i.test(window.__g.coach()), 12000), tag('Q2: the first Vendetta hint shows'));
      await q(() => { window.__clk = []; const go = () => { const g = document.querySelector('.toast.is-vendetta .toast-action'); const r = g && g.getBoundingClientRect(); return r ? `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}` : 'none'; };
        const bub = () => { const b = document.querySelector('.coach-bubble'); const r = b && b.getBoundingClientRect(); return r && r.width ? `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}` : 'none'; };
        window.__clkPre = { go: go(), bubble: bub(), banner: document.querySelector('.leader-banner').dataset.state, push: document.querySelector('.toasts').style.marginTop };
        document.addEventListener('pointerdown', (e) => window.__clk.push({ down: `${e.clientX},${e.clientY}`, target: String(e.target.className && e.target.className.baseVal === undefined ? e.target.className : e.target.tagName), go: go(), bubble: bub(), banner: document.querySelector('.leader-banner').dataset.state, push: document.querySelector('.toasts').style.marginTop }), true);
        document.addEventListener('click', (e) => window.__clk.push(`click ${(e.target.className && e.target.className.baseVal === undefined ? e.target.className : e.target.tagName)} @${e.clientX},${e.clientY}`), true); });
      ok(await pressSel('.toast.is-vendetta .toast-action'), tag('a real press on Go'));
      const opened = await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live' && !!window.__hd.battle?.champion, 40000);
      if (!opened) console.log('  diag vendetta go:', JSON.stringify(await q(() => ({ pre: window.__clkPre, clicks: window.__clk, scene: window.__hd.scene, phase: window.__hd.battlePhase, runs: window.__hd.battles.list().map((r) => ({ kind: r.kind, raidId: r.raidId, champ: !!(r.battle && r.battle.champion) })), incoming: (window.__hd.state.frontier.incoming || []).map((x) => x.id), dialog: document.documentElement.dataset.dialog || null, banner: document.querySelector('.leader-banner').dataset.state, toasts: [...document.querySelectorAll('.toasts > .toast')].map((x) => x.dataset.id) }))));
      ok(opened, tag('the defense opens on arrival, with a Champion'));
      ok(await t.waitFor(() => window.__hd.battle.squads.some((s) => s.champion), 15000), tag('the Champion squad marches'));
      // the Champion falls (its squad is struck down): the moment
      await q(() => { const b = window.__hd.battle; const sq = b.squads.find((s) => s.champion); if (sq) sq.count = 0.01; for (const s of b.sites) if (s.owner === 0) s.troops = Math.max(s.troops, 2000); });
      ok(await t.waitFor(() => { const b = document.querySelector('.battle-champion-banner'); return !!b && !b.hidden && /champion has fallen/i.test(b.textContent); }, 15000), tag('"… champion has fallen!"'));
      await q(() => window.__hd.winBattle());
      ok(await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden; }, 30000), tag('the Defended card'));
      await sleep(900);
      await t.clickText('.results-action', 'Continue');
      ok(await t.waitFor(() => window.__hd.scene === 'world', 15000), tag('back on the map'));
      ok(await t.waitFor((f) => (window.__hd.state.trophies || {})[String(f)] >= 1, 6000, raid.faction), tag('a Trophy is hung'));
      ok(await q((f) => Math.floor(window.__hd.state.grudges[String(f)].value) === 0, raid.faction), tag('the grudge is back to 0'));
      ok(await pressSel('.hud-btn[aria-label="Realm stats"]'), tag('Realm'));
      ok(await t.waitFor(() => document.querySelectorAll('.trophy').length >= 1, 3000), tag('the Trophy wall shows the banner'));
      await closePanels();
    }

    // 10. the hint monitor
    const rep = await q(() => window.__hm.report());
    const qh = rep.hints.filter((h) => /bounty board|a vendetta!/i.test(h.text));
    ok(qh.length >= 2, tag(`the hint monitor measured Q1 and Q2 (${qh.length})`));
    for (const h of qh) ok(Object.keys(h.problems).length === 0, tag(`hint placed: "${h.text.slice(0, 48)}" (worst tip ${h.worstTip} px${Object.keys(h.problems).length ? `; ${JSON.stringify(h.problems).slice(0, 200)}` : ''})`));
    await toWorld();
    const errs = t.unexpected();
    ok(errs.length === 0, tag(`no console errors${errs.length ? `: ${errs[0]}` : ''}`));
    allErrors.push(...errs);
  } catch (e) {
    ok(false, tag(`scenario threw: ${e && e.message}`));
  }
  await t.page.close();
}

export async function goalsChecks({ launch, BASE, ok, sleep, allErrors }) {
  console.log('\n== goals: the Bounty Board, the streak, Deeds, the envelope pip, grudges, a Vendetta and its Champion, hints Q1-Q2 ==');
  const open = makeOpen(launch, sleep);
  const only = process.env.GOALS_ONLY || '';
  if (!only || only === 'desktop') await scenario(open, BASE, ok, sleep, allErrors, { width: 1440, height: 900, mobile: false, name: 'desktop' });
  if (!only || only === 'phone') await scenario(open, BASE, ok, sleep, allErrors, { width: 390, height: 844, mobile: true, name: 'phone' });
}
