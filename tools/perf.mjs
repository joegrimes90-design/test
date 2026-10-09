// Load-performance benchmark.
//   node tools/perf.mjs [--cpu 4] [--runs 3] [--json out.json] [--dpr 2] [--page /index.html]
//                       [--scenes] [--revisit] [--trace] [--play] [--play-cap 45000] [--play-speed 2]
//                       [--title-frames 120] [--scene-frames 60] [--title-cap 12000] [--scene-cap 5000]
//                       [--net 1600,150]
//
// Opens index.html in headless Chromium with the CPU slowed down (like a
// tablet), and reports how long it takes to reach each milestone (ms after
// navigation start unless noted):
//   titleShown      the title has faded in (game mark at:shown:title)
//   titlePainted    two animation frames later, i.e. the faded-in title is on screen
//                   (at:painted:title, marked in the page so Playwright round trips don't count)
//   titleLive       the title is animating (at:live:title when the game marks it, else titlePainted)
//   titleFrame      when the harness first saw the painted title (kept for continuity)
//   frameP50/P95    rAF intervals on the animated title (up to --title-frames intervals or
//                   --title-cap ms, whichever comes first: slow frames would otherwise take minutes)
//   maxLongTaskIdle longest task after the title was painted, outside scene transitions
//                   (at:go:X .. at:shown:X) and outside --play: only idle frames (the title
//                   and each scene just after it is entered), nobody tapping anything
//   voiceAudio      when the narration audio arrived (at:voice: js/voice-data.js, loaded after
//                   boot, has run); waited for up to 30 s after the rest is measured
// --page     the page to load; --page /dist/atticus.html measures the one-file artifact
//            bundle (rebuilt first with tools/build-artifact.mjs).
// --net kbps,rtt  emulates a network (download kbit/s, round trip ms) and serves text
//            files gzipped, like a web host.
// --scenes   then visits hub, potty, teeth, baby, tv and party with AT.go and reports, per
//            scene, the phases faded/dom/raster/built/shown/painted relative to the AT.go call
//            and the scene's frame p50/p95 (up to --scene-frames intervals or --scene-cap ms).
//            transitionMax = the slowest scene's shown.
// --revisit  every run uses a fresh persistent profile: loads the page (cold.*), then loads it
//            again in the same profile (revisit.*), so persistent caches count.
// --trace    1 s after the title is painted, records a 3 s Chromium trace and reports
//            rasterMsPerFrame: tile-raster time on the raster worker threads per frame drawn.
// --play     then plays potty and teeth on the real clock (at --play-speed, for up to
//            --play-cap ms each) with the test suites' auto-player (tests/helpers/game.mjs:
//            taps what glows, rubs where the hand points, brushes the dirty teeth) and reports
//            maxLongTaskPlay (the longest task while playing, outside AT.go transitions: card
//            pop-ins, thought bubbles, star flights and the teeth close-up all count) and
//            playFrameP95 (the worst scene's rAF p95 while playing), per scene under play.*
import { chromium } from 'playwright';
import { prepare } from '../tests/helpers/game.mjs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes('--' + k);
const CPU = +arg('cpu', 4), RUNS = +arg('runs', 3), OUT = arg('json', null), PAGE = arg('page', '/index.html');
const DPR = +arg('dpr', 2);
const TITLE_FRAMES = +arg('title-frames', 120), SCENE_FRAMES = +arg('scene-frames', 60);
const TITLE_CAP = +arg('title-cap', 12000), SCENE_CAP = +arg('scene-cap', 5000);
const SCENES = flag('scenes'), REVISIT = flag('revisit'), TRACE = flag('trace'), PLAY = flag('play');
const PLAY_CAP = +arg('play-cap', 45000), PLAY_SPEED = +arg('play-speed', 2);
const PLAY_SCENES = ['potty', 'teeth'];
const SCENE_LIST = ['hub', 'potty', 'teeth', 'baby', 'tv', 'party'];
const NET = arg('net', null) && arg('net').split(',').map(Number); // [kbps, rttMs]
if (PAGE === '/dist/atticus.html') execFileSync(process.execPath, [path.join(root, 'tools/build-artifact.mjs')], { stdio: 'inherit' });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  const headers = { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' };
  if (NET && /^(text|application\/json)/.test(headers['content-type']) && /gzip/.test(req.headers['accept-encoding'] || '')) {
    res.writeHead(200, { ...headers, 'content-encoding': 'gzip' });
    return res.end(gzipped(p));
  }
  res.writeHead(200, headers);
  fs.createReadStream(p).pipe(res);
});
const gzCache = new Map();
function gzipped(p) {
  const key = p + ':' + fs.statSync(p).mtimeMs;
  if (!gzCache.has(key)) gzCache.set(key, zlib.gzipSync(fs.readFileSync(p)));
  return gzCache.get(key);
}
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const LAUNCH = { args: ['--autoplay-policy=no-user-gesture-required'] };
const CONTEXT = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: DPR };
const browser = REVISIT ? null : await chromium.launch(LAUNCH);
const median = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

