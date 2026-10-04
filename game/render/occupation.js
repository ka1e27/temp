// Occupied regions on the world map (DESIGN 10.2): the occupier's tint is already the territory colour (state.owner moved); this adds diagonal hatching in that
// colour over the region's land, so an occupied region of yours never reads as an ordinary enemy region. Browser canvas only; pure drawing.
//
//   const occ = createOccupationLayer();
//   occ.draw(ctx, camera, world, [{ regionId, color }])
//   occ.tint(ctx, camera, world, [regionId, ...], color, alpha)   a flat wash (the Plague)
import { elevOffset } from './tiles.js';

const HEX = Array.from({ length: 6 }, (_, k) => {
  const a = ((-90 + 60 * k) * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
});

export function createOccupationLayer() {
  const tilesOf = new Map(); // regionId -> tiles (cached per world)
  let cachedWorld = null;

  function regionTiles(world, regionId) {
    if (cachedWorld !== world) { tilesOf.clear(); cachedWorld = world; }
    let list = tilesOf.get(regionId);
    if (!list) {
      list = world.tiles.filter((t) => t.region === regionId && t.land !== false);
      tilesOf.set(regionId, list);
    }
    return list;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} camera
   * @param {object} world
   * @param {{ regionId: number, color: string }[]} occupied
   */
  function draw(ctx, camera, world, occupied) {
    if (!occupied || !occupied.length) return;
    const z = camera.zoom;
    for (const { regionId, color } of occupied) {
      const tiles = regionTiles(world, regionId);
      if (!tiles.length) continue;
      ctx.save();
      ctx.beginPath();
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      for (const t of tiles) {
        const lift = elevOffset(t, 1);
        HEX.forEach(([cx, cy], k) => {
          const p = camera.worldToScreen(t.x + cx, t.y - lift + cy);
          if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
          if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
        });
        ctx.closePath();
      }
      if (maxX < 0 || maxY < 0 || minX > camera.viewW || minY > camera.viewH) { ctx.restore(); continue; }
      ctx.clip();
      // stripes in the occupier's colour, a dark under-stroke so they read on any tint
      const gap = Math.max(7, z * 0.45);
      const h = maxY - minY;
      ctx.lineCap = 'butt';
      for (const [style, w] of [['rgba(8,10,16,0.35)', Math.max(3, z * 0.16)], [color, Math.max(1.6, z * 0.09)]]) {
        ctx.strokeStyle = style;
        ctx.globalAlpha = style === color ? 0.7 : 1;
        ctx.lineWidth = w;
        ctx.beginPath();
        for (let x = minX - h; x < maxX; x += gap) { ctx.moveTo(x, maxY); ctx.lineTo(x + h, minY); }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /**
   * A flat wash over regions (the Plague's sickly tint, DESIGN 10.13), one path per region, clipped to its land.
   * @param {number[]} regionIds @param {string} color @param {number} alpha
   */
  function tint(ctx, camera, world, regionIds, color, alpha) {
    if (!regionIds || !regionIds.length) return;
    ctx.save();
    ctx.beginPath();
    for (const regionId of regionIds) {
      for (const t of regionTiles(world, regionId)) {
        const lift = elevOffset(t, 1);
        HEX.forEach(([cx, cy], k) => {
          const p = camera.worldToScreen(t.x + cx * 1.02, t.y - lift + cy * 1.02);
          if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
      }
    }
    // a sickly cast that reads on any land (a plain green wash vanished on the yellow-green plains): a yellow-green film, a darkening
    // multiply, then sickly diagonal hatching clipped to the regions
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const regionId of regionIds) for (const t of regionTiles(world, regionId)) {
      const p = camera.worldToScreen(t.x, t.y);
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    ctx.globalAlpha = Math.min(1, alpha * 1.5);
    ctx.fillStyle = color;
    ctx.fill('nonzero');
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = Math.min(1, alpha * 2);
    ctx.fillStyle = '#a3b85a';
    ctx.fill('nonzero');
    ctx.globalCompositeOperation = 'source-over';
    ctx.clip('nonzero');
    const z = camera.zoom;
    const pad = z * 2;
    const gap = Math.max(9, z * 0.5);
    const h = maxY - minY + pad * 2;
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#4d5e12';
    ctx.lineWidth = Math.max(1.5, z * 0.07);
    ctx.beginPath();
    for (let x = minX - pad - h; x < maxX + pad; x += gap) { ctx.moveTo(x, maxY + pad); ctx.lineTo(x + h, minY - pad); }
    ctx.stroke();
    ctx.restore();
  }

  return { draw, tint };
}
