# Crowns and rival leaders — hookup guide for integration

Everything below is written against the code as it stood on 2026-09-29 (battle.js `runSim` /
`beginEndSequence` / `showResults` / `onResultsContinue`, world.js `onSurrender` / `setSelected` /
`regionCardData` / `refreshDerived`, main.js `ui = {...}`). Function names are the anchor; if a line
moved, search for the function. DESIGN §4.8 (crowns), §3.6 (leaders), §5.7 (scout / sabotage triggers).

Nothing here needs a change to `game/battle/*` or `progression.js`.

## Lead decisions (override anything below that disagrees)
1. **Payoff lines skip the 15 s gap.** `VOICE.gapExempt = ['keepLost', 'decapitation']` is set
   in `game/config/leaders.js` and tested.
2. **Seed first contacts.** Starting neighbours are silently marked as met with
   `seedContacts` (§12), so the Reeve never speaks late, after the tutorial. Do it.
3. **Apply the `save.js` patch from §1.** The 4 red `meta.save` tests stay red until you do.
4. **No z-index hack for the first-victory crowns explanation (§11).** Use a static one-line
   caption under the crown row on the first victory card only: "Win faster, or without losing
   a settlement, for more crowns."
5. **Phone frontier region card:** replace the three empty medals with one compact line, e.g.
   "Par 1:00 · crowns +25% bounty each". Medals appear only on owned regions and the victory
   card. Desktop keeps the empty medals. The card also gains the intel panel (§5.7), so watch
   the bottom-sheet height (≤ ~40% of 844 px).
6. **Map pips:** size = 0.72 × label font, clamped to 11–16 px. Pips go with their label in
   the collision pass.
