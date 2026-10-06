// Phase 7 (docs/PLAN-PHASE7.md): Boons (the draft, picks, rerolls, the Champion's eye, Duos, boonMods), Relics (placement, claim, the
// Reliquary), state and save. Focused unit tests; the sim side is in battle.boons.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/generate.js';
import { createGame } from '../meta/state.js';
import { conquer, foundDynasty, playerBattleStats, enemyBattleStats, difficulty, conquestBounty } from '../meta/progression.js';
import {
  offerBoons, pickBoon, rerollBoons, rerollBoonsInfo, pendingBoons, boonInfo, allBoons, ownedBoons, duoInfo, boonsUnlocked,
  offerChampionEye, boonBattleEnd, boonMods, boonSimStats, winDrafts,
} from '../meta/boons.js';
import { placeRelics, syncRelics, relicAt, relicsOnMap, claimRelic, reliquary, relicInfo, relicLine, relicOnFrontier } from '../meta/relics.js';
import { sanitizeBoons2, sanitizeRelics, sanitizeReliquary, defaultBoons2 } from '../meta/boonsState.js';
import { BOON_LIST, BOON_NEUTRAL, DUO_LIST, BOONS } from '../config/boons.js';
import { RELIC_LIST, RELICS } from '../config/relics.js';
import { serialize, deserialize } from '../meta/save.js';
import { earnRenown, renownPoints } from '../meta/renownState.js';
import { incomePerSec } from '../meta/economy.js';
import { deedProgress } from '../meta/deeds.js';
import { attackableFrontier } from '../meta/progression.js';

const W = generateWorld(7);
const fresh = (seed = 7, world = W) => createGame(seed, world, 0);
const M = (id) => BOON_LIST.find((b) => b.id === id).mods;
const own = (state, ...ids) => { state.boons2.owned.push(...ids); return state; };

test('boonMods: neutral with nothing, every Boon and Relic folds, Duos need both parts, sim stats only carry non-neutral keys', () => {
  const s = fresh();
  assert.deepEqual({ ...boonMods(s) }, { ...BOON_NEUTRAL });
  assert.equal(boonSimStats(s), null);
  own(s, 'bloodPrice', 'scorchedEarth');
  assert.equal(boonMods(s).atkMult, M('bloodPrice').atkMult);
  assert.equal(boonMods(s).fireArrowsDps, 0, 'one part is not a Duo');
  own(s, 'engineers');
  assert.ok(boonMods(s).fireArrowsDps > 0, 'Fire Arrows');
  s.relics.owned.push('dragonBanner', 'crownOfReeve');
  assert.equal(boonMods(s).campTroopsMult, 2);
  assert.equal(boonMods(s).freeFolkSurrender, 2);
  const sim = boonSimStats(s);
  assert.equal(sim.scorchSec, M('scorchedEarth').scorchSec);
  assert.equal(sim.atkMult, undefined, 'meta keys stay out of the sim block');
  assert.equal(sim.captureBleed, M('bloodPrice').captureBleed);
  own(s, 'phalanx', 'hitAndRun');
  assert.equal(boonSimStats(s).phalanxDmgMult, 0.8, 'a neutral-1 key folds by multiplying');
  assert.equal(boonSimStats(s).hitRunMult, 1.4);
  for (const [k, v] of Object.entries(BOON_NEUTRAL)) if (v === 1) assert.ok(k.endsWith('Mult'), `${k}: a neutral-1 key must end in Mult`);
  assert.ok(Object.values(sim).every((v) => v !== undefined));
  for (const b of BOON_LIST) for (const k of Object.keys(b.mods)) assert.ok(k in BOON_NEUTRAL, `${b.id}.${k}`);
  for (const d of DUO_LIST) for (const p of d.parts) assert.ok(BOON_LIST.some((b) => b.id === p), `${d.id} part ${p}`);
  for (const r of RELIC_LIST) for (const k of Object.keys(r.mods)) assert.ok(k in BOON_NEUTRAL, `${r.id}.${k}`);
});

