// Real WebKit (WebKitGTK's MiniBrowser), as an iPad shows the game (devicePixelRatio 2): every
// scene twice over, on the real clock. The page must survive it within a memory bound, every
// scene must be shown within a time bound, all of it through the bitmap layer, and the bitmaps
// must reach the store.
//   npm run test:webkit    (skips, saying why, where WebKitWebDriver, MiniBrowser or Xvfb is missing)
//
// - Each ink line's filter once had the whole sprite as its region. WebKit allocates every
//   filter step's buffer at the full region, for every line: painting a background took three
//   times as long and the page's memory grew by up to a gigabyte a scene, until it crashed
//   ("session deleted because of page crash or hang") after five or six scenes.
// - WebKit works out an SVG image's filters at the image's own size: bitmaps at k = 2 were
//   painted from a 1x picture, magnified. AT.art.sized says the boot probe found that, and the
//   bitmaps are painted from SVGs sized to them (and let go of once painted).
// - A WebDriver session is ephemeral, like Safari's Private Browsing, where IndexedDB can't
//   store a Blob: the store writes the PNGs as ArrayBuffers instead (format 'buffer').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWebKit, webkitMissing } from '../helpers/webkit.mjs';

const missing = webkitMissing();
const SCENES = ['hub', 'potty', 'teeth', 'baby', 'tv', 'party'];
// measured (WebKitGTK 2.52, CPU renderer, 4 cores, 1280x720 at 2x): the content process stays at
// 0.5-1.5 GB, and the slowest scene (potty, first visit, its two backgrounds and close-ups painted
// behind the cover) is shown 13-15 s after AT.go, the second time round about 1 s. With a region per
// sprite it reached 6.3 GB (this test fails there), and passed 8 GB and crashed in earlier runs;
// painting from the 1x SVGs (?sized=0, soft) it reached 4.8 GB.
const MAX_MB = 3000;
const MAX_SHOWN_MS = 40000;

test('WebKit at 2x: every scene twice over on the real clock, within memory and time', { skip: missing || false, timeout: 900000 }, async (t) => {
  const wk = await launchWebKit({ width: 1280, height: 720, scale: 2 });
  try {
    await wk.goto('/index.html');
    await wk.waitFor(`return performance.getEntriesByName('at:live:title').length > 0`, { timeout: 180000 });
    const boot = await wk.exec('return { mode: AT.art.mode, sized: AT.art.sized, dpr: devicePixelRatio }');
    assert.deepEqual(boot, { mode: 'bitmap', sized: true, dpr: 2 }, 'bitmap layer, painting from sized SVGs, at 2x');
    const rows = [];
    let maxMB = wk.webProcessMB();
    for (const name of [...SCENES, ...SCENES]) {
      const n = await wk.exec(`return performance.getEntriesByName('at:shown:${name}').length`);
      const t0 = Date.now();
      await wk.exec(`AT.go(${JSON.stringify(name)}); return true;`);
      await wk.waitFor(`return performance.getEntriesByName('at:shown:${name}').length > ${n}`, { timeout: MAX_SHOWN_MS * 2 });
      const ms = Date.now() - t0;
      await wk.execAsync('await AT.art.idle();');
      const mb = wk.webProcessMB();
      maxMB = Math.max(maxMB, mb);
      rows.push(`${name} ${(ms / 1000).toFixed(1)} s ${mb} MB`);
      assert.ok(ms < MAX_SHOWN_MS, `${name} shown ${ms} ms after AT.go`);
    }
    const st = await wk.exec('return { art: AT.art.stats(), cache: AT.rasterCache.stats(), sized: AT.art.sized, mode: AT.art.mode }');
    t.diagnostic(`scene shown after AT.go, content process memory: ${rows.join(', ')}`);
    t.diagnostic(`bitmaps painted ${st.art.jobs} (${st.art.svgFallbacks} on SVG), ${Math.round(st.art.decoded / 1048576)} MB decoded; store: ${st.cache.writes} written as ${st.cache.format}, ${st.cache.errors} failed writes, ${st.cache.pending} pending`);
    assert.equal(st.mode, 'bitmap');
    assert.equal(st.art.svgFallbacks, 0, 'sprites left on SVG');
    assert.ok(maxMB < MAX_MB, `content process ${maxMB} MB`);
    // (the store writes when idle after a scene has faded in: by now at least once)
    assert.equal(st.cache.format, 'buffer', 'PNGs stored as ArrayBuffers in an ephemeral session');
    assert.ok(st.cache.writes > 50, `${st.cache.writes} bitmaps stored`);
  } finally {
    await wk.close();
  }
});
