// Render the cartoons in js/cartoons.js to MP4 files in videos/.
//
//   cd tools && npm install && node render-videos.mjs [potty teeth baby]
//
// Opens index.html?record=<name> in headless Chromium, steps the game clock one
// frame at a time, screenshots every frame, mixes the soundtrack with an
// OfflineAudioContext, and encodes everything with ffmpeg (must be on PATH).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(root, 'videos');
const FPS = 24, W = 1280, H = 720;
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['potty', 'teeth', 'baby'];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
fs.mkdirSync(outDir, { recursive: true });

const run = (args, opts = {}) => new Promise((resolve, reject) => {
  const p = spawn('ffmpeg', args, { stdio: [opts.stdin ? 'pipe' : 'ignore', 'ignore', 'inherit'] });
  p.on('error', reject);
  p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg exited ' + code))));
  if (opts.stdin) opts.stdin(p.stdin);
});

const browser = await chromium.launch();
for (const name of names) {
  const t0 = Date.now();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  // an error while the cartoon loads (e.g. js/voice-data.js missing: no narration) stops at once, with the reason
  let loadError;
  const failed = new Promise((resolve, reject) => { loadError = reject; });
  failed.catch(() => {});
  page.on('pageerror', (e) => { console.error('[pageerror]', e.message); loadError(new Error(`${name}: ${e.message}`)); });
  page.on('console', (m) => { if (m.type() === 'error') { console.error('[console.error]', m.text()); loadError(new Error(`${name}: ${m.text()}`)); } });
  await page.goto(`${base}/index.html?record=${name}`);
  await Promise.race([page.waitForFunction(() => window.__rec && window.__rec.ready, null, { timeout: 60000 }), failed]);
  loadError = () => {}; // (from here on errors are only logged)
  await page.evaluate(() => document.fonts.ready);

  const silent = path.join(outDir, `.${name}-frames.mp4`);
  const wav = path.join(outDir, `.${name}.wav`);
  let frames = 0, tail = Math.round(FPS * 0.5), poster = null;
  const encode = run(['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-crf', '24', '-pix_fmt', 'yuv420p', silent], {
    stdin: async (stdin) => {
      for (;;) {
        const jpg = await page.screenshot({ type: 'jpeg', quality: 92 });
        if (!stdin.write(jpg)) await new Promise((r) => stdin.once('drain', r));
        frames++;
        if (frames === FPS * 9) poster = jpg;
        const done = await page.evaluate(async (dt) => { await window.__rec.step(dt); return window.__rec.done; }, 1 / FPS);
        if (done && tail-- <= 0) break;
        if (frames % (FPS * 5) === 0) process.stdout.write(`  ${name}: ${frames / FPS}s\r`);
      }
      stdin.end();
    },
  });
  await encode;
  const b64 = await page.evaluate(() => window.__rec.renderAudio());
  fs.writeFileSync(wav, Buffer.from(b64, 'base64'));
  const mp4 = path.join(outDir, `${name}.mp4`);
  await run(['-y', '-i', silent, '-i', wav, '-c:v', 'copy', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', mp4]);
  // WebM copy for browsers without H.264 (some Chromium/Linux builds)
  await run(['-y', '-i', mp4, '-c:v', 'libvpx-vp9', '-crf', '36', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '96k', path.join(outDir, `${name}.webm`)]);
  if (poster) {
    const tmp = path.join(outDir, `.${name}-poster.jpg`);
    fs.writeFileSync(tmp, poster);
    await run(['-y', '-i', tmp, '-vf', 'scale=640:-2', '-q:v', '4', '-frames:v', '1', '-update', '1', path.join(outDir, `${name}.jpg`)]);
    fs.unlinkSync(tmp);
  }
  fs.unlinkSync(silent);
  fs.unlinkSync(wav);
  const mb = (fs.statSync(mp4).size / 1e6).toFixed(1);
  console.log(`${name}.mp4: ${(frames / FPS).toFixed(1)}s, ${mb} MB, rendered in ${Math.round((Date.now() - t0) / 1000)}s`);
  await page.close();
}
await browser.close();
server.close();
