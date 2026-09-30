# Hex Dominion 2 — redesign status (lead designer's log)

Branch `redesign` (v1 preserved at tag `v1-final` and playable at `classic.html`).
Nothing has been committed or pushed yet; `main` (which auto-deploys to GitHub Pages) is
untouched.

## CURRENT STATE (2026-09-30 ~10:15): release candidate, feature-complete
- All features are in the game: the core redesign, plus music, battle crowns, rival leader
  voices, scout/sabotage, the living map + prosperity, bold green/red drag arrow, the stuck
  hint, and the council "Best value" tag. World-gen fixes (no stray islets, thin beaches, lush
  starts) and the final balance calibration (waits-first pacing, dynasties ~1.3-1.4× longer) are
  in.
- Verified: `npm test` 646/646; `node tools/check.mjs` and `node tools/check.mjs --base=temp` pass
  (Pages subpath, SW scope, offline reload, manifest, classic.html); the shots tour has 0 page
  errors; four real-input playtests from the tutorial into dynasty 2. Final gallery:
  `screenshots/game/rc-*.png`.
- All engineers are finished. **Open decisions for the user:** (1) a local checkpoint commit on
  `redesign` (asked repeatedly, no answer yet); (2) publishing = merging to `main`, which deploys
  to ka1e27.github.io/temp. NEVER do either without explicit approval. `.github/workflows/pages.yml`
  has a local edit adding `check.mjs --base=temp`. `.claude/agents/sonnet55-engineer.md` is
  untracked; keep it out of game commits unless the user wants it.
- Known small leftovers: the Muster effect text wraps awkwardly in the council; capital battles
  are ~2 min human (a multi-phase keep is in BACKLOG); Unbroken 85 % (easy by design);
  BACKLOG tier 3 (throne powers, edicts, automation, keepsakes) remains unscheduled.
- The session log below is chronological; the newest entries are at the bottom of "Session 2".

## Documents (read in this order)
1. `docs/DESIGN.md` — the game (what/why). 2. `docs/ARCHITECTURE.md` — contracts.
3. `docs/PLAYFEEL.md` — choreography, tutorial, perf. 4. `docs/INTEGRATION-NOTES.md` —
what each module actually exports + gotchas.

## Done (all tests green: 317/317 on 2026-09-29)
| module | owner files | state |
|---|---|---|
| core + world gen | `game/core/*`, `game/world/*`, `tools/worldcli.mjs` | round 2 done: warped coastlines, lakes, organic biomes, ridged mountain ranges, rivers, balanced perks. ~100 ms/world. |
| battle sim + AI | `game/battle/*`, `tools/balance.mjs` | done; deterministic, 0.002 ms/step. Difficulty label vs. win rate mismatch → balance pass (below). |
| art | `game/render/{palette,tiles*,sprites*,clouds}.js`, `tools/gallery/art*` | 3 rounds; seamless splatted water, dramatic mountains, forests, settlements, banners, clouds. |
| fx + audio | `game/render/fx*.js`, `game/audio/*`, `tools/gallery/fx*` | 2 rounds; punchy capture/fireball, telegraph, flood kinds; 18 synth cues. |
| camera + input | `game/render/camera.js`, `game/input/*`, `tools/gallery/input*` | done; real-event checks pass. |
| meta + UI kit | `game/meta/*`, `game/ui/*`, `game/styles/*`, `tools/gallery/ui*` | 2 rounds; labelled region card, power buttons, phone layouts. |
| hosting | `index.html` (new shell), `sw.js` (network-first, v2 cache), `classic.html`, `.github/workflows/pages.yml` (npm test + `tools/check.mjs`) | done; workflow needs `tools/check.mjs` to exist. |

## In progress when this was written
- **Integration** (`game/main.js`, `game/app/*`, `game/scenes/*`,
  `game/render/{renderer,terrainCache,territory,sites,units,labels,cloudLayer,overlays}.js`,
  `tools/shots.mjs`, `tools/check.mjs`): renderer + app glue partly written; main.js and
  scenes not yet. Brief: Phase A (living world, title, meta hookup, saves, dev hooks, shots)
  then Phase B (battle scene, victory choreography, tutorial, check.mjs).
