// Sound with a real AudioContext: narration loading (the audio file arrives after
// the game has booted) and pausing while the page is hidden.
import { test, expect } from '../helpers/fixtures.mjs';
import { prepare, stepUntil, waitShown, tapStage, autoPlay, reveal } from '../helpers/game.mjs';

/** Records speechSynthesis.speak() calls (without speaking) in window.__spoken. */
const spySpeech = (page) => page.addInitScript(() => {
  window.__spoken = [];
  const fake = { speak: (u) => window.__spoken.push(u.text), cancel() {}, getVoices: () => [], speaking: false };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: fake });
  if (!window.SpeechSynthesisUtterance) window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(t) { this.text = t; };
});

/** Counts every sound source started (notes, noises, voices) in window.__starts. */
const countSources = (page) => page.addInitScript(() => {
  window.__starts = 0;
  for (const P of [OscillatorNode.prototype, AudioBufferSourceNode.prototype]) {
    const start = P.start;
    P.start = function (...a) { window.__starts++; return start.apply(this, a); };
  }
});

/** Pretend the tab was switched away from (true) or back to (false). */
const setHidden = (page, hidden) => page.evaluate((h) => {
  if (h) {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  } else {
    delete document.hidden;
    delete document.visibilityState;
  }
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

test('narration uses the recorded voices, never the speech synthesiser: title, hub, potty', async ({ page }) => {
  test.setTimeout(300_000);
  await prepare(page);
  await spySpeech(page);
  // hold back the narration audio until the title has asked for its first line
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/js/voice-data.js', async (route) => { await held; await route.continue(); });
  await page.goto('/index.html?manual=1', { waitUntil: 'commit' });
  await page.waitForFunction(() => performance.getEntriesByName('at:built:title').length > 0, null, { timeout: 60_000 });
  await page.evaluate(() => {
    window.__captions = [];
    const txt = document.querySelector('#caption .txt');
    new MutationObserver(() => window.__captions.push(txt.textContent)).observe(txt, { childList: true, characterData: true, subtree: true });
  });
  await waitShown(page, 'title');
  expect(await page.evaluate(() => AT.audio.stats().voiceLoaded), 'the title is shown before the audio file arrives').toBe(false);

  await tapStage(page, 800, 640);
  await stepUntil(page, () => AT.audio.stats().waited > 0, { maxClock: 10 });
  release();
  // the line waits for its audio and plays when it arrives
  await expect.poll(() => page.evaluate(() => AT.audio.stats().played)).toBeGreaterThan(0);

  await waitShown(page, 'hub', { maxClock: 60 });
  const room = await page.evaluate(() => {
    const r = document.querySelector('#world img[data-sprite="room_potty"]').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await reveal(page);
  await page.mouse.click(room.x, room.y);
  await waitShown(page, 'potty', { maxClock: 30 });
  await autoPlay(page, () => AT.sceneName === 'hub' && AT.progress.potty === true);

  const r = await page.evaluate(() => ({
    spoken: window.__spoken, captions: window.__captions, stats: AT.audio.stats(),
    texts: Object.values(window.AT_VOICE).map((v) => v.t),
  }));
  test.info().annotations.push({ type: 'narration', description: JSON.stringify(r.stats) });
  expect(r.spoken, 'speechSynthesis.speak() calls').toEqual([]);
  expect(r.stats).toMatchObject({ fallbacks: 0, dropped: 0, voiceLoaded: true });
  expect(r.stats.played).toBeGreaterThan(20);
  expect(r.captions.length).toBeGreaterThan(20);
  for (const c of r.captions.filter(Boolean)) {
    expect(c, 'captions show words, not line ids').not.toMatch(/^[nadmc]_[a-z0-9_]+$/);
    expect(r.texts).toContain(c);
  }
  expect(r.stats.peakVoiceBytes, 'decoded narration kept in memory').toBeLessThanOrEqual(10e6);
});

test('sound pauses while the page is hidden and comes back with it (real clock)', async ({ page }) => {
  await prepare(page);
  await countSources(page);
  await page.goto('/index.html');
  // the title animating (after the cold first visit's still preview)
  await page.waitForFunction(() => performance.getEntriesByName('at:live:title').length > 0, null, { timeout: 60_000 });
  // tapping the title switches the sound on and starts the music
  await tapStage(page, 800, 640);
  await expect.poll(() => page.evaluate(() => AT.audio.ready), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__starts), { timeout: 20_000 }).toBeGreaterThan(20);

  await setHidden(page, true);
  await expect.poll(() => page.evaluate(() => AT.audio.ctx.state)).toBe('suspended');
  const n = await page.evaluate(() => window.__starts);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__starts), 'no notes scheduled while hidden').toBe(n);

  await setHidden(page, false);
  await expect.poll(() => page.evaluate(() => AT.audio.ctx.state)).toBe('running');
  await expect.poll(() => page.evaluate(() => window.__starts), { timeout: 10_000 }).toBeGreaterThan(n);
});

test('in the stepped test mode, hiding the page leaves the sound alone', async ({ page }) => {
  await prepare(page);
  await page.goto('/index.html?manual=1');
  await page.waitForFunction(() => performance.getEntriesByName('at:built:title').length > 0, null, { timeout: 60_000 });
  await waitShown(page, 'title');
  await tapStage(page, 800, 640);
  await expect.poll(() => page.evaluate(() => AT.audio.ready)).toBe(true);
  await setHidden(page, true);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => AT.audio.ctx.state)).toBe('running');
  await setHidden(page, false);
});