// Page-side instrumentation, installed before any game script.
function pageInit() {
  window.__long = [];
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true }); } catch (e) { /* unsupported */ }
  // at:painted:<scene> two animation frames after at:shown:<scene>: the faded-in
  // scene has then been drawn. (Wrapping performance.mark instead of a mark
  // PerformanceObserver: observer callbacks are delivered late on a busy page.)
  const orig = performance.mark.bind(performance);
  performance.mark = function mark(name, opts) {
    const r = orig(name, opts);
    const m = /^at:shown:(.+)$/.exec(name);
    if (m) requestAnimationFrame(() => requestAnimationFrame(() => orig('at:painted:' + m[1])));
    return r;
  };
}

// rAF intervals: up to n intervals or capMs, whichever first; the first `skip` are dropped.
const sampleFrames = (page, n, capMs) => (n > 0 ? page.evaluate(([n, cap]) => new Promise((res) => {
  const t = []; let last = null; const t0 = performance.now();
  const skip = n >= 100 ? 5 : 2;
  const f = (now) => {
    if (last !== null) t.push(now - last);
    last = now;
    if (t.length < n + skip && now - t0 < cap) return requestAnimationFrame(f);
    const s = t.slice(Math.min(skip, Math.max(0, t.length - 3))).sort((a, b) => a - b);
    res({ p50: +s[Math.floor(s.length * 0.5)].toFixed(1), p95: +s[Math.min(s.length - 1, Math.floor(s.length * 0.95))].toFixed(1), n: s.length });
  };
  requestAnimationFrame(f);
}), [n, capMs]) : Promise.resolve(null));

// Raster cost from a Chromium trace: complete events named RasterTask (or
// DisplayItemList::Raster when there are no RasterTask events) on the tile
// worker threads, nested events of the same name merged per thread.
function rasterMsFromTrace(json) {
  const events = Array.isArray(json) ? json : json.traceEvents || [];
  const names = new Map();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args && e.args.name);
  const worker = (e) => /CompositorTileWorker|ThreadPoolForegroundWorker/.test(names.get(`${e.pid}:${e.tid}`) || '');
  const pick = events.some((e) => e.name === 'RasterTask' && worker(e)) ? 'RasterTask' : 'DisplayItemList::Raster';
  const spans = new Map(); // thread -> [[start, end]]
  const open = new Map();
  for (const e of events) {
    if (e.name !== pick || !worker(e)) continue;
    const key = `${e.pid}:${e.tid}`;
    if (!spans.has(key)) spans.set(key, []);
    if (e.ph === 'X') spans.get(key).push([e.ts, e.ts + (e.dur || 0)]);
    else if (e.ph === 'B') { if (!open.has(key)) open.set(key, []); open.get(key).push(e.ts); }
    else if (e.ph === 'E' && open.has(key) && open.get(key).length) spans.get(key).push([open.get(key).pop(), e.ts]);
  }
  let us = 0;
  for (const list of spans.values()) {
    list.sort((a, b) => a[0] - b[0]);
    let cur = null;
    for (const [s, e] of list) {
      if (!cur || s > cur[1]) { if (cur) us += cur[1] - cur[0]; cur = [s, e]; } else cur[1] = Math.max(cur[1], e);
    }
    if (cur) us += cur[1] - cur[0];
  }
  return { ms: us / 1000, event: pick, threads: spans.size };
}

