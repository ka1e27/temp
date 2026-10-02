// In-page measurement of icon-only buttons: how far is the VISIBLE box of each icon from the centre of its button, and does the button sit inside its
// bar? Loaded into the running game by tools/iconcheck.mjs and tools/check.mjs. Browser only.

const isShown = (el) => !!el && el.getClientRects().length > 0 && !el.closest('[hidden]') && getComputedStyle(el).visibility !== 'hidden';

/** The centre of what is actually drawn inside a button: the icon's content box (SVG getBBox through its viewBox), or the glyph's text box. */
function glyphCentre(button) {
  const svg = button.querySelector('svg');
  if (svg && isShown(svg)) {
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal : { x: 0, y: 0, width: r.width, height: r.height };
    let bb = null;
    try { bb = svg.getBBox(); } catch { bb = null; }
    if (!bb || !bb.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2, via: 'svg box' };
    return { x: r.left + ((bb.x + bb.width / 2 - vb.x) / vb.width) * r.width, y: r.top + ((bb.y + bb.height / 2 - vb.y) / vb.height) * r.height, via: 'svg content' };
  }
  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  if (node && node.textContent.trim()) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, via: 'text' };
  }
  return null;
}

/**
 * The button's real HIT size: how far from its centre, left/right and up/down, `document.elementFromPoint` still answers with the button (or something inside
 * it), probed 1 px at a time (up to 40 px each way). An invisible pseudo-element that enlarges the target counts, exactly as it does for a finger. A probe that
 * leaves the viewport counts as a hit (it cannot be tested).
 */
function hitSize(b) {
  const r = b.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const hits = (x, y) => {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return true;
    const e = document.elementFromPoint(x, y);
    return !!e && (e === b || b.contains(e));
  };
  const reach = (dx, dy) => { let n = 0; while (n < 40 && hits(cx + dx * (n + 1), cy + dy * (n + 1))) n += 1; return n; };
  return { w: reach(-1, 0) + reach(1, 0) + 1, h: reach(0, -1) + reach(0, 1) + 1 };
}

const describe = (b) => `${b.tagName.toLowerCase()}.${[...b.classList].slice(0, 3).join('.')}${b.getAttribute('aria-label') ? `[${b.getAttribute('aria-label')}]` : ''}`;

/**
 * Every visible icon-only button (an SVG or a one-glyph label, no words) with the offset of its glyph from its centre, and the bar it sits in.
 * @returns {Array<{ el: string, w: number, h: number, hitW: number, hitH: number, coarse: boolean, dx: number, dy: number, via: string, bar: string|null, outside: number }>}
 */
export function measureIconButtons() {
  const out = [];
  for (const b of document.querySelectorAll('button')) {
    if (!isShown(b)) continue;
    const label = (b.textContent || '').trim();
    const hasSvg = !!b.querySelector('svg');
    if (hasSvg ? label.length > 0 : label.length === 0 || label.length > 2) continue; // words: not icon-only
    const c = glyphCentre(b);
    if (!c) continue;
    const r = b.getBoundingClientRect();
    // the bar it belongs to: the HUD bar, a panel header... (how far the button pokes out of it)
    const bar = b.closest('.hud-bar, .hud, .battle-topright, .council-header, .realm-header, .settings-header, .modal-header, .toast, .coach-bubble');
    let outside = 0;
    if (bar) {
      const br = bar.getBoundingClientRect();
      outside = Math.max(0, br.left - r.left, r.right - br.right, br.top - r.top, r.bottom - br.bottom);
    }
    const hit = hitSize(b);
    out.push({
      hitW: hit.w, hitH: hit.h, coarse: matchMedia('(pointer: coarse)').matches,
      el: describe(b), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
      dx: Math.round((c.x - (r.left + r.width / 2)) * 100) / 100, dy: Math.round((c.y - (r.top + r.height / 2)) * 100) / 100,
      via: c.via, bar: bar ? describe(bar) : null, outside: Math.round(outside * 10) / 10,
    });
  }
  return out;
}
