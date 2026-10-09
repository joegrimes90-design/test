// Perceptual-ish image comparison for the visual quality tests (pure JS, pngjs).
//
// Metrics (computed on 8-bit sRGB, opaque screenshots):
//   psnr        global PSNR over R,G,B in dB (Infinity when identical)
//   ssim        mean SSIM of luma over 8x8 windows (stride 4)
//   sharpness   gradient energy of luma (mean squared central difference,
//               "Tenengrad"), actual / expected. Blur or upscaling from a lower
//               resolution pushes it below 1; aliasing or added noise above 1.
//               (Gradient energy rather than the Laplacian: re-rasterising at
//               the displayed resolution softens single-pixel grain a little,
//               which the Laplacian over-weights but no eye can see on a
//               high-DPI screen. See README "Testing".)
//   shift       mean signed difference per channel (actual - expected) in
//               8-bit levels: catches global colour/brightness changes that
//               PSNR forgives.
//   tiles       the same metrics per tile (default 256x256 px); the worst tile
//               catches local damage (one broken or blurry sprite) in a big frame.
//   detail      gradient energy of the baseline region: sharpness is only judged
//               where there is detail to lose (flat sky can't get blurrier).
//   regions     optional named rectangles (e.g. one per sprite in the gallery)
//               get their own metrics, so a failure names the culprit.
import fs from 'node:fs';
import pngjs from 'pngjs';

const { PNG } = pngjs;

export const readPng = (bufOrPath) => PNG.sync.read(Buffer.isBuffer(bufOrPath) ? bufOrPath : fs.readFileSync(bufOrPath));
export const writePng = (file, img) => fs.writeFileSync(file, PNG.sync.write(img, { colorType: 6, deflateLevel: 9 }));

// Opaque RGB PNG, max compression: what the baselines are stored as.
export function encodeBaseline(img) {
  return PNG.sync.write(img, { colorType: 2, inputHasAlpha: true, deflateLevel: 9 });
}

function luma(img) {
  const { width: w, height: h, data } = img;
  const y = new Float32Array(w * h);
  for (let i = 0, p = 0; i < y.length; i++, p += 4) y[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  return y;
}

// Sum of squared central-difference gradients over a rectangle (interior pixels only).
function gradEnergy(Y, w, h, x0, y0, x1, y1) {
  let s = 0, n = 0;
  const xa = Math.max(1, x0), ya = Math.max(1, y0), xb = Math.min(w - 1, x1), yb = Math.min(h - 1, y1);
  for (let y = ya; y < yb; y++) {
    let i = y * w + xa;
    for (let x = xa; x < xb; x++, i++) {
      const gx = Y[i + 1] - Y[i - 1], gy = Y[i + w] - Y[i - w];
      s += gx * gx + gy * gy; n++;
    }
  }
  return { s, n };
}

const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
// SSIM over 8x8 windows with stride 4, inside a rectangle. Returns {sum, n}.
function ssimSum(A, B, w, x0, y0, x1, y1) {
  let sum = 0, n = 0;
  for (let y = y0; y + 8 <= y1; y += 4) {
    for (let x = x0; x + 8 <= x1; x += 4) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let j = 0; j < 8; j++) {
        let i = (y + j) * w + x;
        for (let k = 0; k < 8; k++, i++) {
          const a = A[i], b = B[i];
          sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
        }
      }
      const ma = sa / 64, mb = sb / 64;
      const va = saa / 64 - ma * ma, vb = sbb / 64 - mb * mb, cov = sab / 64 - ma * mb;
      sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      n++;
    }
  }
  return { sum, n };
}

function rectStats(act, exp, Ya, Ye, x0, y0, x1, y1) {
  const w = act.width;
  let se = 0, n = 0;
  const shift = [0, 0, 0];
  for (let y = y0; y < y1; y++) {
    let p = (y * w + x0) * 4;
    for (let x = x0; x < x1; x++, p += 4) {
      for (let c = 0; c < 3; c++) {
        const d = act.data[p + c] - exp.data[p + c];
        se += d * d; shift[c] += d;
      }
      n++;
    }
  }
  const mse = se / (3 * Math.max(1, n));
  const la = gradEnergy(Ya, w, act.height, x0, y0, x1, y1);
  const le = gradEnergy(Ye, w, act.height, x0, y0, x1, y1);
  const ss = ssimSum(Ya, Ye, w, x0, y0, x1, y1);
  return {
    psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse),
    ssim: ss.n ? ss.sum / ss.n : 1,
    sharpness: le.s === 0 ? (la.s === 0 ? 1 : Infinity) : la.s / le.s,
    detail: le.s / Math.max(1, le.n),
    shift: shift.map((v) => v / Math.max(1, n)),
  };
}

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v);
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : v);
const fmt = (m) => ({ psnr: r2(m.psnr), ssim: r4(m.ssim), sharpness: r4(m.sharpness), shift: m.shift.map(r2) });

/**
 * Compare two decoded PNGs of the same size.
 * @param {object} opts { tile: px, regions: [{name, x, y, w, h}] in image pixels }
 */