async function traceRaster(page) {
  await page.waitForTimeout(1000);
  await browser.startTracing(page, { categories: ['disabled-by-default-devtools.timeline', 'cc', 'viz', 'benchmark', 'toplevel'] });
  const frames = await page.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const f = (now) => { n++; if (now - t0 < 3000) requestAnimationFrame(f); else res(n); };
    requestAnimationFrame(f);
  }));
  const buf = await browser.stopTracing();
  const r = rasterMsFromTrace(JSON.parse(buf.toString('utf8')));
  return { rasterMsPerFrame: +(r.ms / Math.max(1, frames)).toFixed(1), traceFrames: frames, rasterEvent: r.event };
}

// --play: enter `name` with AT.go, then play it on the real clock with the test suites'
// auto-player (window.__auto, installed by tests/helpers/game.mjs prepare()) until it goes
// back to the hub or PLAY_CAP ms pass. Long tasks inside the window that do not overlap an
// AT.go transition, and the rAF intervals of the whole window, are what a child playing sees.
async function playScene(page, name) {
  await page.evaluate(async ([n, speed]) => {
    const count = () => performance.getEntriesByName('at:painted:' + n).length;
    const before = count();
    AT.go(n);
    const t0 = performance.now();
    await new Promise((ok, fail) => { const chk = () => (count() > before ? ok() : performance.now() - t0 > 120000 ? fail(new Error(`${n} not shown`)) : setTimeout(chk, 20)); chk(); });
    AT.engine.speed = speed;
    window.__pf = []; window.__pfOn = true;
    let last = null;
    const f = (now) => { if (last !== null) window.__pf.push(now - last); last = now; if (window.__pfOn) requestAnimationFrame(f); };
    requestAnimationFrame(f);
    window.__playFrom = performance.now();
  }, [name, PLAY_SPEED]);
  const end = Date.now() + PLAY_CAP;
  let actions = 0;
  while (Date.now() < end) {
    const st = await page.evaluate(() => ({ scene: AT.sceneName, a: window.__auto.find() }));
    if (st.scene !== name) break;
    if (!st.a) { await page.waitForTimeout(150); continue; }
    actions++;
    if (st.a.type === 'tap') {
      const p = await page.evaluate(() => window.__auto.aim());
      await page.mouse.click(p.x, p.y);
    } else {
      for (const [x, y] of st.a.path) await page.mouse.move(x, y);
    }
  }
  return page.evaluate(([n, actions]) => {
    window.__pfOn = false;
    AT.engine.speed = 1;
    const a = window.__playFrom, b = performance.now();
    (window.__playWindows = window.__playWindows || []).push([a, b]);
    const marks = performance.getEntriesByType('mark');
    const trans = marks.filter((m) => m.name.startsWith('at:shown:') && m.startTime > a).map((s) => {
      const go = marks.filter((m) => m.name === 'at:go:' + s.name.slice(9) && m.startTime <= s.startTime).pop();
      return [go ? go.startTime : a, s.startTime];
    });
    const long = window.__long.filter(([st, d]) => st < b && st + d > a && !trans.some(([x, y]) => st < y && st + d > x));
    const s = window.__pf.slice(2).sort((x, y) => x - y);
    const q = (p) => (s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1) : null);
    return {
      sec: Math.round((b - a) / 100) / 10, actions, reachedHub: AT.sceneName === 'hub', gameClock: Math.round(AT.engine.time),
      frameP50: q(0.5), frameP95: q(0.95), frameMax: s.length ? Math.round(s[s.length - 1]) : null,
      maxLongTask: Math.round(Math.max(0, ...long.map((x) => x[1]))), longTaskMs: Math.round(long.reduce((x, y) => x + y[1], 0)), longTasks: long.length,
    };
  }, [name, actions]);
}

