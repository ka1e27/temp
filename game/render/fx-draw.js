// How every fx kind is painted. Pairs with fx-kinds.js (what a kind IS) and
// is the other half `fx.js` needs. Takes a real `CanvasRenderingContext2D`,
// so unlike fx-kinds.js/fx-pool.js this file cannot run under plain Node —
// that is why the pool test only exercises spawn/update, never draw.
//
// Sizes are stored in WORLD units on the particle and converted with `toPx`,
// which both scales with `cam.zoom` and clamps to a floor/ceiling so a tiny
// spark is still visible zoomed out and a scorch mark doesn't swallow the
// screen zoomed in (per the brief: "scale with zoom but clamp to stay
// visible at far zoom").
import {
  clamp, clamp01, lerp, arc, hump, easeOutCubic, easeInCubic, easeOutQuad, easeInQuad, easeOutBack,
} from './fx-easing.js';
import { rgba } from './palette.js';

const TAU = Math.PI * 2;

function toPx(worldSize, cam, minPx, maxPx) {
  return clamp(worldSize * cam.zoom, minPx, maxPx);
}

/** A ring with a soft outer glow pass under a crisper inner stroke. */
function drawRing(ctx2d, sx, sy, radiusPx, alpha, color, widthPx) {
  if (alpha <= 0 || radiusPx <= 0) return;
  ctx2d.globalAlpha = alpha * 0.45;
  ctx2d.strokeStyle = color;
  ctx2d.lineWidth = widthPx * 2.6;
  ctx2d.beginPath();
  ctx2d.arc(sx, sy, radiusPx, 0, TAU);
  ctx2d.stroke();
  ctx2d.globalAlpha = alpha;
  ctx2d.lineWidth = widthPx;
  ctx2d.beginPath();
  ctx2d.arc(sx, sy, radiusPx, 0, TAU);
  ctx2d.stroke();
}

function drawSparkle(ctx2d, x, y, r) {
  ctx2d.save();
  ctx2d.translate(x, y);
  ctx2d.beginPath();
  ctx2d.moveTo(0, -r);
  ctx2d.lineTo(r * 0.28, -r * 0.28);
  ctx2d.lineTo(r, 0);
  ctx2d.lineTo(r * 0.28, r * 0.28);
  ctx2d.lineTo(0, r);
  ctx2d.lineTo(-r * 0.28, r * 0.28);
  ctx2d.lineTo(-r, 0);
  ctx2d.lineTo(-r * 0.28, -r * 0.28);
  ctx2d.closePath();
  ctx2d.fill();
  ctx2d.restore();
}

/**
 * Paint one particle. `ctx2d` is a CanvasRenderingContext2D; `cam` provides
 * `worldToScreen(x,y) → {x,y}` (CSS px) and `zoom` (CSS px per world unit).
 * Never calls `save`/`restore` around state it doesn't also fully overwrite
 * on every OTHER branch (globalAlpha/fillStyle/strokeStyle are always set
 * before use), so particles can be drawn back-to-back with no reset between.
 */
