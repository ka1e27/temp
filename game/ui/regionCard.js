// Region card (DESIGN §5.3, §3.5). Browser only; no game-logic imports — the
// integrator computes income/bounty/difficulty via game/meta and passes the
// finished numbers in.
//
// The card is BUILT ONCE and then patched in place. The world scene refreshes it about once a second
// (and on every selection), so anything that recreated its buttons could land a rebuild between a
// player's pointerdown and pointerup: the click then targets the container instead of the button and
// is swallowed (Attack included). Text and styles are patched only when they changed, the buttons and
// mounted child components (the crown row, later the intel panel) are never recreated, and an update
// whose data is identical to the last one does nothing at all.
import { h } from './dom.js';
import { icon } from './icons.js';
import { shortNumber, formatRate, formatClock, formatDurationWords } from './format.js';
import { createCrownRow } from './crownRow.js';
import { createIntelPanel } from './intelPanel.js';
import { createWorksPanel } from './worksPanel.js';

/**
 * @typedef {Object} RegionCardData
 * @property {number} id
 * @property {string} name
 * @property {number} tier
 * @property {boolean} [locked]   true => "conquer a neighbour first", nothing else shown
 * @property {boolean} [owned]    true => owned-region display (no attack/difficulty)
 * @property {{ name: string, color: string, emblem: string }} owner
 * @property {{ icon: string, name: string, text: string }} [perk]
 * @property {number} income      current income if owned, income-if-taken if frontier
 * @property {number} [bounty]    frontier only
 * @property {{ power: number, strength: number, ratio: number, label: string, surrender: boolean }} [difficulty]
 * @property {number} [parSec]        par time behind the Swift crown (frontier and owned regions)
 * @property {{ victory: boolean, swift: boolean, unbroken: boolean } | null} [crowns]
 *   owned regions: the crowns it was conquered with (null = no record, e.g. conquered before crowns existed)
 * @property {number} [crownBonusPct] e.g. 25: "crowns +25% bounty each"
 * @property {import('./intelPanel.js').IntelPanelData} [intel]  frontier only: Scout / Sabotage panel data
 * @property {{ level: number, label: string, nextInMs: number|null, bonusPct: number }} [prosperity]  owned regions
 * @property {import('./worksPanel.js').WorksPanelData} [works]  owned regions: the Region Works section (meta/works.js worksPanelData)
 */

const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };

/** Swaps the icon inside `holder` only when the icon name changed. */
function setIcon(holder, name, size) {
  if (holder.dataset.icon === name) return;
  holder.dataset.icon = name;
  holder.replaceChildren(icon(name, size));
}

/**
 * @param {{ onAttack?: (id: number) => void, onSurrender?: (id: number) => void,
 *   onScout?: (id: number) => void, onSabotage?: (id: number) => void,
 *   onBuildWork?: (id: number, slot: number, type: string) => void, onUpgradeWork?: (id: number, slot: number) => void,
 *   onDemolishWork?: (id: number, slot: number) => void }} [callbacks]
 */
