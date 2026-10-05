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
    // A1 points at the lowest-tier Ashen region on the frontier: bring it on screen (the coach hides a hint whose target is off screen)
    // (the world's realm-wide hint facts are recomputed at most every 250 ms, Phase 8: right after the dev conquests they can still be the old ones,
    // and a loaded machine stretches that over several frames; wait for the fresh value instead of reading once)
    await t.waitFor(() => window.__hd.hintFacts().ashenRegion >= 0, 5000);
    const hintRegion = await q(() => window.__hd.hintFacts().ashenRegion);
    ok(hintRegion >= 0, tag(`an Ashen region is on the frontier (${hintRegion})`));
    await q((id) => window.__hd.flyToRegion(id, undefined, 1), hintRegion);
    ok(await t.waitFor(() => { const c = document.querySelector('.coach'); return !!c && !c.hidden && /The Fallen Rise/.test(c.textContent); }, 8000), tag('the A1 hint: "The Fallen Rise: your losses join them..."'));
    ok(await q((id) => window.__hd.hintOutline() === id, hintRegion), tag('the hint outlines that region'));
    await sleep(600);
    await shot('01-ashen-territory-hint');
    await q((id) => window.__hd.flyToRegion(id, undefined, 1), cap);
    await sleep(700);
    const pctWant = await q(() => import(new URL('game/config/ashen.js', document.baseURI).href).then((m) => `${Math.round(m.ASHEN.fallen.share * 100)}%`));
    const p = await q((id) => window.__hd.regionScreenPos(id), cap);
    if (p) await press(p.x, p.y);
    if (!(await t.waitFor(() => { const e = document.querySelector('.region-card-feature.is-ashen'); return !!e && !e.hidden && e.getClientRects().length > 0; }, 2500))) {
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
    ok(await pressSel('button.region-card-action'), tag('a real press on Attack'));
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
      tgt.troops = Math.min(Math.max(tgt.troops, 500), 1500); // a garrison small sends cannot take (every troop sent dies there), but not so big its own sends overrun us
      camp.troops = Math.max(camp.troops, 6000); // a deep camp: the Rising's squads must not take it while this check watches
      // the stage: D2's dev-conquered realm is far weaker than a played one, so the enemy's garrisons are capped and ours kept deep while
      // this check watches (the Fallen Rise, the Rising and the burn are what it tests, not the balance)
      for (const s of b.sites) if (s.owner !== 0 && s.owner !== 1 && s !== tgt) s.troops = Math.min(s.troops, 600);
      clearInterval(window.__p6keep);
      window.__p6keep = setInterval(() => { const bb = window.__hd.battle; if (bb) for (const s of bb.sites) if (s.owner === 0) s.troops = Math.max(s.troops, 3000); }, 200);
      S.issue(b, { type: "send", owner: 0, from: camp.id, to: tgt.id, fraction: 0.02 });
      window.__p6 = { camp: camp.id, tgt: tgt.id };
      return { id: tgt.id, type: tgt.type };
    });
    ok(!!target, tag(`the assault goes in at the ${target && target.type}`));
    await q(() => { const sp = document.querySelector('.battle-speed'); if (sp) { sp.click(); sp.click(); } }); // 3x
    ok(await t.waitFor(() => (window.__hd.ashenInfo()?.risen || 0) > 0, 25000), tag('the fallen rise (fallenRose)'));
    await sleep(600); // the "+N risen" pop gathers for about half a second
    const i1 = await info();
    ok(i1.wisps > 0, tag(`wisps in the air (${i1.wisps}), ${i1.risen} risen`));
    await shot('03-fallen-rise');

    // 4. the Rising: the ash ring round the Barrow Keep, then the risen squad emerges
    await q(() => { const sp = document.querySelector('.battle-speed'); if (sp) sp.click(); }); // back to 1x: the telegraph lasts 3 s
    ok(await t.waitFor(() => !!window.__hd.ashenInfo()?.telegraph, 30000), tag('the Rising is telegraphed (the ash ring)'));
    await sleep(1400);
    await shot('04-rising-telegraph');
    ok(await t.waitFor(() => (window.__hd.ashenInfo()?.emerged || 0) > 0, 12000), tag('the risen squad emerges from the keep'));
    await sleep(300);
    await shot('05-rising-emerges');

    // 5. Firestorm on the settlement, then the assault: the dead burn instead of rising
    const before = await info();
    const cast = await q(async () => {
      const hd = window.__hd;
      const S = await import(new URL('game/battle/sim.js', document.baseURI).href);
      const R = await import(new URL('game/battle/routing.js', document.baseURI).href);
      const F = await import(new URL('game/battle/fallen.js', document.baseURI).href);
      const b = hd.battle;
      const foe = b.arena.enemyFaction;
      b.player.powers = { ...(b.player.powers || {}), firestorm: Math.max(1, (b.player.powers || {}).firestorm || 0) };
      b.player.powersBlocked = undefined;
      for (const s of b.sites) if (s.owner === 0) s.troops = Math.max(s.troops, 5000);
      // Deterministic staging. It used to be one small squad from the camp to the step-3 target, sent with the cast: on some runs that target was far
      // away, the squad was caught on the road or arrived after the ground had cooled (8 s), and nothing burned. Now: the Ashen settlement NEAREST to a
      // site of ours, a steady stream of small squads from that site, and the Firestorm cast (cooldown cleared) once a squad is two tiles out or
      // already assaulting, again whenever the ground has cooled: the burn always overlaps an assault.
      const tileOf = (s) => b.arena.tiles.find((x) => x.i === s.tile);
      let best = null;
      for (const t of b.sites.filter((s) => s.owner === foe && s.type !== 'keep')) {
        const tp = tileOf(t);
        for (const o of b.sites.filter((s) => s.owner === 0 && R.canRoute(b, 0, s.id, t.id))) {
          const op = tileOf(o);
          const d = Math.hypot(op.x - tp.x, op.y - tp.y);
          if (!best || d < best.d) best = { site: t, from: o, d };
        }
      }
      if (!best) return 'no reachable Ashen settlement';
      const site = best.site;
      // The Gravewarden's Lantern (a Relic this dynasty may have claimed on an earlier conquest, depending on which regions fell first) stops the Fallen
      // rising AND burning within its radius of the War Camp, and the nearest Ashen settlement is usually inside it: the step then waited 40 s for a
      // burn that the rules forbid (the flake: burn present, assault on, nothing gathered). The Lantern has its own tests; this step turns it off.
      if (b.player.boons && b.player.boons.lanternRadius) { window.__p6lantern = b.player.boons.lanternRadius; b.player.boons.lanternRadius = 0; }
      site.troops = Math.min(Math.max(site.troops, 800), 1500);
      const tile = tileOf(site);
      window.__p6 = { ...(window.__p6 || {}), tgt: site.id };
      clearInterval(window.__p6burn);
      let castAt = -1e9;
      window.__p6burn = setInterval(() => {
        const bb = window.__hd.battle;
        if (!bb || bb !== b || bb.result || site.owner !== foe) { clearInterval(window.__p6burn); return; }
        site.troops = Math.max(site.troops, 600); // never taken while this step watches
        // no enemy squads on the field while this step watches: their reinforcements used to catch the stream on the road for the whole window
        if (bb.squads.some((q) => q.owner !== 0)) bb.squads = bb.squads.filter((q) => q.owner === 0);
        const near = bb.squads.some((q) => q.owner === 0 && q.to === site.id && (q.state === 'assault' || (q.state === 'march' && q.seg >= q.path.length - 2)));
        if (near && !F.isBurning(bb, site, bb.t) && bb.t - castAt > 1.5) { castAt = bb.t; bb.cooldowns.firestorm = 0; S.issue(bb, { type: 'power', owner: 0, power: 'firestorm', target: { q: tile.q, r: tile.r } }); }
        const from = bb.sites[best.from.id];
        if (from && from.owner === 0) { from.troops = Math.max(from.troops, 3000); S.issue(bb, { type: 'send', owner: 0, from: from.id, to: site.id, fraction: 0.03 }); }
      }, 300);
      return 'ok';
    });
    ok(cast === 'ok', tag(`Firestorm cast on the settlement, then the assault (${cast})`));
    console.log(`  info ${name}: relics held ${JSON.stringify(await q(() => (window.__hd.state.relics || {}).owned || []))}, Lantern ${await q(() => window.__p6lantern || 0)}`);
    const burnedOk = await t.waitFor((n) => (window.__hd.ashenInfo()?.burned || 0) > n, 40000, before.burned || 0);
    const bdiag = burnedOk ? '' : await q(() => { const b = window.__hd.battle; const { tgt } = window.__p6 || {}; const s = b && b.sites[tgt]; return JSON.stringify({ t: b && b.t, burns: b && b.fallen && b.fallen.burns, site: s && { owner: s.owner, troops: Math.round(s.troops), tile: s.tile }, pending: b && b.pendingPowers, squads: b && b.squads.map((x) => ({ o: x.owner, to: x.to, n: Math.round(x.count), st: x.state, seg: x.seg, len: x.path && x.path.length, foe: x.foe })), paused: window.__hd.battles.paused, phase: window.__hd.battlePhase, dlg: document.documentElement.hasAttribute("data-dialog"), info: window.__hd.ashenInfo(), cd: b && b.cooldowns, acc: b && b.fallen && b.fallen.acc[tgt], lantern: b && b.player.boons && b.player.boons.lanternRadius, relics: window.__hd.state.relics && window.__hd.state.relics.owned }); });
    const lantern = await q(() => { const v = window.__p6lantern || 0; const b = window.__hd.battle; if (v && b && b.player.boons) b.player.boons.lanternRadius = v; window.__p6lantern = 0; return v; });
    ok(burnedOk, tag(`Firestorm burns the dead (fallenBurned)${lantern ? ` (the Lantern, radius ${lantern}, was off for this step)` : ''}${bdiag ? ` ${bdiag}` : ''}`));
    await sleep(700); // the "N burned" pop gathers for about half a second
    await shot('06-ember-burn');
    await q(() => clearInterval(window.__p6burn));

    // 6. win (dev hook): the Gravewarden joins
    await q(() => { clearInterval(window.__p6keep); clearInterval(window.__p6burn); window.__hd.winBattle(); });
    ok(await t.waitFor(() => { const c = document.querySelector('.results-card'); return !!c && !c.hidden && c.dataset.result === 'victory'; }, 30000), tag('Victory over the Barrow Keep'));
    await sleep(1500);
    ok(await t.clickText('.results-action', 'Continue'), tag('Continue'));
    ok(await t.waitFor(() => { const m = document.querySelector('.is-recruit'); return !!m && /joins your cause/.test(m.textContent); }, 8000), tag('the recruitment card'));
    const rec = await q(() => { const m = document.querySelector('.is-recruit'); return { text: m ? m.textContent : '', emblem: !!m?.querySelector('.general-emblem[data-kind="gravewarden"] .icon-skullCrown'), g: window.__hd.state.generals.roster.find((x) => x.kind === 'gravewarden') }; });
    ok(!!rec.g, tag(`the Gravewarden is on the roster (${rec.g && rec.g.name})`));
    ok(/Gravewarden/.test(rec.text) && rec.emblem, tag('the card names the Gravewarden, with the skull-crown emblem'));
    await sleep(500);
    await shot('07-gravewarden-card');
    await pressSel('.is-recruit button', 'Welcome');

    // 7. (Phase 7 §7C) the Gravewarden's Raise the Fallen, live: it commands an attack, troops die, a real press on the ability raises them
    ok(await t.waitFor(() => window.__hd.scene === 'world', 15000), tag('back on the map'));
    await sleep(2500);
    const gw = await q(async () => {
      const hd = window.__hd;
      const g = hd.state.generals.roster.find((x) => x.kind === 'gravewarden');
      const { frontier, difficulty } = await import(new URL('game/meta/progression.js', document.baseURI).href);
      // a region that FIGHTS: one that would surrender shows "Accept Surrender" instead of Attack (that was this step's flake)
      const busy = new Set(hd.battles.list().map((r) => r.regionId));
      // ... judged WITH the Gravewarden credited (DESIGN 10.11): its card credit can tip a region into offering surrender, which hid Attack in CI
      const ids = frontier(hd.state, hd.world).filter((id) => !busy.has(id) && !difficulty(hd.state, hd.world, id, { commander: g && g.id }).surrender);
      const rid = ids.sort((a, b) => hd.world.regions[a].tier - hd.world.regions[b].tier || a - b)[0];
      hd.selectRegion(rid);
      return { g: g && g.id, rid };
    });
    ok(!!gw.g && gw.rid != null, tag(`the Gravewarden (${gw.g}) and a region to attack (${gw.rid})`));
    await sleep(900);
    const picked = await q((gid) => {
      const sel = document.querySelector('.region-card-commander-select');
      if (!sel || ![...sel.options].some((o) => o.value === gid)) return false;
      sel.value = gid;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, gw.g);
    ok(picked, tag('the Gravewarden is chosen to command'));
    await sleep(400);
    // belt and braces: if the card still offers only a surrender (Attack hidden), move to the next region that fights
    for (let tries = 0; tries < 4; tries++) {
      const attackShown = await q(() => [...document.querySelectorAll('button.region-card-action')].some((b) => !b.hidden && /Attack/.test(b.textContent)));
      if (attackShown) break;
      await q(async ({ gid, skip }) => {
        const hd = window.__hd;
        const { frontier, difficulty } = await import(new URL('game/meta/progression.js', document.baseURI).href);
        const busy = new Set(hd.battles.list().map((r) => r.regionId));
        const next = frontier(hd.state, hd.world).filter((id) => !busy.has(id) && !difficulty(hd.state, hd.world, id, { commander: gid }).surrender)
          .sort((x, y) => hd.world.regions[x].tier - hd.world.regions[y].tier || x - y)[skip];
        if (next != null) hd.selectRegion(next);
      }, { gid: gw.g, skip: tries + 1 });
      await sleep(700);
      await q((gid) => { const sel = document.querySelector('.region-card-commander-select'); if (sel && [...sel.options].some((o) => o.value === gid)) { sel.value = gid; sel.dispatchEvent(new Event('change', { bubbles: true })); } }, gw.g);
      await sleep(400);
    }
    ok(await pressSel('button.region-card-action', 'Attack'), tag('a real press on Attack'));
    const gwLive = await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 30000);
    const gwDiag = gwLive ? '' : await q(() => JSON.stringify({ scene: window.__hd.scene, phase: window.__hd.battlePhase, card: [...document.querySelectorAll('.region-card-action')].map((b) => `${b.textContent}|${b.hidden}|${b.disabled}`), dialogs: [...document.querySelectorAll('[role=dialog]')].filter((d) => !d.closest('[hidden]') && d.getClientRects().length).map((d) => d.className), toasts: [...document.querySelectorAll('.toast')].map((x) => x.textContent).slice(0, 3) }));
    ok(gwLive, tag(`the Gravewarden's battle is live${gwDiag ? ` ${gwDiag}` : ''}`));
    if (!gwLive) throw new Error('no Gravewarden battle');
    ok(await q(() => window.__hd.battle.player.ability && window.__hd.battle.player.ability.id === 'raiseFallen'), tag('its ability is Raise the Fallen'));
    // troops sent to die at a strong garrison, so there are fallen to raise
    await q(async () => {
      const hd = window.__hd;
      const S = await import(new URL('game/battle/sim.js', document.baseURI).href);
      const R = await import(new URL('game/battle/routing.js', document.baseURI).href);
      const b = hd.battle;
      const camp = b.sites.find((s) => s.type === 'camp' && s.owner === 0);
      const tgt = b.sites.filter((s) => s.owner !== 0 && R.canRoute(b, 0, camp.id, s.id)).sort((a, z) => z.troops - a.troops)[0];
      tgt.troops = Math.max(tgt.troops, 400);
      camp.troops = Math.max(camp.troops, 200);
      S.issue(b, { type: 'send', owner: 0, from: camp.id, to: tgt.id, fraction: 0.5 });
    });
    ok(await t.waitFor(async () => {
      const R = await import(new URL('game/battle/fallen.js', document.baseURI).href);
      const b = window.__hd.battle;
      return b && R.recentLosses(b, b.t, 15) >= 2;
    }, 25000), tag('troops have fallen'));
    const raisedBefore = (await info())?.raised || 0;
    ok(await pressSel('.battle-ability'), tag('a real press on Raise the Fallen'));
    ok(await t.waitFor((n) => (window.__hd.ashenInfo()?.raised || 0) > n, 4000, raisedBefore), tag('the fallen are raised (raiseFallen)'));
    await sleep(500);
    await shot('08-raise-the-fallen');

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
