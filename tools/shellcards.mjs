// Generates the SHELL images: the social preview card and the two PNG app icons.
//
//   node tools/shellcards.mjs
//
// These are the only binary assets in the repo, and they are GENERATED rather
// than drawn, for the same reason everything else here is: there is no build step
// and no dependency budget, so an asset that cannot be regenerated from source by
// one command is an asset nobody will ever update. Chromium is already present
// for tools/smoke.mjs; this borrows it.
//
// The card and the icons are drawn from the ACTUAL TOKENS in
// src/styles/tokens.css, parsed out of the file rather than retyped, so a palette
// change lands in the share preview the next time this is run — and
// tests/shell.test.js fails if the committed favicon has drifted from the tokens
// in the meantime.
import { readFile, writeFile } from 'node:fs/promises';
import { launch } from './cdp.js';

const ROOT = new URL('..', import.meta.url).pathname;

/** Pull a handful of custom properties straight out of the token file. */
async function tokens() {
  const css = await readFile(`${ROOT}src/styles/tokens.css`, 'utf8');
  const pick = (name, fallback) => {
    const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
    return m ? m[1].trim() : fallback;
  };
  return {
    bg: pick('c-bg', '#0b0d12'),
    surface: pick('c-surface', '#12151d'),
    line: pick('c-line', '#263041'),
    text: pick('c-text', '#e7ebf3'),
    dim: pick('c-text-dim', '#93a0b8'),
    player: pick('c-player', '#3ddc97'),
    enemy: pick('c-enemy', '#ff5c5c'),
    gold: pick('c-gold', '#ffc857'),
  };
}

const card = (t) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1200px;height:630px;overflow:hidden}
  body{background:${t.bg};color:${t.text};
    font:500 16px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    display:flex;flex-direction:column;justify-content:center;padding:0 84px;
    box-sizing:border-box;position:relative}
  /* The board's own geometry, at 3% — the same weave the DOM screens carry. */
  .weave{position:absolute;inset:0;opacity:.05;
    background:
      repeating-linear-gradient(60deg,${t.text} 0 1px,transparent 1px 46px),
      repeating-linear-gradient(-60deg,${t.text} 0 1px,transparent 1px 46px),
      repeating-linear-gradient(0deg,${t.text} 0 1px,transparent 1px 80px)}
  .glow{position:absolute;right:-140px;top:-140px;width:620px;height:620px;
    border-radius:50%;background:radial-gradient(circle,
      color-mix(in srgb,${t.player} 26%,transparent) 0%,transparent 66%)}
  h1{margin:0;font:700 92px/1 system-ui,sans-serif;letter-spacing:-.03em;
    position:relative}
  h1 em{font-style:normal;color:${t.player}}
  p{margin:22px 0 0;font-size:30px;color:${t.dim};max-width:20ch;position:relative}
  .marks{display:flex;gap:14px;margin-top:44px;position:relative}
  .mark{width:64px;height:72px;
    clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);
    background:${t.surface};border:0;position:relative}
  .mark.p{background:color-mix(in srgb,${t.player} 52%,${t.surface})}
  .mark.e{background:color-mix(in srgb,${t.enemy} 46%,${t.surface})}
  .mark.g{background:color-mix(in srgb,${t.gold} 40%,${t.surface})}
  .foot{position:absolute;left:84px;bottom:56px;color:${t.dim};font-size:22px;
    letter-spacing:.12em;text-transform:uppercase}
</style></head><body>
  <div class="weave"></div><div class="glow"></div>
  <h1>HEX <em>DOMINION</em></h1>
  <p>Idle conquest. Real-time battles. No dice.</p>
  <div class="marks"><span class="mark p"></span><span class="mark e"></span>
    <span class="mark"></span><span class="mark g"></span><span class="mark p"></span></div>
  <div class="foot">Plays in a browser · zero downloads</div>
</body></html>`;

const iconPage = async (px) => {
  const svg = await readFile(`${ROOT}favicon.svg`, 'utf8');
  // The SAME favicon, scaled — so the tab, the home screen and the manifest can
  // never show three different marks.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:${px}px;height:${px}px;overflow:hidden}
    svg{width:${px}px;height:${px}px;display:block}
  </style></head><body>${svg}</body></html>`;
};

async function shoot(html, width, height, out) {
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  const page = await launch({ url, width, height });
  try {
    // `--window-size` is NOT the viewport: headless Chromium still reserves
    // chrome, so `Page.captureScreenshot` came back 1200x490 for a 1200x630
    // window and cut the footer off the card. The metrics override is what makes
    // the capture exactly the size an og:image has to be — the same call
    // tools/mobile.mjs uses to hold a phone size.
    await page.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    });
    await page.sleep(400);
    await page.screenshot(out);
    console.log(`  wrote ${out.replace(ROOT, '')} (${width}x${height})`);
  } finally {
    await page.close();
  }
}

const t = await tokens();
console.log('\n  shell cards, from src/styles/tokens.css:');
await shoot(card(t), 1200, 630, `${ROOT}og.png`);
await shoot(await iconPage(512), 512, 512, `${ROOT}icon-512.png`);
await shoot(await iconPage(192), 192, 192, `${ROOT}icon-192.png`);
console.log('');
