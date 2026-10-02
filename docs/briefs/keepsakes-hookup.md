# Keepsakes: the Chronicle and the Tapestry (hookup guide for integration)

DESIGN §5.9. Balance-neutral: nothing here reads or changes gold, battles, upgrades or income. Written against the code as it
stood on 2026-10-01 (`scenes/battle.js onResultsContinue`, `scenes/world.js onSurrender / updateRealm / onFoundDynasty`,
`main.js` prosperity calls, `app/stateContainer.js tryFoundDynasty`, `ui/realm.js createRealm`). Function names are the
anchors; if a line moved, search for the function.

Everything new is self-contained and tested. **Nothing in `state.js`, `save.js`, `realm.js`, `world.js`, `battle.js`, `main.js`,
`stateContainer.js` or `main.css` was edited**; the exact patches are below, split by file.

## 0. What ships

| file | what |
|---|---|
| `game/config/chronicle.js` | every number and every word: caps, highlight rules, 10 kinds of line with 2-3 variants each, the Tapestry's title/subtitle/stat words, the "Save the map" words, the export width |
| `game/meta/chronicleState.js` | **leaf** (imports only `config/chronicle.js`): `createChronicle`, `sanitizeChronicle`, `ensureChronicle`, `chronicleEntries`, `lifetimeHighlights` |
| `game/meta/chronicle.js` | re-exports the leaf, plus `recordChronicle`, the three event helpers, `chronicleText`, `chroniclePanelData` |
| `game/meta/keepsake.js` | `tapestryData(state, world, now)` (what `composeTapestry` draws) and `saveText(key, vars)` |
| `game/ui/chroniclePanel.js` | the Chronicle section (list + "This dynasty / All time" toggle) |
| `game/ui/saveMapButton.js` | the "Save the map" button (used in the Realm panel and in the Found a Dynasty confirmation) |
| `game/styles/components/chronicle.css` | styles for both, phone rules, Reduce Motion |
| `game/render/tapestry.js` (+ `tapestryParts.js`) | `composeTapestry`, `downloadCanvas`, `ensureTapestryFonts`, `tapestryFilename`, `formatTapestryDate` |
| `game/scenes/worldImage.js` | `renderWorldImage` (the whole continent from the real renderer) and `saveTapestry(state, world, now)` (render + frame + download in one call) |
| `tools/gallery/keepsakes.html` (+ `.js`, `keepsakes-check.mjs`) | the Chronicle in the real Realm panel, the Tapestry, the real confirmation; real-Chrome assertions |
| `game/tests/meta.chronicle.test.js`, `ui.chronicle.test.js`, `render.tapestry.test.js` | 68 tests |

**Import rule (important).** `meta/state.js` and `meta/save.js` must import from **`./chronicleState.js`**, never from
`./chronicle.js` (which imports `state.js` for `PLAYER_FACTION` and `leaders.js`: a cycle). A test (`meta.chronicle.test.js`,
"import graph") fails if they do. Everything else (scenes, UI, tools, tests) may import `meta/chronicle.js`, which re-exports the
leaf. (Same split as `intelState.js` / `worksEffects.js`.)

### APIs