test('the pool: 35 Boons (24 + Phase 8 + Phase 12), rarities and cursed ones, copy filled from config numbers', () => {
  assert.equal(BOON_LIST.length, 35);
  assert.equal(new Set(BOON_LIST.map((b) => b.id)).size, 35);
  assert.ok(BOON_LIST.filter((b) => b.cursed).length >= 3);
  for (const r of ['common', 'rare', 'legendary']) assert.ok(BOON_LIST.some((b) => b.rarity === r));
  for (const info of allBoons()) {
    assert.ok(info.text && !/[{}]/.test(info.text), `${info.id}: ${info.text}`);
    assert.ok(['bronze', 'silver', 'gold', 'crimson'].includes(info.frame));
  }
  assert.match(boonInfo('hitAndRun').text, /40%/);
  assert.equal(boonInfo('fortuneFavours').frame, 'crimson');
  for (const r of RELIC_LIST) assert.ok(!/[{}]/.test(relicInfo(r.id).text), r.id);
  assert.equal(boonInfo('nope'), null);
});

test('the draft: seeded, 3 distinct unowned relevant Boons; a new offer replaces a pending one; pick, Duo reveal, reroll', () => {
  const a = fresh(); const b = fresh();
  const ca = offerBoons(a, W); const cb = offerBoons(b, W);
  assert.deepEqual(ca, cb, 'deterministic');
  assert.equal(new Set(ca).size, 3);
  assert.deepEqual(a.boons2.pending.choices, ca);
  assert.equal(a.boons2.draws, 1);
  const again = offerBoons(a, W);
  assert.equal(a.boons2.pending.missed, true, 'the replaced offer is noted');
  assert.notDeepEqual(again, null);
  assert.equal(pickBoon(a, 'zzz').reason, 'notOffered');
  const id = a.boons2.pending.choices[0];
  const r = pickBoon(a, id);
  assert.ok(r.ok && r.boon.id === id);
  assert.equal(a.boons2.pending, null);
  assert.equal(pickBoon(a, id).reason, 'none');
  assert.deepEqual(ownedBoons(a).map((x) => x.id), [id]);
  // owned Boons are never offered again; irrelevant ones are kept out (no Ashen on a dynasty-1 continent: no Gravebreaker)
  for (let i = 0; i < 30; i++) { const c = offerBoons(a, W) || []; assert.ok(!c.includes(id)); assert.ok(!c.includes('gravebreaker')); }
  // a Duo reveal
  const d = fresh();
  own(d, 'hitAndRun');
  d.boons2.pending = { choices: ['pathfinder', 'tithe'], source: 'battle' };
  assert.equal(pickBoon(d, 'pathfinder').duo.id, 'lightningWar');
  assert.ok(duoInfo(d).find((x) => x.id === 'lightningWar').active);
  // reroll: refused without Renown, then costs BOONS.rerollRenown
  const e = fresh();
  offerBoons(e, W);
  assert.equal(rerollBoonsInfo(e).can, false);
  assert.equal(rerollBoons(e, W).reason, 'renown');
  earnRenown(e, 3, 'deed');
  const before = e.boons2.pending.choices.slice();
  const rr = rerollBoons(e, W);
  assert.ok(rr.ok);
  assert.equal(renownPoints(e), 3 - BOONS.rerollRenown);
  assert.notDeepEqual(rr.choices, before);
  assert.equal(pendingBoons(e).choices.length, 3);
});

