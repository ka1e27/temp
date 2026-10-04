// Feature flags for tutorial steps that teach something that may not be in the build yet (game/scenes/timing.js `needs`). A step whose feature is
// off stays silent. Flip a flag when its feature is wired into the scenes.
export const FEATURES = {
  supply: true, // supply lines and front lines (DESIGN §4.3, §4.4): steps C1 and C2 (wired in scenes/battle.js)
  works: true, // Region Works (DESIGN §5.8): step M3 (wired in scenes/world.js)
  frontier: true, // the Living Frontier (DESIGN §10): raids, defenses, the Fortifications panel, occupation, the away report (steps F1, F2, F4)
};
