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
  // k   : ink line, ks: fine ink line, ke: solid ink for closed eyes (no pencil grain, so they never fade out)
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
${ink('ke', 1.4, 0.4, 0.3)}
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
      sp.text = svgOf(id);
      const blobObj = new Blob([sp.text], { type: 'image/svg+xml' });
      sp.url = URL.createObjectURL(blobObj);
    }
    return sp.url;
  }
  // Create an <img> positioned in its drawing's coordinate system (relative to a 0x0 parent origin).
  function img(id, cls) {
    const sp = sprites[id];
    if (!sp) throw new Error('No sprite ' + id);
    const el = document.createElement('img');
    // (bitmap mode: no src until it is fitted, see ensureSvg)
    if (mode !== 'bitmap') el.src = url(id);
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
  //     the browser anyway). The shift is worked out when a bitmap is put in,
  //     and again whenever the sprite comes to rest somewhere else (resnap:
  //     after a camera pan or a move, and at the once-a-second sweep).
  // Until its bitmap is ready an img keeps its SVG src, which looks the same
  // (it is only slower). ?raster=svg, a failed boot self-check or a canvas
  // SecurityError switch everything back to plain SVG images: exactly the
  // rendering this layer replaces, kept as a kill switch.
  //
  // INVARIANT (checked by audit(), asserted before every visual-test screenshot):
  //   - a displayed bitmap is never magnified: k_bitmap >= k_display / 1.01;
  //   - a sprite at rest shows k_bitmap = k_display within 0.1%, starting on a
  //     whole device pixel when it is axis-aligned;
  //   - when no such bitmap is ready, the img shows its SVG.
  // Moving sprites may show a bitmap painted for a somewhat bigger scale (the
  // browser scales it down): scale tweens use the bitmap for the largest scale
  // they reach, in 2^(1/8) steps (tweenStart: up to 9% above at the peak, and
  // as much as the tween shrinks below it); particles one for their largest
  // scale, in 2^(1/4) steps (they move, spin and fade); sprites under a CSS
  // animation (.hudbtn.pulse) one for the animation's peak keyframe; sprites
  // whose scale changes every frame (pulsing Play button, breathing puppets,
  // squashing bugs) follow it both ways through 2^(1/32) steps, so they are
  // shown at most about 3% above their scale (checkScales). sweep() runs once
  // per second of game clock: paints sprites still on SVG, catches other
  // changes, and settles a sprite on its exact scale (and pixel grid) once it
  // has stopped changing. Resizes: resized() at once, then js/game.js refits
  // the stage. Decoded bitmap bytes stay within a budget (evict).
  const MAX_PX = 16e6; // iOS refuses bigger canvases: such sprites stay SVG
  const params = (() => { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(''); } })();
  // test-only knobs (tests/visual/raster-parity.spec.mjs proves that broken variants fail;
  // budgetBytes lets tests/e2e force evictions; js/game.js reads refitCoverMs)
  // async: paint off the main thread where proven exact (?bake=sync turns it off)
  const tuning = Object.assign({ snap: true, resnap: true, boxSize: false, oversample: 1, budgetBytes: 0, async: params.get('bake') !== 'sync' }, (typeof window !== 'undefined' && window.__AT_RASTER_TUNING) || {});
  let mode = params.get('raster') === 'svg' ? 'svg' : 'bitmap';
  const cache = new Map();      // `${id}@${k.toFixed(3)}` -> entry {key, id, k, url, blob, cw, ch, ms, bytes, decoded, used, pre}
  const byUrl = new Map();      // bitmap url -> entry
  const byId = new Map();       // sprite id -> Set of its entries
  const jobs = new Map();       // key -> queued or running job {id, k, key, px, pri, promise, resolve, by: [{im, prefetch, urgent} | {tag}], direct}
  const queue = [];             // jobs waiting (most urgent first, then the biggest: see pick())
  const svgImgs = new Map();    // id -> Promise<loaded SVG HTMLImageElement|null>
  const svgReady = new Map();   // id -> loaded SVG HTMLImageElement (for painting synchronously)
  const failed = new Set();     // keys that cannot be painted (too big, decode errors)
  const pendingFit = new Set(); // imgs created since the last microtask flush
  const idleWaiters = [];
  const st = { jobs: 0, ms: 0, hits: 0, misses: 0, svgFallbacks: 0, bytes: 0, decoded: 0, evicted: 0, syncJobs: 0, dropped: 0, resnaps: 0, asyncJobs: 0, asyncMs: 0, asyncFallbacks: 0, asyncKept: 0, asyncStored: 0, prefetched: 0, idleJobs: 0, playMisses: 0, playRandom: 0, playLate: 0, stored: 0, storedBad: 0, nearHits: 0 };
  const debug = params.get('debug') === '1';
  const SYNC_MS = 40; // a bitmap estimated to cost at most this may be painted on the spot (never inside an input event)
  let running = false, flushQueued = false, busy = 0, useClock = 0;
  let held = false; // a resize refit is pending: sweeps and ratchets wait for it (js/game.js)
  let learnMs = 0, learnPx = 0; // for cost estimates: ms per device pixel of finished jobs
  const later = typeof queueMicrotask === 'function' ? queueMicrotask : (fn) => Promise.resolve().then(fn);
  const dpr = () => (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const keyOf = (id, k) => `${id}@${k.toFixed(3)}`;
  const round3 = (k) => Math.round(k * 1000) / 1000;
  // Inside a pointer/mouse/touch/key event handler? (No painting on the spot there: it
  // would delay the frame that answers the child's finger.)
  const INPUT = /^(pointer|mouse|touch|key|click|dblclick|wheel)/;
  const inInput = () => { const ev = typeof window !== 'undefined' && window.event; return !!(ev && ev.type && INPUT.test(ev.type)); };

  // One sprite per macrotask, so input and animation frames interleave between
  // sprites. A big sprite is still one long task (canvas.toDataURL paints and
  // PNG-encodes it in one go: about 2 s for a 2560x1440 background at 1x CPU).
  let chan = null;
  const taskQ = [];
  const nextTask = () => new Promise((resolve) => {
    if (typeof MessageChannel === 'undefined') return setTimeout(resolve, 0);
    if (!chan) { chan = new MessageChannel(); chan.port1.onmessage = () => { const r = taskQ.shift(); if (r) r(); }; }
    taskQ.push(resolve);
    chan.port2.postMessage(0);
  });

  function checkIdle() {
    if (running || queue.length || busy || pendingFit.size || flushQueued || dirtyQueued || snapQueued) return;
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
  const plainEl = (el) => PLAIN.test(el.className) || PLAIN_IDS[el.id];
  const originOf = (v) => {
    if (!v) return [0, 0];
    const p = v.split(/\s+/).map(parseFloat);
    return [p[0] || 0, p[1] || 0];
  };
  // peak: CSS animations at their largest keyframe instead of their current frame
  function localMatrix(el, peak) {
    const s = el.style;
    let m = new DOMMatrix().translate(parseFloat(s.left) || 0, parseFloat(s.top) || 0);
    let tf = s.transform, origin;
    if (tf && tf !== 'none' && tf.indexOf('%') < 0) {
      origin = s.transformOrigin || (ZERO_ORIGIN.test(el.className) || PLAIN_IDS[el.id] ? '' : getComputedStyle(el).transformOrigin);
    } else if ((tf && tf.indexOf('%') >= 0) || !plainEl(el)) {
      // percentages, or CSS-driven transforms (.hudbtn:active, .hudbtn.pulse)
      const cs = getComputedStyle(el);
      tf = cs.transform; origin = cs.transformOrigin;
      if (peak) { const p = animPeak(cs); if (p) tf = p; }
    } else tf = null;
    if (tf && tf !== 'none') {
      const t = typeof tf === 'string' ? new DOMMatrix(tf) : tf;
      const [ox, oy] = originOf(origin);
      m = ox || oy ? m.translate(ox, oy).multiply(t).translate(-ox, -oy) : m.multiply(t);
    }
    return m;
  }
  function cumMatrix(el, pass, peak) {
    let m = pass && pass.get(el);
    if (m) return m;
    const E = AT.engine;
    const par = el.parentElement;
    if (E && el === E.stage) m = new DOMMatrix().scale(dpr()).translate(E.ox || 0, E.oy || 0).scale(E.scale || 1);
    else if (!par || par === document.body || par === document.documentElement) {
      const r = el.getBoundingClientRect();
      m = new DOMMatrix().scale(dpr()).translate(r.left, r.top);
    } else m = cumMatrix(par, pass, peak).multiply(localMatrix(el, peak));
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

  // ----- CSS animations (.hudbtn.pulse: scale 1 -> 1.18 -> 1, forever) -----
  // They never go through Node.set, and a once-a-second sweep samples a 1 s pulse at
  // the same phase every time. So a sprite under a running CSS animation gets the
  // bitmap for the animation's largest keyframe (read from the stylesheet), as soon
  // as the animation starts (animationstart) and at every sweep; it counts as moving.
  // (Computed animation-name, not el.getAnimations(): Safari has that only from 13.1.)
  const peaks = {}; // animation name -> DOMMatrix of its largest keyframe transform, or null
  function keyframePeak(name) {
    if (name in peaks) return peaks[name];
    let best = null, bs = 1;
    try {
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch (e) { continue; } // cross-origin (web fonts)
        for (const r of rules || []) {
          if (r.name !== name || !r.cssRules) continue; // @keyframes <name>
          for (const kf of r.cssRules) {
            const tf = kf.style && kf.style.transform;
            if (!tf || tf === 'none') continue;
            try { const m = new DOMMatrix(tf); if (scaleOf(m) > bs) { bs = scaleOf(m); best = m; } } catch (e) { /* relative units */ }
          }
        }
      }
    } catch (e) { best = null; }
    // (keyframes without a transform use the element's own, which is none for .hudbtn)
    return (peaks[name] = best);
  }
  function animPeak(cs) {
    const names = cs.animationName;
    if (!names || names === 'none') return null;
    let best = null;
    for (const n of names.split(',')) {
      const m = keyframePeak(n.trim());
      if (m && (!best || scaleOf(m) > scaleOf(best))) best = m;
    }
    return best;
  }
  // Is a CSS animation running on el or an ancestor (below the stage)? Only elements whose
  // transform comes from CSS (not .node/.inner/.cardclip/#world/#ui/#fxs/#hud) can have one.
  function animatedEl(el, pass) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const memo = pass && pass.anim;
    if (memo && memo.has(el)) return memo.get(el);
    const E = AT.engine;
    let a = false;
    if (!(E && el === E.stage)) {
      if (!plainEl(el)) { const n = getComputedStyle(el).animationName; a = !!n && n !== 'none'; }
      if (!a) a = animatedEl(el.parentElement, pass);
    }
    if (pass) (pass.anim || (pass.anim = new Map())).set(el, a);
    return a;
  }
  const animated = (im, pass) => !!im.parentElement && animatedEl(im.parentElement, pass);
  // device matrix with every CSS animation on the way at its peak
  const peakMatrix = (im) => (im.parentElement ? cumMatrix(im.parentElement, null, true).translate(parseFloat(im.style.left) || 0, parseFloat(im.style.top) || 0) : null);
  const kPeak = (im) => { const M = peakMatrix(im); return M ? round3(scaleOf(M)) : 0; };

  // ----- painting bitmaps -----
  function svgImage(id) {
    let p = svgImgs.get(id);
    if (!p) {
      p = new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = url(id);
      }).then((im) => (im && im.decode ? im.decode().then(() => im, () => im) : im))
        .then((im) => { if (im) svgReady.set(id, im); return im; });
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
    if (typeof document !== 'undefined') {
      document.querySelectorAll('img[data-k]').forEach(unapply);
      document.querySelectorAll('img[data-sprite]').forEach(ensureSvg);
    }
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
    learnMs += ms; learnPx += cw * ch;
    return makeEntry(id, k, cw, ch, blob, ms);
  }
  // (fromStore: loaded from js/raster-cache.js, not painted. A painted one is stored there once it
  // is kept: store(), never before, e.g. while an off-thread one waits for the boot probe's answer.)
  function makeEntry(id, k, cw, ch, blob, ms, fromStore) {
    if (!fromStore) { st.jobs++; st.ms += ms; }
    // decoded: what it costs in memory once shown (the PNG bytes are a fraction of that)
    const entry = { key: keyOf(id, k), id, k, url: URL.createObjectURL(blob), blob, cw, ch, ms, bytes: blob.size, decoded: cw * ch * 4, used: ++useClock, fresh: !fromStore };
    // keep a decoded copy referenced so swapping the src is immediate
    entry.pre = new Image();
    entry.pre.src = entry.url;
    return entry;
  }

  // ----- painting off the main thread (Chromium) -----
  // Chromium rasterises createImageBitmap(<img> showing an SVG) on a background thread: the
  // main thread only records the picture (about 1 ms, even for a background). A wrapper SVG of
  // cw x ch draws the sprite's own SVG text as an <image> into (0, 0, w*k, h*k): the same
  // source->destination map and the same recorded picture as drawImage(svg, 0, 0, w*k, h*k) in
  // bake(), so the pixels are identical. (Putting the scale in a viewBox or a transform instead
  // composes the matrices differently and changes a few edge pixels.) This is checked at boot on a
  // probe (asyncCheck); sprites with rotated or skewed shapes stay on bake(), because their
  // filters are resampled differently on that thread (teddy: up to 9 levels). The bitmap is
  // PNG-encoded by a worker (OffscreenCanvas.convertToBlob), else by canvas.toBlob (idle time),
  // so imgs keep PNG blob URLs exactly as before, and a persistent cache can store the same Blob.
  // Up to ASYNC_MAX sprites are painted at once (in parallel on a multi-core device), within
  // ASYNC_PX device pixels in flight (each in flight holds about 3 copies of 4 bytes per pixel).
  // Off-thread rasters run on the browser's worker threads, which also rasterise the page's own
  // tiles: while the stage is on screen and moving (a scene played or fading out) at most
  // ASYNC_SHOWN run at once, so its frames still get a thread (4 long rasters froze a fade-out
  // for a second); behind a cover or under a still preview, up to ASYNC_MAX jobs are under way
  // (lanes(): js/game.js): a job spends most of its time loading, encoding and decoding rather
  // than rasterising, so the many small ones of a scene need many in flight to keep the threads
  // busy (the pixel cap keeps the big ones to a few at a time).
  const ASYNC_MAX = 12, ASYNC_SHOWN = 2;
  let asyncLanes = ASYNC_SHOWN;
  const lanes = (covered) => {
    asyncLanes = covered ? ASYNC_MAX : ASYNC_SHOWN;
    asyncPx = covered ? 16e6 : 12e6;
    if (slotWake) { const w = slotWake; slotWake = null; w(); }
  };
  let asyncPx = 12e6; // device pixels in flight at most (each holds about 3 copies of 4 bytes)
  const ON_THREAD_DIFFERS = /rotate\(|skewX|skewY|matrix\(/;
  let asyncReady = null; // Promise<boolean>: off-thread painting is exact here
  let asyncOk = null;    // its answer once known (until then painting goes ahead off the main thread)
  let inflight = 0, inflightPx = 0, bigInflight = 0, slotWake = null;
  const loadImage = (src) => new Promise((resolve, reject) => {
    const im = new Image();
    // (ahead of the scene's own imgs, whose plain SVG is only a stand-in: Chromium otherwise loads
    // those first, and the first scene's long background raster would start some 0.3 s later)
    im.fetchPriority = 'high';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('load'));
    im.src = src;
  }).then((im) => (im.decode ? im.decode().then(() => im, () => im) : im));
  // w*k as an SVG length that the SVG parser reads as exactly float(w*k), which is what
  // drawImage uses (the plain decimal of the double can come out one float step off: 112*1.297
  // = 145.26400000000001 did, and changed 2 pixels); null if none does.
  let lenProbe = null;
  function exactLen(x) {
    const f = Math.fround(x);
    if (!lenProbe) lenProbe = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    const cands = [String(f), f.toPrecision(9)];
    for (let i = 0; i < cands.length; i++) {
      lenProbe.setAttribute('width', cands[i]);
      if (lenProbe.width.baseVal.value === f) return cands[i];
    }
    return null;
  }
  function wrapper(text, w, h, k, cw, ch) {
    const lw = exactLen(w * k), lh = exactLen(h * k);
    if (lw === null || lh === null) return null;
    const s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + cw + '" height="' + ch + '"><image href="data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(text) + '" width="' + lw + '" height="' + lh + '" preserveAspectRatio="none"/></svg>';
    return URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' }));
  }
  // ImageBitmap of the SVG text painted at k (cw x ch), rasterised off the main thread
  const SUPERSEDED = new Error('superseded');
  let loadingWrappers = 0, rastering = 0;
  const startWaiters = [];
  const wrapperLoaded = () => {
    loadingWrappers--;
    if (!loadingWrappers || rastering >= 3) while (startWaiters.length) startWaiters.shift()();
  };
  // Resolves once the painting under way keeps the worker threads busy (three rasters running, or
  // every job past loading its image), or after `ms`: the cold preview's own SVG images are loaded
  // after that, as the page parses those one at a time (js/game.js).
  function whenPainting(ms) {
    return new Promise((resolve) => {
      if ((!loadingWrappers && !queue.length) || rastering >= 3) { resolve(); return; }
      startWaiters.push(resolve);
      setTimeout(resolve, ms);
    });
  }
  function bitmapOf(text, w, h, k, cw, ch, wanted) {
    const u = wrapper(text, w, h, k, cw, ch);
    if (!u) return Promise.reject(new Error('length'));
    const done = () => URL.revokeObjectURL(u);
    let t0 = 0;
    loadingWrappers++;
    let r = false;
    return loadImage(u).then((im) => {
      if (wanted && !wanted()) { wrapperLoaded(); throw SUPERSEDED; } // (a resize or a newer request since it was queued)
      t0 = performance.now();
      rastering++; r = true;
      wrapperLoaded();
      return createImageBitmap(im);
    }, (e) => { wrapperLoaded(); throw e; }).then((bm) => {
      rastering--; r = false;
      done();
      // (background raster time: an upper bound for painting it here, on the safe side for estimate())
      learnMs += performance.now() - t0; learnPx += cw * ch;
      if (bm.width !== cw || bm.height !== ch) { if (bm.close) bm.close(); throw new Error('size'); }
      return bm;
    }, (e) => { if (r) rastering--; done(); throw e; });
  }
  // PNG Blob of an ImageBitmap (the bitmap is handed over: transferred or closed)
  // Two workers on a device with four or more cores, so that encoding a background (a fifth of a
  // second) does not hold up the small bitmaps painted meanwhile; the second starts when needed.
  let encoder; // the first Worker | null (unavailable) | undefined (not tried yet)
  let encSeq = 0;
  const encWaits = new Map();
  const encoders = []; // [{w, px}]: px = pixels waiting to be encoded there
  const ENCODERS = typeof navigator !== 'undefined' && navigator.hardwareConcurrency >= 4 ? 2 : 1;
  const ENC_SRC = 'onmessage=function(e){var m=e.data,c=new OffscreenCanvas(m.b.width,m.b.height);c.getContext("2d").drawImage(m.b,0,0);m.b.close();' +
    'c.convertToBlob({type:"image/png"}).then(function(b){postMessage({id:m.id,blob:b})},function(){postMessage({id:m.id,blob:null})})}';
  function newEncoder() {
    const w = new Worker(URL.createObjectURL(new Blob([ENC_SRC], { type: 'text/javascript' })));
    w.onmessage = (ev) => { const r = encWaits.get(ev.data.id); encWaits.delete(ev.data.id); if (r) r(ev.data.blob); };
    // (any worker failing: canvas.toBlob from then on)
    w.onerror = (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); encoder = null; encWaits.forEach((r) => r(null)); encWaits.clear(); };
    const e = { w, px: 0 };
    encoders.push(e);
    return e;
  }
  function encoderWorker() {
    if (encoder !== undefined) return encoder;
    encoder = null;
    try {
      // (?enc=toblob, and the one-file artifact bundle: its host's Content-Security-Policy may forbid
      // blob: workers, and a refused worker logs a console error; tools/build-artifact.mjs sets AT_BUNDLE)
      if (params.get('enc') === 'toblob' || window.AT_BUNDLE || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || !OffscreenCanvas.prototype.convertToBlob) return null;
      encoder = newEncoder().w;
    } catch (e) { encoder = null; }
    return encoder;
  }
  function encodePng(bm) {
    if (encoderWorker()) {
      let enc = encoders[0];
      for (const e of encoders) if (e.px < enc.px) enc = e;
      if (enc.px && encoders.length < ENCODERS) { try { enc = newEncoder(); } catch (e) { /* the first one will do */ } }
      const px = bm.width * bm.height;
      enc.px += px;
      return new Promise((resolve) => { const id = ++encSeq; encWaits.set(id, resolve); enc.w.postMessage({ id, b: bm }, [bm]); })
        .then((blob) => { enc.px -= px; return blob || Promise.reject(new Error('encode')); });
    }
    const cv = document.createElement('canvas');
    cv.width = bm.width; cv.height = bm.height;
    cv.getContext('bitmaprenderer').transferFromImageBitmap(bm);
    return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png'));
  }
  // Probe: a small drawing with every kind of wash and ink at a fractional scale, painted both ways.
  function asyncCheck() {
    if (asyncReady) return asyncReady;
    asyncReady = (async () => {
      if (mode !== 'bitmap' || !tuning.async || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return false;
      try {
        const w = 60, h = 44, k = 1.493, cw = Math.ceil(w * k - 1e-6), ch = Math.ceil(h * k - 1e-6);
        const shapes = [
          { d: C(18, 22, 13), f: '#ef5b5b' },
          { d: C(40, 20, 12), f: '#7cc4ea', fx: 't', o: 0.8 },
          { d: R(4, 26, 52, 14, 5), f: '#ffd23f', fx: 'bg' },
          { d: C(30, 14, 6), f: '#fff3b0', fx: 'ws', k: false },
          { d: line([[6, 6], [30, 2], [54, 8]]), k: SEPIA, sw: 2, f: null },
        ];
        const text = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">' + defs(7) + shapes.map(shapeSvg).join('') + '</svg>';
        encoderWorker(); // (starting up meanwhile)
        const u = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
        const svg = await loadImage(u);
        const read = (src, f) => {
          const cv = document.createElement('canvas');
          cv.width = cw; cv.height = ch;
          const g = cv.getContext('2d', { willReadFrequently: true });
          f(g, src);
          return g.getImageData(0, 0, cw, ch).data;
        };
        const a = read(svg, (g, s) => g.drawImage(s, 0, 0, w * k, h * k));
        URL.revokeObjectURL(u);
        const bm = await bitmapOf(text, w, h, k, cw, ch);
        const b = read(bm, (g, s) => g.drawImage(s, 0, 0));
        let alpha = 0;
        for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) { if (bm.close) bm.close(); return false; } if ((i & 3) === 3) alpha += a[i]; }
        // try the encoder worker once here (a CSP may forbid blob: workers): canvas.toBlob if it fails
        if (encoderWorker()) { const blob = await encodePng(bm).catch(() => null); if (!blob) encoder = null; } else if (bm.close) bm.close();
        return alpha > 0; // (and something was painted)
      } catch (e) { return false; }
    })();
    asyncReady.then((ok) => { asyncOk = ok; });
    return asyncReady;
  }
  const offThread = (id) => !ON_THREAD_DIFFERS.test(sprites[id].text || (sprites[id].text = svgOf(id)));
  function bakeAsync(id, k, wanted, rastered) {
    const sp = sprites[id];
    const w = sp.box[2], h = sp.box[3];
    const cw = Math.ceil(w * k - 1e-6), ch = Math.ceil(h * k - 1e-6);
    if (cw < 1 || ch < 1 || cw * ch > MAX_PX) return Promise.reject(new Error('size')); // (bake() decides)
    const t0 = performance.now();
    return bitmapOf(sp.text, w, h, k, cw, ch, wanted).then((bm) => {
      if (rastered) rastered();
      if (wanted && !wanted()) { if (bm.close) bm.close(); throw SUPERSEDED; }
      return encodePng(bm);
    }, (e) => { if (rastered) rastered(); throw e; }).then((blob) => {
      const ms = performance.now() - t0;
      st.asyncJobs++; st.asyncMs += ms;
      const e = makeEntry(id, k, cw, ch, blob, ms);
      e.off = true; // (painted off the main thread: kept only if the boot probe says that is exact here)
      return e;
    });
  }
  const pxOf = (job) => { const b = sprites[job.id].box; return Math.ceil(b[2] * job.k) * Math.ceil(b[3] * job.k); };
  const slot = () => new Promise((resolve) => { slotWake = resolve; });
  function startAsync(job, px) {
    inflight++; inflightPx += px;
    // (a big one counts against BIG_LANES while it is rasterised, not while it is encoded and decoded)
    let big = px > BIG_PX;
    if (big) bigInflight++;
    const rastered = () => {
      if (!big) return;
      big = false; bigInflight--;
      const w = slotWake; slotWake = null;
      if (w) w();
    };
    // superseded jobs (nobody wants them any more, e.g. after a resize) stop before painting or encoding
    let painted;
    try { painted = bakeAsync(job.id, job.k, () => mode === 'bitmap' && stillWanted(job), rastered); } catch (err) { painted = Promise.reject(err); }
    painted
      // Painting starts before the boot probe has answered, so every off-thread result waits for its
      // answer (memoised: free once known) and is kept only if it says off-thread painting is exact
      // here; otherwise it is thrown away and painted again on this thread. (A job started before a
      // 'no' can finish long after it: the slow ones are the big ones.)
      .then((e) => asyncCheck().then((ok) => {
        if (!ok) { if (e) { URL.revokeObjectURL(e.url); e.pre = null; } throw new Error('probe'); }
        if (e) st.asyncKept++;
        return e;
      }))
      // (decoded now only if an img wants it: a prefetch is decoded when it is shown, as decoding
      // runs on the same threads as the painting)
      .then((e) => (e && job.by.some((r) => r.im) ? predecode(e).then(() => e) : e))
      .catch((err) => { if (err === SUPERSEDED) return null; st.asyncFallbacks++; return 'sync'; })
      .then((e) => {
        if (e !== 'sync') return e;
        // (worker gone, decode error...): paint it here instead
        return runJob(job);
      })
      .then((e) => {
        if (e && mode === 'bitmap') { store(e); idleDone(job); }
        else if (!e && !failed.has(job.key)) st.dropped++;
        jobs.delete(job.key);
        job.resolve(e && mode === 'bitmap' ? e : null);
      })
      .finally(() => {
        inflight--; inflightPx -= px;
        rastered();
        const w = slotWake; slotWake = null;
        if (w) w();
        checkIdle();
      });
  }
  // Does anyone still want this job's bitmap? (A resize or a new request may have
  // superseded it while it waited, or its img may be gone: then it is not painted.)
  // (prefetches for the old scale are dropped while a resize refit is pending)
  // (a prefetch for a scene or for idle time: while its tag is alive)
  const stillWanted = (job) => job.direct || job.by.some((r) => (r.tag ? r.tag.alive && !held : r.im.isConnected && ((r.prefetch && !held) || r.im._atWant === job.key)));
  async function runJob(job) {
    if (!stillWanted(job)) return null;
    const svg = await svgImage(job.id);
    if (mode !== 'bitmap') return null;
    await nextTask();
    if (mode !== 'bitmap' || !stillWanted(job)) return null;
    const entry = bake(job.id, job.k, svg);
    if (!entry) { failed.add(job.key); return null; }
    await predecode(entry);
    return entry;
  }
  // A painted bitmap is decoded before it is put in, so swapping the src is immediate. Chromium
  // queues img.decode() with the compositor, forcing a frame: while a still preview's SVG is being
  // rasterised, that frame would wait for it (a second or more, the page frozen), so decodes then
  // wait until the preview is on screen (holdDecodes: js/game.js).
  let decodeGate = null;
  const predecode = (e) => (decodeGate || Promise.resolve()).then(() => (e.pre ? e.pre.decode() : null)).catch(() => {});
  function holdDecodes(until) {
    const gate = decodeGate = Promise.resolve(until).catch(() => {}).then(() => { if (decodeGate === gate) decodeGate = null; });
  }
  function store(entry) {
    const old = cache.get(entry.key);
    if (old) drop(old, false); // (never happens: requests are shared)
    // painted (not loaded from the store) and kept: stored across visits, written when idle; not
    // sprites at random sizes (balloons, soap bubbles: a new scale every time, never asked for again)
    if (entry.fresh) {
      entry.fresh = false;
      const d = disk();
      if (d && !randomScale(entry.id, entry.k)) {
        d.put(entry.id, hashOf(entry.id), entry.k, entry);
        if (entry.off) st.asyncStored++;
        // (painted while a scene plays: the rest of its manifest, idle-time prefetches)
        if (playing) d.flushSoon();
      }
    }
    cache.set(entry.key, entry);
    byUrl.set(entry.url, entry);
    if (!byId.has(entry.id)) byId.set(entry.id, new Set());
    byId.get(entry.id).add(entry);
    st.bytes += entry.bytes;
    st.decoded += entry.decoded;
    evict(entry);
  }
  function drop(e, revoke = true) {
    cache.delete(e.key);
    byUrl.delete(e.url);
    const s = byId.get(e.id);
    if (s) s.delete(e);
    st.bytes -= e.bytes;
    st.decoded -= e.decoded;
    if (revoke) { st.evicted++; e.pre = null; URL.revokeObjectURL(e.url); }
  }
  // ----- memory: decoded bitmap bytes kept within a budget -----
  // Decoded size (cw*ch*4), not PNG bytes: a shown bitmap costs its decoded pixels
  // (about 5x its PNG), and so does every cached one the browser keeps decoded.
  function budget() {
    if (tuning.budgetBytes > 0) return tuning.budgetBytes;
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const ua = nav.userAgent || '';
    const small = /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1) || (nav.deviceMemory && nav.deviceMemory <= 4);
    return (small ? 192 : 512) * 1048576;
  }
  // Least recently used bitmaps go first; a bitmap any connected <img> shows or is
  // waiting for is never dropped (revoking its URL would break the image), nor is
  // `keep` (just painted, about to be shown), nor any SVG URL.
  function evict(keep) {
    const limit = budget();
    if (st.decoded <= limit || typeof document === 'undefined') return;
    const inUse = new Set();
    for (const im of document.images) { inUse.add(im.getAttribute('src')); if (im._atWant) inUse.add(im._atWant); }
    for (const e of [...cache.values()].sort((a, b) => a.used - b.used)) {
      if (st.decoded <= limit) break;
      if (e === keep || inUse.has(e.url) || inUse.has(e.key)) continue;
      drop(e);
    }
  }
  async function pump() {
    if (running) return;
    running = true;
    try {
      // The self-checks run meanwhile (started at boot: warm()): a failed one switches to SVG mode,
      // and off-thread results are kept only once the probe has answered yes (startAsync). Painting
      // starts at once, so the first scene's big bitmaps are on their way before its imgs exist.
      selfCheck();
      asyncCheck();
      await storeReady(); // (bitmaps stored on an earlier visit are used, not painted again)
      for (;;) {
        const useAsync = asyncOk !== false && tuning.async && typeof createImageBitmap === 'function';
        if (!queue.length) { if (!inflight && !loadingStored) break; await slot(); continue; }
        const i = pickLane();
        const job = queue[i];
        // sprites whose scale changes every frame (checkScales: a ratchet shows it magnified until its
        // bitmap arrives; an offer is the step it needs in a few frames) go first, painted here: the
        // background round trip (tens of ms, longer behind big jobs) would show them magnified for frames
        const urgent = job.pri === PRI.urgent;
        let entry = cache.get(job.key) || null; // painted meanwhile (by a tween)
        // stored on an earlier visit (js/raster-cache.js): loaded, not painted (several at once)
        const rec = !entry && mode === 'bitmap' && !job.unstored ? stored(job.id, job.k) : null;
        if (rec) {
          if (loadingStored >= STORED_MAX) { await slot(); continue; }
          queue.splice(i, 1);
          if (stillWanted(job)) startStored(job, rec);
          else { st.dropped++; jobs.delete(job.key); job.resolve(null); }
          continue;
        }
        if (!entry && mode === 'bitmap' && useAsync && !urgent && offThread(job.id)) {
          const px = job.px;
          // (idle-time prefetches only while nothing else is being painted, one at a time)
          if (inflight >= asyncLanes || (inflight && inflightPx + px > asyncPx) || (job.pri === PRI.idle && inflight)) { await slot(); continue; }
          queue.splice(i, 1);
          if (stillWanted(job)) { startAsync(job, px); continue; }
          st.dropped++;
          jobs.delete(job.key);
          job.resolve(null);
          continue;
        }
        queue.splice(i, 1);
        await runHere(job, entry);
      }
    } finally {
      running = false;
      checkIdle();
    }
  }
  // Promise of the bitmap of sprite id at scale k (shared while in flight). `by`:
  // {im} when an img asked for it (painted only while it still wants it), {im, prefetch}
  // for a bitmap an img may use soon (painted while the img is connected), nothing for a
  // direct caller (always painted). Resolves null when it could not or need not be painted.
  // by.tag: {alive, pri} of a prefetch (prefetchScene, idlePrefetch).
  function rasterize(id, k, by) {
    k = nearK(id, k);
    const key = keyOf(id, k);
    const hit = cache.get(key);
    if (hit) return Promise.resolve(hit);
    let job = jobs.get(key);
    const px = pxOf({ id, k });
    const pri = !by ? PRI.img : by.urgent ? PRI.urgent : by.tag ? (by.tag.pri === PRI.scene && px > BIG_PX ? PRI.img : by.tag.pri) : PRI.img;
    if (!job) {
      job = { id, k, key, by: [], direct: false, pri, px };
      job.promise = new Promise((resolve) => { job.resolve = resolve; });
      jobs.set(key, job);
      queue.push(job);
      if (slotWake) { const w = slotWake; slotWake = null; w(); } // (pump may be waiting for a free slot)
      pump();
    } else if (pri < job.pri) job.pri = pri;
    if (by) job.by.push(by); else job.direct = true;
    return job.promise;
  }
  // ----- bitmaps stored on an earlier visit -----
  // A hit is a PNG blob on disk: its img only has to decode it (off the main thread). Its size is
  // checked once it has loaded (a record of the wrong size is deleted and the bitmap painted again).
  const STORED_MAX = 8;
  let loadingStored = 0;
  function stored(id, k) {
    const d = disk();
    return d && sprites[id] ? d.get(id, hashOf(id), k) : null;
  }
  function startStored(job, rec) {
    loadingStored++;
    const sp = sprites[job.id];
    const cw = Math.ceil(sp.box[2] * job.k - 1e-6), ch = Math.ceil(sp.box[3] * job.k - 1e-6);
    let e = null;
    // its PNG (from disk; in memory if it was painted this visit and not written yet)
    Promise.resolve().then(() => disk().read(rec)).then((blob) => {
      if (!blob) throw new Error('unreadable');
      e = makeEntry(job.id, job.k, cw, ch, blob, rec.ms || 0, true);
      // decoded now if an img wants it (else only loaded, enough to know its size)
      return job.by.some((r) => r.im) ? predecode(e) : new Promise((r) => { if (e.pre.complete) r(); else { e.pre.onload = r; e.pre.onerror = r; } });
    }).then(() => {
      if (!(e.pre && e.pre.naturalWidth === cw && e.pre.naturalHeight === ch)) throw new Error('size');
      st.stored++;
      if (disk()) disk().touch(rec);
      if (mode === 'bitmap') store(e);
      jobs.delete(job.key);
      job.resolve(mode === 'bitmap' ? e : null);
    }).catch(() => {
      // wrong size, unreadable or not a PNG at all: forget the record and paint the bitmap
      st.storedBad++;
      if (disk()) disk().drop(rec);
      if (e) { URL.revokeObjectURL(e.url); e.pre = null; }
      job.unstored = true;
      queue.push(job);
      pump();
    }).finally(() => {
      loadingStored--;
      const w = slotWake; slotWake = null;
      if (w) w();
      checkIdle();
    });
  }
  // Paint a job on the page's own thread (synchronously, between tasks).
  async function runHere(job, entry) {
    entry = entry || cache.get(job.key) || null;
    if (!entry && mode === 'bitmap') {
      try { entry = await runJob(job); } catch (e) { entry = null; }
      if (entry) { store(entry); idleDone(job); }
      else if (!failed.has(job.key)) st.dropped++;
    }
    jobs.delete(job.key);
    job.resolve(entry);
  }
  // Which queued job next: the most urgent class first (PRI), and within it the biggest, so that on
  // several threads the long jobs start first and the scene is ready soonest (a 2 s background
  // started last would finish alone). A scene's manifest (prefetchScene) comes after its imgs (they
  // must be in before it is uncovered; the rest only before it plays), except its big bitmaps (over
  // a megapixel: close-ups), which start with the scene's own big ones.
  const PRI = { urgent: 0, img: 1, scene: 2, idle: 3 };
  const BIG_PX = 1e6;
  function pick() {
    let b = 0;
    for (let i = 1; i < queue.length; i++) {
      const j = queue[i], q = queue[b];
      if (j.pri < q.pri || (j.pri === q.pri && j.px > q.px)) b = i;
    }
    return b;
  }
  // (but while BIG_LANES big ones are being painted, smaller ones go first: on three worker threads
  // that keeps one painting the many small bitmaps, whose loading and encoding then overlap the big
  // rasters instead of all waiting for them at the end)
  const BIG_LANES = 2;
  function pickLane() {
    const b = pick();
    if (bigInflight < BIG_LANES || queue[b].px <= BIG_PX) return b;
    let s = -1;
    for (let i = 0; i < queue.length; i++) {
      const j = queue[i];
      if (j.px > BIG_PX) continue;
      if (s < 0 || j.pri < queue[s].pri || (j.pri === queue[s].pri && j.px > queue[s].px)) s = i;
    }
    return s < 0 ? b : s;
  }
  // The scale key to use for sprite id at k: k itself, unless k is not cached, being painted or stored
  // and the next key up or down (k +- 0.001) is, within 0.1% of k (scales of 1 and up). Both are within
  // round3's own rounding of the exact scale (an img's key and its scene manifest's can round apart:
  // 1.4925 at 1194x834 came out as 1.492 for the imgs and 1.493 from the manifest, so everything was
  // painted twice), and apply() maps either one 1:1 onto the device pixels.
  function nearK(id, k) {
    const has = (kk) => { const key = keyOf(id, kk); return cache.has(key) || jobs.has(key); };
    if (has(k)) return k;
    const up = round3(k + 0.001), dn = round3(k - 0.001);
    const ok = (kk) => kk >= 0.01 && Math.abs(kk / k - 1) <= 0.001 + 1e-9;
    for (const kk of [up, dn]) if (ok(kk) && has(kk)) { st.nearHits++; return kk; }
    if (stored(id, k)) return k;
    for (const kk of [up, dn]) if (ok(kk) && stored(id, kk)) { st.nearHits++; return kk; }
    return k;
  }
  // A bitmap asked for while a scene is played (not behind its cover) that is not painted yet:
  // playMisses when the scene's manifest (js/sprite-manifest.js) does not list it (a stale
  // manifest: ?debug=1 names it), playRandom for sizes no list can hold (unpredictable), playLate
  // when it is listed but still being painted. how: 'exact' (a sprite at rest, or at a CSS
  // animation's peak), 'tween' (a scale tween's 2^(1/8) step), 'step' (a scale that changes every
  // frame: 2^(1/32)) or 'particle'.
  function missed(id, k, key, how) {
    if (!playing || cache.has(key)) return;
    const job = jobs.get(key);
    if (job) { if (job.by.some((r) => r.tag)) st.playLate++; return; }
    if (unpredictable(id, k, how)) { st.playRandom++; return; }
    st.playMisses++;
    if (debug) console.warn('[AT.art] painted during play:', key);
  }
  // Sizes no manifest can list: random ones (balloons and soap bubbles at rest, particles, foam
  // popping up to a random size: the scene lists the sizes seen when the list was made, not all there
  // can be), and a pulsing sprite stopped at whatever size that moment left it (an exact scale within
  // the steps it pulses through: the wiggly-feeling lines).
  function unpredictable(id, k, how) {
    const m = typeof window !== 'undefined' && window.AT_SPRITES && AT.sceneName && window.AT_SPRITES.scenes[AT.sceneName];
    if (!m) return false;
    if (how === 'exact' && randomScale(id, k)) return true;
    const u = unitScale();
    let lo = Infinity, hi = 0;
    for (const e of m) {
      if (e[0] !== id) continue;
      if (e.length === 4 && ((how === 'particle' && e[3] === 4) || (how === 'tween' && e[3] === 0))) return true;
      if (e.length === 3 && e[2] === 32) { lo = Math.min(lo, stepWindow(e[1], 32)[0] * u); hi = Math.max(hi, stepWindow(e[1], 32)[1] * u); }
    }
    if (how === 'tween' && randomTweens(m).has(id)) return true;
    return how === 'exact' && k >= lo / TRACK && k <= hi;
  }
  // Does the current scene's manifest list sprite id at random sizes ([id, lo, hi, 0]) around k, and
  // not at k itself? (An exact size listed among random ones is one the scene uses every time: the
  // hand-washing foam blobs at rest. That one is painted ahead and stored like any other.)
  function randomScale(id, k) {
    const m = typeof window !== 'undefined' && window.AT_SPRITES && AT.sceneName && window.AT_SPRITES.scenes[AT.sceneName];
    if (!m) return false;
    const u = unitScale();
    let random = false;
    for (const e of m) {
      if (e[0] !== id) continue;
      if (e.length === 2 && Math.abs(round3(kRel(e[1], u)) - k) < 0.0015) return false;
      if (e.length === 4 && e[3] === 0 && k >= (e[1] * u) / 1.1 && k <= e[2] * u * 1.1) random = true;
    }
    return random;
  }
  // estimated ms to paint sprite id at k (from the jobs so far)
  function estimate(id, k) {
    const b = sprites[id].box;
    const px = Math.ceil(b[2] * k) * Math.ceil(b[3] * k);
    return (learnPx > 2e5 ? learnMs / learnPx : 1.5e-4) * px;
  }

  // ----- putting bitmaps into imgs -----
  const axisAligned = (M) => Math.abs(M.b) < 1e-6 && Math.abs(M.c) < 1e-6 && Math.abs(M.a) > 1e-6 && Math.abs(M.d) > 1e-6;
  function apply(im, e, pass) {
    // under a CSS animation the bitmap is for the animation's peak: map it 1:1 there
    const M = animated(im, pass) ? peakMatrix(im) : deviceMatrix(im, pass);
    let s = e.k, nx = 0, ny = 0;
    if (M) {
      const kNow = scaleOf(M);
      // made for this scale: map exactly one bitmap pixel to one device pixel
      if (Math.abs(kNow / e.k - 1) < 0.002) s = kNow;
      // (not under a scale tween: an offset worked out at one scale is wrong at the next, e.g. a card
      // popping open from 0.01; the tween's exact refit snaps it when it ends)
      if (tuning.snap && axisAligned(M) && !underTween(im)) {
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
  // An img made in bitmap mode has no src until it is fitted: then it gets its bitmap if that is
  // ready, else its SVG (ensureSvg: shown until the bitmap is painted, as it looks the same). A scene
  // built behind its cover and fitted there (deferred) never loads its sprites' SVG documents at all:
  // parsing them costs the page about 3 ms each (1 s for a scene at 4x CPU), and holds up loading
  // the images that painting needs. An img without src shows nothing (alt '').
  function ensureSvg(im) {
    if (im.getAttribute('src')) return;
    const id = im.dataset.sprite;
    if (sprites[id]) im.src = url(id);
  }
  // SVG for every shown img under root that has no bitmap yet (a still preview: js/game.js; hidden
  // face variants and parts stay as they are, as nothing moves until the bitmaps are in)
  function showSvg(root) {
    if (!root || !root.querySelectorAll) return;
    for (const im of root.querySelectorAll('img[data-sprite]')) if (im.offsetParent !== null) ensureSvg(im);
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
  // Ask for the bitmap of im's sprite at scale k: applied now when cached, else when painted
  // (defer: painted but left for a later fit to put in, e.g. all at once after a resize).
  // Returns null (nothing to wait for) or a promise.
  function want(im, k, defer, urgent) {
    const id = im.dataset.sprite;
    if (tuning.oversample !== 1) k = round3(k * tuning.oversample);
    if (!sprites[id] || !(k >= 0.01) || !isFinite(k)) { if (!defer) ensureSvg(im); return null; } // (scale 0: SVG, as before)
    k = nearK(id, k);
    const key = keyOf(id, k);
    im._atWant = key;
    const hit = cache.get(key);
    if (hit) { st.hits++; apply(im, hit); return null; }
    st.misses++;
    if (!defer) ensureSvg(im); // (deferred: a scene behind its cover, put in at the end)
    missed(id, k, key, kmaxOf(im) ? 'particle' : urgent ? 'step' : 'exact');
    busy++;
    return rasterize(id, k, { im, urgent: !!urgent, defer: !!defer }).then((entry) => {
      if (!defer && entry && im._atWant === key && mode === 'bitmap' && im.dataset.sprite === id && byUrl.has(entry.url)) {
        // painted for the scale it had when asked (off the main thread that can be some frames ago):
        // if it has grown since (a pulse), it would be shown magnified: ask for the step above instead
        const kd = held || underTween(im) ? 0 : kWanted(im);
        if (kd > entry.k * 1.01) { ratchet(im, kd); return; }
        apply(im, entry);
      }
    }).finally(() => { busy--; checkIdle(); });
  }
  // the smallest cached bitmap of sprite id with lo <= k <= hi
  function cachedBetween(id, lo, hi) {
    let best = null;
    for (const e of byId.get(id) || []) if (e.k >= lo && e.k <= hi && e.pre && (!best || e.k < best.k)) best = e;
    return best;
  }
  // Show a bitmap for (at least) scale k in im right away: a cached one (exact, or at most
  // `slack` bigger), else painted on the spot when that is cheap (<= SYNC_MS) and not inside
  // an input handler, else its SVG while it is painted (`async`: 'always', or 'input' = only
  // a cheap one that was not painted on the spot because an input handler asked for it;
  // otherwise the SVG stays). New bitmaps are painted at bucketUp(k, bucket) when bucket is
  // set (few keys for ever-changing scales).
  function showAtLeast(im, k, { slack = 1.002, bucket = 0, async = 'always', raw = 0 } = {}) {
    const id = im.dataset.sprite;
    if (!sprites[id] || !(k >= 0.01) || !isFinite(k)) return;
    const kb = +im.dataset.k || 0;
    if (kb >= k / 1.01 && kb <= k * slack) return; // what it shows will do
    let e = cache.get(keyOf(id, k)) || cachedBetween(id, k, k * slack);
    if (!e && bucket) note(id, raw || k, bucket, im);
    const kk = e ? e.k : bucket ? bucketUp(k, bucket) : nearK(id, round3(k));
    const key = keyOf(id, kk);
    if (im._atWant === key && jobs.has(key)) return; // already on its way (SVG meanwhile)
    if (!e) e = cache.get(key);
    // not painted ahead: the SVG is shown (or it is painted on the spot) during play
    if (!e) missed(id, kk, key, bucket === 8 ? 'tween' : bucket ? 'step' : 'exact');
    const cheap = estimate(id, kk) <= SYNC_MS, input = inInput();
    if (!e && !failed.has(key) && !jobs.has(key) && cheap && svgReady.has(id) && !input && !stored(id, kk)) {
      e = bake(id, kk, svgReady.get(id));
      if (e) { st.syncJobs++; store(e); }
    }
    im._atWant = key;
    if (e && e.pre && e.pre.complete) { st.hits++; apply(im, e); return; }
    if (kb) unapply(im); else ensureSvg(im); // SVG until the bitmap is ready
    if (e) {
      busy++;
      predecode(e).then(() => { if (im._atWant === key && byUrl.has(e.url)) apply(im, e); })
        .finally(() => { busy--; checkIdle(); });
    } else if (!failed.has(key) && (async === 'always' || (async === 'input' && cheap && input))) {
      busy++;
      rasterize(id, kk, { im }).then((entry) => {
        if (entry && im._atWant === key && mode === 'bitmap' && im.dataset.sprite === id && byUrl.has(entry.url)) apply(im, entry);
      }).finally(() => { busy--; checkIdle(); });
    }
  }
  // Is anything between im and the stage in the middle of a scale tween (E.tween)?
  function underTween(im) {
    for (let el = im.parentElement; el; el = el.parentElement) if (el._atTween > 0) return true;
    return false;
  }
  // ... or one that has just ended (its exact refit follows: tweenEnd)
  function settling(im) {
    for (let el = im.parentElement; el; el = el.parentElement) if (el._atSettle > 0) return true;
    return false;
  }
  // 2^(ceil(n*log2 k)/n): n=4 for particles (at most 19% above), n=8 for scale tweens (9%),
  // n=32 for scales that change every frame (2.2%)
  const bucketUp = (k, n) => round3(Math.pow(2, Math.ceil(n * Math.log2(k) - 1e-6) / n));

  // ----- sprite log (?spritelog=1, for tools/sprite-manifest.mjs) -----
  // Every bitmap request, relative to the stage: [scene, sprite, scale / (stage scale x
  // devicePixelRatio), steps]: steps 0 for an exact scale, with a fifth column: how many imgs
  // asked for it (several imgs of one sprite at one exact scale is a size the scene uses, even
  // among random ones: the hand-washing foam blobs at rest); 8 (scale tweens) or 32 (scales
  // that change every frame) for a request rounded up to the next 2^(1/steps) step, one row
  // per step; 4 for particles (random sizes), as two rows: the lowest and highest seen.
  const spriteLog = params.get('spritelog') === '1' ? new Map() : null;
  // device pixels per stage unit, from the stage's device matrix: the very arithmetic the sprites' own
  // scales come from (DOMMatrix.scale() takes single-precision floats: at 1194x834, 2 x 0.74625 comes
  // out as 1.49249995, not 1.4925, and the manifest's keys must round the same way as the imgs')
  const unitScale = () => { const E = AT.engine; return E && E.stage ? scaleOf(cumMatrix(E.stage)) : dpr(); };
  // The device scale of a sprite placed at relative scale rel (a manifest row), computed exactly as its
  // img's own comes out of cumMatrix: the stage's scale u (single precision: DOMMatrix.scale()) times
  // the node's scale as its CSS transform parses (single precision: scale(0.6000) is 0.60000002384),
  // multiplied in double precision (DOMMatrix.multiply). So round3 of it is the img's key, below 1 as
  // well: at 1194x834, 0.6 x 1.49249995 is 0.89549997 (key 0.895) but the thought bubbles' potty and
  // bottle come out as 0.89550000 (key 0.896).
  const kRel = (rel, u) => u * Math.fround(rel);
  function note(id, raw, n, im) {
    const sc = spriteLog && AT.sceneName;
    if (!sc || !(raw > 0)) return;
    const rel = raw / unitScale();
    const key = n === 4 ? `${sc}|${id}|4` : n ? `${sc}|${id}|${n}|${bucketUp(raw, n)}` : `${sc}|${id}|0|${rel.toFixed(7)}`;
    let e = spriteLog.get(key);
    if (!e) spriteLog.set(key, (e = [sc, id, rel, n, rel, new Set()]));
    else { e[2] = Math.min(e[2], rel); e[4] = Math.max(e[4], rel); }
    if (im) e[5].add(im);
  }
  const spriteLogRows = () => {
    const out = [];
    for (const [sc, id, lo, n, hi, imgs] of spriteLog ? spriteLog.values() : []) {
      out.push(n ? [sc, id, lo, n] : [sc, id, lo, n, Math.max(1, imgs.size)]);
      if (n === 4 && hi !== lo) out.push([sc, id, hi, n]);
    }
    return out;
  };
  // Particles (E.burst/E.floatUp: data-kmax on the node = the largest scale it reaches)
  // get a bitmap for that scale, in coarse buckets.
  const kmaxOf = (im) => { const par = im.parentElement; return par && par.dataset ? +par.dataset.kmax || 0 : 0; };
  // The device scale an img wants, before rounding: [scale, steps] (steps 4: a particle, whose
  // bitmap is for the next 2^(1/4) step up; 0: exact, rounded to 3 decimals).
  function wantedRaw(im, pass) {
    const kmax = kmaxOf(im);
    if (kmax) {
      const host = im.parentElement.parentElement;
      return [host ? scaleOf(cumMatrix(host, pass)) * kmax : 0, 4];
    }
    // (under a CSS animation: at its peak)
    const M = animated(im, pass) ? peakMatrix(im) : deviceMatrix(im, pass);
    return [M ? scaleOf(M) : 0, 0];
  }
  const kFrom = (raw, n) => (!(raw > 0) ? 0 : n ? bucketUp(raw, n) : round3(raw));
  function kWanted(im, pass) {
    const [raw, n] = wantedRaw(im, pass);
    return kFrom(raw, n);
  }
  function fitOne(im, pass, defer) {
    if (mode !== 'bitmap') return null;
    if (underTween(im)) { ensureSvg(im); return null; } // tweens refit when they end
    const [raw, n] = wantedRaw(im, pass);
    note(im.dataset.sprite, raw, n, im);
    return want(im, kFrom(raw, n), defer);
  }
  // Fit every sprite img under root to its current device scale. Resolves once all are bitmaps
  // (or have stayed SVG). opts.onProgress(fraction) reports painted area (cw*ch) over the total.
  // opts.defer: bitmaps that are not cached yet are painted but not put in (a later fit does
  // that, all at once).
  // opts.scene: also paint every bitmap that scene's manifest lists (prefetchScene), counted in
  // the progress too.
  function fit(root, opts = {}) {
    if (mode !== 'bitmap' || !root || !root.querySelectorAll) return Promise.resolve();
    evict(null); // (a scene change has just let go of the last scene's bitmaps)
    const imgs = root.tagName === 'IMG' ? [root] : [...root.querySelectorAll('img[data-sprite]')];
    const pass = new Map();
    const waits = [];
    let total = 0, done = 0;
    const report = () => { if (opts.onProgress) { try { opts.onProgress(total ? done / total : 1); } catch (e) { /* ignore */ } } };
    const count = (p, px) => { total += px; waits.push(p.then(() => { done += px; report(); })); };
    for (const im of imgs) {
      pendingFit.delete(im);
      const p = fitOne(im, pass, opts.defer);
      if (!p) continue;
      const b = sprites[im.dataset.sprite].box, k = kWanted(im, pass);
      count(p, b[2] * b[3] * k * k);
    }
    if (opts.scene) for (const [p, px] of prefetchScene(opts.scene)) count(p, px);
    report();
    checkIdle();
    return Promise.all(waits).then(() => {});
  }
  // ----- prefetching from the scene manifest (js/sprite-manifest.js, tools/sprite-manifest.mjs) -----
  // The bitmaps a scene asks for while it is played, as [id, k] for this screen: [id, s] is the
  // exact scale s x stage scale x devicePixelRatio, [id, s, n] the 2^(1/n) step at or above it,
  // [id, lo, hi, n] every step from lo to hi (particles); random exact
  // scales ([id, lo, hi, 0]: balloons, soap bubbles) cannot be painted ahead. Steps were recorded
  // at the manifest's unit (1280x720 at 2x): a step there stands for every scale that came out as
  // that step, which on another screen can be either of two steps (one at the manifest's own size).
  const manifestUnit = () => (typeof window !== 'undefined' && window.AT_SPRITES && window.AT_SPRITES.unit) || 1.6;
  // the relative scales (lo, hi] that come out as the same 2^(1/n) step as rel at the manifest's unit
  function stepWindow(rel, n) {
    const ref = manifestUnit(), j = Math.ceil(n * Math.log2(rel * ref) - 1e-6);
    return [(Math.pow(2, (j - 1) / n) / ref) * (1 + 1e-5), Math.pow(2, j / n) / ref];
  }
  // Sprites a scene tweens to random sizes (foam and bubbles popping up while teeth are brushed): more
  // than RANDOM_STEPS distinct 2^(1/8) steps in its list. Painted ahead at the steps seen; on another
  // screen a random size can come out as any step (unpredictable), so their steps stand for no more.
  const RANDOM_STEPS = 4;
  function randomTweens(m) {
    const n = new Map();
    for (const e of m) if (e.length === 3 && e[2] === 8) n.set(e[0], (n.get(e[0]) || 0) + 1);
    return new Set([...n].filter(([, c]) => c > RANDOM_STEPS).map(([id]) => id));
  }
  function sceneList(name) {
    const m = typeof window !== 'undefined' && window.AT_SPRITES && window.AT_SPRITES.scenes[name];
    const out = [], seen = new Set();
    if (!m) return out;
    const u = unitScale(), random = randomTweens(m);
    const add = (id, k) => { const key = keyOf(id, k); if (!seen.has(key)) { seen.add(key); out.push([id, k]); } };
    const every = (id, lo, hi, n) => {
      const j1 = Math.ceil(n * Math.log2(hi * u) - 1e-6);
      for (let j = Math.ceil(n * Math.log2(lo * u) - 1e-6); j <= j1; j++) add(id, round3(Math.pow(2, j / n)));
    };
    for (const e of m) {
      const id = e[0];
      if (!sprites[id]) continue;
      if (e.length === 2) add(id, round3(kRel(e[1], u)));
      else if (e.length === 3 && e[2] === 8 && random.has(id)) add(id, bucketUp(kRel(e[1], u), 8));
      else if (e.length === 3) every(id, stepWindow(e[1], e[2])[0], stepWindow(e[1], e[2])[1], e[2]);
      else if (e[3] > 0) every(id, stepWindow(e[1], e[3])[0], stepWindow(e[2], e[3])[1], e[3]);
    }
    return out;
  }
  // Paint the bitmaps scene `name` will ask for (behind its entry cover: js/game.js AT.go, through
  // fit(..., {scene})), after the ones its imgs need now. Returns [[promise, px]] of those not painted yet.
  let sceneTag = { alive: false };
  function prefetchScene(name) {
    // (again for the same scene: the same requests; another scene: the last one's are dropped)
    if (!(sceneTag.alive && sceneTag.name === name)) {
      sceneTag.alive = false;
      sceneTag = { alive: true, pri: PRI.scene, name };
    }
    const out = [];
    // (not while recording what scenes ask for: tools/sprite-manifest.mjs)
    if (mode !== 'bitmap' || spriteLog) return out;
    for (const [id, k0] of sceneList(name)) {
      if (!(k0 >= 0.01)) continue;
      const k = nearK(id, k0), key = keyOf(id, k);
      if (cache.has(key) || failed.has(key)) continue;
      const job = jobs.get(key);
      if (job && job.by.some((r) => r.tag === sceneTag)) { out.push([job.promise, job.px]); continue; } // (asked for already)
      if (!job) st.prefetched++;
      out.push([rasterize(id, k, { tag: sceneTag }), pxOf({ id, k })]);
    }
    return out;
  }
  // In idle time while scene `name` is played (null: stop), paint bitmaps of the scenes that can
  // follow it (AT_SPRITES.next), one at a time and only while nothing else is being painted, so the
  // next scene's cover is shorter: first the big ones that two or more of those scenes share (from
  // the hub: the bathroom background of potty and teeth, the lounge of tv and party; the heaviest
  // scenes' first), then the small ones (at most IDLE_PX off the main thread: about a tenth of a
  // second on a worker thread; on the main thread at most SYNC_MS, within the idle period). Other
  // big ones (a scene's own background, the mouth close-up) wait for that scene's cover, and no big
  // one is painted on the main thread. Live play only (?manual and recordings wait for idle() at
  // every step, which this would hold up).
  const IDLE_PX = 2.5e5;
  let idleTag = { alive: false };
  const whenIdle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(() => fn(null), 50));
  function idlePrefetch(name) {
    idleTag.alive = false;
    const E = AT.engine;
    if (!name || mode !== 'bitmap' || !E || E.manual || E.recording || params.get('nop2')) return;
    const tag = idleTag = { alive: true, pri: PRI.idle };
    const uses = new Map(), small = [];
    const next = (window.AT_SPRITES && window.AT_SPRITES.next[name]) || [];
    for (const sc of next) {
      const l = sceneList(sc);
      let px = 0;
      for (const [id, k] of l) px += pxOf({ id, k });
      for (const [id, k] of l) {
        const key = keyOf(id, k);
        if (!(k >= 0.01)) continue;
        const u = uses.get(key);
        if (u) { if (!u.sc.has(sc)) { u.sc.add(sc); u.weight += px; } continue; }
        uses.set(key, { id, k, sc: new Set([sc]), weight: px });
        small.push([id, k, key, false]);
      }
    }
    // (weight: the pixels of the scenes using it)
    const shared = [...uses.values()].filter((u) => u.sc.size > 1).sort((a, b) => b.weight - a.weight);
    const list = shared.map((u) => [u.id, u.k, keyOf(u.id, u.k), true]).concat(small);
    const offMain = (id) => asyncOk === true && tuning.async && typeof createImageBitmap === 'function' && offThread(id);
    const step = (deadline) => {
      if (!tag.alive) return;
      while (list.length) {
        const [id, k0, , big] = list[0];
        const k = nearK(id, k0), key = keyOf(id, k);
        const off = offMain(id);
        const isSmall = off ? pxOf({ id, k }) <= IDLE_PX : estimate(id, k) <= SYNC_MS;
        if (cache.has(key) || jobs.has(key) || failed.has(key) || (big ? isSmall || !off : !isSmall)) { list.shift(); continue; }
        // only when nothing else is painting, within the idle period, and well within the memory budget
        if (running || inflight || st.decoded > budget() / 2) break;
        // (off the main thread only its loading and encoding are on it)
        if (!off && deadline && estimate(id, k) > deadline.timeRemaining() && !deadline.didTimeout) break;
        list.shift();
        rasterize(id, k, { tag }).then(() => { if (tag.alive) whenIdle(step); });
        return;
      }
      if (list.length) whenIdle(step);
    };
    whenIdle(step);
  }
  // stats().idleJobs: bitmaps painted that only idle-time prefetch asked for (counted when painted)
  const idleDone = (job) => { if (job.by.length && job.by.every((r) => r.tag && r.tag.pri === PRI.idle)) st.idleJobs++; };
  // Is a scene being played (not loading behind a cover)? Bitmaps painted then are counted (stats().playMisses).
  let playing = false;
  const play = (on) => { playing = !!on; };

  // ----- bitmaps stored across visits (js/raster-cache.js: IndexedDB) -----
  const disk = () => (mode === 'bitmap' && typeof AT !== 'undefined' && AT.rasterCache) || null;
  let diskLoad = null;
  // At boot: the self-checks, the PNG encoder worker and reading the stored bitmaps all start
  // at once, while the first scene is built (painting waits for them).
  function warm() {
    if (mode !== 'bitmap') return;
    selfCheck();
    asyncCheck();
    storeReady();
  }
  // Resolves once the stored bitmaps are known (or there are none): AT.boot starts it, AT.go waits for it.
  function storeReady() {
    if (!diskLoad) diskLoad = disk() ? disk().load().catch(() => false) : Promise.resolve(false);
    return diskLoad;
  }
  // store the bitmaps painted since the last call, when the browser is idle (after a scene has faded in)
  function persist() { const d = disk(); if (d) d.flushSoon(); }
  // once a session: forget stored bitmaps of drawings that have changed (js/raster-cache.js)
  function housekeep() { const d = disk(); if (d) d.housekeep((id) => (sprites[id] ? hashOf(id) : null)); }
  const hashOf = (id) => { const sp = sprites[id]; if (!sp.hash) sp.hash = hashStr(sp.text || (sp.text = svgOf(id))).toString(36); return sp.hash; };

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
  // Every img under the node gets, before the tween's first frame, a bitmap for the
  // largest device scale it reaches (ease: the tween's easing function, whose
  // overshoot counts): a cached one up to 19% bigger, else one painted at the next
  // 2^(1/8) step up (so foam and bubbles that pop up at random sizes share a few
  // bitmaps), on the spot when that is cheap (<= SYNC_MS) and the sprite's SVG is loaded -
  // but never inside an input handler (brushing teeth): then it is painted next, with the
  // SVG shown meanwhile. Otherwise its SVG is shown for the tween (exact; a bitmap arriving
  // mid-tween would be shown scaled far down, e.g. while a card pops open). A bitmap is only ever
  // scaled down while it moves. When the tween ends, tweenEnd() refits the exact scale.
  function tweenStart(node, to, ease) {
    if (mode !== 'bitmap') return;
    node.el._atTween = (node.el._atTween || 0) + 1;
    const imgs = [...node.el.querySelectorAll('img[data-sprite]')];
    // bitmaps still being painted for the old size are not put in
    imgs.forEach((im) => { im._atWant = null; });
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
    const need = imgs.map((im) => wantedRaw(im, pass));
    node.set(cur);
    imgs.forEach((im, i) => showAtLeast(im, round3(kFrom(need[i][0], need[i][1]) * tuning.oversample), { slack: 1.19, bucket: 8, async: 'input', raw: need[i][0] * tuning.oversample }));
  }
  function tweenEnd(node) {
    if (node.el._atTween > 0) node.el._atTween--;
    if (mode !== 'bitmap') return;
    // Exact refit, unless the node is removed as soon as the tween resolves (foam, bubbles).
    // Until then its sprites are left alone by checkScales: the tween's last frame would
    // otherwise ask for the 2^(1/32) step at the end scale (painted on the spot, as an
    // oscillation's: a card's sink at 2.6x blocked the page for over 100 ms) just before
    // the exact one, or for a node about to be removed.
    busy++;
    const el = node.el;
    el._atSettle = (el._atSettle || 0) + 1;
    later(() => later(() => {
      busy--;
      el._atSettle--;
      if (el.isConnected && !(el._atTween > 0)) fit(el); else checkIdle();
    }));
  }

  // ----- scales that change outside tweens -----
  // Node.set reports nodes whose s/sx/sy changed (pulsing buttons, breathing puppets,
  // squashing bugs, glows). Right after the code that changed them, their sprites are
  // checked, and follow the scale both ways through 2^(1/32) steps:
  //   - shown magnified by more than 1%: a cached step at or above the scale if there
  //     is one, else ratchet: paint the step above (at most 2.2% more than needed);
  //     the current bitmap stays until the new one is ready;
  //   - shown more than 3% bigger than needed (an oscillation on its way down): a cached
  //     step if there is one, else paint the step above the current scale for next time
  //     (put in when it is ready if it still fits).
  // So an oscillating sprite soon has a bitmap for every step of its range and swaps
  // between them (a src change), shown at most about 3% above its scale and never below.
  const TRACK = 1.03;
  const dirty = new Set();
  let dirtyQueued = false;
  const now = () => (AT.engine && AT.engine.time) || 0;
  const lastMoved = (im) => (im._atMoved != null ? im._atMoved : -Infinity);
  function scaleChanged(node) {
    if (mode !== 'bitmap') return;
    dirty.add(node.el);
    if (!dirtyQueued) { dirtyQueued = true; later(checkScales); }
  }
  function checkScales() {
    dirtyQueued = false;
    const t = now();
    const pass = new Map();
    for (const el of dirty) {
      if (!el.isConnected) continue;
      const imgs = el.querySelectorAll('img[data-sprite]');
      for (const im of imgs) {
        im._atMoved = t;
        if (held) continue;
        const kb = +im.dataset.k || 0;
        if (!kb) { if (!(im._atWant && jobs.has(im._atWant))) ensureSvg(im); continue; } // SVG is exact (the sweep paints it)
        if (kmaxOf(im) || underTween(im) || settling(im)) continue; // particles and tweens are handled apart
        const M0 = deviceMatrix(im, pass), raw = M0 ? scaleOf(M0) : 0, kd = round3(raw);
        if (!(kd >= 0.01)) continue;
        if (kd > kb * 1.01) { note(im.dataset.sprite, raw, 32, im); if (!useCached(im, kd, pass)) ratchet(im, kd); }
        else if (kb > kd * TRACK) { note(im.dataset.sprite, raw, 32, im); if (!useCached(im, kd, pass)) offer(im, kd); }
        // A lone sprite pulsing in place (the Play button) whose bitmap happens to be at its exact
        // scale right now: on the pixel grid, it is shown exactly as painted (half a pixel off, it
        // would look blurred). Only for uniform scaling of a node holding just this sprite: puppet
        // parts never shift apart, and a breathing (sy only) sprite keeps its place.
        else if (imgs.length === 1 && Math.abs(kd / kb - 1) < 0.002) {
          const M = deviceMatrix(im, pass);
          if (Math.abs(M.a / M.d - 1) < 1e-4) resnapOne(im, pass, M);
        }
      }
    }
    dirty.clear();
    checkIdle();
  }
  // a cached bitmap for display scale kd: the exact one or one of the two 2^(1/32) steps above kd/1.01
  function useCached(im, kd, pass) {
    const id = im.dataset.sprite;
    const n = Math.ceil(32 * Math.log2(kd / 1.01) - 1e-6);
    for (const k of [round3(kd), round3(Math.pow(2, n / 32)), round3(Math.pow(2, (n + 1) / 32))]) {
      const e = k >= kd / 1.01 && k <= kd * TRACK && cache.get(keyOf(id, k));
      if (e && e.pre) {
        im._atWant = e.key;
        if (im.getAttribute('src') !== e.url) { st.hits++; apply(im, e, pass); }
        return true;
      }
    }
    return false;
  }
  function ratchet(im, kd) {
    const kk = bucketUp(kd, 32);
    const key = keyOf(im.dataset.sprite, kk);
    if (im._atWant === key && jobs.has(key)) return;
    want(im, kk, false, true); // (shown magnified until it is painted: painted next, here)
  }
  function offer(im, kd) {
    const id = im.dataset.sprite, kk = bucketUp(kd, 32), key = keyOf(id, kk);
    if (jobs.has(key) || failed.has(key)) return;
    missed(id, kk, key, 'step');
    busy++;
    rasterize(id, kk, { im, prefetch: true, urgent: true }).then((e) => { // (the oscillation will need it in a few frames)
      if (!e || mode !== 'bitmap' || held || !im.isConnected || im.dataset.sprite !== id || underTween(im) || !byUrl.has(e.url)) return;
      const kdNow = kOf(im), kbNow = +im.dataset.k || 0;
      if (kbNow && e.k >= kdNow / 1.01 && (kbNow < kdNow / 1.01 || kbNow > kdNow * TRACK)) { im._atWant = key; apply(im, e); }
    }).finally(() => { busy--; checkIdle(); });
  }

  // ----- pixel grid: sprites at rest start on a whole device pixel -----
  // How far (in device px) an axis-aligned bitmap's first pixel is off the device grid.
  function gridOffset(im, M) {
    if (!tuning.snap || tuning.boxSize || !M || !axisAligned(M)) return 0; // rotated or skewed: resampled anyway
    const F = M.multiply(new DOMMatrix(im.style.transform || 'none'));
    return Math.max(Math.abs(F.e - Math.round(F.e)), Math.abs(F.f - Math.round(F.f)));
  }
  // Re-snap one img (only its transform changes) when it has come to rest off the grid.
  function resnapOne(im, pass, M) {
    if (tuning.resnap === false || kmaxOf(im) || underTween(im) || animated(im, pass) || gridOffset(im, M) <= 0.01) return false;
    const e = byUrl.get(im.getAttribute('src'));
    if (!e) return false;
    apply(im, e, pass);
    st.resnaps++;
    return true;
  }
  // A move has ended (a camera pan, a Node's x/y tween, a camera jump): re-snap the
  // bitmaps under el right after the code that moved it.
  const snapDirty = new Set();
  let snapQueued = false;
  function resnapSoon(el) {
    if (mode !== 'bitmap' || !el) return;
    snapDirty.add(el);
    if (!snapQueued) {
      snapQueued = true;
      later(() => {
        snapQueued = false;
        const pass = new Map();
        for (const root of snapDirty) {
          if (!root.isConnected || !root.querySelectorAll) continue;
          for (const im of root.querySelectorAll('img[data-k]')) resnapOne(im, pass, deviceMatrix(im, pass));
        }
        snapDirty.clear();
        checkIdle();
      });
    }
  }

  // ----- sweep: once per second of game clock (engine tick) -----
  // Everything on the stage: no bitmap yet -> paint one; magnified (by anything) ->
  // ratchet; at rest -> settle on the exact scale. At rest means the scale has not
  // changed for a second of game clock: no Node.set scale change in its chain
  // (checkScales) and the same k as at the previous sweep. Sprites under a CSS
  // animation get the bitmap for its peak. A sprite whose device position is the same
  // as at the previous sweep is re-snapped to the pixel grid if it is off it (only its
  // transform changes; moving sprites are left alone, so they do not jitter).
  const near = (a, b) => Math.abs(a / b - 1) <= 0.001;
  const sameAt = (o, M) => !!o && Math.abs(o[0] - M.e) < 1e-4 && Math.abs(o[1] - M.f) < 1e-4;
  const REST = 1; // seconds of game clock
  function sweep(root) {
    if (mode !== 'bitmap' || held || !root || !root.querySelectorAll) return;
    const pass = new Map();
    const t = now();
    for (const im of root.querySelectorAll('img[data-sprite]')) {
      // particles and tweens are handled elsewhere; so is a tween that has just ended (its exact refit
      // follows, unless another tween starts at once: a thought bubble bumping up, then shrinking away)
      if (kmaxOf(im) || underTween(im) || settling(im) || !im.isConnected) { im._atO = null; continue; }
      const M = deviceMatrix(im, pass);
      if (!M) continue;
      const still = sameAt(im._atO, M);
      im._atO = [M.e, M.f];
      im._atStill = still;
      const anim = animated(im, pass);
      const raw = anim ? scaleOf(peakMatrix(im)) : scaleOf(M);
      const kd = round3(raw);
      const prev = im._atK;
      im._atK = kd;
      if (!(kd >= 0.01)) continue;
      const id = im.dataset.sprite;
      const kb = +im.dataset.k || 0;
      const pending = im._atWant && jobs.has(im._atWant);
      if (anim) {
        // a CSS animation (.hudbtn.pulse): the bitmap for its peak, SVG until that is ready
        im._atMoved = t;
        note(id, raw, 0, im);
        showAtLeast(im, kd);
      } else if (!kb) {
        note(id, raw, 0, im);
        if (!pending && !failed.has(keyOf(id, kd))) want(im, kd);
      } else if (kd > kb * 1.01) {
        note(id, raw, 32, im);
        if (!useCached(im, kd, pass)) ratchet(im, kd);
      } else if (!near(kb, kd) && prev && near(prev, kd) && !(t - lastMoved(im) < REST) && !invisible(im)) {
        // (a sprite nobody can see - opacity 0, display none - is settled once it is shown)
        note(id, raw, 0, im);
        if (!(pending && im._atWant === keyOf(id, kd))) want(im, kd);
      } else if (still) resnapOne(im, pass, M);
    }
    if (debug) {
      const bad = audit(root);
      if (bad.length) console.warn('[AT.art] sprite bitmaps off scale:', JSON.stringify(bad));
    }
  }

  // ----- resizes -----
  // Called synchronously when the stage scale or devicePixelRatio has just changed, before
  // the debounced refit (js/game.js): no bitmap may be shown magnified meanwhile. Each img
  // gets the cached bitmap for its new scale if there is one; one that would now be shown
  // magnified otherwise goes back to its SVG (exact) until the refit paints its bitmap.
  // Requests for the old scale are dropped, and sweeps and ratchets hold off until
  // hold(false) (they would paint in-between scales that the refit then paints again).
  // Returns how many imgs went back to SVG.
  function resized(root) {
    if (mode !== 'bitmap' || !root || !root.querySelectorAll) return 0;
    held = true;
    const pass = new Map();
    let svg = 0;
    for (const im of root.querySelectorAll('img[data-sprite]')) {
      im._atWant = null;
      im._atO = null;
      const kb = +im.dataset.k || 0;
      if (!kb) continue;
      const kw = kWanted(im, pass);
      const e = !underTween(im) && kw >= 0.01 && cache.get(keyOf(im.dataset.sprite, nearK(im.dataset.sprite, kw)));
      if (e) { im._atWant = e.key; apply(im, e, pass); continue; }
      const kd = animated(im, pass) ? kPeak(im) : kOf(im, pass);
      if (kb < kd / 1.01) { unapply(im); svg++; }
    }
    checkIdle();
    return svg;
  }
  const hold = (on) => { held = !!on; };
  // Bitmaps under root that are not at the exact scale (e.g. bigger ones left from before a
  // resize) go back to SVG: for a still frame, where SVG is exact and costs one raster.
  function inexactToSvg(root) {
    if (mode !== 'bitmap' || !root) return;
    const pass = new Map();
    for (const im of root.querySelectorAll('img[data-k]')) {
      if (underTween(im) || kmaxOf(im)) continue;
      if (!near(+im.dataset.k, kWanted(im, pass))) unapply(im);
    }
  }

  // hidden by an inline display:none or opacity 0 on the way up (cheap: no computed styles)
  function invisible(im) {
    for (let el = im; el && el !== document.body; el = el.parentElement) {
      const s = el.style;
      if (s.display === 'none' || (s.opacity !== '' && +s.opacity === 0)) return true;
    }
    return false;
  }
  // ----- audit: visible sprites that break the invariant -----
  // Visible: no display:none or opacity 0 on the way to the root, not under a
  // running scale tween, and on screen. Returns [{id, kDisplay, kBitmap, offGrid?}].
  function shownNow(im) {
    for (let el = im; el && el !== document.body; el = el.parentElement) {
      const s = el.style;
      if (s.display === 'none' || s.visibility === 'hidden' || (s.opacity !== '' && +s.opacity === 0) || el._atTween > 0) return false;
    }
    return true;
  }
  function audit(root) {
    root = root || (AT.engine && AT.engine.stage);
    if (mode !== 'bitmap' || !root || !root.querySelectorAll) return [];
    const out = [];
    const pass = new Map();
    const vw = window.innerWidth * dpr(), vh = window.innerHeight * dpr();
    for (const im of root.querySelectorAll('img[data-k]')) {
      if (!shownNow(im)) continue;
      const M = deviceMatrix(im, pass);
      if (!M) continue;
      const b = sprites[im.dataset.sprite].box;
      const pts = [[0, 0], [b[2], 0], [0, b[3]], [b[2], b[3]]].map(([x, y]) => M.transformPoint(new DOMPoint(x, y)));
      if (Math.max(...pts.map((p) => p.x)) <= 0 || Math.min(...pts.map((p) => p.x)) >= vw || Math.max(...pts.map((p) => p.y)) <= 0 || Math.min(...pts.map((p) => p.y)) >= vh) continue;
      const kd = round3(scaleOf(M)), kb = +im.dataset.k;
      if (!(kd >= 0.01)) continue;
      // at rest for two seconds (so a sweep has seen it at rest for one): must be exact.
      // Moving (particles; CSS animation; scale changed lately or since the last sweep): only never magnified.
      const moving = kmaxOf(im) || animated(im, pass) || now() - lastMoved(im) < 2 * REST + 1e-6 || (im._atK && !near(im._atK, kd));
      // in the same place at the last two sweeps and now (so a sweep has re-snapped it): on the pixel grid
      const off = !moving && near(kb, kd) && im._atStill && sameAt(im._atO, M) ? gridOffset(im, M) : 0;
      if (kb < kd / 1.01 || (!moving && !near(kb, kd)) || off > 0.01) {
        out.push(off > 0.01 ? { id: im.dataset.sprite, kDisplay: kd, kBitmap: kb, offGrid: round3(off) } : { id: im.dataset.sprite, kDisplay: kd, kBitmap: kb });
      }
    }
    return out;
  }
  // Are bitmaps for the current scale of every sprite under root already painted?
  function ready(root) {
    if (mode !== 'bitmap' || !root) return true;
    const pass = new Map();
    for (const im of root.querySelectorAll('img[data-sprite]')) {
      if (underTween(im)) continue;
      const k0 = round3(kWanted(im, pass));
      if (!(k0 >= 0.01)) continue;
      const k = nearK(im.dataset.sprite, k0), key = keyOf(im.dataset.sprite, k);
      if (!cache.has(key) && !failed.has(key) && !stored(im.dataset.sprite, k)) return false;
    }
    return true;
  }
  // Estimated ms to paint the bitmaps still missing under root (from the jobs so far).
  function cost(root) {
    if (mode !== 'bitmap' || !root) return 0;
    const pass = new Map(), seen = new Set();
    let ms = 0;
    for (const im of root.querySelectorAll('img[data-sprite]')) {
      if (underTween(im)) continue;
      const k0 = round3(kWanted(im, pass));
      if (!(k0 >= 0.01)) continue;
      const k = nearK(im.dataset.sprite, k0), key = keyOf(im.dataset.sprite, k);
      if (seen.has(key) || cache.has(key) || failed.has(key)) continue;
      seen.add(key);
      ms += estimate(im.dataset.sprite, k);
    }
    return ms;
  }
  // idle() also waits for p (e.g. a pending resize refit)
  function track(p) {
    busy++;
    Promise.resolve(p).catch(() => {}).then(() => { busy--; checkIdle(); });
  }

  // a CSS animation has started (.hudbtn.pulse): its sprites get the bitmap for its peak now
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('animationstart', (ev) => {
      const el = ev.target;
      if (mode !== 'bitmap' || held || !el || !el.querySelectorAll || !el.isConnected) return;
      for (const im of el.querySelectorAll('img[data-sprite]')) {
        const M = peakMatrix(im);
        note(im.dataset.sprite, M ? scaleOf(M) : 0, 0, im);
        showAtLeast(im, kPeak(im));
      }
      checkIdle();
    }, true);
  }

  // the sprite an img currently displays (from its src: SVG or bitmap), or null
  function shows(im) {
    const src = im.getAttribute('src');
    const e = byUrl.get(src);
    if (e) return e.id;
    const id = im.dataset.sprite;
    return sprites[id] && sprites[id].url === src ? id : null;
  }
  // stats(); inUseDecoded = decoded bytes of the cached bitmaps that connected imgs show
  function stats() {
    let inUse = 0;
    if (typeof document !== 'undefined' && document.images) {
      const seen = new Set();
      for (const im of document.images) { const e = byUrl.get(im.getAttribute('src')); if (e && !seen.has(e)) { seen.add(e); inUse += e.decoded; } }
    }
    return { ...st, ms: Math.round(st.ms), cached: cache.size, budget: budget(), inUseDecoded: inUse, mode };
  }
  // the scales sprite id is cached at, and every cached bitmap's key (tests)
  const cachedScales = (id) => [...(byId.get(id) || [])].map((e) => e.k).sort((a, b) => a - b);
  const cachedKeys = () => [...cache.keys()];

  return {
    define, img, url, svgOf, box, has, list,
    get mode() { return mode; },
    fit, idle, stats, cachedScales, cachedKeys, setSprite, shows, kOf, kPeak, deviceMatrix, rasterize, estimate, tweenStart, tweenEnd, spriteLog: spriteLogRows,
    sceneList, prefetchScene, idlePrefetch, play, warm, storeReady, persist, housekeep, showSvg, whenPainting, holdDecodes, lanes,
    sweep, audit, ready, cost, track, scaleChanged, resnapSoon, resized, hold, inexactToSvg,
    C, E, R, smooth, blob, fluff, puffs, star, heart, line, rng, group,
    mix, inkOf, shade, tint, SEPIA,
  };
})();
