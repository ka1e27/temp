# Hex Dominion — what to build next, and why

**This file is the ORDERING. `CLAUDE.md` is the inventory.** Every defect, measurement
and scar lives there under "Still open, and why"; this file says which of them to spend
the next session on and what each one costs. When the two disagree, CLAUDE.md is right —
it is the one maintained in the same commit as the code.

Nothing here is a wish. Every claim is either measured (with the command to re-take it)
or explicitly flagged as an opinion.

---

## Where the game actually stands

**The engine is finished and the measurement culture is the real asset.** Deterministic
combat with an honest pre-commit preview, fog of war, free movement, in-battle
construction, a yard/wall split, an AI with a belief model, an idle layer that pays out
absences, three endgame loops — and ~80 test files plus a headless harness that can play
any region, loadout, tier of idling, legacy or relic budget. Six previously-inert
features and four sold-but-dead upgrades were found *by measurement* rather than by a
bug report. That is unusual and it is what makes everything below tractable.

**The campaign is tuned, for the second time, against the finished battle layer.** It was
deliberately left untuned through the redesign — tuning between two structural changes is
work thrown away — and then re-tuned end to end once free movement, the yard/wall split,
construction, towers, the slower march, fog, squad sight and the site-existence gate had
all landed. Every `enemyMult` and every advertised length moved; the method and the four
transferable findings are in `CLAUDE.md` (`Still open` → the closed re-tune entry).

The one thing to carry forward: **the table describes a bot that earns no relics, idles
far less than a real player, brings the default four-type spread, and still knows where
every enemy building is.** Each of those gaps is now a flag away from being measured
(`--relics`, `--idle`, `--weights`), and the last one is new — see the site-existence
note in `CLAUDE.md`'s fog section.

**What is missing is not content. It is a REASON TO KEEP DECIDING.** The moment-to-moment
tactics of a battle stay rich for a long time — fog, sieges, rally timing, relief forces,
where to build. The layer *around* each battle has one right answer, and once found it
stays right to the last battle in the game.

---

## The one problem worth ranking above everything else

### The loadout has a dominant answer, and it scales with difficulty

Re-measured against the finished battle layer and the closed re-tune, n=48, matched
seeds:

| region | default | **no rams** | militia only |
|---|---|---|---|
| kaldan (tier 2) | 75% | 75% | 85% |
| gallowmoor (tier 3) | 58% | **81%** | **98%**, a 6.5-minute region won in 2.4 |
| thanescar (tier 4) | 58% | **85%** | **94%** |
| ravensmarch (tier 5) | 29% | **58%** | **94%** |
| widowsgate (tier 6, the incursion arena) | 27% | **65%** | **94%** |

**The cheapest half of the exploit is one click: don't bring rams.** That alone is +23 to
+38 points past kaldan, for free. The full mono-militia version is +36 to +67, and it
does not merely win more often — it deletes the battle, finishing in a third of the
advertised time. It gets *wider* as the campaign gets harder, so the part of the game
meant to be a wall is the part it trivialises most. Kaldan is the control at +0/+10:
this is a late-campaign hole. Pinned by `tests/loadoutdominance.test.js`.

**This is the reason the specialists, the relic troop lines, and most of the strategic
layer are dead content.** Nobody re-opens a screen that already wins everything.

**The obvious fix is measured to make it worse.** Three probes (gallowmoor, n=24, matched
seeds), default → mono, and the gap between them:

```
baseline                       54% -> 100%   gap 46
counters.spearmen 0.75 -> 0    29% ->  83%   gap 54
atk 4->3 and def 3->2.25       38% ->  88%   gap 50
```

Every nerf widens the gap, because the mixed army sits on the steep part of the win curve
and the mono army on its flat top. A militia re-tune costs a full campaign sweep and
leaves the game worse in both directions.

**The mechanism is tempo.** One slot budget buys 471 militia or 240 mixed bodies, 32%
more field power, at *equal* siege output — the spread's 23 rams make 276 siege DPS and
471 militia make 283. Rams buy siege the militia already had for a third of the field.

**So the lever has to read CONCENTRATION, not the unit.** Two candidates, both cheap
relative to a re-tune, both needing their own measurement:

1. **Make the enemy's counter-pick scale with dominance.** `battle/aiadapt.js` already
   picks the counter to the player's `argmax` unit and retrains a share of its yards —
   the mechanic is built, unfogged, and well reasoned. It is insensitive to concentration:
   it answers a 46%-militia army and a 98%-militia army with the identical share of
   production. Scaling `counterShare` by how dominant the dominant unit is would bite a
   mono army hard and leave the default spread near-untouched *by construction*, which is
   the property that lets it ship without re-tuning 24 regions. **Verify the premise
   first**: measured against mono-militia the enemy is down to zero training grounds by
   t=3min, so the adaptation may simply be arriving too late to matter, in which case the
   knob is onset rather than share.
2. **Give siege a scarcity headcount cannot buy.** This is the same finding as
   "`breachSeconds` stopped binding around region 8" from the other end, and fixing one
   fixes both. Rams are 4× militia's siege per slot and the default spread still spends
   so few slots on them that the two armies come out level.

**Two things NOT to try, because they have now been built and measured.** A per-type
slot-share cap (69%/56%, default spread byte-identical, reverted — it contradicts the
`carryComposition` contract ten tests encode). And **share-scaled march speed**: replacing
`slowestSpeed`'s hard `Math.min` with the slot-weighted harmonic mean, which makes the
default spread 1.6× faster and provably cannot help a one-type army. It bought the
default spread a net **+1 point** across five regions and left the gap fractionally
wider. That result is worth more than the fix would have been — it says the ram's cost is
entirely its SLOTS, so option 2 above (siege scarcity) is the live suspect and option 1
is the cheap one. Four rejected fixes now: two militia nerfs, the slot cap, and speed.
Anything proposed next should say which of those four shapes it is not, before it is
built.

