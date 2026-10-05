// The first-hour audit (PLAN-PHASE10 10A): a scripted new player plays the first N minutes of a fresh realm (hints on, 1x) with REAL presses at a
// human-ish pace: it attacks the best Easy or Fair region, fights with drags the drag preview says will capture, shops in the War Council, accepts or
// dismisses offers, picks the first Boon of every draft and presses through every post-battle moment. tools/firstHourProbe.js logs every
// interruption; tools/firstHourReport.mjs prints the minute-by-minute table, the unlock timeline and the targets.
//
//   npm start                     # in another terminal (or --url=...)
//   node tools/firstHour.mjs [--minutes=60] [--seed=7] [--variant=desktop|phone] [--label=before] [--out=screenshots/phase10] [--assert]
//
// Writes <out>/firstHour-<label>.json (rewritten every 30 s, so a long run can be read while it plays) and .txt. --assert exits 1 when a target is missed.
import { mkdir, writeFile } from 'node:fs/promises';
import { createBot } from './firstHourBot.mjs';
import { analyse, render } from './firstHourReport.mjs';

if (!process.env.CHROME_PATH && process.platform === 'win32') process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('./cdp.js');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
const MINUTES = Number(flags.minutes || 60);
const SEED = flags.seed || '7';
const PHONE = flags.variant === 'phone';
const W = PHONE ? 390 : 1440;
const H = PHONE ? 844 : 900;
const LABEL = flags.label || 'run';
const OUT = flags.out || 'screenshots/phase10';
const BASE = flags.url || 'http://localhost:8080';
await mkdir(OUT, { recursive: true });