```js
// meta/chronicle.js (re-exports meta/chronicleState.js)
createChronicle() -> Chronicle                       sanitizeChronicle(raw) -> Chronicle   // never throws, caps lists, drops junk
ensureChronicle(state) -> Chronicle                  // creates / repairs state.chronicle on demand: old saves and fixtures work untouched
chronicleEntries(state) -> Entry[]                   // this dynasty, oldest first (read-only)
lifetimeHighlights(state) -> Entry[]                 // across dynasties, oldest first (read-only)
recordChronicle(state, { kind, t, data?, hl? }) -> Entry | null     // the primitive (a custom line: data.text); null without kind or finite t
chronicleOnConquest(state, world, regionId, { crowns?, battleSec?, surrender?, decapitated?, t? }) -> Entry[]
chronicleOnProsperity(state, world, levelUps, { t }) -> Entry[]     // updateProsperity's result; only the first Prosperity III per dynasty
chronicleOnDynasty(state, world, { t }) -> Entry[]                  // closes the chapter, opens the next
chronicleText(entry, { world?, state? }) -> string   chronicleYear(entry) -> "Year 2"   chronicleAgo(entry, now) -> "3h ago"
chroniclePanelData(state, world, now) -> { dynasty: Row[], all: Row[], labels, empty }   // feeds ui/chroniclePanel.js, newest first

// meta/keepsake.js
tapestryData(state, world, now) -> { title, subtitle, dynasty, stats: { regions, battlesWon, crowns, timePlayed },
                                     factionColor, emblem, date, seed }        // spread into composeTapestry
saveText('button' | 'busy' | 'done' | 'failed' | 'hint', { file? }) -> string

// scenes/worldImage.js
renderWorldImage({ world, state, width, scale = 2, padding }) -> HTMLCanvasElement   // own renderer, detached canvas, no fog
saveTapestry(state, world, now) -> Promise<{ ok, file }>                              // never throws; reads, never writes

// render/tapestry.js
composeTapestry({ mapCanvas, title, subtitle?, stats?, factionColor?, date?, dynasty?, emblem?, seed? }) -> HTMLCanvasElement
downloadCanvas(canvas, filename) -> Promise<boolean>        // toBlob + anchor; data-URL fallback; false, never a throw
ensureTapestryFonts(timeoutMs = 1500) -> Promise<void>      tapestryFilename({ dynasty, date }) -> "hex-dominion-dynasty-2-2026-09-30.png"

// ui
createChroniclePanel({ onMode? }) -> { el, update(chroniclePanelData), destroy, setMode, mode }
createSaveMapButton({ onSave, variant? }) -> { el, update({ label, busyLabel, busy }), destroy, busy }
```

Rules the code enforces (all tested): a conquest that is only routine records nothing; every recorded line names the region and,
when there is a rival leader, the rival (stored in the entry, because leaders are re-seeded every dynasty); a helper with no
usable time records nothing (it never invents a clock); `state.chronicle` is plain JSON and capped; nothing mutates the world.

## 1. Integration: state and save (the exact patch, apply together)

`state.chronicle = { v, startedAt, entries, lifetime, seen, firsts, bestSec, streak, conquests }` (shape documented at the top
of `meta/chronicleState.js`). It is **lifetime** state: `foundDynasty` keeps it (it spreads `...state`), `resetRegions` must NOT
clear it.

**`game/meta/state.js`**

```js
import { createChronicle } from './chronicleState.js';
...
 * @property {import('./chronicleState.js').Chronicle} chronicle  the realm's story: this dynasty's chapter plus lifetime highlights (meta/chronicle.js)
...
// createGame(): in the state literal, next to `stats: defaultStats()`
    chronicle: createChronicle(),
```

**`game/meta/save.js`** (`withDefaults`; `sanitizeChronicle` accepts junk and never throws)

```js
import { sanitizeChronicle } from './chronicleState.js';
...
    chronicle: sanitizeChronicle(src.chronicle),
```

**Apply both together.** With the line in `createGame` but none in `withDefaults`, the `meta.save` round-trip tests go red (same as
`crowns` and `works` did), and in the game the story would be lost on reload. After both, add one round-trip test
(`state.chronicle` with one entry survives `deserialize(serialize(state))`). Legacy saves: `sanitizeChronicle(undefined)` is an
empty chronicle; the story simply begins with the first conquest after the update (no backfill is attempted, nothing is invented).

Until the patch lands, every helper calls `ensureChronicle(state)` itself, so the hooks below work (and survive a session) even
before `state.js` / `save.js` are touched; they are only lost on reload.

## 2. Integration: the four firing points

All four calls are cheap (a few array reads) and never throw on odd input. `t` is a ms timestamp; the helpers never read a clock.

**a) A conquest won in battle**: `scenes/battle.js`, `onResultsContinue`, inside `leave(() => { ... })`, right after `awardCrowns(...)`:

```js
import { chronicleOnConquest } from '../meta/chronicle.js';
...
      chronicleOnConquest(state, world, id, {
        crowns: crownResult ? crownResult.crowns : null,   // { victory, swift, unbroken } from evaluateBattle
        battleSec: battle.stats.durationSec,               // the winning battle's length (retries only count the winning battle)
        decapitated: !!result.decapitated,
      });
```

`t` may be omitted: it defaults to `state.conqueredAt[id]`, which `conquer()` has just stamped, so the line and the conquest share one
clock. (The speed record uses `battleSec`, not `state.stats.bestBattleSec`: the chronicle keeps its own lifetime record so a
retry or a save/load cannot make it say "new record" twice.)

