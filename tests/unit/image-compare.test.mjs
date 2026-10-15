// The visual comparator itself: passes what should pass, fails blur, lost
// resolution and colour changes (synthetic images, no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pngjs from 'pngjs';
import { compareImages, judge, encodeBaseline, readPng } from '../helpers/image-compare.mjs';
import { THRESHOLDS } from '../visual/thresholds.mjs';

const { PNG } = pngjs;
const W = 512, H = 512;

// A painterly test card: soft gradients, a fine pigment grain, ink-like rings.
function card() {
  const img = new PNG({ width: W, height: H });
  let s = 7;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      const grain = (rnd() - 0.5) * 18;
      const ring = Math.abs(Math.hypot(x - 256, y - 256) % 64 - 32) < 2 ? -90 : 0;
      img.data[p] = clamp(200 + 40 * Math.sin(x / 50) + grain + ring);
      img.data[p + 1] = clamp(170 + 50 * Math.cos(y / 70) + grain + ring);
      img.data[p + 2] = clamp(140 + 30 * Math.sin((x + y) / 90) + grain + ring);
      img.data[p + 3] = 255;
    }
  }
  return img;
}
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const map = (img, fn) => {
  const out = new PNG({ width: img.width, height: img.height });
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const p = (y * img.width + x) * 4;
    const [r, g, b] = fn(x, y, p);
    out.data[p] = clamp(r); out.data[p + 1] = clamp(g); out.data[p + 2] = clamp(b); out.data[p + 3] = 255;
  }
  return out;
};
const px = (img, x, y, c) => img.data[(Math.max(0, Math.min(img.height - 1, y)) * img.width + Math.max(0, Math.min(img.width - 1, x))) * 4 + c];
const boxBlur = (img) => map(img, (x, y) => [0, 1, 2].map((c) => {
  let t = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) t += px(img, x + i, y + j, c); return t / 9;
}));
// render at half resolution, then upscale bilinearly (a 1x bitmap on a 2x screen)
const halfRes = (img) => map(img, (x, y) => [0, 1, 2].map((c) => {
  const sx = (x - 0.5) / 2, sy = (y - 0.5) / 2;
  const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
  const s = (X, Y) => (px(img, 2 * X, 2 * Y, c) + px(img, 2 * X + 1, 2 * Y, c) + px(img, 2 * X, 2 * Y + 1, c) + px(img, 2 * X + 1, 2 * Y + 1, c)) / 4;
  return (s(x0, y0) * (1 - fx) + s(x0 + 1, y0) * fx) * (1 - fy) + (s(x0, y0 + 1) * (1 - fx) + s(x0 + 1, y0 + 1) * fx) * fy;
}));

const base = card();
const verdict = (img, th = THRESHOLDS) => judge(compareImages(img, base), { ...th, region: null });

test('identical images pass with PSNR ∞', () => {
  const v = verdict(base);
  assert.deepEqual(v.failures, []);
  assert.equal(v.summary.psnr, Infinity);
  assert.equal(v.summary.ssim, 1);
});

test('±1 level rounding noise passes', () => {
  let s = 3;
  const v = verdict(map(base, (x, y, p) => [0, 1, 2].map((c) => base.data[p + c] + (((s = (s * 1103515245 + 12345) >>> 0) >> 16) % 3) - 1)));
  assert.deepEqual(v.failures, []);
});

test('a 3x3 blur fails on sharpness', () => {
  const v = verdict(boxBlur(base));
  assert.ok(v.failures.some((f) => /sharpness/.test(f)), v.failures.join('\n'));
});

test('half-resolution rendering upscaled fails on sharpness', () => {
  const v = verdict(halfRes(base));
  assert.ok(v.failures.some((f) => /image: sharpness/.test(f)), v.failures.join('\n'));
});

test('a uniform +3 level colour shift fails', () => {
  const v = verdict(map(base, (x, y, p) => [base.data[p] + 3, base.data[p + 1] + 3, base.data[p + 2] + 3]));
  assert.ok(v.failures.some((f) => /image: mean colour shift/.test(f)), v.failures.join('\n'));
});

test('a recoloured patch fails on its tile only', () => {
  const v = verdict(map(base, (x, y, p) => (x >= 256 && y >= 256 ? [base.data[p] + 12, base.data[p + 1], base.data[p + 2] - 12] : [base.data[p], base.data[p + 1], base.data[p + 2]])));
  assert.ok(v.failures.some((f) => /^tile @256,256: .*colour shift/.test(f)), v.failures.join('\n'));
  assert.ok(!v.failures.some((f) => /^tile @0,0/.test(f)));
});

test('a size change fails', () => {
  const v = judge(compareImages(new PNG({ width: 10, height: 10 }), base), THRESHOLDS);
  assert.match(v.failures[0], /size/);
});

test('per-region metrics name the damaged sprite', () => {
  const blurred = boxBlur(base);
  const mixed = map(base, (x, y, p) => (x < 128 && y < 128 ? [0, 1, 2].map((c) => blurred.data[p + c]) : [0, 1, 2].map((c) => base.data[p + c])));
  const regions = [{ name: 'damaged', x: 0, y: 0, w: 128, h: 128 }, { name: 'fine', x: 256, y: 256, w: 128, h: 128 }];
  const v = judge(compareImages(mixed, base, { regions }), THRESHOLDS);
  assert.deepEqual(v.summary.failedSprites, ['damaged']);
});

test('baselines round-trip through the PNG encoder losslessly', () => {
  const again = readPng(encodeBaseline(base));
  assert.equal(compareImages(again, base).global.psnr, Infinity);
});