- **Balance** (`tools/campaign.mjs`, `tools/balance.mjs`, `game/battle/{ai,bot,difficulty}.js`,
  `game/config/{battle,meta}.js`, difficulty heuristic in `game/meta/progression.js`, upgrade
  numbers → `UPGRADE_TUNING` in config): virtual-player campaign simulator; pacing targets
  first conquest ≤ 2 min, 5 regions 12–20 min, 10 regions 35–60 min, 20 regions 2–3.5 h, all
  4–7 h, longest wait ≤ 40 min, win rate 70–90 %; labels Easy ≥ 85 % / Fair 60–85 % /
  Hard 35–60 % / Deadly < 35 %; smarter enemy AI.

## Resuming in a new session (first steps)
1. Verify the engineer model: spawn a one-line check agent with
   `subagent_type: sonnet55-engineer` and confirm it reports `claude-sonnet-5-5` (see
   "Team model" below). Check `ListAgents` for a still-busy older lead session first.
2. `npm test`, `git status`, and `node -e "import('./game/main.js')"`-style import checks —
   the Sonnet 5 integration/balance engineers were killed mid-task by the restart, so a file
   may be half-written.
3. Re-brief fresh Sonnet 5.5 engineers from `docs/briefs/integration.md` and
   `docs/briefs/balance.md` (both say to review the partial work first). They can run in
   parallel: integration owns main/app/scenes/renderer glue; balance owns config, ai/bot/
   difficulty, campaign/balance tools.
4. Lead review checklist once the game runs: real-world terrain at overview (hill density,
   biome colours under territory tint), chunk seams, water, cloud look, labels, frontier
   pulse, region card numbers vs. real difficulty, battle readability at 1440×900 and
   390×844, phone battle HUD (power buttons currently wrap to two rows — prefer one row),
   victory choreography timing, tutorial flow, frame time.

## Next (lead's plan)
1. Finish integration; play it myself; critique screenshots/feel; polish rounds.
2. Land balance targets; re-check labels in the real UI.
3. New icons + `og.png` rendered from the real game; README for v2.
4. Final QA: `npm test`, `node tools/check.mjs` (desktop + phone), GitHub Pages subpath
   check, then ask the user before merging to `main` (which deploys).

## Handover notes (from the original lead session, after stopping its Sonnet 5 engineers)
- **Stopped mid-task at ~12:10 on 2026-09-29 (both via TaskStop):**
  - Integration engineer: last action was replacing `drawArenaTerritory` with a corrected
    version built on a shared `displayOwnerOfWorldTile` helper (battle-arena territory
    drawing) — that edit may or may not have landed. Files it changed after this STATUS was
    first written: `game/main.js`, `game/scenes/world.js`, `game/scenes/battle.js`,
    `index.html` (small edit). All game JS parses (`node --check` clean) but nothing has been
    run in a browser since.
  - Balance engineer: last action was about to re-run the 5-seed campaign after a tuning
    change, so the latest edits to `game/config/battle.js`, `game/config/meta.js` and
    `tools/campaign.mjs` are UNVALIDATED — re-run `node tools/campaign.mjs --seeds=1,2,3,4,5`
    and `npm test` before trusting them.
- **Not yet in INTEGRATION-NOTES (landed in round 2 of UI / FX):**
  - UI: `battleHud.update()` `powers[i]` also takes `name`, `cooldownSec` (remaining seconds)
    and `armed` (target-picking pulse); `hud.update()` takes `pulse` (big gold flash; also
    auto on ≥ 5 % jumps); new `lock` icon; `ui/format.js` `shortNumber` delegates to
    `core/format.js` `formatNum`; UI gallery has `?bare=1&mode=<kit|composition|battle|title>`
    for chrome-free shots.
  - FX: new kinds `telegraph` (auto-spawned with every `fireball` unless
    `opts.telegraph: false`), `fireBloom`, `flood`; `fireball` takes `radius`,
    `telegraphColor`; `burst` takes `flashSize`, `ringGrowth`, `sparkleCount`; `sparks` takes
    `dustCount`, `dustColor`; `floatText` `size` is a true multiplier. Deterministic FX QA:
    stub `requestAnimationFrame`, spawn into a fresh fx instance, `update(0.05)` N times,
    draw once, screenshot.
  - World round 2 added `game/world/{connectivity,rivers,lakes,perks}.js`. Inland lakes are
    `terrain: 'shallows'`, `land: false`, inside the landmass. Only rival sectors are
    guaranteed contiguous (Free Folk may not be).
  - Art: hills colour deliberately overridden to `#7e9450` (DESIGN's swatch was lighter than
    grass); `drawHexTint` blends with 'overlay'.