**b) A surrender accepted**: `scenes/world.js`, `onSurrender`, right after `awardCrowns(...)`:

```js
import { chronicleOnConquest } from '../meta/chronicle.js';
...
    chronicleOnConquest(state, world, regionId, { surrender: true, decapitated: !!result.decapitated });
```

(`devSurrender` at the bottom of `world.js` is a dev shortcut; hook it the same way only if you want the dev tools to feed the story.)

**c) Prosperity III** (the first region of a dynasty to reach it). Four places call `updateProsperity` in `main.js` (boot,
returning from the background, the 5 s timer, the dev "advance" tool). One wrapper, used by all four:

```js
import { chronicleOnProsperity } from './meta/chronicle.js';
...
function runProsperity(state, world, now) {
  const ups = updateProsperity(state, world, now);
  if (ups.length) chronicleOnProsperity(state, world, ups, { t: now });
  return ups;
}
```

The entry is dated when the level was really reached (`conqueredAt` plus the Prosperity III tenure), never later than `now`, so a
level won while the game was closed reads "9h ago", not "just now". Level I and II, and every later Prosperity III, record nothing.

**d) A new dynasty**: `app/stateContainer.js`, `tryFoundDynasty`, right after `resetRegions`:

```js
import { chronicleOnDynasty } from '../meta/chronicle.js';
...
    const t = now();
    state = resetRegions(next, world, t);
    chronicleOnDynasty(state, world, { t });
    return { state, world };
```

This closes the old chapter (its lines stay in the lifetime highlights if they were highlights), keeps the speed record, restarts
"Year 1", and writes "Dynasty II is founded: N stars carried into a new age..." as the first line of the new chapter (also a
highlight). Call it AFTER the new dynasty exists (it reads `state.dynasty` and `state.seed`).

## 3. Integration: the Realm panel (Chronicle + Save the map)

`ui/realm.js` is already a modal dialog (`watchDialog`): the Chronicle's two toggle buttons and its list (focusable, so a keyboard
can scroll it) take part in the focus trap with no extra work; the gallery's keyboard check proves it.

**`game/ui/realm.js`**

```js
import { createChroniclePanel } from './chroniclePanel.js';
import { createSaveMapButton } from './saveMapButton.js';

export function createRealm({ onFoundDynasty, onSaveMap, onClose } = {}) {
  ...
  const chronicle = createChroniclePanel();
  const savers = new Set();                 // every live "Save the map" button (the panel's, plus the confirmation's while it is open)
  let saveData = null;
  const saveMap = createSaveMapButton({ onSave: () => onSaveMap?.() });
  savers.add(saveMap);

  h('div.realm-body.scroll-y', {},
    statsGrid,
    chronicle.el,                           // between the stats and the dynasty box
    saveMap.el,
    h('section.dynasty-panel', {}, ...),
  )

  // update(data): two new fields
  if (data.chronicle) chronicle.update(data.chronicle);
  if (data.save) { saveData = data.save; for (const b of savers) b.update(data.save); }
```

**The Found a Dynasty confirmation** (`confirmFound`) is the last chance to keep a picture of the old continent: the same button, in the
body, above the two choices (the safe choice stays first):

```js
  function confirmFound() {
    const confirmSave = createSaveMapButton({ onSave: () => onSaveMap?.() });
    savers.add(confirmSave);
    if (saveData) confirmSave.update(saveData);
    const close = () => { savers.delete(confirmSave); modal.destroy(); };
    const modal = createModal({
      title: 'Found a new dynasty?',
      body: h('div.keepsake-modal-body', {},
        h('p', { style: { margin: 0 } }, 'Gold, upgrades and the map reset. A new continent awaits, with tougher enemies. Dynasty stars and your lifetime records carry over forever.'),
        h('div.keepsake-save-box', {}, h('p.keepsake-save-note', {}, saveData ? saveData.hint : ''), confirmSave.el)),
      actions: [
        { label: 'Not yet', variant: 'secondary', onClick: close },
        { label: 'Found it', variant: 'primary', onClick: () => { close(); onFoundDynasty?.(); } },
      ],
    }, { onDismiss: close });
    document.body.appendChild(modal.el);
  }
```

