// How the game loads (js/game.js AT.go, js/art-core.js): the cold first visit's still preview,
// and scenes painted behind their entry cover so that nothing is painted during play.
import { test, expect } from '../helpers/fixtures.mjs';
import { prepare, openGame, autoPlay, step, waitShown } from '../helpers/game.mjs';

// Per animation frame from the start: preview state, the clock, and what the stage shows.
function sampler() {
  window.__frames = [];
  const f = () => {
    const E = window.AT && AT.engine;
    if (E && E.stage && performance.getEntriesByName('at:go:title').length) {
      const imgs = [...E.stage.querySelectorAll('img[data-sprite]')].filter((im) => im.offsetParent !== null || im.closest('#hud'));
      const has = (n) => performance.getEntriesByName(n).length > 0;
      window.__frames.push({
        t: performance.now(), time: E.time, paused: !!E.paused, shown: has('at:shown:title'), live: has('at:live:title'),
        pill: !!document.getElementById('repaint'), loading: !!document.getElementById('loading'),
        bitmaps: imgs.filter((im) => im.dataset.k).length, imgs: imgs.length,
        magnified: AT.art.audit().filter((a) => a.kBitmap < a.kDisplay / 1.01).map((a) => a.id),
      });
    }
    if (!(window.AT && performance.getEntriesByName('at:live:title').length && window.__frames.length && window.__frames[window.__frames.length - 1].live && window.__frames.filter((x) => x.live).length > 30)) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}
const marks = (page) => page.evaluate(() => Object.fromEntries(performance.getEntriesByType('mark').filter((m) => m.name.startsWith('at:')).map((m) => [m.name, m.startTime])));

test('a cold first visit shows the still title at once with a progress pill, then animates it with all its bitmaps (real clock)', async ({ page }) => {
  await prepare(page);
  await page.addInitScript(sampler);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__frames && window.__frames.filter((x) => x.live).length > 30, null, { timeout: 60_000 });
  const m = await marks(page);
  const frames = await page.evaluate(() => window.__frames);
  expect(m['at:shown:title']).toBeLessThan(m['at:raster:title']);
  expect(m['at:raster:title']).toBeLessThanOrEqual(m['at:live:title']);
  const preview = frames.filter((x) => x.shown && !x.live);
  expect(preview.length, 'frames of the still preview').toBeGreaterThan(0);
  for (const x of preview) {
    expect(x.loading, 'loading screen gone').toBe(false);
    expect(x.paused, 'the clock stands still').toBe(true);
    expect(x.time).toBe(preview[0].time);
  }
  expect(preview.filter((x) => x.bitmaps === 0).every((x) => x.pill), 'pill up while the sprites are painted').toBe(true);
  // the bitmaps go in all at once: never some sprites as bitmaps and others still as SVG
  const partial = frames.filter((x) => x.bitmaps > 0 && x.bitmaps < x.imgs);
  expect(partial.map((x) => `${x.bitmaps}/${x.imgs}`), 'frames with only some bitmaps in').toEqual([]);
  const live = frames.filter((x) => x.live);
  expect(live[0].bitmaps, 'every sprite a bitmap once live').toBe(live[0].imgs);
  expect(live.every((x) => !x.pill), 'pill gone').toBe(true);
  expect(live[live.length - 1].time, 'the clock runs').toBeGreaterThan(live[0].time);
  expect(frames.filter((x) => x.magnified.length).map((x) => x.magnified), 'magnified bitmaps').toEqual([]);
});