---

## Near-term — each is one file or one flag

**1. Give `stronghold` and `watchtower` a harness policy, off by default.**
`tools/simbuild.js constructTurn` picks a kind on one rule — a yard while it holds fewer
than three, a farm after that — and never builds a wall or a tower at all. By this
project's own repeatedly-paid-for standard ("a mechanic the harness cannot play is a
mechanic nobody has measured"), two of four buildable kinds are unmeasured *today*. Ship
it behind a flag next to `--noupgrades` / `--noconstruct` / `--noscout` so the delta stays
re-takeable, exactly as `upgradeTurn` and `scoutTurn` did. Related and already recorded:
the bot builds farms while it is losing — seven raised and seven razed on a run it lost.

**2. Calibrate `split`, or record that it cannot be.** The campaign re-tune found the
silhouettes were never calibrated against each other: grouped by shape against the middle
of each region's own band, `branch` ran −11 and `split` a startlingly uniform −6 (all
three regions), while `open` and `choke` sat near zero. `branchTrunk` 0.50 → 0.62 fixed
the branch regions. **`split` has no `SQUEEZE` knob at all**, so its −6 is currently an
open observation. Either give it one or write down why it should not have one.

**3. Pull the incursion mutator onset forward — but check it is worth it first.**
`mutatorsAt: [3, 9, 18]` means depths 1–2 draw none, so the first rungs of the endless
ladder are dial-only reruns of one map. Cheap to change (`content/incursion.data.js` is
pure data and fully harness-playable via `--incursion=`), and cheap to measure. Ranked
low deliberately: it is two rungs out of an infinite ladder, and the player is past them
in five minutes. Measure the payoff before spending the re-sweep.

---

## What a game like this needs to hold someone for twenty hours

Three things, in the order they bite. The first is above; these are the other two.

### A visible long-term goal structure — and the data is already being collected

`meta.stats` tracks **thirteen lifetime counters** — battles, wins, losses, raids,
incursion rungs, units lost and killed, crowns and relics earned and spent, time played,
and time claimed while away. They are written on every battle and carried through
abdication. **No screen in the game shows a single one of them.**

For an idle/strategy hybrid that is a real gap, not a nicety: "numbers that go up, which
you can look at" is the genre's core retention loop, and this game collects the numbers
and hides them. The cheapest version is a lifetime-record drawer on the main menu
following `mainmenu-legacy.js` / `mainmenu-settings.js` — pure UI, zero balance risk. The
derived figures are worth more than the raw counters: win rate, kill/loss ratio, and the
share of all income collected while away, which is the idle half of the game made visible.

Beyond that, the honest next step is **milestones** — a small, fixed, non-random set of
named achievements over counters that already exist. It is the standard answer to "why
open this again tomorrow" for a game with no server, no accounts and no live-ops, and it
costs no balance work at all.

### Sessions you can actually fit into a day

A battle is 7–15 undistracted minutes, and passive play loses on purpose (verified: a
Riverfen battle with zero input is down to two sites inside two minutes). That is
*correct* — it is what stops the idle half being used to skip the real-time half, which
is the whole differentiator. But it means the repeatable unit of play is one full sitting.

Half of this was already built and simply unadvertised, and is now fixed: the battle
autosaves every four seconds and resumes for twelve hours, so closing the tab costs
nothing — but Withdraw was the only *labelled* exit and it gives up the region. The
control now says so.

What is still open is the shape of a short session. There is currently nothing to do in
ninety seconds except collect idle income and buy an upgrade. A raid is a whole battle; an
incursion rung is a whole battle. **This is the least-explored axis in the design and the
one most likely to decide whether someone plays for twenty hours or five.** It does not
obviously need a new mechanic — the shop, the loadout screen and the world map are all
places a two-minute visit could be made worth making.

---

## Explicitly rejected, with the reason

- **New units or regions**, for either problem. Content is not cheap here: a unit is a
  cliff and the dial is a slope, one castle promotion via `develop` is worth 25–40 points,
  and `enemyMult` is violently non-linear past tier 2. Every addition is a full re-tune.
- **Rotating the incursion ladder across regions.** Tried, measured, rejected: 63% vs 6%
  at the identical dial. Re-opening it needs a per-region ladder dial — nine binary
  searches.
- **Any randomness in combat, rewards or events.** Breaks invariant 3 and contradicts what
  every screen promises: the number on the tooltip is the number you get.
- **Multiplayer, leaderboards, accounts, monetisation, energy systems, push
  notifications, cosmetics, seasons.** All need a server this project deliberately does not
  have. The offline cap (8h base, 24h with Treasury) already creates a "check in about
  daily" cadence without any of them.
- **A second, deeper upgrade tree.** The inverse of work already done: 26 capped upgrades
  were collapsed into 6 endless lines *because* they were a wall of reading, six of them
  exact duplicates.

---

## How to verify anything in this file

```bash
npm run verify                                   # size + purity gates, full suite
node tools/simrunner.js --all --n=96             # the campaign; n=240 near a band edge
node tools/simrunner.js --incursion=1-30 --n=48  # the endless ladder
node tools/simrunner.js --region=gallowmoor --n=48 --weights=spearmen:0,raiders:0,rams:0
npm start & node tools/smoke.mjs                 # real pointer events, hit-tested
node tools/mobile.mjs && node tools/mobile.mjs --w=844 --h=390
```

`n=12` is far too noisy to tune on and has hidden real mis-tunes three separate times.
Tune at n≥96 and confirm within ~8 points of a band edge at n=240.
