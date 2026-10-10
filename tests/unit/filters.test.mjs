// Filters that WebKit (Safari, iPad, iPhone, the Claude app on iOS) can draw.
//
// WebKit draws nothing at all for an element whose filter region is too big: not a
// blurrier result, nothing. Measured in WebKitGTK 2.52 (MiniBrowser through WebKitWebDriver,
// tests/helpers/webkit.mjs; a stroke with the ink filter): a userSpaceOnUse region of 4090x4090 user units draws and 4100x4100 draws
// nothing; so do 6000x2790 (draws) and 6000x2800 (nothing), 3000x5590 and 3000x5600,
// 16000x1040 draws: the limit is the region's AREA, 4096 x 4096 = 16,777,216 px, which is
// WebCore's ImageBuffer MaxClampedArea (Source/WebCore/platform/graphics/ImageBuffer.cpp),
// the size WebKit's filter code clamps its intermediate buffers to. Drawn into a canvas
// (the bitmap layer's bake) the limit held in user units whatever the canvas scale; shown
// in an <img> (?raster=svg, or a sprite too big for a bitmap) it held in CSS pixels: a
// sprite displayed at 3x lost its ink at a ninth of the area, at devicePixelRatio 1 and 2
// alike. The checks below count in device pixels at the largest scale a sprite is shown
// at on the biggest iPad, which covers all of those.
//
// The ink filters (k, ks, ke) used to have a fixed 5000x5000 region, 25M px: in WebKit
// every pencil outline, brow, line mouth and line eye was missing (Chromium clips the
// region, so it looked fine there). Now their region is the sprite's viewBox plus a pad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/load-game.mjs';
import { SCALED, BABY_SCALE } from '../visual/gallery-layout.mjs';

const game = loadGame();
const A = game.AT.art;
const ids = [...A.list()];

const WEBKIT_MAX_FILTER_AREA = 4096 * 4096;
// The largest stage scale x devicePixelRatio on a WebKit touch device: a 13-inch iPad Pro
// in landscape (1376x1032 CSS px at 2x) shows the 1600x900 stage at 0.86, i.e. 1.72 device
// pixels per stage pixel (an iPhone Pro Max: 0.48 x 3 = 1.43). Rounded up.
const MAX_STAGE_DPR = 1.8;

// ---------- a little SVG parser: element tree with attributes ----------
function parse(svg) {
  const root = { name: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(svg))) {
    const [, close, name, attrText, self] = m;
    if (close) { cur = cur.parent; continue; }
    const attrs = {};
    for (const a of attrText.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const el = { name, attrs, children: [], parent: cur };
    cur.children.push(el);
    if (!self) cur = el;
  }
  return root.children[0];
}
const walk = (el, fn) => { fn(el); el.children.forEach((c) => walk(c, fn)); };

