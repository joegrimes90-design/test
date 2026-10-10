// How the game loads (js/game.js AT.go, js/art-core.js): the cold first visit's still preview,
// and scenes painted ahead (behind their entry cover, from js/sprite-manifest.js) so that nothing
// is painted during play: at the manifest's reference size and at sizes where the stage scale
// rounds differently (1194x834 and 1180x820 at 2x).
import { test, expect } from '../helpers/fixtures.mjs';
import { prepare, openGame, autoPlay, step, stepUntil, waitShown, reveal } from '../helpers/game.mjs';

const ALL_DONE = { potty: true, teeth: true, baby: true, party: true, visits: 3 };
const setProgress = (page, p) => page.addInitScript((p) => localStorage.setItem('atticus-progress-v1', JSON.stringify(p)), p);
// ?debug=1 names each bitmap painted during play (a console warning): collected for the messages
function paintedInPlay(page) {
  const keys = [];
  page.on('console', (m) => { const t = m.text(); if (t.startsWith('[AT.art] painted during play:')) keys.push(t.slice(30).trim()); });
  return keys;
}
const artStats = (page) => page.evaluate(() => AT.art.stats());
// Sprites cached at two keys a rounding step apart (k and k + 0.001: the same scale painted twice,
// because the manifest's key and the sprite's own rounded apart).
function twice(keys) {
  const by = {};
  for (const k of keys) { const [id, s] = k.split('@'); (by[id] = by[id] || []).push(+s); }
  const out = [];
  for (const [id, ss] of Object.entries(by)) { ss.sort((a, b) => a - b); for (let i = 1; i < ss.length; i++) if (ss[i] / ss[i - 1] - 1 < 0.0012) out.push(`${id}@${ss[i - 1]}/${ss[i]}`); }
  return out;
}
// Potty's three rounds (the choice bubble's potty at s 0.6) and the hand-washing close-up, then the
// sticker flying to the hub's chart.
async function playPotty(page) {
  const missed = paintedInPlay(page);
  await prepare(page, { audio: false });
  await openGame(page, { scene: 'potty', query: { debug: '1' } });
  await waitShown(page, 'potty');
  const shownKeys = await page.evaluate(() => AT.art.cachedKeys());
  const res = await autoPlay(page, () => AT.sceneName === 'hub' && performance.getEntriesByName('at:shown:hub').length > 0, { exactRubs: true });
  await step(page, 8, 10); // the new sticker flies to the chart
  const st = await artStats(page);
  test.info().annotations.push({ type: 'play', description: `${res.actions} actions; painted during play: ${st.playMisses} (${missed.join(', ')}), random sizes ${st.playRandom}` });
  return { res, missed, st, shownKeys };
}
// Baby to the end (the thought bubbles' bottle and teddy at s 0.6), then the party's award and balloons.
async function playBabyParty(page) {
  const missed = paintedInPlay(page);
  await setProgress(page, { potty: true, teeth: true, baby: false, party: false, visits: 2 });
  await prepare(page, { audio: false });
  await openGame(page, { scene: 'baby', query: { debug: '1' } });
  await waitShown(page, 'baby');
  const shownKeys = await page.evaluate(() => AT.art.cachedKeys());
  await autoPlay(page, () => AT.sceneName === 'party' && performance.getEntriesByName('at:shown:party').length > 0, { exactRubs: true });
  // the award, then balloons rising (random sizes: painted when they appear, never listed)
  await stepUntil(page, () => !!document.querySelector('#ui img[data-sprite="trophy"]'), { maxClock: 30 });
  await step(page, 20, 10);
  const st = await artStats(page);
  test.info().annotations.push({ type: 'play', description: `painted during play: ${st.playMisses} (${missed.join(', ')}), random sizes ${st.playRandom}` });
  return { missed, st, shownKeys };
}

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

  test('potty: three rounds and the hand-washing close-up, then the sticker on the hub: nothing painted during play', async ({ page }) => {
    const { res, missed, st } = await playPotty(page);
    expect(res.log.some((a) => a.includes('soap')), 'reached the hand-washing close-up').toBe(true);
    expect(missed, 'bitmaps painted during play (not in the manifest)').toEqual([]);
    expect(st.playMisses).toBe(0);
  });

  test('baby to the end, then the party: nothing painted during play but random sizes', async ({ page }) => {
    const { missed, st } = await playBabyParty(page);
    expect(missed, 'bitmaps painted during play (not in the manifest)').toEqual([]);
    expect(st.playMisses).toBe(0);
  });

  test('a tapped room bumps up with its bitmaps painted ahead (no SVG, nothing painted at the tap)', async ({ page }) => {
    const missed = paintedInPlay(page);
    await setProgress(page, ALL_DONE);
    await prepare(page, { audio: false });
    for (const room of ['teeth', 'baby', 'potty', 'tv']) {
      await openGame(page, { scene: 'hub', query: { debug: '1' } });
      await waitShown(page, 'hub');
      await step(page, 1, 10);
      const before = await page.evaluate(() => AT.art.cachedKeys());
      await reveal(page);
      const p = await page.evaluate((r) => {
        const hit = document.querySelector(`#world img[data-sprite="room_${r}"]`).parentNode.querySelector(':scope > .hit.on');
        const b = hit.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }, room);
      // what the room and its furniture show at the tap, and while it bumps up and back
      await page.evaluate((r) => {
        const el = document.querySelector(`#world img[data-sprite="room_${r}"]`).parentNode;
        window.__svgAtTap = [];
        const look = () => { for (const im of el.querySelectorAll('img[data-sprite]')) if (im.offsetParent !== null && !im.dataset.k) window.__svgAtTap.push(im.dataset.sprite); };
        el.addEventListener('pointerup', () => queueMicrotask(look), { once: true });
        window.__lookSvg = look;
      }, room);
      await page.mouse.click(p.x, p.y);
      for (let i = 0; i < 6; i++) { await step(page, 0.05, 20); await page.evaluate(() => window.__lookSvg()); }
      const r = await page.evaluate((b) => ({ st: AT.art.stats(), painted: AT.art.cachedKeys().filter((k) => !b.includes(k)), svg: [...new Set(window.__svgAtTap)], scene: AT.sceneName }), before);
      expect(r.scene, `${room}: still in the hub`).toBe('hub');
      expect(r.painted, `${room}: bitmaps painted at the tap`).toEqual([]);
      expect(r.svg, `${room}: sprites shown as SVG while the room bumps`).toEqual([]);
      expect(r.st.playMisses, `${room}: ${missed.join(', ')}`).toBe(0);
    }
  });
});

