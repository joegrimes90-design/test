// Writes js/sprite-manifest.js: every sprite bitmap each scene asks for while it is played,
// and at which scale, so the game can paint a scene's close-ups, celebrations and particles
// behind that scene's entry cover instead of during play (js/art-core.js prefetchScene), and
// the next scenes' small sprites while the player is busy (idle prefetch).
//   node tools/sprite-manifest.mjs            (about 5 minutes: plays every scene)
//   node tools/sprite-manifest.mjs --check    (exit 1 if js/sprite-manifest.js is out of date)
// Re-run it after changing what a scene shows, or at which size; tests/unit/manifest.test.mjs
// fails when a scene uses a sprite its manifest does not list.
//
// How: the game is loaded with ?manual=1&spritelog=1 (seeded, silent, at 1280x720 and
// devicePixelRatio 2) and played by the test suites' auto-player (tests/helpers/game.mjs):
// the title, the hub (fresh, with stickers, all done), potty, teeth and baby to the end
// (each followed by its sticker on the hub; baby's leads to the party), the TV with every
// cartoon started, and the party. With spritelog=1, js/art-core.js records each bitmap
// request as [scene, sprite, scale / (stage scale x devicePixelRatio), steps]: steps 0 is an
// exact scale; 8 or 32 mean the request was rounded up to the next 2^(1/steps) step (scale
// tweens, sprites whose scale changes every frame); 4 is a particle (random sizes), for which
// the manifest keeps the range of scales seen, so any screen gets every step in it. Relative
// scales do not depend on the screen. Exact scales seen many times for one sprite in one scene
// (random sizes: balloons, soap bubbles) cannot be predicted: they are listed as a range in
// 0 steps, and painted when needed. Scales below 0.1 device pixels per unit (cards popping in
// and out from s = 0.01) are left out.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { prepare, openGame, autoPlay, step, stepUntil, waitShown, tapStage } from '../tests/helpers/game.mjs';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(root, 'js/sprite-manifest.js');
const CHECK = process.argv.includes('--check');
const UNIT = 1.6; // stage scale 0.8 (1280x720) x devicePixelRatio 2
const SCENES = ['title', 'hub', 'potty', 'teeth', 'baby', 'tv', 'party'];
// what can follow each scene (idle prefetch of their small sprites)
const NEXT = { title: ['hub'], hub: ['potty', 'teeth', 'baby', 'tv', 'party'], potty: ['hub'], teeth: ['hub'], baby: ['hub'], tv: ['hub'], party: ['hub'] };
const RANDOM = 8; // more distinct exact scales than this for one sprite in one scene: random sizes
const TINY = 0.1 / UNIT; // smaller relative scales are not worth a bitmap

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseURL = `http://127.0.0.1:${server.address().port}`;

const ALL_DONE = { potty: true, teeth: true, baby: true, party: true, visits: 3 };
const back = (k) => `() => AT.sceneName === 'hub' && AT.progress.${k} === true && performance.getEntriesByName('at:shown:hub').length > 0`;
const RUNS = [
  { name: 'title', scene: 'title', async play(page) {
    await waitShown(page, 'title');
    await step(page, 3, 10);
    await tapStage(page, 800, 640);
    await stepUntil(page, () => AT.sceneName === 'hub', { maxClock: 90 });
  } },
  { name: 'hub', scene: 'hub', async play(page) { await waitShown(page, 'hub'); await step(page, 32, 10); } },
  { name: 'hub-stickers', scene: 'hub', progress: { potty: true, teeth: false, baby: true, party: false, visits: 2 }, async play(page) { await waitShown(page, 'hub'); await step(page, 5, 10); } },
  { name: 'hub-done', scene: 'hub', progress: ALL_DONE, async play(page) { await waitShown(page, 'hub'); await step(page, 5, 10); } },
  { name: 'potty', scene: 'potty', async play(page) {
    await autoPlay(page, back('potty'));
    await step(page, 8, 10); // the new sticker flies to the chart
  } },
  { name: 'teeth', scene: 'teeth', async play(page) {
    // in the mouth view, wait for the hint hand before brushing
    await autoPlay(page, () => !!document.querySelector('img[data-sprite="tooth_dirt"]'));
    await stepUntil(page, () => !!document.querySelector('#ui img[data-sprite="hand"]'), { maxClock: 30 });
    await autoPlay(page, back('teeth'));
    await step(page, 8, 10);
  } },
  { name: 'baby', scene: 'baby', progress: { potty: true, teeth: true, baby: false, party: false, visits: 2 }, async play(page) {
    await autoPlay(page, back('baby'));
    // the last sticker: the hub sends everyone to the party
    await stepUntil(page, () => AT.sceneName === 'party', { maxClock: 60 });
    await step(page, 50, 10);
  } },
  { name: 'tv', scene: 'tv', async play(page) {
    await waitShown(page, 'tv');
    await step(page, 3, 10);
    for (const x of [560, 800, 1040]) { await tapStage(page, x, 858); await step(page, 2, 10); }
    await tapStage(page, 800, 495);
    await step(page, 3, 10);
  } },
  { name: 'party', scene: 'party', progress: ALL_DONE, async play(page) { await waitShown(page, 'party'); await step(page, 50, 10); } },
];

