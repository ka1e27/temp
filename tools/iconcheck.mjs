// Icon-only buttons must have their icon CENTRED (visible box centre within 1 px of the button centre) and sit fully INSIDE their bar. Opens the
// HUD, the council, the realm panel, settings, a modal, a toast, a hint and a battle, at a desktop size, a phone and a landscape phone, and measures
// every icon-only button it can see (tools/iconMetrics.js).
//   npm start   # in another terminal
//   node tools/iconcheck.mjs [--url=http://localhost:8080] [--tag=before]       exit 1 on any miss (unless --tag=before)
if (!process.env.CHROME_PATH && process.platform === 'win32') process.env.CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { launch } = await import('./cdp.js');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
const BASE = flags.url || 'http://localhost:8080';
const TAG = flags.tag || 'run';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOL = 1; // px
const TOUCH = 44; // px: the smallest hit area of a button on a coarse pointer (a finger)

let bad = 0;
for (const vp of [{ name: '1440x900', w: 1440, h: 900, touch: false }, { name: '390x844', w: 390, h: 844, touch: true }, { name: '844x390', w: 844, h: 390, touch: true }]) {
  const page = await launch({ url: 'about:blank', width: vp.w, height: vp.h });
  await page.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.touch });
  if (vp.touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.goto(`${BASE}/index.html?dev=1&seed=7`);
  for (let i = 0; i < 100; i++) { if (await page.eval(() => !!window.__hd && window.__hd.scene === 'title')) break; await sleep(100); }
  await page.eval(() => window.__hd.hideDev(true));
  const measure = () => page.eval(async () => { const m = await import(new URL('tools/iconMetrics.js', document.baseURI).href); return m.measureIconButtons(); });
  const seen = new Map();
  const grab = async (label) => { for (const r of await measure()) { if (!seen.has(r.el)) seen.set(r.el, { ...r, where: label }); } };
  const tap = async (x, y) => {
    if (vp.touch) { await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await sleep(70); await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else { await page.mouse('mouseMoved', x, y, 'none', 0); await page.mouse('mousePressed', x, y, 'left', 1); await sleep(50); await page.mouse('mouseReleased', x, y, 'left', 0); }
  };
  const click = async (sel, text) => {
    const c = await page.eval((s, t) => {
      const els = [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length && !e.closest('[hidden]'));
      const el = t ? els.find((e) => (e.textContent + (e.getAttribute('aria-label') || '')).toLowerCase().includes(t.toLowerCase())) : els[0];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, sel, text);
    if (c) await tap(c.x, c.y);
    return !!c;
  };
  await sleep(1500);
  await grab('title');
  await click('.title-actions button', 'New Realm');
  for (let i = 0; i < 60; i++) { if (await page.eval(() => window.__hd.scene === 'world')) break; await sleep(100); }
  await sleep(2500);
  await grab('world and the first hint');
  await page.eval(() => window.__hd.openCouncil()); await sleep(900); await grab('council'); await click('.council-close'); await sleep(500);
  await click('.hud-btn', 'Realm'); await sleep(900); await grab('realm'); await click('.realm-close'); await sleep(500);
  await click('button', 'Settings'); await sleep(900); await grab('settings');
  await click('.btn-danger', 'Reset'); await sleep(700); await grab('modal'); await click('.modal-close'); await sleep(400);
  await click('.settings-close'); await sleep(500);
  await page.eval(() => window.__hd.services.ui.toasts.update({ type: 'info', message: 'A toast to measure' })); await sleep(600); await grab('toast');
  const id = await page.eval(async () => { const { tutorialRegionId } = await import(new URL('game/meta/intel.js', document.baseURI).href); return tutorialRegionId(window.__hd.state, window.__hd.world); });
  await page.eval((rid) => window.__hd.startBattle(rid), id);
  for (let i = 0; i < 100; i++) { if (await page.eval(() => window.__hd.scene === 'battle' && window.__hd.battlePhase === 'live')) break; await sleep(150); }
  await sleep(1200);
  await grab('battle');
  await page.close();
  console.log(`\n== ${vp.name} ==`);
  for (const r of seen.values()) {
    const off = Math.max(Math.abs(r.dx), Math.abs(r.dy));
    const problems = [];
    if (off > TOL) problems.push(`icon off centre by ${r.dx}, ${r.dy}`);
    if (r.outside > 0.5) problems.push(`pokes ${r.outside} px out of its bar (${r.bar})`);
    if (r.coarse && Math.min(r.hitW, r.hitH) < TOUCH - 0.5) problems.push(`touch hit area ${r.hitW}x${r.hitH} is under ${TOUCH} px`);
    bad += problems.length;
    console.log(`  ${problems.length ? 'FAIL' : 'ok  '} ${r.el.padEnd(46)} ${r.w}x${r.h} hit ${r.hitW}x${r.hitH}${r.coarse ? ' (touch)' : ''} ${r.via.padEnd(11)} d=(${r.dx}, ${r.dy}) [${r.where}]${problems.length ? `  ${problems.join('; ')}` : ''}`);
  }
}
console.log(bad ? `\n${bad} problem(s)${TAG === 'before' ? ' (a run against an older build: not failing)' : ''}` : '\nALL ICONS CENTRED, AND EVERY TOUCH TARGET IS AT LEAST 44 px');
process.exit(bad && TAG !== 'before' ? 1 : 0);
