// Every sprite, rendered by the game's own art engine and Node class, compared
// with its baseline at deviceScaleFactor 2 (one test per gallery page; the
// metrics are also computed per sprite so a failure names the culprit). The
// sprites go through the game's bitmap layer (AT.art.fit), so each one's bitmap
// is checked at scale 1, at half scale and at its largest in-game scale against
// baselines recorded from the live SVG images.
import { test, expect } from '../helpers/fixtures.mjs';
import { loadGame } from '../helpers/load-game.mjs';
import { expectMatchesBaseline, THRESHOLDS } from '../helpers/visual.mjs';
import { galleryPages } from './gallery-layout.mjs';

const A = loadGame({ only: ['art-'] }).AT.art;
// AT_RASTER=svg npm run test:visual checks the plain SVG sprites (the kill switch) instead
const RASTER = process.env.AT_RASTER;
const pages = galleryPages(A.list(), A.box);

test('the gallery covers every sprite', () => {
  const shown = new Set(pages.filter((p) => !p.name.startsWith('scaled')).flatMap((p) => p.cells.map((c) => c.id)));
  expect([...A.list()].filter((id) => !shown.has(id))).toEqual([]);
});

for (const p of pages) {
  test(`gallery ${p.name}`, async ({ page }, testInfo) => {
    const dpr = testInfo.project.use.deviceScaleFactor;
    expect(dpr).toBe(2);
    await page.setViewportSize({ width: p.width, height: p.height });
    await page.goto(`/tests/visual/gallery.html?page=${p.name}${RASTER ? `&raster=${RASTER}` : ''}`);
    await page.waitForFunction(() => window.__gallery, null, { timeout: 120_000 });
    const cells = await page.evaluate(() => window.__gallery.cells.map((c) => c.id));
    expect(cells, 'browser and Node agree on the layout').toEqual(p.cells.map((c) => c.id));
    // every sprite is shown through the game's bitmap layer, at its own device scale
    const bm = await page.evaluate(() => ({
      mode: window.__gallery.mode,
      notBitmap: [...document.querySelectorAll('#page img[data-sprite]')]
        .filter((im) => !(im.src.startsWith('blob:') && im.dataset.k && AT.art.shows(im) === im.dataset.sprite && im.getAttribute('src') !== AT.art.url(im.dataset.sprite)))
        .map((im) => im.dataset.sprite),
    }));
    expect(bm.mode).toBe(RASTER || 'bitmap');
    if (bm.mode === 'bitmap') expect(bm.notBitmap, 'sprites still shown as SVG').toEqual([]);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: p.width, height: p.height }, animations: 'disabled' });
    const regions = p.cells.map((c) => ({ name: c.s === 1 ? c.id : `${c.id}@${c.s}`, x: c.x * dpr, y: c.y * dpr, w: c.w * dpr, h: c.h * dpr }));
    // The half-scale backgrounds (stage-*) are shown at a density the game never
    // uses; a 2x bitmap cache downsampled 2:1 there dips to ~0.67 on sparse
    // tiles without visible change. Their in-game density is checked by the
    // scene frames, so only the per-tile sharpness floor is relaxed here.
    const thresholds = p.name.startsWith('stage') ? { tile: { ...THRESHOLDS.tile, sharpMin: 0.6 } } : undefined;
    await expectMatchesBaseline(testInfo, `gallery-${p.name}`, png, { regions, thresholds });
  });
}
