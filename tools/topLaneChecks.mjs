// The top lane (lead, 2026-10-04): every top-centre notice shares one column, each in its own slot, never overlapping; order: the leader banner, then event
// offers, then the rest (Deeds, contracts, Trophies, streak, Vendettas). A phone shows at most two (the rest wait). Run by tools/check.mjs (`--only=toplane`),
// desktop 1440x900 and a phone 390x844, seed 7. The stage is set with dev hooks (the notices themselves are the game's own: a leader line, a world event,
// a Vendetta, Deed / contract / streak toasts with their real classes). Screenshots go to screenshots/phase8/ unless PHASE8_SHOTS=0.
import { mkdir } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';
import { TOASTS_DIGEST } from '../game/scenes/timing.js';

const OUT = 'screenshots/phase8';

/** In the page: the top notices as layout boxes in #ui (the banner's card, every toast not leaving), top to bottom. */
const LANE = () => {
  const lane = [];
  const banner = document.querySelector('.leader-banner');
  const card = banner && banner.firstElementChild;
  if (banner && banner.dataset.state === 'in' && card && card.offsetHeight > 0) lane.push({ kind: 'banner', x: banner.offsetLeft + card.offsetLeft, y: banner.offsetTop + card.offsetTop, w: card.offsetWidth, h: card.offsetHeight });
  const col = document.querySelector('.toasts');
  for (const t of col.children) {
    if (t.classList.contains('is-out') || !t.offsetHeight) continue;
    const kind = t.classList.contains('is-event') ? 'event' : t.classList.contains('is-vendetta') ? 'vendetta' : t.classList.contains('is-deed') ? 'deed' : 'toast';
    lane.push({ kind, x: col.offsetLeft + t.offsetLeft, y: col.offsetTop + t.offsetTop, w: t.offsetWidth, h: t.offsetHeight });
  }
  const overlaps = [];
  for (let i = 0; i < lane.length; i++) for (let j = i + 1; j < lane.length; j++) {
    const a = lane[i]; const b = lane[j];
    if (a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5) overlaps.push(`${a.kind}/${b.kind}`);
  }
  return { lane: lane.sort((a, b) => a.y - b.y).map((x) => x.kind), overlaps, queued: window.__hd.services.ui.toasts.queued() };
};

