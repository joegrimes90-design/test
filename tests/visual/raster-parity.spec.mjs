// Same-run A/B test of the bitmap sprite layer (js/art-core.js): every case is
// rendered twice in one test, once with ?raster=svg (the plain SVG images the
// baselines were recorded from) and once in the default bitmap mode, and the
// two screenshots are compared with limits much stricter than the baselines'
// (tests/visual/thresholds.mjs), because both come from the same build in the
// same run: anything but sub-pixel placement is a real difference.
//
// RASTER_PARITY_SELFTEST=1 npx playwright test raster-parity
//   also renders known-bad variants of the layer (see BROKEN below) and expects
//   them to FAIL these limits, so the limits are proven to catch them (scores at
//   the end of this file).
import fs from 'node:fs';
import { test, expect } from '../helpers/fixtures.mjs';
import { prepare, openGame, step, autoPlay, settleForScreenshot } from '../helpers/game.mjs';
import { loadGame } from '../helpers/load-game.mjs';
import { readPng, writePng, compareImages, judge, diffImage } from '../helpers/image-compare.mjs';
import { galleryPages } from './gallery-layout.mjs';
import { THRESHOLDS } from './thresholds.mjs';

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

// Scene frames: the hand-washing and mouth close-ups, the reward star resting at
// the top of its flight, and the title after a resize. Measured worst over
// these 4: global PSNR 41.8 dB, SSIM 0.997, sharpness 0.994-1.002, worst tile
// PSNR 32.4 dB, SSIM 0.975, sharpness 0.946, colour shift 0.05.
export const PARITY_SCENE = {
  global: { psnr: 40, ssim: 0.99, sharpMin: 0.973, sharpMax: 1.022, shift: 0.5 },
  tile: { psnr: 29, ssim: 0.96, sharpMin: 0.926, minDetail: 100, shift: 3 },
  region: null,
};
// The title is in constant motion: the Play button pulses (scale 1.04-1.16), the
// sun turns, clouds drift, every puppet breathes and turns its head and arms. SVG
// re-renders all of that exactly in every frame; a bitmap of a sprite whose scale,
// angle or position changes every frame is resampled by the browser. The resolution
// policy keeps such a bitmap between 1% below and about 3% above the displayed scale
// (oscillating sprites step through cached 2^(1/32) scales both ways), but a moving
// sprite is also shown at whatever sub-pixel position it has reached, and a bitmap
// half a device pixel off the grid looks softer than the same bitmap on it (measured
// at 4.6 s: the Play button at its exact scale, 0.67 px off the grid, put its tile at
// sharpness 0.76; on the grid, 1.0). So these frames cost local sharpness that the
// plan's floors do not allow for, and how much depends on the moment.
//   - title@2s keeps the limits first calibrated on it (measured worst minus 3 dB /
//     0.02: global PSNR 38.1 dB, sharpness 0.986, worst tile 0.847, now 0.845); the
//     selftest shows they catch the known-bad variants. They hold at that moment only.
//   - PARITY_ANIMATED_MOMENTS is calibrated over 2, 2.4, 3.1 and 4.6 s (the same rule
//     on the worst of them: tile sharpness 0.8453 / 0.8186 / 0.8188 / 0.9109, global
//     PSNR >= 38.19 dB, sharpness >= 0.9816, worst tile PSNR >= 30.19, SSIM >= 0.9715).
export const PARITY_ANIMATED = {
  global: { psnr: 35, ssim: 0.98, sharpMin: 0.965, sharpMax: 1.03, shift: 0.5 },
  tile: { psnr: 27, ssim: 0.95, sharpMin: 0.827, minDetail: 100, shift: 3 },
  region: null,
};
export const PARITY_ANIMATED_MOMENTS = {
  global: { psnr: 35, ssim: 0.98, sharpMin: 0.96, sharpMax: 1.03, shift: 0.5 },
  tile: { psnr: 27, ssim: 0.95, sharpMin: 0.798, minDetail: 100, shift: 3 },
  region: null,
};