test("the Champion's eye: once per dynasty, Rare or better", () => {
  const s = fresh();
  s.owner[W.regions.find((r) => r.tier === 1).id] = 0; // two regions held: drafts are open
  for (let k = 0; k < 20; k++) {
    const t = structuredClone(s); t.boons2.draws = k;
    const c = offerChampionEye(t, W);
    assert.ok(c && c.every((id) => boonInfo(id).rarity !== 'common'), `draw ${k}: ${c}`);
    assert.equal(t.boons2.pending.source, 'champion');
    assert.equal(offerChampionEye(t, W), null, 'once');
  }
  const locked = fresh();
  assert.equal(offerChampionEye(locked, W), null, 'not before Boons unlock');
});

test('conquer: drafts only for battle wins after the first conquest; claims the Relic; Tithe pays Renown', () => {
  const s = fresh();
  const front = attackableFrontier(s, W);
  assert.equal(boonsUnlocked(s), false);
  const first = conquer(s, W, front[0], 1000, { viaBattle: true });
  assert.equal(first.boonOffer, undefined, 'the tutorial win never drafts');
  assert.equal(boonsUnlocked(s), true);
  const second = attackableFrontier(s, W)[0];
  const r2 = conquer(s, W, second, 2000);
  assert.equal(r2.boonOffer, undefined, 'a surrender (no viaBattle) never drafts');
  const third = attackableFrontier(s, W)[0];
  const r3 = conquer(s, W, third, 3000, { viaBattle: true, labelAtAttack: 'Fair' });
  assert.equal(r3.boonOffer.length, 3);
  const r4 = conquer(s, W, attackableFrontier(s, W)[0], 4000, { viaBattle: true, labelAtAttack: 'Hard' });
  assert.equal(r4.boonMissed, true);
  // a Relic
  const t = fresh();
  const [{ regionId, relicId }] = relicsOnMap(t);
  assert.ok(relicLine(t, regionId).includes(relicInfo(relicId).name));
  const res = conquer(t, W, regionId, 0);
  assert.equal(res.relic.id, relicId);
  assert.equal(res.relic.newFind, true);
  assert.ok(t.relics.owned.includes(relicId));
  assert.equal(relicAt(t, regionId), null);
  assert.deepEqual(t.generals.reliquary.found, [relicId]);
  assert.equal(deedProgress(t).find((d) => d.id === 'reliquarian').tier, 1);
  assert.equal(res.relic.renown, 1, 'the Reliquarian bronze tier already pays');
  // Tithe
  const u = own(fresh(), 'tithe');
  const ids = W.regions.filter((r) => r.tier >= 1 && !u.relics.placed[r.id]).map((r) => r.id).slice(0, 3);
  const pays = ids.map((id, i) => conquer(u, W, id, i).tithe || 0);
  assert.deepEqual(pays, [0, 0, 1]);
});

test('draft gating: Fair, Hard and Deadly wins draft, Easy wins do not, except typed regions and capitals', () => {
  const plain = W.regions.find((r) => r.tier >= 2 && !r.type && !r.isCapital);
  const typed = W.regions.find((r) => r.type && !r.isCapital);
  const capital = W.regions.find((r) => r.isCapital && !r.type);
  for (const l of ['Fair', 'Hard', 'Deadly']) assert.equal(winDrafts(plain, l), true, l);
  assert.equal(winDrafts(plain, 'Easy'), false);
  assert.equal(winDrafts(typed, 'Easy'), true);
  assert.equal(winDrafts(capital, 'Easy'), true);
  assert.deepEqual([...BOONS.draftLabels], ['Fair', 'Hard', 'Deadly']);
  // through conquer: an Easy win (label at attack time) drafts nothing once Boons are open
  const s = fresh();
  s.owner[W.regions.find((r) => r.tier === 1).id] = 0;
  const id = W.regions.find((r) => r.tier >= 2 && !r.type && !r.isCapital && s.owner[r.id] !== 0 && !s.relics.placed[r.id]).id;
  assert.equal(conquer(structuredClone(s), W, id, 0, { viaBattle: true, labelAtAttack: 'Easy' }).boonOffer, undefined);
  assert.equal(conquer(structuredClone(s), W, id, 0, { viaBattle: true, labelAtAttack: 'Fair' }).boonOffer.length, 3);
});

