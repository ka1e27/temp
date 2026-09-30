// window.__hd debug/automation API (DESIGN §8 `?dev=1`). This file is a thin
// passthrough on purpose: main.js builds the actual `ctx` object (closures
// over its live state/world/camera/scene), since that's the only place all
// of those already exist together; installing it is the only DOM-global
// touch, so it's kept here rather than scattered across main.js.

/**
 * @typedef {Object} DevContext
 * @property {import('../meta/state.js').GameState} state
 * @property {object} world
 * @property {object} camera        the ACTIVE scene's camera
 * @property {string} scene         current scene name
 * @property {number} frameMs       last measured frame time
 * @property {(id: number) => void} selectRegion
 * @property {(id: number) => void} startBattle
 * @property {() => void} winBattle
 * @property {() => void} loseBattle
 * @property {(id: number) => {x:number,y:number}|null} screenPosOfSite
 * @property {(amount: number) => void} grantGold
 * @property {() => void} revealMap
 * @property {(on: boolean) => void} setSpeedX8
 * @property {(seed?: number) => void} reseed
 */

/** @param {DevContext} ctx */
export function installDevHooks(ctx) {
  if (typeof window === 'undefined') return;
  window.__hd = ctx;
}