// Off the pixel grid: on most real screens one stage unit is not a whole number of
// eighths of a device pixel (an 11" iPad Pro, 1194x834 at 2x: 1.4925 px), so sprites
// come to rest between device pixels (the potty scene's 1400-unit camera pan moves
// the world 2089.5 px). A resting bitmap is moved by up to half a device pixel onto the
// grid, and moved again whenever it comes to rest somewhere else, so it is exactly as
// sharp as the SVG (without the re-snap the bathroom measured sharpness 0.942, worst tile
// 0.743: visibly smeared ink lines). But the SVG is drawn at the exact sub-pixel place,
// and half-pixel shifts cost PSNR and SSIM that no sharp bitmap can avoid (the SVG
// bathroom shifted half a device pixel against itself: 37.8 dB). So these frames keep
// PARITY_SCENE's sharpness limits, which catch the blur, with PSNR/SSIM floors
// calibrated on them (measured worst minus 3 dB / 0.005). Measured, bathroom /
// hand-washing: global PSNR 33.91 / 34.47 dB, SSIM 0.9813 / 0.9842, sharpness 0.9999 /
// 0.9995; worst tile PSNR 24.66 / 24.66, SSIM 0.9414 / 0.9507, sharpness 0.9581 / 0.9546.
export const PARITY_OFFGRID = {
  global: { psnr: 30.9, ssim: 0.976, sharpMin: PARITY_SCENE.global.sharpMin, sharpMax: PARITY_SCENE.global.sharpMax, shift: 0.5 },
  tile: { psnr: 21.6, ssim: 0.936, sharpMin: PARITY_SCENE.tile.sharpMin, minDetail: 100, shift: 3 },
  region: null,
};
const OFFGRID_VIEWPORT = { width: 1194, height: 834 };

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

