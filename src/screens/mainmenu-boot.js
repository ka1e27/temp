// BOOT AND CAMPAIGN SWAP — split out of ./mainmenu.js for the line budget,
// along the seam that was already there: none of this touches the menu scene's
// closure, and half of it is imported by screens that never open the menu at
// all (worldmap.js asks `bootRoute` before any menu exists). Re-exported from
// ./mainmenu.js so the four existing import paths are unchanged, which is safe
// in this direction only — nothing here imports the parent back.
// PURE of globals, like every screen helper.
import { metaOf, markDirty } from '../core/store.js';
import { clearBattle } from '../meta/resume.js';
import { recalcIncome } from '../meta/idle.js';
import { REGION_IDS, regionsConquered, refreshUnlocks, isAttackable } from '../meta/world.js';
import { defaultSelection } from '../meta/boosters.js';

export function isFreshCampaign(x) {
  const meta = metaOf(x);
  if (!meta?.regions) return true;
  if ((meta.stats?.battles ?? 0) > 0) return false;
  if (regionsConquered(meta) > 0) return false;
  if (Object.keys(meta.upgrades ?? {}).length > 0) return false;
  if (Object.values(meta.boosters ?? {}).some((n) => n > 0)) return false;
  return !((meta.crowns ?? 0) > 0);
}

/** 'new-game' skips the menu entirely; 'menu' has something to continue. */
export const bootRoute = (x) => (isFreshCampaign(x) ? 'new-game' : 'menu');

/** The first region you are allowed to attack — Riverfen on a clean save. */
export function firstRegionId(x) {
  const meta = metaOf(x);
  return REGION_IDS.find((id) => isAttackable(meta, id)) ?? REGION_IDS[0];
}

/** Straight into region 1: no menu, no world map, no loadout. */
export function launchFirstRegion(ctx) {
  const meta = ctx.state.meta;
  ctx.scenes.replace(ctx.screens.battle, {
    regionId: firstRegionId(meta),
    boosters: defaultSelection(meta),
  });
}

/**
 * Graft a loaded/blank meta onto the LIVE root. Everything main.js holds a
 * reference to (`state`, `state.session`) survives; only the persisted slice
 * is replaced, then the derived fields are healed.
 */
export function adoptCampaign(ctx, next, now) {
  const state = ctx.state;
  // PREFERENCES OUTLIVE THE CAMPAIGN. `meta` is replaced wholesale here — by a
  // new campaign or an imported save — and settings ride inside it, so without
  // this a player who wanted their rally hold-back at zero would have to say so
  // again after every reset, and importing a friend's save would silently adopt
  // their pace too. They are the player's, not the save's.
  const keptSettings = state.meta?.settings;
  state.saveVersion = next.saveVersion ?? state.saveVersion;
  state.seed = next.seed ?? state.seed;
  state.createdAt = next.createdAt ?? now;
  state.lastSeenAt = now;
  state.meta = next.meta;
  if (keptSettings) state.meta.settings = keptSettings;
  state.battle = null;
  // AND THE ONE ON DISK, TOO. Clearing `state.battle` only drops the battle this
  // session was holding; the resume blob lives in its own storage key and would
  // survive to the next reload, where `loadBattle` runs before any screen does.
  // The reasoning is ./mainmenu-legacy.js's, verbatim, and it applies to every
  // campaign swap and not just to abdication: a mid-battle blob outlives the
  // empire it belongs to, its config names a region this save no longer holds,
  // and meta/resume.js validates the CONTRACT rather than the campaign — so it
  // would happily drop the player back into a battle for ground that is not
  // theirs. New Campaign, Import Save and a backup restore are all exactly that
  // swap. Optional, like the autosaver hook below: `ctx.storage` is only present
  // once main.js has handed it over, and `clearBattle` tolerates its absence.
  clearBattle(ctx.storage);
  refreshUnlocks(state.meta, ctx.bus);
  recalcIncome(state.meta, ctx.bus);
  markDirty(state);
  // Optional hooks: present only once main.js hands them to ctx.
  ctx.autosaver?.flush?.(state, now);
  return state;
}
