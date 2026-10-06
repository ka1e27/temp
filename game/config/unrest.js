// Unrest (PLAN-PHASE11b): a structural catch-up for map walls. When nothing on the frontier reads Easy or Fair (the card's label, its
// commander credited) for `idleSec` active seconds, the weakest frontier region (the best power ratio) falls into Unrest: its garrisons and
// settlement caps thin by `perMin` per active minute, up to `max`, until the player attacks it, it reads Easy or Fair, or something else on the
// frontier does. Then it calms and recovers `recoverPerMin` per active minute. Read by game/meta/unrest.js (the clock), unrestState.js (the
// multiplier progression.js applies to troops and caps, so labels and the win chance include it), the world scene and tools/campaign.mjs.
// Never in a challenge (the Daily and Scenarios keep their tuning).

export const UNREST = Object.freeze({
  // Measured with tools/campaign.mjs --policy=human (32 seeds; median longest stretch with no Easy or Fair region in the first hour, 9.5 min
  // without Unrest): the lead's first numbers (180 s, 6%/min, -30%) gave 8.5 min, because a person tries the best Hard region after 2 minutes
  // and that attack calms it before it has thinned. 120 s / 20% / -40%: 4.9 min; 90 s / 20% / -30%: 4.4 min with 2 D3 waits at 40 min;
  // 90 s / 20% / -40%: 4.4 min, the optimal D1 1.01 h and no wait over 40 min in any dynasty (12 seeds).
  idleSec: 90,             // 90 active seconds with no Easy or Fair region before one falls into Unrest
  perMin: 0.20,            // garrisons and caps thin by 20% of their size per active minute ...
  max: 0.40,               // ... down to -40% (two minutes in)
  recoverPerMin: 0.02,     // once calm, 2% per active minute back (a -40% region is whole again after 20 minutes)
  showMin: 0.005,          // below this the region shows no Unrest at all
  copy: Object.freeze({
    label: 'Unrest',
    thinning: 'Unrest: its garrisons are thinning (−{pct}%)',
    recovering: 'Unrest: its garrisons are recovering (−{pct}%)',
    toast: '{region} is in Unrest: with nothing else to fight, its garrisons are thinning.',
  }),
});
