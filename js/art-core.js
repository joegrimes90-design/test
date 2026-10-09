/* Watercolour art engine.
 *
 * Every picture in the game is drawn in code as SVG and painted with filters
 * that imitate watercolour on paper: wobbly edges, uneven pigment, darker
 * rims where the paint pools, and loose pencil-ish ink lines.
 *
 * Browsers re-run those filters whenever anything moves over an SVG image, so
 * each sprite <img> is shown as a bitmap painted from its SVG once, at the
 * exact device scale it is displayed at (see "bitmap sprite layer" below).
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
    if (mode === 'bitmap') schedule(el);
    return el;
  }
  const box = (id) => sprites[id].box;
  const has = (id) => !!sprites[id];
  const list = () => Object.keys(sprites);

  // ---------- bitmap sprite layer ----------
  // Chrome (and Safari) re-rasterise an SVG <img> with all of its filters every
  // time a tile under anything that moves is redrawn: about 0.7 s of raster
  // work per frame on the title. So each sprite is painted from its SVG into a
  // canvas once per exact device scale k (device pixels per sprite unit) and
  // shown as a PNG blob URL in the same <img> (Puppet.faceImgs and node.img
  // keep their references; data-sprite stays):
  //   - the bitmap is cw x ch = ceil(w*k) x ceil(h*k) device pixels, with the
  //     vectors drawn at exactly k (never stretched to the rounded size);
  //   - the img gets that integer CSS size and transform
  //     translate(nx,ny) scale(1/k), so one bitmap pixel lands on one device
  //     pixel (Blink snaps image rects in local space: a fractional CSS size
  //     would resample the bitmap);
  //   - axis-aligned instances are moved by at most half a device pixel so the
  //     bitmap starts on a whole device pixel (rotated ones are resampled by
  //     the browser anyway).
  // Until its bitmap is ready an img keeps its SVG src, which looks the same
  // (it is only slower). ?raster=svg, a failed boot self-check or a canvas
  // SecurityError switch everything back to plain SVG images: exactly the
  // rendering this layer replaces, kept as a kill switch.
  const MAX_PX = 16e6; // iOS refuses bigger canvases: such sprites stay SVG
  const params = (() => { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(''); } })();
  // test-only knobs (tests/visual/raster-parity.spec.mjs proves that broken variants fail)
  const tuning = Object.assign({ snap: true, boxSize: false, oversample: 1 }, (typeof window !== 'undefined' && window.__AT_RASTER_TUNING) || {});
  let mode = params.get('raster') === 'svg' ? 'svg' : 'bitmap';
  const cache = new Map();      // `${id}@${k.toFixed(3)}` -> entry {key, id, k, url, blob, cw, ch, ms, bytes, used}
  const byUrl = new Map();      // bitmap url -> entry
  const inflight = new Map();   // key -> Promise<entry|null>
  const queue = [];             // rasterise jobs {id, k, key, resolve}
  const svgImgs = new Map();    // id -> Promise<loaded SVG HTMLImageElement|null>
  const pendingFit = new Set(); // imgs created since the last microtask flush
  const idleWaiters = [];
  const st = { jobs: 0, ms: 0, hits: 0, misses: 0, svgFallbacks: 0, bytes: 0 };
  let running = false, flushQueued = false, busy = 0, useClock = 0;
  let learnMs = 0, learnPx = 0; // for cost estimates: ms per device pixel of finished jobs
  const later = typeof queueMicrotask === 'function' ? queueMicrotask : (fn) => Promise.resolve().then(fn);
  const dpr = () => (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const keyOf = (id, k) => `${id}@${k.toFixed(3)}`;
  const round3 = (k) => Math.round(k * 1000) / 1000;

  // one whole sprite per macrotask, so input and animation frames interleave
  let chan = null;
  const taskQ = [];
  const nextTask = () => new Promise((resolve) => {
    if (typeof MessageChannel === 'undefined') return setTimeout(resolve, 0);
    if (!chan) { chan = new MessageChannel(); chan.port1.onmessage = () => { const r = taskQ.shift(); if (r) r(); }; }
    taskQ.push(resolve);
    chan.port2.postMessage(0);
  });

  function checkIdle() {
    if (running || queue.length || busy || pendingFit.size || flushQueued) return;
    while (idleWaiters.length) idleWaiters.shift()();
  }
  // Resolves when nothing is queued or being painted and every requested bitmap has been put in its img.
  const idle = () => new Promise((resolve) => { idleWaiters.push(resolve); checkIdle(); });

  // ----- device matrix of an img: which device pixels its sprite units land on -----
  // Built from the inline styles the game sets (left/top/transform), never from
  // getComputedStyle where avoidable: inside display:none subtrees (hidden face
  // variants and puppet parts) computed transforms read as 'none'.
  const ZERO_ORIGIN = /\b(node|inner)\b/;
  const PLAIN = /\b(node|inner|cardclip)\b/;
  const PLAIN_IDS = { world: 1, ui: 1, fxs: 1, hud: 1, page: 1 };
  const originOf = (v) => {
    if (!v) return [0, 0];
    const p = v.split(/\s+/).map(parseFloat);
    return [p[0] || 0, p[1] || 0];
  };
  function localMatrix(el) {
    const s = el.style;
    let m = new DOMMatrix().translate(parseFloat(s.left) || 0, parseFloat(s.top) || 0);
    let tf = s.transform, origin;
    if (tf && tf !== 'none' && tf.indexOf('%') < 0) {
      origin = s.transformOrigin || (ZERO_ORIGIN.test(el.className) || PLAIN_IDS[el.id] ? '' : getComputedStyle(el).transformOrigin);
    } else if ((tf && tf.indexOf('%') >= 0) || !(PLAIN.test(el.className) || PLAIN_IDS[el.id])) {
      // percentages, or CSS-driven transforms (.hudbtn:active, .hudbtn.pulse)
      const cs = getComputedStyle(el);
      tf = cs.transform; origin = cs.transformOrigin;
    } else tf = null;
    if (tf && tf !== 'none') {
      const t = new DOMMatrix(tf);
      const [ox, oy] = originOf(origin);
      m = ox || oy ? m.translate(ox, oy).multiply(t).translate(-ox, -oy) : m.multiply(t);
    }
    return m;
  }
  function cumMatrix(el, pass) {
    let m = pass && pass.get(el);
    if (m) return m;
    const E = AT.engine;
    const par = el.parentElement;
    if (E && el === E.stage) m = new DOMMatrix().scale(dpr()).translate(E.ox || 0, E.oy || 0).scale(E.scale || 1);
    else if (!par || par === document.body || par === document.documentElement) {
      const r = el.getBoundingClientRect();
      m = new DOMMatrix().scale(dpr()).translate(r.left, r.top);
    } else m = cumMatrix(par, pass).multiply(localMatrix(el));
    if (pass) pass.set(el, m);
    return m;
  }
  // Maps the img's sprite box origin (its left/top, before its own transform) to device pixels.
  function deviceMatrix(im, pass) {
    if (!im.parentElement) return null;
    return cumMatrix(im.parentElement, pass).translate(parseFloat(im.style.left) || 0, parseFloat(im.style.top) || 0);
  }
  const scaleOf = (M) => Math.max(Math.hypot(M.a, M.b), Math.hypot(M.c, M.d));
  // device pixels per sprite unit, to 3 decimals (0 when detached)
  function kOf(im, pass) {
    const M = deviceMatrix(im, pass);
    return M ? round3(scaleOf(M)) : 0;
  }

  // ----- painting bitmaps -----
  function svgImage(id) {
    let p = svgImgs.get(id);
    if (!p) {
      p = new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = url(id);
      }).then((im) => (im && im.decode ? im.decode().then(() => im, () => im) : im));
      svgImgs.set(id, p);
    }
    return p;
  }
  // The engine must paint the SVG's vectors at the canvas scale, not upscale its
  // intrinsic size: a 1-unit line drawn at k=3 must come out 3 px wide and solid.
  let checked = null;
  function selfCheck() {
    if (!checked) {
      checked = (async () => {
        if (mode !== 'bitmap') return;
        let ok = false;
        try {
          const u = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><rect x="4" y="0" width="1" height="10" fill="#000"/></svg>'], { type: 'image/svg+xml' }));
          const im = new Image();
          im.src = u;
          await im.decode();
          const cv = document.createElement('canvas');
          cv.width = cv.height = 30;
          const g = cv.getContext('2d', { willReadFrequently: true });
          g.drawImage(im, 0, 0, 30, 30);
          const d = g.getImageData(0, 15, 30, 1).data;
          let wide = 0, solid = 0;
          for (let x = 0; x < 30; x++) { if (d[x * 4 + 3] > 127) wide++; if (d[x * 4 + 3] === 255) solid++; }
          URL.revokeObjectURL(u);
          ok = wide >= 2 && wide <= 4 && solid >= 2;
        } catch (e) { ok = false; }
        if (!ok) toSvgMode();
      })();
    }
    return checked;
  }
  function toSvgMode() {
    if (mode === 'svg') return;
    mode = 'svg';
    if (typeof document !== 'undefined') document.querySelectorAll('img[data-k]').forEach(unapply);
  }
  // Paint one bitmap (synchronous). Returns an entry or null.
  function bake(id, k, svg) {
    const sp = sprites[id];
    const w = sp.box[2], h = sp.box[3];
    const cw = Math.ceil(w * k - 1e-6), ch = Math.ceil(h * k - 1e-6);
    if (!svg || cw < 1 || ch < 1 || cw * ch > MAX_PX) { st.svgFallbacks++; return null; }
    const t0 = performance.now();
    let d;
    try {
      const cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      // default options: no willReadFrequently and no getImageData here, so the canvas can stay on the GPU
      cv.getContext('2d').drawImage(svg, 0, 0, w * k, h * k);
      // toDataURL, not toBlob/convertToBlob: those wait for idle time (tens of seconds while frames are busy)
      d = cv.toDataURL('image/png');
      cv.width = cv.height = 0;
    } catch (e) {
      if (e && e.name === 'SecurityError') toSvgMode();
      st.svgFallbacks++;
      return null;
    }
    const bin = atob(d.slice(d.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    const ms = performance.now() - t0;
    st.jobs++; st.ms += ms; st.bytes += blob.size;
    learnMs += ms; learnPx += cw * ch;
    const entry = { key: keyOf(id, k), id, k, url: URL.createObjectURL(blob), blob, cw, ch, ms, bytes: blob.size, used: ++useClock };
    // keep a decoded copy referenced so swapping the src is immediate
    entry.pre = new Image();
    entry.pre.src = entry.url;
    return entry;
  }
  async function runJob(job) {
    const svg = await svgImage(job.id);
    if (mode !== 'bitmap') return null;
    await nextTask();
    if (mode !== 'bitmap') return null;
    const entry = bake(job.id, job.k, svg);
    if (!entry) return null;
    try { await entry.pre.decode(); } catch (e) { /* shown anyway once loaded */ }
    return entry;
  }
  function store(entry) {
    cache.set(entry.key, entry);
    byUrl.set(entry.url, entry);
  }
  async function pump() {
    if (running) return;
    running = true;
    try {
      await selfCheck();
      while (queue.length) {
        const job = queue.shift();
        let entry = null;
        if (mode === 'bitmap') { try { entry = await runJob(job); } catch (e) { entry = null; } }
        if (entry) store(entry);
        inflight.delete(job.key);
        job.resolve(entry);
      }
    } finally {
      running = false;
      checkIdle();
    }
  }
  // Promise of the bitmap of sprite id at scale k (shared while in flight).
  function rasterize(id, k) {
    const key = keyOf(id, k);
    const hit = cache.get(key);
    if (hit) return Promise.resolve(hit);
    let p = inflight.get(key);
    if (!p) {
      p = new Promise((resolve) => queue.push({ id, k, key, resolve }));
      inflight.set(key, p);
      pump();
    }
    return p;
  }
  // estimated ms to paint sprite id at k (from the jobs so far)
  function estimate(id, k) {
    const b = sprites[id].box;
    const px = Math.ceil(b[2] * k) * Math.ceil(b[3] * k);
    return (learnPx > 2e5 ? learnMs / learnPx : 1.5e-4) * px;
  }

  // ----- putting bitmaps into imgs -----
  function apply(im, e, pass) {
    const M = deviceMatrix(im, pass);
    let s = e.k, nx = 0, ny = 0;
    if (M) {
      const kNow = scaleOf(M);
      // made for this scale: map exactly one bitmap pixel to one device pixel
      if (Math.abs(kNow / e.k - 1) < 0.002) s = kNow;
      if (tuning.snap && Math.abs(M.b) < 1e-6 && Math.abs(M.c) < 1e-6 && Math.abs(M.a) > 1e-6 && Math.abs(M.d) > 1e-6) {
        nx = (Math.round(M.e) - M.e) / M.a;
        ny = (Math.round(M.f) - M.f) / M.d;
      }
    }
    if (im.getAttribute('src') !== e.url) im.src = e.url;
    const css = im.style;
    if (tuning.boxSize) {
      const b = sprites[e.id].box;
      css.width = b[2] + 'px'; css.height = b[3] + 'px';
      css.transform = ''; css.transformOrigin = '';
    } else {
      css.width = e.cw + 'px'; css.height = e.ch + 'px';
      css.transformOrigin = '0 0';
      css.transform = `translate(${+nx.toFixed(5)}px,${+ny.toFixed(5)}px) scale(${1 / s})`;
    }
    im.dataset.k = e.k;
    e.used = ++useClock;
  }
  // back to the plain SVG image
  function unapply(im) {
    const sp = sprites[im.dataset.sprite];
    if (!sp) return;
    im.src = url(im.dataset.sprite);
    im.style.width = sp.box[2] + 'px';
    im.style.height = sp.box[3] + 'px';
    im.style.transform = '';
    im.style.transformOrigin = '';
    delete im.dataset.k;
  }
  // Ask for the bitmap of im's sprite at scale k: applied now when cached, else when painted.
  // Returns null (nothing to wait for) or a promise.
  function want(im, k) {
    const id = im.dataset.sprite;
    if (!sprites[id] || !(k >= 0.01) || !isFinite(k)) return null;
    const key = keyOf(id, k);
    im._atWant = key;
    const hit = cache.get(key);
    if (hit) { st.hits++; apply(im, hit); return null; }
    st.misses++;
    busy++;
    return rasterize(id, k).then((entry) => {
      if (entry && im._atWant === key && mode === 'bitmap' && im.dataset.sprite === id) apply(im, entry);
    }).finally(() => { busy--; checkIdle(); });
  }
  // Is anything between im and the stage in the middle of a scale tween (E.tween)?
  function underTween(im) {
    for (let el = im.parentElement; el; el = el.parentElement) if (el._atTween > 0) return true;
    return false;
  }
  function fitOne(im, pass) {
    if (mode !== 'bitmap' || underTween(im)) return null; // tweens refit when they end
    const k = kOf(im, pass);
    return want(im, round3(k * tuning.oversample));
  }
  // Fit every sprite img under root to its current device scale. Resolves once all are bitmaps
  // (or have stayed SVG). opts.onProgress(fraction) reports painted area (cw*ch) over the total.
  function fit(root, opts = {}) {
    if (mode !== 'bitmap' || !root || !root.querySelectorAll) return Promise.resolve();
    const imgs = root.tagName === 'IMG' ? [root] : [...root.querySelectorAll('img[data-sprite]')];
    const pass = new Map();
    const waits = [];
    let total = 0, done = 0;
    const report = () => { if (opts.onProgress) { try { opts.onProgress(total ? done / total : 1); } catch (e) { /* ignore */ } } };
    for (const im of imgs) {
      pendingFit.delete(im);
      const p = fitOne(im, pass);
      if (!p) continue;
      const b = sprites[im.dataset.sprite].box, k = kOf(im, pass);
      const area = b[2] * b[3] * k * k;
      total += area;
      waits.push(p.then(() => { done += area; report(); }));
    }
    report();
    checkIdle();
    return Promise.all(waits).then(() => {});
  }
  // new imgs (Node constructor, puppets, swap, particles) are fitted right after the code that made them
  function schedule(el) {
    pendingFit.add(el);
    if (!flushQueued) { flushQueued = true; later(flush); }
  }
  function flush() {
    flushQueued = false;
    const list = [...pendingFit];
    pendingFit.clear();
    const pass = new Map();
    for (const im of list) if (im.isConnected) fitOne(im, pass);
    checkIdle();
  }
  // Change which sprite an existing img shows (keeps the element).
  function setSprite(im, id) {
    const sp = sprites[id];
    if (!sp) throw new Error('No sprite ' + id);
    im._atWant = null;
    im.dataset.sprite = id;
    im.src = url(id);
    if (mode !== 'bitmap') return im; // placement untouched, as before this layer existed
    im.style.width = sp.box[2] + 'px';
    im.style.height = sp.box[3] + 'px';
    im.style.transform = '';
    im.style.transformOrigin = '';
    delete im.dataset.k;
    schedule(im);
    return im;
  }
  // ----- scale tweens (called by E.tween for a Node and s/sx/sy) -----
  // ease: the tween's easing function, whose overshoot (back, elastic) counts too.
  function tweenStart(node, to, ease) {
    if (mode !== 'bitmap') return;
    node.el._atTween = (node.el._atTween || 0) + 1;
    // bitmaps still being painted for the old size are not put in
    node.el.querySelectorAll('img[data-sprite]').forEach((im) => { im._atWant = null; });
    const imgs = node.el.querySelectorAll('img[data-k]');
    if (!imgs.length) return;
    let vmin = 0, vmax = 1;
    for (let i = 0; i <= 64; i++) { const v = ease(i / 64); if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
    const cur = { s: node.s, sx: node.sx, sy: node.sy };
    const big = {};
    for (const p in cur) {
      if (!(p in to)) continue;
      big[p] = Math.max(Math.abs(cur[p] + (to[p] - cur[p]) * vmin), Math.abs(cur[p] + (to[p] - cur[p]) * vmax));
    }
    // the largest device scale each img reaches (set, measure, restore: nothing paints in between)
    node.set(big);
    const pass = new Map();
    const need = [...imgs].map((im) => kOf(im, pass));
    node.set(cur);
    // a bitmap that would be magnified shows its SVG for the tween instead
    imgs.forEach((im, i) => { if (+im.dataset.k < need[i] / 1.01) unapply(im); });
  }
  function tweenEnd(node) {
    if (node.el._atTween > 0) node.el._atTween--;
    if (mode === 'bitmap' && node.el.isConnected) fit(node.el);
  }

  // the sprite an img currently displays (from its src: SVG or bitmap), or null
  function shows(im) {
    const src = im.getAttribute('src');
    const e = byUrl.get(src);
    if (e) return e.id;
    const id = im.dataset.sprite;
    return sprites[id] && sprites[id].url === src ? id : null;
  }
  const stats = () => ({ ...st, ms: Math.round(st.ms), cached: cache.size, mode });

  return {
    define, img, url, svgOf, box, has, list,
    get mode() { return mode; },
    fit, idle, stats, setSprite, shows, kOf, deviceMatrix, rasterize, estimate, tweenStart, tweenEnd,
    C, E, R, smooth, blob, fluff, puffs, star, heart, line, rng, group,
    mix, inkOf, shade, tint, SEPIA,
  };
})();