const browser = await chromium.launch();
const log = [];
async function record(run) {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await prepare(page, { audio: false });
  if (run.progress) await page.addInitScript((p) => localStorage.setItem('atticus-progress-v1', JSON.stringify(p)), run.progress);
  const t0 = Date.now();
  await openGame(page, { scene: run.scene, query: { spritelog: '1' } });
  await run.play(page);
  const entries = await page.evaluate(() => AT.art.spriteLog());
  await ctx.close();
  if (errors.length) throw new Error(`${run.name}: ${errors.join('; ')}`);
  console.error(`  ${run.name}: ${entries.length} requests (${Math.round((Date.now() - t0) / 1000)} s)`);
  log.push(...entries);
}
// two at a time
const queue = [...RUNS];
await Promise.all([0, 1].map(async () => { for (let r; (r = queue.shift());) await record(r); }));
await browser.close();
server.close();

// ----- aggregate -----
const r6 = (x) => +x.toFixed(6);
const round3 = (k) => Math.round(k * 1000) / 1000;
const bucketUp = (k, n) => round3(Math.pow(2, Math.ceil(n * Math.log2(k) - 1e-6) / n));
const scenes = {};
// id -> {exact: Map(k at UNIT -> [rels]), steps: Map(`${n}|${step at UNIT}` -> [n, rel]), ranges: Map(n -> [lo, hi])}
for (const sc of SCENES) scenes[sc] = new Map();
for (const [sc, id, rel, n] of log) {
  if (!scenes[sc] || !(rel >= TINY)) continue;
  if (!scenes[sc].has(id)) scenes[sc].set(id, { exact: new Map(), steps: new Map(), ranges: new Map() });
  const e = scenes[sc].get(id);
  if (n === 4) {
    const r = e.ranges.get(n);
    if (!r) e.ranges.set(n, [rel, rel]); else { r[0] = Math.min(r[0], rel); r[1] = Math.max(r[1], rel); }
  } else if (n) {
    const key = `${n}|${bucketUp(rel * UNIT, n)}`;
    if (!e.steps.has(key)) e.steps.set(key, [n, rel]);
  } else {
    const key = round3(rel * UNIT);
    if (!e.exact.has(key)) e.exact.set(key, []);
    e.exact.get(key).push(rel);
  }
}
const out = {};
for (const sc of SCENES) {
  const rows = [];
  for (const [id, e] of [...scenes[sc]].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (e.exact.size <= RANDOM) {
      for (const [, rels] of [...e.exact].sort((a, b) => a[0] - b[0])) rows.push([id, r6(rels.sort((a, b) => a - b)[rels.length >> 1])]);
    } else {
      const all = [...e.exact.values()].flat();
      rows.push([id, r6(Math.min(...all)), r6(Math.max(...all)), 0]);
    }
    for (const [n, rel] of [...e.steps.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])) rows.push([id, r6(rel), n]);
    for (const [n, [lo, hi]] of [...e.ranges].sort((a, b) => a[0] - b[0])) rows.push([id, r6(lo), r6(hi), n]);
  }
  out[sc] = rows;
}
const body = SCENES.map((sc) => `    ${JSON.stringify(sc)}: [\n${out[sc].map((r) => `      ${JSON.stringify(r)},`).join('\n')}\n    ],`).join('\n');
const text = `/* Generated by tools/sprite-manifest.mjs (do not edit): the sprite bitmaps each scene asks for,
 * at scale / (stage scale x devicePixelRatio). [id, s]: that exact scale; [id, s, n]: the
 * 2^(1/n) step at or above s; [id, lo, hi, n]: every 2^(1/n) step from lo to hi; [id, lo, hi, 0]:
 * random exact scales between lo and hi (painted when needed). js/art-core.js paints a scene's
 * list behind its entry cover (prefetchScene) and the next scenes' small sprites in idle time
 * (idlePrefetch). */
window.AT_SPRITES = {
  next: ${JSON.stringify(NEXT)},
  scenes: {
${body}
  },
};
`;
if (CHECK) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== text) { console.error('js/sprite-manifest.js is out of date: run node tools/sprite-manifest.mjs'); process.exit(1); }
  console.error('js/sprite-manifest.js is up to date');
} else {
  fs.writeFileSync(OUT, text);
  console.error(`wrote js/sprite-manifest.js: ${SCENES.map((sc) => `${sc} ${out[sc].length}`).join(', ')}`);
}