test('Relics: 4 per continent, seeded, Ruins first, deep, never the tutorial ring, a capital or the Lair; unfound ones first', () => {
  for (const seed of [1, 2, 3, 7, 11]) {
    const w = generateWorld(seed);
    const s = createGame(seed, w, 0);
    const placed = Object.entries(s.relics.placed);
    assert.equal(placed.length, RELICS.perContinent, `seed ${seed}`);
    assert.equal(new Set(placed.map(([, id]) => id)).size, placed.length);
    for (const [rid] of placed) {
      const r = w.regions[rid];
      assert.ok(r.tier >= RELICS.minTier && !r.isCapital && r.type !== 'dragon', `seed ${seed} region ${rid}`);
    }
    const ruins = w.regions.filter((r) => r.type === 'ruins' && !r.isCapital && r.tier >= 2);
    for (const r of ruins.slice(0, RELICS.perContinent)) assert.ok(s.relics.placed[r.id], `seed ${seed}: Ruins ${r.id} first`);
    assert.deepEqual(createGame(seed, w, 0).relics, s.relics, 'seeded');
    assert.ok(!placed.some(([, id]) => id === 'gravewardensLantern'), 'no Lantern without the Ashen');
  }
  const s = fresh();
  s.generals.reliquary.found = Object.values(s.relics.placed);
  placeRelics(s, W);
  const now = Object.values(s.relics.placed);
  // 12 Relics (Phase 8), 4 found, the Lantern and the Seal need the Ashen: 6 undiscovered can appear, so all 4 placed are new ones
  assert.equal(now.filter((id) => !s.generals.reliquary.found.includes(id)).length, 4, 'undiscovered Relics are placed first');
  assert.equal(relicOnFrontier(fresh(), W) === null || typeof relicOnFrontier(fresh(), W) === 'number', true);
  const q = reliquary(s);
  assert.equal(q.total, RELIC_LIST.length);
  assert.equal(q.found, 4);
});

test('foundDynasty resets Boons and Relics, keeps the Reliquary; a new continent gets its own Relics', () => {
  const s = own(fresh(), 'tithe', 'phalanx');
  s.boons2.pending = { choices: ['engineers'], source: 'battle' };
  const [{ regionId }] = relicsOnMap(s);
  conquer(s, W, regionId, 0);
  s.owner = s.owner.map(() => 0);
  const w2 = generateWorld(99, { dynasty: 2 });
  const next = foundDynasty(s, 99, w2, W);
  assert.deepEqual(next.boons2, defaultBoons2());
  assert.deepEqual(next.relics.owned, []);
  assert.equal(next.relics.seed, 99);
  assert.equal(Object.keys(next.relics.placed).length, RELICS.perContinent);
  assert.equal(next.generals.reliquary.found.length, 1);
});

