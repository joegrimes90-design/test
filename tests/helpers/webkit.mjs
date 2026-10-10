// Drive a real WebKit (WebKitGTK's MiniBrowser through WebKitWebDriver) for the
// tests that must see what Safari sees: tests/webkit/*.test.mjs (`npm run test:webkit`).
//
// Needs, on Linux: WebKitWebDriver (Debian/Ubuntu package webkit2gtk-driver), MiniBrowser
// (libwebkit2gtk-4.1-0) and Xvfb (xvfb). Playwright's own WebKit build is not used: it
// may not be downloadable, and this is the WebKit the distribution ships.
//   WEBKIT_DRIVER   path of WebKitWebDriver   (default /usr/bin/WebKitWebDriver)
//   WEBKIT_BROWSER  path of MiniBrowser       (default the webkit2gtk-4.1 one)
//
//   const wk = await launchWebKit({ scale: 2 });   // own Xvfb, own static server
//   await wk.goto('/index.html?manual=1');
//   await wk.waitFor('return !!(window.AT && AT.sceneName === "title")');
//   const v = await wk.exec('return devicePixelRatio');
//   const png = await wk.screenshot();               // Buffer (PNG)
//   await wk.close();
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { createStaticServer } from '../server.mjs';

export const WEBKIT_DRIVER = process.env.WEBKIT_DRIVER || '/usr/bin/WebKitWebDriver';
export const WEBKIT_BROWSER = process.env.WEBKIT_BROWSER || '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser';
const XVFB_DIRS = ['/usr/bin', '/usr/local/bin', '/bin'];
const xvfbPath = () => XVFB_DIRS.map((d) => d + '/Xvfb').find((p) => fs.existsSync(p));

