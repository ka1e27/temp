// Real-browser checks for Play your way (PLAN-PHASE14 §14B), run by tools/check.mjs (`--only=options`). Desktop 1440x900 (presets, patterns,
// high contrast, Effects, the keyboard map, hold to confirm, the volume sliders, persistence) and a 360x740 phone (text sizes fit: optionsFitChecks.mjs).
// Real presses and keys for everything a player does; dev hooks only to stage and to read. Shots go to screenshots/phase14/ unless PHASE14_SHOTS=0.
import { mkdir } from 'node:fs/promises';
import { makeOpen } from './robustChecks.mjs';
import { fitChecks } from './optionsFitChecks.mjs';

export const OUT = 'screenshots/phase14';
const VK = { Escape: 27, Enter: 13, Space: 32, ArrowRight: 39, ArrowLeft: 37, Digit1: 49, Digit2: 50, KeyZ: 90, KeyW: 87, KeyQ: 81 };

/** Helpers shared with the phone checks. */
export function helpers(t, sleep, name) {
  const q = (fn, ...a) => t.page.eval(fn, ...a);
  const shoot = process.env.PHASE14_SHOTS !== '0';
  const shot = async (n) => { if (shoot) { await t.page.screenshot(`${OUT}/${name}-${n}.png`); console.log(`  shot ${OUT}/${name}-${n}.png`); } };
  const key = async (code, k = code.replace(/^Key|^Digit/, '').toLowerCase()) => {
    const vk = VK[code] || 0;
    const kk = code === 'Space' ? ' ' : code.startsWith('Key') || code.startsWith('Digit') ? k : code;
    await t.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: kk, code, windowsVirtualKeyCode: vk, ...(kk.length === 1 ? { text: kk } : {}) });
    await t.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: kk, code, windowsVirtualKeyCode: vk });
    await sleep(160);
  };
  /** A held press on the first visible match of `sel` (mouse), `ms` long. */
  const hold = async (sel, ms) => {
    const p = await q((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.getClientRects().length && !x.closest('[hidden]')); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    if (!p) return false;
    await t.page.mouse('mouseMoved', p.x, p.y, 'none', 0);
    await t.page.mouse('mousePressed', p.x, p.y, 'left', 1);
    await sleep(ms);
    await t.page.mouse('mouseReleased', p.x, p.y, 'left', 0);
    return true;
  };
  const openSettings = async () => {
    await t.clickSel(name.startsWith('phone') ? '.hud .btn-icon[aria-label="Settings"]' : '.hud .btn-icon[aria-label="Settings"]');
    return t.waitFor(() => { const s = document.querySelector('.settings'); return !!s && !s.hidden; }, 4000);
  };
  const closeSettings = async () => { await t.clickSel('.settings-close'); await sleep(250); };
  return { q, shot, key, hold, openSettings, closeSettings };
}

/** In the page: the live faction colours' minimum CIEDE2000 under each kind of vision. */
const liveSeparation = () => (async () => {
  const W = await import(new URL('game/config/world.js', document.baseURI).href);
  const C = await import(new URL('game/core/colorDistance.js', document.baseURI).href);
  const cols = W.FACTIONS.map((f) => f.color);
  const out = {};
  for (const kind of ['normal', 'deutan', 'protan', 'tritan']) {
    let m = Infinity;
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) m = Math.min(m, C.dist(cols[i], cols[j], kind));
    out[kind] = Math.round(m * 10) / 10;
  }
  return { out, cols, world: window.__hd.world.factions.map((f) => f.color), css: getComputedStyle(document.documentElement).getPropertyValue('--faction-player').trim() };
})();

async function desktop(open, BASE, ok, sleep, allErrors) {
  const t = await open(`${BASE}/index.html?dev=1&seed=7`, { width: 1440, height: 900 });
  const tag = (s) => `options desktop: ${s}`;
  const { q, shot, key, hold, openSettings, closeSettings } = helpers(t, sleep, 'desktop');
  try {
    ok(await t.atTitle(), tag('boots'));
    ok(await t.clickText('button', 'New Realm'), tag('New Realm'));
    ok(await t.waitFor(() => window.__hd.scene === 'world', 40000), tag('the world is up'));
    await q(() => { const hd = window.__hd; hd.hideDev(true); hd.state.settings.hints = false; hd.conquerRegions(4); hd.revealMap?.(); });
    await sleep(900);
    const { presetChecks } = await import('./optionsPresetChecks.mjs');
    await presetChecks({ t, ok, sleep, tag, q, shot, openSettings, closeSettings, liveSeparation });
    const { controlChecks } = await import('./optionsControlChecks.mjs');
    await controlChecks({ t, ok, sleep, tag, q, shot, key, hold, openSettings, closeSettings });
    // persistence: a reload keeps the options (their own storage key) and applies them before the first frame
    await q(() => { window.__hd.setOption('palette', 'tritan'); window.__hd.setOption('textSize', 'large'); window.__hd.setOption('effects', 'reduced'); });
    await t.page.goto(`${BASE}/index.html?dev=1&seed=7`);
    ok(await t.atTitle(), tag('reloads'));
    const kept = await q(async () => {
      const W = await import(new URL('game/config/world.js', document.baseURI).href);
      const P = await import(new URL('game/config/palettes.js', document.baseURI).href);
      const o = window.__hd.options();
      return { o, player: W.FACTIONS[0].color, want: P.PALETTES.tritan.colors[0].color, font: document.documentElement.style.fontSize, ds: document.documentElement.dataset.textSize };
    });
    ok(kept.o.palette === 'tritan' && kept.player === kept.want && kept.o.textSize === 'large' && kept.font === '112.5%' && kept.o.effects === 'reduced',
      tag(`a reload keeps and applies the options (palette ${kept.o.palette}, player ${kept.player}, text ${kept.ds} ${kept.font}, effects ${kept.o.effects})`));
    await q(() => { for (const [k, v] of Object.entries({ palette: 'default', textSize: 'normal', effects: 'full', patterns: false, highContrast: false, holdToConfirm: false })) window.__hd.setOption(k, v); });
    const errs = t.unexpected();
    ok(errs.length === 0, tag(`no console errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`));
    allErrors.push(...errs);
  } finally {
    await t.page.close();
  }
}

export async function optionsChecks({ launch, BASE, ok, sleep, allErrors }) {
  console.log('\n== options (Play your way): presets, patterns, text size, high contrast, Effects, keys, hold to confirm, audio ==');
  if (process.env.PHASE14_SHOTS !== '0') await mkdir(OUT, { recursive: true });
  const open = makeOpen(launch, sleep);
  await desktop(open, BASE, ok, sleep, allErrors);
  await fitChecks({ open, BASE, ok, sleep, allErrors, helpers });
}
