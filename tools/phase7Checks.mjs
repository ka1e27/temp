// Real-browser checks for Phase 7, Boons and Relics (docs/PLAN-PHASE7.md; docs/briefs/phase7-hookup.md): run by tools/check.mjs (`--only=phase7`),
// desktop and phone, seed 7. Real presses wherever a press matters; dev hooks only to set the stage and to read state. Screenshots go to
// screenshots/phase7/ (the gallery) unless PHASE7_SHOTS=0.
//   1. a Relic on a frontier region: the glinting chest is drawn (its screen point is on the map), the region card shows the Relic line before you commit
//   2. Attack (a real press), win (dev hook), Continue (a real press): the Relic's claim moment, then the Boon draft with three framed cards
//   3. Reroll (a real press) costs 1 Renown and deals a new offer; the K1 hint line is on the first draft
//   4. a real press on a card takes it: owned, the draft closes, the map is reached
//   5. the claimed Relic is in the Reliquary (found, held), the Boon in the owned strip (Realm panel, a real press on its icon shows its line)
//   6. "Decide later" leaves an offer pending: the HUD's Boon chip; a press on the chip reopens it; a replaced offer shows the gentle note
//   7. a Duo via dev hooks (Scorched Earth owned, Engineers offered): the pick plays the Duo reveal; the Duo is in the strip
//   8. every rarity frame (Common, Rare, Legendary, Cursed) and the Champion's eye frame, shot
//   9. no console errors
import { mkdir } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';

const OUT = 'screenshots/phase7';

