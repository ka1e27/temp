// The world map's DETAIL PANEL: what one region says about itself, and the one
// button it offers.
//
// Split out of worldmap.js at the 400-line cap, along the seam the sibling
// files already use (worldmap-pan.js is the porthole, worldmap-autobattle.js is
// the raid's optional half) — that file owns the BOARD, its selection and the
// scene's lifecycle; this one owns the panel.
//
// It is a factory over injected dependencies rather than a set of imports of
// its own, for one reason: `h`, `clear` and `mount` must be the SAME ones the
// rest of the screen builds with, and the two pieces of scene state the panel
// writes — the current mode and the per-tick updater — belong to worldmap.js.
// Handing them in keeps this file unable to own state it should not.
import { UI, WORLD } from '../content/strings.js';
import { compact, rate, duration, percent } from '../ui/format.js';
import { modeOf, raidCooldownRemaining, campaignGap, CAMPAIGN_GAP_WARN } from '../meta/world.js';
import { previewReward } from '../meta/rewards.js';
import { GATE_CLAMP } from '../content/regions.data.js';

/**
 * @param {{dom:{h,clear,mount,bindText}, meta:()=>object, now:()=>number,
 *          launch:(id:string)=>void, autoResolve:()=>object|null,
 *          setMode:(m:string)=>void, setTick:(fn:?Function)=>void}} deps
 *   `autoResolve` is a GETTER, not the controller: it is rebuilt every
 *   `enter()`, so a reference captured once would go stale on the second visit
 *   to this screen.
 */
export function createDetailRenderer(deps) {
  const {
    dom: { h, clear, mount, bindText }, meta, now, launch, autoResolve, setMode, setTick,
  } = deps;

  return function renderDetail(detail, region) {
    clear(detail);
    setTick(null);
    const m = meta();
    const at = now();
    const detailMode = modeOf(m, region.id, at);
    setMode(detailMode);
    const reward = previewReward(m, region.id);
    const gateFrac = GATE_CLAMP(region.castleGateFrac ?? 0);

    const rows = [
      ['Tier', `${region.tier}`],
      ['Enemy strength', `x${region.enemyMult.toFixed(2)}`],
      ['Battlefield', `${region.grid.cols} x ${region.grid.rows}`],
      ['Enemy sites', `${region.siteCounts.enemy}`],
      ['Typical length', `~${region.targetLengthMin} min`],
      // THE NUMBER THAT DECIDES SEVERAL OF THESE BATTLES, AND IT WAS NEVER SHOWN.
      // `castleGateFrac` is the share of the countryside the throne holds out
      // for, and until now it appeared nowhere before the fight and, in the
      // fight, only inside the castle's own panel and only once the throne was
      // already under siege (`castleSealed` requires an active siege). So a
      // player correctly taking the countryside for twenty minutes had no way to
      // know whether they were two points short of the gate or forty-seven.
      // Measured: every one of thirty-seven timeouts in the castle-gate pass sat
      // below the gate. It leaks nothing — it is a static rule of the region,
      // like its size — and it is omitted rather than shown as 0%% where there is
      // no gate, because "0%%" reads as a requirement rather than as its absence.
      ...(gateFrac > 0 ? [['Throne holds until', `you hold ${percent(gateFrac)} of the map`]] : []),
      ['Income if taken', rate(region.rewardPerSec)],
    ];

    mount(detail,
      h('h2#wm-detail-h', { text: region.name }),
      h('p.wm-flavour', { text: region.flavour ?? '' }),
      h('dl.wm-stats', {}, ...rows.flatMap(([k, v]) => [
        h('dt.label', { text: k }), h('dd.num', { text: v }),
      ])));

    if (detailMode === 'locked') {
      mount(detail, h('p.wm-hint', { text: `${UI.locked}. ${WORLD.lockedHint}` }));
      return;
    }

    if (detailMode === 'attack') {
      // AHEAD OF THE CAMPAIGN'S OWN PACING — see meta/world.js `campaignGap`.
      // Told, not blocked: the region stays attackable, because a player who
      // wants a hard fight should get one. What was missing was any way to know.
      const gap = campaignGap(m, region.id);
      if (gap >= CAMPAIGN_GAP_WARN) {
        mount(detail, h('p.wm-hint.is-warn', { text: WORLD.aheadOfSchedule }));
      }
      mount(detail,
        h('p.wm-hint', {
          text: `${WORLD.rewardPermanent} ${rate(reward.incomeAdded)}.`,
        }),
        h('button.btn.primary.wm-go', {
          text: `${UI.attack} ${region.name}`, type: 'button',
          'aria-label': `Plan the invasion of ${region.name}`,
          on: { click: () => launch(region.id) },
        }));
      return;
    }

    if (detailMode === 'raid') {
      mount(detail,
        h('p.wm-hint', {
          text: `${UI.conquered}. ${WORLD.rewardLump} ${compact(reward.crowns)} crowns, once.`,
        }),
        // Short-session lever: offered wherever Raid is, and nowhere else.
        // The extras come from worldmap-autobattle.js rather than being
        // assembled here, so `canAutoResolve` is asked in exactly one place
        // and the button can never drift out of step with the rule that
        // decides whether it should exist.
        ...(autoResolve()?.raidExtras(m, region, at, detail) ?? []),
        h('button.btn.wm-go', {
          text: UI.raid, type: 'button',
          'aria-label': `Plan a raid on ${region.name}`,
          on: { click: () => launch(region.id) },
        }));
      return;
    }

    // Cooldown: the only volatile line on the panel. Update the text, never the
    // subtree, and re-render once when the mode actually flips to 'raid'.
    // aria-live off: a countdown announced once a second is a denial of service.
    const line = h('p.wm-hint', { 'aria-live': 'off' });
    const setLine = bindText(line);
    mount(detail, line, h('p.wm-hint.dim', { text: WORLD.raidHarder }));
    setTick(() => setLine(
      `${UI.conquered}. ${WORLD.cooldownHint} `
      + `${duration(raidCooldownRemaining(meta(), region.id, now()) / 1000)}.`,
    ));
    deps.tick();
  };
}

