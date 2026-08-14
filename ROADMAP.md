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

**Siege binds again.** `SIEGE_FRONTAGE` caps how much structure damage ordinary bodies
can do at one wall and exempts engines, which closes the oldest measured defect in the
file — "`breachSeconds` stopped binding around region 8" — and makes rams a purchase
rather than a tax on your slots. It cost a four-number re-tune, no more. It did *not*
fix the loadout problem below, and the section says exactly how the measurement of that
nearly went wrong.

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

Re-measured against the finished battle layer, the closed re-tune and the siege
frontage, n=48, matched seeds:

| region | default | **no rams** | militia only |
|---|---|---|---|
| kaldan (tier 2) | 75% | 75% | 83% |
| gallowmoor (tier 3) | 60% | **85%** | **96%**, a 6.5-minute region won in 3.2 |
| thanescar (tier 4) | 46% | **71%** | **94%** |
| ravensmarch (tier 5) | 33% | **63%** | **94%** |
| widowsgate (tier 6, the incursion arena) | 29% | **52%** | **92%** |

**The cheapest half of the exploit is one click: don't bring rams.** That alone is +23 to
+30 points past kaldan, for free. The full mono-militia version is +36 to +63, and it
does not merely win more often — it deletes the battle, finishing in half the advertised
time. It gets *wider* as the campaign gets harder, so the part of the game meant to be a
wall is the part it trivialises most. Kaldan is the control at +0/+8: this is a
late-campaign hole. Pinned by `tests/loadoutdominance.test.js`.

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

**Siege scarcity was the standing prime suspect. It has now been built, and it is
spent.** `SIEGE_FRONTAGE` caps how much structure damage ordinary bodies can do at one
wall (engines exempt), which fixed `breachSeconds` outright and re-priced rams by a
factor of twelve — a crowd now does 24 structure dps against the default spread's 276.
The mono gap did not move: +8 / +36 / +61 / +63 on the four rows the re-tune left alone,
against a pre-frontage +10 / +40 / +65 / +67. **A change that removed siege from the
question entirely moved nothing**, which is a far stronger statement than the fix would
have been: whatever mono-militia wins with, it is field power and tempo, full stop.

**And the measurement nearly said the opposite — read this before trusting the next
one.** The first pass looked like the frontage closed the exploit at tier 6 (widowsgate
mono 94% → 25%). It had not: `simtactics.js` walks away from any siege over 90 seconds, a
rule that had never bound at a castle because a crowd used to break any throne in about
five, and the frontage put widowsgate's throne at 128s — so the bot stopped assaulting it
at all and timed out **35 sites ahead** with the region won everywhere but the gate.
Teaching it to commit put mono back at 92%. A harness that declines to play is the same
defect as one that cannot, and this one broke *toward the result somebody wanted*.
`--nothrone` and `tests/throne.test.js` keep the delta re-takeable.

**And the CONCENTRATION lever — the one this file ranked top — is spent as well, because
its premise is measurably false.** "Scale `battle/aiadapt.js` `counterShare` by how
dominant the dominant unit is" was ranked first for one property: it would bite a mono
army and leave the default spread untouched *by construction*, so it could ship without
re-tuning 24 regions. Read straight off the enemy's own `learnedPlayerComp`:

```
share of the player's army that is MILITIA, as the enemy sees it
               t=1m   t=2m   t=5m
default        80%    95%    95%
mono militia   99%    99%    99%
```

**Both loadouts are the same army by minute two.** The 46% this file used to quote is the
LANDING FORCE, which the enemy never sees as such — the player captures yards and trains
militia in them. A dominance-scaled share sees 95% against 99%. Built anyway in its
strongest form (share → 1.0 above 98% dominance *and* the spear backbone released, which
breaks a pinned invariant): gaps +36/+38/+61 → +36/+33/+57, noise, and the default spread
paid for it. Reverted.

**That retires a class, not a knob: nothing keyed on what the player FIELDS can work**,
because the two armies are identical from two minutes in. The gap is created entirely in
the opening, by the landing force. Which is where the next candidate has to act — and
there is one nobody has tried: **`UNIT_SLOTS.rams` is 5, and nothing re-priced it when the
frontage made a ram worth twelve times a body at a wall.** What a ram *does* was
re-priced; what it *costs* was not. That is a one-number change to the exact place the two
armies differ, and it needs its own measurement.