export function compareImages(act, exp, opts = {}) {
  if (act.width !== exp.width || act.height !== exp.height) {
    return { sizeMismatch: true, actual: [act.width, act.height], expected: [exp.width, exp.height] };
  }
  const { width: w, height: h } = act;
  const Ya = luma(act), Ye = luma(exp);
  const global = rectStats(act, exp, Ya, Ye, 0, 0, w, h);
  const T = opts.tile || 256;
  const tiles = [];
  for (let y = 0; y < h; y += T) {
    for (let x = 0; x < w; x += T) {
      const t = rectStats(act, exp, Ya, Ye, x, y, Math.min(w, x + T), Math.min(h, y + T));
      tiles.push({ x, y, ...t });
    }
  }
  const regions = (opts.regions || []).map((r) => {
    const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(w, Math.ceil(r.x + r.w)), y1 = Math.min(h, Math.ceil(r.y + r.h));
    return { name: r.name, x: x0, y: y0, ...rectStats(act, exp, Ya, Ye, x0, y0, x1, y1) };
  });
  return { width: w, height: h, global, tiles, regions };
}

/**
 * Check a comparison against thresholds. Returns a list of human-readable
 * failures (empty = pass) and a compact summary for logs/reports.
 */
export function judge(cmp, th) {
  if (cmp.sizeMismatch) return { failures: [`size ${cmp.actual} != baseline ${cmp.expected}`], summary: cmp };
  const failures = [];
  const check = (where, m, t) => {
    if (m.psnr < t.psnr) failures.push(`${where}: PSNR ${r2(m.psnr)} dB < ${t.psnr}`);
    if (m.ssim < t.ssim) failures.push(`${where}: SSIM ${r4(m.ssim)} < ${t.ssim}`);
    const judged = m.detail >= (t.minDetail || 0);
    if (judged && m.sharpness < t.sharpMin) failures.push(`${where}: sharpness ratio ${r4(m.sharpness)} < ${t.sharpMin} (blurrier than baseline)`);
    if (judged && m.sharpness > t.sharpMax) failures.push(`${where}: sharpness ratio ${r4(m.sharpness)} > ${t.sharpMax} (noisier/aliased vs baseline)`);
    const sh = Math.max(...m.shift.map(Math.abs));
    if (sh > t.shift) failures.push(`${where}: mean colour shift ${m.shift.map(r2).join('/')} > ±${t.shift} levels`);
  };
  check('image', cmp.global, th.global);
  const worst = (key, dir) => cmp.tiles.reduce((a, b) => (dir * b[key] < dir * a[key] ? b : a), cmp.tiles[0]);
  const wt = {
    psnr: worst('psnr', 1), ssim: worst('ssim', 1),
    shift: cmp.tiles.reduce((a, b) => (Math.max(...b.shift.map(Math.abs)) > Math.max(...a.shift.map(Math.abs)) ? b : a), cmp.tiles[0]),
  };
  if (th.tile) {
    for (const t of cmp.tiles) {
      const sh = Math.max(...t.shift.map(Math.abs));
      const tf = [];
      if (t.psnr < th.tile.psnr) tf.push(`PSNR ${r2(t.psnr)} < ${th.tile.psnr}`);
      if (t.ssim < th.tile.ssim) tf.push(`SSIM ${r4(t.ssim)} < ${th.tile.ssim}`);
      if (sh > th.tile.shift) tf.push(`colour shift ${t.shift.map(r2).join('/')} > ±${th.tile.shift}`);
      if (t.detail >= (th.tile.minDetail || 0) && t.sharpness < th.tile.sharpMin) tf.push(`sharpness ${r4(t.sharpness)} < ${th.tile.sharpMin}`);
      if (tf.length) failures.push(`tile @${t.x},${t.y}: ${tf.join(', ')}`);
    }
  }
  const regionFails = [];
  if (th.region) {
    for (const r of cmp.regions) {
      const before = failures.length;
      check(`sprite ${r.name}`, r, th.region);
      if (failures.length > before) regionFails.push(r.name);
    }
  }
  // keep messages readable: at most 12 tile lines
  const tileLines = failures.filter((f) => f.startsWith('tile '));
  const other = failures.filter((f) => !f.startsWith('tile '));
  const capped = [...other, ...tileLines.slice(0, 12), ...(tileLines.length > 12 ? [`…and ${tileLines.length - 12} more tiles`] : [])];
  const worstRegion = cmp.regions.length ? cmp.regions.reduce((a, b) => (b.psnr < a.psnr ? b : a)) : null;
  return {
    failures: capped,
    summary: {
      ...fmt(cmp.global),
      worstTile: { psnr: r2(wt.psnr.psnr), ssim: r4(wt.ssim.ssim), shift: wt.shift.shift.map(r2), at: [wt.psnr.x, wt.psnr.y] },
      ...(worstRegion ? { worstSprite: { name: worstRegion.name, ...fmt(worstRegion) }, minSpriteSharpness: r4(Math.min(...cmp.regions.map((r) => r.sharpness))) } : {}),
      ...(regionFails.length ? { failedSprites: regionFails } : {}),
    },
  };
}

// Heat-map of differences (amplified x4) over a faded copy of the baseline.
export function diffImage(act, exp) {
  const out = new PNG({ width: exp.width, height: exp.height });
  for (let p = 0; p < exp.data.length; p += 4) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(act.data[p + c] - exp.data[p + c]));
    const g = 0.3 * exp.data[p] + 0.59 * exp.data[p + 1] + 0.11 * exp.data[p + 2];
    const k = Math.min(1, (d * 4) / 255);
    out.data[p] = Math.round(g * 0.35 * (1 - k) + 255 * k);
    out.data[p + 1] = Math.round(g * 0.35 * (1 - k) + 40 * k);
    out.data[p + 2] = Math.round(g * 0.35 * (1 - k) + 60 * k);
    out.data[p + 3] = 255;
  }
  return out;
}
