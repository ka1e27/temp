// Screenshot one battle per SHAPE, so a silhouette can be looked at rather than
// argued about.
//
// The region table's flavour text spent this project's whole life describing
// maps the generator never made (regions.rules.js SHAPE_RULE), and the reason
// that survived so long is that nothing ever LOOKED. tools/mobile.mjs learned
// the same lesson the hard way — it reported a clean bill of health on a layout
// that was unplayable, and a screenshot found it in one glance.
//
//   npm start &
//   node tools/shapeshot.mjs [--out=screenshots/shapes]
import { mkdir } from 'node:fs/promises';
import { launch } from './cdp.js';
import { REGIONS } from '../src/content/regions.data.js';

const URL = process.env.URL || 'http://localhost:8080/';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `=${d}`).split('=').pop();
const OUT = arg('out', 'screenshots/shapes');
await mkdir(OUT, { recursive: true });

// One region per shape, chosen for being the row whose flavour claims it
// loudest — that is the pairing a reader will want to check.
const PICKS = ['greywater', 'ironwood', 'saltmere', 'thornmoor', 'gallowmoor'];

const page = await launch({ url: URL, width: 1440, height: 900 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for the game to actually boot rather than assuming it has. Under load —
// a balance sweep on the same machine, say — first paint can be seconds out,
// and evaluating against a half-booted page fails as "__game is undefined",
// which reads like a code fault and is not one.
for (let i = 0; i < 100 && !(await page.eval(() => !!window.__game)); i++) await sleep(150);
if (!(await page.eval(() => !!window.__game))) throw new Error(`game never booted at ${URL}`);

for (const id of PICKS) {
  const region = REGIONS.find((r) => r.id === id);
  if (!region) { console.log(`  ??  no such region: ${id}`); continue; }

  // Straight into the battle scene through the real broker, with the campaign
  // seeded so the region is unlocked. Driving the world map for a tier-3 region
  // would mean playing eight battles first.
  await page.eval((rid) => {
    const g = window.__game;
    for (const rec of Object.values(g.state.meta.regions)) rec.clears = 1;
    g.scenes.replace(g.screens.battle, { regionId: rid, boosters: [] });
  }, id);
  await sleep(1400);

  const shot = `${OUT}/${region.shape}-${id}.png`;
  await page.screenshot(shot);
  const seen = await page.eval(() => {
    const b = window.__game.state.battle;
    return { sites: b.sites.length, blocked: b.grid.blocked.length };
  });
  console.log(`  ok  ${region.shape.padEnd(7)} ${id.padEnd(12)} `
    + `${seen.sites} sites, ${seen.blocked} rock -> ${shot}`);
}

await page.close();
