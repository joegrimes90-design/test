// The sprite bitmap layer (js/art-core.js) in situations the screenshot suites
// don't reach: live resizes, a cache squeezed by its memory budget, and brushing
// teeth (bitmaps for foam that pops up inside pointer events).
import { test, expect } from '../helpers/fixtures.mjs';
import { prepare, openGame, autoPlay, waitShown, step, settleForScreenshot } from '../helpers/game.mjs';

// Per animation frame: is the stage visible (cover not opaque, not hidden), and is any
// visible bitmap shown magnified (AT.art.audit: k_bitmap < k_display / 1.01)?
function startSampler() {
  window.__samples = [];
  window.__jobs0 = AT.art.stats().jobs;
  const f = () => {
    const E = AT.engine;
    if (performance.getEntriesByName('at:refit').length && window.__jobs1 == null) {
      // bitmaps painted for the resize, and the distinct bitmaps the stage now shows
      window.__jobs1 = AT.art.stats().jobs;
      window.__keys = new Set([...E.stage.querySelectorAll('img[data-k]')].map((im) => `${im.dataset.sprite}@${im.dataset.k}`)).size;
    }
    const visible = +getComputedStyle(E.fade).opacity < 1 && !E.stage.classList.contains('covered');
    const magnified = AT.art.audit().filter((a) => a.kBitmap < a.kDisplay / 1.01).map((a) => a.id);
    window.__samples.push({ t: performance.now(), visible, magnified, pill: !!document.getElementById('repaint'), paused: !!E.paused });
    if (!performance.getEntriesByName('at:refit').length) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}
const refitMarks = () => ({
  samples: window.__samples,
  jobs: window.__jobs1 - window.__jobs0,
  keys: window.__keys,
  marks: Object.fromEntries(performance.getEntriesByType('mark').filter((m) => m.name.startsWith('at:refit')).map((m) => [m.name, m.startTime])),
});

async function resizeLive(page, tuning) {
  if (tuning) await page.addInitScript((t) => { window.__AT_RASTER_TUNING = t; }, tuning);
  await prepare(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => performance.getEntriesByName('at:shown:title').length > 0, null, { timeout: 60_000 });
  await page.evaluate(startSampler);
  await page.setViewportSize({ width: 1200, height: 675 }); // 1.5x: every bitmap would be magnified
  await page.waitForFunction(() => performance.getEntriesByName('at:refit').length > 0, null, { timeout: 90_000 });
  const r = await page.evaluate(refitMarks);
  const bad = r.samples.filter((s) => s.visible && s.magnified.length);
  expect(bad, 'frames showing the stage with a magnified bitmap').toEqual([]);
  // the clock runs again, and every bitmap is at its new scale
  const t0 = await page.evaluate(() => AT.engine.time);
  await expect.poll(() => page.evaluate(() => AT.engine.time), { timeout: 20_000 }).toBeGreaterThan(t0 + 0.05);
  expect(await page.evaluate(() => { const im = document.querySelector('#world img[data-sprite="bg_garden"]'); return +im.dataset.k === AT.art.kOf(im); })).toBe(true);
  return r;
}

test('a live resize never shows a magnified bitmap (real clock)', async ({ page }) => {
  const r = await resizeLive(page);
  // the cover went up at once (in the frame of the resize), not after the debounce
  expect(r.marks['at:refit:cover'], 'covered').toBeGreaterThan(0);
  const after = r.samples.filter((s) => s.t >= r.marks['at:refit:cover']);
  expect(after.length).toBeGreaterThan(0);
  expect(after[0].visible, 'first frame after the resize is covered').toBe(false);
  // each bitmap for the new scale painted once: nothing for in-between scales (the clock and the
  // resolution policy wait for the refit, and requests for the old scale are dropped)
  expect(r.jobs, `bitmaps painted for the resize (the stage shows ${r.keys})`).toBeLessThanOrEqual(r.keys);
  test.info().annotations.push({ type: 'refit', description: `cover ${Math.round(r.marks['at:refit:cover'])} ms, done ${Math.round(r.marks['at:refit'])} ms, ${r.samples.length} frames sampled, ${r.jobs} bitmaps painted for ${r.keys} shown` });
});

test('a slow resize repaint shows the still scene with a progress pill instead of a long blank cover (real clock)', async ({ page }) => {
  // (a zero blank-cover allowance forces the path a cold 4K repaint takes)
  const r = await resizeLive(page, { refitCoverMs: 0 });
  expect(r.marks['at:refit:preview'], 'still preview shown').toBeGreaterThan(0);
  const shown = r.samples.filter((s) => s.visible && s.t > r.marks['at:refit:preview'] && s.t < r.marks['at:refit']);
  expect(shown.length, 'frames with the stage visible during the repaint').toBeGreaterThan(0);
  // while the scene is shown during the repaint the clock stands still and the pill is up
  const during = r.samples.filter((s) => s.visible && s.paused);
  expect(during.length).toBeGreaterThan(0);
  expect(during.every((s) => s.pill), 'progress pill shown while paused and visible').toBe(true);
  expect(await page.evaluate(() => !!document.getElementById('repaint')), 'pill removed afterwards').toBe(false);
});

test('a squeezed bitmap cache evicts old bitmaps, never one in use', async ({ page }) => {
  const BUDGET = 2 * 1048576; // decoded bytes; one 800x450 scene needs several times that
  await page.addInitScript((b) => {
    window.__AT_RASTER_TUNING = { budgetBytes: b };
    window.__revoked = new Set();
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (u) => { window.__revoked.add(u); revoke(u); };
  }, BUDGET);
  await prepare(page);
  await openGame(page, { scene: 'potty' });
  await waitShown(page, 'potty');
  await step(page, 2, 10);
  for (const scene of ['hub', 'teeth']) {
    await page.evaluate((s) => { AT.go(s); }, scene);
    await waitShown(page, scene);
    await step(page, 1.5, 10);
  }
  await settleForScreenshot(page);
  const r = await page.evaluate(() => {
    const st = AT.art.stats();
    const imgs = [...document.querySelectorAll('#stage img[data-sprite]')];
    return {
      st,
      broken: imgs.filter((im) => im.getBoundingClientRect().width > 0 && !(im.complete && im.naturalWidth > 0)).map((im) => im.dataset.sprite),
      revokedInUse: [...document.images].filter((im) => window.__revoked.has(im.getAttribute('src'))).map((im) => im.dataset.sprite || im.src),
      revoked: window.__revoked.size,
    };
  });
  test.info().annotations.push({ type: 'cache', description: JSON.stringify(r.st) });
  expect(r.st.budget).toBe(BUDGET);
  expect(r.st.evicted, 'bitmaps evicted').toBeGreaterThan(0);
  expect(r.revoked).toBeGreaterThanOrEqual(r.st.evicted);
  // within budget, except for the bitmaps the scene is showing (never evicted)
  expect(r.st.decoded).toBeLessThanOrEqual(Math.max(BUDGET, r.st.inUseDecoded));
  expect(r.broken, 'visible sprites not drawn').toEqual([]);
  expect(r.revokedInUse, 'imgs pointing at a revoked bitmap URL').toEqual([]);
});

test('brushing teeth paints no bitmap inside a pointer event, and foam shares a few bitmaps', async ({ page }) => {
  await prepare(page);
  await openGame(page, { scene: 'teeth' });
  const cleaned = (n) => `() => [...document.querySelectorAll('img[data-sprite="tooth_dirt"]')].filter((im) => im.parentNode.style.opacity === '0').length >= ${n}`;
  await autoPlay(page, cleaned(2));
  const before = await page.evaluate(() => AT.art.stats());
  await autoPlay(page, cleaned(12));
  const after = await page.evaluate(() => ({ st: AT.art.stats(), foam: AT.art.cachedScales('foam'), bubble: AT.art.cachedScales('bubble') }));
  test.info().annotations.push({ type: 'foam', description: `sync bakes ${before.syncJobs} -> ${after.st.syncJobs}; foam scales ${after.foam.join(' ')}; bubble scales ${after.bubble.join(' ')}` });
  // every foam/bubble bitmap is requested from the brush's pointermove handler: never painted on the spot there
  expect(after.st.syncJobs - before.syncJobs, 'bitmaps painted inside pointer events').toBe(0);
  // random sizes 0.4-0.9 growing 1.3x: a handful of 2^(1/8) steps, not one bitmap per bubble
  expect(after.foam.length).toBeGreaterThan(0);
  expect(after.foam.length).toBeLessThanOrEqual(12);
  expect(after.bubble.length).toBeLessThanOrEqual(12);
});
