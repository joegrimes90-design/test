// Each activity can be played start to finish by the auto-player, and ends
// back at the hub with its sticker earned.
import { test, expect } from '../helpers/fixtures.mjs';
import { prepare, openGame, autoPlay, waitShown } from '../helpers/game.mjs';

for (const activity of ['potty', 'teeth', 'baby']) {
  test(`${activity} can be played to completion`, async ({ page }) => {
    await prepare(page);
    await openGame(page, { scene: activity });
    await waitShown(page, activity);
    expect(await page.evaluate(() => AT.progress)).toMatchObject({ potty: false, teeth: false, baby: false });

    const res = await autoPlay(page, `() => AT.sceneName === 'hub' && AT.progress.${activity} === true`);
    test.info().annotations.push({ type: 'auto-play', description: `${res.actions} actions, ${res.time.toFixed(0)} s of game clock: ${res.log.join(' ')}` });

    await waitShown(page, 'hub');
    const state = await page.evaluate(() => ({ scene: AT.sceneName, progress: AT.progress, saved: JSON.parse(localStorage.getItem('atticus-progress-v1')) }));
    expect(state.scene).toBe('hub');
    expect(state.progress[activity]).toBe(true);
    expect(state.saved[activity]).toBe(true);
    // the other stickers are untouched
    for (const other of ['potty', 'teeth', 'baby'].filter((k) => k !== activity)) expect(state.progress[other]).toBe(false);
    // sprite bitmaps stayed within their memory budget (decoded bytes; tests/e2e/bitmaps.spec.mjs
    // squeezes the budget to check that eviction works)
    const mem = await page.evaluate(() => AT.art.stats());
    expect(mem.decoded, `decoded bytes of ${mem.cached} cached bitmaps`).toBeLessThanOrEqual(Math.max(mem.budget, mem.inUseDecoded));
  });
}
