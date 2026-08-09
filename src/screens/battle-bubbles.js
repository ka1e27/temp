// Small pill "bubbles" for the site panel: terrain, the gold/training
// readout and the currently-training unit's real stats.
//
// ONE visual language, reused rather than invented: `.chip` already carries
// the pill shape (`--r-pill`), the colour dot (`::before` reading `--chip`)
// and the box-shadow ring the dock's unit filters use — `.bubble` only trims
// the padding down for a 19rem-wide panel. See hud.css's own comment on how
// `--chip` works before adding a fourth way to colour a badge.
//
// PRESENTATION ONLY: every value handed to `bubble()` comes from the caller —
// siteIntel()'s fields or a UNITS[...] entry — never re-derived here. See
// battle-econ.js's header for why that rule exists.
//
// A permanent second line explaining every bubble would be the six-lines-of-
// text problem all over again, so the explanation rides the SAME native
// `title` mechanism the Upgrade button already uses for "why can't I press
// this" — a real hover-card (battle-tip.js) is reserved for the composition
// bar, where the payload is a live number, not a fixed sentence.
import { UNITS, TERRAIN } from '../content/balance.js';
import { isOpen, terrainName } from '../battle/terrain.js';
import { h, mount, clear } from '../ui/dom.js';
import { fixed, rate } from '../ui/format.js';
import { tellingUnitOf } from './battle-econ.js';

function bubble({ label, hue, note, cls }) {
  return h(`span.chip.bubble${cls ? `.${cls}` : ''}`, {
    title: note || '', vars: { '--chip': hue },
  }, h('span.chip-name', { text: label }));
}

/** Rebuild `host`'s bubbles only when the underlying facts changed — cheap at
 *  10Hz, the same diff-by-signature trick battle-hud.js's renderCaveats() and
 *  renderComp() already use for exactly this reason.
 *  @returns {boolean} true when the row's content really changed, the same
 *    contract every bind* in ui/dom.js follows — the panel uses it to decide
 *    whether its own box just changed and needs re-anchoring. */
function renderBubbles(host, list) {
  const sig = list.map((b) => `${b.label}|${b.hue}|${b.cls || ''}`).join(',');
  if (host.dataset.sig === sig) return false;
  host.dataset.sig = sig;
  clear(host);
  for (const b of list) mount(host, bubble(b));
  return true;
}

/** Empty every bubble row at once — multi-select and the squad view have
 *  nothing to say about one site's terrain, economy or training.
 *  @returns {boolean} true when any row actually had something to clear. */
export function clearBubbles(...hosts) {
  let wrote = false;
  for (const host of hosts) wrote = renderBubbles(host, []) || wrote;
  return wrote;
}

/**
 * Terrain + defence bubbles: the ground's name(s), the defence multiplier the
 * fight will actually meet, the one unit whose day this ground changes most,
 * and a river farm's gold bonus. Empty ground renders nothing, same as
 * terrainLine() — the row itself collapses via CSS `:empty`.
 */
export function updateTerrainBubbles(host, intel) {
  const g = intel.ground;
  const list = [];
  if (!isOpen(g)) {
    list.push({
      label: terrainName(g).toUpperCase(), hue: 'var(--c-water)',
      note: 'The ground this site stands on.',
    });
    list.push({
      label: `DEF ×${fixed(intel.defMult, 2)}`, hue: 'var(--c-accent)',
      note: 'The defence multiplier this fight will actually use — the site\'s '
        + 'own fortification, made harder by the ground around it.',
    });
    const best = tellingUnitOf(g);
    if (best) {
      list.push({
        label: `${best.id.toUpperCase()} ×${fixed(best.mult, 2)}`, hue: `var(--c-${best.id})`,
        note: `The one unit whose day this ground changes most.`,
      });
    }
    if (intel.riverFarm) {
      list.push({
        label: `RIVER +${Math.round((TERRAIN.riverFarmGold - 1) * 100)}%`, hue: 'var(--c-water)',
        note: 'A farm on a watercourse earns more gold.',
      });
    }
  }
  renderBubbles(host, list);
}

/**
 * Gold in, training out, and the difference — the same three facts
 * goldLine() states as a sentence, one bubble per fact instead. Same gating
 * as goldLine(): NET only appears once both halves are real, so a farm that
 * only earns never claims a "net" it never had to compute.
 */
export function updateEconBubbles(host, intel) {
  const list = [];
  if (intel.gold > 0) {
    list.push({ label: `GOLD ${rate(intel.gold)}`, hue: 'var(--c-gold)', note: 'Income per second.' });
  }
  if (intel.spend > 0) {
    list.push({
      label: `TRAIN ${rate(-intel.spend)}`, hue: 'var(--c-danger)',
      note: 'Gold spent training per second.',
    });
  }
  if (intel.gold > 0 && intel.spend > 0) {
    list.push({
      label: `NET ${rate(intel.net)}`, hue: intel.net >= 0 ? 'var(--c-player)' : 'var(--c-danger)',
      note: 'What this site nets you once training has taken its cut.',
      cls: intel.net < 0 ? 'is-negative' : '',
    });
  }
  renderBubbles(host, list);
}

/**
 * The currently-training unit's REAL stats — atk and def straight off
 * UNITS[id] in balance.js, never a fabricated per-unit HP. There is no
 * per-unit HP in this game (only sites carry hp/hpMax); "toughness" is what
 * `def` already honestly answers, so that is the label, not a bare number.
 * `siege` earns a bubble only once it is a real siege contributor (rams,
 * marshal) — showing it for every unit would bury the two it actually says
 * something about.
 */
export function updateUnitStatBubbles(host, unitId) {
  if (!unitId || !UNITS[unitId]) { renderBubbles(host, []); return; }
  const spec = UNITS[unitId];
  const hue = `var(--c-${unitId})`;
  const list = [
    { label: `ATK ${spec.atk}`, hue, note: `${unitId}'s attack power in the field.` },
    { label: `TOUGH ${spec.def}`, hue, note: `${unitId}'s defence — there is no per-unit HP, only site HP.` },
  ];
  if (spec.siege >= 1) {
    list.push({ label: `SIEGE ${fixed(spec.siege, 1)}`, hue, note: `${unitId}'s damage against structure HP.` });
  }
  renderBubbles(host, list);
}