7. **Also fix, found by the features engineer:**
   - The battle HUD region pill overlaps the pause button at 640–800 px widths.
   - The phone battle HUD uses about 170 px of top chrome. Get the power buttons onto one row
     (the lead's standing critique).
   - The Free Folk emblem (cream wheat on a stone-grey disc) is low contrast. Darken the disc
     or outline the emblem in `drawEmblem`.

## 0. What was built (all self-contained, tested)

| file | what |
|---|---|
| `game/config/crowns.js` | par bands, bounty fraction, surrender crowns, copy |
| `game/meta/crowns.js` | pure: `parFor`, tracker, `crownsFor`, `awardCrowns`, `crownTotals` |
| `game/config/leaders.js` | 11 triggers, titles, name syllables, 4-6 lines per faction per trigger, timing |
| `game/meta/leaders.js` | pure: `leaderFor`, `pickLine`, `createVoiceGate`, `createLeaderVoice`, first-contact helpers |
| `game/ui/crownRow.js` + `styles/components/crowns.css` | `createCrownRow({size, onAward})` |
| `game/ui/leaderBanner.js` + `styles/components/leaderbanner.css` | `createLeaderBanner({below})` |
| `game/render/crownPips.js` | `drawCrownPips(ctx, x, y, count, sizePx, opts?)` |
| `game/meta/state.js` (additive) | `crowns[]`, `metFactions[]`, `stats.crownsEarned`, `settings.leaderVoices` |
| `tools/gallery/features.html` | every state; `tools/gallery/features-check.mjs` = real-browser assertions |

Signatures you will call:

```js
// meta/crowns.js
trackerOf(battle) -> tracker                      // creates battle.crownTracker (saved with the battle)
trackBattle(tracker, battle)                      // = trackEvents(tracker, battle.events, battle.t); after EVERY step
evaluateBattle(tracker, battle, world, regionId, state?) -> { summary, crowns, parSec }
crownsForSurrender() -> { victory: true, swift: false, unbroken: false }
awardCrowns(state, world, regionId, crowns, baseBounty?) -> { bonusGold, count }   // MUTATES
crownBonus(state, world, regionId, crowns, baseBounty?) -> gold                    // pure preview
getCrowns(state, regionId) -> crowns | null       // safe on old saves
crownCount(crowns) -> 0..3
crownTotals(state, world) -> { earned, possible }
parFor(world, regionId, state?) -> seconds

// meta/leaders.js
createLeaderVoice({ getState, minGapSec?, gapExempt? }) -> { say(trigger, ctx) -> line | null, canSay, resetBattle, reset, gate }
newContacts(state, world) -> [{ faction, regionId }]      markMet(state, faction)      seedContacts(state, world)
leaderFor(seed, dynasty, faction) -> { faction, title, name, fullName } | null
```

Verified by test: crowns are stored per region, `awardCrowns` never pays the base bounty (pass
`conquer()`'s returned `bounty` as `baseBounty`), and a conquered region's own Harbour perk cannot inflate
the bonus even if you omit `baseBounty`.

## 1. State and save

`state.js` (done) adds, all reset by `resetRegions()` (which `createGame` and `container.tryFoundDynasty`
already call, so a new dynasty clears them with no change to `foundDynasty`):

- `state.crowns: (null | {victory, swift, unbroken})[]`, one slot per region id, this dynasty only
- `state.metFactions: number[]`, factions whose first-contact line is done, this dynasty only
- `state.stats.crownsEarned` (lifetime, survives dynasties) and `state.settings.leaderVoices = true`

`stats` and `settings` are spread over their defaults in `save.js`, so `crownsEarned` and
`leaderVoices` already persist and old saves pick up the defaults. Verified.

**`crowns` and `metFactions` are top-level arrays, so `save.js` `withDefaults` drops them today.**
That is why 4 `meta.save` round-trip tests are red right now (they compare the deserialised state with
the original). Apply this patch to `game/meta/save.js`; I ran it against a scratch copy: the 4 tests'
assertions pass, a legacy save without the fields migrates to `[]`, and junk input is cleaned.

```js
// next to nullableNumArray()
/** Per-region crowns (crowns.js): null, or {victory, swift, unbroken} booleans. Old saves have none: []. */
function crownList(value) {
  return Array.isArray(value)
    ? value.map((c) => (c && typeof c === 'object'
      ? { victory: !!c.victory, swift: !!c.swift, unbroken: !!c.unbroken } : null))
    : [];
}

function intList(value) {
  return Array.isArray(value) ? value.filter((v) => Number.isInteger(v)) : [];
}
```

```js
// in withDefaults(), right after the conqueredAt line
    conqueredAt: nullableNumArray(src.conqueredAt),
    crowns: crownList(src.crowns),
    metFactions: intList(src.metFactions),
```

Optional hygiene in `progression.js foundDynasty` (not required, `resetRegions` covers it): add
`crowns: [], metFactions: [],` to the `next` literal so a state between `foundDynasty` and `resetRegions`
never carries the old dynasty's crowns. Balance owns that file; skip unless convenient.

## 2. CSS

`game/styles/main.css`, after `overlays.css`:

```css
@import url('./components/crowns.css');
@import url('./components/leaderbanner.css');
```

The banner reads `--leader-banner-top` (default 100 px desktop, 84 px phone) and is `z-index: 31`
(above the coach at 30, below modals at 40 and toasts at 50). Nothing else to override.

## 3. Shared services (main.js)

```js
import { createLeaderBanner } from './ui/leaderBanner.js';
import { createLeaderVoice } from './meta/leaders.js';

// in the `ui = {...}` object, after `toasts`, `coach`:
leaderBanner: createLeaderBanner({
  // Sit under whatever top chrome is on screen. Measured each time it speaks, so the phone battle HUD
  // (button row above the region pill, ~170 px tall) and the 76 px world HUD both work.
  below: () => [
    ui.hud.el,
    ui.battleHud.el.hidden ? null : ui.battleHud.el.querySelector('.battle-top'),
    ui.battleHud.el.hidden ? null : ui.battleHud.el.querySelector('.battle-topright'),
    ui.toasts.el,
  ],
}),
```

Mount `ui.leaderBanner.el` in `#ui` wherever the other panels are mounted (once, always in the DOM; it
hides itself). Then, after `ui` exists:

```js
const voice = createLeaderVoice({ getState: () => cur().state });
services.speak = (trigger, factionId, regionId, scope) => {
  const { world } = cur();
  const line = voice.say(trigger, {
    faction: factionId,
    region: regionId != null ? world.regions[regionId].name : undefined,
    nowSec: performance.now() / 1000,          // REAL time, not battle time (works on the map, ignores 2x/3x/pause)
    tutorialVisible: !ui.coach.el.hidden,      // never speak over a hint
    scope,                                     // finer once-per-battle key, see the trigger table
  });
  if (!line) return null;
  ui.leaderBanner.update({ ...line, faction: world.factions[line.faction] });
  return line;
};
services.voice = voice;

// Coach wins any clash: when a hint appears, a banner that is still up leaves at once.
const coachUpdate = ui.coach.update;
ui.coach.update = (data) => { if (data && data.visible) ui.leaderBanner.hide(); coachUpdate(data); };
```

`say()` already checks `state.settings.leaderVoices`, so nothing else needs to look at the setting.
`say()` returns the finished `{trigger, faction, name, title, fullName, line}` or `null`.

## 4. Battle scene: tracker, crowns, results

**4a. Create and feed the tracker** (`battle.js`)

```js
import { trackerOf, trackBattle, evaluateBattle, awardCrowns, crownBonus } from '../meta/crowns.js';

// startBattle(): right after `battle = createBattle(arena, player, enemy);`
trackerOf(battle);               // attaches battle.crownTracker; it is plain JSON and saves with state.battle
services.voice.resetBattle();    // every trigger may speak again

// runSim(): inside the stepper callback, straight after step():
step(battle, TICK_SEC);
trackBattle(trackerOf(battle), battle);   // once per STEP, not once per frame (3x speed = several steps a frame)
```

Duration is `battle.t`, so 1x/2x/3x and pause cannot change a Swift result. A reload mid-battle keeps
the tracker (it lives in `state.battle`), so an unbroken run stays unbroken.

**4b. Summarise at the end** (`beginEndSequence(result)`, in the `result === 'win'` branch, before
`showResults`):

```js
let crownResult = null;          // scene variable
...
if (result === 'win') {
  crownResult = evaluateBattle(trackerOf(battle), battle, world, regionId, state);
  // { summary: {won, durationSec, playerSitesLost}, crowns: {victory,swift,unbroken}, parSec }
}
```

On resume (`enter({ resume })` with `battle.result === 'win'`) compute `crownResult` the same way before
`showResults()`. Legacy battles without a tracker get a fresh one: Unbroken is then assumed.

**4c. Results card** (`showResults`, victory branch): add to the `ui.results.update({...})` data

```js
crowns: crownResult.crowns,
parSec: crownResult.parSec,
crownBonus: crownBonus(state, world, regionId, crownResult.crowns),  // gold, exact (pre-conquest bounty)
bonusPct: 25,                                                         // shows "+25%" under each earned crown
```

and in `game/ui/results.js`:

```js
import { createCrownRow } from './crownRow.js';

// createResults({ onContinue, onRetry, onBackToMap, onCrown } = {}):
const crownRow = createCrownRow({ size: 'lg', onAward: (_key, i) => onCrown?.(i) });

// renderVictory(data), before the stats grid is appended:
if (data.crowns) {
  crownRow.reset();                 // two wins in a row with equal crowns must both animate
  crownRow.update({
    earned: data.crowns, parSec: data.parSec, animate: true,
    durationSec: data.durationSec, bonusPct: data.bonusPct,
  });
  bodyEl.appendChild(h('div.results-crowns', {}, crownRow.el));
}
// and in the stats grid, when data.crownBonus > 0:
stat('crown', `+${shortNumber(data.crownBonus)} crown bonus`, '.icon-gold'),
```

Sound: `main.js` `results: createResults({ ..., onCrown: (i) => sfx.play('upgrade', { pitch: 1 + i * 0.16, volume: 0.6 }) })`.
The existing `upgrade` cue is a sparkle; `coin` also works. The row calls `onAward` once per crown, about
350 ms apart (first at ~450 ms so the card's 420 ms pop finishes first). Under Reduce Motion
(`html.reduce-motion`, or the OS setting) the crowns fill at once with a fade and `onAward` fires
back-to-back.

**4d. Pay the bonus right after `conquer()`** (`onResultsContinue`, inside `leave(() => {...})`):

```js
const result = conquer(state, world, id, Date.now());
const crownAward = awardCrowns(state, world, id, crownResult.crowns, result.bounty);  // does not repay the base bounty
goto.world({
  cameFromBattle: true,
  conquered: {
    regionId: id, bounty: result.bounty + crownAward.bonusGold,   // coins + credit hold include the bonus
    beforeRevealed, oldOwner, frontierBefore, decapitated: !!result.decapitated,
  },
});
```

Only wins award crowns. Defeat and retreat store nothing, and a retry after a loss simply fights again:
"retries count only the winning battle" holds because nothing is written until a win is continued.

**4e. Surrender** (`world.js onSurrender`): Victory only, one crown of bonus.

```js
import { awardCrowns, crownsForSurrender } from '../meta/crowns.js';

const result = conquer(state, world, regionId, Date.now());
const crownAward = awardCrowns(state, world, regionId, crownsForSurrender(), result.bounty);
state.stats.surrenders += 1;
const gained = result.bounty + crownAward.bonusGold;
applyConquestVisuals(regionId, beforeRevealed, gained, { oldOwner });
ui.toasts.update({ type: 'success', icon: 'flag',
  message: `${world.regions[regionId].name} surrendered! +${shortNumber(gained)} gold` });
```

Dev conquests (`devConquer*`) award no crowns; that is fine and keeps dev runs from polluting totals.

## 5. Region card (par, empty crowns, earned crowns)

`world.js regionCardData()`:

```js
import { parFor, getCrowns } from '../meta/crowns.js';
// owned branch (skip the home region, tier 0):
crowns: region.tier === 0 ? undefined : getCrowns(state, regionId), parSec: parFor(world, regionId, state),
// frontier branch:
crowns: null, parSec: parFor(world, regionId, state),
```

`game/ui/regionCard.js`:

```js
import { createCrownRow } from './crownRow.js';
const crownRow = createCrownRow({ size: 'sm' });          // created once, re-appended on each render

// renderFrontier(data), after the matchup block, before the rewards:
crownRow.update({ earned: null, parSec: data.parSec });    // three open crowns + "Swift ≤ 1:30"
bodyEl.appendChild(h('div.region-card-crowns', {},
  h('span.region-card-crowns-label', {}, 'Crowns: +25% bounty each'), crownRow.el));

// renderOwned(data):
if (data.parSec != null && data.crowns !== undefined) {
  crownRow.update({ earned: data.crowns || { victory: false, swift: false, unbroken: false }, parSec: data.parSec });
  bodyEl.appendChild(crownRow.el);
}
```

`update()` is safe to call every refresh (it is deduped), and `earned: null` (open) versus an object
(final; a false key renders as a struck-through "missed" crown) is the only mode switch. Style for the
small label if wanted: `font-size: var(--fs-xs); color: var(--text-muted)` (see the gallery, "In context").
On the phone bottom sheet the row was checked at 390 px (three columns of about 100 px; labels wrap
instead of overflowing).

## 6. Realm panel

`world.js updateRealm()`: `ui.realm.update({ stats, dynasty, canFoundDynasty, crowns: crownTotals(state, world) })`.
`game/ui/realm.js`: add `['crownsEarned', 'crown', 'Crowns, lifetime']` to `STAT_ROWS`, and one more row
fed from `data.crowns` (`{earned, possible}`), e.g. `Crowns this dynasty  38 / 78`, using the same
`h('div.realm-stat', ...)` markup (mocked in the gallery, "In context").

## 7. Map label pips

`world.js refreshDerived()` (owned regions only; it already re-runs on every conquest via `markDirty`):

```js
import { getCrowns, crownCount } from '../meta/crowns.js';
if (owned) datum.crowns = crownCount(getCrowns(state, region.id));
```

`render/labels.js`:

```js
import { drawCrownPips } from './crownPips.js';

// candidate layout: reserve room under the name when the label has pips
const pipPx = Math.max(9, Math.min(16, Math.round(fontPx * 0.72)));
const hasPips = !!(d.crowns > 0) && camera.zoom >= 9;          // same threshold as the difficulty chips
// bottom = hasPips ? baseY + fontPx * 0.35 + pipPx * 0.72 : (existing)

// draw, right after the name's fillText:
if (hasPips) drawCrownPips(ctx, c.x, y + fontPx * 0.35 + pipPx * 0.36, d.crowns, pipPx);
```

`drawCrownPips` returns `{w, h}` if you would rather measure. Pass `{ total: 3 }` in the options to show
the missing crowns as dim hollow slots (2 of 3 reads as two gold and one empty); the default shows only
earned crowns. It snaps to device pixels, so draw in CSS pixels with the DPR transform applied.
Owned regions with no crowns and the home region draw nothing.

## 8. "Leader voices" setting

`game/ui/settings.js`, mirroring the Hints row:

```js
// createSettings({ ..., onToggleLeaderVoices })
const voicesRow = toggleRow({
  label: 'Leader voices', checked: true,
  onToggle: (v) => { voicesRow.setToggle(v); onToggleLeaderVoices?.(v); },
});
// add voicesRow to the section next to hintsRow; in update(data):
if (data.leaderVoices != null) voicesRow.setToggle(data.leaderVoices);
```

`main.js`: `onToggleLeaderVoices: (v) => { cur().state.settings.leaderVoices = v; autosave.save(); }` and pass
`leaderVoices: s.leaderVoices !== false` in `openSettings()`'s `ui.settings.update`. Turning it off also
calls `ui.leaderBanner.hide()`.

## 9. Leader triggers: every condition and where it goes

`speak` = `services.speak(trigger, factionId, regionId, scope)` from section 3. All triggers obey the same
gate: setting off, coach visible, once per trigger per battle (per `scope` where given), 15 s between lines.
The speaker is always the leader of the faction that owns the region in play.

| trigger | exact condition | where | speaker / scope |
|---|---|---|---|
| `firstContact` | a region of a faction with a leader becomes frontier for the first time this dynasty: `newContacts(state, world)` lists it and `state.metFactions` lacks it. Call `markMet` **only if `speak` returned a line**, so a contact blocked by the tutorial hint or the 15 s gap stays pending | world scene: after `refreshDerived()` recomputes the frontier (owner key changed), about 1.2 s after `applyConquestVisuals` so it lands when the mists part; also retry while any contact is pending (once a second is plenty) | `entry.faction`; region `entry.regionId`; scope = faction id |
| `battleStart` | a fresh battle goes live and the region is not a capital and not sabotaged | battle scene: the moment `phase` flips to `'live'` in `frame()` (where `ui.battleHud.el.hidden = false`), and at the end of `startBattle` when `opts.skipIntro` (Retry). Not on resume | `battle.arena.enemyFaction`, `regionId` |
| `capitalBattleStart` | same, and `world.regions[regionId].isCapital` | same place | same |
| `sabotaged` | same moment, and the region has been sabotaged (DESIGN §5.7); **replaces** `battleStart` / `capitalBattleStart` | same place; the intel engineer's state says whether a region is sabotaged | same |
| `keepAssaulted` | the enemy keep's `assault` becomes non-null. In the sim that is exactly the `assault` event with `owner === PLAYER_OWNER` on a site with `type === 'keep'` in the target region and `site.owner !== PLAYER_OWNER` (movement.js emits it only on the null to non-null change) | `handleEvent` `case 'assault'`, **before** the `assaultSpark` throttle `break` | `enemyFaction`, `regionId` |
| `keepLost` | `capture` event with `to === PLAYER_OWNER` on a keep of the target region, region **not** a capital | `handleCapture` (`isKeep && ev.to === PLAYER_OWNER`) | `enemyFaction`, `regionId` |
| `decapitation` | same capture but the region is a capital (**instead of** `keepLost`), or `conquer()` returned `decapitated: true` on a surrender | `handleCapture`, and world.js `onSurrender` after `conquer()` (speaker = `oldOwner`) | the faction whose capital fell |
| `surrenderOffer` | the region card opens (selection changes) for a frontier region whose `difficulty(...).surrender` is true. Selection only, not the 1 s card refresh | world.js `setSelected(id)`, after `refreshRegionCard()` | `state.owner[id]`, `id`; scope = region id (one per region) |
| `playerDefeat` | the `end` event with `result === 'lose'` | `beginEndSequence`, `result === 'lose'` branch | `enemyFaction`, `regionId` |
| `playerRetreat` | the `end` event with `result === 'retreat'` | `beginEndSequence`, retreat branch | `enemyFaction`, `regionId` |
| `scouted` | the player buys Scout on a region card (DESIGN §5.7) | the intel engineer's `onScout(regionId)` handler in world.js | `state.owner[id]`, `id`; scope = region id |

Free Folk have no capital, so their `capitalBattleStart` and `decapitation` lines exist but never fire in
the current world contract.

Rules of thumb for the calls: pass `regionId` whenever the line may use `{region}` (lines that need a
region are skipped if it is missing, so a call without one is always safe). `speak` is cheap to call and
returns `null` when blocked; do not gate it yourself.

**Known consequence of the 15 s rule:** a keep usually falls 8-20 s after `keepAssaulted` spoke, so
`keepLost` / `decapitation` are often swallowed by the gap. If that reads as a loss of payoff, set
`VOICE.gapExempt = ['keepLost', 'decapitation']` in `game/config/leaders.js` (one line, tested); they then
speak inside the gap but still restart it. Default is empty, i.e. the design rule exactly.

## 10. Keeping the banner off the coach (and toasts, and HUDs)

1. **Gate:** `tutorialVisible: !ui.coach.el.hidden` means no leader line starts while a hint is on screen.
2. **Coach wins later clashes:** the `ui.coach.update` wrapper in section 3 hides a banner that is still up
   when a hint appears.
3. **Placement:** the banner is `pointer-events: none` throughout, top-centre, and measured under the HUD
   pieces given to `below` (section 3), so it never covers the gold counter, the battle pill or the phone
   button row. The battle scene must keep `ui.battleHud.el.hidden` accurate (it does).
4. **Toasts share the top-centre lane:** including `ui.toasts.el` in `below` puts the banner under any toast
   that is up when it speaks. A shipped fallback also exists: inside `#ui`, CSS
   `#ui:has(.toasts > .toast)` moves a banner without `below` to 148 px.
5. Everything hides itself after about 4.2 s; `ui.leaderBanner.hide()` clears it early (e.g. when the
   player clicks Accept Surrender, or leaves a scene).

## 11. First-victory tutorial note (crowns explained once)

The coach explains crowns once, on the first victory card, no new saved flag needed: `beginEndSequence`
increments `stats.battlesWon` before the card shows, so "first victory" is `state.stats.battlesWon === 1`.
In `showResults()` (victory branch), after `ui.results.update(...)`:

```js
if (state.stats.battlesWon === 1 && state.settings.hints) {
  const target = ui.results.el.querySelector('.crown-row');
  // the results card is z-index var(--z-modal) (40), above the coach (30): lift the bubble for this one hint
  ui.coach.el.style.zIndex = '41';
  ui.coach.update({
    visible: true, target: { el: target },
    text: 'Crowns pay +25% bounty each: win fast for Swift, lose no settlement for Unbroken.',
  });
}
// and where the card is dismissed (onResultsContinue / leave):
ui.coach.update({ visible: false }); ui.coach.el.style.zIndex = '';
```

It obeys the hints setting, and because a hint is visible the leader gate stays closed for that moment.
If you would rather not lift the coach above a modal, use a static line inside the card instead:
`h('p.results-crown-tip', {}, 'Crowns pay ...')` shown under the crown row when `battlesWon === 1`.

## 12. New realm, new dynasty, legacy saves: silent first contacts

Your starting neighbours (always the Free Folk ring) are not a "first contact". On entering the world scene:

```js
import { seedContacts } from '../meta/leaders.js';
if (!state.metFactions.length) seedContacts(state, world);   // new realm, new dynasty, or a save from before this feature
```

`resetRegions` already emptied `metFactions` for the new dynasty, so this one line covers all three cases.

## 13. Balance engineer: headless use (signatures are FINAL)

```js
import { trackerOf, trackBattle, evaluateBattle, awardCrowns, parFor } from '../game/meta/crowns.js';
const battle = createBattle(arena, player, enemy);
const tracker = trackerOf(battle);
while (!battle.result && battle.t < cap) { /* think / decide / issue */ step(battle, TICK_SEC); trackBattle(tracker, battle); }
const { summary, crowns, parSec } = evaluateBattle(tracker, battle, world, regionId, state);
// crowns.swift is what the calibration targets: about 50% for a competent bot
```

Par values live in `game/config/crowns.js` (`PAR.bands`, `PAR.capitalSec`); edit only that file. Bands:
`early` tiers 0-2 (60 s), `mid` tiers 3-5 (90 s), `deep` tiers 6+ (90 s, split out so it can be lifted
alone), any rival capital `capitalSec` (150 s). `PAR.perDynastySec` (0) adds seconds per dynasty level.

## 14. Checks

- `node --test game/tests/meta.crowns.test.js game/tests/meta.leaders.test.js game/tests/ui.features.test.js game/tests/meta.state.test.js`
- `npm start`, then `node tools/gallery/features-check.mjs` (real Chrome: award timing, Reduce Motion,
  banner click-through, live region, auto-hide, 390 px fit) and open `tools/gallery/features.html`
  (`?mode=crowns|leaders|pips|compose`, `&bare=1`, `&f=violet&t=keepAssaulted` to freeze a banner).
- After the save.js patch, `npm test` has no crown/leader-related failures.
