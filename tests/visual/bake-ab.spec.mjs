// Off-the-main-thread painting (js/art-core.js, the default where a boot probe proves it exact)
// against the synchronous canvas bake (?bake=sync): every scene frame and every gallery page
// must be bit-identical. Both are rendered in the same run, so a Chromium update that changes
// how either path rasterises SVG filters fails here even if both still pass the baselines.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { test, expect } from '../helpers/fixtures.mjs';
import { prepare, openGame, step, stepUntil, autoPlay, settleForScreenshot } from '../helpers/game.mjs';
import { loadGame } from '../helpers/load-game.mjs';
import { galleryPages } from './gallery-layout.mjs';

const A = loadGame({ only: ['art-'] }).AT.art;
const pages = galleryPages(A.list(), A.box);
const progress = (page, p) => page.addInitScript((p) => localStorage.setItem('atticus-progress-v1', JSON.stringify(p)), p);
const ALL_DONE = { potty: true, teeth: true, baby: true, party: true, visits: 3 };
// the frames of scenes.spec.mjs, reached the same way
const FRAMES = [
  { name: 'title', scene: 'title', at: 2 },
  { name: 'hub', scene: 'hub', at: 2.5, progress: { potty: true, teeth: true, baby: false, party: false, visits: 2 } },
  { name: 'potty-playroom', scene: 'potty', at: 3 },
  { name: 'teeth-bathroom', scene: 'teeth', at: 1.2 },
  { name: 'baby', scene: 'baby', at: 3 },
  { name: 'tv', scene: 'tv', at: 2 },
  { name: 'party', scene: 'party', at: 0, progress: ALL_DONE, until: () => !!document.querySelector('#ui img[data-sprite="trophy"]'), then: 1.2 },
  { name: 'handwash', scene: 'potty', play: () => document.querySelectorAll('.cardclip img[data-sprite="foam"]').length >= 3, then: 1, fps: 10 },
  { name: 'mouth', scene: 'teeth', play: () => [...document.querySelectorAll('img[data-sprite="tooth_dirt"]')].filter((im) => im.parentNode.style.opacity === '0').length >= 4, then: 0.5, fps: 10 },
];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

// On a mismatch: both screenshots and a list of the bitmaps and imgs that differ, in test-results/.
function explain(testInfo, name, a, b) {
  fs.writeFileSync(testInfo.outputPath(`${name}-offthread.png`), a.png);
  fs.writeFileSync(testInfo.outputPath(`${name}-sync.png`), b.png);
  const lines = [];
  for (const k of new Set([...Object.keys(a.dump.hashes), ...Object.keys(b.dump.hashes)])) if (a.dump.hashes[k] !== b.dump.hashes[k]) lines.push(`bitmap ${k}: ${a.dump.hashes[k]} vs ${b.dump.hashes[k]}`);
  for (let i = 0; i < Math.max(a.dump.imgs.length, b.dump.imgs.length); i++) if (a.dump.imgs[i] !== b.dump.imgs[i]) lines.push(`img ${i}: ${a.dump.imgs[i]} | ${b.dump.imgs[i]}`);
  fs.writeFileSync(testInfo.outputPath(`${name}-diff.txt`), lines.join('\n') + '\n');
}

async function frame(page, f, bake) {
  await prepare(page, { audio: false });
  if (f.progress) await progress(page, f.progress);
  await openGame(page, { scene: f.scene, query: bake ? { bake } : {} });
  if (f.at) await step(page, f.at, 30);
  if (f.until) { await stepUntil(page, f.until, { maxClock: 60, fps: 30 }); await step(page, f.then, 30); }
  if (f.play) { await autoPlay(page, f.play); await step(page, f.then, f.fps); }
  expect(await settleForScreenshot(page)).toEqual([]);
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const dump = await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll('#stage img[data-sprite]')].map((im) => [im.dataset.sprite, im.dataset.k || 'svg', im.style.transform, im.style.width].join(' '));
    const hashes = {};
    for (const im of document.querySelectorAll('#stage img[data-k]')) {
      const key = im.dataset.sprite + '@' + im.dataset.k;
      if (key in hashes) continue;
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(im, 0, 0);
      const d = await crypto.subtle.digest('SHA-256', g.getImageData(0, 0, c.width, c.height).data.buffer);
      hashes[key] = [...new Uint8Array(d)].slice(0, 6).map((x) => x.toString(16).padStart(2, '0')).join('');
    }
    return { imgs, hashes };
  });
  return { dump, png, stats: await page.evaluate(() => AT.art.stats()) };
}

for (const f of FRAMES) {
  test(`bake A/B ${f.name}`, async ({ browser }, testInfo) => {
    const ctxA = await browser.newContext(testInfo.project.use), ctxB = await browser.newContext(testInfo.project.use);
    const a = await frame(await ctxA.newPage(), f, null);
    const b = await frame(await ctxB.newPage(), f, 'sync');
    const same = a.png.equals(b.png);
    if (!same) explain(testInfo, f.name, a, b);
    testInfo.annotations.push({ type: 'bake', description: `${f.name}: off-thread ${a.stats.asyncJobs}/${a.stats.jobs} bitmaps (fallbacks ${a.stats.asyncFallbacks}), sync ${b.stats.asyncJobs}/${b.stats.jobs}; ${sha(a.png)} vs ${sha(b.png)}` });
    expect(b.stats.asyncJobs, '?bake=sync paints everything on the main thread').toBe(0);
    expect(a.stats.asyncJobs, 'the default paints off the main thread').toBeGreaterThan(0);
    expect(a.stats.asyncFallbacks).toBe(0);
    expect(same, 'bit-identical screenshots').toBe(true);
    await ctxA.close(); await ctxB.close();
  });
}

for (const p of pages) {
  test(`bake A/B gallery ${p.name}`, async ({ browser }, testInfo) => {
    const shots = [];
    for (const bake of [null, 'sync']) {
      const ctx = await browser.newContext({ ...testInfo.project.use, viewport: { width: p.width, height: p.height } });
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      page.on('pageerror', (e) => errs.push(String(e)));
      await page.goto(`/tests/visual/gallery.html?page=${p.name}${bake ? '&bake=' + bake : ''}`);
      await page.waitForFunction(() => window.__gallery, null, { timeout: 120_000 });
      expect(await page.evaluate(() => AT.art.audit(document.getElementById('page')))).toEqual([]);
      const png = await page.screenshot({ clip: { x: 0, y: 0, width: p.width, height: p.height }, animations: 'disabled' });
      shots.push({ png, stats: await page.evaluate(() => AT.art.stats()) });
      expect(errs).toEqual([]);
      await ctx.close();
    }
    const [a, b] = shots;
    if (!a.png.equals(b.png)) {
      fs.writeFileSync(testInfo.outputPath(`${p.name}-offthread.png`), a.png);
      fs.writeFileSync(testInfo.outputPath(`${p.name}-sync.png`), b.png);
    }
    testInfo.annotations.push({ type: 'bake', description: `gallery ${p.name}: off-thread ${a.stats.asyncJobs}/${a.stats.jobs}, sync ${b.stats.asyncJobs}/${b.stats.jobs}; ${sha(a.png)} vs ${sha(b.png)}` });
    expect(b.stats.asyncJobs).toBe(0);
    expect(a.png.equals(b.png), 'bit-identical screenshots').toBe(true);
  });
}
