// Screen boxes for tutorial hints (PLAYFEEL §4 placement rules). A hint's pointer must END within 8 px of its target's on-screen BOX, so
// "the box" is one definition shared by the game (game/ui/coach.js places the pointer against it) and by the placement monitor
// (tools/hintMonitor.js measures against it). Pure: plain objects in, plain objects out.

/** A box is { x, y, w, h } in CSS px (x, y = top-left). */

/** Half-size of a settlement's box: its sprite and troop badge, scaling with the camera zoom, never smaller than a finger. */
export function siteHalf(zoom) {
  return Math.max(22, 0.62 * zoom);
}

/** The box of a settlement whose sprite centre is at screen point `p`. */
export function siteBox(p, zoom) {
  const r = siteHalf(zoom);
  return { x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r };
}

/** The box of a region's map label (its name at the region's anchor). */
export function regionLabelBox(p) {
  return { x: p.x - 52, y: p.y - 14, w: 104, h: 28 };
}

/**
 * The box a hint about a REGION must not cover: the region's own on-screen extent (its tiles plus about a hex of margin), not just its name. The player is looking for
 * the glowing REGION, so a bubble beside the label still sat on it. Clipped to the viewport; when the region is most of the screen (zoomed in close) the part round the label,
 * so there is always a side left for the bubble.
 * @param {{ minX: number, minY: number, maxX: number, maxY: number }} bbox the region's tile-centre extent in world units (region.bbox)
 * @param {(x: number, y: number) => { x: number, y: number }} toScreen camera.worldToScreen
 * @param {{ w: number, h: number }} v viewport
 * @param {{ x: number, y: number }} label the region label's screen point
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function regionHintBox(bbox, toScreen, v, label) {
  const m = 1.15; // the reach of a hex beyond its centre, in world units
  const a = toScreen(bbox.minX - m, bbox.minY - m - 0.4);
  const b = toScreen(bbox.maxX + m, bbox.maxY + m);
  let x0 = Math.max(0, Math.min(a.x, b.x));
  let y0 = Math.max(0, Math.min(a.y, b.y));
  let x1 = Math.min(v.w, Math.max(a.x, b.x));
  let y1 = Math.min(v.h, Math.max(a.y, b.y));
  if (x1 - x0 < 8 || y1 - y0 < 8) return regionLabelBox(label); // off screen: the label box stands in (the coach hides the hint anyway)
  const capW = Math.max(160, v.w * 0.55);
  const capH = Math.max(120, v.h * 0.55);
  if (x1 - x0 > capW) { x0 = Math.max(x0, Math.min(label.x - capW / 2, x1 - capW)); x1 = Math.min(x1, x0 + capW); }
  if (y1 - y0 > capH) { y0 = Math.max(y0, Math.min(label.y - capH / 2, y1 - capH)); y1 = Math.min(y1, y0 + capH); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A DOMRect-like ({ left, top, width, height }) as a box. */
export function boxOfRect(r) {
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** The smallest box holding both. */
export function unionBox(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function boxCentre(b) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Distance from a point to a box (0 when the point is inside it). */
export function distPointBox(pt, b) {
  const dx = Math.max(b.x - pt.x, 0, pt.x - (b.x + b.w));
  const dy = Math.max(b.y - pt.y, 0, pt.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/** Overlap area of two boxes, each grown by `pad` px on every side (0 when they only touch). */
export function overlapArea(a, b, pad = 0) {
  const w = Math.min(a.x + a.w + pad, b.x + b.w + pad) - Math.max(a.x - pad, b.x - pad);
  const h = Math.min(a.y + a.h + pad, b.y + b.h + pad) - Math.max(a.y - pad, b.y - pad);
  return w > 0 && h > 0 ? w * h : 0;
}

/** How much of `b` lies inside the viewport, as a fraction of its area (1 = fully on screen). */
export function visibleFraction(b, vw, vh) {
  const w = Math.min(b.x + b.w, vw) - Math.max(b.x, 0);
  const h = Math.min(b.y + b.h, vh) - Math.max(b.y, 0);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (Math.max(1, b.w) * Math.max(1, b.h));
}
