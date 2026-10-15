// Boot, navigation, HUD and the non-activity scenes.
import { test, expect } from '../helpers/fixtures.mjs';
import { prepare, openGame, stepUntil, step, waitShown, tapStage, tapElement, autoPlay, reveal } from '../helpers/game.mjs';

const ALL_DONE = { potty: true, teeth: true, baby: true, party: true, visits: 3 };
const setProgress = (page, p) => page.addInitScript((p) => localStorage.setItem('atticus-progress-v1', JSON.stringify(p)), p);

test('boots to the animated title screen with no errors (real clock)', async ({ page }) => {
  await prepare(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => performance.getEntriesByName('at:shown:title').length > 0, null, { timeout: 60_000 });
  const info = await page.evaluate(() => {
    const t = (n) => performance.getEntriesByName(n)[0]?.startTime;
    return {
      loading: !!document.getElementById('loading'),
      marks: ['at:boot', 'at:warm', 'at:go:title', 'at:built:title', 'at:shown:title'].map(t),
      sprites: [...document.querySelectorAll('#world img')].map((i) => i.dataset.sprite),
      letters: document.querySelectorAll('.title-letter').length,
      hud: [...document.querySelectorAll('#hud .hudbtn')].map((b) => b.id),
      fade: getComputedStyle(document.getElementById('fade')).opacity,
      scene: AT.sceneName,
    };
  });
  expect(info.loading, 'loading screen removed').toBe(false);
  for (let i = 1; i < info.marks.length; i++) expect(info.marks[i], 'milestones in order').toBeGreaterThanOrEqual(info.marks[i - 1]);
  expect(info.scene).toBe('title');
  expect(info.sprites).toEqual(expect.arrayContaining(['bg_garden', 'house_ext', 'fg_hedge', 'ui_play', 'at_head', 'mm_head', 'dd_head', 'bb_head']));
  expect(info.letters).toBe("Atticus's Big Day!".replace(/ /g, '').length);
  expect(info.hud).toEqual(expect.arrayContaining(['btn-home', 'btn-sound']));
  expect(+info.fade).toBe(0);
  // the requestAnimationFrame clock is running (once the title's bitmaps are in: at:live:title)
  const t0 = await page.evaluate(() => AT.engine.time);
  await expect.poll(() => page.evaluate(() => AT.engine.time), { timeout: 20_000 }).toBeGreaterThan(t0 + 0.05);
  expect(await page.evaluate(() => performance.getEntriesByName('at:live:title').length)).toBe(1);
});

test('resizing repaints the sprites for the new size behind a short cover (real clock)', async ({ page }) => {
  await prepare(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => performance.getEntriesByName('at:live:title').length > 0, null, { timeout: 60_000 });
  const bg = () => page.evaluate(() => { const im = document.querySelector('#world img[data-sprite="bg_garden"]'); return { k: +im.dataset.k, kd: AT.art.kOf(im) }; });
  const before = await bg();
  expect(before.k).toBe(before.kd);
  await page.setViewportSize({ width: 1200, height: 675 });
  await page.waitForFunction(() => performance.getEntriesByName('at:refit').length > 0, null, { timeout: 60_000 });
  const after = await page.evaluate(() => ({
    covered: performance.getEntriesByName('at:refit:cover').length, paused: AT.engine.paused,
    fade: getComputedStyle(AT.engine.fade).opacity, hidden: AT.engine.stage.classList.contains('covered'),
  }));
  expect(after).toEqual({ covered: 1, paused: false, fade: '0', hidden: false });
  const now = await bg();
  expect(now.kd).toBeCloseTo(before.kd * 1.5, 2);
  expect(now.k, 'background bitmap at the new scale').toBe(now.kd);
  // and the clock runs again
  const t0 = await page.evaluate(() => AT.engine.time);
  await expect.poll(() => page.evaluate(() => AT.engine.time), { timeout: 20_000 }).toBeGreaterThan(t0 + 0.05);
});

