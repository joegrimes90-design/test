// Same-run A/B test of the bitmap sprite layer (js/art-core.js): every case is
// rendered twice in one test, once with ?raster=svg (the plain SVG images the
// baselines were recorded from) and once in the default bitmap mode, and the
// two screenshots are compared with limits much stricter than the baselines'
// (tests/visual/thresholds.mjs), because both come from the same build in the
// same run: anything but sub-pixel placement is a real difference.
//
// RASTER_PARITY_SELFTEST=1 npx playwright test raster-parity
//   also renders known-bad variants and expects every one to FAIL these limits
//   (see BROKEN below), so the limits are proven to catch them.
import fs from 'node:fs';
import { test, expect } from '../helpers/fixtures.mjs';
import { loadGame } from '../helpers/load-game.mjs';
import { readPng, writePng, compareImages, judge, diffImage } from '../helpers/image-compare.mjs';
import { galleryPages } from './gallery-layout.mjs';

// Limits. The plan's floors: global PSNR >= 40 dB, sharpness 0.97-1.03, worst
// 256 px tile sharpness >= 0.90, sprites PSNR >= 38 dB with sharpness 0.95-1.05,
// colour shift <= 0.5 levels. Calibrated on the finished implementation: the
// measured worst minus 3 dB / 0.02 sharpness, never looser than those floors.
//
// Gallery pages: every sprite at rest (scale 1, half scale, largest in-game
// scale), where a bitmap must reproduce the SVG almost exactly. Measured worst
// over the 9 pages: global PSNR 56.3 dB, sharpness 1.0004-1.0026, worst tile
// sharpness 0.987, worst sprite PSNR 48.8 dB (at_shorts), sprite sharpness
// 0.978-1.008, colour shift 0.03.
export const PARITY_GALLERY = {
  global: { psnr: 53, ssim: 0.995, sharpMin: 0.98, sharpMax: 1.02, shift: 0.5 },
  tile: { psnr: 41, ssim: 0.99, sharpMin: 0.96, minDetail: 100, shift: 0.5 },
  region: { psnr: 45, ssim: 0.99, sharpMin: 0.955, sharpMax: 1.03, minDetail: 20, shift: 0.5 },
};

const A = loadGame({ only: ['art-'] }).AT.art;
const PAGES = galleryPages(A.list(), A.box);

async function galleryShot(page, name, svg) {
  const p = PAGES.find((x) => x.name === name);
  await page.setViewportSize({ width: p.width, height: p.height });
  await page.goto(`/tests/visual/gallery.html?page=${name}${svg ? '&raster=svg' : ''}`);
  await page.waitForFunction(() => window.__gallery, null, { timeout: 120_000 });
  const mode = await page.evaluate(() => window.__gallery.mode);
  expect(mode).toBe(svg ? 'svg' : 'bitmap');
  return page.screenshot({ clip: { x: 0, y: 0, width: p.width, height: p.height }, animations: 'disabled' });
}
const galleryRegions = (name, dpr) => PAGES.find((x) => x.name === name).cells
  .map((c) => ({ name: c.s === 1 ? c.id : `${c.id}@${c.s}`, x: c.x * dpr, y: c.y * dpr, w: c.w * dpr, h: c.h * dpr }));

const ps = (v) => (v === Infinity || v === null ? '∞' : v);
const line = (s) => `PSNR ${ps(s.psnr)} dB, SSIM ${s.ssim}, sharpness ${s.sharpness}, shift ${s.shift.join('/')}; worst tile PSNR ${ps(s.worstTile.psnr)}, SSIM ${s.minTileSsim}, sharpness ${s.minTileSharpness}`
  + (s.worstSprite ? `; worst sprite ${s.worstSprite.name} PSNR ${ps(s.worstSprite.psnr)}, min sprite SSIM ${s.minSpriteSsim}, sharpness ${s.minSpriteSharpness}` : '');

function compare(bitmapPng, svgPng, { regions, thresholds = PARITY_GALLERY } = {}) {
  const act = readPng(bitmapPng), exp = readPng(svgPng);
  const cmp = compareImages(act, exp, { regions });
  const { failures, summary } = judge(cmp, regions ? thresholds : { ...thresholds, region: null });
  const judged = cmp.tiles.filter((t) => t.detail >= thresholds.tile.minDetail);
  const r4 = (v) => Math.round(v * 10000) / 10000;
  summary.minTileSharpness = r4(Math.min(...judged.map((t) => t.sharpness)));
  summary.minTileSsim = r4(Math.min(...cmp.tiles.map((t) => t.ssim)));
  if (cmp.regions.length) summary.minSpriteSsim = r4(Math.min(...cmp.regions.map((t) => t.ssim)));
  return { cmp, failures, summary, act, exp };
}

