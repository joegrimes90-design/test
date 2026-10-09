// Load-performance benchmark.
//   node tools/perf.mjs [--cpu 4] [--runs 3] [--json out.json] [--scenes]
//                       [--page /dist/atticus.html] [--net 1600,150]
// Opens index.html in headless Chromium with the CPU slowed down (like a
// tablet), and reports how long it takes to reach each milestone.
// --net kbps,rtt emulates a network (download kbit/s, round trip ms) and serves
// files gzipped, like a web host. --page /dist/atticus.html measures the one-file
// artifact bundle (rebuilt first with tools/build-artifact.mjs).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes('--' + k);
const CPU = +arg('cpu', 4), RUNS = +arg('runs', 3), OUT = arg('json', null), PAGE = arg('page', '/index.html');
const NET = arg('net', null) && arg('net').split(',').map(Number); // [kbps, rttMs]
if (PAGE === '/dist/atticus.html') execFileSync(process.execPath, [path.join(root, 'tools/build-artifact.mjs')], { stdio: 'inherit' });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json' };

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

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function oneRun() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: +arg('dpr', 2) });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await cdp.send('Performance.enable');
  if (NET) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: NET[1], downloadThroughput: (NET[0] * 1000) / 8, uploadThroughput: (NET[0] * 1000) / 8 });
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__long = [];
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true }); } catch (e) { /* unsupported */ }
  });
  await page.goto(base + PAGE, { waitUntil: 'commit' });
  await page.waitForFunction(() => performance.getEntriesByName('at:shown:title').length > 0, null, { timeout: 120000 });
  // wait for the first painted frame of the title
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const r = await page.evaluate(() => {
    const m = (n) => { const e = performance.getEntriesByName(n)[0]; return e ? Math.round(e.startTime) : null; };
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      fcp: fcp ? Math.round(fcp.startTime) : null,
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      boot: m('at:boot'), warm: m('at:warm'), titleBuilt: m('at:built:title'), titleShown: m('at:shown:title'),
      titleFrame: Math.round(performance.now()),
      longTasks: window.__long.length, longTaskMs: Math.round(window.__long.reduce((a, b) => a + b[1], 0)),
      maxLongTask: Math.round(Math.max(0, ...window.__long.map((x) => x[1]))),
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    };
  });
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  r.scriptSec = +(metrics.ScriptDuration || 0).toFixed(2);
  r.taskSec = +(metrics.TaskDuration || 0).toFixed(2);
  // frame pacing on the animated title screen
  r.frames = await page.evaluate(() => new Promise((res) => {
    const t = []; let last = performance.now();
    const f = (now) => { t.push(now - last); last = now; if (t.length < 120) requestAnimationFrame(f); else { const s = t.slice(5).sort((a, b) => a - b); res({ p50: +s[Math.floor(s.length * 0.5)].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1) }); } };
    requestAnimationFrame(f);
  }));
  if (flag('scenes')) {
    r.scenes = {};
    for (const sc of ['hub', 'potty', 'teeth', 'baby', 'tv', 'party']) {
      const t = await page.evaluate(async (name) => {
        const t0 = performance.now();
        AT.go(name);
        await new Promise((ok) => { const chk = () => (performance.getEntriesByName('at:shown:' + name).length ? ok() : setTimeout(chk, 20)); chk(); });
        const built = performance.getEntriesByName('at:built:' + name).pop().startTime;
        performance.clearMarks('at:shown:' + name); performance.clearMarks('at:built:' + name);
        await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
        return { build: Math.round(built - t0), shown: Math.round(performance.now() - t0) };
      }, sc);
      r.scenes[sc] = t;
    }
  }
  // when the narration audio (js/voice-data.js, loaded after boot) arrived
  r.voiceAudio = await page.evaluate(() => { const e = performance.getEntriesByName('at:voice')[0]; return e ? Math.round(e.startTime) : null; });
  r.errors = errors.length;
  await ctx.close();
  return r;
}

const runs = [];
for (let i = 0; i < RUNS; i++) { const r = await oneRun(); runs.push(r); console.error(`run ${i + 1}: title shown at ${r.titleShown} ms`); }
const keys = ['fcp', 'domContentLoaded', 'boot', 'warm', 'titleBuilt', 'titleShown', 'titleFrame', 'longTasks', 'longTaskMs', 'maxLongTask', 'scriptSec', 'taskSec', 'heapMB', 'voiceAudio', 'errors'];
const summary = { cpuThrottle: CPU, runs: RUNS, page: PAGE, ...(NET ? { net: { kbps: NET[0], rttMs: NET[1] } } : {}) };
for (const k of keys) summary[k] = median(runs.map((r) => r[k]));
summary.frameP50 = median(runs.map((r) => r.frames.p50));
summary.frameP95 = median(runs.map((r) => r.frames.p95));
if (runs[0].scenes) {
  summary.scenes = {};
  for (const sc of Object.keys(runs[0].scenes)) summary.scenes[sc] = { build: median(runs.map((r) => r.scenes[sc].build)), shown: median(runs.map((r) => r.scenes[sc].shown)) };
}
console.log(JSON.stringify(summary, null, 2));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
await browser.close();
server.close();
