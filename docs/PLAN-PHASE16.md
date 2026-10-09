# Phase 16: Clear menus, clear rules

Status: **built, 2026-10-08.** Lead: the Claude session (small enough to do without engineers).

**Why this phase.** The user's first reports from playing the second continent:
- "the abilities don't work" (it was the Iron Will Challenge they had ticked at the founding)
- "fix the ui on the buy menus"

Both say the same thing: a rule or a number the player can't read. Phase 16 makes the spend screens and the rules readable where they matter, and shows what an upgrade bought.

## 16A. The War Council reads at a glance
- **Only what changes.** "current → next" writes the words both values share once:
  - "+0% troop growth → +3% troop growth" becomes "+0% → +3% troop growth"
  - "Send 50% from every settlement · 30s cooldown → Send 50% from every settlement · 28.5s cooldown" becomes "Send 50% from every settlement · 30s → 28.5s cooldown"

  This is `effectDiff` in council.js, unit-tested. It replaces the measured "compact" mode, which stopped working once the line wrapped as text in Phase 15. A screen reader still hears both whole values.
- **A wider desktop panel.** It is 480 px instead of 420, so the tabs, the Best value pointer and Buy Max share one row on every tab. Before, Buy Max jumped to a second row on the Powers tab.
- **Price buttons.** The price sits on one line beside its coin ("🪙 33"). This makes a shorter, narrower button with a readable coin. Unlock and Iron Will keep their stacked form.
- **Phone.** Slimmer cards. The Best value tag drops under the name instead of running under the Buy button.

## 16B. Rules where they bite
- **Iron Will in the council:**
  - The Powers tab says Iron Will is on.
  - Every power's button is a lock reading "Iron Will", and powers can't be bought.
  - (Shipped in the Phase 15 deploy, 5f60a7c.)
- **The battle bar** says why every power is locked before any press: "Iron Will · no powers this dynasty" or "Holy Ground · no powers here". The caption sits across the bar, takes no room and lets presses through.
- **Defeat tips** never name a power the player can't use:
  - Under Iron Will, the fort tip no longer advises Firestorm.
  - Under Holy Ground, or with a power not unlocked, the "use Rally" tip falls back to advice that needs no power.

## 16C. Upgrades made visible
- **Map marks.** When a War Council purchase makes a frontier region's label easier (with the card's commander credited, as the map reads), its chip gets a green ▲.
- **The message.** A toast says "▲ Corworth is easier now" (or "and N more"). It is posted at once and shown when the council closes.
- **Duration.** The marks last while the council is open and 20 s after it closes. This closes the loop the user called boring ("fight, then upgrade"): the upgrade's effect shows on the map.

## QA (one pass, the deploy gate)
- `npm test`
- the full `node tools/check.mjs`
- `node tools/check.mjs --base=temp`