Saving does not close the confirmation, and the picture is of the realm as it is now (the new continent does not exist until
"Found it"). `tools/gallery/keepsakes.html?only=-&modal=1` is exactly this dialog.

**`game/scenes/world.js`**

```js
import { chroniclePanelData } from '../meta/chronicle.js';
import { saveText } from '../meta/keepsake.js';
import { saveTapestry } from './worldImage.js';

let saving = false;
const saveWords = () => ({ label: saveText('button'), busyLabel: saveText('busy'), busy: saving, hint: saveText('hint') });

// updateRealm(): two new fields (the 1 s refresh is fine: both components skip every unchanged write)
    ui.realm.update({
      stats: ..., dynasty: ..., canFoundDynasty: ..., crowns: crownTotals(state, world),
      chronicle: chroniclePanelData(state, world, Date.now()),
      save: saveWords(),
    });

async function onSaveMap() {
  if (saving) return;
  saving = true;
  updateRealm();
  const { state, world } = container.get();
  const res = await saveTapestry(state, world, Date.now());
  saving = false;
  updateRealm();
  ui.toasts.update(res.ok
    ? { type: 'success', icon: 'map', message: saveText('done', { file: res.file }) }
    : { type: 'warning', icon: 'map', message: saveText('failed') });
}
// scene interface: add onSaveMap, and in main.js: createRealm({ onFoundDynasty: ..., onSaveMap: () => worldScene.onSaveMap(), onClose })
```

`saveTapestry` reads the game and changes nothing, so it can run while the confirmation is open. It takes about half a second on a
desktop (about 400 ms for the map, 75 ms to frame it, 100 ms to encode at the 700 px width), shows the busy label first, and never blocks the frame loop for longer than one
render. Its own renderer lives on a detached canvas and is garbage-collected afterwards.

## 4. Integration: style sheet

`game/styles/main.css`, with the other component imports:

```css
@import url('./components/chronicle.css');
```

## 5. The saved picture

- **File name:** `hex-dominion-dynasty-<n>-<yyyy-mm-dd>.png` (the dynasty being saved, the local date).
- **Contents:** woven border in the realm colour with a chain of hexagons, a title ribbon "The Realm of <start region>", "Dynasty II",
  the whole continent (real renderer: territory, borders, settlements, every region name), and four stats (regions held of total,
  battles won, crowns, time played), the date, a hanging rod and a fringe. It scales to any width.
  The stat numbers are Nunito 800 (lining figures, units lower-case: "25 of 26", "2d 14h"); the labels, title, ribbon, subtitle and date
  are Cinzel.
- **Size:** both under 3 MB so it is shareable. Desktop: 700 px map at 2x, 1711 x 1436 px, 2.9 MB; phone (`max-width: 640px`): 600 px at 2x,
  1466 x 1230 px, 2.3 MB. Both numbers are in `config/chronicle.js` (`tapestryWidth`, with the measurements); PNG compresses the paper
  grain and weave poorly, so size grows fast with width (900 gives 4.6 MB, 1100 gives 6.2 MB).
- **Fonts:** Cinzel and Nunito come from the page's Google Fonts link (`ensureTapestryFonts` waits up to 1.5 s). Offline it falls back
  to Georgia / the system font and still produces a valid picture.
- **Phones:** the browser decides what a download does (Android saves the file; iOS opens it in a tab, from where "Add to Photos" works).
  There is no share-sheet integration; that would be a one-line `navigator.share({ files })` addition if wanted.

## 6. What the player sees

- **Chronicle** (Realm panel, below the stats): newest first, each line an icon, a story line, "Year 2 · 3h ago". Highlights
  have a gold edge. "This dynasty" (the chapter, at most 40 lines) or "All time" (lifetime highlights across dynasties, grouped under
  "Dynasty II" dividers). Empty: "Your story begins with your first conquest."
- **What is recorded:** the first conquest; a rival capital toppled; a surrender accepted (names the rival: "Khan Gashrok's Amber
  Horde yields Dunspire."); the first triple crown, then streak milestones 3/5/8/12; a new fastest battle (beating the record by at
  least half a second); a rival faction's last region; half the continent; the whole continent; the first Prosperity III; a new
  dynasty. A routine conquest is not a line.
