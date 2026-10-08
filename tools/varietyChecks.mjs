// Real-browser checks for a varied map (DESIGN 10.13; docs/briefs/phase3-hookup.md): run by tools/check.mjs (`--only=variety`), desktop and phone, on
// seed 9 (every region type and twist). Real pointer / touch input wherever a press or a drag matters; dev hooks only to set the stage (a path of
// conquests to the region, troops, a forced event) and to read state.
//   1. the map and the card: a typed region's label datum and its card rows (type, twist, the Lair's boss line)
//   2. Siege: a drag from the War Camp to the shut keep says "No route: take the Gate first"; a real send takes the Gate; the keep opens
//   3. Raid: holding all three Shrines for the hold wins the battle (the last one taken with a real drag)
//   4. Holy Ground: a real press on a power is refused with the Holy Ground toast; nothing is cast
//   5. Night: unscouted garrisons read "?"; scouted, they read their numbers
//   6. the Dragon: the telegraph comes (the HUD says so), and the Lair falls with its Dragon (a win, Dragonscale, the Realm panel line)
//   7. world events: the Merchant's deals (a real press buys the Renown), a Duel declined, the Plague acknowledged; a Duel lost (no occupation)
//      and a Duel won (Renown)
//   8. the tutorial hints V1-V5, measured by tools/hintMonitor.js (placed, never covering their target)
import { makeOpen, settledCentre } from './robustChecks.mjs';

const P = 0; // PLAYER_FACTION / PLAYER_OWNER