export function createRegionCard({
  onAttack, onSurrender, onScout, onSabotage, onBuildWork, onUpgradeWork, onDemolishWork, crownTexts,
} = {}) {
  let currentId = null;
  let lastSig = '';
  let mode = null; // 'locked' | 'owned' | 'frontier': which set of children is mounted in the body

  // --- header ---------------------------------------------------------------------------
  const nameEl = h('h2.region-card-name', {}, '');
  const tierEl = h('span.region-card-tier.pill', {}, '');
  const ownerChip = h('span.owner-chip', {});
  const bodyEl = h('div.region-card-body', {});
  // The footer is OUTSIDE the scrolling body: Attack (or Accept Surrender) is always visible and never covers a row. Above the buttons sits a hint slot, empty
  // unless the tutorial's "Attack!" bubble needs room: it opens up there, so the bubble covers no decision information (setHintSpace).
  const hintSlot = h('div.region-card-hintslot', { 'aria-hidden': 'true' });
  hintSlot.hidden = true;
  // the same kind of room above the Scout row (in the body), for the Scout hint on a phone, where a bubble above the button would sit on the strength bar
  const scoutSlot = h('div.region-card-hintslot', { 'aria-hidden': 'true', 'data-where': 'scout' });
  scoutSlot.hidden = true;
  const footerEl = h('div.region-card-footer', {}, hintSlot);
  let ownerSig = '';

  // The owner chip lives IN the header (name, owner, tier) so the card is one row shorter: the phone
  // bottom sheet has a height budget. Long names wrap the chips onto a second line.
  const el = h('div.region-card.glass-panel', {},
    h('div.region-card-header', {}, nameEl, ownerChip, tierEl),
    bodyEl,
    footerEl,
  );

  // --- shared pieces --------------------------------------------------------------------
  const perkIcon = h('span.region-card-perk-icon', {});
  const perkText = h('span', {}, '');
  const perkEl = h('div.region-card-perk', {}, perkIcon, perkText);

  function rewardLine(extraClass, iconName = 'coin') {
    const text = h('span', {}, '');
    return { el: h(`div.reward-line${extraClass}`, {}, icon(iconName, 16), text), text };
  }

  const crownRow = createCrownRow({ size: 'sm', texts: crownTexts }); // one row, moved between the two crown blocks

  // --- locked ---------------------------------------------------------------------------
  const lockedEl = h('p.region-card-locked', {}, icon('map', 18), 'Conquer a neighbouring region first.');

  // --- owned ----------------------------------------------------------------------------
  const ownedIncome = rewardLine('.icon-good');
  const ownedRewards = h('div.region-card-rewards', {}, ownedIncome.el);
  // "Prosperity II · +10% income · next in 1h 12m" (the countdown ticks with the card's 1 s refresh).
  const prosperityText = h('span', {}, '');
  const prosperityNext = h('span.region-card-next', {}, '');
  const ownedProsperity = h('div.region-card-prosperity', {}, icon('star', 16), prosperityText, prosperityNext);
  const ownedCrowns = h('div.region-card-crowns.is-owned', {});

  // --- frontier -------------------------------------------------------------------------
  // A labelled matchup, not a bare "32 · Easy · 18": the difficulty chip reads first (centred,
  // coloured), then a two-sided bar coloured by WHO (your blue vs the defender's own colour, not by
  // difficulty — the chip already carries that signal), then named labels under each end so a
  // first-time player never has to guess which number is whose.
  const diffChip = h('span.matchup-chip.pill', {}, '');
  const youFill = h('div.matchup-you-fill', {});
  const enemyFill = h('div.matchup-enemy-fill', {});
  const youNum = h('strong.nums', {}, '');
  const enemyNum = h('strong.nums', {}, '');
  // Weighted power against weighted strength, not troop counts (the scouted chips show those).
  // The bar is the CHANCE of winning (DESIGN 5.3), said in words under it; the two numbers stay as small print
  const chanceEl = h('p.matchup-chance', {}, '');
  const enemyLabel = h('span.matchup-enemy-label', {}, 'Strength ', enemyNum);
  const matchupEl = h('div.region-card-matchup', {},
    h('div.matchup-chip-row', {}, diffChip),
    h('div.matchup-bar-track', {}, youFill, enemyFill),
    chanceEl,
    h('div.matchup-labels', {}, h('span.matchup-you-label', {}, 'Power ', youNum), enemyLabel),
  );

  // Frontier crowns: the three open medals and their rule on desktop; on a phone bottom sheet (CSS)
  // one compact "Par 1:00 · ..." line instead, so the sheet stays short. Both are in the DOM.
  const crownsLabel = h('span.region-card-crowns-label', {}, '');
  const parLine = h('p.region-card-par', {}, '');
  const frontierCrowns = h('div.region-card-crowns', {}, crownsLabel, parLine);

  const frontierIncome = rewardLine('.icon-good');
  const frontierBounty = rewardLine('.icon-gold');
  // Income and bounty share one wrapping row (a second row costs the phone sheet about 20 px).
  const frontierRewards = h('div.region-card-rewards.is-pair', {}, frontierIncome.el, frontierBounty.el);

  // Scout / Sabotage: built once, fed on every refresh; it patches its own DOM (see intelPanel.js).
  const intelPanel = createIntelPanel({ onScout, onSabotage });

  // The action buttons live for the card's whole life; only their `hidden` flips.
  const attackBtn = h('button.btn.btn-primary.btn-block.region-card-action', {
    onClick: () => onAttack?.(currentId),
  }, icon('sword', 16), 'Attack');
  const surrenderBtn = h('button.btn.btn-primary.btn-block.region-card-action', {
    onClick: () => onSurrender?.(currentId),
  }, icon('flag', 16), 'Accept Surrender');
  surrenderBtn.hidden = true;
  const blockedText = h('span', {}, 'No passable border: conquer a neighbour first');
  const blockedEl = h('p.region-card-blocked', { role: 'note' }, icon('shield', 16), blockedText);
  blockedEl.hidden = true;

  /** Mounts the children of one mode (only when the mode changes, never on a plain refresh). */
  // Region Works (DESIGN 5.8): built ONCE like everything else in this card and patched in place; the demolish confirm is the panel's own step.
  const worksPanel = createWorksPanel({
    onBuild: (regionId, slot, type) => onBuildWork?.(regionId, slot, type),
    onUpgrade: (regionId, slot) => onUpgradeWork?.(regionId, slot),
    onDemolish: (regionId, slot) => onDemolishWork?.(regionId, slot),
  });

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    if (next === 'locked') bodyEl.replaceChildren(lockedEl);
    else if (next === 'owned') bodyEl.replaceChildren(perkEl, ownedProsperity, ownedRewards, ownedCrowns, worksPanel.el); // Works: the interactive part, last
    else bodyEl.replaceChildren(perkEl, matchupEl, scoutSlot, intelPanel.el, frontierCrowns, frontierRewards, blockedEl);
    footerEl.replaceChildren(hintSlot, ...(next === 'frontier' ? [attackBtn, surrenderBtn] : []));
    footerEl.hidden = next !== 'frontier';
  }

  function patchOwner(owner) {
    const sig = owner ? `${owner.color}|${owner.colorLight}|${owner.emblem}|${owner.name}` : '';
    if (sig === ownerSig) return;
    ownerSig = sig;
    if (!owner) { ownerChip.hidden = true; ownerChip.replaceChildren(); return; }
    ownerChip.style.setProperty('--chip-color', owner.colorLight || owner.color || '#9a927f');
    ownerChip.replaceChildren(icon(owner.emblem || 'flag', 14), h('span', {}, owner.name || ''));
    ownerChip.hidden = false;
  }

  function patchPerk(perk) {
    perkEl.hidden = !perk;
    if (!perk) return;
    setIcon(perkIcon, perk.icon, 16);
    setText(perkText, `${perk.name} — ${perk.text}`);
  }

  function patchOwned(data) {
    patchPerk(data.perk);
    setText(ownedIncome.text, `Income +${formatRate(data.income)}/s`);
    const p = data.prosperity;
    ownedProsperity.hidden = !p;
    if (p) {
      setText(prosperityText, p.level ? `Prosperity ${p.label} · +${p.bonusPct}% income` : 'Prosperity: newly held');
      setText(prosperityNext, p.nextInMs != null ? ` · next in ${formatDurationWords(p.nextInMs / 1000)}` : '');
    }
    // Fixed at conquest: a false key renders as a struck-through "missed" crown.
    const showCrowns = data.parSec != null && !!data.crowns;
    ownedCrowns.hidden = !showCrowns;
    if (showCrowns) {
      if (crownRow.el.parentNode !== ownedCrowns) ownedCrowns.replaceChildren(crownRow.el);
      crownRow.update({ earned: data.crowns, parSec: data.parSec });
    }
    if (data.works) worksPanel.update(data.works);
    worksPanel.el.hidden = !data.works;
  }

  function patchFrontier(data) {
    const d = data.difficulty || { power: 0, strength: 0, ratio: 1, label: 'Fair', surrender: false };
    const total = Math.max(d.power + d.strength, 1e-6);
    const hasChance = typeof d.winChance === 'number' && Number.isFinite(d.winChance);
    const youPct = Math.max(4, Math.min(96, (hasChance ? d.winChance : d.power / total) * 100));
    const ownerColor = (data.owner && data.owner.color) || '#9a927f';

    patchPerk(data.perk);

    const chipClass = `matchup-chip pill diff-${String(d.label).toLowerCase()}`;
    if (diffChip.className !== chipClass) diffChip.className = chipClass;
    setText(diffChip, d.label);
    youFill.style.width = `${youPct}%`;
    enemyFill.style.width = `${100 - youPct}%`;
    enemyFill.style.background = ownerColor;
    enemyLabel.style.color = (data.owner && data.owner.colorLight) || ownerColor; // text uses the LIGHT variant (contrast on the dark card)
    setText(chanceEl, hasChance && data.chanceText ? `Chance to win: ${data.chanceText}` : '');
    chanceEl.hidden = !(hasChance && data.chanceText);
    setText(youNum, shortNumber(d.power));
    setText(enemyNum, shortNumber(d.strength));

    intelPanel.el.hidden = !data.intel;
    if (data.intel) intelPanel.update(data.intel);

    const pct = data.crownBonusPct;
    frontierCrowns.hidden = data.parSec == null;
    if (data.parSec != null) {
      if (crownRow.el.parentNode !== frontierCrowns) frontierCrowns.insertBefore(crownRow.el, parLine);
      crownRow.update({ earned: null, parSec: data.parSec });
      setText(crownsLabel, pct ? `Crowns: +${pct}% bounty each` : 'Crowns');
      setText(parLine, `Par ${formatClock(data.parSec)}${pct ? ` · crowns +${pct}% bounty each` : ''}`);
    }

    setText(frontierIncome.text, `Income +${formatRate(data.income)}/s forever`);
    setText(frontierBounty.text, `Bounty ${shortNumber(data.bounty || 0)} gold`);

    // a region walled off by mountains cannot be attacked: the card says why instead (a surrender, if one is on offer, still works: it needs no arena)
    const blocked = !!data.attackBlock && !d.surrender;
    setText(blockedText, data.attackBlock === 'unbuildable' ? 'This region cannot be attacked from here yet' : 'No passable border: conquer a neighbour first');
    attackBtn.hidden = !!d.surrender || blocked;
    surrenderBtn.hidden = !d.surrender;
    blockedEl.hidden = !blocked;
  }

  function update(data) {
    if (!data) return;
    // Nothing visible changed (a gold tick, the 1 s refresh): leave the DOM alone entirely.
    const sig = JSON.stringify(data);
    if (sig === lastSig) return;
    lastSig = sig;

    currentId = data.id;
    setText(nameEl, data.name);
    setText(tierEl, data.tier === 0 ? 'Home' : `Tier ${data.tier}`);
    const state = data.locked ? 'locked' : data.owned ? 'owned' : 'frontier';
    if (el.dataset.state !== state) el.dataset.state = state;
    patchOwner(data.owner);

    setMode(state);
    if (state === 'owned') patchOwned(data);
    else if (state === 'frontier') patchFrontier(data);
  }

  function destroy() {}

  return {
    el, update, destroy,
    /** The Works panel of the owned card (for the tutorial coach: buildButton(), chooserRow(type), view). */
    works: worksPanel,
    /** Opens (px > 0) or closes (0) the empty room above the action buttons that the "Attack!" hint bubble sits in. */
    setHintSpace(px, where = 'footer') {
      const slot = where === 'scout' ? scoutSlot : hintSlot;
      const other = where === 'scout' ? hintSlot : scoutSlot;
      const v = Math.max(0, Math.round(px || 0));
      if (other.dataset.px && other.dataset.px !== '0') { other.dataset.px = '0'; other.style.height = '0px'; other.hidden = true; } // one room at a time
      if (slot.dataset.px === String(v)) return;
      slot.dataset.px = String(v);
      slot.style.height = `${v}px`;
      slot.hidden = v === 0; // closed, it takes no room (not even the card's row gap)
    },
    /** The footer's buttons (for the placement monitor and the coach). */
    footer: footerEl,
  };
}
