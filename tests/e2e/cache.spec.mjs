// Painted sprite bitmaps kept across visits (js/raster-cache.js, IndexedDB): a reload paints
// nothing and shows exactly the same pixels; a browser that refuses IndexedDB still plays; a
// stored bitmap of the wrong size is painted again. At the visual suites' size (1280x720 at 2x),
// in the stepped test mode (?manual=1), so both loads are bit-for-bit comparable.
import { test, expect } from '../helpers/fixtures.mjs';
import { prepare, openGame, step, settleForScreenshot, waitShown, tapStage } from '../helpers/game.mjs';

test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });

async function titleAt2s(page) {
  await openGame(page);
  await step(page, 2, 30);
  expect(await settleForScreenshot(page), 'sprite bitmaps off scale (AT.art.audit)').toEqual([]);
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  return { png, art: await page.evaluate(() => AT.art.stats()), cache: await page.evaluate(() => AT.rasterCache.stats()) };
}

test('a reload paints nothing: every bitmap comes from the cache, and the title is bit-identical', async ({ page }) => {
  await prepare(page, { audio: false });
  const cold = await titleAt2s(page);
  expect(cold.cache.available, 'IndexedDB available').toBe(true);
  expect(cold.art.jobs, 'bitmaps painted on the first visit').toBeGreaterThan(60);
  expect(cold.art.stored).toBe(0);
  await page.evaluate(() => AT.rasterCache.flush());
  expect((await page.evaluate(() => AT.rasterCache.stats())).records).toBeGreaterThanOrEqual(cold.art.jobs);
  const warm = await titleAt2s(page); // (openGame navigates again: a reload in the same profile)
  test.info().annotations.push({ type: 'cache', description: `cold: painted ${cold.art.jobs}; reload: painted ${warm.art.jobs}, from the cache ${warm.art.stored} (${warm.cache.loaded} records read in ${warm.cache.loadMs} ms)` });
  expect(warm.art.jobs, 'bitmaps painted on the reload').toBe(0);
  expect(warm.art.stored, 'bitmaps from the cache').toBeGreaterThanOrEqual(60);
  expect(warm.art.storedBad).toBe(0);
  expect(warm.png.equals(cold.png), 'bit-identical screenshots').toBe(true);
});

test('IndexedDB that throws (sandboxed iframes, some file:// pages): the game paints and plays as usual', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new DOMException('The user denied permission to access the database.', 'SecurityError'); } });
  });
  await prepare(page, { audio: false });
  await openGame(page);
  await waitShown(page, 'title');
  const r = await page.evaluate(() => ({ cache: AT.rasterCache.stats(), art: AT.art.stats() }));
  expect(r.cache.available).toBe(false);
  expect(r.art.jobs).toBeGreaterThan(60);
  await step(page, 1);
  await tapStage(page, 800, 640);
  await waitShown(page, 'hub', { maxClock: 60 });
  expect(await page.evaluate(() => AT.sceneName)).toBe('hub');
  // (the fixture fails the test on any console error)
});

test('a stored bitmap of the wrong size is painted again, and the title looks the same', async ({ page }) => {
  await prepare(page, { audio: false });
  const cold = await titleAt2s(page);
  await page.evaluate(() => AT.rasterCache.flush());
  // replace the stored background with a 10x10 PNG under the same key
  const key = await page.evaluate(async () => {
    const small = await new Promise((resolve) => { const c = document.createElement('canvas'); c.width = c.height = 10; c.toBlob(resolve, 'image/png'); });
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('atticus-raster', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const all = await new Promise((resolve) => { const q = db.transaction('bm').objectStore('bm').getAll(); q.onsuccess = () => resolve(q.result); });
    const rec = all.filter((x) => x.id === 'bg_garden').sort((a, b) => b.k - a.k)[0];
    rec.blob = small;
    await new Promise((resolve) => { const tx = db.transaction('bm', 'readwrite'); tx.objectStore('bm').put(rec); tx.oncomplete = resolve; });
    db.close();
    return rec.key;
  });
  expect(key).toMatch(/^bg_garden\|/);
  const warm = await titleAt2s(page);
  test.info().annotations.push({ type: 'cache', description: `reload: painted ${warm.art.jobs}, from the cache ${warm.art.stored}, wrong size ${warm.art.storedBad}` });
  expect(warm.art.storedBad, 'records found to be the wrong size').toBe(1);
  expect(warm.art.jobs, 'painted again').toBe(1);
  const bg = await page.evaluate(() => { const im = document.querySelector('#world img[data-sprite="bg_garden"]'); return { k: +im.dataset.k, w: im.naturalWidth, h: im.naturalHeight, box: AT.art.box('bg_garden') }; });
  expect(bg.w).toBe(Math.ceil(bg.box[2] * bg.k - 1e-6));
  expect(bg.h).toBe(Math.ceil(bg.box[3] * bg.k - 1e-6));
  expect(warm.png.equals(cold.png), 'bit-identical screenshots').toBe(true);
  // and the record is fixed for next time
  await page.evaluate(() => AT.rasterCache.flush());
  const fixed = await page.evaluate(async (k) => {
    const db = await new Promise((resolve) => { const r = indexedDB.open('atticus-raster', 1); r.onsuccess = () => resolve(r.result); });
    const rec = await new Promise((resolve) => { const q = db.transaction('bm').objectStore('bm').get(k); q.onsuccess = () => resolve(q.result); });
    db.close();
    return rec ? rec.blob.size : 0;
  }, key);
  expect(fixed, 'the background stored again at full size').toBeGreaterThan(100000);
});
