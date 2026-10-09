// Every sprite, rendered by the game's own art engine and Node class, compared
// with its baseline at deviceScaleFactor 2 (one test per gallery page; the
// metrics are also computed per sprite so a failure names the culprit).
import { test, expect } from '../helpers/fixtures.mjs';
import { loadGame } from '../helpers/load-game.mjs';
import { expectMatchesBaseline, THRESHOLDS } from '../helpers/visual.mjs';
import { galleryPages } from './gallery-layout.mjs';

const A = loadGame({ only: ['art-'] }).AT.art;
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
    await page.goto(`/tests/visual/gallery.html?page=${p.name}`);
    await page.waitForFunction(() => window.__gallery, null, { timeout: 120_000 });
    const cells = await page.evaluate(() => window.__gallery.cells.map((c) => c.id));
    expect(cells, 'browser and Node agree on the layout').toEqual(p.cells.map((c) => c.id));
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
