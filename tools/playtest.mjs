// Automated play-through for development: taps whatever is glowing, scrubs
// where the helper hand points, and saves a screenshot every few seconds.
//   node tools/playtest.mjs <scene> <outdir> [seconds] [speed]
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const [, , scene = 'title', out = 'shots', secs = 60, speed = 3] = process.argv;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text()); } });
await page.goto(`http://localhost:${server.address().port}/index.html?scene=${scene}&speed=${speed}`);
const t0 = Date.now();
let shot = 0, lastShot = 0;
while ((Date.now() - t0) / 1000 < +secs) {
  await page.waitForTimeout(250);
  const act = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none'; };
    const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const hand = [...document.querySelectorAll('img[data-sprite="hand"]')].find(vis);
    const glowing = [...document.querySelectorAll('.glowring')].filter(vis).map((g) => g.parentNode.querySelector(':scope > .hit.on')).filter(Boolean);
    if (glowing.length === 1) return { type: 'tap', ...centre(glowing[0]) };
    if (glowing.length > 1 && hand) {
      const h = hand.getBoundingClientRect();
      let best = null, bd = 1e9;
      for (const g of glowing) { const c = centre(g); const d = Math.hypot(c.x - h.left, c.y - h.top); if (d < bd) { bd = d; best = c; } }
      return { type: 'tap', ...best };
    }
    if (!glowing.length && hand) { const r = hand.getBoundingClientRect(); return { type: 'rub', x: r.left + 10, y: r.top - 10 }; }
    const dirt = [...document.querySelectorAll('img[data-sprite="tooth_dirt"]')].find((im) => vis(im) && parseFloat(im.parentNode.style.opacity || 1) > 0.02);
    if (dirt) return { type: 'rub', ...centre(dirt) };
    return null;
  });
  if (act && act.type === 'tap') await page.mouse.click(act.x, act.y);
  if (act && act.type === 'rub') {
    for (let i = 0; i < 24; i++) await page.mouse.move(act.x + Math.sin(i) * 50, act.y + Math.cos(i * 1.3) * 25);
  }
  if (Date.now() - lastShot > 2500) {
    lastShot = Date.now();
    await page.screenshot({ path: path.join(out, String(shot++).padStart(3, '0') + '.jpg'), type: 'jpeg', quality: 70 });
  }
}
console.log('scene now:', await page.evaluate(() => AT.sceneName), 'errors:', errors.length);
await browser.close();
server.close();
