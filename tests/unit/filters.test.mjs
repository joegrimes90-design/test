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
// region, so it looked fine there). Then their region was the sprite's viewBox plus a pad, for
// every line: WebKit drew them, but allocates every filter step's buffer at the full region,
// so a background's dozen lines made it three times slower to paint and the page ran out of
// memory after a few scenes. Now each line's region is its own box plus the filter's reach.
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
function pathBox(d, fullArcs) {
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
      for (const p of arcPoints(x, y, rx, ry, phi, fa, fs, nx, ny, fullArcs)) add(p[0], p[1], 0.5);
      x = nx; y = ny;
    } else throw new Error(`path command ${cmd} in ${d.slice(0, 60)}`);
  }
  return boxOfPoints(pts);
}
// Points along an SVG arc (endpoint parameters -> centre parameters, SVG 1.1 F.6.5),
// close enough that each sample padded by half a unit covers the arc.
// (full: the whole ellipse, a superset of the arc)
function arcPoints(x1, y1, rx, ry, phi, fa, fs, x2, y2, full) {
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
  if (full) dt = 2 * Math.PI;
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
// (fullArcs: arcs count as their whole ellipse)
function bboxOf(el, fullArcs) {
  if (el.name === 'path') {
    const b = pathBox(el.attrs.d, fullArcs);
    const sw = el.attrs.stroke && el.attrs.stroke !== 'none' ? +(el.attrs['stroke-width'] || 1) / 2 : 0;
    return [b[0] - sw, b[1] - sw, b[2] + 2 * sw, b[3] + 2 * sw];
  }
  if (el.name === 'g') {
    const pts = [];
    for (const c of el.children) {
      const b = bboxOf(c, fullArcs);
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

// How far an ink filter reaches from its line (wobble, grain, blur: the INK table in js/art-core.js):
// the displacement moves a pixel by up to half its scale, and three blur radii hold all but a trace.
const INK = { k: [4, 2.2, 0.35], ks: [1.6, 1.6, 0.25], ke: [1.4, 0.4, 0.3] };
const OLD = [-2000, -2000, 5000, 5000];
const intersect = (a, b) => {
  const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]), x1 = Math.min(a[0] + a[2], b[0] + b[2]), y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
};
const grow = (b, p) => [b[0] - p, b[1] - p, b[2] + 2 * p, b[3] + 2 * p];

test('every ink (userSpaceOnUse) filter region is its own line\'s box plus the filter\'s reach, in the user space it is drawn in', () => {
  const bad = [];
  let n = 0, transformed = 0, inkArea = 0, spriteWide = 0;
  for (const { id, viewBox, filters, uses } of sprites) {
    const ctmOfFilter = {};
    for (const { el, id: fid } of uses) {
      const f = filters[fid];
      assert.ok(f, `${id}: filter #${fid} is not defined`);
      if (f.attrs.filterUnits !== 'userSpaceOnUse') continue;
      n++;
      const r = ['x', 'y', 'width', 'height'].map((k) => +f.attrs[k]);
      inkArea += r[2] * r[3];
      const ctm = ctmOf(el);
      if (!isIdentity(ctm)) transformed++;
      // one region serves one user space: a filter shared by a transformed and a plain stroke would be wrong for one of them
      const key = ctm.map((v) => v.toFixed(9)).join(' ');
      if (ctmOfFilter[fid] && ctmOfFilter[fid] !== key) bad.push(`${id}: #${fid} is used in two different user spaces`);
      ctmOfFilter[fid] = key;
      const what = `${id}: #${fid} on <${el.name}${el.attrs.transform ? ' transform="' + el.attrs.transform + '"' : ''}>`;
      // never outside the old 5000x5000 region (-2000..3000): Chromium always clipped to it, and
      // its pixels stay bit-identical (bg_bathroom's floor lines run past x 3000)
      if (!within(r, OLD)) bad.push(`${what}: region ${r.join(' ')} leaves -2000..3000`);
      if (el.name !== 'path') { spriteWide++; continue; } // (the block letters' <text>: the sprite's padded viewBox, from defs)
      const [wob, , blur] = INK[fid.replace(/_.*/, '')];
      const box = bboxOf(el); // the stroke's outline, its width included (arcs sampled)
      // all of what the filter can draw of the line, so no line is cut off (or the old edge)...
      const need = intersect(grow(box, wob / 2 + 3 * blur), OLD);
      if (need[2] && need[3] && !within(need, r)) bad.push(`${what}: region ${r.join(' ')} cuts off the line (${need.map(Math.round).join(' ')})`);
      // ...and not much more: WebKit allocates the whole region for every filter step of every line
      const most = grow(bboxOf(el, true), wob + 3 * blur + 5);
      if (!within(r, most)) bad.push(`${what}: region ${r.join(' ')} is more than the line's box plus its reach (${most.map(Math.round).join(' ')})`);
    }
  }
  assert.ok(n > ids.length, `${n} ink-filtered elements`);
  assert.deepEqual(bad, []);
  // the transformed strokes (mirrored leg, teddy's tilted arms) were found, each with a filter for its own user space
  assert.ok(transformed >= 3, `${transformed} transformed ink strokes`);
  assert.ok(spriteWide <= 30, `${spriteWide} ink elements with a sprite-wide region`);
});

test('the ink filters of the biggest sprites cost a fraction of what whole-sprite regions did', (t) => {
  // With the sprite's viewBox as every line's region, a background's lines added up to 11-21M
  // filter px (14 lines x 1648 x 948), each allocated per filter step: WebKit painted it three
  // times slower and the page ran out of memory after a few scenes.
  const rows = [];
  for (const { id, viewBox, filters, uses } of sprites) {
    let area = 0;
    for (const { id: fid } of uses) { const f = filters[fid]; if (f.attrs.filterUnits === 'userSpaceOnUse') area += +f.attrs.width * +f.attrs.height; }
    rows.push({ id, area, ratio: area / (viewBox[2] * viewBox[3]) });
  }
  rows.sort((a, b) => b.area - a.area);
  t.diagnostic(`largest total ink filter area: ${rows.slice(0, 5).map((r) => `${r.id} ${(r.area / 1e6).toFixed(2)}M (${r.ratio.toFixed(2)}x its box)`).join(', ')}`);
  for (const r of rows) {
    if (r.id.startsWith('bg_') || r.area > 1e6) assert.ok(r.area < 3e6 && r.ratio < 2.5, `${r.id}: ${(r.area / 1e6).toFixed(2)}M px of ink filters, ${r.ratio.toFixed(2)}x its viewBox`);
  }
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

test('the art engine knows each sprite\'s largest filter region (WebKit paints sized SVGs at most at the scale that keeps it within the limit)', (t) => {
  // js/art-core.js sizedScale: where WebKit filters an SVG image at its own size, bitmaps are painted
  // from SVGs sized to them, and every filter region grows with that size: past 4096 x 4096 px the
  // element vanishes (mouth_face at 2.6x lost its skin wash). So the size is capped by
  // A.filterArea(id), which must be at least the largest region the sprite has.
  const bad = [];
  let worst = { r: 0 };
  for (const { id, viewBox, filters, uses } of sprites) {
    let max = 0;
    for (const { el, id: fid } of uses) {
      const [, , w, h] = filterRegion(filters[fid], el, viewBox);
      const m = ctmOf(el);
      max = Math.max(max, w * h * Math.abs(m[0] * m[3] - m[1] * m[2]));
    }
    const a = A.filterArea(id);
    // (this test's boxes pad sampled arcs by half a unit, which counts on the smallest sprites)
    if (!(a >= max * 0.85)) bad.push(`${id}: filterArea ${Math.round(a)}, the largest region ${Math.round(max)}`);
    // the scale sizedScale caps at (0.9 of the limit), where it can matter: the largest region fits there
    const cap = Math.sqrt((WEBKIT_MAX_FILTER_AREA * 0.9) / a);
    if (cap < 8) {
      const r = (max * cap * cap) / WEBKIT_MAX_FILTER_AREA;
      if (r > 1) bad.push(`${id}: at its cap ${cap.toFixed(2)}x its largest region is ${(r * 100).toFixed(0)}% of the limit`);
      if (r > worst.r) worst = { r, id, cap };
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(worst.id, 'some sprite is capped below 8x');
  t.diagnostic(`at the cap, the largest region uses at most ${(worst.r * 100).toFixed(0)}% of the limit (${worst.id}, capped at ${worst.cap.toFixed(2)}x)`);
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
  // the engine's own (for ink regions): the same supersets, arcs as their whole ellipse
  assert.deepEqual([...A.pathBox('M0 0L10 0 10 5Z')], [0, 0, 10, 5]);
  assert.deepEqual([...A.pathBox('M5 5h10v10h-10z')], [5, 5, 15, 15]);
  assert.deepEqual([...A.pathBox('M0 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0')].map((v) => Math.round(v * 1e9) / 1e9), [0, -10, 20, 10]);
  assert.deepEqual([...A.pathBox('M0 0A1 1 0 0 1 10 0')].map((v) => Math.round(v * 1e9) / 1e9), [0, -5, 10, 5]); // radius scaled up to the chord
  const rot = A.pathBox('M0 0A10 4 30 0 1 10 4');
  const full = pathBox('M0 0A10 4 30 0 1 10 4', true);
  assert.ok(Math.abs(rot[0] - full[0]) < 0.6 && Math.abs(rot[3] - (full[1] + full[3])) < 0.6, `rotated ellipse ${rot} vs ${full}`);
  // every stroke in every sprite: the engine's box holds the sampled outline
  let paths = 0;
  for (const { svg } of sprites) {
    walk(svg, (el) => {
      if (el.name !== 'path') return;
      paths++;
      const a = A.pathBox(el.attrs.d), b = pathBox(el.attrs.d);
      assert.ok(a, `unreadable path ${el.attrs.d.slice(0, 60)}`);
      assert.ok(a[0] <= b[0] + 0.501 && a[1] <= b[1] + 0.501 && a[2] >= b[0] + b[2] - 0.501 && a[3] >= b[1] + b[3] - 0.501, `${el.attrs.d.slice(0, 60)}: ${a} vs ${b}`);
    });
  }
  assert.ok(paths > 1000, `${paths} paths`);
  const p = apply(parseTransform('rotate(90 10 0)'), [20, 0]);
  assert.ok(Math.abs(p[0] - 10) < 1e-9 && Math.abs(p[1] - 10) < 1e-9);
});
