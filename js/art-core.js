/* Watercolour art engine.
 *
 * Every picture in the game is drawn in code as SVG and painted with filters
 * that imitate watercolour on paper: wobbly edges, uneven pigment, darker
 * rims where the paint pools, and loose pencil-ish ink lines. Each sprite is
 * turned into an image once (the browser caches the painted result), so
 * moving things around later is cheap.
 */
window.AT = window.AT || {};

AT.art = (() => {
  const sprites = {};       // id -> {box:[x,y,w,h], url, svg}
  const defsCache = {};

  // ---------- colour helpers ----------
  const hex2rgb = (h) => {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgb2hex = (r, g, b) =>
    '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => {
    const A = hex2rgb(a), B = hex2rgb(b);
    return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  };
  const SEPIA = '#3a2626';
  const inkOf = (fill) => mix(fill, SEPIA, 0.55);
  const shade = (fill, t = 0.25) => mix(fill, '#2a1a3a', t);
  const tint = (fill, t = 0.3) => mix(fill, '#fffaf0', t);

  // ---------- geometry helpers (return SVG path data) ----------
  const f = (n) => Math.round(n * 10) / 10;
  const C = (cx, cy, r) => E(cx, cy, r, r);
  const E = (cx, cy, rx, ry) =>
    `M${f(cx - rx)} ${f(cy)}a${f(rx)} ${f(ry)} 0 1 0 ${f(rx * 2)} 0a${f(rx)} ${f(ry)} 0 1 0 ${f(-rx * 2)} 0Z`;
  const R = (x, y, w, h, r = 0) => {
    r = Math.min(r, w / 2, h / 2);
    return `M${f(x + r)} ${f(y)}h${f(w - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(r)}v${f(h - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(r)}h${f(-(w - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(-r)}v${f(-(h - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(-r)}Z`;
  };
  // Catmull-Rom spline through points -> smooth cubic bezier path
  const smooth = (pts, closed = true, tension = 1) => {
    const n = pts.length;
    if (n < 2) return '';
    const P = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
    let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      const t = tension / 6;
      const c1 = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t];
      const c2 = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
      d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
    }
    return closed ? d + 'Z' : d;
  };
  // deterministic pseudo random
  const rng = (seed) => {
    let s = seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  };
  // organic blob around an ellipse
  const blob = (cx, cy, rx, ry, seed = 1, amp = 0.12, n = 9, rot = 0) => {
    const r = rng(seed);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rot;
      const k = 1 + (r() - 0.5) * 2 * amp;
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return smooth(pts, true);
  };
  // fluffy cloud / bush: ring of bumps
  const fluff = (cx, cy, rx, ry, bumps = 7, seed = 3, depth = 0.22) => {
    const r = rng(seed);
    const pts = [];
    const n = bumps * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const out = i % 2 === 0 ? 1 + depth * (0.6 + r() * 0.6) : 1 - depth * 0.2;
      pts.push([cx + Math.cos(a) * rx * out, cy + Math.sin(a) * ry * out]);
    }
    return smooth(pts, true);
  };
  // cloud: union of overlapping circles (draw with k:false so inner edges stay hidden)
  const puffs = (cx, cy, w, h, n = 5, seed = 1) => {
    const r = rng(seed);
    let d = E(cx, cy + h * 0.18, w * 0.5, h * 0.32);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const x = cx - w * 0.38 + t * w * 0.76;
      const rad = h * (0.28 + 0.22 * Math.sin(t * Math.PI) + r() * 0.08);
      d += ' ' + C(x, cy + h * 0.12 - rad * 0.55, rad);
    }
    return d;
  };
  const star = (cx, cy, r1, r2, n = 5, rot = -Math.PI / 2) => {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = rot + (i / (n * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? r1 : r2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return smooth(pts, true, 0.35);
  };
  const heart = (cx, cy, s) =>
    `M${f(cx)} ${f(cy + s * 0.9)}C${f(cx - s * 1.3)} ${f(cy + s * 0.1)} ${f(cx - s * 0.9)} ${f(cy - s * 0.95)} ${f(cx)} ${f(cy - s * 0.35)}C${f(cx + s * 0.9)} ${f(cy - s * 0.95)} ${f(cx + s * 1.3)} ${f(cy + s * 0.1)} ${f(cx)} ${f(cy + s * 0.9)}Z`;
  const line = (pts) => smooth(pts, false);

  // ---------- filters ----------
  // w   : opaque watercolour wash (paper underlay + uneven pigment + rim)
  // ws  : same, gentler wobble for small details
  // t   : translucent glaze (shadows, blush, washes over other paint)
  // bg  : big soft background wash
  // k   : ink line, ks: fine ink line
  function defs(seed) {
    const key = seed;
    if (defsCache[key]) return defsCache[key];
    const s = seed;
    const wash = (id, freq, wob, rim, varAmt, base) => `
<filter id="${id}" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${s}" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="${wob}" xChannelSelector="R" yChannelSelector="G" result="d"/>
<feTurbulence type="fractalNoise" baseFrequency="0.016" numOctaves="2" seed="${s + 11}" result="m"/>
<feColorMatrix in="m" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${-varAmt * 3.2} ${1 + varAmt * 1.25}" result="ma"/>
<feComposite in="d" in2="ma" operator="in" result="v"/>
<feGaussianBlur in="d" stdDeviation="${rim}" result="b"/>
<feComposite in="d" in2="b" operator="out" result="r"/>
<feColorMatrix in="r" type="matrix" values="0.62 0 0 0 0 0 0.6 0 0 0 0 0 0.66 0 0 0 0 0 1.25 0" result="rd"/>
<feComposite in="rd" in2="v" operator="over" result="o"/>
${base ? `<feFlood flood-color="#fffaf1" result="p"/><feComposite in="p" in2="d" operator="in" result="pb"/>` : ''}
<feGaussianBlur in="d" stdDeviation="2.4" result="h"/>
<feColorMatrix in="h" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0.22 0" result="ha"/>
<feMerge result="mm"><feMergeNode in="ha"/>${base ? '<feMergeNode in="pb"/>' : ''}<feMergeNode in="o"/></feMerge>
<feGaussianBlur in="mm" stdDeviation="0.45"/>
</filter>`;
    const ink = (id, wob, grain, blur) => `
<filter id="${id}" filterUnits="userSpaceOnUse" x="-2000" y="-2000" width="5000" height="5000" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="${s + 5}" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="${wob}" xChannelSelector="R" yChannelSelector="G" result="d"/>
<feTurbulence type="fractalNoise" baseFrequency="0.22" numOctaves="2" seed="${s + 9}" result="g"/>
<feColorMatrix in="g" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${-grain} ${grain * 0.5 + 1.15}" result="ga"/>
<feComposite in="d" in2="ga" operator="in" result="p"/>
<feGaussianBlur in="p" stdDeviation="${blur}"/>
</filter>`;
    const out = `<defs>
${wash('w', 0.022, 9, 3.2, 0.22, true)}
${wash('ws', 0.05, 3, 1.6, 0.18, true)}
${wash('t', 0.022, 8, 3, 0.32, false)}
${wash('bg', 0.008, 22, 7, 0.3, false)}
${ink('k', 4, 2.2, 0.35)}
${ink('ks', 1.6, 1.6, 0.25)}
</defs>`;
    defsCache[key] = out;
    return out;
  }

  // ---------- shape -> svg ----------
  // shape: {d, f(fill), k(ink colour | false), sw(stroke width), fx('w'|'ws'|'t'|'bg'|'flat'),
  //         o(opacity), kf('k'|'ks'), tf(transform), raw(markup)}
  function shapeSvg(s) {
    if (s.raw) return s.raw;
    const tf = s.tf ? ` transform="${s.tf}"` : '';
    let out = '';
    const fx = s.fx || 'w';
    if (s.f && s.f !== 'none') {
      const flt = fx === 'flat' ? '' : ` filter="url(#${fx})"`;
      const op = s.o != null ? ` opacity="${s.o}"` : '';
      out += `<path d="${s.d}" fill="${s.f}"${flt}${op}${tf}/>`;
    }
    const k = s.k === undefined ? (s.f && s.f !== 'none' ? inkOf(s.f) : SEPIA) : s.k;
    if (k) {
      const sw = s.sw || 3.2;
      const kf = s.kf || (sw < 2.6 ? 'ks' : 'k');
      const ko = s.ko != null ? ` opacity="${s.ko}"` : '';
      out += `<path d="${s.d}" fill="none" stroke="${k}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" filter="url(#${kf})"${ko}${tf}/>`;
    }
    return out;
  }
  const group = (shapes, tf) => ({ raw: `<g transform="${tf}">${flat(shapes).map(shapeSvg).join('')}</g>` });
  const flat = (a) => a.flat(Infinity).filter(Boolean);

  // Register a sprite. box = [x, y, w, h] in the drawing's own coordinates.
  function define(id, box, draw, seed) {
    sprites[id] = { box, draw, seed: seed || hashStr(id) % 97 + 3, url: null };
  }
  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function svgOf(id) {
    const sp = sprites[id];
    if (!sp) throw new Error('No sprite ' + id);
    const [x, y, w, h] = sp.box;
    const body = flat([sp.draw()]).map(shapeSvg).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">${defs(sp.seed)}${body}</svg>`;
  }
  function url(id) {
    const sp = sprites[id];
    if (!sp.url) {
      const blobObj = new Blob([svgOf(id)], { type: 'image/svg+xml' });
      sp.url = URL.createObjectURL(blobObj);
    }
    return sp.url;
  }
  // Create an <img> positioned in its drawing's coordinate system (relative to a 0x0 parent origin).
  function img(id, cls) {
    const sp = sprites[id];
    if (!sp) throw new Error('No sprite ' + id);
    const el = document.createElement('img');
    el.src = url(id);
    el.alt = '';
    el.draggable = false;
    el.className = 'spr' + (cls ? ' ' + cls : '');
    const [x, y, w, h] = sp.box;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.dataset.sprite = id;
    return el;
  }
  const box = (id) => sprites[id].box;
  const has = (id) => !!sprites[id];
  const list = () => Object.keys(sprites);

  return {
    define, img, url, svgOf, box, has, list,
    C, E, R, smooth, blob, fluff, puffs, star, heart, line, rng, group,
    mix, inkOf, shade, tint, SEPIA,
  };
})();
