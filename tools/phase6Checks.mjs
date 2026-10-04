// Real-browser checks for Phase 6, the Ashen Host (docs/PLAN-PHASE6.md; docs/briefs/phase6-hookup.md): run by tools/check.mjs (`--only=phase6`),
// desktop and phone, seed 7. Real presses wherever a press matters; dev hooks only to set the stage and to read state. Screenshots go to
// screenshots/phase6/ (the gallery) unless PHASE6_SHOTS=0.
//   1. Dynasty II through the ceremony (__hd.completeRealm() + real presses): the Ashen Host is on the new continent (state.rivals has 5)
//   2. an Ashen region on the frontier: the A1 hint ("The Fallen Rise ...") points at it; its card has the mechanic line with the config's number
//      (a real press on the region opens it, which marks A1 seen)
//   3. Attack (a real press) the Barrow Keep's region: the battle is live; troops sent to die at an Ashen settlement rise ("+N risen", wisps)
//   4. the Rising: the ash ring is drawn (telegraph), then the risen squad emerges
//   5. Firestorm on the settlement, then the assault: the dead burn instead of rising (fallenBurned)
//   6. win (dev hook): the Gravewarden's recruitment card, the roster has kind 'gravewarden', its emblem badge
//   7. no console errors
import { mkdir } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';

const OUT = 'screenshots/phase6';