**Five things NOT to try, because they have been built and measured.** Two militia nerfs
(both *widen* the gap — the mixed army sits on the steep part of the win curve and the
mono army on its flat top). A per-type slot-share cap (69%/56%, default spread
byte-identical, reverted — it contradicts the `carryComposition` contract ten tests
encode). **Share-scaled march speed**: replacing `slowestSpeed`'s hard `Math.min` with the
slot-weighted harmonic mean makes the default spread 1.6× faster and provably cannot help
a one-type army — it bought a net **+1 point** across five regions and left the gap
fractionally wider, which is what says the ram's cost is entirely its SLOTS. Siege
scarcity, above. And the concentration counter-pick. Anything proposed next should say
which of those shapes it is not, before it is built.

---

## Near-term — each is one file or one flag

**1. Give `stronghold` and `watchtower` a harness policy, off by default.**
`tools/simbuild.js constructTurn` picks a kind on one rule — a yard while it holds fewer
than three, a farm after that — and never builds a wall or a tower at all. By this
project's own repeatedly-paid-for standard ("a mechanic the harness cannot play is a
mechanic nobody has measured"), two of four buildable kinds are unmeasured *today*. Ship
it behind a flag next to `--noupgrades` / `--noconstruct` / `--noscout` / `--nothrone` so
the delta stays re-takeable, exactly as `upgradeTurn` and `scoutTurn` did. Related and
already recorded: the bot builds farms while it is losing — seven raised and seven razed
on a run it lost. The frontage pass is the freshest argument for ranking this at all: a
bot that declines a mechanic reads exactly like a mechanic that works.

**2. `counterShare` is a difficulty ladder that mostly cannot be climbed — decide
whether that is wanted.** The yard/wall split moved counter-training's pool from every
stronghold to `trainingGround` only, which instruments at **one or two buildings**
mid-campaign, and `adapt` reserves a spear backbone before either share spends anything.
So at gallowmoor `counterShare` 0.20 and 1.00 buy the identical single yard. Re-measured
with it off at every tier (n=48): gallowmoor 60→65, karrowmere 60→63, ravensmarch 33→40 —
five to seven points, where `ai.data.js` still records the +17/+32 it was worth before the
split. The comment is corrected; the ladder is not. The honest lever is the enemy's YARD
COUNT (`mapgen.js fortsAmong`), not this share, and moving it re-tunes tiers 3–6 — so
this is a balance pass to schedule, not a bug. Ranked here because a tier priced against
a knob that does nothing is how difficulty ends up somewhere nobody put it.

**3. Calibrate `split`, or record that it cannot be.** The campaign re-tune found the
silhouettes were never calibrated against each other: grouped by shape against the middle
of each region's own band, `branch` ran −11 and `split` a startlingly uniform −6 (all
three regions), while `open` and `choke` sat near zero. `branchTrunk` 0.50 → 0.62 fixed
the branch regions. **`split` has no `SQUEEZE` knob at all**, so its −6 is currently an
open observation. Either give it one or write down why it should not have one.

**4. Pull the incursion mutator onset forward — but check it is worth it first.**
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
abdication, and until recently **no screen showed a single one of them.**

**That half is DONE**: `meta/record.js` derives and `screens/mainmenu-record.js` renders,
behind a Record button on the menu. The derived figures are the reason to open it — win
rate, kill/loss ratio, and how much of the elapsed time was credited while away, which is
the idle half of the game made visible. Pure UI, zero balance risk, and the arithmetic is
a module so it is tested rather than squinted at.

**The next step is MILESTONES**, and it is now cheap for the same reason: a small, fixed,
non-random set of named achievements over counters that already exist *and are already
displayed*. It is the standard answer to "why open this again tomorrow" for a game with
no server, no accounts and no live-ops, and it costs no balance work at all. The record
drawer is where they would live, and `recordView` is already the one place that knows
what every figure means.

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
node tools/simrunner.js --region=widowsgate --n=48 --nothrone   # the bot that won't commit
npm start & node tools/smoke.mjs                 # real pointer events, hit-tested
node tools/mobile.mjs && node tools/mobile.mjs --w=844 --h=390
```

`n=12` is far too noisy to tune on and has hidden real mis-tunes three separate times.
Tune at n≥96 and confirm within ~8 points of a band edge at n=240.