// scene frames, reached exactly as in scenes.spec.mjs (deterministic: same seed, same moves)
const flyStarPeak = () => [...document.querySelectorAll('#ui img[data-sprite="star"]')].some((im) => {
  const m = /scale\(([\d.]+)/.exec(im.parentNode.style.transform);
  return !!m && Math.abs(+m[1] - 1.8) < 1e-6;
});
const toBathroom = async (page) => {
  await autoPlay(page, () => AT.engine.camera.x === 1400);
  await step(page, 1, 10);
};
const handwash = async (page) => {
  await autoPlay(page, () => document.querySelectorAll('.cardclip img[data-sprite="foam"]').length >= 3);
  await step(page, 1, 10);
};
const SCENES = {
  'title@2s': { scene: 'title', thresholds: PARITY_ANIMATED, go: async (page) => { await step(page, 2, 30); } },
  'title@2.4s': { scene: 'title', thresholds: PARITY_ANIMATED_MOMENTS, go: async (page) => { await step(page, 2.4, 30); } },
  'title@3.1s': { scene: 'title', thresholds: PARITY_ANIMATED_MOMENTS, go: async (page) => { await step(page, 3.1, 30); } },
  'title@4.6s': { scene: 'title', thresholds: PARITY_ANIMATED_MOMENTS, go: async (page) => { await step(page, 4.6, 30); } },
  // the bathroom 1 s after the camera has panned to it, and the hand-washing close-up,
  // where nothing lands on whole device pixels by itself
  'potty-bathroom@1194x834': { scene: 'potty', viewport: OFFGRID_VIEWPORT, thresholds: PARITY_OFFGRID, go: toBathroom },
  'potty-handwash@1194x834': { scene: 'potty', viewport: OFFGRID_VIEWPORT, thresholds: PARITY_OFFGRID, go: handwash },
  'potty-handwash': { scene: 'potty', go: handwash },
  'teeth-mouth': {
    scene: 'teeth',
    go: async (page) => {
      await autoPlay(page, () => [...document.querySelectorAll('img[data-sprite="tooth_dirt"]')].filter((im) => im.parentNode.style.opacity === '0').length >= 4);
      await step(page, 0.5, 10);
    },
  },
  // the reward star resting at the top of its flight (s = 2 x 0.9) for 0.3 s: at rest, so strict
  'potty-flystar-peak': {
    scene: 'potty',
    go: async (page) => {
      await autoPlay(page, flyStarPeak);
      await step(page, 0.1, 10);
    },
  },
  // the hand-washing card halfway through popping open: a moving moment, where bitmaps may be
  // shown scaled down, so the suite's normal limits (tests/visual/thresholds.mjs) apply
  'potty-card-pop': {
    scene: 'potty',
    thresholds: THRESHOLDS,
    go: async (page) => {
      await autoPlay(page, () => {
        const c = document.querySelector('#ui .card');
        const m = c && /scale\(([\d.]+)/.exec(c.style.transform);
        return !!m && +m[1] > 0.4 && +m[1] < 0.9;
      }, { fps: 30 });
    },
  },
};

async function sceneShot(page, name, svg, checks = true) {
  await page.setViewportSize(SCENES[name].viewport || { width: 1280, height: 720 });
  await openGame(page, { scene: SCENES[name].scene, query: { raster: svg ? 'svg' : 'bitmap' } });
  expect(await page.evaluate(() => AT.art.mode)).toBe(svg ? 'svg' : 'bitmap');
  await SCENES[name].go(page);
  const bad = await settleForScreenshot(page);
  if (!svg && checks) {
    expect(bad, 'sprite bitmaps off scale (AT.art.audit)').toEqual([]);
    // every visible sprite outside a running scale tween is a bitmap by now
    const svgLeft = await page.evaluate(() => [...document.querySelectorAll('#stage img[data-sprite]')]
      .filter((im) => { if (im.dataset.k || !(im.getBoundingClientRect().width > 0)) return false; for (let e = im; e; e = e.parentElement) if (e._atTween > 0) return false; return true; })
      .map((im) => im.dataset.sprite));
    expect(svgLeft, 'sprites still shown as SVG').toEqual([]);
  }
  return page.screenshot({ animations: 'disabled', caret: 'hide' });
}

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

for (const name of Object.keys(SCENES)) {
  test(`parity scene ${name}`, async ({ page }, testInfo) => {
    await prepare(page, { audio: false });
    const svg = await sceneShot(page, name, true);
    const bmp = await sceneShot(page, name, false);
    await expectParity(testInfo, `scene-${name}`, bmp, svg, { thresholds: SCENES[name].thresholds || PARITY_SCENE });
  });
}

// Resizing repaints the sprite bitmaps for the new scale: the title opened at
// 1280x720, played 2 s and resized to 1920x1080 matches a fresh 1920x1080 load at
// the same moment (both bitmap mode).
test('parity after a resize', async ({ page }, testInfo) => {
  await prepare(page, { audio: false });
  const shot = async (resize) => {
    await page.setViewportSize(resize ? { width: 1280, height: 720 } : { width: 1920, height: 1080 });
    await openGame(page, { query: { raster: 'bitmap' } });
    await step(page, 2, 30);
    if (resize) {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.evaluate(() => new Promise((r) => setTimeout(r, 50)).then(() => AT.art.idle()));
    }
    expect(await settleForScreenshot(page), 'sprite bitmaps off scale (AT.art.audit)').toEqual([]);
    const info = await page.evaluate(() => ({ t: AT.engine.time, k: [...document.querySelectorAll('#world img[data-sprite="bg_garden"]')].map((im) => im.dataset.k) }));
    return { png: await page.screenshot({ animations: 'disabled', caret: 'hide' }), info };
  };
  const fresh = await shot(false);
  const resized = await shot(true);
  expect(resized.info).toEqual(fresh.info);
  await expectParity(testInfo, 'resize-1280-to-1920', resized.png, fresh.png, { thresholds: PARITY_SCENE });
});

// The Home button pulses at the end of the party (CSS animation .hudbtn.pulse, scale up
// to 1.18). That never goes through Node.set, and a once-a-second sweep samples a 1 s
// pulse at one phase, so the icon's bitmap is painted for the pulse's peak keyframe as
// soon as the animation starts. Checked at several phases of the pulse (never shown
// magnified), and at the peak against the SVG. (A paused CSS animation is drawn on its
// own compositor layer, which softens both renderings a little: measured at the peak,
// button region PSNR 35.5 dB, SSIM 0.991, sharpness 0.902; the bitmap of the old
// policy, left at the phase the sweep happened to sample, scored sharpness 0.868 while
// shown magnified. Region limits: measured minus 3 dB / 0.005 / 0.02; measured again in
// the suite: 35.2 dB, 0.9895, 0.900.)
const PARITY_PULSE = { ...THRESHOLDS, region: { psnr: 32.5, ssim: 0.986, sharpMin: 0.882, sharpMax: 1.05, minDetail: 20, shift: 1 } };
test('the pulsing Home button shows its bitmap for the peak of the pulse', async ({ page }, testInfo) => {
  await prepare(page, { audio: false });
  const shot = async (svg) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openGame(page, { scene: 'hub', query: { raster: svg ? 'svg' : 'bitmap' } });
    await step(page, 1, 30);
    await page.evaluate(() => document.getElementById('btn-home').classList.add('pulse'));
    if (!svg) {
      for (let i = 0; i < 6; i++) {
        await step(page, i ? 0.5 : 1, 30); // (sweeps on the game clock; the pulse runs on the wall clock)
        const r = await page.evaluate(async () => {
          await AT.art.idle();
          const im = document.querySelector('#btn-home img');
          const out = [];
          for (const ms of [0, 250, 500, 750]) {
            document.getAnimations().forEach((a) => { a.pause(); a.currentTime = ms; });
            out.push({ ms, k: +im.dataset.k, kPeak: AT.art.kPeak(im), magnified: AT.art.audit().filter((a) => a.kBitmap < a.kDisplay / 1.01) });
          }
          document.getAnimations().forEach((a) => a.play());
          return out;
        });
        for (const x of r) {
          expect(x.magnified, `magnified at ${x.ms} ms into the pulse`).toEqual([]);
          expect(x.k, 'bitmap painted for the peak of the pulse').toBe(x.kPeak);
        }
      }
    } else await step(page, 3.5, 30);
    await page.evaluate(() => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 500; })); // the peak
    const bad = await settleForScreenshot(page);
    if (!svg) expect(bad, 'sprite bitmaps off scale (AT.art.audit)').toEqual([]);
    const r = await page.evaluate(() => { const b = document.getElementById('btn-home').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; });
    return { png: await page.screenshot({ animations: 'allow', caret: 'hide' }), rect: r };
  };
  const svg = await shot(true);
  const bmp = await shot(false);
  const d = testInfo.project.use.deviceScaleFactor;
  const [x, y, w, h] = bmp.rect;
  const regions = [{ name: 'btn-home', x: (x - 8) * d, y: Math.max(0, y - 8) * d, w: (w + 16) * d, h: (h + 16) * d }];
  await expectParity(testInfo, 'hud-pulse-peak', bmp.png, svg.png, { regions, thresholds: PARITY_PULSE });
});

