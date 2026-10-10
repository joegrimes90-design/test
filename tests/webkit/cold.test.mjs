// Real WebKit (WebKitGTK's MiniBrowser) at devicePixelRatio 2, as an iPad shows the game, on a first
// visit (an empty profile: nothing stored), played the way a child plays it on the real clock: the
// still title comes up, a tap, the title's narration, the hub, and from the hub each scene in turn (a
// few seconds in the hub, a few in the scene, back to the hub). Every scene's first visit must be shown
// within FIRST_VISIT_MS of AT.go.
//   npm run test:webkit    (skips, saying why, where WebKitWebDriver, MiniBrowser or Xvfb is missing)
//
// WebKit paints every bitmap on the page's thread, from an SVG sized to it (js/art-core.js sizedCheck):
// a background takes about 1.5 s at 2x. Behind a scene's cover only its own imgs are painted; its
// manifest (close-ups, thought bubbles, celebrations) and the next scenes' bitmaps are painted while it
// is played, small ones between frames, big ones (the next scenes' backgrounds, the hand-washing and
// mouth close-ups) only while the narrator speaks (serialPick). Before that (commit 851ef83), each
// cover also waited for the manifest's big bitmaps and the PNG encoding: potty 13-17 s, teeth 6-11 s.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchWebKit, webkitMissing } from '../helpers/webkit.mjs';

const missing = webkitMissing();
const SCENES = ['potty', 'teeth', 'baby', 'tv', 'party'];
// measured (WebKitGTK 2.52, CPU renderer, 4 cores): the still title 2.1-2.5 s after navigation; first
// visits hub 2.5-3.5 s, potty 4.0-4.5 s (its playroom painted behind the cover, the bathroom while the
// title's narrator spoke), baby 3.6-4.1 s, party 1.9-2.5 s, tv 1.6-2.0 s, teeth 1.1-1.2 s; back to the
// hub about 1 s. (At 851ef83: still title 4.4 s, hub 4.2 s, potty 13.6 s, tv 7.6 s, baby 6.8 s.)
const FIRST_VISIT_MS = 6000;
const PREVIEW_MS = 6000;
const HUB_MS = 4000, PLAY_MS = 8000;
// a bitmap painted while a scene is played that holds the page's thread up for longer than this must
// have been asked for by an img that needed it then, or painted while the narrator spoke (what is painted
// between frames is estimated at up to 100 ms: js/art-core.js SERIAL_SLICE)
const LONG_PAINT_MS = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('WebKit at 2x, a first visit: every scene is shown within its budget, and long paints wait for calm moments', { skip: missing || false, timeout: 900000 }, async (t) => {
  const wk = await launchWebKit({ width: 1280, height: 720, scale: 2 });
  try {
    await wk.goto(process.env.COLD_PAGE || '/index.html');
    await wk.exec(`window.__errors = []; const ce = console.error.bind(console); console.error = (...a) => { window.__errors.push(a.map(String).join(' ')); ce(...a); };
      window.addEventListener('error', (e) => window.__errors.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + String(e.reason))); return 1`);
    await wk.waitFor(`return performance.getEntriesByName('at:shown:title').length > 0`, { timeout: 120000, interval: 50 });
    const mark = (n) => `(performance.getEntriesByName('${n}').slice(-1)[0] || {}).startTime`;
    const preview = await wk.exec(`return ${mark('at:shown:title')}`);
    // a tap on the still title (a child does not wait for it to move)
    await wk.exec(`document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return 1`);
    await wk.waitFor(`return performance.getEntriesByName('at:live:title').length > 0`, { timeout: 120000 });
    const titleLive = await wk.exec(`return ${mark('at:live:title')}`);
    const boot = await wk.exec('return { mode: AT.art.mode, sized: AT.art.sized, serial: AT.art.serial, dpr: devicePixelRatio }');
    assert.deepEqual(boot, { mode: 'bitmap', sized: true, serial: true, dpr: 2 }, 'bitmaps painted on the page\'s thread from sized SVGs, at 2x');
    const rows = [], slow = [];
    const shownAfterGo = async (name) => wk.exec(`const g = performance.getEntriesByName('at:go:${name}'), s = performance.getEntriesByName('at:shown:${name}'); return s[s.length - 1].startTime - g[g.length - 1].startTime`);
    const waitShown = (name, n) => wk.waitFor(`return performance.getEntriesByName('at:shown:${name}').length > ${n}`, { timeout: 120000, interval: 50 });
    // the title's narration ends with AT.go('hub')
    await waitShown('hub', 0);
    const hub = await shownAfterGo('hub');
    rows.push(`hub ${(hub / 1000).toFixed(1)} s`);
    if (hub > FIRST_VISIT_MS) slow.push(`hub ${Math.round(hub)} ms`);
    for (const name of SCENES) {
      await sleep(HUB_MS);
      await wk.exec(`AT.go(${JSON.stringify(name)}); return 1`);
      await waitShown(name, 0);
      const ms = await shownAfterGo(name);
      rows.push(`${name} ${(ms / 1000).toFixed(1)} s`);
      if (ms > FIRST_VISIT_MS) slow.push(`${name} ${Math.round(ms)} ms`);
      await sleep(PLAY_MS);
      const n = await wk.exec(`return performance.getEntriesByName('at:shown:hub').length`);
      await wk.exec(`AT.go('hub'); return 1`);
      await waitShown('hub', n);
      rows.push(`hub ${(await shownAfterGo('hub') / 1000).toFixed(1)} s`);
    }
    const log = await wk.exec('return AT.art.bakeLog()');
    const errors = await wk.exec('return window.__errors');
    const st = await wk.exec('return AT.art.stats()');
    t.diagnostic(`still title ${(preview / 1000).toFixed(1)} s, live ${(titleLive / 1000).toFixed(1)} s after navigation; shown after AT.go: ${rows.join(', ')}`);
    const played = log.filter((e) => e.playing && e.paint > LONG_PAINT_MS);
    t.diagnostic(`painted while played, over ${LONG_PAINT_MS} ms: ${played.map((e) => `${e.scene} ${e.id}@${e.k} ${e.paint} ms (${e.by}${e.calm ? ', narrator' : ''})`).join(', ')}`);
    t.diagnostic(`bitmaps painted ${st.jobs}, ${log.filter((e) => e.off).length} of them PNG-encoded off the page's thread; playLate ${st.playLate}, playMisses ${st.playMisses}`);
    assert.deepEqual(errors, [], 'console errors');
    assert.ok(preview < PREVIEW_MS, `the still title ${Math.round(preview)} ms after navigation`);
    assert.deepEqual(slow, [], `first visits shown more than ${FIRST_VISIT_MS} ms after AT.go`);
    assert.deepEqual(played.filter((e) => e.by !== 'img' && !e.calm).map((e) => `${e.scene} ${e.id}@${e.k} ${e.paint} ms`), [], 'long paints of prefetches outside calm moments');
    assert.ok(log.filter((e) => e.off).length > log.length * 0.9, 'PNGs encoded by the worker');
    assert.equal(st.svgFallbacks, 0, 'sprites left on SVG');
  } finally {
    await wk.close();
  }
});