- **Tooling:** `tools/pageshot.mjs` screenshots any served page (defaults CHROME_PATH to the
  local Chrome; in Git Bash never start the path with "/"). Node 24's test summary lines start
  with "ℹ" (`ℹ tests 317`), not "#". The Browser-pane preview config `hex-dominion` lives in
  `C:\Users\kyleg\Projects\.claude\launch.json` (serves `temp/` on :8080); pane screenshots
  came back cropped at DPR 1.75, so prefer pageshot for full-resolution captures.
- **Git state:** local tag `v1-final` and branch `redesign` only; nothing committed or pushed.
  An early `git add -A` staged the first docs/config/package.json/CLAUDE.md/legacy renames;
  everything later is unstaged or untracked. `.claude/agents/sonnet55-engineer.md` inside the
  repo is untracked — keep it out of game commits unless the user wants it.
- **Lead's open critiques to verify in the running game:** listed in step 4 of "Resuming in a
  new session" above; also confirm the new world's silhouettes/biomes read well at overview
  under territory tint, and that battle lengths match DESIGN §4.7 after the balance pass.

## Session 2 (new lead session, 2026-09-29 ~12:15)
- Model verified: `subagent_type: sonnet55-engineer` → `claude-sonnet-5-5`. A plain
  `general-purpose` agent with no `model` param → `claude-opus-5-5` (the env-var route did
  NOT take effect). **Always spawn engineers as `sonnet55-engineer`.**
- The session-1 Sonnet 5 engineers had NOT died with the restart; they kept writing until the
  session-1 lead stopped them on request (~12:10). Before briefing, check for live peers
  (`ListAgents`) and recent writes (`find … -newermt`).
- Relaunched on Sonnet 5.5 at ~12:15: **integration** (Phase A only, then report screenshots
  for lead review before Phase B) and **balance** (first fix the 6 meta test failures from the
  unvalidated tuning, then the full brief). Test state at relaunch: 311/317.
