// Play your way, desktop part 1 (tools/optionsChecks.mjs): each colour-vision preset by a real press, with the CIEDE2000 assertion on the colours
// the page actually paints; the pattern overlay; high contrast's measured 7:1; the Effects slider by keyboard and its effect on the fx.

/** Measured in the page: the computed text colour of `sel` against the first opaque background behind it (WCAG contrast). */
const measureContrast = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  let bg = null;
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    const c = rgb(getComputedStyle(n).backgroundColor);
    if (c.length >= 3 && (c.length === 3 || c[3] >= 0.99)) { bg = c; break; }
  }
  const fg = rgb(getComputedStyle(el).color);
  if (!bg) return { ratio: 0, fg, bg };
  const a = lum(fg); const b = lum(bg);
  return { ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10, fg, bg };
};

export async function presetChecks({ t, ok, sleep, tag, q, shot, openSettings, closeSettings, liveSeparation }) {
  ok(await openSettings(), tag('a press on the gear opens Settings'));
  const rows = await q(() => ({
    palettes: document.querySelectorAll('.opt-palettes .opt-radio').length,
    display: !!document.querySelector('.opt-display'), controls: !!document.querySelector('.opt-controls'),
    voices: !!document.querySelector('.opt-voices-row input[type=range]'), radiogroup: document.querySelector('.opt-palettes').getAttribute('role'),
  }));
  ok(rows.palettes === 3 && rows.display && rows.controls && rows.voices && rows.radiogroup === 'radiogroup', tag(`Settings has Display (3 colour presets, a radiogroup), Controls and a Voices slider (${JSON.stringify(rows)})`));
  await q(() => document.querySelector('.opt-display').scrollIntoView({ block: 'start' }));
  await sleep(200);
  await shot('01-settings-display');

  const want = await q(async () => { const P = await import(new URL('game/config/palettes.js', document.baseURI).href); return { bar: P.PALETTE_BAR, nbar: P.PALETTE_NORMAL_BAR, deutan: P.PALETTES.deutan, tritan: P.PALETTES.tritan }; });
  for (const id of ['deutan', 'tritan', 'default']) {
    ok(await t.clickSel(`.opt-radio[data-value="${id}"]`), tag(`a press on the ${id} preset`));
    await sleep(300);
    const s = await q(liveSeparation);
    const opt = await q(() => window.__hd.options().palette);
    const checked = await q((v) => document.querySelector(`.opt-radio[data-value="${v}"]`).getAttribute('aria-checked'), id);
    ok(opt === id && checked === 'true', tag(`${id}: chosen (option ${opt}, aria-checked ${checked})`));
    if (id === 'default') {
      ok(s.cols[0] === '#3d7ef0' && s.out.normal >= 20, tag(`default: the original colours are back (player ${s.cols[0]}, normal ${s.out.normal})`));
    } else {
      const p = want[id];
      const same = s.cols.every((c, i) => c === p.colors[i].color) && s.world.every((c, i) => c === p.colors[i].color);
      ok(same && s.css === p.colors[0].color, tag(`${id}: all eight factions repainted, the world's copies and the CSS token too (${s.css})`));
      for (const kind of p.targets) ok(s.out[kind] >= want.bar, tag(`${id}: every pair clears CIEDE2000 ${want.bar} under ${kind} (min ${s.out[kind]})`));
      ok(s.out.normal >= want.nbar, tag(`${id}: and ${want.nbar} under normal vision (min ${s.out.normal})`));
      await closeSettings();
      await sleep(900); // the time-boxed re-bake of the territory chunks
      await shot(`02-map-${id}`);
      await openSettings();
    }
  }

  // the pattern overlay: on, the map re-bakes; a shot under the deutan preset
  ok(await t.clickSel('.settings-toggle[data-option="patterns"]'), tag('a press on Territory patterns'));
  await sleep(200);
  ok(await q(() => window.__hd.options().patterns === true), tag('patterns are on'));
  await t.clickSel('.opt-radio[data-value="deutan"]');
  await closeSettings();
  await sleep(1000);
  const baked = await q(() => window.__hd.renderer.terrain.bakedChunkCount());
  ok(baked > 0, tag(`the map re-baked its territory with the patterns (${baked} chunks)`));
  await q(() => window.__hd.camera.zoomAt(1.8, innerWidth / 2, innerHeight / 2));
  await sleep(900);
  await shot('03-map-deutan-patterns');
  await openSettings();
  await t.clickSel('.settings-toggle[data-option="patterns"]');
  await t.clickSel('.opt-radio[data-value="default"]');

  // high contrast: opaque panels, body text measured at 7:1 or better
  const before = await q(measureContrast, '.settings-row-label');
  ok(await t.clickSel('.settings-toggle[data-option="highContrast"]'), tag('a press on High contrast'));
  await sleep(300);
  const hc = await q(() => ({ cls: document.documentElement.classList.contains('high-contrast'), bg: getComputedStyle(document.querySelector('.settings')).backgroundColor, blur: getComputedStyle(document.querySelector('.settings')).backdropFilter }));
  const after = await q(measureContrast, '.settings-row-label');
  const note = await q(measureContrast, '.settings-note');
  ok(hc.cls && /rgb\(\s*6,\s*8,\s*13\s*\)|rgba\(\s*6,\s*8,\s*13,\s*1\s*\)/.test(hc.bg) && (hc.blur === 'none' || !hc.blur), tag(`high contrast: an opaque panel with no blur (${hc.bg}, ${hc.blur})`));
  ok(after && after.ratio >= 7 && (!note || note.ratio >= 7), tag(`high contrast: body text ${after && after.ratio}:1, notes ${note && note.ratio}:1 (was ${before && before.ratio}:1)`));
  await shot('04-settings-high-contrast');
  ok(await t.clickSel('.settings-toggle[data-option="highContrast"]') && await q(() => !document.documentElement.classList.contains('high-contrast')), tag('a second press turns high contrast off'));

  // Effects: the slider by keyboard (Full -> Minimal), and Minimal spawns fewer particles and no shake
  const slider = '.opt-effects-row input[type=range]';
  await q((s) => { const e = document.querySelector(s); e.scrollIntoView({ block: 'center' }); e.focus(); }, slider);
  await t.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await t.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await sleep(150);
  await t.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await t.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await sleep(250);
  const eff = await q((s) => ({ o: window.__hd.options().effects, vt: document.querySelector(s).getAttribute('aria-valuetext') }), slider);
  ok(eff.o === 'minimal' && eff.vt === 'Minimal', tag(`the Effects slider reaches Minimal by keyboard (${eff.o}, "${eff.vt}")`));
  const counts = await q(async () => {
    const A = await import(new URL('game/render/accessibility.js', document.baseURI).href);
    const { createFx } = await import(new URL('game/render/fx.js', document.baseURI).href);
    const run = (lvl) => { A.setEffects(lvl); const fx = createFx(); fx.spawn('sparks', 0, 0); fx.spawn('burst', 0, 0); fx.spawn('embers', 0, 0); fx.shake(1, 0.5); const n = fx.count(); const sh = fx.shakeOffset(); fx.update(0.05); return { n, shake: Math.abs(sh.x) + Math.abs(sh.y) + Math.abs(fx.shakeOffset().x) }; };
    const r = { full: run('full'), reduced: run('reduced'), minimal: run('minimal') };
    A.setEffects(window.__hd.options().effects);
    return r;
  });
  ok(counts.minimal.n < counts.reduced.n && counts.reduced.n < counts.full.n && counts.minimal.n > 0 && counts.minimal.shake === 0 && counts.full.shake > 0,
    tag(`Effects scale the particles (full ${counts.full.n}, reduced ${counts.reduced.n}, minimal ${counts.minimal.n}) and Minimal has no shake`));
  await q(() => window.__hd.setOption('effects', 'full'));
  await closeSettings();
}
