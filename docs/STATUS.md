# Hex Dominion 2 — redesign status (lead designer's log)

Branch `redesign` (v1 preserved at tag `v1-final` and playable at `classic.html`).
Nothing has been committed or pushed yet; `main` (which auto-deploys to GitHub Pages) is
untouched.

## ROUND 4 (2026-10-02): the Living Frontier, in progress
The user found the loop boring ("fight the next area, then upgrade"). Brainstorm: docs/PROGRESSION-PLANS.md. Picked B + C plus
counterattacks (live only, gentle trickle while away), fortifications that change hands, up to 3 concurrent battles with switching
+ Steward AI, occupation (retake restores), Renown for festivals. Design DESIGN §10, contract ARCHITECTURE §10, phases
docs/PLAN-FRONTIER.md. Phase 1 started 2026-10-02 with two opus55-engineers: sim/meta (new; defense mode, steward, frontier/forts/militia meta,
campaign + tuning, writes docs/briefs/frontier-hookup.md) and integration (the RC2 QA engineer; Step 1 = battle manager refactor with no
behaviour change, Step 2 = tray/switching/markers/occupation/fortify UI/away report/tutorial/checks).
- Integration Step 1 DONE: `game/app/battles.js` manager (state.battles, legacy migration, sanitizeBattles, the scene is a view;
  setStewardDecide slot); 942/942, all checks green. Step 2 in progress (tray, Map button, Tab, second attack, markers,
  occupied visuals; `check.mjs --only=frontier`). progression.js foundDynasty now sets battles: [] (relayed to sim/meta).
- Sim/meta defense API FINAL (balance still tuning): defenseArena.js (site 0 = ENEMY camp in defense arenas), defense mode results,
  steward.js styles, fortification site fields, meta frontier/forts/militia. Lead: retreating from a defense = abandoning → occupy.
  Relayed to integration for Step 2 wiring.
- **Sim/meta Phase 1 DONE** (1010/1010): in person 86 % hold, Captain 54 %, waits ≤ 28 min (12/12), D1 1h24, retakes all
  Easy/Fair, away-rule tests, determinism, perf. Lead: fortified regions too safe (92-100 %) → smart targeting of weak spots +
  siege preparation (target 85-90 % unattended); Walls I ~×1.35; Captain ≥ 55 % in the first two depth bands. DESIGN §10.3
  updated. Integration resumed Step 2 after the usage limit (~03:10 reset).
- Tuning round DONE (1013/1013): weak-spot targeting (FRONTIER.targeting) + siege prep (+12 %/fort level); Walls ×1.5/1.65/1.85, Hall
  ×1.6/2.0/2.4, Tower kills 0.6/0.9/1.2; fort pairs Captain 85-91 % / in person 98-99 %; Captain by depth 57/70/57/45/35/78 %;
  campaign losses 0-2/seed, waits ≤ 28 m, D1 1h23. Lead: accept the numbers; fix campaign.mjs so only one overlapping battle is
  in person (the rest stewarded) and re-measure losses; no game changes unless losses spiral.
- 2026-10-02 10:45: a NEW session. Tree 1013/1013, 72 uncommitted Phase 1 files. Integration had most of Step 2 in place (frontierLoop,
  tray, markers, war bands, occupation render, incoming toast, away report, defense checks in progress); both agents resumed
  (integration: finish Step 2 + full regression + screenshots; sim/meta: report the one-battle campaign re-measure).
- **Sim/meta DONE for Phase 1**: one-battle-at-a-time campaign → live losses [2,0,1,3,1,0,0,0,1,2,3,2], max 2 occupied, 15 retakes
  (14 Easy), in person 24 (96 %), Captain 156 (91 %), 2+ forts 128/128 held, waits median 11m26 / worst 23m52, D1 1h22. The campaign
  policy FORT_THREAT 0.8→0.9 (bot behaviour only; lead accepted). 1013/1013 verified by the lead.
- **Integration Step 2 DONE → PHASE 1 COMPLETE** (~12:30): frontier loop on active time, incoming toast + Go, defense view (Hold timer,
  Abandon copy, Defended / Region lost cards), Walls ring, occupied hatching + Retake card, Fortifications panel, away report, tray
  with a Captain toggle, tutorial F1-F4; check frontier 153, desktop 191, phone 188, --base=temp 421, a11y/icons/hints/galleries
  green; screens `screenshots/frontier/`. Lead: approved + 3 polish fixes (honest retake reward copy, camp badge above squads,
  war-band label vs region label). Next: hand Phase 1 to the user to play; then Phase 2 (Generals + Renown).
- **PHASE 2 started** (~12:45): lead wrote DESIGN §10.11 (Generals roster/levels/skills/actives/steward/assignment/wounds) and §10.12
  (Renown earn/spend, Festivals). The sim/meta engineer is building generals.js, renown.js, abilities in the sim, the steward by
  style/level, configs, balance, campaign, and docs/briefs/phase2-hookup.md. Integration does the Phase 2 UI after the Phase 1 polish.
- Phase 1 polish DONE: conquestBounty()/crownsPayable() (honest retake reward, one source), badges drawn above squads/fx, war-band
  badge avoids label boxes. 1014/1014; frontier 159, desktop 191, phone 188.
- Phase 2 meta/sim API FINAL (tuning ongoing): generals persist (sanitizeGenerals), renown per dynasty, playerBattleStats {commander},
  ability command + abilityState, settleCommander, renown returned from awardCrowns/defenseReward/conquer (+recruited), spends with
  refusals, panel data fns. Integration started the Phase 2 UI (HUD laurel + Generals panel, commander picker, ability button G,
  recruitment card, Festival/Muster on the card, tutorial G1/G2/R1, checks, screenshots/phase2/).
- **Sim/meta Phase 2 DONE**: generals ×1.05-1.09 (L1) / ×1.15-1.20 (L10) army power; unattended no-fort holds L1 66-81 %, L10 73-89 %;
  Renown ~100/D1 (7 festivals); D1 1h21; D2/D3 now 1.16×/1.26× (persistent Generals). Lead accepted: shorter later dynasties
  (long-term progress), Marshal 89 % (defensive specialist), festivals kept affordable. 1041/1042 (timing flake).
- **PHASE 3 detail written** (DESIGN §10.13: region types incl. Dragon boss, battle twists incl. Siege on capitals, world events).
  The sim/meta engineer started Phase 3. Both agents hit the usage limit (~15:30) and were resumed at 16:00 (1050/1053; Phase 3 in flight).
- Phase 3 sim/meta API FINAL (label recalibration ongoing): region.type/twist, feature sites, dragon events, the Lair falls with the dragon,
  conquer returns type/renown/dragonscale, boons/worldEvents state, tickEvents/accept/decline, duel runs. Phase 3 UI queued for
  integration after its Phase 2 report.
- **Sim/meta Phase 3 DONE** (1066/1066): D1 1h26, waits ≤ 30 m on 12/12, capitals 3m10, labels Easy 91 / Fair 77, card factors measured per
  twist/type, the attack-bot power quirk fixed. Problem: the Lair walls later dynasties (founding needs every region; worst wait 206 m).
  Lead: the Lair is OPTIONAL for founding (canFoundDynasty ignores it; DESIGN §10.13 updated) + re-measure the Duel (target 60-75 %).
- **Sim/meta Phase 3 CLOSED** (1067/1067): canFoundDynasty(state, world) ignores an unconquered Lair (1-arg form unchanged);
  foundDynasty(state, seed, newWorld?, currentWorld?); world-gen never places the Lair as a cut vertex. D1 1.33 h / D2 1.32x / D3 1.21x,
  waits > 40 m on 0/2/2 of 12 (worst 19/47/56 m). Gate garrison 26 -> 18, Holy Ground x0.8, unscouted Night label x0.92.
  Duel 74 % (28/38). Integration owes: world.js:478/:1176 + stateContainer.js:96 callers (phase3-hookup.md §7).