async function scenario(open, BASE, ok, sleep, allErrors, { width, height, mobile, name }) {
  const t = await open(`${BASE}/index.html?dev=1&seed=7`, { width, height, mobile });
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const tag = (s) => `toplane ${name}: ${s}`;
  const shot = async (n) => { if (process.env.PHASE8_SHOTS !== '0') { await t.page.screenshot(`${OUT}/toplane-${name}-${n}.png`); console.log(`  shot ${OUT}/toplane-${name}-${n}.png`); } };
  try {
    ok(await t.atTitle(), tag('boots'));
    ok(await t.clickText('button', 'New Realm'), tag('New Realm'));
    ok(await t.waitFor(() => window.__hd.scene === 'world', 40000), tag('the world is up'));
    // (the rivals' own voices are off while the lane is staged: a first contact spoken as the mists part would take the banner's slot at a random moment)
    await q(() => { const hd = window.__hd; hd.hideDev(true); hd.state.settings.hints = false; hd.state.settings.leaderVoices = false; hd.conquerRegions(6); hd.grantGold(20000); });
    await sleep(1200 + TOASTS_DIGEST.windowMs); // the conquests' own news (a Deed) is on screen first: it now waits out the post-battle digest window (Phase 10A)
    // a toast first, then the leader speaks, then an event offer, a Vendetta, a Deed, a contract and a streak toast arrive
    await q(() => {
      const hd = window.__hd; const ui = hd.services.ui; const f = hd.world.factions.find((x) => x.id > 1 && !x.absent);
      ui.toasts.update({ id: 'tl-streak', type: 'info', icon: 'flame', message: 'Streak broken: 3 conquests in a row.', duration: 30000 });
      ui.leaderBanner.update({ name: 'Gashrok', title: 'Khan', line: 'Your borders grow fat. We will see how they hold.', faction: f, durationMs: 0 });
      hd.offerEvent('deserters');
      hd.vendetta(undefined, { sec: 600 });
      ui.toasts.update({ id: 'tl-deed', type: 'success', icon: 'trophy', className: 'is-deed', seal: 'trophy', message: 'Deed earned: Unstoppable (silver): Streak window +30 s', duration: 30000 });
      ui.toasts.update({ id: 'tl-contract', type: 'success', icon: 'bounty', seal: 'bounty', message: 'Contract fulfilled: take a typed region. +1 Renown', duration: 30000 });
    });
    await sleep(1200);
    const a = await q(LANE);
    ok(a.overlaps.length === 0, tag(`no two top notices overlap (${JSON.stringify(a.lane)}${a.overlaps.length ? `; overlapping ${a.overlaps.join(', ')}` : ''})`));
    ok(a.lane[0] === 'banner', tag('the leader banner leads the column'));
    const ev = a.lane.indexOf('event');
    ok(ev < 0 ? mobile : ev === 1, tag(`the event offer comes right after it (${ev})`));
    if (mobile) ok(a.lane.length <= 2 && a.queued > 0, tag(`a phone shows at most two notices, the rest wait (${a.lane.length} shown, ${a.queued} queued)`));
    else ok(a.lane.length >= 5, tag(`desktop shows them all (${a.lane.length})`));
    await shot('01-banner-and-toasts');
    // the banner leaves: the column closes up, a phone lets the next one out, still no overlap
    await q(() => window.__hd.services.ui.leaderBanner.hide());
    await sleep(1500);
    const b = await q(LANE);
    ok(b.overlaps.length === 0 && b.lane[0] !== 'banner', tag(`after the banner leaves: ${JSON.stringify(b.lane)}, no overlap`));
    ok(b.lane[0] === 'event', tag('the event offer now leads'));
    if (mobile) ok(b.lane.length === 2, tag(`a phone shows two (${b.lane.length})`));
    await shot('02-after-banner');
    // Phase 10B: no leader banner over a modal card. A line spoken while a dialog (the War Council here) is open waits behind it and is spoken once
    // the card has closed; a banner already showing leaves when a card opens.
    await q(() => { window.__hd.state.settings.leaderVoices = true; });
    ok(await t.clickSel('.hud-btn[aria-label="War Council"]'), tag('a press opens the War Council'));
    await sleep(500);
    const spoke = await q(() => { const hd = window.__hd; const f = hd.world.factions.find((x) => x.id > 1 && !x.absent); const r = hd.world.regions.find((x) => hd.state.owner[x.id] === f.id) || hd.world.regions[0]; return !!hd.services.speak('vendetta', f.id, r.id, `tl-${Date.now()}`); });
    await sleep(600);
    const held = await q(() => document.querySelector('.leader-banner').dataset.state);
    ok(spoke && held !== 'in', tag(`a line spoken over the open council waits (spoken ${spoke}, banner ${held})`));
    await t.clickSel('.council-close');
    ok(await t.waitFor(() => document.querySelector('.leader-banner').dataset.state === 'in' && !document.documentElement.hasAttribute('data-dialog'), 3000), tag('it is spoken once the council has closed'));
    ok(await t.clickSel('.hud-btn[aria-label="War Council"]'), tag('the council again, with the banner up'));
    ok(await t.waitFor(() => document.querySelector('.leader-banner').dataset.state !== 'in', 1500), tag('the banner leaves when a modal card opens'));
    await t.clickSel('.council-close');
  } catch (e) {
    ok(false, tag(`unexpected error: ${e && e.stack}`));
  } finally {
    const errs = t.unexpected();
    ok(errs.length === 0, tag(`no console errors${errs.length ? `: ${errs[0]}` : ''}`));
    allErrors.push(...errs.map((e) => `[toplane ${name}] ${e}`));
    await t.page.close();
  }
}

export async function topLaneChecks({ launch, BASE, ok, sleep, allErrors }) {
  console.log('\n== top lane: the leader banner, event offers, Vendettas, Deeds, contracts and streak toasts share one column (desktop, phone) ==');
  await mkdir(OUT, { recursive: true });
  const open = makeOpen(launch, sleep);
  await scenario(open, BASE, ok, sleep, allErrors, { width: 1440, height: 900, mobile: false, name: 'desktop' });
  await scenario(open, BASE, ok, sleep, allErrors, { width: 390, height: 844, mobile: true, name: 'phone' });
}