async function scenario(open, BASE, ok, sleep, allErrors, { width, height, mobile, name }) {
  const t = await open(`${BASE}/index.html?dev=1&seed=7`, { width, height, mobile });
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const tag = (s) => `phase6 ${name}: ${s}`;
  const shoot = process.env.PHASE6_SHOTS !== '0';
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
  const text = (sel) => q((s) => { const e = document.querySelector(s); return e ? e.textContent : null; }, sel);
  const info = () => q(() => window.__hd.ashenInfo());

  try {
    ok(await t.atTitle(), tag('boots'));
    ok(await t.clickText('button', 'New Realm'), tag('New Realm'));
    ok(await t.waitFor(() => window.__hd.scene === 'world', 40000), tag('the world is up'));
    await q(async () => {
      const hd = window.__hd;
      hd.hideDev(true);
      const { TUTORIAL_STEPS } = await import(new URL('game/scenes/timing.js', document.baseURI).href);
      hd.state.tutorial.seen = Object.fromEntries(TUTORIAL_STEPS.filter((s) => s.id !== 'A1').map((s) => [s.id, true]));
      hd.state.settings.hints = true;
      hd.state.stats.battlesWon = 3;
    });
    await sleep(800);

    // 1. Dynasty II through the ceremony
    ok(await q(() => window.__hd.completeRealm()), tag('__hd.completeRealm()'));
    await sleep(500);
    ok(await pressSel('.hud-btn.hud-realm, .hud-btn[aria-label^="Realm"]'), tag('a press opens the Realm panel'));
    ok(await t.waitFor(() => { const b = document.querySelector('.dynasty-found-btn'); return !!b && !b.disabled && b.getClientRects().length; }, 4000), tag('Found a Dynasty is enabled'));
    ok(await pressSel('.dynasty-found-btn'), tag('a press on Found a Dynasty'));
    ok(await t.waitFor(() => { const c = document.querySelector('.ceremony'); return !!c && !c.hidden; }, 4000), tag('the ceremony opens'));
    await pressSel('.ceremony-next'); await pressSel('.ceremony-next');
    const cards = await q(() => [...document.querySelectorAll('.ceremony .edict-card')].map((c) => c.dataset.edict));
    // an Edict that keeps powers and raids as they are (Iron Will and Peace would hide what this checks)
    const pick = cards.find((c) => !/iron|peace|lone/i.test(c)) || cards[0];
    ok(await pressSel(`.ceremony .edict-card[data-edict="${pick}"]`), tag(`a press picks the Edict ${pick}`));
    await pressSel('.ceremony-next'); await pressSel('.ceremony-next');
    ok(await pressSel('.ceremony-found'), tag('a press founds the dynasty'));
    ok(await t.waitFor(() => window.__hd.state.dynasty.level === 2 && window.__hd.scene === 'world', 15000), tag('dynasty II begins'));
    await sleep(1500);
    const meet = await q(() => {
      const hd = window.__hd;
      return { rivals: hd.state.rivals, ashenRegions: hd.world.regions.filter((r) => r.faction === 5).length, absent: hd.world.factions.filter((f) => f.absent).map((f) => f.id), cap: hd.world.factions[5] && hd.world.factions[5].capitalRegion };
    });
    ok(Array.isArray(meet.rivals) && meet.rivals.includes(5), tag(`the Ashen Host is a rival this dynasty (${JSON.stringify(meet.rivals)})`));
    ok(meet.ashenRegions > 0 && meet.absent.length === 1, tag(`it holds ${meet.ashenRegions} regions; absent: ${meet.absent}`));

    // 2. the Barrow Keep's region on the frontier (dev conquests toward it), the A1 hint, the card
    const cap = await q(async () => {
      const hd = window.__hd;
      const P = await import(new URL('game/meta/progression.js', document.baseURI).href);
      const c = hd.world.factions[5].capitalRegion;
      const dist = new Map([[c, 0]]);
      const queue = [c];
      while (queue.length) { const r = queue.shift(); for (const n of hd.world.regions[r].neighbors) if (!dist.has(n)) { dist.set(n, dist.get(r) + 1); queue.push(n); } }
      for (let i = 0; i < 60; i++) {
        const fr = P.attackableFrontier(hd.state, hd.world);
        if (fr.includes(c)) return c;
        const next = fr.filter((id) => id !== c).sort((a, b) => dist.get(a) - dist.get(b))[0];
        if (next == null) return null;
        hd.conquerRegion(next);
      }
      return null;
    });
    ok(cap != null, tag(`the Barrow Keep's region can be attacked (${cap})`));
    if (cap == null) throw new Error('no Ashen capital on the frontier');
    await q((id) => window.__hd.flyToRegion(id, undefined, 1), cap);
    ok(await t.waitFor(() => { const c = document.querySelector('.coach'); return !!c && !c.hidden && /The Fallen Rise/.test(c.textContent); }, 8000), tag('the A1 hint: "The Fallen Rise: your losses join them..."'));
    await shot('01-ashen-territory-hint');
    const pctWant = await q(() => import(new URL('game/config/ashen.js', document.baseURI).href).then((m) => `${Math.round(m.ASHEN.fallen.share * 100)}%`));
    const p = await q((id) => window.__hd.regionScreenPos(id), cap);
    if (p) await press(p.x, p.y);
    if (!(await t.waitFor((id) => window.__hd.services?.ui?.regionCard && !document.querySelector('.region-card-dock, .region-card')?.closest('[hidden]') && /Fallen Rise/.test(document.querySelector('.region-card-feature.is-ashen')?.textContent || ''), 3000, cap))) {
      await q((id) => window.__hd.selectRegion(id), cap); // the label sat under something: open it directly
    }
    ok(await t.waitFor(() => { const e = document.querySelector('.region-card-feature.is-ashen'); return !!e && !e.hidden && e.getClientRects().length > 0; }, 4000), tag('the card has The Fallen Rise row'));
    const line = await text('.region-card-feature.is-ashen');
    ok(new RegExp(`${pctWant} of your losses join.*Firestorm burns the dead`).test(line || ''), tag(`the card's line: "${line}"`));
    ok(/Barrow Keep/.test(line || ''), tag('the capital names the Barrow Keep'));
    ok(await t.waitFor(() => window.__hd.state.tutorial.seen.A1 === true, 3000), tag('A1 is seen once an Ashen card is open'));
    await sleep(400);
    await shot('02-ashen-card');

    // 3. Attack (a real press): the Barrow Keep battle
    await q(() => { const hd = window.__hd; hd.grantGold(1e7); });
    ok(await pressSel('.region-card-action button, .region-card-attack'), tag('a real press on Attack'));
    ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000), tag('the Barrow Keep battle is live'));
    await sleep(600);
    // troops sent to die: the camp keeps sending everything at the strongest Ashen settlement it can reach (powers unlocked for step 5)
    const target = await q(async () => {
      const hd = window.__hd;
      const S = await import(new URL('game/battle/sim.js', document.baseURI).href);
      const R = await import(new URL('game/battle/routing.js', document.baseURI).href);
      const b = hd.battle;
      const camp = b.sites.find((s) => s.type === 'camp' && s.owner === 0);
      const foes = b.sites.filter((s) => s.owner === b.arena.enemyFaction && s.type !== 'keep' && R.canRoute(b, 0, camp.id, s.id)).sort((a, z) => z.troops - a.troops);
      const tgt = foes[0] || b.sites.find((s) => s.type === 'keep' && s.owner !== 0);
      tgt.troops = Math.max(tgt.troops, 60); // a garrison the camp cannot take: every troop sent dies there
      camp.troops = Math.max(camp.troops, 40);
      S.issue(b, { type: 'send', owner: 0, from: camp.id, to: tgt.id, fraction: 1 });
      window.__p6 = { camp: camp.id, tgt: tgt.id };
      return { id: tgt.id, type: tgt.type };
    });
    ok(!!target, tag(`the assault goes in at the ${target && target.type}`));
    await q(() => { const sp = document.querySelector('.battle-speed'); if (sp) { sp.click(); sp.click(); } }); // 3x
    ok(await t.waitFor(() => (window.__hd.ashenInfo()?.risen || 0) > 0, 25000), tag('the fallen rise (fallenRose)'));
    await sleep(250);
    const i1 = await info();
    ok(i1.wisps > 0, tag(`wisps in the air (${i1.wisps}), ${i1.risen} risen`));
    await shot('03-fallen-rise');

    // (steps 4-6 follow)
    const errs = t.unexpected();
    ok(errs.length === 0, tag(`no console errors${errs.length ? `: ${errs[0]}` : ''}`));
    allErrors.push(...errs);
  } catch (e) {
    ok(false, tag(`scenario threw: ${e && e.message}`));
  }
  await t.page.close();
}

export async function phase6Checks({ launch, BASE, ok, sleep, allErrors }) {
  console.log('\n== phase6: the Ashen Host (Dynasty II), The Fallen Rise, the Rising, Firestorm burns the dead, the Gravewarden, hint A1 ==');
  await mkdir(OUT, { recursive: true });
  const open = makeOpen(launch, sleep);
  const only = process.env.PHASE6_ONLY || '';
  if (!only || only === 'desktop') await scenario(open, BASE, ok, sleep, allErrors, { width: 1440, height: 900, mobile: false, name: 'desktop' });
  if (!only || only === 'phone') await scenario(open, BASE, ok, sleep, allErrors, { width: 390, height: 844, mobile: true, name: 'phone' });
}
