// Dev helper: screenshot a page served from the repo root.  node tools/shot.mjs <url-path> <out.png> [w] [h]
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = process.env.ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const extra = process.env.EXTRA_ROOT;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let p = path.join(root, u);
  if (extra && !fs.existsSync(p)) p = path.join(extra, u);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const [, , page_, out, w = 1600, h = 900, waitTitle = 'done'] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => console.log('[console]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${port}${page_}`);
if (waitTitle !== '-') await page.waitForFunction((t) => document.title.startsWith(t), waitTitle, { timeout: 60000 });
else await page.waitForTimeout(+process.env.WAIT || 1500);
console.log('title:', await page.title());
await page.screenshot({ path: out });
await browser.close();
server.close();