async function scenario(open, BASE, ok, sleep, allErrors, { width, height, mobile, name }) {
  const t = await open(`${BASE}/index.html?dev=1&seed=9`, { width, height, mobile });
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const tag = (s) => `variety ${name}: ${s}`;
  const press = async (x, y) => {
    if (mobile) {
      await t.page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await sleep(70);
      await t.page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await t.page.mouse('mouseMoved', x, y, 'none', 0);
      await t.page.mouse('mousePressed', x, y, 'left', 1);
      await sleep(70);
      await t.page.mouse('mouseReleased', x, y, 'left', 0);
    }
  };
  /** A real drag from a to b; `during` runs while the pointer is still down over b. */
  const drag = async (a, b, during) => {
    const N = 12;
    if (mobile) {
      await t.page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
      for (let k = 1; k <= N; k++) { await t.page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * k) / N, y: a.y + ((b.y - a.y) * k) / N, id: 1 }] }); await sleep(30); }
      await sleep(250);
      const r = during ? await during() : null;
      await t.page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      return r;
    }
    await t.page.mouse('mouseMoved', a.x, a.y, 'none', 0);
    await t.page.mouse('mousePressed', a.x, a.y, 'left', 1);
    for (let k = 1; k <= N; k++) { await t.page.mouse('mouseMoved', a.x + ((b.x - a.x) * k) / N, a.y + ((b.y - a.y) * k) / N, 'left', 1); await sleep(30); }
    await sleep(250);
    const r = during ? await during() : null;
    await t.page.mouse('mouseReleased', b.x, b.y, 'left', 0);
    return r;
  };
  const centre = (sel, txt) => q((s, tx) => {
    const e = [...document.querySelectorAll(s)].find((x) => x.getClientRects().length && !x.closest('[hidden]') && (!tx || x.textContent.includes(tx)));
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel, txt || null);
  const pressSel = async (sel, txt) => { const c2 = await settledCentre(() => centre(sel, txt), sleep); if (!c2) return false; await press(c2.x, c2.y); return true; };
  const siteAt = (id) => q((x) => { const s = window.__hd.siteInfo().find((y) => y.id === x); return s ? { x: s.x, y: s.y + 4 } : null; }, id);

  const HELPERS = () => {
    const hd = window.__hd;
    window.__v = {
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
    };
    return true;
  };
  const toWorld = async () => {
    await q(() => { window.__v.clear(); window.__hd.battles.setSpeed(1); window.__hd.goto.world({ cameFromBattle: true }); });
    await t.waitFor(() => window.__hd.scene === 'world', 10000);
    await sleep(1200);
  };
  const battleOn = async (src) => {
    const id = await q((s) => { const f = new Function('r', `return ${s}`); const id = window.__v.region(f); if (id == null) return null; window.__v.reach(id); window.__hd.selectRegion(null); window.__hd.startBattle(id); return id; }, src);
    if (id == null) return null;
    const live = await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000);
    await sleep(900);
    return live ? id : null;
  };

  try {
    ok(await t.atTitle(), tag('boots'));
    ok(await t.clickText('button', 'New Realm'), tag('New Realm'));
    ok(await t.waitFor(() => window.__hd.scene === 'world', 40000), tag('the world is up'));
    await q(HELPERS);
    // hints ON for the tutorial part: every earlier step counts as seen, so only the varied map's steps (V1-V5) can show
    await q(async () => {
      const hd = window.__hd;
      hd.hideDev(true);
      const { TUTORIAL_STEPS } = await import(new URL('game/scenes/timing.js', document.baseURI).href);
      hd.state.tutorial.seen = Object.fromEntries(TUTORIAL_STEPS.filter((s) => !/^V/.test(s.id)).map((s) => [s.id, true]));
      hd.state.settings.hints = true;
      hd.state.stats.battlesWon = 6;
      hd.conquerRegions(3);
      for (const id of ['rally', 'firestorm', 'bulwark', 'march', 'levy']) hd.state.upgrades[id] = 2;
      hd.grantGold(200000);
      const m = await import(new URL('tools/hintMonitor.js', document.baseURI).href); m.installHintMonitor();
    });
    await toWorld();

    // 8a. V1 on the map: a typed or twisted region on the frontier
    await q(() => { const id = window.__v.region((r) => !!(r.type || r.twist)); window.__v.reach(id); window.__hd.goto.world({ cameFromBattle: true }); });
    await sleep(2500);
    ok(await t.waitFor(() => { const c = document.querySelector('.coach'); return !!c && !c.hidden && /treasure or a twist/i.test(c.textContent); }, 12000), tag('V1: the "treasure or a twist" hint shows on the map'));

    // 1. the card rows
    const typed = await q(() => window.__v.region((r) => r.type === 'dragon'));
    await q((id) => { window.__v.reach(id); window.__hd.selectRegion(id); }, typed);
    await sleep(1400);
    const card = await q(() => ({
      type: document.querySelector('.region-card-feature.is-type:not([hidden]) .region-card-feature-name')?.textContent || null,
      boss: !!document.querySelector('.region-card-boss:not([hidden])'),
      glyph: document.querySelector('.region-card-feature.is-type canvas')?.dataset.glyph || null,
    }));
    ok(card.type === "Dragon's Lair" && card.boss && card.glyph === 'type:dragon', tag(`the Dragon's Lair card: type row, its glyph and "Boss: the dragon must fall" (${JSON.stringify(card)})`));
    const twisted = await q(() => window.__v.region((r) => r.twist === 'raid'));
    await q((id) => { window.__v.reach(id); window.__hd.selectRegion(id); }, twisted);
    await sleep(1200);
    ok(await q(() => /Hold all 3 Shrines/.test(document.querySelector('.region-card-feature.is-twist:not([hidden])')?.textContent || '')), tag('a Raid card says "Hold all 3 Shrines for 10 s to win"'));
    await q(() => window.__hd.selectRegion(null));

    // 8b. V5 + 7. world events
    const merchant = await q(() => window.__hd.offerEvent('merchant'));
    ok(!!merchant && merchant.kind === 'merchant', tag('a Merchant is offered'));
    await sleep(900);
    ok(await t.waitFor(() => { const c = document.querySelector('.coach'); return !!c && !c.hidden && /a world event/i.test(c.textContent); }, 8000), tag('V5: the world-event hint points at the offer'));
    ok(await q(() => /deal|merchant/i.test(document.querySelector('.toast[data-id="world-event"]')?.textContent || '')), tag('the Merchant toast is up with its countdown'));
    // the toast moves when a leader's banner (the neighbour grumbling about the caravan) slides in above it: press once it has stood still
    const seeDeals = '.toast[data-id="world-event"]:not(.is-out) .toast-action:not(.toast-secondary)';
    const stillAt = async () => { let prev = null; for (let i = 0; i < 20; i++) { const c = await centre(seeDeals); if (c && prev && Math.abs(c.x - prev.x) < 1 && Math.abs(c.y - prev.y) < 1) return c; prev = c; await sleep(150); } return prev; };
    let at = await stillAt();
    if (at) await press(at.x, at.y);
    ok(!!at, tag('a real press on "See deals"'));
    let opened = await t.waitFor(() => !!document.querySelector('.modal.is-merchant, .is-merchant'), 2500);
    if (!opened && (at = await stillAt())) { await press(at.x, at.y); opened = await t.waitFor(() => !!document.querySelector('.modal.is-merchant, .is-merchant'), 2500); } // once more if the first press landed mid-slide
    ok(opened, tag('the Merchant\'s deals open'));
    const renown0 = await q(() => window.__hd.state.renown.points);
    await sleep(300);
    ok(await pressSel('.merchant-buy-renown'), tag('a real press on the Renown deal'));
    await sleep(600);
    ok(await q((r0) => window.__hd.state.renown.points > r0 && !window.__hd.state.worldEvents.pending, renown0), tag('the Renown is bought and the offer is closed'));
    const duel1 = await q(() => window.__hd.offerEvent('duel'));
    ok(!!duel1 && duel1.kind === 'duel', tag('a Duel is offered'));
    await sleep(700);
    ok(await pressSel('.toast[data-id="world-event"]:not(.is-out) .toast-secondary'), tag('a real press on Decline'));
    await sleep(500);
    ok(await q(() => !window.__hd.state.worldEvents.pending && window.__hd.battles.list().length === 0), tag('the Duel is declined: no battle'));
    const plague = await q(() => window.__hd.offerEvent('plague'));
    ok(!!plague && plague.kind === 'plague', tag('a Plague is reported'));
    await sleep(700);
    ok(await q(() => !!window.__hd.state.worldEvents.plague), tag('the Plague applies at once (the map tints the faction)'));
    // the declined Duel's toast may still be sliding out, and on a phone the news waits behind a leader's banner: wait for the live one
    await t.waitFor(() => [...document.querySelectorAll('.toast[data-id="world-event"]:not(.is-out) .toast-action')].some((b) => b.getClientRects().length && /plague/i.test(b.closest('.toast').textContent)), 8000);
    await sleep(300);
    ok(await pressSel('.toast[data-id="world-event"]:not(.is-out) .toast-action'), tag('a real press on OK'));
    await t.waitFor(() => !window.__hd.state.worldEvents.pending, 3000);
    ok(await q(() => !window.__hd.state.worldEvents.pending && !!window.__hd.state.worldEvents.plague), tag('the news is dismissed; the Plague still runs'));
    for (const outcome of ['lose', 'win']) {
      const d = await q(() => window.__hd.offerEvent('duel'));
      if (!d) { ok(false, tag('a second Duel is offered')); break; }
      await sleep(600);
      const r0 = await q(() => window.__hd.state.renown.points);
      // the rival's line (a leader banner) can slide in over the toast as it opens: press again while the offer is still open
      let pressed = false;
      for (let k = 0; k < 4 && !pressed; k++) {
        await pressSel('.toast[data-id="world-event"]:not(.is-out) .toast-action:not(.toast-secondary)');
        pressed = await t.waitFor(() => !window.__hd.state.worldEvents.pending, 1500);
      }
      ok(pressed, tag(`a real press on Accept (duel to ${outcome})`));
      const fought = await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live' && window.__hd.battles.list().some((r) => r.kind === 'duel'), 30000);
      if (!fought) console.log('   duel debug:', JSON.stringify(await q(() => ({ scene: window.__hd.scene, phase: window.__hd.battlePhase, runs: window.__hd.battles.list().map((r) => [r.kind, r.regionId]), pending: window.__hd.state.worldEvents.pending, toasts: [...document.querySelectorAll('.toast')].map((n) => n.textContent.slice(0, 90)), dialog: document.documentElement.hasAttribute('data-dialog'), coach: document.querySelector('.coach:not([hidden])')?.textContent || null }))), JSON.stringify(t.errors.slice(-3)));
      ok(fought, tag('the Duel is fought in the battle scene'));
      if (!fought) break;
      await sleep(800);
      ok(await q(() => { const f = window.__hd.featureInfo(); return f.twist === 'holy' && f.powers.every((p) => p.holy); }), tag('a Duel has no powers (Holy Ground)'));
      await q((o) => (o === 'win' ? window.__hd.winBattle() : window.__hd.loseBattle()), outcome);
      const res = outcome === 'win' ? 'duelWon' : 'duelLost';
      ok(await t.waitFor((r) => { const c = document.querySelector('.results-card'); return !!c && !c.hidden && c.dataset.result === r; }, 20000, res), tag(`the Duel's own card (${res})`));
      await sleep(900);
      ok(await t.clickText('.results-action', 'Continue'), tag('Continue'));
      ok(await t.waitFor(() => window.__hd.scene === 'world', 15000), tag('back on the map'));
      await sleep(600);
      const after = await q((rid) => ({ owner: window.__hd.state.owner[rid], occ: !!(window.__hd.state.occupation && window.__hd.state.occupation[rid]), renown: window.__hd.state.renown.points }), d.regionId);
      ok(after.owner === P && !after.occ, tag(`after a Duel ${outcome === 'win' ? 'won' : 'lost'} the region is still yours, never occupied`));
      if (outcome === 'win') ok(after.renown > r0, tag(`a Duel won pays Renown (${r0} -> ${after.renown})`));
      else ok(after.renown === r0, tag('a Duel lost costs nothing'));
    }

    // 2. Siege + 8c. V2
    if (await battleOn("r.twist === 'siege'")) {
      ok(await t.waitFor(() => { const c = document.querySelector('.coach'); return !!c && !c.hidden && /take the gate to open the keep/i.test(c.textContent); }, 8000), tag('V2: "Take the Gate to open the keep"'));
      const ids = await q(() => { const hd = window.__hd; const b = hd.battle; return { camp: b.sites.find((s) => s.type === 'camp' && s.owner === 0)?.id, keep: b.sites.find((s) => s.type === 'keep' && s.owner !== 0 && hd.world.tiles[s.tile].region === b.arena.regionId)?.id, gate: b.sites.find((s) => s.type === 'gate')?.id }; });
      ok(ids.camp != null && ids.keep != null && ids.gate != null, tag('the Siege arena has its Gate'));
      ok(await q((k) => window.__hd.featureInfo().noRoute.includes(k), ids.keep), tag('the keep is shut while the Gate stands'));
      const a = await siteAt(ids.camp); const kp = await siteAt(ids.keep);
      if (a && kp) {
        const tip = await drag(a, kp, () => q(() => { const e = document.querySelector('.tooltip'); return e && !e.hidden ? e.textContent : ''; }));
        ok(/take the Gate first/.test(tip), tag(`a drag to the keep says "No route: take the Gate first" ("${tip}")`));
      }
      // the front-line rule may keep the Gate out of the War Camp's reach at first: the settlements in the way are handed over until a send can reach it
      await q(async (c, g) => {
        const S = await import(new URL('game/battle/sim.js', document.baseURI).href);
        const b = window.__hd.battle;
        for (let k = 0; k < 8 && !S.canRoute(b, 0, c, g); k++) {
          const next = b.sites.find((s) => s.owner !== 0 && s.type !== 'gate' && s.type !== 'keep' && S.canRoute(b, 0, c, s.id));
          if (!next) break;
          next.owner = 0; next.troops = 30;
        }
      }, ids.camp, ids.gate);
      // a capital's Gate is refilled by its keep faster than an early army can break it: the stage keeps it empty (the capture itself is the real send's)
      await q((c, g) => { const b = window.__hd.battle; b.sites[g].troops = 0; b.sites[c].troops = 40000; window.__gateHold = setInterval(() => { const bb = window.__hd.battle; if (bb && bb.sites[g] && bb.sites[g].owner !== 0) bb.sites[g].troops = 0; }, 100); }, ids.camp, ids.gate);
      // both on screen (a phone frames the arena tighter): the camera centres between the War Camp and the Gate
      await q((c, g) => { const hd = window.__hd; const b = hd.battle; const A = hd.world.tiles[b.sites[c].tile]; const G = hd.world.tiles[b.sites[g].tile]; hd.camera.flyTo({ x: (A.x + G.x) / 2, y: (A.y + G.y) / 2 }, 1); }, ids.camp, ids.gate);
      await sleep(500);
      const gp = await siteAt(ids.gate); const a2 = await siteAt(ids.camp);
      if (gp && a2) await drag(a2, gp);
      await sleep(600);
      // no squad left the camp (a phone drag can land as a pan when the camera is still settling): select the camp and tap the Gate instead, also real input
      if (!(await q(() => window.__hd.battle.squads.some((x) => x.owner === 0)))) {
        const a3 = await siteAt(ids.camp); const g3 = await siteAt(ids.gate);
        if (a3 && g3) { await press(a3.x, a3.y); await sleep(250); await press(g3.x, g3.y); }
      }
      await q(() => window.__hd.battles.setSpeed(3));
      ok(await t.waitFor((g) => window.__hd.battle.sites[g].owner === 0, 40000, ids.gate), tag('a real send takes the Gate'));
      await q(() => clearInterval(window.__gateHold));
      await sleep(400);
      ok(await q((k) => !window.__hd.featureInfo().noRoute.includes(k) && /Gate breached/.test(window.__hd.featureInfo().hud.text), ids.keep), tag('the keep opens; the HUD says Gate breached'));
      await toWorld();
    } else ok(false, tag('a Siege battle starts'));

    // 3. Raid + 8d. V3
    if (await battleOn("r.twist === 'raid'")) {
      ok(await t.waitFor(() => { const c = document.querySelector('.coach'); return !!c && !c.hidden && /hold all three shrines/i.test(c.textContent); }, 8000), tag('V3: "Hold all three Shrines for 10 s to win"'));
      // the Shrine the War Camp can reach is taken for real; the other two are handed over (the front-line rule keeps far ones out of reach at first)
      const sh = await q(async () => {
        const S = await import(new URL('game/battle/sim.js', document.baseURI).href);
        const b = window.__hd.battle; const list = b.sites.filter((s) => s.type === 'shrine'); const camp = b.sites.find((s) => s.type === 'camp' && s.owner === 0);
        const last = list.find((s) => S.canRoute(b, 0, camp.id, s.id)) || list[list.length - 1];
        for (const s of list) if (s !== last) { s.owner = 0; s.troops = 40; }
        last.troops = 0; camp.troops = 2000;
        return { last: last.id, camp: camp.id, n: list.length, reachable: S.canRoute(b, 0, camp.id, last.id) };
      });
      ok(sh.reachable, tag('a Shrine is within the War Camp reach'));
      ok(sh.n === 3, tag('the Raid arena has three Shrines'));
      const a = await siteAt(sh.camp); const l = await siteAt(sh.last);
      if (a && l) await drag(a, l);
      await sleep(600);
      if (!(await q(() => window.__hd.battle.squads.some((x) => x.owner === 0)))) { // a drag landed as a pan: select and tap, also real input
        const a3 = await siteAt(sh.camp); const l3 = await siteAt(sh.last);
        if (a3 && l3) { await press(a3.x, a3.y); await sleep(250); await press(l3.x, l3.y); }
      }
      await q(() => window.__hd.battles.setSpeed(3));
      ok(await t.waitFor(() => /hold \d+ s/.test(window.__hd.featureInfo()?.hud?.text || ''), 30000), tag('all three held: the HUD counts the hold down'));
      ok(await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden && c.dataset.result === 'victory'; }, 40000), tag('holding the Shrines wins the battle'));
      await toWorld();
    } else ok(false, tag('a Raid battle starts'));

    // 4. Holy Ground
    if (await battleOn("r.twist === 'holy'")) {
      const cd0 = await q(() => JSON.stringify(window.__hd.battle.cooldowns));
      ok(await pressSel('.power-btn'), tag('a real press on a power'));
      await sleep(500);
      // on a phone a toast waits while a leader's banner speaks (the battle's opening line): on screen, or posted and waiting, both count
      ok(await t.waitFor(() => /Holy Ground/.test(document.querySelector('.toasts')?.textContent || '') || window.__hd.services.ui.toasts.has('holy'), 6000), tag('the Holy Ground toast says why'));
      ok(await q((c) => JSON.stringify(window.__hd.battle.cooldowns) === c && !window.__hd.battle.commands.some((x) => x.type === 'power'), cd0), tag('nothing is cast'));
      ok(await q(() => /Holy Ground/.test(document.querySelector('.power-btn')?.getAttribute('aria-label') || '')), tag('the power buttons say "cannot be used on Holy Ground"'));
      await toWorld();
    } else ok(false, tag('a Holy Ground battle starts'));

    // 5. Night
    const night = await battleOn("r.twist === 'night'");
    if (night != null) {
      const hidden = await q(() => window.__hd.featureInfo().hidden.length);
      ok(hidden > 0, tag(`Night: unscouted garrisons read "?" (${hidden})`));
      await q((rid) => { const s = window.__hd.state; s.intel = s.intel || {}; s.intel[rid] = { ...(s.intel[rid] || {}), scouted: true }; }, night);
      await sleep(500);
      ok(await q(() => window.__hd.featureInfo().hidden.length === 0), tag('Night: scouted, they read their numbers'));
      await toWorld();
    } else ok(false, tag('a Night battle starts'));

    // 6. the Dragon + 8e. V4
    if (await battleOn("r.type === 'dragon'")) {
      ok(await t.waitFor(() => !!(window.__hd.battle.dragon && window.__hd.battle.dragon.breath), 30000), tag('the Dragon telegraphs its breath'));
      ok(await q(() => /fire incoming/i.test(window.__hd.featureInfo().hud.text)), tag('the HUD says "fire incoming"'));
      ok(await t.waitFor(() => { const c = document.querySelector('.coach'); return !!c && !c.hidden && /bulwark the target/i.test(c.textContent); }, 3000), tag('V4: "Bulwark the target!"'));
      // the Lair falls with its Dragon: the player's side on Auto (the steward) with a strong army, at 3x
      // (the steward alone sometimes never assaults the Dragon's perch: after 60 s of battle time every site of ours is sent at the perch now and then, real sends)
      await q(async () => {
        const hd = window.__hd; const run = hd.battles.list()[0]; hd.battles.setAuto(run.id, true); hd.battles.setSpeed(3);
        const S = await import(new URL('game/battle/sim.js', document.baseURI).href);
        let lastPush = 0;
        window.__dragonBoost = setInterval(() => {
          const b = hd.battle; if (!b || b.result) return;
          for (const s of b.sites) if (s.owner === 0) s.troops = Math.max(s.troops, 3000);
          const dr = b.dragon;
          if (dr && dr.hp > 0 && dr.perch >= 0 && b.t > 60 && b.t - lastPush > 6) {
            lastPush = b.t;
            const from = b.sites.filter((s) => s.owner === 0).map((s) => s.id);
            if (from.length) S.issue(b, { type: 'send', owner: 0, from, to: dr.perch, fraction: 0.5 });
          }
        }, 700);
      });
      const won = await t.waitFor(() => { const b = window.__hd.battle; return b && b.result === 'win'; }, 240000);
      await q(() => clearInterval(window.__dragonBoost));
      ok(won, tag('the Lair is won'));
      ok(await q(() => window.__hd.battle.dragon.dead), tag('... with its Dragon down'));
      ok(await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden && c.dataset.result === 'victory'; }, 30000), tag('Victory card'));
      await sleep(1200);
      await t.clickText('.results-action', 'Continue');
      ok(await t.waitFor(() => window.__hd.scene === 'world' && window.__hd.state.boons.dragonscale === true, 15000), tag('Dragonscale is the realm\'s'));
      await sleep(800);
      ok(await pressSel('.hud-btn[aria-label="Realm stats"]'), tag('a real press on Realm'));
      await sleep(700);
      ok(await q(() => /Dragonscale/.test(document.querySelector('.realm-boon:not([hidden])')?.textContent || '')), tag('the Realm panel shows Dragonscale'));
      await pressSel('.realm-close');
    } else ok(false, tag('a Dragon battle starts'));

    // 8f. the monitor's verdict on every V hint that showed
    const rep = await q(() => window.__hm.report());
    const vh = rep.hints.filter((h) => /treasure or a twist|take the gate|hold all three shrines|bulwark the target|a world event/i.test(h.text));
    ok(vh.length >= 5, tag(`the hint monitor measured the five varied-map hints (${vh.length})`));
    for (const h of vh) ok(Object.keys(h.problems).length === 0, tag(`hint placed: "${h.text.slice(0, 48)}" (worst tip ${h.worstTip} px${Object.keys(h.problems).length ? `; ${JSON.stringify(h.problems).slice(0, 200)}` : ''})`));
    const errs = t.unexpected();
    ok(errs.length === 0, tag(`no console errors${errs.length ? `: ${errs[0]}` : ''}`));
    allErrors.push(...errs);
  } catch (e) {
    ok(false, tag(`scenario threw: ${e && e.message}`));
  }
  await t.page.close();
}

export async function varietyChecks({ launch, BASE, ok, sleep, allErrors }) {
  console.log('\n== variety: types and twists on the map and card, Siege, Raid, Holy Ground, Night, the Dragon, world events, the Duel, hints V1-V5 ==');
  const open = makeOpen(launch, sleep);
  const only = process.env.VARIETY_ONLY || '';
  if (!only || only === 'desktop') await scenario(open, BASE, ok, sleep, allErrors, { width: 1440, height: 900, mobile: false, name: 'desktop' });
  if (!only || only === 'phone') await scenario(open, BASE, ok, sleep, allErrors, { width: 390, height: 844, mobile: true, name: 'phone' });
}
