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
import { createGrudgeMeter } from './grudgeMeter.js';
import { icon as uiIcon } from './icons.js';
import { drawTypeIcon, drawTwistGlyph } from '../render/featureGlyphs.js';
import { drawEmblem } from '../render/sprites.js';

/** The Fortifications panel's words (DESIGN 10.3); the effect lines and prices come in the data (meta/forts.js fortsPanelData). */
const FORTS_PANEL_COPY = Object.freeze({
  title: 'Fortifications', chooseTitle: 'Build a fortification', subLong: 'Defends this region when it is attacked', subTitle: 'Defends this region when it is attacked',
  subShort: 'Defends this region', backLabel: 'Back to the fortifications', slotsLabel: 'Fortification slots', groupLabel: 'Fortifications',
  chooseTip: 'Choose a fortification to build in this slot.', noneAffordable: 'Every fortification is out of reach for now', chooserLabel: 'Fortifications you can build',
});
/** Arrow Tower, Walls, Militia Hall, Beacon: the UI kit's own glyphs. */
const FORT_ICONS = { tower: 'tower', walls: 'castle', hall: 'tent', beacon: 'flame' };
const fortIcon = (type, size = 20) => uiIcon(FORT_ICONS[type] || 'shield', size);

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
 * @property {{ pct: number, thinning: boolean, text: string } | null} [unrest]  frontier only: Unrest (PLAN-PHASE11b, meta/unrest.js unrestInfo)
 * @property {{ type?: {id:string,name:string,text:string}, twist?: {id:string,name:string,text:string}, boss?: boolean }} [features]
 *   a varied map (DESIGN 10.13): the region type and battle twist rows
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
  onAttack, onSurrender, onScout, onSabotage, onBuildWork, onUpgradeWork, onDemolishWork, onBuildFort, onUpgradeFort, onDemolishFort, onThreat, onCommander, onFestival, onMuster, onQuick, crownTexts,
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

  // A varied map (DESIGN 10.13): the region's type and its battle twist, each a row with the map's own glyph and one honest line;
  // a Dragon's Lair adds "Boss: the dragon must fall". The glyphs are drawn on small canvases (the very drawing the map uses).
  function glyphCanvas() {
    const c = h('canvas.region-card-feature-glyph', { width: 40, height: 40, 'aria-hidden': 'true' });
    return c;
  }
  function paintGlyph(c, kind, id) {
    const key = `${kind}:${id}`;
    if (c.dataset.glyph === key) return;
    c.dataset.glyph = key;
    const ctx = c.getContext && c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 40, 40);
    if (kind === 'type') drawTypeIcon(ctx, id, 20, 20, 34);
    else if (kind === 'ashen') { ctx.beginPath(); ctx.arc(20, 20, 19, 0, Math.PI * 2); ctx.fillStyle = '#2c2b33'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(169,223,214,0.7)'; ctx.stroke(); drawEmblem(ctx, id, 20, 21, 26, '#e6dcc4'); }
    else { ctx.beginPath(); ctx.arc(20, 20, 19, 0, Math.PI * 2); ctx.fillStyle = 'rgba(14,16,24,0.82)'; ctx.fill(); drawTwistGlyph(ctx, id, 20, 20, 28); }
  }
  function featureRow(cls) {
    const glyph = glyphCanvas();
    const name = h('strong.region-card-feature-name', {}, '');
    const text = h('span.region-card-feature-text', {}, '');
    const el = h(`div.region-card-feature${cls}`, {}, glyph, h('span.region-card-feature-body', {}, name, text));
    el.hidden = true;
    return { el, glyph, name, text };
  }
  const typeRow = featureRow('.is-type');
  const twistRow = featureRow('.is-twist');
  const ashenRow = featureRow('.is-ashen'); // the Ashen Host's mechanic (PLAN-PHASE6 §6B): The Fallen Rise
  const bossEl = h('p.region-card-boss', {}, icon('flame', 16), h('span', {}, 'Boss: the dragon must fall'));
  bossEl.hidden = true;
  // the owner's Grudge against you (PLAN-PHASE4 §4D), on a rival's frontier card
  const grudgeMeter = createGrudgeMeter();
  const grudgeEl = h('div.region-card-grudge', {}, grudgeMeter.el);
  grudgeEl.hidden = true;
  // a Relic waiting in this region (PLAN-PHASE7 §7B): shown before you commit, so it can steer the route
  const relicName = h('strong', {}, '');
  const relicText = h('span', {}, '');
  const relicEl = h('p.region-card-relic', {}, icon('chest', 20), h('span', {}, relicName, ' ', relicText));
  relicEl.hidden = true;
  const featuresEl = h('div.region-card-features', {}, relicEl, typeRow.el, twistRow.el, ashenRow.el, bossEl);
  featuresEl.hidden = true;
  function patchFeatures(f) {
    const t = f && f.type;
    const w = f && f.twist;
    const a = f && f.ashen;
    const r = f && f.relic;
    featuresEl.hidden = !t && !w && !a && !r;
    relicEl.hidden = !r;
    if (r) { setText(relicName, `Relic: ${r.name}.`); setText(relicText, r.text); relicEl.dataset.relic = r.id; }
    ashenRow.el.hidden = !a;
    if (a) { paintGlyph(ashenRow.glyph, 'ashen', a.emblem || 'skullCrown'); setText(ashenRow.name, a.name); setText(ashenRow.text, a.text); }
    typeRow.el.hidden = !t;
    if (t) { paintGlyph(typeRow.glyph, 'type', t.id); setText(typeRow.name, t.name); setText(typeRow.text, t.text); }
    twistRow.el.hidden = !w;
    if (w) { paintGlyph(twistRow.glyph, 'twist', w.id); setText(twistRow.name, w.name); setText(twistRow.text, w.text); }
    bossEl.hidden = !(f && f.boss);
  }

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
  // Festival (DESIGN 10.12): Renown raises the prosperity a level now
  const festivalBtn = h('button.btn.btn-secondary.region-card-renown-btn.region-card-festival', { type: 'button', onClick: () => onFestival?.(currentId) }, h('span.renown-cost-label', {}, ''), icon('laurel', 13));
  festivalBtn.hidden = true;
  const ownedProsperity = h('div.region-card-prosperity', {}, icon('star', 16), prosperityText, prosperityNext, festivalBtn);
  // Muster (DESIGN 10.12): Renown refills this region's militia now
  const musterText = h('span', {}, '');
  const musterBtn = h('button.btn.btn-secondary.region-card-renown-btn.region-card-muster', { type: 'button', onClick: () => onMuster?.(currentId) }, h('span.renown-cost-label', {}, ''), icon('laurel', 13));
  const musterRow = h('div.region-card-renown-row', {}, icon('shield', 16), musterText, musterBtn);
  musterRow.hidden = true;
  // the commander of an attack (DESIGN 10.11): a native select (keyboard and screen reader for free), the free Generals plus the Militia Captain
  const commanderSelect = h('select.region-card-commander-select', { 'aria-label': 'Commander of the attack', onChange: () => onCommander?.(currentId, commanderSelect.value || null) });
  const commanderEl = h('label.region-card-commander', {}, icon('shield', 16), h('span', {}, 'Commander'), commanderSelect);
  commanderEl.hidden = true;
  let commanderSig = '';
  const ownedCrowns = h('div.region-card-crowns.is-owned', {});
  // "Under attack" (DESIGN 10.1): a war band is coming (the countdown and the odds), or a defense is being fought here; one button: Go / Watch
  const threatText = h('span.region-card-threat-text', {}, '');
  const threatBtn = h('button.btn.btn-primary.region-card-threat-btn', { type: 'button', onClick: () => onThreat?.(currentId) }, 'Go');
  const threatEl = h('div.region-card-threat', { role: 'status' }, icon('sword', 16), threatText, threatBtn);
  threatEl.hidden = true;

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

  // An occupied region of yours (DESIGN 10.2): who holds it, and what retaking it restores (its income, its frozen prosperity, its buildings)
  const occupiedText = h('span', {}, '');
  const occupiedEl = h('p.region-card-occupied', { role: 'note' }, icon('flag', 16), occupiedText);
  occupiedEl.hidden = true;
  // Unrest (PLAN-PHASE11b): a walled region thinning or recovering; the text comes as data (config/unrest.js through the scene)
  const unrestText = h('span', {}, '');
  const unrestEl = h('p.region-card-unrest', { role: 'note' }, icon('flag', 16), unrestText);
  unrestEl.hidden = true;

  const frontierIncome = rewardLine('.icon-good');
  const frontierBounty = rewardLine('.icon-gold');
  // Income and bounty share one wrapping row (a second row costs the phone sheet about 20 px).
  const frontierRewards = h('div.region-card-rewards.is-pair', {}, frontierIncome.el, frontierBounty.el);

  // Scout / Sabotage: built once, fed on every refresh; it patches its own DOM (see intelPanel.js).
  const intelPanel = createIntelPanel({ onScout, onSabotage });

  // The action buttons live for the card's whole life; only their `hidden` flips.
  const attackLabel = h('span.region-card-action-label', {}, 'Attack');
  const attackBtn = h('button.btn.btn-primary.btn-block.region-card-action', {
    onClick: () => onAttack?.(currentId),
  }, icon('sword', 16), attackLabel);
  const surrenderBtn = h('button.btn.btn-primary.btn-block.region-card-action', {
    onClick: () => onSurrender?.(currentId),
  }, icon('flag', 16), 'Accept Surrender');
  surrenderBtn.hidden = true;
  // Quick Conquest (PLAN-PHASE5 §5D): beside Attack on an Easy region once the Legacy node is owned; greyed (still focusable, it says why) while it cannot go
  const quickBtn = h('button.btn.btn-secondary.region-card-quick', { type: 'button', onClick: () => { if (quickBtn.getAttribute('aria-disabled') !== 'true') onQuick?.(currentId); } },
    icon('boot', 16), h('span.region-card-quick-word', {}, 'Quick Conquest'));
  quickBtn.hidden = true;
  const actionsRow = h('div.region-card-actions-row', {}, attackBtn, quickBtn);
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
  // Fortifications (DESIGN 10.3): the same panel and patterns as the Works (built once, patched in place, the in-row demolish confirm), with its own words and icons
  const fortsPanel = createWorksPanel({
    copy: FORTS_PANEL_COPY,
    iconFor: fortIcon,
    onBuild: (regionId, slot, type) => onBuildFort?.(regionId, slot, type),
    onUpgrade: (regionId, slot) => onUpgradeFort?.(regionId, slot),
    onDemolish: (regionId, slot) => onDemolishFort?.(regionId, slot),
  });
  fortsPanel.el.classList.add('is-forts');
  fortsPanel.el.hidden = true;

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    if (next === 'locked') bodyEl.replaceChildren(lockedEl);
    else if (next === 'owned') bodyEl.replaceChildren(threatEl, perkEl, featuresEl, ownedProsperity, ownedRewards, ownedCrowns, musterRow, worksPanel.el, fortsPanel.el); // Works and Fortifications: the interactive part, last
    else bodyEl.replaceChildren(occupiedEl, unrestEl, perkEl, featuresEl, grudgeEl, matchupEl, scoutSlot, intelPanel.el, frontierCrowns, frontierRewards, commanderEl, blockedEl);
    footerEl.replaceChildren(hintSlot, ...(next === 'frontier' ? [actionsRow, surrenderBtn] : []));
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
    patchFeatures(data.features);
    setText(ownedIncome.text, `Income +${formatRate(data.income)}/s`);
    const p = data.prosperity;
    ownedProsperity.hidden = !p;
    patchRenownButton(festivalBtn, data.festival, (f) => `Festival · ${f.cost}`, (f) => `Festival: raise the prosperity to level ${f.toLevel ?? ''} now, for ${f.cost} Renown`);
    patchRenownButton(musterBtn, data.muster, (m) => `Muster · ${m.cost}`, (m) => `Muster: refill this region's militia now, for ${m.cost} Renown`);
    musterRow.hidden = !data.muster;
    if (data.muster) setText(musterText, data.muster.fill != null ? `Militia ${Math.round(data.muster.fill * 100)}%` : 'Militia');
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
    if (data.forts) fortsPanel.update(data.forts);
    fortsPanel.el.hidden = !data.forts;
    threatEl.hidden = !data.threat;
    if (data.threat) {
      setText(threatText, data.threat.text);
      setText(threatBtn, data.threat.button || 'Go');
      threatBtn.hidden = !data.threat.button;
      if (threatBtn.getAttribute('aria-label') !== (data.threat.buttonLabel || data.threat.button || 'Go')) threatBtn.setAttribute('aria-label', data.threat.buttonLabel || data.threat.button || 'Go');
    }
  }

  /** A Renown spend button: hidden without data; disabled with its reason as title and name. */
  function patchRenownButton(btn, d, label, name) {
    btn.hidden = !d;
    if (!d) return;
    setText(btn.querySelector('.renown-cost-label'), label(d));
    if (btn.disabled !== !d.can) btn.disabled = !d.can;
    const n = d.can ? name(d) : `${name(d)}. ${d.reason || 'Not available'}`;
    if (btn.getAttribute('aria-label') !== n) btn.setAttribute('aria-label', n);
    if (btn.title !== (d.can ? name(d) : d.reason || '')) btn.title = d.can ? name(d) : d.reason || '';
  }

  /** The commander picker: rebuilt only when the choices change (a select being opened is never replaced by a refresh). */
  function patchCommander(c) {
    commanderEl.hidden = !c;
    if (!c) return;
    const sig = JSON.stringify(c.options);
    if (sig !== commanderSig) {
      commanderSig = sig;
      commanderSelect.replaceChildren(...c.options.map((o) => h('option', { value: o.id || '' }, o.label)));
    }
    const v = c.selected || '';
    if (commanderSelect.value !== v) commanderSelect.value = v;
  }

  function patchFrontier(data) {
    patchCommander(data.commander);
    const d = data.difficulty || { power: 0, strength: 0, ratio: 1, label: 'Fair', surrender: false };
    const total = Math.max(d.power + d.strength, 1e-6);
    const hasChance = typeof d.winChance === 'number' && Number.isFinite(d.winChance);
    const youPct = Math.max(4, Math.min(96, (hasChance ? d.winChance : d.power / total) * 100));
    const ownerColor = (data.owner && data.owner.color) || '#9a927f';

    patchPerk(data.perk);
    patchFeatures(data.features);

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
    // a retake of a region that already holds its crowns earns none again (crowns.js): the medals row would promise gold it never pays, so it goes
    frontierCrowns.hidden = data.parSec == null || data.crownsPayable === false;
    if (data.parSec != null && data.crownsPayable !== false) {
      if (crownRow.el.parentNode !== frontierCrowns) frontierCrowns.insertBefore(crownRow.el, parLine);
      crownRow.update({ earned: null, parSec: data.parSec });
      setText(crownsLabel, pct ? `Crowns: +${pct}% bounty each` : 'Crowns');
      setText(parLine, `Par ${formatClock(data.parSec)}${pct ? ` · crowns +${pct}% bounty each` : ''}`);
    }

    setText(frontierIncome.text, `Income +${formatRate(data.income)}/s forever`);
    // an occupied region of yours pays the retake reward (meta/progression.js conquestBounty), not a conquest bounty
    setText(frontierBounty.text, `${data.occupied ? 'Retake reward' : 'Bounty'} ${shortNumber(data.bounty || 0)} gold`);

    // a region walled off by mountains cannot be attacked: the card says why instead (a surrender, if one is on offer, still works: it needs no arena)
    const blocked = !!data.attackBlock && !d.surrender;
    setText(blockedText, data.attackBlock === 'unbuildable' ? 'This region cannot be attacked from here yet' : 'No passable border: conquer a neighbour first');
    attackBtn.hidden = !!d.surrender || blocked;
    // a battle is already being fought here (DESIGN 10.5): the same button opens it; an occupied region of yours is retaken (10.2)
    setText(attackLabel, data.battleRunning ? 'Watch the battle' : data.occupied ? 'Retake' : 'Attack');
    occupiedEl.hidden = !data.occupied;
    unrestEl.hidden = !data.unrest;
    if (data.unrest) { setText(unrestText, data.unrest.text); unrestEl.classList.toggle('is-recovering', !data.unrest.thinning); }
    if (data.occupied) {
      const o = data.occupied;
      setText(occupiedText, `Occupied by ${o.byName}: retake it to restore its income${o.prosperityLabel ? `, Prosperity ${o.prosperityLabel}` : ''}${o.buildings ? ` and ${o.buildings} building${o.buildings === 1 ? '' : 's'}` : ''}.`);
      occupiedEl.style.setProperty('--occupier', o.color || '#eb5757');
    }
    surrenderBtn.hidden = !d.surrender;
    const q = !d.surrender && !blocked && !data.battleRunning ? data.quick : null;
    quickBtn.hidden = !q;
    if (q) {
      const off = !q.can;
      if (quickBtn.getAttribute('aria-disabled') !== String(off)) quickBtn.setAttribute('aria-disabled', String(off));
      quickBtn.classList.toggle('is-off', off);
      const label = off ? `${q.label}: ${q.reason}` : `${q.label}: your commander takes it at once, for the Victory crown and part of the bounty`;
      if (quickBtn.getAttribute('aria-label') !== label) { quickBtn.setAttribute('aria-label', label); quickBtn.title = label; }
    }
    blockedEl.hidden = !blocked;
    grudgeEl.hidden = !data.grudge;
    if (data.grudge) grudgeMeter.update(data.grudge);
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
    /** The Festival button of the owned card (tutorial R1). */
    festivalButton: () => (festivalBtn.hidden ? null : festivalBtn),
    /** The Quick Conquest button (tutorial and checks), or null while hidden. */
    quickButton: () => (quickBtn.hidden ? null : quickBtn),
    /** The commander picker of the frontier card. */
    commanderSelect: () => (commanderEl.hidden ? null : commanderSelect),
    /** The Fortifications panel of the owned card (same API as `works`). */
    forts: fortsPanel,
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