// ---- proof that the limits catch the known blur traps ----
const BROKEN = {
  // the naive mapping: bitmap squeezed into the sprite's CSS box, not snapped to device pixels
  'no snapping, CSS size = box size': { tuning: { snap: false, boxSize: true } },
  // bitmaps painted 19% too big and scaled down by the browser
  'oversampled k x 1.19': { tuning: { oversample: 1.19 } },
  // every sprite on its own compositor layer: measured harmless here (identical scores),
  // because bitmaps snapped 1:1 to device pixels are composited without resampling; it
  // softened the SVG sprites the plan measured it on. Recorded, not expected to fail.
  '.spr { will-change: transform }': { css: '.spr { will-change: transform }', informational: true },
  // the snap worked out only when a bitmap is put in, never again when the sprite comes to rest elsewhere
  'no re-snap at rest': { tuning: { resnap: false } },
};
const SELFTEST_CASES = ['gallery sprites-01', 'gallery scaled-01', 'gallery stage-01', 'scene title@2s', 'scene potty-flystar-peak', 'scene potty-bathroom@1194x834'];
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
    await prepare(page, { audio: false });
    const results = [];
    for (const c of SELFTEST_CASES) {
      const [kind, name] = c.split(' ');
      let r;
      if (kind === 'gallery') {
        const svg = await galleryShot(page, name, true);
        const bmp = await galleryShot(page, name, false);
        r = compare(bmp, svg, { regions: galleryRegions(name, dpr) });
      } else {
        const svg = await sceneShot(page, name, true);
        const bmp = await sceneShot(page, name, false, false);
        r = compare(bmp, svg, { thresholds: SCENES[name].thresholds || PARITY_SCENE });
      }
      if (v.css) expect(await page.evaluate(() => getComputedStyle(document.querySelector('img[data-k]')).willChange)).toBe('transform');
      console.log(`[parity selftest] ${variant} / ${c}: ${line(r.summary)} -> ${r.failures.length ? 'fails (good)' : 'PASSES (bad)'}`);
      results.push({ c, failures: r.failures.length });
    }
    // (at scale 1 and at half scale on a 2x screen every sprite lands on whole device
    // pixels, where even the naive mapping is exact: a variant need not fail every case)
    if (!v.informational) expect(results.some((r) => r.failures), `${variant} must fail the parity limits`).toBe(true);
  });
}