test('save: round trip, junk and an old save', () => {
  const s = own(fresh(), 'tithe', 'kingslayer');
  s.boons2.pending = { choices: ['engineers', 'phalanx'], source: 'champion', missed: true };
  const [{ regionId }] = relicsOnMap(s);
  conquer(s, W, regionId, 0);
  const back = deserialize(serialize(s));
  assert.deepEqual(back.boons2, s.boons2);
  assert.deepEqual(back.relics, s.relics);
  assert.deepEqual(back.generals.reliquary, s.generals.reliquary);
  // junk
  assert.deepEqual(sanitizeBoons2('x'), defaultBoons2());
  const j = sanitizeBoons2({ v: 9, owned: ['tithe', 'tithe', 'nope', 5], pending: { choices: ['tithe', 'phalanx', 'x'], source: 'evil' }, draws: -4, champEyeUsed: 'yes' });
  assert.deepEqual(j.owned, ['tithe']);
  assert.deepEqual(j.pending, { choices: ['phalanx'], source: 'battle' });
  assert.equal(j.draws, 0);
  assert.equal(j.champEyeUsed, false);
  assert.equal(sanitizeBoons2({ pending: { choices: [] } }).pending, null);
  const r = sanitizeRelics({ seed: 'x', placed: { 3: 'sundial', 4: 'sundial', abc: 'emberHeart', 5: 'nope' }, owned: ['sundial', 'x'] });
  assert.deepEqual(r.placed, { 3: 'sundial' });
  assert.equal(r.seed, null);
  assert.deepEqual(r.owned, ['sundial']);
  assert.deepEqual(sanitizeReliquary({ found: ['sundial', 'sundial', 'x'] }).found, ['sundial']);
  // an old save: nothing owned; syncRelics places the Relics once on regions not yet owned
  const old = JSON.parse(serialize(fresh()));
  delete old.boons2; delete old.relics; delete old.generals.reliquary;
  const o = deserialize(JSON.stringify(old));
  assert.deepEqual(o.boons2, defaultBoons2());
  assert.equal(o.relics.seed, null);
  syncRelics(o, W);
  assert.equal(Object.keys(o.relics.placed).length, RELICS.perContinent);
  const placed = { ...o.relics.placed };
  syncRelics(o, W);
  assert.deepEqual(o.relics.placed, placed, 'once');
});

test('meta effects: the card and stats count Blood Price, the Dragon Banner and Kingslayer; Fortune, Plunderers, the Hoard, the Lens', () => {
  const s = fresh();
  const target = attackableFrontier(s, W)[0];
  const p0 = playerBattleStats(s, W, target); const d0 = difficulty(s, W, target); const e0 = enemyBattleStats(W, s, target);
  own(s, 'bloodPrice', 'kingslayer');
  s.relics.owned.push('dragonBanner');
  const p1 = playerBattleStats(s, W, target);
  assert.ok(Math.abs(p1.atk / p0.atk - M('bloodPrice').atkMult) < 1e-9);
  assert.ok(Math.abs(p1.campTroops / p0.campTroops - 2) < 1e-9);
  assert.equal(enemyBattleStats(W, s, target).keepTroopMult, 0.8);
  assert.equal(e0.keepTroopMult, 1);
  assert.ok(difficulty(s, W, target).ratio > d0.ratio * 2);
  assert.equal(p1.boons.captureBleed, M('bloodPrice').captureBleed);
  // Fortune Favours
  const f = fresh();
  const b0 = conquestBounty(f, W, target);
  own(f, 'fortuneFavours');
  assert.ok(Math.abs(conquestBounty(f, W, target) / b0 - M('fortuneFavours').bountyMult) < 1e-9);
  f.gold = 1000;
  const lossShare = M('fortuneFavours').lossGoldShare;
  assert.equal(boonBattleEnd(f, W, { stats: { captured: 0 } }, 'lose').goldLost, 1000 * lossShare);
  assert.equal(f.gold, 1000 * (1 - lossShare));
  assert.equal(boonBattleEnd(f, W, { stats: { captured: 0 } }, 'win').goldLost, 0);
  // Plunderers
  const g = own(fresh(), 'plunderers');
  const pay = boonBattleEnd(g, W, { stats: { captured: 3 } }, 'win').plunder;
  assert.ok(Math.abs(pay - 3 * M('plunderers').plunderSec * incomePerSec(g, W)) < 1e-6);
  // the Royal Hoard: +1% per minute of income held, capped
  const h = fresh();
  const base = incomePerSec(h, W);
  own(h, 'hoard');
  h.gold = base * 60 * 5.5;
  assert.ok(Math.abs(incomePerSec(h, W) / base - 1.05) < 1e-9);
  h.gold = 1e12;
  assert.ok(Math.abs(incomePerSec(h, W) / base - 1.2) < 1e-9);
});