// One load of the page in `page`, measured up to the painted title (and beyond, with flags).
async function measureLoad(page, cdp, opts = {}) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await page.goto(base + PAGE, { waitUntil: 'commit' });
  await page.waitForFunction(() => performance.getEntriesByName('at:painted:title').length > 0, null, { timeout: 180000, polling: 50 });
  const r = await page.evaluate(() => {
    const m = (n) => { const e = performance.getEntriesByName(n)[0]; return e ? Math.round(e.startTime) : null; };
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      fcp: fcp ? Math.round(fcp.startTime) : null,
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      boot: m('at:boot'), warm: m('at:warm'), titleBuilt: m('at:built:title'), titleShown: m('at:shown:title'),
      titlePainted: m('at:painted:title'), titleLive: m('at:live:title') ?? m('at:painted:title'),
      titleFrame: Math.round(performance.now()),
    };
  });
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  r.scriptSec = +(metrics.ScriptDuration || 0).toFixed(2);
  r.taskSec = +(metrics.TaskDuration || 0).toFixed(2);
  // frame pacing on the animated title screen
  const fr = await sampleFrames(page, opts.titleFrames ?? TITLE_FRAMES, TITLE_CAP);
  if (fr) { r.frameP50 = fr.p50; r.frameP95 = fr.p95; r.frameSamples = fr.n; }
  if (opts.trace) Object.assign(r, await traceRaster(page));
  if (SCENES) {
    r.scenes = {};
    for (const sc of SCENE_LIST) {
      const t = await page.evaluate(async (name) => {
        const count = () => performance.getEntriesByName('at:painted:' + name).length;
        const before = count();
        const t0 = performance.now();
        AT.go(name);
        await new Promise((ok) => { const chk = () => (count() > before ? ok() : setTimeout(chk, 20)); chk(); });
        const rel = (n) => { const e = performance.getEntriesByName(`at:${n}:${name}`).pop(); return e && e.startTime >= t0 ? Math.round(e.startTime - t0) : null; };
        return { faded: rel('faded'), dom: rel('dom'), raster: rel('raster'), built: rel('built'), shown: rel('shown'), painted: rel('painted') };
      }, sc);
      const sf = await sampleFrames(page, SCENE_FRAMES, SCENE_CAP);
      if (sf) { t.frameP50 = sf.p50; t.frameP95 = sf.p95; }
      r.scenes[sc] = t;
    }
    r.transitionMax = Math.max(...Object.values(r.scenes).map((s) => s.shown ?? Infinity));
    const fp = Object.values(r.scenes).map((s) => s.frameP95).filter((v) => v != null);
    r.sceneFrameP95 = fp.length ? Math.max(...fp) : null;
  }
  if (PLAY) {
    r.play = {};
    for (const sc of PLAY_SCENES) r.play[sc] = await playScene(page, sc);
    const v = (k) => Object.values(r.play).map((x) => x[k]).filter((x) => x != null);
    r.maxLongTaskPlay = Math.max(0, ...v('maxLongTask'));
    r.longTaskPlayMs = v('longTaskMs').reduce((a, b) => a + b, 0);
    r.playFrameP95 = v('frameP95').length ? Math.max(...v('frameP95')) : null;
  }
  // long tasks: 'cover' while a scene is loading (boot or at:go:X .. at:shown:X), 'play' in a
  // --play window, else 'idle'
  Object.assign(r, await page.evaluate(() => {
    const windows = [];
    const shown = performance.getEntriesByType('mark').filter((e) => e.name.startsWith('at:shown:'));
    for (const s of shown) {
      const name = s.name.slice('at:shown:'.length);
      const go = performance.getEntriesByType('mark').filter((e) => e.name === 'at:go:' + name && e.startTime <= s.startTime).pop();
      windows.push([name === 'title' && !go ? 0 : go ? go.startTime : 0, s.startTime]);
    }
    const painted = performance.getEntriesByName('at:painted:title')[0];
    const from = painted ? painted.startTime : Infinity;
    const plays = window.__playWindows || [];
    const idle = window.__long.filter(([st, d]) => st >= from && !windows.some(([a, b]) => st < b && st + d > a) && !plays.some(([a, b]) => st < b && st + d > a));
    return {
      longTasks: window.__long.length, longTaskMs: Math.round(window.__long.reduce((a, b) => a + b[1], 0)),
      maxLongTask: Math.round(Math.max(0, ...window.__long.map((x) => x[1]))),
      maxLongTaskIdle: Math.round(Math.max(0, ...idle.map((x) => x[1]))),
      longTaskIdleMs: Math.round(idle.reduce((a, b) => a + b[1], 0)),
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    };
  }));
  // when the narration audio (js/voice-data.js, loaded after boot) arrived; on a slow
  // --net it can arrive after the title, so wait a little for it
  await page.waitForFunction(() => performance.getEntriesByName('at:voice').length > 0, null, { timeout: 30000, polling: 100 }).catch(() => {});
  r.voiceAudio = await page.evaluate(() => { const e = performance.getEntriesByName('at:voice')[0]; return e ? Math.round(e.startTime) : null; });
  return r;
}

