// Real-browser checks for Phase 13, the Crown of Ages (docs/PLAN-PHASE13.md; docs/briefs/phase13-hookup.md): run by tools/check.mjs (`--only=phase13`),
// desktop and phone, seed 7. Dev hooks set the stage (the Crown continent through `__hd.crownRealm`, dev conquests, a staged Throne battle whose
// sites are kept strong) and read state; real presses where a press matters (the ceremony's final choice and Ascension picker, Found, the ending's
// Continue and Skip). Screenshots go to screenshots/phase13/ unless PHASE13_SHOTS=0.
//   1. the Crown of Ages continent: world.crown, eight factions, the Usurper's land, the Throne region's card lines (U1 hint seen on its card)
//   2. the Throne of Ages: phase 1 (three Champion posts, the HUD line), the Champions fall, phase 2 (the Gate), each borrowed weapon telegraphed
//      and struck (Rising, Tide, Plague), phase 3 (the Usurper takes the field, his health bar), he falls
//   3. the ending plays on its own once the map is calm (tour -> Chronicle -> credits, real presses), and a replay is skipped with Escape
//   4. the title shows the lasting Crown ("Crowned in Year N")
//   5. an Ascension 1 founding through the ceremony (real presses on the picker and Found): state.ascension === 1
//   6. no console errors
import { mkdir } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';

const OUT = 'screenshots/phase13';