async function expectParity(testInfo, name, bitmapPng, svgPng, opts) {
  const r = compare(bitmapPng, svgPng, opts);
  console.log(`[parity] ${name}: ${line(r.summary)}${r.failures.length ? '  FAIL' : ''}`);
  testInfo.annotations.push({ type: 'parity', description: `${name}: ${line(r.summary)}` });
  if (r.failures.length) {
    const out = (s) => testInfo.outputPath(`${name.replace(/[^\w.-]/g, '_')}-${s}.png`);
    fs.writeFileSync(out('bitmap'), bitmapPng);
    fs.writeFileSync(out('svg'), svgPng);
    writePng(out('diff'), diffImage(r.act, r.exp));
    for (const s of ['bitmap', 'svg', 'diff']) await testInfo.attach(`${name}-${s}`, { path: out(s), contentType: 'image/png' });
  }
  expect(r.failures, `${name}: bitmap layer differs from the SVG rendering`).toEqual([]);
}

const GALLERY = ['sprites-01', 'sprites-02', 'sprites-03', 'sprites-04', 'sprites-05', 'scaled-01', 'scaled-02', 'stage-01', 'stage-02'];
test('the parity cases cover every gallery page', () => {
  expect(PAGES.map((p) => p.name).sort()).toEqual([...GALLERY].sort());
});

for (const name of GALLERY) {
  test(`parity gallery ${name}`, async ({ page }, testInfo) => {
    const dpr = testInfo.project.use.deviceScaleFactor;
    const svg = await galleryShot(page, name, true);
    const bmp = await galleryShot(page, name, false);
    await expectParity(testInfo, `gallery-${name}`, bmp, svg, { regions: galleryRegions(name, dpr) });
  });
}

// ---- proof that the limits catch the known blur traps ----
const BROKEN = {
  // the naive mapping: bitmap squeezed into the sprite's CSS box, not snapped to device pixels
  'no snapping, CSS size = box size': { tuning: { snap: false, boxSize: true } },
  // bitmaps painted 19% too big and scaled down by the browser
  'oversampled k x 1.19': { tuning: { oversample: 1.19 } },
};
const SELFTEST_CASES = ['gallery sprites-01', 'gallery scaled-01', 'gallery stage-01'];
for (const [variant, v] of Object.entries(BROKEN)) {
  test(`parity limits catch: ${variant}`, async ({ page }, testInfo) => {
    test.skip(!process.env.RASTER_PARITY_SELFTEST, 'set RASTER_PARITY_SELFTEST=1 to run');
    const dpr = testInfo.project.use.deviceScaleFactor;
    // broken variants apply to the bitmap renders only
    if (v.tuning) await page.addInitScript((t) => { window.__AT_RASTER_TUNING = t; }, v.tuning);
    if (v.css) {
      await page.addInitScript((css) => {
        if (location.search.includes('raster=svg')) return;
        document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); });
      }, v.css);
    }
    const results = [];
    for (const c of SELFTEST_CASES) {
      const name = c.split(' ')[1];
      const svg = await galleryShot(page, name, true);
      const bmp = await galleryShot(page, name, false);
      const r = compare(bmp, svg, { regions: galleryRegions(name, dpr) });
      console.log(`[parity selftest] ${variant} / ${c}: ${line(r.summary)} -> ${r.failures.length ? 'fails (good)' : 'PASSES (bad)'}`);
      results.push({ c, failures: r.failures.length });
    }
    // (at scale 1 and at half scale on a 2x screen every sprite lands on whole device
    // pixels, where even the naive mapping is exact: a variant need not fail every case)
    expect(results.some((r) => r.failures), `${variant} must fail the parity limits`).toBe(true);
  });
}

// Selftest scores (RASTER_PARITY_SELFTEST=1), recorded on this implementation:
//   no snapping, CSS size = box size: sprites-01 and stage-01 identical to the correct
//     mapping (scale 1 and 1/2 put every sprite on whole device pixels); scaled-01
//     fails: PSNR 51.6 dB, worst tile sharpness 0.805, worst sprite bb_mouth_cry@1.15
//     34.4 dB / sharpness 0.796.
//   oversampled k x 1.19: fails everywhere: sprites-01 37.3 dB, sharpness 0.588, worst
//     tile 0.456; scaled-01 47.4 dB, 0.862, tile 0.820; stage-01 40.7 dB, 0.916, tile 0.768.
