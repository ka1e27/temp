// Colour distance for accessibility checks (DESIGN 7.5a): CIEDE2000 between two sRGB hex colours, as seen normally and under the three colour-vision
// deficiencies (Machado et al. 2009 simulation, full severity: protanopia, deuteranopia, tritanopia). Pure maths: used by the faction-colour tests and tools.
export const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
export const rgb2hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const M = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
export const simulate = (hex, kind) => {
  const l = hex2rgb(hex).map(lin);
  const m = M[kind];
  return m.map((row) => row[0] * l[0] + row[1] * l[1] + row[2] * l[2]);
};
export function lab(linRgb) {
  const [r, g, b] = linRgb;
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x); const fy = f(y); const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function de2000(a, b) {
  const [L1, a1, b1] = a; const [L2, a2, b2] = b;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1); const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1; const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1); const C2p = Math.hypot(a2p, b2);
  const h = (y, x) => { const v = Math.atan2(y, x) / rad; return v < 0 ? v + 360 : v; };
  const h1p = C1p === 0 ? 0 : h(b1, a1p); const h2p = C2p === 0 ? 0 : h(b2, a2p);
  const dLp = L2 - L1; const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2; const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360; hbp /= 2; }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTh = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp; const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}
export const dist = (h1, h2, kind) => de2000(lab(simulate(h1, kind)), lab(simulate(h2, kind)));
export function report(colors) {
  const names = Object.keys(colors);
  const out = {};
  for (const kind of ['normal', 'deutan', 'protan', 'tritan']) {
    out[kind] = [];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) out[kind].push([`${names[i]}-${names[j]}`, dist(colors[names[i]], colors[names[j]], kind)]);
  }
  return out;
}