- **"Year"** is real days since the dynasty began (Year 1 = the first 24 hours), restarting each dynasty: an idle game is lived in days.
- **Highlight rules** (config `kinds`): `first` (kept in the lifetime list the first time it ever happens), `always`, or this dynasty
  only. Over the cap the oldest minor line goes first (triple crowns, surrenders, records), then the oldest plain one.
- Lines are chosen deterministically from the entry itself (a line never changes between two looks); all copy is in `config/chronicle.js`.

## 7. Verification

```bash
node --test game/tests/meta.chronicle.test.js game/tests/ui.chronicle.test.js game/tests/render.tapestry.test.js   # 68 tests
npm start                                                                    # then, in another shell:
CHROME_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe" node tools/gallery/keepsakes-check.mjs         # real Chrome, real input
# gallery: http://localhost:8080/tools/gallery/keepsakes.html  (?view=tapestry, ?only=few,all, ?modal=1&only=-, ?dialog=1)
```

`keepsakes-check.mjs` drives real mouse and keyboard events: the toggle, a tap that survives a refresh between pointerdown and
pointerup, the wheel and arrow keys scrolling the list, Tab staying inside the Realm dialog, the phone fit (no sideways scroll,
44 px toggle, rows inside the panel), the Tapestry drawn (opaque, parchment, border in the realm colour, map not blank), and "Save
the map" from the Realm panel and from the Found a Dynasty confirmation (desktop and phone) producing a real PNG with the
right name and size, without closing the confirmation.

After wiring, by hand: win a battle, open Realm: "The first banner of your realm rises over <region>."; accept a surrender: a line
naming the rival; "Save the map": one PNG named as above; Found a Dynasty (cheat the conquests with the dev tools): the old chapter
is gone from "This dynasty", the highlights are under "All time", the new chapter starts with "Dynasty II is founded".

## 8. Notes and open points

- **Phone Realm layout (decided by the lead): a two-column stats grid below 480 px**, so the Chronicle is reached sooner (it used to
  start about 1100 px down, below eleven single-column stat rows; now it starts in the first screen on a 390 x 844 phone). One edit
  in `game/styles/components/overlays.css`, replacing the single-column rule at the bottom of the realm section:

  ```css
  @media (max-width: 480px) {
    .realm-stats-grid { grid-template-columns: 1fr 1fr; gap: var(--sp-2); }
    .realm-stat { gap: 6px; padding: var(--sp-2) 6px; }
    .realm-stat-label { min-width: 0; line-height: 1.2; }
  }
  ```

  Checked in `tools/gallery/keepsakes.html` (which already applies exactly this CSS; `?stats1=1` shows the old single column).
  At 390 px most labels stay on one line and "Surrenders accepted" / "Dynasty crowns" wrap to two; at 360 px about half wrap (nothing
  overflows or clips).
- The PNG stays under 3 MB on both (section 5).
- `tools/gallery/keepsakes.js` releases the four Realm panels' dialog registrations (`closeDialog`) because four live modal dialogs
  would make each other inert; `?dialog=1` keeps one live, as in the game.
- `meta.chronicle.test.js` reads `state.js` and `save.js` as text to enforce the import rule; it passes today because neither
  imports the chronicle. After the patch in section 1 it still passes (they import `chronicleState.js`).

## 9. Screenshots (`screenshots/keepsakes/`)

| file | shows |
|---|---|
| `chronicle-desktop.png` | the real Realm panel, four states: empty, a few lines, a full 40-line chapter (scrolls), all time over three dynasties |
| `chronicle-phone.png`, `-few`, `-full`, `-all` | 390 x 844 at 2x: the same states on a phone (the Realm body is scrolled to the Chronicle; `chronicle-phone.png` is the unscrolled top) |
| `chronicle-focus.png`, `chronicle-focus-list.png` | keyboard focus on the toggle and on the list, inside the live dialog |
| `found-dynasty-desktop.png`, `-phone.png` | the Found a Dynasty confirmation with "Save the map" |
| `tapestry-desktop.png` | the finished keepsake (realm blue); `tapestry-crimson.png` the same in another realm colour; `tapestry-phone.png` at phone width |
| `tapestry-detail-top.png`, `-bottom.png` | native-resolution crops: weave, seals, ribbon, labels; stats row, date, border, fringe |

Reproduce: `node tools/pageshot.mjs "tools/gallery/keepsakes.html?bare=1" out.png --w=1440 --h=760 --wait=2500` (dev server running).