- **Integration Phase 2 UI ACCEPTED** (generals 127, frontier 159, desktop 191, phone 188, a11y 152, icons 25, hints 17 placed;
  gallery screenshots/phase2/). Lead polish sent: laurel Renown icon (was the Realm trophy), ability name as a header banner
  (was clipped under badges), General emblem on the ability button, tray chip subtitle = kind only + toggle renamed "Delegate",
  skill buttons state the real effect, Militia row typography, recruit lines -> config. Then Phase 3 UI per phase3-hookup.md.
- **2026-10-03 Phase 3 UI DONE, handed to the user for playtest** (user: less mid-way QA, one pass at the end). Final pass: npm 1072,
  desktop 191, phone 188, frontier 159, generals 127. Lead fix: ai.js defend() never reinforces the Gate (keep refilled it endlessly);
  this broke one label test (swarm Fair 92 %); sim re-fit the Siege label factor 0.88 -> 0.75, 1072/1072 green, D1 1.31 h / D2 1.28x /
  D3 1.24x, waits > 40 m on 0/1/1 of 12. Gates behind a settlement (15 of 48) kept: take the near settlement first.
- **2026-10-03 PHASE 4 "Goals and Rivals" STARTED** (user: "work on more of the new features"). Spec + contract: docs/PLAN-PHASE4.md
  (Bounty Board, Conquest Streak, Deeds across dynasties, Rival Grudges and Vendettas with a Champion, Phase 3 rough edges).
  Fresh Opus engineers: sim/meta (writes docs/briefs/phase4-hookup.md early) and integration (4E first, then UI, then hook-up).
  One QA pass at the end, then the user playtests.
- **2026-10-03 PHASE 4 DONE, handed to the user for playtest.** Sim/meta: bounties (13 kinds), streak (cap x1.3), 12 deeds / 29 tiers
  in state.generals.deeds, grudges (+16 per region) and Vendettas (war band x1.8, Champion power 2.0; held 82 %), 8 new voice
  triggers; D1 1.13 h / D2 1.44 h / D3 1.45 h, waits > 40 m on 0/1/0 of 12. Integration: board in the Regions panel (HUD full at
  360 px), streak chip under gold, Deeds grid + Trophy wall in Realm, grudge strip + card meter, Vendetta banner, Champion ring and
  pennant, envelope pip for dismissed offers. npm 1088/1089 (only the generateWorld timing test under load; ~100 ms alone);
  checks desktop 191, phone 188, generals 127, goals 118, hints + iconcheck ok. Gallery screenshots/phase4/. Open: swarm label
  calibration (ceiling 0.99), Champion gallery frames weak, INTEGRATION-NOTES has no Phase 4 section (brief is phase4-hookup.md).
- **2026-10-03 PHASE 5 "Dynasties that change the rules" STARTED** (user: "continue working"). Spec + contract: docs/PLAN-PHASE5.md
  (Edicts 1-of-3 at founding, Legacy tree in state.generals.legacy, Challenges, Quick Conquest for Easy regions, the founding
  ceremony; plus swarm calibration, defense retreats keep the streak, INTEGRATION-NOTES Phase 4/5). Fresh Opus sim/meta +
  integration engineers; one QA pass at the end.
- **Sim/meta Phase 5 DONE** (1105/1105): edictMods = the one modifier source (Edict + Challenges + Legacy); 15 Legacy nodes in
  state.generals.legacy; foundDynasty(..., {edict, challenges, legacyBuys}); Quick Conquest driven by the attacker bot (steward
  only 65-81 %), 99.6 % on Easy. D1 1.13 h / D2 1.17x / D3 1.13x, 0 waits > 40 m; every Edict D2 0.91-1.37x (Warrior Kings
  cooldown cost eased +50 -> +35 %). Swarm label honest again via GENERALS.cardCredit.vs.swarm = 3, test ceiling back to 0.92.
  Later: an economy pass with the campaign reading the commander-credited card (D1 would drop to 1.04 h).
- **2026-10-04 PHASE 6 "The Ashen Host" STARTED** (spec docs/PLAN-PHASE6.md): rival rotation from D2, a 4th rival with The
  Fallen Rise (20 % of your losses join them; Firestorm burns the dead), the Barrow Keep Rising, the Gravewarden General, the Pale
  Margrave voice, + the credited-card economy pass. Sim/meta started in NEW files only while Phase 5 integration finishes its QA;
  lead sends "Phase 5 QA done" to unlock edits. Integration for Phase 6 starts after the Phase 5 report.
- **2026-10-04 PHASE 5 DONE** (integration): founding ceremony (game/ui/ceremony.js, 5 steps, full screen < 600 px), Realm Edict +
  laurels + Legacy tree, Quick Conquest button/overlay (600 sim steps per frame), Edict/Challenge UI effects, tutorial D1 (inside the
  ceremony) + D2 (afterDone flag), Realm stats split This dynasty / All time. Final pass: npm 1105, phase5 96, desktop 191, phone 188,
  frontier 159, generals 129, goals 118, hints all placed, iconcheck ok. Gallery screenshots/phase5/. Phase 6 unlocked; Phase 6
  integration engineer started.
