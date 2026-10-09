// Painted sprite bitmaps kept across visits (js/raster-cache.js, IndexedDB): a reload paints
// nothing and shows exactly the same pixels, also when the game wrote the store by itself (idle
// time after a scene has faded in); an edited drawing is painted again, never served stale; a
// browser that refuses IndexedDB still plays and keeps nothing for it; a stored bitmap of the
// wrong size, or a record that is not a bitmap at all, is painted again; where the boot probe
// finds off-thread painting inexact, nothing painted that way is kept or stored. At the visual
// suites' size (1280x720 at 2x), in the stepped test mode (?manual=1), so loads are bit-for-bit
// comparable.
import fs from 'node:fs';
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
  expect(cold.art.asyncStored, 'bitmaps painted off the main thread and stored').toBeGreaterThan(0);
  await page.evaluate(() => AT.rasterCache.flush());
  const written = await page.evaluate(() => AT.rasterCache.stats());
  expect(written.records).toBeGreaterThanOrEqual(cold.art.jobs);
  expect(written.heldBytes, 'PNG bytes still held in memory once written').toBe(0);
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
  await step(page, 2);
  expect(await page.evaluate(() => AT.sceneName)).toBe('hub');
  // nowhere to write them, so nothing is kept for it: the PNGs live only in the bitmap layer's own
  // cache, within its memory budget
  const c = await page.evaluate(() => AT.rasterCache.stats());
  expect(c.refused, 'bitmaps offered to the store').toBeGreaterThan(60);
  expect({ records: c.records, bytes: c.bytes, held: c.held, heldBytes: c.heldBytes, pending: c.pending }).toEqual({ records: 0, bytes: 0, held: 0, heldBytes: 0, pending: 0 });
  // (the fixture fails the test on any console error)
});

test('a reload after the game stored its bitmaps by itself (idle time after the title faded in) paints nothing', async ({ page }) => {
  await prepare(page, { audio: false });
  const cold = await titleAt2s(page);
  // no flush by hand: the writes the game makes when idle after a scene has faded in
  await expect.poll(() => page.evaluate(() => { const c = AT.rasterCache.stats(); return c.writes > 0 && !c.busy; }), { timeout: 20_000, message: 'the game wrote the store when idle' }).toBe(true);
  const c = await page.evaluate(() => AT.rasterCache.stats());
  expect(c.writes).toBeGreaterThanOrEqual(cold.art.jobs);
  expect(c.heldBytes).toBe(0);
  const warm = await titleAt2s(page);
  expect(warm.art.jobs, 'bitmaps painted on the reload').toBe(0);
  expect(warm.art.stored, 'bitmaps from the cache').toBeGreaterThanOrEqual(60);
  expect(warm.png.equals(cold.png), 'bit-identical screenshots').toBe(true);
});