// Where the stage scale is not a round number (iPad 11" at 1194x834: 0.74625), the sprites' own
// scales (from the stage's DOMMatrix, single precision) and the manifest's must round to the same
// bitmap keys, or everything is painted twice and the close-ups during play. Below scale 1 as well:
// at 1194x834 the thought bubbles' icons (s 0.6) come out at 0.8955000 (key 0.896), not 0.895.
for (const vp of [{ width: 1194, height: 834 }, { width: 1180, height: 820 }]) {
  test.describe(`at ${vp.width}x${vp.height} at 2x`, () => {
    test.use({ viewport: vp, deviceScaleFactor: 2 });
    test('teeth: the manifest\'s keys are the sprites\' keys, and nothing is painted during play, close-up included', async ({ page }) => {
      const missed = paintedInPlay(page);
      await prepare(page, { audio: false });
      await openGame(page, { scene: 'teeth', query: { debug: '1' } });
      await waitShown(page, 'teeth');
      const at = await page.evaluate(() => {
        const keys = AT.art.cachedKeys();
        // the background at rest: its own key is the one the manifest lists
        const bg = document.querySelector('#world img[data-sprite="bg_bathroom"]');
        const listed = AT.art.sceneList('teeth').filter(([id]) => id === 'bg_bathroom').map(([, k]) => k);
        return { keys, bgK: AT.art.kOf(bg), listed };
      });
      expect(at.listed, 'the manifest\'s background key').toContain(at.bgK);
      expect(twice(at.keys), 'sprites painted at two keys a rounding step apart').toEqual([]);
      await autoPlay(page, () => [...document.querySelectorAll('img[data-sprite="tooth_dirt"]')].filter((im) => im.parentNode.style.opacity === '0').length >= 4);
      await step(page, 0.5, 10);
      const end = await page.evaluate(() => ({ st: AT.art.stats(), keys: AT.art.cachedKeys() }));
      expect(end.keys.filter((k) => !at.keys.includes(k)), 'bitmaps painted during play').toEqual([]);
      expect(missed).toEqual([]);
      expect(end.st.playMisses).toBe(0);
      expect(twice(end.keys), 'sprites painted at two keys a rounding step apart').toEqual([]);
    });

    if (vp.width === 1194) {
      test('potty: the choice bubble\'s potty (s 0.6) at its own key, nothing painted during play or twice', async ({ page }) => {
        const { res, missed, st, shownKeys } = await playPotty(page);
        expect(res.log.some((a) => a.includes('soap')), 'reached the hand-washing close-up').toBe(true);
        expect(twice(shownKeys), 'sprites painted at two keys a rounding step apart (behind the cover)').toEqual([]);
        expect(missed, 'bitmaps painted during play (not in the manifest)').toEqual([]);
        expect(st.playMisses).toBe(0);
        expect(twice(await page.evaluate(() => AT.art.cachedKeys())), 'sprites painted at two keys a rounding step apart').toEqual([]);
        expect(await page.evaluate(() => AT.art.sceneList('potty').filter(([id]) => id === 'potty').map(([, k]) => k)), 'the bubble\'s potty listed at its own key').toContain(0.896);
      });

      test('baby then the party: the thought bubbles\' icons (s 0.6) at their own keys, nothing painted during play or twice', async ({ page }) => {
        const { missed, st, shownKeys } = await playBabyParty(page);
        expect(twice(shownKeys), 'sprites painted at two keys a rounding step apart (behind the cover)').toEqual([]);
        expect(missed, 'bitmaps painted during play (not in the manifest)').toEqual([]);
        expect(st.playMisses).toBe(0);
        expect(twice(await page.evaluate(() => AT.art.cachedKeys())), 'sprites painted at two keys a rounding step apart').toEqual([]);
      });
    }

    test('the bathroom painted in idle time in the hub is the one potty shows (real clock)', async ({ page }) => {
      await prepare(page, { audio: false });
      await page.goto('/index.html?scene=hub');
      await page.waitForFunction(() => performance.getEntriesByName('at:live:hub').length > 0, null, { timeout: 90_000 });
      // idle prefetch: first the big backgrounds two of the next scenes share (the bathroom)
      await page.waitForFunction(() => AT.art.cachedScales('bg_bathroom').length > 0, null, { timeout: 60_000 });
      const pre = await page.evaluate(() => AT.art.cachedScales('bg_bathroom'));
      await page.evaluate(() => AT.go('potty'));
      await page.waitForFunction(() => performance.getEntriesByName('at:shown:potty').length > 0, null, { timeout: 90_000 });
      const r = await page.evaluate(() => {
        const bg = document.querySelector('#world img[data-sprite="bg_bathroom"]');
        return { shows: +bg.dataset.k, k: AT.art.kOf(bg), scales: AT.art.cachedScales('bg_bathroom') };
      });
      expect(pre.length).toBe(1);
      expect(r.shows, 'potty shows the bathroom painted in the hub').toBe(pre[0]);
      expect(r.scales, 'painted once').toEqual(pre);
    });
  });
}