test('tapping the title starts the game and reaches the hub', async ({ page }) => {
  await prepare(page);
  await openGame(page);
  await waitShown(page, 'title');
  await step(page, 1);
  expect(await page.evaluate(() => AT.sceneName)).toBe('title');
  await tapStage(page, 800, 640);
  await waitShown(page, 'hub', { maxClock: 60 });
  const s = await page.evaluate(() => ({
    scene: AT.sceneName, visits: AT.progress.visits, saved: JSON.parse(localStorage.getItem('atticus-progress-v1')),
    rooms: ['room_potty', 'room_teeth', 'room_baby', 'room_tv'].map((r) => !!document.querySelector(`#world img[data-sprite="${r}"]`)),
    audio: AT.audio.ready,
  }));
  expect(s.scene).toBe('hub');
  expect(s.visits).toBe(1);
  expect(s.saved.visits).toBe(1);
  expect(s.rooms).toEqual([true, true, true, true]);
  expect(s.audio, 'the first tap switches the sound on').toBe(true);
});

test('hub rooms open their activities', async ({ page }) => {
  await prepare(page);
  await openGame(page, { scene: 'hub' });
  await waitShown(page, 'hub');
  // room_teeth sits at the top-left of the dolls house
  const rect = await page.evaluate(() => {
    const r = document.querySelector('#world img[data-sprite="room_teeth"]').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await reveal(page);
  await page.mouse.click(rect.x, rect.y);
  await waitShown(page, 'teeth', { maxClock: 30 });
  expect(await page.evaluate(() => AT.sceneName)).toBe('teeth');
});

test('Home button goes back to the hub, and from the hub to the title', async ({ page }) => {
  await prepare(page);
  await openGame(page, { scene: 'potty' });
  await waitShown(page, 'potty');
  await step(page, 2);
  await tapElement(page, '#btn-home');
  await waitShown(page, 'hub', { maxClock: 20 });
  expect(await page.evaluate(() => AT.sceneName)).toBe('hub');
  expect(await page.evaluate(() => AT.progress.potty), 'leaving early earns nothing').toBe(false);
  await tapElement(page, '#btn-home');
  await waitShown(page, 'title', { maxClock: 20 });
  expect(await page.evaluate(() => AT.sceneName)).toBe('title');
});

test('a Home tap while a scene is still fading in is not lost: the hub follows', async ({ page }) => {
  await prepare(page);
  await openGame(page, { scene: 'hub' });
  await waitShown(page, 'hub');
  await page.evaluate(() => { AT.go('potty'); });
  await stepUntil(page, () => performance.getEntriesByName('at:built:potty').length > 0, { maxClock: 20 });
  expect(await page.evaluate(() => performance.getEntriesByName('at:shown:potty').length), 'potty still fading in').toBe(0);
  await tapElement(page, '#btn-home');
  await waitShown(page, 'potty', { maxClock: 5 });
  await stepUntil(page, () => performance.getEntriesByName('at:shown:hub').length >= 2, { maxClock: 20 });
  expect(await page.evaluate(() => AT.sceneName)).toBe('hub');
  expect(await page.evaluate(() => AT.progress.potty)).toBe(false);
});

test('sound toggle persists across reloads', async ({ page }) => {
  await prepare(page);
  await openGame(page);
  await waitShown(page, 'title');
  expect(await page.evaluate(() => [AT.audio.muted, localStorage.getItem('atticus-muted')])).toEqual([false, null]);
  await tapElement(page, '#btn-sound');
  const after = await page.evaluate(() => ({
    muted: AT.audio.muted, stored: localStorage.getItem('atticus-muted'),
    icon: AT.art.shows(document.querySelector('#btn-sound img')) === 'ui_mute',
  }));
  expect(after).toEqual({ muted: true, stored: '1', icon: true });
  await step(page, 1);
  expect(await page.evaluate(() => AT.sceneName), 'HUD taps do not start the game').toBe('title');

  await page.reload();
  await page.waitForFunction(() => performance.getEntriesByName('at:built:title').length > 0);
  expect(await page.evaluate(() => [AT.audio.muted, document.querySelector('#btn-sound img').dataset.sprite])).toEqual([true, 'ui_mute']);
  await tapElement(page, '#btn-sound');
  expect(await page.evaluate(() => [AT.audio.muted, localStorage.getItem('atticus-muted')])).toEqual([false, '0']);
});

test('"New day" resets progress', async ({ page }) => {
  await prepare(page);
  await setProgress(page, ALL_DONE);
  await openGame(page, { scene: 'hub' });
  await waitShown(page, 'hub');
  expect(await page.evaluate(() => AT.allDone())).toBe(true);
  // the "New day" sun is the only sun with a tap area
  const p = await page.evaluate(() => {
    const hit = [...document.querySelectorAll('#world img[data-sprite="sun"]')].map((im) => im.parentNode.querySelector(':scope > .hit.on')).find(Boolean);
    const r = hit.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await reveal(page);
  await page.mouse.click(p.x, p.y);
  await stepUntil(page, () => performance.getEntriesByName('at:shown:hub').length >= 2, { maxClock: 20 });
  const s = await page.evaluate(() => ({ progress: AT.progress, saved: JSON.parse(localStorage.getItem('atticus-progress-v1')), resetBtn: [...document.querySelectorAll('#world img[data-sprite="sun"]')].length }));
  expect(s.progress).toEqual({ potty: false, teeth: false, baby: false, party: false, visits: 1 });
  expect(s.saved).toEqual(s.progress);
  expect(s.resetBtn, 'no "New day" button until everything is done again').toBe(1);
});

test('earning the last sticker starts the party', async ({ page }) => {
  await prepare(page);
  await setProgress(page, { potty: true, teeth: true, baby: false, party: false, visits: 2 });
  await openGame(page, { scene: 'baby' });
  await waitShown(page, 'baby');
  await autoPlay(page, () => AT.sceneName === 'party');
  await waitShown(page, 'party');
  expect(await page.evaluate(() => AT.progress)).toMatchObject({ potty: true, teeth: true, baby: true, party: true });
});

test('party: award, balloons to pop, then the Home button pulses', async ({ page }) => {
  await prepare(page);
  await setProgress(page, ALL_DONE);
  await openGame(page, { scene: 'party' });
  await waitShown(page, 'party');
  await stepUntil(page, () => !!document.querySelector('#ui img[data-sprite="trophy"]'), { maxClock: 30 });
  await stepUntil(page, () => !document.querySelector('#ui img[data-sprite="rays"]'), { maxClock: 60 });
  // pop balloons as they float up
  let popped = 0;
  for (let tries = 0; popped < 8 && tries < 60; tries++) {
    await step(page, 0.5, 10);
    const target = await page.evaluate(() => {
      const s = document.getElementById('stage').getBoundingClientRect();
      const hits = [...document.querySelectorAll('#world .hit.on')].filter((h) => h.parentNode.querySelector(':scope > img[data-sprite^="balloon_"]'));
      for (const h of hits) {
        const r = h.getBoundingClientRect();
        const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        if (c.y > s.top + s.height * 0.15 && c.y < s.top + s.height * 0.7 && c.x > s.left + 100 && c.x < s.right - 100) return c;
      }
      return null;
    });
    if (!target) continue;
    await reveal(page);
    const before = await page.evaluate(() => document.querySelectorAll('#world img[data-sprite^="balloon_"]').length);
    await page.mouse.click(target.x, target.y);
    const afterCount = await page.evaluate(() => document.querySelectorAll('#world img[data-sprite^="balloon_"]').length);
    if (afterCount === before - 1) popped++;
  }
  expect(popped).toBe(8);
  await stepUntil(page, () => document.getElementById('btn-home').classList.contains('pulse'), { maxClock: 20 });
});

test('TV plays a cartoon (WebM when H.264 is unavailable)', async ({ page }) => {
  await prepare(page);
  await openGame(page, { scene: 'tv' });
  await waitShown(page, 'tv');
  await step(page, 1);
  const p = await page.evaluate(() => {
    const hit = document.querySelector('#world img[data-sprite="badge_teeth"]').parentNode.querySelector(':scope > .hit.on');
    const r = hit.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await reveal(page);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => page.evaluate(() => document.querySelector('.tvscreen video').currentTime), { timeout: 30_000 }).toBeGreaterThan(1);
  const v = await page.evaluate(() => {
    const vid = document.querySelector('.tvscreen video');
    return { src: vid.currentSrc, h264: vid.canPlayType('video/mp4; codecs="avc1.640028, mp4a.40.2"'), paused: vid.paused, error: vid.error && vid.error.code, msg: document.querySelector('.tvmsg').textContent, w: vid.videoWidth };
  });
  expect(v.src).toMatch(v.h264 ? /videos\/teeth\.mp4$/ : /videos\/teeth\.webm$/);
  expect(v.paused).toBe(false);
  expect(v.error).toBeNull();
  expect(v.msg).toBe('');
  expect(v.w).toBeGreaterThan(0);
  // leaving the room stops the video
  await tapElement(page, '#btn-home');
  await waitShown(page, 'hub', { maxClock: 20 });
  expect(await page.evaluate(() => document.querySelector('.tvscreen'))).toBeNull();
});