async function setupPage(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (NET) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: NET[1], downloadThroughput: (NET[0] * 1000) / 8, uploadThroughput: (NET[0] * 1000) / 8 });
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(pageInit);
  if (PLAY) await prepare(page, { audio: true }); // the auto-player (and seeded Math.random)
  return { cdp, errors };
}

async function oneRun() {
  if (REVISIT) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atticus-perf-profile-'));
    try {
      const ctx = await chromium.launchPersistentContext(dir, { ...LAUNCH, ...CONTEXT });
      const page = ctx.pages()[0] || await ctx.newPage();
      const { cdp, errors } = await setupPage(ctx, page);
      const cold = await measureLoad(page, cdp);
      cold.errors = errors.length;
      const revisit = await measureLoad(page, cdp);
      revisit.errors = errors.length - cold.errors;
      await ctx.close();
      return { cold, revisit };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const ctx = await browser.newContext(CONTEXT);
  const page = await ctx.newPage();
  const { cdp, errors } = await setupPage(ctx, page);
  const r = await measureLoad(page, cdp, { trace: TRACE });
  r.errors = errors.length;
  await ctx.close();
  return r;
}

const KEYS = ['fcp', 'domContentLoaded', 'boot', 'warm', 'titleBuilt', 'titleShown', 'titlePainted', 'titleLive', 'titleFrame',
  'frameP50', 'frameP95', 'rasterMsPerFrame', 'longTasks', 'longTaskMs', 'maxLongTask', 'maxLongTaskIdle', 'longTaskIdleMs',
  'maxLongTaskPlay', 'longTaskPlayMs', 'playFrameP95', 'transitionMax', 'sceneFrameP95', 'scriptSec', 'taskSec', 'heapMB', 'voiceAudio', 'errors'];
const PLAY_KEYS = ['sec', 'actions', 'gameClock', 'frameP50', 'frameP95', 'frameMax', 'maxLongTask', 'longTaskMs', 'longTasks'];
const SCENE_KEYS = ['faded', 'dom', 'raster', 'built', 'shown', 'painted', 'frameP50', 'frameP95'];
function summarise(runs) {
  const s = {};
  for (const k of KEYS) { const v = median(runs.map((r) => r[k])); if (v != null) s[k] = v; }
  if (runs[0].scenes) {
    s.scenes = {};
    for (const sc of Object.keys(runs[0].scenes)) {
      s.scenes[sc] = {};
      for (const k of SCENE_KEYS) s.scenes[sc][k] = median(runs.map((r) => r.scenes[sc][k]));
    }
  }
  if (runs[0].play) {
    s.play = {};
    for (const sc of Object.keys(runs[0].play)) {
      s.play[sc] = {};
      for (const k of PLAY_KEYS) s.play[sc][k] = median(runs.map((r) => r.play[sc][k]));
    }
  }
  return s;
}

const runs = [];
for (let i = 0; i < RUNS; i++) {
  const r = await oneRun();
  runs.push(r);
  const c = r.cold || r;
  console.error(`run ${i + 1}: title shown at ${c.titleShown} ms, painted at ${c.titlePainted} ms${r.revisit ? `; revisit shown at ${r.revisit.titleShown} ms` : ''}${c.frameP95 != null ? `; frames p95 ${c.frameP95} ms` : ''}${c.rasterMsPerFrame != null ? `; raster ${c.rasterMsPerFrame} ms/frame` : ''}${c.voiceAudio != null ? `; voice audio at ${c.voiceAudio} ms` : ''}`);
}
const summary = { cpuThrottle: CPU, runs: RUNS, page: PAGE, dpr: DPR, ...(NET ? { net: { kbps: NET[0], rttMs: NET[1] } } : {}) };
if (REVISIT) {
  summary.cold = summarise(runs.map((r) => r.cold));
  summary.revisit = summarise(runs.map((r) => r.revisit));
} else Object.assign(summary, summarise(runs));
console.log(JSON.stringify(summary, null, 2));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
if (browser) await browser.close();
server.close();