// js/art-characters.js with Mama's top in another colour (an edited drawing: AT.palette)
const EDIT = { from: "mamaTop: '#9a6ad0'", to: "mamaTop: '#2f9a4c'" };
async function editPalette(page) {
  const file = fs.readFileSync(new URL('../../js/art-characters.js', import.meta.url), 'utf8');
  expect(file).toContain(EDIT.from);
  await page.route('**/js/art-characters.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: file.replace(EDIT.from, EDIT.to) }));
}

test('an edited drawing is painted again on the next visit, never taken stale from the cache', async ({ page, browser }) => {
  await prepare(page, { audio: false });
  const cold = await titleAt2s(page);
  await page.evaluate(() => AT.rasterCache.flush());
  // the same profile, with Mama's top changed
  await editPalette(page);
  const edited = await titleAt2s(page);
  test.info().annotations.push({ type: 'cache', description: `edited reload: painted ${edited.art.jobs}, from the cache ${edited.art.stored}` });
  expect(edited.art.jobs, 'the edited sprites painted again').toBeGreaterThanOrEqual(1);
  expect(edited.art.stored, 'the others from the cache').toBeGreaterThanOrEqual(50);
  expect(edited.png.equals(cold.png), 'the edit shows').toBe(false);
  // exactly what a fresh profile paints from the edited drawing
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  try {
    const fresh = await ctx.newPage();
    const errors = [];
    fresh.on('pageerror', (e) => errors.push(e.message));
    fresh.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await prepare(fresh, { audio: false });
    await editPalette(fresh);
    const f = await titleAt2s(fresh);
    expect(f.art.stored, 'a fresh profile has nothing stored').toBe(0);
    expect(errors).toEqual([]);
    expect(edited.png.equals(f.png), 'the edited reload is bit-identical to a fresh profile').toBe(true);
  } finally {
    await ctx.close();
  }
});

test('where the boot probe finds off-thread painting inexact, nothing painted that way is shown or stored', async ({ page }) => {
  // The probe paints a small drawing both ways and compares the bytes: here one byte of its
  // off-thread copy is flipped, and that copy arrives late (so painting is well under way, and
  // the big off-thread jobs started before the answer finish after it).
  await page.addInitScript(() => {
    const read = CanvasRenderingContext2D.prototype.getImageData;
    let n = 0;
    CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h, ...rest) {
      const d = read.call(this, x, y, w, h, ...rest);
      if (w === 90 && h === 66 && ++n === 2) d.data[4 * (33 * 90 + 45)] ^= 1;
      return d;
    };
    const cib = window.createImageBitmap;
    let late = false;
    window.createImageBitmap = function (src, ...rest) {
      const p = cib.call(this, src, ...rest);
      if (!late && src && src.naturalWidth === 90 && src.naturalHeight === 66) { late = true; return p.then((bm) => new Promise((r) => setTimeout(() => r(bm), 600))); }
      return p;
    };
  });
  await prepare(page, { audio: false });
  const cold = await titleAt2s(page);
  const a = cold.art;
  test.info().annotations.push({ type: 'probe', description: `off-thread jobs finished ${a.asyncJobs}, kept ${a.asyncKept}, painted again here ${a.asyncFallbacks}; painted in all ${a.jobs}` });
  expect(a.asyncJobs, 'off-thread jobs under way before the probe answered').toBeGreaterThan(0);
  expect(a.asyncKept, 'off-thread bitmaps kept').toBe(0);
  expect(a.asyncFallbacks, 'every off-thread one painted again on the page\'s thread').toBeGreaterThanOrEqual(a.asyncJobs);
  expect(a.asyncStored, 'off-thread bitmaps stored').toBe(0);
  await page.evaluate(() => AT.rasterCache.flush());
  expect((await page.evaluate(() => AT.rasterCache.stats())).records, 'the ones painted on the page\'s thread are stored').toBeGreaterThan(60);
});

test('a stored record that is not a bitmap (foreign or corrupt data) is ignored, deleted and painted again', async ({ page }) => {
  await prepare(page, { audio: false });
  const cold = await titleAt2s(page);
  await page.evaluate(() => AT.rasterCache.flush());
  // the background's record gets an ArrayBuffer for a blob, the sun's a Blob that is not a PNG
  const keys = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('atticus-raster', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const all = await new Promise((resolve) => { const q = db.transaction('bm').objectStore('bm').getAll(); q.onsuccess = () => resolve(q.result); });
    const bg = all.filter((x) => x.id === 'bg_garden').sort((a, b) => b.k - a.k)[0];
    const sun = all.filter((x) => x.id === 'sun').sort((a, b) => b.k - a.k)[0];
    bg.blob = await bg.blob.arrayBuffer();
    sun.blob = new Blob(['not a png'], { type: 'image/png' });
    await new Promise((resolve) => { const tx = db.transaction('bm', 'readwrite'); tx.objectStore('bm').put(bg); tx.objectStore('bm').put(sun); tx.oncomplete = resolve; });
    db.close();
    return [bg.key, sun.key];
  });
  const warm = await titleAt2s(page);
  test.info().annotations.push({ type: 'cache', description: `reload: painted ${warm.art.jobs}, from the cache ${warm.art.stored}, unreadable ${warm.art.storedBad}, ignored ${warm.cache.ignored}` });
  expect(warm.cache.ignored, 'records that are not a bitmap').toBe(1);
  expect(warm.art.storedBad, 'records that do not decode').toBe(1);
  expect(warm.art.jobs, 'both painted again').toBe(2);
  expect(warm.png.equals(cold.png), 'bit-identical screenshots').toBe(true);
  // both fixed for next time
  await page.evaluate(() => AT.rasterCache.flush());
  const fixed = await page.evaluate(async (ks) => {
    const db = await new Promise((resolve) => { const r = indexedDB.open('atticus-raster', 1); r.onsuccess = () => resolve(r.result); });
    const recs = await Promise.all(ks.map((k) => new Promise((resolve) => { const q = db.transaction('bm').objectStore('bm').get(k); q.onsuccess = () => resolve(q.result); })));
    db.close();
    return recs.map((r) => (r && r.blob instanceof Blob ? r.blob.size : 0));
  }, keys);
  expect(fixed[0], 'the background stored again').toBeGreaterThan(100000);
  expect(fixed[1], 'the sun stored again').toBeGreaterThan(1000);
  const again = await titleAt2s(page);
  expect(again.art.jobs, 'nothing painted on the next visit').toBe(0);
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