async function scenario(open, BASE, ok, sleep, allErrors, { width, height, mobile, name }) {
  const t = await open(`${BASE}/index.html?dev=1&seed=7`, { width, height, mobile });
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const tag = (s) => `phase13 ${name}: ${s}`;
  const shoot = process.env.PHASE13_SHOTS !== '0';
  const shot = async (n) => { if (shoot) { await t.page.screenshot(`${OUT}/${name}-${n}.png`); console.log(`  shot ${OUT}/${name}-${n}.png`); } };
  const info = () => q(() => window.__hd.throneInfo());
  const keepStrong = (on) => q((o) => {
    clearInterval(window.__p13keep);
    if (o) window.__p13keep = setInterval(() => { const b = window.__hd.battle; if (b) for (const s of b.sites) if (s.owner === 0) s.troops = Math.max(s.troops, 1e6); }, 150);
  }, on);

  try {
    ok(await t.atTitle(), tag('boots'));
    ok(await t.clickText('button', 'New Realm'), tag('New Realm'));
    ok(await t.waitFor(() => window.__hd.scene === 'world', 40000), tag('the world is up'));
    await q(async () => {
      const hd = window.__hd;
      hd.hideDev(true);
      const { TUTORIAL_STEPS } = await import(new URL('game/scenes/timing.js', document.baseURI).href);
      hd.state.tutorial.seen = Object.fromEntries(TUTORIAL_STEPS.filter((s) => s.id !== 'U1' && s.id !== 'U2').map((s) => [s.id, true]));
      hd.state.settings.hints = true;
      hd.state.stats.battlesWon = 3;
    });
    await sleep(500);

    // 1. the Crown of Ages continent
    const seed = await q(() => window.__hd.crownRealm());
    ok(seed !== false, tag(`__hd.crownRealm founds the Crown of Ages (seed ${seed})`));
    ok(await t.waitFor(() => window.__hd.scene === 'world' && !!window.__hd.world.crown, 15000), tag('the Crown continent is up'));
    const w = await q(() => { const hd = window.__hd; const wd = hd.world; return { n: wd.factions.length, throne: wd.crown.throne, usurper: wd.crown.usurper.length, col: wd.factions[7].color, emblem: wd.factions[7].emblem, owner: hd.state.owner[wd.crown.throne], crownOfAges: hd.state.crownOfAges, archipelago: !!wd.archipelago }; });
    ok(w.n === 8 && w.owner === 7 && w.usurper >= 3, tag(`eight factions, the Usurper holds the Throne and ${w.usurper} regions`));
    ok(w.col === '#650824' && w.emblem === 'crownChains', tag(`the Usurper flies wine (${w.col}) with the crown and chains`));
    ok(w.crownOfAges && w.archipelago, tag('state.crownOfAges, and a partial archipelago coast'));
    await sleep(2500);
    await shot('01-crown-continent');

    // U1: conquer toward the Throne until his land is on the frontier; the hint names the Throne; his card has the Throne lines
    const target = await q(async () => {
      const hd = window.__hd; const c = hd.world.crown.throne;
      const P = await import(new URL('game/meta/progression.js', document.baseURI).href);
      const dist = new Map([[c, 0]]); const queue = [c];
      while (queue.length) { const r = queue.shift(); for (const n of hd.world.regions[r].neighbors) if (!dist.has(n)) { dist.set(n, dist.get(r) + 1); queue.push(n); } }
      for (let i = 0; i < 60; i++) {
        const fr = P.attackableFrontier(hd.state, hd.world);
        if (fr.includes(c)) return c;
        const next = fr.filter((id) => id !== c && hd.state.owner[id] !== 7).sort((a, b) => dist.get(a) - dist.get(b))[0] ?? fr.filter((id) => id !== c).sort((a, b) => dist.get(a) - dist.get(b))[0];
        if (next == null) return null;
        hd.conquerRegion(next);
      }
      return null;
    });
    ok(target != null, tag(`the Throne of Ages is attackable (region ${target})`));
    await t.waitFor(() => window.__hd.hintFacts().usurperRegion >= 0, 5000);
    const u1Region = await q(() => window.__hd.hintFacts().usurperRegion);
    ok(u1Region >= 0, tag(`the U1 fact names a Usurper region (${u1Region})`));
    await q((id, z) => window.__hd.flyToRegion(id, z, 1), u1Region, mobile ? 13 : 18);
    const u1 = await t.waitFor(async () => {
      const { CROWN } = await import(new URL('game/config/crown.js', document.baseURI).href);
      const c = document.querySelector('.coach-bubble, .coach');
      return !!c && !c.closest('[hidden]') && c.textContent.includes(CROWN.copy.hint.slice(0, 30));
    }, 20000);
    ok(u1, tag('hint U1 points at the Usurper\'s land'));
    if (u1) await shot('02-hint-U1');
    await q((id) => window.__hd.selectRegion(id), target);
    await sleep(700);
    const card = await q(() => [...document.querySelectorAll('.region-card-sea-line')].filter((e) => !e.closest('[hidden]')).map((e) => e.textContent).join(' | '));
    ok(/Throne of Ages/.test(card) && /Usurper/.test(card), tag(`the Throne's card names the Throne and the Usurper (${card.slice(0, 90)}…)`));
    ok(await t.waitFor(() => !!window.__hd.state.tutorial.seen.U1, 4000), tag('U1 is seen once his card is read'));
    await shot('03-throne-card');
    await q(() => window.__hd.selectRegion(null));

    // 2. the Throne of Ages (dev start; the player's sites are kept strong so the phases can be reached in a check's time)
    await q((id) => window.__hd.startBattle(id), target);
    ok(await t.waitFor(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live', 20000), tag('the Throne battle is live'));
    await keepStrong(true);
    await sleep(1200);
    let i1 = await info();
    ok(i1 && i1.throne && i1.phase === 1 && i1.championPosts === 3 && i1.champions === 3, tag('phase 1: three Champions guard the Gate'));
    const hud1 = await q(() => document.querySelector('.battle-feature')?.textContent || '');
    ok(/Champions guard the Gate/.test(hud1), tag(`the HUD line says so ("${hud1}")`));
    await shot('04-throne-phase1');
    // the Champions' posts fall (dev captures), then the Gate
    const posts = await q(() => window.__hd.battle.arena.throne.champions.map((c) => c.site));
    for (const s of posts) { await q((sid) => { const b = window.__hd.battle; b.sites[sid].owner = 0; b.sites[sid].troops = 1e6; }, s); await sleep(500); }
    ok(await t.waitFor(() => window.__hd.throneInfo().championsFell === 3 && window.__hd.throneInfo().champions === 0, 6000), tag('each Champion\'s fall is shown (throneChampion x3)'));
    await shot('05-champions-fallen');
    await q(() => { const b = window.__hd.battle; const g = b.sites[b.arena.throne.gate]; g.owner = 0; g.troops = 1e6; });
    ok(await t.waitFor(() => window.__hd.throneInfo().phase === 2 && window.__hd.throneInfo().phases.includes(2), 6000), tag('phase 2: the Gate falls, the borrowing begins'));
    // each borrowed weapon: telegraphed, then struck
    const seenKinds = new Set();
    const t0 = Date.now();
    while (seenKinds.size < 3 && Date.now() - t0 < 150000) {
      const inf = await info();
      if (inf.telegraph && !seenKinds.has(inf.telegraph.kind)) {
        seenKinds.add(inf.telegraph.kind);
        await sleep(1500);
        await shot(`06-borrow-${inf.telegraph.kind}`);
      }
      if (inf.phase !== 2 || inf.usurper?.fielded) break;
      await sleep(300);
    }
    const i2 = await info();
    ok(['rising', 'tide', 'plague'].every((k) => seenKinds.has(k)), tag(`each borrowed weapon is telegraphed (${[...seenKinds].join(', ')})`));
    ok(await t.waitFor(() => window.__hd.throneInfo().borrows.plague >= 1, 8000), tag(`and strikes (rising ${i2.borrows.rising}, tide ${i2.borrows.tide}, plague ${i2.borrows.plague}; tide losses shown ${i2.tideLost})`));
    // phase 3: the keep falls under assault (dev: taken), the Usurper takes the field with his health bar
    await q(() => { const b = window.__hd.battle; const k = b.sites[b.arena.throne.keep]; k.owner = 0; k.troops = 1e6; });
    ok(await t.waitFor(() => window.__hd.throneInfo().phase === 3 && window.__hd.throneInfo().usurper.fielded, 8000), tag('phase 3: the Usurper takes the field'));
    ok(await t.waitFor(() => window.__hd.throneInfo().usurper.drawn, 6000), tag('his hero squad is drawn with a health bar'));
    const hud3 = await q(() => document.querySelector('.battle-feature')?.textContent || '');
    ok(/Usurper/.test(hud3), tag(`the HUD line follows him ("${hud3}")`));
    await sleep(800);
    await shot('07-usurper-field');
    // he falls (dev: his troops cut), then the battle is won (we hold the keep)
    await q(() => { clearInterval(window.__p13cut); window.__p13cut = setInterval(() => { const b = window.__hd.battle; const sq = b && b.squads.find((x) => x.usurper); if (sq) sq.count = sq.count > 2 ? sq.count * 0.5 : 0; }, 250); });
    ok(await t.waitFor(() => window.__hd.throneInfo().usurper.fell && window.__hd.throneInfo().fell >= 1, 30000), tag('the Usurper falls (usurperFell shown)'));
    await sleep(400);
    await shot('08-usurper-falls');
    await q(() => clearInterval(window.__p13cut));
    ok(await t.waitFor(() => window.__hd.battle && window.__hd.battle.result === 'win', 30000), tag('the Throne battle is won'));
    await keepStrong(false);

    // 3. the ending: Continue -> the map; it plays on its own once the map is calm (tour, the Chronicle, the credits), by real presses
    await q(() => window.__hd.crown.devForget());
    ok(await t.waitFor(() => { const b = [...document.querySelectorAll('.results-card .btn-primary')].find((e) => e.getClientRects().length && !e.closest('[hidden]')); return !!b; }, 15000), tag('the results card is up'));
    await t.clickSel('.results-card .btn-primary');
    ok(await t.waitFor(() => window.__hd.scene === 'world', 20000), tag('Continue -> the map'));
    ok(await t.waitFor(() => window.__hd.crown.playing && window.__hd.crown.view?.phase === 'tour', 30000), tag('the ending starts on its own: the camera tour'));
    ok(await q(() => document.documentElement.hasAttribute('data-dialog')), tag('it is a dialog (the toasts and leader lines wait)'));
    await sleep(2500);
    await shot('09-ending-tour');
    ok(await t.waitFor(() => window.__hd.crown.view.phase === 'chronicle', 40000), tag('the tour hands over to the Chronicle scroll'));
    await sleep(1200);
    const scroll = await q(() => window.__hd.crown.view.text());
    ok(/The Chronicle of Your Reign/.test(scroll) && /Crowned/.test(scroll) && /Regions conquered/.test(scroll), tag('the scroll is built from endingRecord (the Crown, Generals, Deeds)'));
    const fits = await q(() => { const p = document.querySelector('.ending-scroll'); const r = p.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; });
    ok(fits, tag(`the scroll fits the screen (${width} px)`));
    await shot('10-ending-chronicle');
    ok(await t.clickSel('.ending-scroll .ending-next'), tag('a real press on Continue'));
    ok(await t.waitFor(() => window.__hd.crown.view.phase === 'credits', 4000), tag('the credits'));
    const credits = await q(() => document.querySelector('.ending-credits').textContent);
    ok(/made with Claude/.test(credits), tag('"made with Claude"'));
    await sleep(1300);
    await shot('11-ending-credits');
    ok(await t.clickSel('.ending-credits .ending-next'), tag('a real press on "Return to the realm"'));
    ok(await t.waitFor(() => !window.__hd.crown.playing && !window.__hd.crown.pending() && !document.documentElement.hasAttribute('data-dialog'), 4000), tag('the ending is over and recorded as seen'));
    // a replay is skipped with Escape (Reduce Motion on: cuts, no drift)
    await q(() => { window.__hd.state.settings.reduceMotion = true; window.__hd.crown.devForget(); });
    ok(await t.waitFor(() => window.__hd.crown.playing, 10000), tag('a toppled Throne not yet seen plays again'));
    await sleep(600);
    await t.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await t.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    ok(await t.waitFor(() => !window.__hd.crown.playing && window.__hd.crown.view.el.hidden, 3000), tag('Escape skips it'));
    await q(() => { window.__hd.state.settings.reduceMotion = false; });

    // 4. the title's lasting Crown
    await q(() => window.__hd.services.autosave.save({ force: true }));
    await q(() => window.__hd.services.goto.title());
    ok(await t.waitFor(() => window.__hd.scene === 'title', 8000), tag('back at the title'));
    await q(() => { for (const b of document.querySelectorAll('.toast-close')) b.click(); });
    const crownText = await q(() => { const c = document.querySelector('.title-crown'); return c && !c.hidden ? c.textContent : ''; });
    ok(/Crowned in Year \d+/.test(crownText), tag(`the title wears the Crown ("${crownText}")`));
    await sleep(1200);
    await shot('12-title-crown');
    ok(await t.clickText('button', 'Continue'), tag('Continue'));
    ok(await t.waitFor(() => window.__hd.scene === 'world', 20000), tag('the realm again'));
    await sleep(1200);

    // 5. an Ascension 1 founding through the ceremony (real presses)
    await q(() => window.__hd.completeRealm());
    await sleep(600);
    await q(() => [...document.querySelectorAll('.hud-btn')].find((b) => /Realm/.test(b.textContent))?.click());
    await sleep(800);
    ok(await q(() => { const a = document.querySelector('.ascension-section'); return !!a && !a.hidden && a.querySelectorAll('.ascension-rung').length === 10; }), tag('the Realm panel shows the Ascension ladder'));
    ok(await t.clickSel('.dynasty-found-btn'), tag('Found a Dynasty'));
    ok(await t.waitFor(() => !document.querySelector('.ceremony').hidden, 5000), tag('the ceremony opens'));
    for (let i = 0; i < 2; i++) { await t.clickSel('.ceremony-next'); await sleep(350); }
    await t.clickSel('.edict-card');
    await sleep(250);
    await t.clickSel('.ceremony-next');
    await sleep(400);
    ok(await q(() => { const a = document.querySelector('.ascension-pick'); return !!a && !a.hidden; }), tag('the Challenges page has the Ascension picker'));
    ok(await t.clickSel('.ascension-level[data-level="1"]'), tag('a real press on Ascension 1'));
    const det = await q(() => document.querySelector('.ascension-detail').textContent);
    ok(/Ascension 1/.test(det) && /Legacy/.test(det), tag(`it says the modifier and the Legacy bonus ("${det.slice(0, 80)}")`));
    await shot('13-ceremony-ascension');
    await t.clickSel('.ceremony-next');
    await sleep(400);
    ok(await q(() => !document.querySelector('.crown-choice').hidden), tag('the final page offers the Crown of Ages again (dynasty 7+)'));
    // the recap follows the choice: the Crown's line (no archipelago voyage) when the Crown is picked, the ordinary continent's lines otherwise
    await t.clickSel('.crown-path.is-crown');
    await sleep(300);
    const recapCrown = await q(() => document.querySelector('.ceremony-recap').textContent);
    ok(/Crown of Ages/.test(recapCrown) && !/sets sail/.test(recapCrown), tag('with the Crown picked, the recap names the Crown and no ordinary voyage'));
    await shot('14b-ceremony-final-crown');
    await t.clickSel('.crown-path.is-new');
    await sleep(300);
    const recapNew = await q(() => document.querySelector('.ceremony-recap').textContent);
    ok(!/Crown of Ages/.test(recapNew), tag('with a new continent picked, the recap has no Crown line'));
    ok(await q(() => document.querySelector('.crown-path.is-new').getAttribute('aria-checked') === 'true'), tag('"A new continent" is the checked radio'));
    await shot('14-ceremony-final');
    ok(await t.clickSel('.ceremony-found'), tag('a real press on Found'));
    ok(await t.waitFor(() => window.__hd.state.ascension === 1 && !window.__hd.world.crown, 15000), tag('the new dynasty is played at Ascension 1 on an ordinary continent'));

    const errs = t.unexpected();
    ok(errs.length === 0, tag(`no console errors${errs.length ? `: ${errs[0]}` : ''}`));
    allErrors.push(...errs);
  } catch (e) {
    ok(false, tag(`scenario threw: ${e && e.message}`));
  }
  await q(() => { clearInterval(window.__p13keep); clearInterval(window.__p13cut); }).catch(() => {});
  await t.page.close();
}

export async function phase13Checks({ launch, BASE, ok, sleep, allErrors }) {
  console.log('\n== phase13: the Crown of Ages (the continent, the Throne of Ages in three phases, the ending, the title Crown, an Ascension 1 founding) ==');
  await mkdir(OUT, { recursive: true });
  const open = makeOpen(launch, sleep);
  const only = process.env.PHASE13_ONLY || '';
  if (!only || only === 'desktop') await scenario(open, BASE, ok, sleep, allErrors, { width: 1440, height: 900, mobile: false, name: 'desktop' });
  if (!only || only === 'phone') await scenario(open, BASE, ok, sleep, allErrors, { width: 360, height: 740, mobile: true, name: 'phone' });
}