test('a tap during the cold preview starts the game once the title animates (real clock)', async ({ page }) => {
  await page.addInitScript(() => { window.__AT_RASTER_TUNING = { previewMinMs: 2500 }; });
  await prepare(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => performance.getEntriesByName('at:shown:title').length > 0, null, { timeout: 60_000 });
  const before = await page.evaluate(() => ({ live: performance.getEntriesByName('at:live:title').length, time: AT.engine.time, paused: AT.engine.paused }));
  expect(before).toEqual({ live: 0, time: 0, paused: true });
  const box = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.7 }; });
  await page.mouse.click(box.x, box.y);
  await expect.poll(() => page.evaluate(() => AT.audio.ready), { message: 'the tap switched the sound on' }).toBe(true);
  // nothing moves until the bitmaps are in; then the Play button pops and the title carries on
  expect(await page.evaluate(() => ({ time: AT.engine.time, live: performance.getEntriesByName('at:live:title').length }))).toEqual({ time: 0, live: 0 });
  await page.waitForFunction(() => { const im = document.querySelector('#world img[data-sprite="ui_play"]'); return im && im.parentElement.style.display === 'none'; }, null, { timeout: 30_000 });
  const m = await marks(page);
  expect(m['at:live:title']).toBeGreaterThan(m['at:shown:title'] + 2000);
});

test('a resize during the cold preview ends with the title animating at the new size (real clock)', async ({ page }) => {
  await page.addInitScript(() => { window.__AT_RASTER_TUNING = { previewMinMs: 2500 }; });
  await prepare(page);
  await page.addInitScript(sampler);
  await page.goto('/index.html');
  await page.waitForFunction(() => performance.getEntriesByName('at:shown:title').length > 0, null, { timeout: 60_000 });
  expect(await page.evaluate(() => performance.getEntriesByName('at:live:title').length)).toBe(0);
  await page.setViewportSize({ width: 1200, height: 675 }); // 1.5x
  await page.waitForFunction(() => window.__frames.filter((x) => x.live).length > 30, null, { timeout: 90_000 });
  const frames = await page.evaluate(() => window.__frames);
  expect(frames.filter((x) => x.magnified.length).map((x) => x.magnified), 'magnified bitmaps').toEqual([]);
  expect(frames.filter((x) => x.bitmaps > 0 && x.bitmaps < x.imgs).length, 'frames with only some bitmaps in').toBe(0);
  const r = await page.evaluate(() => {
    const bg = document.querySelector('#world img[data-sprite="bg_garden"]');
    return { audit: AT.art.audit(), bg: +bg.dataset.k === AT.art.kOf(bg), svg: [...AT.engine.stage.querySelectorAll('img[data-sprite]')].filter((im) => im.offsetParent !== null && !im.dataset.k).map((im) => im.dataset.sprite), paused: AT.engine.paused };
  });
  expect(r.bg, 'background bitmap at the new scale').toBe(true);
  expect(r.audit, 'bitmaps magnified or off scale (AT.art.audit)').toEqual([]);
  expect(r.svg, 'sprites still shown as SVG').toEqual([]);
  expect(r.paused).toBe(false);
});

test.describe('at the manifest\'s reference size (1280x720 at 2x)', () => {
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  test('teeth: everything up to brushing is painted behind the entry cover, nothing during play', async ({ page }) => {
    await prepare(page, { audio: false });
    await openGame(page, { scene: 'teeth' });
    await waitShown(page, 'teeth');
    const at = await page.evaluate(() => ({ st: AT.art.stats(), keys: AT.art.cachedKeys() }));
    expect(at.keys, 'the mouth close-up painted behind the entry cover').toContain('mouth_face@1.600');
    // the toothpaste card, then the mouth view and brushing until four teeth are clean
    await autoPlay(page, () => [...document.querySelectorAll('img[data-sprite="tooth_dirt"]')].filter((im) => im.parentNode.style.opacity === '0').length >= 4);
    await step(page, 0.5, 10);
    const end = await page.evaluate(() => ({ st: AT.art.stats(), keys: AT.art.cachedKeys() }));
    const painted = end.keys.filter((k) => !at.keys.includes(k));
    expect(painted, 'bitmaps painted during play').toEqual([]);
    expect(end.st.playMisses).toBe(0);
  });
});