async function scenario(open, BASE, ok, sleep, allErrors, { width, height, mobile, name }) {
  const t = await open(`${BASE}/index.html?dev=1&seed=7`, { width, height, mobile });
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const tag = (s) => `phase7 ${name}: ${s}`;
  const shoot = process.env.PHASE7_SHOTS !== '0';
  const shot = async (n) => { if (shoot) { await t.page.screenshot(`${OUT}/${name}-${n}.png`); console.log(`  shot ${OUT}/${name}-${n}.png`); } };
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
  const pressSel = async (sel, txt) => { const c = await centre(sel, txt); if (!c) return false; await sleep(160); const c2 = await centre(sel, txt); if (!c2) return false; await press(c2.x, c2.y); await sleep(250); return true; };
  const shown = (sel) => q((s) => { const e = document.querySelector(s); return !!e && !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0; }, sel);
  const boons = () => q(() => JSON.parse(JSON.stringify(window.__hd.state.boons2)));
  const draftCards = () => q(() => [...document.querySelectorAll('.boon-draft .boon-card')].map((c) => ({ id: c.dataset.boon, frame: c.dataset.rarity, text: c.textContent })));

  try {
    ok(await t.atTitle(), tag('boots'));
    ok(await t.clickText('button', 'New Realm'), tag('New Realm'));
    ok(await t.waitFor(() => window.__hd.scene === 'world', 40000), tag('the world is up'));
    await q(async () => {
      const hd = window.__hd;
      window.__HD_TEST_NO_BOON_MOMENTS = false; // this check is about them
      hd.hideDev(true);
      const { TUTORIAL_STEPS } = await import(new URL('game/scenes/timing.js', document.baseURI).href);
      // every step seen except K1 (the first draft's line), so no other hint stands in the way
      hd.state.tutorial.seen = Object.fromEntries(TUTORIAL_STEPS.filter((s) => s.id !== 'K1').map((s) => [s.id, true]));
      hd.state.settings.hints = true;
      hd.conquerRegions(2); // past the tutorial ring: Boons are unlocked from the next battle won
    });
    await sleep(900);

    // 1. a Relic on the frontier: the chest glints, the card says so before you commit
    const stage = await q(async () => {
      const hd = window.__hd;
      const { frontier, difficulty } = await import(new URL('game/meta/progression.js', document.baseURI).href);
      const ids = frontier(hd.state, hd.world).sort((a, b) => hd.world.regions[a].tier - hd.world.regions[b].tier || a - b);
      // a win that drafts (PLAN-PHASE7 gate): the card reads Fair or harder at attack time (an Easy win drafts nothing)
      // read with the commander the card credits (battle.js labelAtAttack); PLAN-PHASE11's softer early ladder can leave the whole second ring Easy,
      // so then the hardest non-capital region is staged (winBattle decides the fight either way)
      const { bestFreeGeneral } = await import(new URL('game/meta/generals.js', document.baseURI).href);
      const card = (id) => { const g = bestFreeGeneral(hd.state, hd.world, id, 'attack', Date.now()); return difficulty(hd.state, hd.world, id, g ? { commander: g.id } : {}); };
      const soft = ids.filter((id) => !hd.world.regions[id].isCapital);
      const rid = soft.find((id) => card(id).label !== 'Easy') ?? soft.slice().sort((a, b) => card(a).ratio - card(b).ratio)[0] ?? ids[0];
      hd.placeRelic(rid, 'sundial');
      return { rid, placed: hd.state.relics.placed };
    });
    ok(stage.placed[stage.rid] === 'sundial', tag(`the Sundial lies in region ${stage.rid}`));
    await q((id) => window.__hd.flyToRegion(id, 40, 1), stage.rid);
    await sleep(900);
    const chest = await q(async (id) => {
      const hd = window.__hd;
      const { relicMarkPos } = await import(new URL('game/render/relicMarks.js', document.baseURI).href);
      const p = relicMarkPos(hd.camera, hd.world, id);
      return p && { ...p, onScreen: p.x > 0 && p.y > 0 && p.x < innerWidth && p.y < innerHeight, marks: hd.services.boons.relicMarks() };
    }, stage.rid);
    ok(!!chest && chest.onScreen && chest.marks.includes(stage.rid), tag(`the glinting chest is on the map (${chest && Math.round(chest.x)}, ${chest && Math.round(chest.y)})`));
    await shot('01-relic-glint');
    await q((id) => window.__hd.selectRegion(id), stage.rid);
    ok(await t.waitFor(() => { const l = document.querySelector('.region-card-relic'); return !!l && !l.hidden && /Relic: Sundial\./.test(l.textContent); }, 4000), tag('the region card shows "Relic: Sundial." before you commit'));
    await sleep(700);
    await shot('02-relic-card-line');

    // 2. Attack, win, Continue: the claim moment, then the draft
    ok(await pressSel('.region-card-action:not([hidden])'), tag('a press on Attack'));
    ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000), tag('the battle is live'));
    await q(() => window.__hd.winBattle());
    ok(await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden && c.dataset.result === 'victory'; }, 30000), tag('Victory'));
    await sleep(1600);
    ok(await t.clickText('.results-action', 'Continue'), tag('a press on Continue'));
    ok(await t.waitFor(() => { const c = document.querySelector('.relic-claim'); return !!c && !c.hidden; }, 5000), tag('the Relic claim moment plays'));
    await sleep(1300);
    await shot('03-relic-claim');
    const claimed = await q(() => ({ owned: window.__hd.state.relics.owned, found: window.__hd.state.generals.reliquary.found, text: document.querySelector('.relic-claim').textContent }));
    ok(claimed.owned.includes('sundial') && claimed.found.includes('sundial') && /Sundial/.test(claimed.text), tag('the Sundial is claimed for the dynasty and found for the Reliquary'));
    ok(await pressSel('.relic-claim'), tag('a press skips the claim moment'));
    ok(await t.waitFor(() => { const d = document.querySelector('.boon-draft'); return !!d && !d.hidden; }, 5000), tag('the Boon draft follows the result card'));
    await sleep(900);
    const first = await draftCards();
    const b0 = await boons();
    ok(first.length === 3 && first.every((c) => c.id && ['common', 'rare', 'legendary', 'cursed'].includes(c.frame)), tag(`three framed cards (${first.map((c) => `${c.id}:${c.frame}`).join(', ')})`));
    ok(!!b0.pending && b0.pending.choices.join() === first.map((c) => c.id).join(), tag('the cards are the pending offer'));
    ok(await shown('.boon-draft-hint'), tag('the first draft carries the K1 hint line'));
    await shot('04-draft');

    // 3. Reroll: 1 Renown, a new offer
    const r0 = await q(async () => { const s = window.__hd.state; const m = await import(new URL('game/meta/renownState.js', document.baseURI).href); m.earnRenown(s, 3, 'deed'); window.__hd.services.boons.refreshDraft(); return m.renownPoints(s); });
    await sleep(200);
    ok(await pressSel('.boon-reroll'), tag('a press on Reroll'));
    await sleep(700);
    const second = await draftCards();
    const r1 = await q(async () => (await import(new URL('game/meta/renownState.js', document.baseURI).href)).renownPoints(window.__hd.state));
    ok(r1 === r0 - 1, tag(`the reroll cost 1 Renown (${r0} -> ${r1})`));
    ok(second.length === 3 && second.map((c) => c.id).join() !== first.map((c) => c.id).join(), tag(`a new offer (${second.map((c) => c.id).join(', ')})`));
    const priceText = await q(() => document.querySelector('.boon-reroll').textContent);
    ok(/Reroll/.test(priceText) && /1/.test(priceText), tag(`Reroll shows its Renown price ("${priceText.trim()}")`));

    // 4. a press on a card takes it
    const pickId = (second.find((c) => !['scorchedEarth', 'engineers'].includes(c.id)) || second[0]).id; // the Duo below needs both of its halves free
    ok(await pressSel(`.boon-card[data-boon="${pickId}"]`), tag(`a press on ${pickId}`));
    ok(await t.waitFor(() => { const d = document.querySelector('.boon-draft'); return !!d && d.hidden; }, 5000), tag('the draft closes after the pick'));
    const b1 = await boons();
    ok(b1.owned.includes(pickId) && !b1.pending, tag(`${pickId} is owned; nothing pending`));
    ok(await t.waitFor(() => window.__hd.scene === 'world', 10000), tag('the map is reached'));
    await sleep(2600);

    // 5. the Realm panel: the owned strip and the Reliquary
    ok(await pressSel('.hud-btn[aria-label^="Realm"]'), tag('a press opens the Realm panel'));
    ok(await t.waitFor(() => { const r = document.querySelector('.realm'); return !!r && !r.hidden; }, 4000), tag('the Realm panel is open'));
    await sleep(500);
    const strip = await q(() => [...document.querySelectorAll('.boon-strip .boon-chip')].map((c) => c.getAttribute('aria-label')));
    ok(strip.length >= 2, tag(`the owned strip holds the Boon and the Relic (${strip.length} icons)`));
    ok(await pressSel('.boon-strip .boon-chip'), tag('a press on the first strip icon'));
    ok(await t.waitFor(() => { const d = document.querySelector('.boon-strip-detail'); return !!d && !d.hidden && d.textContent.length > 10; }, 2000), tag('its line shows under the strip'));
    await shot('05-boons-strip');
    const rel = await q(() => [...document.querySelectorAll('.reliquary-slot')].map((s) => ({ relic: s.dataset.relic, found: s.classList.contains('is-found'), owned: s.classList.contains('is-owned') })));
    // one slot per Relic in config (Phase 8 grew the pool), the Sundial found and held, every other slot unknown
    const relicTotal = await q(() => import(new URL('game/config/relics.js', document.baseURI).href).then((m) => m.RELIC_LIST.length));
    ok(rel.length === relicTotal && rel.some((s) => s.relic === 'sundial' && s.found && s.owned) && rel.filter((s) => !s.found).length === relicTotal - 1, tag(`the Reliquary: ${relicTotal} slots, the Sundial found and held, ${relicTotal - 1} unknown`));
    await q(() => { const s = document.querySelector('.reliquary'); if (s) s.scrollIntoView({ block: 'start' }); });
    await sleep(300);
    await shot('06-reliquary');
    await pressSel('.realm-close');
    await sleep(400);

    // 6. Decide later: the chip; the chip reopens; a replaced offer gets the note
    await q(() => { window.__hd.offerBoons('battle'); window.__hd.services.boons.openPending(); });
    ok(await t.waitFor(() => { const d = document.querySelector('.boon-draft'); return !!d && !d.hidden; }, 3000), tag('an offer opens'));
    ok(await pressSel('.boon-later'), tag('a press on Later'));
    ok(await t.waitFor(() => { const c = document.querySelector('.hud-boon-chip'); return !!c && !c.hidden && c.getClientRects().length; }, 3000), tag('the "Boon pending" chip is on the HUD'));
    await sleep(400);
    await shot('07-pending-chip');
    // a new offer replaces the waiting one (as a second battle won would)
    await q(async () => { const m = await import(new URL('game/meta/boons.js', document.baseURI).href); m.offerBoons(window.__hd.state, window.__hd.world, 'battle'); });
    await sleep(600);
    ok(await pressSel('.hud-boon-chip'), tag('a press on the chip'));
    ok(await t.waitFor(() => { const d = document.querySelector('.boon-draft'); return !!d && !d.hidden; }, 3000), tag('the chip reopens the draft'));
    ok(await t.waitFor(() => { const n = document.querySelector('.boon-draft-note'); return !!n && !n.hidden && /missed/i.test(n.textContent); }, 2000), tag('the replaced offer shows the gentle note'));
    await sleep(600);
    await shot('08-missed-note');
    await pressSel('.boon-later');
    await sleep(300);

    // 7. a Duo: Scorched Earth owned, Engineers offered
    await q(() => { window.__hd.grantBoons(['scorchedEarth']); window.__hd.offerBoons(['engineers', 'tithe', 'phalanx']); window.__hd.services.boons.openPending(); });
    ok(await t.waitFor(() => { const c = document.querySelector('.boon-card[data-boon="engineers"]'); return !!c && !c.closest('[hidden]'); }, 3000), tag('Engineers is on offer'));
    ok(await q(() => /Fire Arrows/.test(document.querySelector('.boon-card[data-boon="engineers"]').textContent)), tag('its card says it completes Fire Arrows'));
    await sleep(500);
    ok(await pressSel('.boon-card[data-boon="engineers"]'), tag('a press on Engineers'));
    ok(await t.waitFor(() => { const d = document.querySelector('.duo-reveal'); return !!d && !d.hidden; }, 4000), tag('the Duo reveal plays'));
    await sleep(1500);
    ok(await q(() => /Fire Arrows/.test(document.querySelector('.duo-reveal').textContent)), tag('it names Fire Arrows'));
    await shot('09-duo-reveal');
    ok(await t.waitFor(() => document.querySelector('.duo-reveal').hidden, 6000), tag('the reveal ends by itself'));
    ok(await q(async () => { const m = await import(new URL('game/meta/boons.js', document.baseURI).href); return m.duoInfo(window.__hd.state).find((d) => d.id === 'fireArrows').active; }), tag('Fire Arrows is active'));

    // 8. the frames: one of each, and the Champion's eye
    const sets = [['hitAndRun', 'turncoats', 'warlordsMark'], ['fortuneFavours', 'bloodPrice', 'martyrsCrown']];
    for (let i = 0; i < sets.length; i++) {
      const set = sets[i];
      await q((s) => { window.__hd.offerBoons(s); window.__hd.services.boons.openPending(); }, set);
      ok(await t.waitFor((s) => [...document.querySelectorAll('.boon-draft:not([hidden]) .boon-card')].map((c) => c.dataset.boon).join() === s.join(), 3000, set), tag(`the offer ${set.join(', ')}`));
      await sleep(800);
      const fr = await draftCards();
      if (i === 0) ok(fr.map((c) => c.frame).join() === 'common,rare,legendary', tag('Common bronze, Rare silver-blue, Legendary gold frames'));
      else ok(fr.every((c) => c.frame === 'cursed') && await q(() => [...document.querySelectorAll('.boon-card .boon-card-warn')].every((w) => !w.hidden)), tag('Cursed crimson-violet frames with the warning mark'));
      await shot(i === 0 ? '10-frames-common-rare-legendary' : '11-frames-cursed');
      await pressSel('.boon-later');
      await sleep(300);
    }
    await q(() => { window.__hd.offerBoons(['kingslayer', 'siegecraft', 'secondWind'], 'champion'); window.__hd.services.boons.openPending(); });
    ok(await t.waitFor(() => { const d = document.querySelector('.boon-draft'); return !!d && !d.hidden && d.classList.contains('is-champion-eye'); }, 3000), tag("the Champion's eye frame"));
    await sleep(800);
    await shot('12-champions-eye');
    await pressSel('.boon-later');
    await sleep(400);

    // 9. in battle: Scorched Earth's ground burns and is drawn again after a reload (§7C); Warlord's Mark doubles every Nth squad (a small pop)
    await q(async () => {
      const hd = window.__hd;
      hd.grantBoons(['warlordsMark']);
      const { frontier } = await import(new URL('game/meta/progression.js', document.baseURI).href);
      const ids = frontier(hd.state, hd.world).sort((a, b) => hd.world.regions[a].tier - hd.world.regions[b].tier || a - b);
      hd.selectRegion(ids[0]);
    });
    await sleep(900);
    ok(await pressSel('.region-card-action:not([hidden])'), tag("a press on Attack (with Warlord's Mark and Scorched Earth)"));
    ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000), tag('the battle is live'));
    ok(await q(() => !!(window.__hd.battle.player.boons && window.__hd.battle.player.boons.warlordEvery > 0 && window.__hd.battle.player.boons.scorchSec > 0)), tag('the battle carries the Boons (battle.player.boons)'));
    await q(async () => {
      const hd = window.__hd;
      const S = await import(new URL('game/battle/sim.js', document.baseURI).href);
      const b = hd.battle;
      b.player.powers = { ...(b.player.powers || {}), firestorm: Math.max(1, (b.player.powers || {}).firestorm || 0) };
      b.player.powersBlocked = undefined;
      const foe = b.sites.filter((s) => s.owner !== 0).sort((a, z) => z.troops - a.troops)[0];
      const tile = b.arena.tiles.find((x) => x.i === foe.tile);
      S.issue(b, { type: 'power', owner: 0, power: 'firestorm', target: { q: tile.q, r: tile.r } });
    });
    ok(await t.waitFor(() => (window.__hd.boonFxInfo()?.scorch || 0) > 0, 6000), tag("Scorched Earth's ground burns"));
    await q(() => window.__hd.services.battles.setPaused(true)); // hold the battle clock: the ground must still be burning after the reload
    await sleep(300);
    await shot('13-scorched-earth');
    // §7C: save, reload, Continue: the burning ground comes back from the battle's own record
    await q(() => { window.__hd.services.autosave.save(); });
    await t.page.goto(`${BASE}/index.html?dev=1&seed=7`);
    ok(await t.atTitle(), tag('reloaded'));
    await q(() => { window.__HD_TEST_NO_BOON_MOMENTS = false; });
    ok(await t.clickText('button', 'Continue'), tag('Continue'));
    ok(await t.waitFor(() => window.__hd.scene === 'world' || window.__hd.scene === 'battle', 30000), tag('the realm is back'));
    await sleep(1500);
    await q(() => { const hd = window.__hd; if (hd.scene !== 'battle') { const r = hd.battles.list()[0]; if (r) hd.services.switchToBattle(r.id); } });
    ok(await t.waitFor(() => window.__hd.scene === 'battle' && !!window.__hd.battle, 20000), tag('the saved battle is shown'));
    ok(await t.waitFor(() => (window.__hd.boonFxInfo()?.scorch || 0) > 0, 6000), tag('the scorched ground is drawn again after the reload'));
    await sleep(600);
    await shot('14-scorch-after-reload');
    ok(await t.waitFor(() => window.__hd.battlePhase === 'live', 20000), tag('the battle is live again'));
    await q(async () => {
      const hd = window.__hd;
      const S = await import(new URL('game/battle/sim.js', document.baseURI).href);
      const R = await import(new URL('game/battle/routing.js', document.baseURI).href);
      const b = hd.battle;
      const camp = b.sites.find((s) => s.type === 'camp' && s.owner === 0);
      camp.troops = Math.max(camp.troops, 400);
      const tgt = b.sites.filter((s) => s.owner !== 0 && R.canRoute(b, 0, camp.id, s.id)).sort((a, z) => a.troops - z.troops)[0];
      const n = (b.player.boons.warlordEvery || 4) + 1;
      for (let i = 0; i < n; i++) S.issue(b, { type: 'send', owner: 0, from: camp.id, to: tgt.id, fraction: 0.1 });
    });
    const wm = await t.waitFor(() => (window.__hd.boonFxInfo()?.triggered?.warlordsMark || 0) > 0, 8000);
    const diag = wm ? '' : await q(() => { const b = window.__hd.battle; return JSON.stringify({ fx: b && b.boonFx, info: window.__hd.boonFxInfo(), boons: b && b.player.boons }); });
    ok(wm, tag(`Warlord's Mark fires (boonTriggered)${diag ? ` ${diag}` : ''}`));
    await sleep(250);
    ok(await q(() => (window.__hd.boonFxInfo()?.pops || 0) <= 6), tag('the pops stay few (6 at most)'));
    await shot('15-battle-boon-pop');

    const errs = t.unexpected();
    ok(errs.length === 0, tag(`no console errors${errs.length ? `: ${errs[0]}` : ''}`));
    allErrors.push(...errs);
  } catch (e) {
    ok(false, tag(`scenario threw: ${e && e.message}`));
  }
  await t.page.close();
}

export async function phase7Checks({ launch, BASE, ok, sleep, allErrors }) {
  console.log('\n== phase7: Relic glint and card line, claim, the Boon draft (reroll, pick), the pending chip, a Duo, the frames, the Reliquary ==');
  await mkdir(OUT, { recursive: true });
  const open = makeOpen(launch, sleep);
  const only = process.env.PHASE7_ONLY || '';
  if (!only || only === 'desktop') await scenario(open, BASE, ok, sleep, allErrors, { width: 1440, height: 900, mobile: false, name: 'desktop' });
  if (!only || only === 'phone') await scenario(open, BASE, ok, sleep, allErrors, { width: 390, height: 844, mobile: true, name: 'phone' });
}