- Both hit the account session limit (~12:30) and were resumed with context at 21:28.
- Integration Phase A delivered (327/327, 0 console errors, screenshots
  `screenshots/game/phaseA-*.png`, GPU frame time ≈ 1–2 ms CPU). Lead review → Phase B sent
  with a B.0 world-scene round: frontier as a gold inner band (not a fill), Civ-style azure
  border bands for owned land, framing home + frontier (phone too), label collisions, fog
  hides borders, source-level fixes (base.css, hud, coach, save.js, drawBanner) +
  INTEGRATION-NOTES update; plus enemy intent lines and threat chips (BACKLOG #1).
- Queued for a later world-gen brief (engineer gone): drop or decorate 1–2-hex beach islets
  near the playable coast; the start region should be mostly grass/forest, not beach (seed 7's
  Fenwall reads as blank sand on the first screen).
- `docs/BACKLOG.md` holds the lead's ranked improvement ideas.
- **Music** (BACKLOG #4) started at the user's request: a third Sonnet 5.5 engineer builds
  `game/audio/music*.js`, `game/config/music.js`, a gallery page, `tools/musicrender.mjs`
  (WAV renders to `screenshots/audio/`) and `docs/MUSIC.md` (the hookup spec for
  integration). New files only, plus an additive `getContext`/bus change in `sfx.js`. It does
  not hook into the game itself.
- **Crowns + leader voices** (BACKLOG #2, #3) promoted into DESIGN §4.8 and §3.6 at the
  user's request. A fourth Sonnet 5.5 engineer (features) builds pure `game/meta/{crowns,leaders}.js`,
  `game/config/{crowns,leaders}.js`, `ui/crownRow.js`, `ui/leaderBanner.js`, `render/crownPips.js`,
  a gallery, tests and `docs/briefs/crowns-leaders-hookup.md`; additive `meta/state.js` fields.
  Integration wires it in after Phase B. Balance was told to credit crowns in campaign.mjs and
  calibrate par (Swift ≈ 50 %) once the features engineer finishes; lead must send that go-ahead.
- **Living map + prosperity** (BACKLOG #5) promoted into DESIGN §7.7 and §5.6 (prosperity
  I/II/III at 30 min/2 h/8 h tenure, +5 % region income per level). A fifth Sonnet 5.5 engineer
  (living map) builds `game/meta/prosperity.js`, `game/world/caravanRoutes.js`,
  `game/render/{ambient,ambientSprites,prosperityDecor}.js`, `game/config/{prosperity,ambient}.js`,
  a gallery, tests and `docs/briefs/living-map-hookup.md`. New files only. Follow-ups the lead
  must route: integration (state/save fields, bake + draw hookup), balance (economy multiplier,
  tenure in campaign.mjs).
- **Scout + Sabotage** (BACKLOG #6) promoted into DESIGN §5.7 (Scout ≈ 30 s income, free on
  the tutorial region, reveals composition/personality/weak point; Sabotage only after Scout,
  −15 % starting garrisons ×2 max, cost tied to the Steel upgrade curve). Leader triggers
  `scouted`/`sabotaged` added to the features engineer. A sixth Sonnet 5.5 engineer (intel)
  builds `game/meta/intel.js`, `game/config/intel.js`, `ui/intelPanel.js`, `render/intelMarks.js`,
  a gallery, tests and `docs/briefs/intel-hookup.md`. New files only. Balance follow-up: apply
  `sabotageTroopMult` in `enemyBattleStats`, campaign policy, prove sabotage never dominates.
- **Features (crowns + leaders) DONE** (~22:45): modules, 232 original lines, gallery
  `screenshots/features/*`, hookup `docs/briefs/crowns-leaders-hookup.md` (now starts with a
  "Lead decisions" section: gapExempt keepLost/decapitation (applied), seedContacts, save.js
  patch, static first-victory caption, compact phone frontier card, pip size, HUD fixes).
  Suite 522/527: 4 meta.save round trips wait for integration's save.js patch; 1 flaky
  generateWorld timing under parallel load.
- **Integration Phase B DONE** (~23:00): battle scene, victory/defeat/retreat, tutorial 3-5,
  resume-on-load, intent lines + threat chips (`game/scenes/battleThreat.js`), arena polish,
  `tools/check.mjs` 88/88 at 1440x900 mouse + 390x844 touch. Screens `screenshots/game/phaseB-*`.
  Lead found: fresh realm offers Accept Surrender on the whole first ring (ratio 3.5 ≥ 3.0), so
  the tutorial battle never happens. New DESIGN §5.3 rule: no surrender before the first win.
  Sent to balance as URGENT with: tutorial battle ~60 s (was 2:24), rival AI opening grace.
  Integration now on **hookup round 1**: owns all of save.js (crowns, metFactions, intel,
  prosperity pass-through), wires crowns + leaders, phone power short labels, surrender copy.
- Queued (after living-map + intel engineers finish, since galleries use seed 7): world-gen
  brief (drop 1-2 hex islets; start region mostly non-beach).
- **Music DONE** (~23:10): `createMusic(sfx,{seed,volume})`, D dorian / G mixolydian / A aeolian
  (white-key only, to agree with the sfx), Karplus-Strong harp, pad, recorder, drums, strings,
  seeded; WAVs in `screenshots/audio/` (world RMS ≈ −36 dBFS, worst overlap peak −4.6 dBFS).
  **The user has the WAVs to listen to**; loudness and timbre are open until they react
  (knobs: `MUSIC.bus.outputScale`, `MUSIC.groups[*].gain`). Music hookup queued into
  integration round 1 (state.js settings music/musicVolume, settings UI, stinger timing).
- **Intel (scout + sabotage) DONE** (~23:20): `game/meta/{intel,intelState}.js`, panel, map marks,
  54 tests, gallery `screenshots/intel/*`, hookup `docs/briefs/intel-hookup.md` with a "Lead
  decisions" section (card merges for phone height, prices, weak point prefers towns within
  20 %, rename bar labels to power/strength). Lead lowered sabotage prices to steelMult [1,2] /
  incomeSeconds [60,150] (the first pricing made the finisher policy a trap). Integration told
  about a region-card rebuild bug that can swallow Attack clicks. Balance told that seeds 1 and
  4 stall (>24 h, 11 h to 20 regions) and to report per-seed spread.
- **Integration hookup round 1 DONE** (~23:45): 583/583 tests, check.mjs 118/118 (desktop +
  phone). save.js carries crowns/metFactions/intel/prosperity; crowns + leaders + music wired;
  region card rebuilt in place (the swallowed-click bug is fixed and tested); phone audio unlock
  bug fixed (touch counts only on touchend); a fresh realm offers Attack (balance guard landed).
  Screens `screenshots/game/hook1-*`. **Round 2 (intel hookup) started.** Balance told that every
  frontier reads Deadly right after the first win.
- **Living map DONE, then an art polish round** (~00:05): systems are good (caravans, baked smoke,
  boats, birds, prosperity 66 tests, ~0.4 ms/frame). Lead review: level III paving reads as grey
  pipes, level I invisible, base farm fields (6-triangle quilt in `drawFarmFields`) swamp the
  biomes. Polish sent: painterly warm paving, a ground/structures bake split (structures after the
  tint), level I = haystacks/orchards/hedges, restyled organic fields (living map owns
  `drawFarmFields` meanwhile), wispy smoke, rival smoke, return carts. Integration round 3 =
  living-map hookup after the polish.
- **Integration hookup round 2 (intel) DONE** (~00:30): check.mjs 152/152; scouted phone card
  49.7 %; the same click trap fixed inside intelPanel; bar labels read power/strength; zero stats
  muted; phone Realm scrolls. Screens `screenshots/game/hook2-*`. **Round 2.5 started:** the
  GitHub Pages /temp/ subpath + SW/offline check, and a first-15-minutes real-input playtest
  (desktop + phone).
- **Living-map polish DONE** (~00:50): organic farm plots replaced the triangle quilt (a
  `drawFarmFields` restyle with a 6th arg), warm paving, a ground/structures bake split, level I =
  haystacks/orchards/hedges/scarecrow, wispy smoke, rival smoke, return carts; 589/589; screens
  `screenshots/living/polish-*`. Final micro-touches sent (paving value, green orchards, windmill
  sails). Integration round 3 (living-map hookup) queued after round 2.5.
  Final touches DONE (~01:05): paving #c8b68f, green orchards, thicker outlined sails;
  `screenshots/living/final-*`. The living-map engineer is finished; tiles.js is back with integration.
- **Integration round 2.5 DONE** (~01:20): `check.mjs --base=temp` 206/206 (the Pages subpath,
  SW scope, 136 files cached, genuine offline reload, manifest, classic.html). Fixed: the SW
  cached nothing on the first visit; battle HUD rebuilt buttons every 66 ms so real presses on
  powers/Pause were lost (third instance of the trap; `pressAudit` in check.mjs now); hint 0
  timer ran on the title; welcome-back gold shown before Collect; clipped labels; tutorial send
  text. `tools/playtest.mjs` added. pages.yml gains `check.mjs --base=temp` (local, not pushed).
  Balance got the playtest findings (camp starts with 4 troops vs a hamlet of 6; Deadly Free
  Folk = stalemate; first-battle timing; welcome-back scale). Lead relaxed a music test
  precondition that depended on battle length. **Round 3 (living-map hookup) started.**
- Both engineers hit the account usage limit again (~01:40); resumed with context at 03:41.
  Suite at resume 587/591: 3 balance label tests + 1 integration realmFraming test, all mid-work.
  Balance was told to reach a green checkpoint and report partial results; its crowns /
  prosperity / sabotage follow-up comes as a fresh round after review.
- **Integration round 3 (living map) DONE** (~04:30): bake split, levels in the chunk signature,
  ambient layer (~0.2 ms), prosperity ticking in main.js, level-up celebrations, region-card
  prosperity line, welcome-back line; plus the four playtest fixes. check `--base=temp` 230/230;
  tests 592/593 (the 1 is balance's). Screens `screenshots/game/hook3-*`. **All six features
  are now in the game.** Round 4 started: icons/og.png from the live renderer, README v2,
  ARCHITECTURE §2 layout, the white region outline.
- **Round 4 DONE** (~05:10): og.png rendered from the live game (level-III realm + wordmark),
  icons/maskable/apple/favicon via `tools/launch-assets.mjs`, README v2 (images in `docs/img/`),
  ARCHITECTURE §2 layout rewritten and verified against the tree; the white outline was the hover
  state (shots now park the pointer). Tests 593/593; check root + --base=temp pass. Small
  icon-legibility fix sent (fill more; simplified favicon).
- **Balance checkpoint** (~05:30): 593/593; 20-region pacing in band on 12 seeds, no stalls, labels
  calibrated (the bot at 3 s cadence), tutorial median 61 s, grace in ai.js, the depth ladder
  (`enemyDepth`). Missed: whole continent 2h50 (target 4-7 h), longest wait >40 min on 4/12,
  capitals ~1m45. Lead decisions (DESIGN updated): depth-scaled enemy caps + Free Folk caps
  (engine-side), no power cap, no-army check relaxed, base offline cap 4 h, scout 20 s,
  **bounty = ~90 s of TOTAL realm income** (5 s region bounty had gutted Plunder/Harbour/crowns).
  Follow-up round sent: bounty, prosperity/sabotage/crowns hooks, par, Unbroken rate, residuals;
  final sweeps HELD until world-gen lands.
- **World-gen** started (living-map engineer re-tasked): remove <4-tile islets, beach as a thin
  fringe (≤35 %/region), start region ≥60 % non-beach; before/after seeds 1-8.
- Icon legibility fix DONE (~05:50): non-maskable icons fill ~85%, a `mini` mark for ≤32 px, SW cache
  hexdominion-v2-4; check --base=temp passes. Integration idle until balance/world-gen land (then:
  UI copy for the new bounty/crowns, re-verify the War Camp start in a fresh realm, final QA).
- **Balance structural work DONE, HOLDING** (~06:30): bounty = 90 s × realm income, offline cap 4 h,
  depth-scaled enemy caps (`capMult` via arena → sim `effectiveCap`), capital and Free Folk cap mults,
  prosperity in incomePerSec, sabotage in enemyBattleStats, clearRegionIntel in conquer, weak
  point prefers towns, scout 20 s, campaign crowns + intel policies. 603/604 (1 world-gen test
  mid-work). Provisional (old worlds): whole continent 2h48, longest wait median 51 m; Swift 59 %,
  Unbroken 48 % (swarm 13 %); crown ≈ 0.9 upgrade early / 0.35 late; heavy intel not clearly
  slower. **When world-gen lands, send balance:** bountySeconds → ~120 (crown ≈ 1 upgrade early,
  ≥ 0.5 late), heavy intel ≥ +10 % slower to all regions, Unbroken vs swarm ≥ 35 % (garrison floor),
  then the final sweeps.
- **World-gen DONE** (~07:00): islets <4 tiles removed (37→0), beach ≤35 %/region (43→0 over),
  world beach 5→2 %, start regions ≥80 % non-beach and ≥51 % green (mean 78 %), rival sectors within 2
  on all seeds, 26-30 regions, ~50 ms. New `game/world/{beaches,start}.js`, `tools/{worldshots,worldstats}.mjs`,
  `world.coast.test.js`. 625/625. Screens `screenshots/worldgen/`. Marsh stays non-green (lead).
  **Balance released for the final sweeps** with bountySeconds ~120, heavy-intel ≥ +10 % slower,
  Unbroken floor, and all pacing targets.
- Integration small items DONE (~07:20): crown % via `game/app/crownCopy.js` + a guard test + check
  asserts; the War Camp start is ~30.5 on 4 seeds ("4 vs 6" was a border keep/village); the tutorial
  arrow now targets a comfortable capture (`tutorialArrowTarget`). Lead: step-3 hint teaches the
  drag preview ("The arrow tells you if you'll take it"); perk copy from config. Then stand by
  for the final QA round after balance.
- Integration follow-ups DONE (~07:55): step-3 hint teaches the preview; the drag arrow is now
  green (capture) / red (not enough) with real-input checks; perk + dynasty-star copy derived
  from source (guard tests); a check flake fixed. 630/630, both checks pass. PLAYFEEL/DESIGN
  wording updated by the lead. Integration standing by for the final QA round.
- **Balance final calibration** (~08:50, new worlds, 630/630): a 4-7 h continent conflicts with waits
  ≤ 40 min (walls, not steps). Shipped waits-first: whole continent ~1h25, 11/12 seeds ≤ 40 min
  (worst 55), win 80 %, tutorial median 61 s, Swift 52 %, Unbroken 53 % (swarm 32 %), bountySeconds 51
  (crown ≈ 0.6-0.85 upgrade), heavy intel +19-24 %. Lead decisions (DESIGN §4.8, §5.4): **accept
  waits-first; length via dynasties** (D1 1.25-2.5 h, D2 ~1.5-2× D1, D3 ~2-2.5× D1, waits ≤ 40 min
  each); Unbroken counts only sites held at battle start; intel prices 3×/6×, 180/450 s; capitals
  ~2 min human accepted (multi-phase keep → backlog); offline 4 h kept pending the dynasty data.
  Balance on a short last round (dynasties, the Unbroken rule, intel prices). Then integration
  runs the final QA round.
- **Balance dynasty round** (~09:40, 632/632): `runDynasties` in campaign.mjs; D1 1.38 h, D2 1.92 h
  (1.39×), D3 1.95 h (1.41×), waits pass in every dynasty; stars had to fall to ~1/10 of DESIGN or
  later dynasties got faster; Unbroken → sites held at battle start (`tracker.held`), now 85 %;
  intel shipped at 4.5×/9×, 270/675 s (3×/6× failed both checks). Lead: accept ~1.4× dynasties;
  stars simplified to +3 % income / +3 % bounty (atk/def 0); **offline base cap 2 h** (the length
  lever for real idle players); DESIGN §5.2/§5.4 updated. Balance: last tiny config round.
- **Integration final QA round (release candidate) started**: copy fixes (Unbroken text from
  CROWN_TEXT, star/offline text derived), full playtest incl. the dynasty flow, regression,
  docs/img + README refresh, `rc-*` gallery.
- **Balance DONE** (~10:05): stars +3 % income/bounty (atk/def 0, starBase 3), enemyMultPerDynasty 1.38,
  regionsPerDynasty 1 → D1 1.38 h / D2 1.77 h (1.29×) / D3 1.96 h (1.42×), waits pass (D2 worst 36 m);
  offline cap 2 h; Treasury 120 × 1.7. A check-in player (`--checkinHours`) showed the offline cap is
  NOT the length lever (active play after returning sets pace; only ~10 % offline efficiency would
  stretch a dynasty to a day). Lead: keep 100 % offline; DESIGN corrected. Config final.
  Integration told to pass crown texts as data (a UI purity test is red because crownRow imports config).
- Integration hit the usage limit mid final-QA (~10:30); resumed at 08:41 (next day). Suite 635/635.
- **Release candidate DONE** (~09:30): 635/635, check root + --base=temp pass, shots tour 0 page errors;
  4 real-input playtests (desktop/phone × seeds 7, 23) from tutorial through Found a Dynasty and a D2
  battle; fixed: Treasury text said 8 h, welcome-back showed the capped time, toast pile-up, banner
  under toast; `rc-*` gallery; README/docs/img refreshed. Lead review: the drag arrow is too faint. Final
  polish round sent: a bold green/red arrow, a stalemate coach hint, a council "Best value" tag, no
  "larger continent" promise, "a minute or two" copy, intent lines only for threats.
- **Waiting on the user:** permission for a local checkpoint commit on `redesign` (nothing committed yet).
- World-gen brief waits for the balance engineer to finish its main round, so its campaign
  measurements aren't invalidated mid-run.

## Team model
The user asked that the engineers run on **Sonnet 5.5** (`claude-sonnet-5-5`). Use
`subagent_type: sonnet55-engineer` (agent definition `model: claude-sonnet-5-5` in
`C:\Users\kyleg\Projects\.claude\agents\` and `.claude/agents/` here; loads at session
start). Verify the model ID once per session with a one-line check agent.
