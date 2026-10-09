// Deterministic frames of every scene at deviceScaleFactor 2: manual clock,
// seeded Math.random, no audio. Each frame is compared with its baseline.
import { test, expect } from '../helpers/fixtures.mjs';
import { prepare, openGame, step, stepUntil, autoPlay, settleForScreenshot } from '../helpers/game.mjs';
import { expectMatchesBaseline } from '../helpers/visual.mjs';

const progress = (page, p) => page.addInitScript((p) => localStorage.setItem('atticus-progress-v1', JSON.stringify(p)), p);
const ALL_DONE = { potty: true, teeth: true, baby: true, party: true, visits: 3 };

// at: seconds of game clock after the scene was built (fade-in takes 0.45 s)
const FRAMES = [
  { name: 'title', scene: 'title', at: 2 },
  { name: 'hub', scene: 'hub', at: 2.5, progress: { potty: true, teeth: true, baby: false, party: false, visits: 2 } },
  { name: 'potty-playroom', scene: 'potty', at: 3 },
  { name: 'teeth-bathroom', scene: 'teeth', at: 1.2 },
  { name: 'baby', scene: 'baby', at: 3 },
  { name: 'tv', scene: 'tv', at: 2 },
  // the Big Boy award: trophy, rays and the second confetti burst
  { name: 'party', scene: 'party', at: 0, progress: ALL_DONE, until: () => !!document.querySelector('#ui img[data-sprite="trophy"]'), then: 1.2 },
];

async function shoot(page, testInfo, name) {
  // no visible sprite bitmap is magnified, or off its displayed scale at rest (js/art-core.js)
  expect(await settleForScreenshot(page), 'sprite bitmaps off scale (AT.art.audit)').toEqual([]);
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  await expectMatchesBaseline(testInfo, name, png);
}

for (const f of FRAMES) {
  test(`scene ${f.name}`, async ({ page }, testInfo) => {
    await prepare(page, { audio: false });
    if (f.progress) await progress(page, f.progress);
    await openGame(page, { scene: f.scene });
    if (f.at) await step(page, f.at, 30);
    if (f.until) {
      await stepUntil(page, f.until, { maxClock: 60, fps: 30 });
      await step(page, f.then, 30);
    }
    await shoot(page, testInfo, `scene-${f.name}`);
  });
}

// Close-ups reached by the auto-player (deterministic: same seed, same clicks).
test('scene potty hand-washing close-up', async ({ page }, testInfo) => {
  await prepare(page, { audio: false });
  await openGame(page, { scene: 'potty' });
  await autoPlay(page, () => document.querySelectorAll('.cardclip img[data-sprite="foam"]').length >= 3);
  await step(page, 1, 10);
  await shoot(page, testInfo, 'scene-potty-handwash');
});

test('scene teeth mouth view', async ({ page }, testInfo) => {
  await prepare(page, { audio: false });
  await openGame(page, { scene: 'teeth' });
  // brush until four teeth are clean
  await autoPlay(page, () => [...document.querySelectorAll('img[data-sprite="tooth_dirt"]')].filter((im) => im.parentNode.style.opacity === '0').length >= 4);
  await step(page, 0.5, 10);
  await shoot(page, testInfo, 'scene-teeth-mouth');
});