- **2026-10-04 COMMITTED + DEPLOYED** b425e2b (Phases 1-5 + Phase 6 WIP) to redesign and main (user: "commit and push whatever i need
  to test", then "merge to main and deploy"). Pages deploys via the "Deploy to GitHub Pages" workflow on main.
- **Sim/meta Phase 6 DONE** (after b425e2b, uncommitted): Barrow Keep Rising 0.05 + DIFFICULTY.undyingCapital 1.45; undying card 2.1,
  personalityStat 0.75, lighter settlement mix; UPGRADE_COST_MULT 1.2 (credited-card economy); swarm card credit 3 -> 1.5.
  D1 1.24 h, D2 (Ashen) 1.34x, D3 1.38 h; Ashen fights 1.10x / capital 1.03x. Watch: Ashen Easy 78 % on one sweep (noise?).
- **DEPLOY BLOCKED:** the Pages workflow runs the FULL check.mjs (+ --base=temp); b425e2b failed 8 checks (keepsakes: Found a Dynasty /
  Chronicle pushed off the first screen by the new Realm sections; variety: Merchant deals no longer open on desktop; phone Plague/Holy
  Ground). Live site still a48e1d7. Balance commit 4d64d2b pushed to redesign + main (same failures expected). Integration is fixing;
  lead decided the Realm order: Dynasty (when won) > compact Edict line > Chronicle > Deeds/Trophies/stats/Legacy.
- **Deploy fixed:** c41340d (Realm order + robust variety checks) and 96d5252 (performance.setResourceTimingBufferSize(2000): the game loads
  258 files and the 250-entry default dropped some from the offline precache). Verified on a clean worktree with the CI commands, then
  pushed to redesign + main (96d5252). **LIVE 2026-10-04:** the Pages workflow passed (verify, browser, deploy) and
  https://ka1e27.github.io/temp/ serves 96d5252.
- **Phase 6 integration DONE (uncommitted):** Ashen colours #5c5b64 / #2c2b33 / #a9dfd6 (CIEDE2000 >= 20.4 under all visions), skull-crown
  emblem, 1.9x territory wash, battleAshen.js + ashenFx.js (rise wisps, ember burn, Rising ring, Raise the Fallen), card line, A1 hint,
  Gravewarden card. Final pass all green incl. new --only=phase6 (72). Gallery screenshots/phase6/. Gaps: no live check for Raise the
  Fallen; burning ground is not restored after a reload.
- **2026-10-04 PHASE 7 "Boons and Relics" STARTED** (user: "continue working"). Spec: docs/PLAN-PHASE7.md. 1-of-3 Boon drafts after
  battle conquests (24 Boons, 4 Duos, rarities, cursed; War Council kept), 4 Relics per continent (Ruins first) + a lasting Reliquary,
  Phase 6 leftovers. Fresh sim/meta + integration engineers. The Phase 6 UI (9 files, uncommitted) is snapshotted in
  scratchpad/p6snap: it PASSED the full CI gate (npm 1117, full check.mjs, --base=temp). Deploy on request: commit in the
  snapshot worktree, push that commit to redesign + main, then git reset (mixed) the main tree onto it.
- **Phase 6 visuals LIVE** (Pages run passed: verify, browser, deploy) as 8c46c94 (the snapshot commit) to redesign + main at the user's "deploy Phase 6"; the main tree
  was reset onto it with the Phase 7 WIP kept as uncommitted diffs.
- **Sim/meta Phase 7 DONE** (1138/1138): 24 Boons (Royal Hoard replaces War Chest), 4 Duos, boonMods = the one source, sim hooks in
  game/battle/boons.js (boonTriggered), 8 Relics (4 per continent) + Reliquary + Reliquarian deed. UPGRADE_COST_MULT 1.2 -> 1.5:
  D1 1.13 h / D2 1.39 h / D3 1.24 h, 0 waits > 40 m; no Boon trivialises battles (best win rate 82 %). Lead change in progress:
  drafts only after Fair+ wins, typed regions and capitals (the bot owned 21 of 24 by the end of D1). Later: 8 more Boons.
  Gating done (1139/1139): median 14 Boons at the end of D1; D1 1.27 h / D2 1.37 h / D3 1.26 h, 0 waits > 40 m.
- **Integration Phase 7 playable** (uncommitted): post-battle draft (rarity frames, Champion's eye, Decide later + Boon chip), Duo
  reveal, Boons strip + Reliquary in Realm, Relic glint/card line/claim moment, boonTriggered pops, K1/L1 hints, Raise the Fallen
  check, burn ground restored after reload. Full check.mjs 1490 ok / 1 FAIL (flaky phase6 "Firestorm burns the dead"), base=temp
  ok. Lead asked: make that step deterministic, queue recruit card vs draft, chest 1.5x, INTEGRATION-NOTES Phase 7, then re-run the gate.
- **Phase 7 READY TO DEPLOY** (uncommitted): flake root-caused to check staging (phase6 7/7 green), post-battle moments queued
  (conquest > Relic claim > recruit > Boon draft > map), chest 24-44 px; deploy gate passed (npm 1139, full check.mjs 1491 ok,
  --base=temp 421 ok).
- **Phase 7 committed 6560e5f** and verified on a clean worktree (full check.mjs + --base=temp passed; npm 1139 on a re-run, the
  generateWorld timing test flakes in parallel runs), pushed to redesign + main at the user's "deploy Phase 7". **LIVE** (Pages run passed).
- **2026-10-04 PHASE 8 STARTED** (spec docs/PLAN-PHASE8.md): performance (tools/perf.mjs, budgets, fixes), an in-game Codex, and
  content (+8 Boons, +2 Duos, +4 Relics, +2 events, robust generateWorld timing test). Content (sim) + perf/Codex (integration).
- **Content Phase 8 DONE** (uncommitted): 32 Boons, 6 Duos, 12 Relics, Deserters + Harvest Festival (x3 for 10 min, 60 s of income),
  Reliquarian tiers [1,6,12], War Drums +15 %/6 s, generateWorld test takes the best of 3. D1 1.30 h / D2 1.49 h / D3 1.28 h,
  14.5 Boons at the end of D1. npm 1158/1160 (2 icon tests wait on integration).
- **Perf + Codex Phase 8 DONE** (uncommitted): tools/perf.mjs; title 4.2 -> 2.2 s, map 5.4 -> 3.5 s, big battle p95 41 -> 25 ms, Ashen
  49 -> 22 ms, Dragon 41 -> 23 ms, meta tick 0.54 ms, save 6.6 KB (worst offender: #ui:has() CSS restyling every frame; sprite/label
  caches; terrain bake off the title; generated modulepreload, A/B 2.2 vs 3.2 s). Codex: 34 topics, locked until met, revisit hints,
  "?" in every panel. 8C UI done. Gate green after re-runs. Lead asked: one stacking column for top toasts (the Deed toast covered
  the leader banner) + make the generals tray-picker check deterministic, then re-run the gate.
- **Phase 8 READY TO DEPLOY:** top-notice lane (layoutTopLane, phone cap 2, a no-overlap assertion in hintMonitor, --only=toplane),
  generals flake fixed (a focus race in the check). Snapshot scratchpad/p8snap (86 files, no Phase 9) passed the full gate: npm 1160,
  full check.mjs, --base=temp. **Committed 9de1c05 from the snapshot and pushed to redesign + main** at the user's "deploy
  Phase 8" (2026-10-05); the main tree was reset onto it with the Phase 9 WIP kept as diffs.
  CI failed 9de1c05 on phase6 phone (the Gravewarden step picked a region that surrendered once the commander was credited);
  fixed in 59475b7 and redeployed: **LIVE** (Pages run passed). Known: the phase6 "Firestorm burns the dead" step still flakes about 1 in 3 under load (burn present,
  burned 0); assigned to the Phase 9 integration engineer. A Windows-only artifact: the modulepreload check fails in CRLF
  worktrees (content identical); CI on Linux is fine.
- **Phase 9 DONE + READY TO DEPLOY** (integration, gate green: npm 1180, full check.mjs 1658 ok, --base=temp ok, phase6 5/5): the
  Challenges hub (title + Settings), sandboxed play (stateContainer enterSandbox/leaveSandbox; realm byte-identical), goal tracker,
  result + share line, daily reward, banner styles, Codex group, hint J1, lazy-loaded kit. The phase6 Firestorm flake was a Relic
  (the Gravewarden's Lantern) picked up earlier in the run; fixed. Snapshot scratchpad/p9snap (45 files on 59475b7).
- **2026-10-05 PHASE 10 "Cohesion" STARTED** (user: "after phase 9 finishes continue working"): docs/PLAN-PHASE10.md. A first-hour
  interruption audit (tools/firstHour.mjs, pacing targets) + a rough-edge sweep (1:37 vs 1:38, tracker wording, banner over modals,
  galleries, a Cartographer check, Lantern text, CRLF-safe preload check). One engineer owns the whole tree.
- **Phase 10 DONE** (uncommitted): pacer (app/pacer.js, 152 s between first appearances; the first raid exempt), hint pacing,
  merged post-battle toasts, quieter leader lines for the first 10 min, the first Boon held off battles; all 9 sweep items done. First
  hour (seed 7): busiest minute 11 -> 5, unlock misses 12 -> 1. npm 1187, gate sections green. Snapshot scratchpad/p10snap (Phase 9+10,
  73 files on 59475b7) is running the full gate. Found: only 9 battles in a human-paced first hour (a Hard/Deadly wall from about
  minute 5) and the first raid at about minute 40.
- **2026-10-05 PHASE 11 "Early flow" STARTED** (docs/PLAN-PHASE11.md): a human-policy measure across seeds; targets >= 18 battles in
  the first hour, Easy/Fair available >= 75 % of minutes, idle <= 4 min; the first raid 2-5 min after the grace; campaign guards kept.
- **Phases 9 + 10 committed dc73d40** from the gate-verified snapshot (npm 1187, full check.mjs, --base=temp) and pushed to redesign + main
  at the user's "deploy Phase 9 and 10" (2026-10-05); the main tree was reset onto it with the Phase 11 WIP kept.
  **CI BLOCKED the deploy twice** (the site is still Phase 8): check.mjs §3b "a real click on Scout records the scouting" fails on CI
  every time (the click lands, the scouting never records) while passing locally; a one-off defense failure did not repeat. Theory: the
  card rebuilds between mousedown and mouseup on the slow runner. An isolated-worktree engineer is reproducing it with --cpu throttling.
- **Phase 11 (uncommitted) first pass:** campaign --policy=human (32 seeds); ladderCurve 1.12; upgrade cost ramp 1.0 -> 1.5 by level 8;
  map labels credit the commander (as the card does); first raid scheduled 75-255 s after the grace. Human first hour: battles 21 -> 26,
  Easy/Fair minutes 50 -> 79 %, longest idle 14.4 -> 9.5 min (target 4 unreachable by config: walls are map structure). D1 1.03 h.
  Lead -> 11b: UNREST (the weakest frontier region thins 6 %/min, up to 30 %, after 3 min with nothing Easy/Fair), Best value rates
  Powers cards too, the pacer reserves a slot around the scheduled first raid; then the full gate.
- **CI blocker ROOT-CAUSED + FIXED (b694eb8, pushed to redesign + main):** a real Phase 10 bug. The delayed Attack hint opened its
  slot in the region card and the phone bottom sheet grew ~100 px mid-tap, so taps landed on the wrong button. Fix: card layout
  changes are held while a pointer is down (+250 ms). Also: the council "Bought X" line no longer shifts the Buy buttons; check.mjs
  --cpu/--tz and a Scout regression step. Verified on the worktree (cpu=4 3x, full gate, npm 1187). The Phase 11 engineer is applying
  the patch to the main tree (done; local redesign = b694eb8). **LIVE 2026-10-05:** after two GitHub-side failures (Chrome never started;
  jobs never got runners), the third attempt passed: Phases 1-10 + the fix are on Pages at b694eb8.
- **Phase 11b DONE** (uncommitted on b694eb8): UNREST (game/config/unrest.js, meta/unrest*.js, app/unrestLoop.js; 90 s / 20 %/min / -40 %
  / recovers 2 %/min, through enemyBattleStats so labels and fights include it; not in challenges), Best value rates Powers too (fix in
  progress: only cards affordable within ~60 s of income), the pacer reserves 150 s around the planned first raid. Human first hour (32
  seeds): 26 battles, Easy/Fair 89 %, longest stretch with nothing Easy/Fair 4.9 min. Optimal D1 1.01 h, D2 1.25x, D3 1.09x, 0 waits > 40.
  Gate: npm 1198, full check.mjs in 16 groups (1700), --base=temp 426, desktop/phone --cpu=4 green. Watch in playtest: Unrest is generous.
  Best value: only cards affordable within 60 s of income (BEST_VALUE.horizonSec) + a cross-tab pointer; npm 1199. Snapshot
  scratchpad/p11snap (38 files on b694eb8) PASSED the full gate in one run (npm 1199, full check.mjs, --base=temp). **Committed 9a98333 and pushed to
  redesign + main** at the user's "deploy Phase 11" (2026-10-05); the main tree was reset onto it with the Phase 12 WIP kept. **LIVE** (Pages run passed first time).
- **2026-10-05 PHASE 12 "The Sea Kings" STARTED** (docs/PLAN-PHASE12.md): archipelago continents from D3 (fords, harbours, sea lanes), a
  6th rival (raider, coastal raids, Longships), the Tide Fortress, the Admiral, the Sea Queen, +3 Boons, +2 Relics, Shipwreck.
  Sim/meta + integration engineers.
- **Sim/meta Phase 12 DONE** (npm 1216): config/sea.js; world/archipelago.js (1-in-3 from D3, 3-5 islands, fords stay in their region,
  harbours, sea lanes; land worlds byte-identical); battle/sea.js + seaArena.js (local lanes, quay sites, the Tide, sea reinforcements,
  Broadside); raider AI and coastal raids; the Admiral; the Sea Queen; +3 Boons, +2 Relics, Shipwreck. D3 archipelago 0.97x land,
  Sea Kings fights 0.89x/1.03x, Tide Fortress 0 timeouts, D1 human pace unchanged. Lead: make the Tide flood the approach routes
  (catch something in 30-60 % of fortress fights). Done (npm 1217): the Tide floods tidal tiles on the approach routes (routeRadius 5,
  keepShore 2); it catches some squad in 12/12 fortress fights, costing 3.1 % of troops sent (max 9.3 %), 0 timeouts. The Drowned Crown is
  Shipwreck-only (it had been cancelling the Tide on 8/12 seeds).
- **Phase 10 engineer pass (2026-10-05, uncommitted on top of the Phase 9 tree):** `tools/firstHour.mjs` (+ `firstHourProbe.js`, `firstHourBot.mjs`,
  `firstHourReport.mjs`): a 60-min scripted new player (seed 7, desktop, real presses) with an interruption log. Before: busiest minute 11 (the tutorial),
  14 systems unlocked in the first 8.5 min (12 spacing misses). Fixes: `app/pacer.js` (one new system per 150 play seconds (lead; was 190): intro hints, streak chip, first
  Deed, board, first Boon, first event / Vendetta; the first raid is exempt (lead) but restarts the clock), hint pacing (`HINT_PACE`: 10 s between new steps, calm steps, W3 after 2.5 s, B2/B4/B5 to battle 2),
  post-battle toast digest, a quieter leader rate in the first 10 min, no leader banner over modal cards. 10B: share time = result time (floor), "Capital
  taken" tracker words, Lantern text, CRLF-safe preload check, Cartographer real-input check (phase5), Champion gallery frames, Phase 9 gallery retaken,
  INTEGRATION-NOTES queue + pacing sections. Found by the audit: a steward-won defense threw in onRemoteConquest (fixed). Results in screenshots/phase10/.
- **2026-10-04/05 PHASE 9 STARTED** (spec docs/PLAN-PHASE9.md): Daily Challenge, 6 Scenarios, banner cosmetics. Sim/meta (new files
  first, now unlocked) + integration; both resumed after a usage limit.
- **Sim/meta Phase 9 DONE** (1180/1180): sandbox createChallengeGame -> {state, world} (small 30x24 continent, challenge mods
  through edictMods), dailySpec(yyyymmdd) with 4 rotating goals, 6 scenarios (bot: all 3 stars), lasting record under its own key
  (results, streak, banners, claimDailyReward once per date). Bot: 30/30 dailies (median 4:35). Fixing: two 43-min conquer days
  with several gated capitals -> cap the slowest daily at about 20 min. Rough edges: no leader lines for
  Plague/Merchant; an event toast closed with x cannot be reopened; phase3 gallery not re-shot after the gate/toast/plague fixes.
  - TODO: swarm calibration pass: Fair fights vs Amber won 98%, ceiling temporarily 0.98-0.99: 50 of 51 failed 0.98 (game/tests/balance.labels.test.js).
- **Integration Phase 2 polish + Phase 3 UI DONE** (report pending lead review): laurel everywhere Renown shows, ability banner, emblem on the
  ability button, "Delegate" tray toggle, real-effect skill picks, Militia row typography, recruit lines in config. Phase 3: §7 callers, boons /
  worldEvents state + save (Duel runs survive save), Gold Mine income on the card; map type badges + twist glyphs + Plague tint; card type /
  twist / boss rows; battle sprites (Bandit Camp, Gate, Shrine, Ancient Tower), Night / Blizzard / Flooded / Holy / Siege / Raid visuals, the
  Dragon (perch, flight, telegraph, breath, health, fall); world events loop (offer toasts, Merchant deals, Plague, Duel with its own card);
  Dragonscale in Realm; tutorial V1-V5. `check.mjs --only=variety`, `integration.phase3.test.js`, gallery `screenshots/phase3/`.
- **Integration Step 2 DONE** (~11:00): the tray (+ Captain toggle), Map / switching / Tab, a second attack, crossed swords, marching war bands,
  incoming toast with Go + countdown (`app/frontierLoop.js`, `__hd.raid`), defense runs on arrival (enemy camp at site 0, "Hold m:ss", Abandon copy,
  Defended / Region lost cards), the steward for unwatched runs (captain; stalwart with a commander), occupied hatch + badge + Retake card, the
  Fortifications panel (the Works panel parameterised) + fort marks on the map + walls in battle, the away report on the welcome card, tutorial
  F1-F4, battleThreat uses siteDefence (Walls). `check.mjs --only=frontier` (multi-battle + defenses, desktop and phone). Gallery
  `screenshots/frontier/` (`tools/frontiershots.mjs`).

## LIVE (2026-10-02): v2 deployed to GitHub Pages from main a48e1d7

## ROUND 3 (2026-09-30 ~11:00): user playtest feedback, done
The user played the RC and asked for: fixing misplaced tutorial hints; teaching sending, Rally and
every control (incl. shift-drag); auto-send; no marching through enemy territory; centred ×/gear
buttons; per-area upgrades. Lead design (DESIGN §4.3 supply lines, §4.4 front lines, §5.8 Region
Works, §6 tutorial; PLAYFEEL §4 placement rules + new step table W0-M4). Assigned in parallel:
- **Balance** (sim owner): A front lines (`battle/territory.js`, canRoute/routeFor/previewSend
  routable/refused), B supply lines in sim (`battle.supply`, SUPPLY config), report the API → then
  C Works effects hookup → D full recalibration.
- **Features**: Region Works (`game/meta/works.js`, `config/works.js`, worksPanel/worksChooser/
  worksMarks, gallery, `docs/briefs/works-hookup.md`); no state/save edits (integration applies).
- **Integration**: A hint placement fixes + an automated tip-to-target assertion across viewports,
  B icon-button centring + check, C the expanded tutorial + Replay + controls card → D supply/route
  UI after balance's API → E Works UI after features.

- Balance A+B DONE (~11:40): front lines + supply lines in the sim (canRoute/routeFor/tileOwner/
  computeTerritory, refused event, battle.supply, SUPPLY config, a player-only deadlock fallback),
  25 tests. API relayed to integration (D unlocked). Lead: War Camp placement maximises attackable
  non-keep sites; halo/link tiles if none; keep-first only when unavoidable.

- Features Region Works DONE (~12:30): `game/meta/{works,worksEffects}.js` (leaf split to avoid a cycle),
  `config/works.js`, worksPanel/worksChooser/worksIcons/worksMarks, 68 tests, gallery `screenshots/works/`,
  `docs/briefs/works-hookup.md`. Lead: add demolish (50 % refund, confirm); one per type per region;
  Watchtower scouts from L1. Balance C and integration E unlocked.

- Works demolish DONE (~12:50): `demolishWork` with 50 % refund across levels, an in-row confirm (Keep default,
  6 s auto-cancel), not farmable (tested), hookup doc updated. The features engineer is finished.

- Integration + balance hit the usage limit (~13:00); resumed 13:41. Suite 773/774 (integration's threat test).

- **Balance A-D DONE** (~15:00): front lines + corridors (`openCorridors`, soft-before-keep: 0 shielded arenas),
  supply lines, camp volley, Works hooks (+ Watchtower de-dominated), bot legal-route relay, recalibration: D1 1.30 h,
  D2 1.25×, D3 1.48×, waits OK except seed 7 (129 m), tutorial 65 s, labels Easy 97/Fair 78/Hard 59, Swift 51 %.
  Lead: corridors must be NEUTRAL (tileOwner -1, drawn untinted/dashed; the user asked for no enemy-land marching;
  DESIGN §4.4 Border marches); Barracks +camp growth, Stables +supply frequency (DESIGN §5.8); fix defensive-tower
  labels (seed 7). Short final balance round running. Integration told about link tiles, Works callers, camp arrows.

- **Balance final round DONE** (~16:30): link tiles neutral (tileOwner -1, 500+ route proof); Barracks ×1.16, Shrine
  ×1.07, Watchtower ×1.14, Market full-set ×1.15, Stables ×1.02 (misses); the seed-7 root cause was bot arrow-sizing
  (fixed; defensive-tower Easy 64→99 %); refit (troopPerTier 1.78); D1 1.31 h / D2 1.32× / D3 1.43×, waits ≤ 24 m in D1
  on 36 seeds. PROBLEM: winning battles too long (tier 1-2 1m51, tier 2 ~4 min, capitals 2m30). Lead: one more
  balance round on battle length (tier 1 ≤ 90 s, tier 2 ≤ 120 s, mid 60-120, capitals 120-180) + Stables field-clash
  strength (DESIGN §5.8). Integration owns Works copy (derive from config).

- Both hit the usage limit (~17:30); resumed 18:43. Suite 794/796 (balance label tests, mid-retune).

- **Integration A-E DONE** (~20:00): coach rewrite (live targets, tip ≤ 4.5 px at 7 viewports, `tools/hints.mjs` +
  `hintMonitor.js` assertion), icon centring (`tools/iconcheck.mjs`), set-based tutorial (W0-M4, Replay, controls card),
  supply/route UI (reach glow, grey No route, refusal shake, Ctrl/long-press/Auto+S, chevrons along routeFor, neutral
  corridors drawn untinted/dashed), Works UI + derived copy + guards. 794/796 (balance labels). Follow-ups sent:
  verify the supply-desk-2 frame (the straight gold arrow to an unreachable keep?), 44 px touch targets for the ×s,
  touch-action on chrome, phone M3 bubble.

- Integration follow-ups DONE (~21:00): the gold arrow was the TUTORIAL hand pointing at an unreachable keep (bug:
  noRoute scored as arrival 0; fixed + asserted); short-hop chevrons; waiting-line stub; `tools/supplyshots.mjs`; 44 px
  touch hit areas (iconcheck asserts); touch-action on chrome (pinch no longer zooms the page); phone M3 one-liner.
  Lead: the clean frame shows a LONG neutral corridor along the enemy region past the keep (the connector guarantee).
  Sent to balance: drop connectors, cap border marches at 3 tiles, never along the keep (DESIGN §4.4).

- **Discovery round** (~21:30, the user asked "look for more to work on"): three READ-ONLY fresh-eyes auditors
  launched on Sonnet 5.5: a playtester (new player, no design docs, real input desktop/phone/late game →
  `screenshots/fresheyes/`), a code bug-hunter (save integrity, time jumps, purity, dynasty reset, leaks, SW, errors),
  and an accessibility auditor (keyboard, screen reader, contrast/colour-blind, motion, touch →
  `screenshots/a11y/`). Features engineer building **Keepsakes** (DESIGN §5.9: Chronicle + Tapestry PNG export,
  `docs/briefs/keepsakes-hookup.md`). Balance still on battle length + corridor cap. Integration on standby.

- **Balance battle-length round DONE** (~22:30, 798/798): tier 1 42 s, tier 2 112 s (was ~245), mid 137 s, capital 204 s
  (campaign pooled 1m25/2m17/3m24); tutorial 60.6 s; D1 1.46 h, D2 1.29×, D3 1.39×; labels Easy 96/Fair 60/Hard 37;
  Stables cavalry charge (+25 % field strength/level, III ×1.06); corridors ≤ 3 tiles, no connectors. Lead: adopt
  config A (mid/capital accepted; capital design fix stays on the backlog); split the tier-1/tier-2 Swift par (last small item).

- Swift par split DONE (~23:00): tier1 43 s / tier2 114 s / mid 136 / capital 207 / deep 164 (only 7 samples) → Swift
  49-51 % per band, overall 50 %; Unbroken 70 %. 826/827 (the generateWorld timing flake). Balance engineer idle.

- **A11y audit DONE** (~01:00): blockers: no keyboard path for world/battle, unnamed battle controls and settings
  switches, no dialog focus management; major: no live regions, shortcuts leak through dialogs, Reduce Motion ignores the
  OS and misses camera/clouds/pulses, colour-only send arrow, contrast, azure≈violet for deut/prot. Lead wrote DESIGN
  §7.5a and sent integration an a11y round (Tier A semantics/dialogs/live/motion/contrast/targets; Tier B keyboard
  Regions panel + map/battle cursors, shape-coded arrow, colour-blind-safe factions, 12 px floor, SFX slider, 0.5×).

- **Bug-hunt audit DONE** (~01:30): HIGH: Attack on unbuildable (mountain-border) regions soft-locks (20 % of states); stale
  welcome/prosperity survive New Realm (negative gold); two tabs clobber the save; MEDIUM: unresumable battle bricks Continue;
  sw.js deletes OTHER apps' caches on the shared ka1e27.github.io origin (+5xx/captive-portal/timeout); weak save
  sanitisation; LOW: silent save failures, null getContext, formatters, clock-back prosperity re-celebrations. Clean:
  purity, determinism (world/battle/replay), dynasty reset, leaks, time gaps, prototype pollution. Routed: balance
  (canBuildArena + arena fallback, monotonic prosperity, core formatters); integration (robustness round between a11y
  Tier A and Tier B: try/catch scene entry, pending epochs, multi-tab saveSeq + banner, battle schema validation, SW fixes,
  sanitisation, save-fail toast, getContext fallback).

- **Keepsakes DONE** (~02:30): chronicle (chronicleState leaf + chronicle.js, 10 kinds, caps 40/60), chroniclePanel, tapestry
  (composeTapestry + worldImage.renderWorldImage + saveTapestry + saveMapButton), 68 tests, keepsakes-check 93/93, hookup doc.
  Lead: confirmed year/events; Tapestry numerals in Nunito lining, desktop width ~700 (~2.9 MB); phone Realm 2-col stats.
  Integration queue: a11y Tier A → robustness → Keepsakes hookup → a11y Tier B.

- Keepsakes tweaks DONE (~03:00): Nunito lining numerals, tapestryWidth desktop 700 (2.9 MB) / phone 600 (2.3 MB), phone
  2-col Realm CSS specified in hookup §8. The features engineer is finished.

- All three hit the usage limit (~04:00); resumed 11:23 (2026-10-01). Suite 906/912 (balance's difficulty/arena work in flight).

- **Fresh-eyes playtest DONE** (~12:30): no blockers, 0 console errors. Major: the W2 hint covers its target region (the
  monitor checked only the label box), the phone W3 hint covers bounty/par, the landscape card overflows, Space after clicking
  Speed cycles speed, the power/strength bar misleads on Deadly. Lead (DESIGN §5.3 win-chance bar, §4.8 Swift countdown,
  §7.5a speed cycle + Slow battles setting): balance adds `winChance()`; integration queue = a11y Tier A → robustness →
  playtest fixes (14 items) → Keepsakes hookup → a11y Tier B. Noted for later: the early idle promise feels thin (income +2-4/s).

- **Balance robustness DONE** (~13:30, 920/920): canBuildArena/arenaBlockedReason/attackableFrontier; approach strips may cross
  mountain ridges (arena-only pass tiles, ≤3) → blocked states 20 %→6.7 % (0 throw mismatches over 145k arenas); card charges
  strips (approachPerTile 0.3); removed the leftover ensureConnected connectors (469 arenas); monotonic prosperity; core
  formatters guarded; winChance(ratio) exact at the label edges. Campaign unchanged (D1 1.42 h). APIs relayed to integration
  (+ draw mountain passes, tutorial picks among attackableFrontier, ui formatter guards).

- **Integration mega-round DONE** (~15:30): a11y Tier A+B (dialogs.js/live.js, Regions panel, map + battle keyboard cursors,
  keyboard-only full game, shape-coded arrow, new faction colours Free Folk #a19c92 / Crimson #c63932 / Violet #6d1b99 with an
  enforced CIEDE2000 test, SFX slider + M, 0.5× via Slow battles), robustness 1-9 (flow.js revert, attackable card, epochs,
  saveSeq multi-tab banner, plausibleBattle, SW hexdominion-only + 5xx/timeout/portal, sanitisation, getContext), playtest
  fixes 1-14, Keepsakes hookup. 933/933; check --base=temp, a11ycheck 152, iconcheck, galleries pass. DESIGN palette updated.
  Sent: mountain-pass proof, FORCED MARCH truncation at 1280, full hints.mjs rerun → then final QA (RC2).

- 2026-10-01 ~16:50: the user switched engineers to **Opus 5.5 (medium)** / lead does hard tasks. The Sonnet integration engineer hit the
  usage limit mid final QA (rc2-* gallery done, FORCED MARCH fix likely done). The final QA (RC2) was handed to a fresh
  **opus55-engineer**: mountain-pass proof, hints.mjs ×7, full regression, playtest through D2, docs/img + README, go/no-go.

- **Final QA (RC2) DONE** (~19:00, opus55-engineer): tests 933/933; check.mjs all sections + `--base=temp` pass; hints.mjs 7/7 viewports
  ALL HINTS PLACED; a11ycheck, iconcheck, works-check, keepsakes-check pass; playtest desktop+phone × seeds 7, 23 through Found a Dynasty and a
  D2 win. Fixed: phone "BULWA…" ellipsis (`.is-tight` + no phone tracking; check.mjs now asserts no power name overflows), the gold tutorial arrow
  drawn over the player's own green drag arrow (hidden while dragging), the unreadable active send-size key badge, the W2 hint pointing at a
  region whose label is off screen (coach hides it), the pass road now starts at the War Camp, README images retaken with the new faction
  colours (`tools/docshots.mjs`), README claims (S key, sliders, tools), a works-check timing flake, playtest bot (pans back, scrolls,
  drags only from visible settlements, logs drags that pan). Region 10 of seed 7 is NOT a pass target in the current world; the pass proof uses
  region 21 (Wrenglen). Open for the lead: toasts over open dialogs (phone Realm ×), phone hint bubbles over enemy keeps, the phone touch tooltip
  over the "Capture" word, the phone Found a Dynasty button below the fold, the W1 zoom can lose the W2 region, short-lived battle hints (1.5 s).
- **RC2 polish round DONE** (~21:00, opus55-engineer, lead's decisions A-F): toasts queue while a dialog is open (council/Save-the-map feedback inline, polite;
  hintMonitor fails a toast over a dialog); battle hints avoid enemy keeps (monitor rule proven to fail without the fix: 83 frames at 390x844); touch drag hides the
  canvas word under the tooltip; Dynasty section first when Found a Dynasty is available; Works nbsp; compact council effect lines; rc2shots phone Tapestry at
  600; W2 frames home + target when its region is off screen. **The edge-drag bug was real, not the edge**: an ARMED power made every drag a pan (canStartDrag),
  and on the phone the hint's x sat on the enemy keep and ate the Rally target tap; fixed (a drag from your settlement stands the power down and sends) + check.
  Pass roads now follow the routes squads take, each ending at a settlement's land with an arrowhead. Full regression green (see the engineer's report).

- **Opus RC2 QA DONE** (~18:30): GO with conditions; all checks pass (933 tests, check desktop/phone/playtest/robust/keepsakes,
  --base=temp 393, hints ×7, a11y 152, icons 25, works 48, keepsakes 93); mountain pass verified on seed 7 region 21; fixed
  phone BULWA… truncation, double tutorial arrow, unreadable key badge, hint pointing at the corner; README/docs/img refreshed.
  Lead decisions → a final polish round (same Opus agent): toasts queue while dialogs are open + inline dialog feedback, hints
  avoid settlements, touch hides the canvas outcome word, Dynasty first in phone Realm, small copy fixes, W2 reframes the camera,
  investigate the edge-drag pan bug, mountain-pass track matches the squad route.

- **RC2 polish DONE** (~19:30): the edge-drag stall was REAL — an armed power made every drag pan (Rally stuck armed because
  the hint × sat on the keep and ate the target tap); fixed (a drag from own site cancels the power and sends) + check. Toasts
  queue while dialogs are open + inline council/save status; hints avoid enemy keeps (monitor proven to catch it); touch
  hides the canvas word under the tooltip; Dynasty first in phone Realm; W2 camera framing; strip roads follow squad
  routes with arrowheads. 933/933, check desktop 183 / phone 180 / --base=temp 405, a11y 152, icons 25, hints ×7, galleries
  pass. **Committed 912572b and pushed `redesign` (2026-10-01).** Then, on the user's explicit request, `main` was
  fast-forwarded to a48e1d7 and **DEPLOYED** (Actions run 36956047792: verify + browser + /temp/ checks + deploy all green);
  https://ka1e27.github.io/temp/ serves v2 (sw cache hexdominion-v2-5), v1 at classic.html. Future merges to main still need
  explicit approval each time.

## PREVIOUS STATE (2026-09-30 ~10:15): release candidate, feature-complete
- All features are in the game: the core redesign, plus music, battle crowns, rival leader
  voices, scout/sabotage, the living map + prosperity, bold green/red drag arrow, the stuck
  hint, and the council "Best value" tag. World-gen fixes (no stray islets, thin beaches, lush
  starts) and the final balance calibration (waits-first pacing, dynasties ~1.3-1.4× longer) are
  in.
- Verified: `npm test` 646/646; `node tools/check.mjs` and `node tools/check.mjs --base=temp` pass
  (Pages subpath, SW scope, offline reload, manifest, classic.html); the shots tour has 0 page
  errors; four real-input playtests from the tutorial into dynasty 2. Final gallery:
  `screenshots/game/rc-*.png`.
- All engineers are finished. **Committed locally** as `6bbcdc4` on `redesign` (2026-09-30, user approved;
  one-off identity Claude <noreply@anthropic.com>, matching repo history; nothing pushed).
  **Open decision for the user:** publishing = merging to `main`, which deploys
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
Since 2026-10-01 the user wants delegated engineers on **Opus 5.5 at medium effort**, and the lead does
harder or judgment-heavy tasks directly. Use `subagent_type: opus55-engineer` (defined in
`C:UserskylegProjects.claudeagents` and this repo's `.claude/agents/`; loads only at session start).
In a session started before that file existed, use a general-purpose agent with `model: "opus"`.
Sonnet 5.5 (`sonnet55-engineer`) is no longer preferred.
- **Phase 12 DONE** (integration, uncommitted on 9a98333): archipelago rendering (turquoise shallows with shoals, piers, dotted lanes),
  longboats and wading, Sea Kings #3eefd8 / #11786c / #effffb (closest CVD pair 17.5 against the 15 bar), the Tide telegraph and flood with merged
  pops, the Admiral (bicorne) + Broadside, the Shipwreck toast, hint S1, a Codex group "The sea"; perf within budget (archipelago
  pan 17.7/21.2 ms, Tide fight 18.2/25.3 ms). Snapshot scratchpad/p12snap (93 files on 9a98333) PASSED the full gate (npm 1217, full check.mjs, --base=temp). **Committed b2d3faa and pushed to redesign +
  main** at the user's "deploy Phase 12" (2026-10-06); the main tree was reset onto it with the Phase 13 WIP kept. **LIVE** (Pages run passed first time).
- **2026-10-06 PHASE 13 "The Crown of Ages" STARTED** (docs/PLAN-PHASE13.md): a final continent from D7 (all rival kinds + the
  Usurper), the 3-phase Throne of Ages boss, an ending (cinematic, the Chronicle of your reign, credits, a title Crown), Ascension 1-10.
  Sim/meta + integration engineers.
- **Sim/meta Phase 13 DONE** (npm 1230): world/crown.js (30-34 regions, 2 classic + Ashen + a Sea Kings island coast + the Usurper
  at the centre), FACTIONS[7] usurper, throneArena.js/throne.js (3 phases; the keep warded until 3 borrows), the ending (result.crowned,
  generals.crowned, endingRecord), Ascension 1-10 folded into edictMods. 87 existing worlds byte-identical (tools/_p13digest.mjs). Throne:
  12/14 won, median 8.3 min, 2 timeouts; Crown continent 1.56x a D7. The Throne card reads a little harder than it plays (86 % won at
  Fair; accepted for a finale). Watch: two seeds have very long late-game continents (pre-existing in D7).
- **Integration Phase 13 DONE** (uncommitted on b2d3faa): the ceremony final choice + Ascension picker, the Usurper #650824/#33020f/#f2c4cf
  (closest CVD 19.0), Throne visuals (battleThrone.js, throneFx.js), the ending (ui/ending.js, lazy: tour, Chronicle scroll, credits;
  skippable), title Crown, Ascension ladder, hints U1/U2, Codex group. The gate is green in 18 groups + --base=temp; perf frames noisy on a
  busy machine (the A/B against HEAD shows no regression). Lead fixes requested: plural "1 rival capitals", a garbled Usurper Chronicle
  line, the recap showing the archipelago line when the Crown is chosen. Also this session: tools/cdp.js now launches Chrome with
  --mute-audio (the user heard the game music from headless checks).
  Lead fixed the Chronicle article bug in pure code (chronicleText strips a leading "The " inside {rival} and after "the {faction}"), with a
  test over every template with the Usurper as rival. Integration: proper plurals on the scroll; radio marks on the final-choice cards.
- **Phase 13 READY TO DEPLOY:** snapshot scratchpad/p13snap (83 files on b2d3faa) passed the full gate (npm 1231, full check.mjs,
  --base=temp). Perf A/B against live b2d3faa, back to back under the same load: Phase 13 equal or faster on every frame row.
- **2026-10-06 PHASE 14 STARTED** (docs/PLAN-PHASE14.md): 14A late-game pacing (a human policy for D1-D7 + the Crown; D2-D7 medians <= 2 h,
  no wait > 60 min, Crown <= 2.5 h, Ascension A1 <= A0 + 15 %) and 14B options (colour-vision presets with CIEDE2000 >= 25 per
  preset + pattern overlay, text size, high contrast, Effects slider, rebindable keys, hold-to-confirm, audio sliders + mute when hidden).
- **Phase 14A DONE** (uncommitted, npm 1244): the late walls were mostly the bot (battle/bot.js: supply-line actions blocked its attack plan;
  supply squads counted toward its 14-squad limit; it also drives Quick Conquest), plus patience scaling 7x by D7 (PATIENCE_MAX_SEC 600),
  the Throne card (factor 0.35 -> 0.25) and Holy Ground garrisons starting far above cap (FEATURES.holy.startCap 2). Human: D5 2.02 -> 1.50 h,
  D7 2.14 -> 1.61 h (worst wait 662 -> 24 min), Crown 4.03 -> 1.78 h; A1 +1-4 % over A0. D1 human pace unchanged. Later: a label
  calibration pass (late Hard fights play easier than they read; Holy Ground Easy reads optimistic).
- **Phase 14B DONE** (uncommitted): device-local options (app/options.js, key hexdominion.options.v1): colour-vision presets
  (config/palettes.js; deutan/protan 27.5, tritan 28.0 min CIEDE2000; Default unchanged at 24.1 normal) + territory patterns, text size
  100/112.5/125 %, high contrast, an Effects slider, a rebindable keymap with swap-on-conflict, hold-to-confirm (opt-in), Voices volume +
  voiceSfx murmur, mute when hidden. --only=options; gate green in groups; perf within budget. Snapshot scratchpad/p14snap (117 files on
  b2d3faa: Phases 13 + 14) PASSED the full gate (npm 1244, full check.mjs, --base=temp) and perf (title 2.4 s, map 4.0 s, meta 0.50 ms,
  save 6.5 KB, no row over budget). **Committed 4974809 and pushed to redesign + main** at the user's "deploy
  Phase 13 and 14" (2026-10-07). **LIVE** (Pages run passed first time). Later: audit Large text on the Realm/Generals/ceremony panels.
- **2026-10-07 PHASE 15 STARTED** (docs/PLAN-PHASE15.md): 15A label calibration (tools/labelAudit.mjs across dynasties, Ascension,
  personalities, twists and types; fix the card, not the fights; a fast guard in npm test) and 15B robustness (every check section at
  --cpu=4/6, real UX bugs fixed; Large/Larger text audit of every panel at 360/390 px; a generic "nothing moves under the pointer"
  guard in hintMonitor).
- **Phase 15A DONE (follow-ups running)** (npm 1252): calibrateRatio() in progression.js (factor x raw^exponent per dynasty, Crown,
  Ascension, personality, twist, type, tier; a Holy Ground ceiling 1.25); surrender still reads the raw ratio; challenges keep the raw
  card. tools/labelAudit.mjs (probe fights, 49-59k per run): off-target cells 117 -> 0 of 157. The pacing drift stays within targets
  (D1 first hour 27.5 battles, 97 %, 2.1 min idle; no wait > 60). Follow-ups: the Penhold fight bug (War Camp crushed at every ratio),
  Boons at the end of D1 and the Quick Conquest share after calibration. Lead renamed the tests to balance.audit.test.js +
  balance.auditTable.test.js.
  Follow-ups done (npm 1253): Penhold was a strip that was too long (a village behind the keep's land; softBeforeKeep opened strips <= 3
  tiles) -> BATTLE.corridorMaxTilesLastResort 6 (1.7 % of arenas), test battle.penhold.test.js. Boons at the end of D1: bot 11 / human
  15.5 (in band). The Quick Conquest-eligible share rose (human 41 -> 53 %), but real use is 0 (the node is never bought). Still 0/157 off.
  Later: 7 deep Holy Ground/Blizzard groups never won at raw >= 1.5 (few probes; tools/_p15walls.mjs).
- **Phase 15B DONE** (uncommitted): two real bugs fixed: (1) toasts moved under a press when a banner or new toast arrived (Decline slid
  84-124 px; toasts.js pressHeld + a held leader line), (2) the battle tray threw on a broken saved battle. textAuditChecks (--only=textaudit,
  506 checks, Large/Larger at 360/390 px; council/goals/options CSS fixes), a layout-shift guard injected into every check section,
  settledCentre aiming. The gate is green at normal speed, --cpu=4 for all 19 sections, --cpu=6 for phone. Lead fixes: adaptive music
  lookahead (music.js; at most 0.5 s; manual ticks unchanged) and a Page.navigate timeout of 45 s in tools/cdp.js. Snapshot
  scratchpad/p15snap: npm 1253, --base=temp ok; the full check.mjs hit its own 32-min overall timeout (now 60 min: the suite takes ~32 min,
  CI ~30) and then had one racy phase13 phone check (the HUD line read during a Plague borrow; it now waits for the Usurper line), which
  passed 2/2. **Committed d388c0b and pushed to redesign + main** at the user's "deploy Phase 15" (2026-10-08).
- **Phase 15 deploy BLOCKED by CI** (good catch by the new guard): phase13 phone, results-card Continue moved 9.4 px under a press (the
  0.85 -> 1 scale pop). Fix (uncommitted): entrance animations of pressable panels fade only. results-card fades and the punch moves to
  the non-pressable banner; modal-pop, ceremony-rise and vendetta-in are fade-only; the reduce-motion list is updated. Verifying the
  full gate + phase13 at --cpu=4 on the tree; the site is still at 4974809.
- **2026-10-08 fixes after the user report** (on d388c0b): the War Council layout (long effect values wrap as text with the arrow
  attached, never under the Buy button; the Best value pointer on two lines; Buy Max on one line and wrapping on 360 px); buttons that
  moved under a tap (the results card, every dialog, the ceremony, the Vendetta toast and the Welcome-back card now fade instead of
  scale/slide; the ending scroll has a fixed height so Continue stays put; the HUD gold/income use tabular digits). Full gate green
  (npm 1253, check.mjs 32 min, --base=temp). The user's "powers don't work in Dynasty II" is not reproduced on a fresh realm: waiting
  for their save code or a description.
- **651e72a pushed, CI failed the same check** (results Continue 9.4 px on phase13 phone). Real cause found with a per-frame probe: the
  crown row's "+25%" tag was `display: none` until each crown landed (~440 ms after the card shows), so the centred card grew and Continue
  dropped 8.6 px. The tag's line is now held from the start (`.crown-bonus.is-pending { visibility: hidden }`): 0 px over 4 s.
- **The powers report, most likely Iron Will** ("powers don't work, my General does, they all show locked" = the Challenge's exact rule).
  Fixes: the War Council's Powers tab says "Iron Will is on..." and sells no power (the Buy button is a lock reading "Iron Will"; onBuy
  refuses too); a refused power says "Iron Will, your founding Challenge: no powers until your next founding. Your General's ability still
  works." for 4.5 s; refusals (`toast.now`) no longer wait 3 s behind a leader's banner on a phone. A phase5 check covers the council.
- **Phase 15 LIVE at 5f60a7c** (2026-10-08; CI green: verify, browser, deploy).
- **Phase 16 (Clear menus, clear rules) built** at the user's "continue working" (docs/PLAN-PHASE16.md):
  - the War Council shows only what changes ("+0% → +3% troop growth", effectDiff + unit test); desktop panel 480 px; one-line price buttons
  - an "Iron Will · no powers this dynasty" / "Holy Ground · no powers here" caption across a fully locked power bar
  - defeat tips never advise a power you can't use
  - a green ▲ on frontier chips a purchase made easier, with a toast
  - Verified by probes and screenshots; options, textaudit and phase5 green, npm 1255. Gate (snapshot p16snap): npm 1255; full check.mjs green except one stale check (the Treasury line read the old "2 h offline cap" text: it now reads
    the effect line's label + the shown number) -> desktop + phone rerun green, --base=temp green. The gate also caught a real bug: base.css
    `:where(#ui *) { pointer-events: auto }` made the power-bar caption's words swallow taps (textaudit "covered"); `.power-rule *` lets them
    through now. Ready to deploy; waits for "deploy Phase 16".