/** Why WebKit can't run here (a message for test skips), or null when it can. */
export function webkitMissing() {
  if (process.platform !== 'linux') return 'the WebKit tests drive WebKitGTK, on Linux only';
  if (!fs.existsSync(WEBKIT_DRIVER)) return `no ${WEBKIT_DRIVER} (apt install webkit2gtk-driver, or set WEBKIT_DRIVER)`;
  if (!fs.existsSync(WEBKIT_BROWSER)) return `no ${WEBKIT_BROWSER} (apt install libwebkit2gtk-4.1-0, or set WEBKIT_BROWSER)`;
  if (!xvfbPath()) return 'no Xvfb (apt install xvfb)';
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// A private X server: -displayfd prints the display number it picked.
function startXvfb(width, height) {
  return new Promise((resolve, reject) => {
    const x = spawn(xvfbPath(), ['-displayfd', '3', '-screen', '0', `${width}x${height}x24`, '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { x.kill(); reject(new Error('Xvfb did not start: ' + err)); }, 15000);
    x.stderr.on('data', (d) => { err += d; });
    x.stdio[3].on('data', (d) => {
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); resolve({ proc: x, display: ':' + out.trim() }); }
    });
    x.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Xvfb exited (${code}): ${err}`)); });
  });
}

/**
 * Start Xvfb, WebKitWebDriver, a static server for the repo and one MiniBrowser session.
 * @param {object} [o]
 * @param {number} [o.width=1280] [o.height=720]  the window (CSS pixels)
 * @param {number} [o.scale=1]  devicePixelRatio, through GDK_SCALE (integers only)
 */
export async function launchWebKit({ width = 1280, height = 720, scale = 1 } = {}) {
  const missing = webkitMissing();
  if (missing) throw new Error(missing);
  const cleanups = [];
  const close = async () => { for (const c of cleanups.reverse()) { try { await c(); } catch (e) { /* already gone */ } } cleanups.length = 0; };
  try {
    const server = createStaticServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    cleanups.push(() => new Promise((r) => server.close(r)));
    const base = `http://127.0.0.1:${server.address().port}`;

    const xvfb = await startXvfb(Math.max(1400, (width + 120) * scale), Math.max(900, (height + 180) * scale));
    cleanups.push(() => { xvfb.proc.kill(); });

    const port = await freePort();
    const env = { ...process.env, DISPLAY: xvfb.display, GDK_SCALE: String(scale), GDK_DPI_SCALE: '1', WEBKIT_DISABLE_COMPOSITING_MODE: process.env.WEBKIT_DISABLE_COMPOSITING_MODE || '' };
    delete env.WAYLAND_DISPLAY;
    let drvErr = '';
    const drv = spawn(WEBKIT_DRIVER, [`--port=${port}`], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    drv.stderr.on('data', (d) => { drvErr = (drvErr + d).slice(-4000); });
    cleanups.push(() => { drv.kill(); });
    const root = `http://127.0.0.1:${port}`;
    const wd = async (method, p, body) => {
      const r = await fetch(root + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json();
      if (j.value && j.value.error) throw new Error(`WebDriver ${method} ${p}: ${j.value.error}: ${j.value.message}`);
      return j.value;
    };
    for (let i = 0; ; i++) {
      try { const s = await wd('GET', '/status'); if (s && s.ready !== false) break; } catch (e) { if (i > 100) throw new Error('WebKitWebDriver did not start: ' + drvErr); }
      await sleep(100);
    }

    const s = await wd('POST', '/session', {
      capabilities: { alwaysMatch: { 'webkitgtk:browserOptions': { binary: WEBKIT_BROWSER, args: ['--automation', `--geometry=${width}x${height}`] } } },
    });
    const sid = s.sessionId;
    cleanups.push(() => wd('DELETE', `/session/${sid}`));
    const S = `/session/${sid}`;
    await wd('POST', S + '/timeouts', { script: 600000, pageLoad: 120000 });
    // the window's outer size includes MiniBrowser's toolbar: grow it until the viewport fits
    const fit = async () => {
      for (let i = 0; i < 4; i++) {
        const [iw, ih] = await wd('POST', S + '/execute/sync', { script: 'return [innerWidth, innerHeight]', args: [] });
        if (iw === width && ih === height) return;
        const rect = await wd('GET', S + '/window/rect');
        await wd('POST', S + '/window/rect', { width: rect.width + width - iw, height: rect.height + height - ih });
        await sleep(300);
      }
    };

    const wk = {
      base,
      close,
      /** Open a repo path (e.g. '/index.html?manual=1'), with the viewport at the asked size. */
      async goto(path) {
        await wd('POST', S + '/url', { url: /^[a-z]+:/.test(path) ? path : base + path });
        await fit();
      },
      /** Run a function body in the page (WebDriver execute/sync): `return ...`, with arguments[i]. */
      exec: (script, ...args) => wd('POST', S + '/execute/sync', { script, args }),
      /** Run an async function body: its returned promise is awaited. */
      execAsync: (body, ...args) => wd('POST', S + '/execute/async', {
        script: `const done = arguments[arguments.length - 1]; (async function () { ${body} }).apply(null, Array.prototype.slice.call(arguments, 0, -1)).then((v) => done({ ok: v }), (e) => done({ err: String(e && e.stack || e) }));`,
        args,
      }).then((r) => { if (r && 'err' in r) throw new Error('in WebKit: ' + r.err); return r && r.ok; }),
      /** Poll a function body until it returns something truthy (that value is returned). */
      async waitFor(script, { timeout = 60000, interval = 200 } = {}) {
        const t0 = Date.now();
        for (;;) {
          const v = await wk.exec(script);
          if (v) return v;
          if (Date.now() - t0 > timeout) throw new Error('timed out waiting for: ' + script);
          await sleep(interval);
        }
      },
      /** Resident memory (MB) of the largest WebKitWebProcess this session started (the page's content process). */
      webProcessMB: () => {
        const kids = new Map();
        for (const d of fs.readdirSync('/proc')) {
          if (!/^\d+$/.test(d)) continue;
          try {
            const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
            const ppid = +st.slice(st.lastIndexOf(')') + 2).split(' ')[1];
            if (!kids.has(ppid)) kids.set(ppid, []);
            kids.get(ppid).push(+d);
          } catch (e) { /* gone */ }
        }
        let max = 0;
        const visit = (pid) => {
          for (const c of kids.get(pid) || []) {
            try {
              const status = fs.readFileSync(`/proc/${c}/status`, 'utf8');
              if (/^Name:\s*WebKitWebProces/m.test(status)) max = Math.max(max, +(/^VmRSS:\s*(\d+)/m.exec(status) || [0, 0])[1] / 1024);
            } catch (e) { /* gone */ }
            visit(c);
          }
        };
        visit(drv.pid);
        return Math.round(max);
      },
      /** A PNG of the viewport (device pixels). */
      screenshot: async () => Buffer.from(await wd('GET', S + '/screenshot'), 'base64'),
    };
    return wk;
  } catch (e) {
    await close();
    throw e;
  }
}