export function drawParticle(ctx2d, p, cam) {
  const life = clamp01(p.t / p.life);
  switch (p.kind) {
    case 'dust': {
      const s = cam.worldToScreen(p.x, p.y);
      const r = toPx(p.size * (1 + life * 0.7), cam, 1.5, 40);
      ctx2d.globalAlpha = p.alpha0 * (1 - life);
      ctx2d.fillStyle = p.color;
      ctx2d.beginPath(); ctx2d.arc(s.x, s.y, r, 0, TAU); ctx2d.fill();
      break;
    }
    case 'sparks': {
      const s = cam.worldToScreen(p.x, p.y);
      const speed = Math.hypot(p.vx, p.vy);
      const len = toPx(0.12 + speed * 0.055, cam, 2.5, 28);
      const ang = Math.atan2(p.vy, p.vx);
      ctx2d.globalAlpha = 1 - life * life; // stays bright, then snaps off late
      ctx2d.strokeStyle = p.color;
      ctx2d.lineWidth = toPx(p.size * 0.55, cam, 1.5, 4);
      ctx2d.beginPath();
      ctx2d.moveTo(s.x, s.y);
      ctx2d.lineTo(s.x - Math.cos(ang) * len, s.y - Math.sin(ang) * len);
      ctx2d.stroke();
      break;
    }
    case 'burstShard': {
      // Chunky owner-colour debris — a small quad or triangle, not a dot
      // (round 2 feedback), tumbling via `p.rot`/`p.spin`. Normal blend, not
      // additive: these need to stay recognisably the OWNER'S colour even
      // stacked on top of each other, which additive white-washes away.
      const s = cam.worldToScreen(p.x, p.y);
      const sz = toPx(p.size, cam, 3.5, 24);
      const fade = life < 0.55 ? 1 : 1 - (life - 0.55) / 0.45;
      ctx2d.globalAlpha = fade;
      ctx2d.fillStyle = p.color;
      ctx2d.save();
      ctx2d.translate(s.x, s.y);
      ctx2d.rotate(p.rot);
      if (p.shape === 0) {
        ctx2d.fillRect(-sz * 0.5, -sz * 0.26, sz, sz * 0.52);
      } else {
        ctx2d.beginPath();
        ctx2d.moveTo(sz * 0.58, 0);
        ctx2d.lineTo(-sz * 0.42, -sz * 0.44);
        ctx2d.lineTo(-sz * 0.42, sz * 0.44);
        ctx2d.closePath();
        ctx2d.fill();
      }
      ctx2d.restore();
      break;
    }
    case 'burstFlash': {
      // A tight, instant disc — NOT an expanding ring (the shockwave already
      // owns "expanding"). Round 2: reads as "~0.6 hex, ~90ms, white-hot".
      const s = cam.worldToScreen(p.x, p.y);
      const r = toPx(p.size * (1 + easeOutQuad(life) * 0.6), cam, 6, 100);
      const a = (1 - easeInQuad(life)) * 0.95;
      const rim = p.color2 || p.color;
      // Hold near-full white out to 40% of the radius before handing off to
      // the rim colour — a gradient that starts falling off at the very
      // centre reads as "a hot pixel with a soft aura", not "a disc". This
      // is what actually sells "white-HOT" at a glance (round 2 finding).
      const grad = ctx2d.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      grad.addColorStop(0, rgba('#ffffff', a));
      grad.addColorStop(0.4, rgba('#ffffff', a));
      grad.addColorStop(0.72, rgba(rim, a * 0.9));
      grad.addColorStop(1, rgba(rim, 0));
      ctx2d.globalAlpha = 1;
      ctx2d.fillStyle = grad;
      ctx2d.beginPath(); ctx2d.arc(s.x, s.y, r, 0, TAU); ctx2d.fill();
      break;
    }
    case 'shockwave': {
      const s = cam.worldToScreen(p.x, p.y);
      const r = toPx(p.size + p.p0 * easeOutCubic(life), cam, 3, 520);
      // Thinning as it expands (p1 → p2, world units) sells "a wall of force
      // spreading out and losing energy" rather than a static decal ring;
      // min px clamp keeps it a real ring even at full-map overview zoom.
      const widthWorld = lerp(p.p1 || 0.05, p.p2 ?? p.p1 ?? 0.05, easeOutQuad(life));
      drawRing(ctx2d, s.x, s.y, r, p.alpha0 * (1 - life), p.color, toPx(widthWorld, cam, 2.2, 40));
      break;
    }
    case 'ripple': {
      const s = cam.worldToScreen(p.x, p.y);
      const r = toPx(p.size + p.p0 * easeOutQuad(life), cam, 3, 260);
      drawRing(ctx2d, s.x, s.y, r, p.alpha0 * (1 - life), p.color, toPx(0.035, cam, 1, 3));
      break;
    }
    case 'floatText': {
      // Round 2: bolder, and a pop-in (1.4x -> 1.0x over 120ms, with a
      // slight settle-past-1.0 bounce from easeOutBack) before the usual
      // rise+fade — a number that just appears at full size reads as UI,
      // one that pops in reads as an EVENT. `p.size` is a straight
      // multiplier, so callers pass a bigger one for a keep capture/bounty.
      const rise = p.p0 * easeOutCubic(life);
      const s = cam.worldToScreen(p.x, p.y - rise);
      const fontPx = toPx(p.size, cam, 14, 64);
      const popT = clamp01(p.t / 0.12);
      const scale = popT >= 1 ? 1 : lerp(1.4, 1.0, easeOutBack(popT));
      ctx2d.globalAlpha = life < 0.7 ? 1 : 1 - (life - 0.7) / 0.3;
      ctx2d.save();
      ctx2d.translate(s.x, s.y);
      if (scale !== 1) ctx2d.scale(scale, scale);
      ctx2d.font = `800 ${fontPx}px Nunito, system-ui, sans-serif`;
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.lineWidth = Math.max(2.5, fontPx * 0.2);
      ctx2d.strokeStyle = 'rgba(8,10,16,0.82)';
      ctx2d.strokeText(p.text, 0, 0);
      ctx2d.fillStyle = p.color;
      ctx2d.fillText(p.text, 0, 0);
      ctx2d.restore();
      break;
    }
    case 'coins': {
      const delay = p.p1;
      const flightLife = Math.max(0.001, p.life - delay);
      const tt = p.t - delay;
      if (tt < 0) break; // this staggered coin hasn't launched yet
      const cLife = clamp01(tt / flightLife);
      const start = cam.worldToScreen(p.x, p.y);
      const ex = easeInQuad(cLife);
      const lx = lerp(start.x, p.sx, ex);
      const ly = lerp(start.y, p.sy, ex) - arc(cLife, p.p0);
      const r = toPx(p.size, cam, 5, 16);
      ctx2d.globalAlpha = cLife > 0.85 ? (1 - cLife) / 0.15 : 1;
      ctx2d.save();
      ctx2d.translate(lx, ly);
      // A flat coin viewed edge-on as it tumbles: squashing X toward 0 and
      // back reads as a spin without needing an actual 3rd dimension.
      ctx2d.scale(Math.max(0.18, Math.abs(Math.cos(p.t * p.spin))), 1);
      ctx2d.fillStyle = p.color;
      ctx2d.beginPath(); ctx2d.arc(0, 0, r, 0, TAU); ctx2d.fill();
      ctx2d.fillStyle = 'rgba(255,255,255,0.55)';
      ctx2d.beginPath(); ctx2d.arc(-r * 0.25, -r * 0.25, r * 0.32, 0, TAU); ctx2d.fill();
      ctx2d.restore();
      break;
    }
    case 'ember': {
      const s = cam.worldToScreen(p.x, p.y);
      const flicker = 0.7 + 0.3 * Math.sin(p.seed * 10 + p.t * 18);
      const r = toPx(p.size * (1 - life * 0.5), cam, 1, 8);
      ctx2d.globalAlpha = (1 - life) * flicker;
      ctx2d.fillStyle = p.color;
      ctx2d.beginPath(); ctx2d.arc(s.x, s.y, r, 0, TAU); ctx2d.fill();
      break;
    }
    case 'smoke': {
      const s = cam.worldToScreen(p.x, p.y);
      const r = toPx(p.size * (1 + life * 1.8), cam, 4, 90);
      const a = p.alpha0 * (1 - life) * 0.9;
      const grad = ctx2d.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      grad.addColorStop(0, rgba(p.color, a));
      grad.addColorStop(1, rgba(p.color, 0));
      ctx2d.globalAlpha = 1;
      ctx2d.fillStyle = grad;
      ctx2d.beginPath(); ctx2d.arc(s.x, s.y, r, 0, TAU); ctx2d.fill();
      break;
    }
    case 'scorch': {
      const s = cam.worldToScreen(p.x, p.y);
      const fadeIn = clamp01(p.t / 0.3);
      const fadeOut = 1 - easeInQuad(clamp01((life - 0.7) / 0.3));
      const r = toPx(p.size, cam, 6, 140);
      const a = 0.55 * fadeIn * fadeOut;
      ctx2d.save();
      ctx2d.translate(s.x, s.y);
      ctx2d.rotate(p.rot);
      ctx2d.scale(1, 0.62);
      const grad = ctx2d.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, rgba(p.color, a));
      grad.addColorStop(0.7, rgba(p.color, a * 0.55));
      grad.addColorStop(1, rgba(p.color, 0));
      ctx2d.globalAlpha = 1;
      ctx2d.fillStyle = grad;
      ctx2d.beginPath(); ctx2d.arc(0, 0, r, 0, TAU); ctx2d.fill();
      ctx2d.restore();
      break;
    }
    case 'arrow': {
      const wx = lerp(p.x, p.tx, life);
      const wy = lerp(p.y, p.ty, life) - arc(life, p.p0 * 0.15);
      const s = cam.worldToScreen(wx, wy);
      const life2 = clamp01(life + 0.05);
      const wx2 = lerp(p.x, p.tx, life2);
      const wy2 = lerp(p.y, p.ty, life2) - arc(life2, p.p0 * 0.15);
      const s2 = cam.worldToScreen(wx2, wy2);
      const ang = Math.atan2(s2.y - s.y, s2.x - s.x || 0.0001);
      const len = toPx(0.5, cam, 8, 40);
      ctx2d.save();
      ctx2d.translate(s.x, s.y);
      ctx2d.rotate(ang);
      ctx2d.globalAlpha = 1;
      ctx2d.strokeStyle = p.color;
      ctx2d.lineWidth = Math.max(1.5, len * 0.09);
      ctx2d.beginPath(); ctx2d.moveTo(-len, 0); ctx2d.lineTo(len * 0.4, 0); ctx2d.stroke();
      ctx2d.fillStyle = p.color;
      ctx2d.beginPath();
      ctx2d.moveTo(len * 0.58, 0);
      ctx2d.lineTo(len * 0.22, -len * 0.13);
      ctx2d.lineTo(len * 0.22, len * 0.13);
      ctx2d.closePath();
      ctx2d.fill();
      ctx2d.restore();
      break;
    }
    case 'fireball': {
      // Falls in from the upper-LEFT (round 2: a straight vertical drop read
      // as static; a diagonal one reads as a projectile actually thrown in).
      // The offset is a fixed fraction of dropHeight, so no extra field is
      // needed — it is entirely derived from p.p1.
      const fall = easeInCubic(life);
      const dropX = p.p1 * 0.55;
      const startX = p.x - dropX;
      const startY = p.y - p.p1;
      const wx = lerp(startX, p.x, fall);
      const wy = lerp(startY, p.y, fall);
      const s = cam.worldToScreen(wx, wy);
      const r = toPx(0.24, cam, 6, 28);

      const trailFall = easeInCubic(clamp01(life - 0.16));
      const st = cam.worldToScreen(lerp(startX, p.x, trailFall), lerp(startY, p.y, trailFall));
      // Two-layer trail: a soft wide glow behind a bright narrow ember core.
      const glow = ctx2d.createLinearGradient(st.x, st.y, s.x, s.y);
      glow.addColorStop(0, rgba(p.color, 0));
      glow.addColorStop(1, rgba(p.color, 0.38));
      ctx2d.globalAlpha = 1;
      ctx2d.strokeStyle = glow;
      ctx2d.lineWidth = r * 2.0;
      ctx2d.beginPath(); ctx2d.moveTo(st.x, st.y); ctx2d.lineTo(s.x, s.y); ctx2d.stroke();
      const core = ctx2d.createLinearGradient(st.x, st.y, s.x, s.y);
      core.addColorStop(0, rgba('#ffe9a8', 0));
      core.addColorStop(1, rgba('#ffe9a8', 0.85));
      ctx2d.strokeStyle = core;
      ctx2d.lineWidth = r * 0.7;
      ctx2d.beginPath(); ctx2d.moveTo(st.x, st.y); ctx2d.lineTo(s.x, s.y); ctx2d.stroke();

      const head = ctx2d.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      head.addColorStop(0, '#fff6d8');
      head.addColorStop(0.5, p.color);
      head.addColorStop(1, rgba(p.color, 0));
      ctx2d.fillStyle = head;
      ctx2d.beginPath(); ctx2d.arc(s.x, s.y, r, 0, TAU); ctx2d.fill();
      break;
    }
    case 'fireBloom': {
      // Round 2: the ring alone read as "a small ring" — this fills the
      // actual blast radius with heat so the player sees the AREA that got
      // hit, not just its rim. Quick punch in, short hold, fade out.
      const s = cam.worldToScreen(p.x, p.y);
      const growth = life < 0.3 ? easeOutQuad(life / 0.3) : 1;
      const fade = life < 0.55 ? 1 : 1 - easeInQuad((life - 0.55) / 0.45);
      const r = toPx(p.size * (0.35 + growth * 0.65), cam, 10, 400);
      const a = fade * 0.8;
      const grad = ctx2d.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      grad.addColorStop(0, rgba('#fff3c4', a));
      grad.addColorStop(0.35, rgba('#ffb15e', a * 0.85));
      grad.addColorStop(0.75, rgba(p.color, a * 0.5));
      grad.addColorStop(1, rgba(p.color, 0));
      ctx2d.globalAlpha = 1;
      ctx2d.fillStyle = grad;
      ctx2d.beginPath(); ctx2d.arc(s.x, s.y, r, 0, TAU); ctx2d.fill();
      break;
    }
    case 'telegraph': {
      // A pulsing danger-zone ring for the wind-up before a delayed strike;
      // pulses faster as `life` approaches 1 (impact) for a rising sense of
      // urgency. Additive red reads as a warm warning glow on any terrain.
      const s = cam.worldToScreen(p.x, p.y);
      const freq = 6 + 10 * life;
      const pulse = 0.5 + 0.5 * Math.sin(p.t * freq);
      const r = toPx(p.size, cam, 8, 300);
      const ringAlpha = (0.5 + 0.5 * pulse) * clamp01(1 - (life - 0.85) / 0.15);
      drawRing(ctx2d, s.x, s.y, r, ringAlpha, p.color, toPx(0.045, cam, 1.5, 6));
      ctx2d.globalAlpha = 0.10 + 0.06 * pulse;
      ctx2d.fillStyle = p.color;
      ctx2d.beginPath(); ctx2d.arc(s.x, s.y, r, 0, TAU); ctx2d.fill();
      ctx2d.globalAlpha = 0.8;
      ctx2d.fillRect(s.x - 1, s.y - toPx(0.09, cam, 3, 10), 2, toPx(0.18, cam, 6, 20));
      ctx2d.fillRect(s.x - toPx(0.09, cam, 3, 10), s.y - 1, toPx(0.18, cam, 6, 20), 2);
      break;
    }
    case 'flood': {
      // Victory-flood helper: one tile's soft owner-colour shimmer. Cheap by
      // design — the integrator spawns dozens of these in a ripple pattern.
      const s = cam.worldToScreen(p.x, p.y);
      const pulse = easeOutQuad(clamp01(life / 0.4));
      const r = toPx(p.size * (0.6 + pulse * 0.5), cam, 6, 120);
      const a = (1 - easeInQuad(life)) * 0.7;
      const grad = ctx2d.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      grad.addColorStop(0, rgba('#ffffff', a * 0.6));
      grad.addColorStop(0.5, rgba(p.color, a));
      grad.addColorStop(1, rgba(p.color, 0));
      ctx2d.globalAlpha = 1;
      ctx2d.fillStyle = grad;
      ctx2d.beginPath(); ctx2d.arc(s.x, s.y, r, 0, TAU); ctx2d.fill();
      break;
    }
    case 'confetti': {
      const s = cam.worldToScreen(p.x + Math.sin(p.t * 6 + p.seed) * 0.18, p.y);
      const size = toPx(p.size, cam, 3, 14);
      ctx2d.globalAlpha = life > 0.82 ? (1 - life) / 0.18 : 1;
      ctx2d.save();
      ctx2d.translate(s.x, s.y);
      ctx2d.rotate(p.rot);
      ctx2d.fillStyle = p.color;
      if (p.shape === 0) {
        ctx2d.fillRect(-size * 0.5, -size * 0.18, size, size * 0.36);
      } else if (p.shape === 1) {
        ctx2d.beginPath();
        ctx2d.moveTo(0, -size * 0.5);
        ctx2d.lineTo(size * 0.45, size * 0.4);
        ctx2d.lineTo(-size * 0.45, size * 0.4);
        ctx2d.closePath();
        ctx2d.fill();
      } else {
        ctx2d.fillRect(-size * 0.15, -size * 0.5, size * 0.3, size);
      }
      ctx2d.restore();
      break;
    }
    case 'levy': {
      const s = cam.worldToScreen(p.x, p.y);
      const twinkle = 0.5 + 0.5 * Math.sin(p.seed + p.t * 14);
      const r = toPx(p.size, cam, 1.5, 8);
      ctx2d.globalAlpha = (1 - life) * twinkle;
      ctx2d.fillStyle = p.color;
      drawSparkle(ctx2d, s.x, s.y, r);
      break;
    }
    case 'shield': {
      const s = cam.worldToScreen(p.x, p.y);
      const fadeIn = clamp01(p.t / 0.25);
      const fadeOut = 1 - easeInQuad(clamp01((p.t - (p.life - 0.3)) / 0.3));
      const pulse = 0.92 + 0.08 * Math.sin(p.t * 5);
      const r = toPx(p.size * pulse, cam, 10, 220);
      const amt = fadeIn * fadeOut;
      ctx2d.save();
      ctx2d.translate(s.x, s.y);
      ctx2d.scale(1, 0.72);
      ctx2d.globalAlpha = 1;
      const grad = ctx2d.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, rgba(p.color, 0.05 * amt));
      grad.addColorStop(0.75, rgba(p.color, 0.16 * amt));
      grad.addColorStop(1, rgba(p.color, 0.4 * amt));
      ctx2d.fillStyle = grad;
      ctx2d.beginPath(); ctx2d.arc(0, 0, r, Math.PI, TAU); ctx2d.closePath(); ctx2d.fill();
      ctx2d.strokeStyle = rgba(p.color, 0.55 * amt);
      ctx2d.lineWidth = 2;
      ctx2d.beginPath(); ctx2d.arc(0, 0, r, Math.PI, TAU); ctx2d.stroke();
      ctx2d.restore();
      break;
    }
    case 'rally': {
      const s = cam.worldToScreen(p.x, p.y);
      const ang = Math.atan2(p.ty - p.y, p.tx - p.x);
      const r = toPx(0.3 + 2.6 * easeOutCubic(life), cam, 4, 320);
      const fade = 1 - easeInQuad(life);
      ctx2d.save();
      ctx2d.translate(s.x, s.y);
      ctx2d.rotate(ang);
      ctx2d.strokeStyle = p.color;
      // Soft outer glow pass, then a crisper inner arc (same trick as
      // drawRing) — a lone hairline reads as a glitch at this radius, not a
      // horn blast.
      ctx2d.lineWidth = toPx(0.16, cam, 3, 11);
      ctx2d.globalAlpha = fade * 0.35;
      ctx2d.beginPath(); ctx2d.arc(0, 0, r, -0.9, 0.9); ctx2d.stroke();
      ctx2d.lineWidth = toPx(0.06, cam, 1.5, 5);
      ctx2d.globalAlpha = fade;
      ctx2d.beginPath(); ctx2d.arc(0, 0, r, -0.9, 0.9); ctx2d.stroke();
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * 0.4;
        const rr = r * (0.5 + i * 0.2);
        ctx2d.globalAlpha = fade * hump(clamp01(life + i * 0.08), 0.4) * 0.9;
        ctx2d.beginPath();
        ctx2d.moveTo(rr * 0.5 * Math.cos(off), rr * 0.5 * Math.sin(off));
        ctx2d.lineTo(rr * Math.cos(off), rr * Math.sin(off));
        ctx2d.stroke();
      }
      ctx2d.restore();
      break;
    }
    default:
      break;
  }
}