// Selftest scores (RASTER_PARITY_SELFTEST=1), recorded on this implementation
// (PSNR / global sharpness / worst tile sharpness):
//   correct layer, for reference: title@2s 38.1 dB / 0.986 / 0.847; flystar peak
//     41.8 dB / 0.998 / 0.955; gallery pages >= 56 dB / >= 1.000 / >= 0.987.
//   no snapping, CSS size = box size: fails scaled-01 (51.6 dB / 0.976 / 0.805, worst
//     sprite bb_mouth_cry@1.15 34.4 dB / 0.796), title@2s (40.8 dB / 0.935 / 0.790) and
//     flystar peak (42.3 dB / 0.940 / 0.842); sprites-01 and stage-01 are identical to
//     the correct mapping (scale 1 and 1/2 put every sprite on whole device pixels).
//   oversampled k x 1.19: fails all five: sprites-01 37.3 dB / 0.588 / 0.456,
//     scaled-01 47.4 / 0.862 / 0.820, stage-01 40.7 / 0.916 / 0.768, title@2s
//     37.4 / 0.953 / 0.708, flystar peak 37.4 / 0.879 / 0.601.
//   .spr { will-change: transform } (applied: computed will-change checked): identical
//     to the correct layer on the gallery pages and the flystar peak, title@2s
//     38.1 dB / 0.982 / 0.847: harmless for bitmaps snapped to device pixels.
//   Re-run with the re-snap at rest and the 1194x834 bathroom case: correct layer there
//     33.9 dB / 1.000 / 0.958; no snapping fails it (33.6 / 0.923 / 0.775), oversampled
//     fails it (34.2 / 0.926 / 0.776), will-change passes it (34.0 / 0.997 / 0.958).
//   no re-snap at rest (snap worked out only when a bitmap is put in): fails the bathroom
//     at 1194x834 (33.3 dB / 0.942 / 0.743); every other case is identical to the correct
//     layer (at 1280x720 the pan and the moves land on whole device pixels anyway).