const page = await launch({ url: 'about:blank', width: W, height: H });
const errors = [];
page.on((m, p) => {
  if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
  else if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push(p.args.map((a) => a.value ?? a.description).join(' '));
});
await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: PHONE });
if (PHONE) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
// every CDP call gets a deadline: a hung page must show up as STUCK in the log, not as a run that never ends
const timed = (fn, label) => (...a) => Promise.race([fn(...a), new Promise((_, no) => setTimeout(() => no(new Error(`TIMEOUT ${label}`)), 25000))]);
for (const k of ['eval', 'send', 'mouse', 'drag', 'screenshot']) page[k] = timed(page[k].bind(page), k);
const T0 = Date.now();
const clock = () => { const s = Math.round((Date.now() - T0) / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const log = (msg) => console.log(`[${clock()}] ${msg}`);
const bot = createBot(page, { touch: PHONE, W, H, log });
const { sleep, ev, press, key, tap } = bot;

await page.goto(`${BASE}/index.html?dev=1&seed=${SEED}`);
for (let i = 0; i < 100 && !(await bot.find('.title-btn', '^New Realm$').catch(() => null)); i++) await sleep(200);
await ev(() => window.__hd.hideDev(true));
await sleep(1500); // a person looks at the title
await press('.title-btn', '^New Realm$');
await ev(async () => { const m = await import(new URL('tools/firstHourProbe.js', document.baseURI).href); await m.installFirstHourProbe(); });
log(`New Realm pressed (seed ${SEED}, ${PHONE ? 'phone' : 'desktop'} ${W}x${H}); playing ${MINUTES} min`);

const run = { seed: SEED, variant: PHONE ? 'phone' : 'desktop', minutes: MINUTES, label: LABEL, battles: 0, forced: 0, events: [], notes: [] };
const save = async (final) => {
  run.events = await ev(() => window.__fh.events).catch(() => run.events);
  run.unlocked = await ev(() => window.__fh.unlocked).catch(() => run.unlocked);
  await writeFile(`${OUT}/firstHour-${LABEL}.json`, JSON.stringify(run, null, 1));
  if (final) await writeFile(`${OUT}/firstHour-${LABEL}.txt`, render(run));
};
const probeT = () => ev(() => (performance.now() - window.__fh.t0) / 1000);

const battle = { key: null, since: 0, fired: false, rallied: false };
const hintAt = new Map(); // hint id -> when the bot first saw it
const handled = new Map(); // modal / toast key -> the time the bot answered it
let lastShop = -1e9;
let idleUntil = 0;
let noTargetSince = null;
let offerN = 0;
let savedAt = 0;
let shotMin = 0;
let stuck = 0;
while (true) {
  try { if (await step()) break; stuck = 0; } catch (err) {
    stuck += 1;
    log(`  ERROR ${err && err.message} (${stuck} in a row)`);
    run.notes.push(`${clock()} ${err && err.message}`);
    await page.screenshot(`${OUT}/firstHour-${LABEL}-stuck-${stuck}.png`).catch(() => {});
    if (stuck >= 4) { log('  STUCK: giving up'); run.stuck = true; break; }
    await sleep(3000);
  }
}
async function step() {
  const t = await probeT();
  if (t >= MINUTES * 60) return true;
  for (const e of await ev(() => window.__fh.drain())) log(`${(e.t / 60).toFixed(2).padStart(6)}m ${e.kind.padEnd(6)} ${e.sub.padEnd(14)} ${e.text.slice(0, 90)}${e.repeat ? ' (REPEAT)' : ''}`);
  if (Date.now() - savedAt > 30000) { savedAt = Date.now(); await save(false); }
  if (Math.floor(t / 600) > shotMin) { shotMin = Math.floor(t / 600); await page.screenshot(`${OUT}/firstHour-${LABEL}-${shotMin * 10}min.png`); }
  const s = await ev(() => {
    const vis = (el) => !!el && !el.hidden && !el.closest('[hidden]') && el.getClientRects().length > 0;
    const M = [['results', '.results-card'], ['draft', '.boon-draft'], ['duo', '.duo-reveal'], ['relic', '.relic-claim'], ['welcome', '.welcome-card'], ['ceremony', '.ceremony'], ['modal', '.modal-backdrop']];
    const modal = M.find(([, sel]) => [...document.querySelectorAll(sel)].some(vis));
    const panel = ['.council', '.realm', '.regions', '.generals', '.settings', '.codex', '.challenge-hub'].find((sel) => vis(document.querySelector(sel)));
    const offer = [...document.querySelectorAll('.toast.is-event:not(.is-out)')].map((n) => n.dataset.id)[0] || null;
    const step = window.__hd.services.tutorial.current;
    const coach = document.querySelector('.coach');
    const hd = window.__hd;
    return { scene: hd.scene, phase: hd.battlePhase, modal: modal ? modal[0] : null, panel, offer, hint: coach && !coach.hidden && step ? step.id : null,
      battleKey: hd.battle ? `${hd.battle.regionId ?? ''}:${hd.battle.kind ?? ''}:${hd.battles?.focusedId ?? ''}` : null, battleT: hd.battle ? hd.battle.t : 0 };
  });
  for (const k of ['results', 'draft', 'duo', 'relic', 'welcome', 'ceremony', 'modal']) if (s.modal !== k) handled.delete(k); // closed: the next one is new

  // 1. a modal moment: read it, then press its way on
  if (s.modal) {
    const k = `${s.modal}`;
    const at = handled.get(k);
    if (at != null && t - at < 6) { await sleep(500); return false; }
    if (at != null && t - at > 20) { log(`  ${k} still open after 20 s: Escape`); await key('Escape'); handled.set(k, t); return false; }
    await sleep(s.modal === 'draft' ? 3500 : 2200);
    if (s.modal === 'results') { await press('.results-action', '^(Continue|Back to Map)'); run.battles += 1; }
    else if (s.modal === 'draft') await press('.boon-card');
    else if (s.modal === 'duo' || s.modal === 'relic') await press(s.modal === 'duo' ? '.duo-reveal' : '.relic-claim');
    else if (s.modal === 'welcome') await press('.welcome-collect');
    else if (s.modal === 'modal') { offerN += 1; if (!(await press('.modal-backdrop .modal-actions .btn-primary'))) await key('Escape'); }
    else await key('Escape');
    handled.set(k, t);
    return false;
  }
  if (s.panel) { await key('Escape'); await sleep(500); return false; } // a panel the bot did not mean to leave open
  // 2. a world event's offer: read it, then accept every other one and decline the rest
  if (s.offer && !handled.has(`offer:${s.offer}`)) {
    await sleep(2500);
    offerN += 1;
    const accept = offerN % 2 === 1;
    const ok = accept ? await press(`.toast.is-event .toast-action:not(.toast-secondary)`) : (await press('.toast.is-event .toast-secondary')) || (await press('.toast.is-event .toast-close'));
    log(`  offer ${s.offer}: ${accept ? 'accept' : 'decline'} (${ok ? 'pressed' : 'no button'})`);
    handled.set(`offer:${s.offer}`, t);
    return false;
  }
  // 3. a battle we are watching
  if (s.scene === 'battle') {
    if (s.battleKey !== battle.key) Object.assign(battle, { key: s.battleKey, since: t, fired: false, rallied: false, lastSend: 0, loggedAt: t });
    if (t - battle.since > 360 && s.phase === 'live') { log('  FORCED: the battle ran 6 min of real time'); run.forced += 1; await ev(() => window.__hd.winBattle()); battle.since = t; }
    if (t - (battle.loggedAt || battle.since) > 45) {
      battle.loggedAt = t;
      log(`  battle ${await ev(() => { const hd = window.__hd; const all = hd.siteInfo ? hd.siteInfo() : []; const own = all.filter((x) => x.owner === 0); return `t=${Math.round(hd.battle?.t || 0)}s ${hd.battlePhase}: ours ${own.length} sites ${Math.round(own.reduce((a, x) => a + x.troops, 0))} troops, theirs ${all.length - own.length}`; })}`);
    }
    await bot.battleStep(battle);
    await sleep(700);
    return false;
  }
  if (s.scene !== 'world') { await sleep(500); return false; }
  // 4. the map: read a new hint first (W0 is read to its end), do what it asks when it is quick, then attack, shop or wait
  if (s.hint) {
    if (!hintAt.has(s.hint)) hintAt.set(s.hint, t);
    if (t - hintAt.get(s.hint) < 3 || s.hint === 'W0') { await sleep(500); return false; }
  }
  if (s.hint === 'W1' && !handled.has('W1')) {
    handled.set('W1', t); await sleep(1500);
    await bot.drag({ x: W * 0.35, y: H * 0.55 }, { x: W * 0.45, y: H * 0.5 });
    if (!PHONE) await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: W * 0.4, y: H * 0.5, deltaX: 0, deltaY: -120 });
    await sleep(800); return false;
  }
  if (s.hint === 'M1' || (t - lastShop > 180 && t > 120)) { lastShop = t; await sleep(1200); await bot.shop(s.hint === 'M1' ? 'hint M1' : 'every 3 min'); return false; }
  if (s.hint && ['M2', 'M3', 'M4', 'F1', 'F4'].includes(s.hint) && !handled.has(`hint:${s.hint}`)) {
    handled.set(`hint:${s.hint}`, t); await sleep(6000); // read it; not now
    if (await press('.coach-dismiss')) log(`  dismissed hint ${s.hint}`);
    return false;
  }
  if (t < idleUntil || t < 6) { await sleep(800); return false; } // the first seconds: a new player looks at their realm
  // nothing Easy or Fair for 2 minutes: a person tries the best Hard one
  let target = await bot.pickTarget();
  if (target) noTargetSince = null;
  else if (noTargetSince == null) noTargetSince = t;
  if (!target && t - noTargetSince > 120) { target = await bot.pickTarget(true); if (target) noTargetSince = t; } // and again 2 min later
  if (!target) { log('  nothing Easy or Fair: shopping, then waiting 30 s'); if (t - lastShop > 45) { lastShop = t; await bot.shop('no target'); } idleUntil = t + 30; return false; }
  await sleep(1500); // a person looks at the map first, and reads a hint that has just come up
  const hintNow = await ev(() => { const c = document.querySelector('.coach'); const st = window.__hd.services.tutorial.current; return c && !c.hidden && st ? st.id : null; });
  if (hintNow && !['W2', 'W3'].includes(hintNow) && !hintAt.has(hintNow)) return false;
  if (!(await bot.attack(target))) idleUntil = t + 15;
  else await sleep(2500);
}

await save(true);
const a = analyse(run);
console.log(`\n${render(run, a)}`);
console.log(`\nbattles ${run.battles} (forced ${run.forced}); console errors ${errors.length}${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await page.close();
const pass = Object.values(a.pass).every(Boolean) && !errors.length;
process.exit(flags.assert && !pass ? 1 : 0);