// ---------- 2D affine matrices [a b c d e f] ----------
const I = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function parseTransform(s) {
  let m = I;
  for (const [, fn, argText] of (s || '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = argText.trim().split(/[\s,]+/).map(Number);
    let t;
    if (fn === 'translate') t = [1, 0, 0, 1, v[0], v[1] || 0];
    else if (fn === 'scale') t = [v[0], 0, 0, v.length > 1 ? v[1] : v[0], 0, 0];
    else if (fn === 'rotate') {
      const r = (v[0] * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
      t = [c, sn, -sn, c, 0, 0];
      if (v.length === 3) t = mul(mul([1, 0, 0, 1, v[1], v[2]], t), [1, 0, 0, 1, -v[1], -v[2]]);
    } else if (fn === 'matrix') t = v;
    else throw new Error('unknown transform ' + fn);
    m = mul(m, t);
  }
  return m;
}
const ctmOf = (el) => { const chain = []; for (let e = el; e && e.name !== 'svg'; e = e.parent) chain.unshift(e); return chain.reduce((m, e) => mul(m, parseTransform(e.attrs.transform)), I); };

// ---------- path bounding box (a superset: control points and arc radii included) ----------
function pathBox(d) {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0;
  const pts = [];
  const num = () => +toks[i++];
  const add = (px, py, r = 0) => { pts.push([px - r, py - r], [px + r, py + r]); };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') { x = sx; y = sy; continue; }
    if (C === 'M' || C === 'L' || C === 'T') { x = ox + num(); y = oy + num(); if (C === 'M') { sx = x; sy = y; cmd = rel ? 'l' : 'L'; } add(x, y); }
    else if (C === 'H') { x = ox + num(); add(x, y); }
    else if (C === 'V') { y = oy + num(); add(x, y); }
    else if (C === 'C') { for (let k = 0; k < 3; k++) { const px = ox + num(), py = oy + num(); add(px, py); if (k === 2) { x = px; y = py; } } }
    else if (C === 'Q' || C === 'S') { for (let k = 0; k < 2; k++) { const px = ox + num(), py = oy + num(); add(px, py); if (k === 1) { x = px; y = py; } } }
    else if (C === 'A') {
      const rx = num(), ry = num(), phi = num(), fa = num(), fs = num();
      const nx = ox + num(), ny = oy + num();
      for (const p of arcPoints(x, y, rx, ry, phi, fa, fs, nx, ny)) add(p[0], p[1], 0.5);
      x = nx; y = ny;
    } else throw new Error(`path command ${cmd} in ${d.slice(0, 60)}`);
  }
  return boxOfPoints(pts);
}
// Points along an SVG arc (endpoint parameters -> centre parameters, SVG 1.1 F.6.5),
// close enough that each sample padded by half a unit covers the arc.
function arcPoints(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return [[x1, y1], [x2, y2]];
  const c = Math.cos((phi * Math.PI) / 180), s = Math.sin((phi * Math.PI) / 180);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = c * dx + s * dy, yp = -s * dx + c * dy;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const co = Math.sqrt(Math.max(0, num / (rx * rx * yp * yp + ry * ry * xp * xp))) * (fa === fs ? -1 : 1);
  const cxp = (co * rx * yp) / ry, cyp = (-co * ry * xp) / rx;
  const cx = c * cxp - s * cyp + (x1 + x2) / 2, cy = s * cxp + c * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(8, Math.ceil(Math.abs(dt) * Math.max(rx, ry))); // samples at most a unit of arc apart
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = t1 + (dt * i) / n;
    pts.push([cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, cy + rx * Math.cos(t) * s + ry * Math.sin(t) * c]);
  }
  return pts;
}
const boxOfPoints = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
};
const corners = ([x, y, w, h]) => [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
// an element's bounding box in its own user space (null: can't tell, e.g. text)
function bboxOf(el) {
  if (el.name === 'path') {
    const b = pathBox(el.attrs.d);
    const sw = el.attrs.stroke && el.attrs.stroke !== 'none' ? +(el.attrs['stroke-width'] || 1) / 2 : 0;
    return [b[0] - sw, b[1] - sw, b[2] + 2 * sw, b[3] + 2 * sw];
  }
  if (el.name === 'g') {
    const pts = [];
    for (const c of el.children) {
      const b = bboxOf(c);
      if (!b) return null;
      pts.push(...corners(b).map((p) => apply(parseTransform(c.attrs.transform), p)));
    }
    return pts.length ? boxOfPoints(pts) : null;
  }
  return null;
}
// the filter region in the element's user space, per the SVG rules (defaults -10% / 120%)
function filterRegion(filter, el, viewBox) {
  const a = filter.attrs;
  if (a.filterUnits === 'userSpaceOnUse') return [+a.x, +a.y, +a.width, +a.height];
  const pct = (v, dflt) => (v == null ? dflt : v.endsWith('%') ? parseFloat(v) / 100 : +v);
  const b = bboxOf(el) || viewBox;
  return [b[0] + pct(a.x, -0.1) * b[2], b[1] + pct(a.y, -0.1) * b[3], pct(a.width, 1.2) * b[2], pct(a.height, 1.2) * b[3]];
}

// The largest scale each sprite is shown at (x the stage scale): the scenes' generated
// sprite manifest (a step stands for scales up to a 2^(1/n) step above it), and the
// gallery's list of the largest in-game scales.
function maxScales() {
  const max = {};
  const up = (id, s) => { max[id] = Math.max(max[id] || 1, s); };
  for (const list of Object.values(game.AT_SPRITES.scenes)) {
    for (const r of list) {
      if (r.length === 2) up(r[0], r[1]);
      else if (r.length === 3) up(r[0], r[1] * 2 ** (1 / r[2]));
      else up(r[0], r[3] ? r[2] * 2 ** (1 / r[3]) : r[2]);
    }
  }
  for (const [id, s] of SCALED) up(id, s);
  for (const id of ids) if (id.startsWith('bb_')) up(id, BABY_SCALE);
  return max;
}

const sprites = ids.map((id) => {
  const svg = parse(A.svgOf(id));
  const viewBox = svg.attrs.viewBox.split(' ').map(Number);
  const filters = {};
  const uses = [];
  walk(svg, (el) => {
    if (el.name === 'filter') filters[el.attrs.id] = el;
    const f = /^url\(#([\w-]+)\)$/.exec(el.attrs.filter || '');
    if (f) uses.push({ el, id: f[1] });
  });
  return { id, svg, viewBox, filters, uses };
});

test('the art engine exposes the ink filter pad', () => {
  assert.equal(typeof A.inkPad, 'number');
  assert.ok(A.inkPad >= 8 && A.inkPad <= 64, `inkPad ${A.inkPad}`);
});

const inv = (m) => {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
};
const isIdentity = (m) => m.every((v, i) => Math.abs(v - I[i]) < 1e-12);
// a box seen from an element's user space: the bounding box of its corners under inv(ctm)
const boxIn = (ctm, b) => boxOfPoints(corners(b).map((p) => apply(inv(ctm), p)));
const within = (r, b, slack = 1e-9) => r[0] >= b[0] - slack && r[1] >= b[1] - slack && r[0] + r[2] <= b[0] + b[2] + slack && r[1] + r[3] <= b[1] + b[3] + slack;

test('every ink (userSpaceOnUse) filter region is the sprite viewBox plus the ink pad, in the user space it is used in', () => {
  const pad = A.inkPad;
  const bad = [];
  let n = 0, transformed = 0;
  for (const { id, viewBox, filters, uses } of sprites) {
    const padded = [viewBox[0] - pad, viewBox[1] - pad, viewBox[2] + 2 * pad, viewBox[3] + 2 * pad];
    const ctmOfFilter = {};
    for (const { el, id: fid } of uses) {
      const f = filters[fid];
      assert.ok(f, `${id}: filter #${fid} is not defined`);
      if (f.attrs.filterUnits !== 'userSpaceOnUse') continue;
      n++;
      const r = ['x', 'y', 'width', 'height'].map((k) => +f.attrs[k]);
      const ctm = ctmOf(el);
      if (!isIdentity(ctm)) transformed++;
      // one region serves one user space: a filter shared by a transformed and a plain stroke would be wrong for one of them
      const key = ctm.map((v) => v.toFixed(9)).join(' ');
      if (ctmOfFilter[fid] && ctmOfFilter[fid] !== key) bad.push(`${id}: #${fid} is used in two different user spaces`);
      ctmOfFilter[fid] = key;
      // at most the padded viewBox (rounded out to whole units where a transform tilts it)...
      if (!within(r, boxIn(ctm, padded), isIdentity(ctm) ? 1e-9 : 1)) bad.push(`${id}: #${fid} on <${el.name}${el.attrs.transform ? ' transform="' + el.attrs.transform + '"' : ''}>: region ${r.join(' ')} is more than the padded viewBox`);
      // ...and all of what is visible of the stroke, so no line is cut off
      if (!within(boxIn(ctm, viewBox), r)) bad.push(`${id}: #${fid}: region ${r.join(' ')} does not cover the viewBox`);
      // never outside the old 5000x5000 region either (-2000..3000): Chromium always clipped to it,
      // and its pixels stay bit-identical (bg_bathroom's floor lines run past x 3000)
      if (!within(r, [-2000, -2000, 5000, 5000])) bad.push(`${id}: #${fid}: region ${r.join(' ')} leaves -2000..3000`);
    }
  }
  assert.ok(n > ids.length, `${n} ink-filtered elements`);
  assert.deepEqual(bad, []);
  // the transformed strokes (mirrored leg, teddy's tilted arms) were found, with filters of their own
  assert.ok(transformed >= 3, `${transformed} transformed ink strokes`);
});

test(`no filter region is over WebKit's ${WEBKIT_MAX_FILTER_AREA} px at the largest scale a sprite is shown`, (t) => {
  const max = maxScales();
  const bad = [];
  let worst = { r: 0 };
  for (const { id, viewBox, filters, uses } of sprites) {
    const k = (max[id] || 1) * MAX_STAGE_DPR;
    for (const { el, id: fid } of uses) {
      const [, , w, h] = filterRegion(filters[fid], el, viewBox);
      const m = ctmOf(el);
      const area = w * h * Math.abs(m[0] * m[3] - m[1] * m[2]) * k * k;
      const r = area / WEBKIT_MAX_FILTER_AREA;
      if (r > worst.r) worst = { r, what: `${id} #${fid} on <${el.name}> at ${k.toFixed(2)}x` };
      if (r > 1) bad.push(`${id}: #${fid} on <${el.name}>: ${Math.round(w)}x${Math.round(h)} at ${k.toFixed(2)}x = ${(area / 1e6).toFixed(1)}M px`);
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(worst.r > 0.05, 'the check measured something');
  t.diagnostic(`largest filter region: ${(worst.r * 100).toFixed(0)}% of WebKit's limit (${worst.what})`);
});

test('the old 5000x5000 ink region would fail the WebKit check (the check bites)', () => {
  const f = { attrs: { filterUnits: 'userSpaceOnUse', x: '-2000', y: '-2000', width: '5000', height: '5000' } };
  const [, , w, h] = filterRegion(f, null, [0, 0, 1, 1]);
  assert.ok(w * h > WEBKIT_MAX_FILTER_AREA);
});

test('path bounding boxes (used for objectBoundingBox filter regions) are supersets', () => {
  assert.deepEqual(pathBox('M0 0L10 0 10 5Z'), [0, 0, 10, 5]);
  assert.deepEqual(pathBox('M5 5h10v10h-10z'), [5, 5, 10, 10]);
  const [x, y, w, h] = pathBox('M0 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0');
  assert.ok(x <= 0 && y <= -10 && x + w >= 20 && y + h >= 10, `circle ${[x, y, w, h]}`);
  assert.ok(x >= -1 && y >= -11 && x + w <= 21 && y + h <= 11, `circle ${[x, y, w, h]} (tight)`);
  const e = pathBox(A.svgOf('playmat').match(/<path d="([^"]+)"/)[1]); // E(0, 0, 380, 80)
  assert.ok(e[0] <= -380 && e[0] >= -381 && e[1] <= -80 && e[1] >= -81 && e[2] <= 762, `ellipse ${e}`);
  assert.deepEqual(parseTransform('scale(-1 1)'), [-1, 0, 0, 1, 0, 0]);
  const p = apply(parseTransform('rotate(90 10 0)'), [20, 0]);
  assert.ok(Math.abs(p[0] - 10) < 1e-9 && Math.abs(p[1] - 10) < 1e-9);
});
