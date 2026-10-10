// Real WebKit (WebKitGTK's MiniBrowser): the ink lines show, and every face has its eyes and mouth.
//   npm run test:webkit    (skips, saying why, where WebKitWebDriver, MiniBrowser or Xvfb is missing)
//
// WebKit draws nothing at all for an element whose filter region is too big (see
// tests/unit/filters.test.mjs). That once took every pencil line off the sprites on iPads
// and iPhones: Atticus had eyes but no mouth or brows, the baby a mouth but no eyes, while
// Chromium (and so the other suites) showed them all.
//
// 1. Every face sprite, every sprite drawn in ink only, and the sprites with transformed
//    lines (the mirrored leg, teddy's tilted arms), on tests/webkit/sprites.html: each one
//    as the game shows it, next to its SVG without the ink and its SVG with the ink unfiltered.
//    The pixels where the game's sprite is darker than the one without ink are the ink that
//    shows; at least INK_MIN of the unfiltered ink's must (the pencil grain thins it; a
//    vanished filter gives 0). With the bitmap layer (WebKit paints them synchronously, as
//    the boot probe decides there) and with ?raster=svg, at devicePixelRatio 1 and 2.
// 2. The title scene: every puppet shows one pair of eyes and one mouth, and each of them
//    darkens the face under it.
// 3. Bitmaps at k = 2 (every iPad and iPhone) are painted at that resolution: WebKit works out an
//    SVG image's filters at the image's own size, so the plain way of painting them (drawImage of
//    the 1x image, at 2x) magnified a 1x picture: every face part soft, thin lines paler. The bitmap
//    layer paints from SVGs sized to the bitmap there (AT.art.sized, js/art-core.js sizedCheck).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { launchWebKit, webkitMissing } from '../helpers/webkit.mjs';
import { loadGame, ROOT } from '../helpers/load-game.mjs';

const missing = webkitMissing();
const OUT = path.join(ROOT, 'test-results', 'webkit');
const INK_MIN = 0.5; // measured (WebKitGTK 2.52): 86-127% of the unfiltered ink's pixels; 0% for every one with the old 5000x5000 ink region
const DARKER = 40; // luminance levels (0-255) darker than without the ink

const A = loadGame({ only: ['art-'] }).AT.art;
const all = [...A.list()];
const body = (id) => A.svgOf(id).replace(/<defs>[\s\S]*<\/defs>/, '');
const FACES = all.filter((id) => /^(at|mm|dd|bb)_(eyes|mouth)_/.test(id));
const INK_ONLY = all.filter((id) => {
  const els = [...body(id).matchAll(/<(path|text)\b[^>]*>/g)].map((m) => m[0]);
  return els.length && els.every((e) => /filter="url\(#k/.test(e));
});
const TRANSFORMED = all.filter((id) => [...body(id).matchAll(/<path\b[^>]*>/g)].some((m) => /filter="url\(#k/.test(m[0]) && / transform="/.test(m[0])));
const IDS = [...new Set([...FACES, ...INK_ONLY, ...TRANSFORMED])];

const lum = (d, o) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
// pixels in [x, y, w, h] (device px) where image a is darker than image b (same size), or b's own offset
function darker(a, rect, b, bdx = 0) {
  const [x0, y0, w, h] = rect.map(Math.round);
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(a.height, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(a.width, x0 + w); x++) {
      const o = (y * a.width + x) * 4, ob = (y * b.width + x + bdx) * 4;
      if (lum(b.data, ob) - lum(a.data, o) > DARKER) n++;
    }
  }
  return n;
}
const save = (name, png) => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, name), png); };

// Rows of [game | noink | plain] triples, packed into pages that fit the viewport.
const GAP = 8;
function pages(ids, s, width, height) {
  const out = [];
  let cells = [], x = GAP, y = GAP, rowH = 0;
  for (const id of ids) {
    const [, , bw, bh] = A.box(id);
    const w = Math.ceil(bw * s), h = Math.ceil(bh * s), tw = 3 * (w + GAP) + GAP * 2;
    if (x + tw > width) { x = GAP; y += rowH + GAP; rowH = 0; }
    if (y + h > height - GAP) { out.push(cells); cells = []; x = GAP; y = GAP; rowH = 0; }
    cells.push({ id, s, x, y });
    x += tw; rowH = Math.max(rowH, h);
  }
  if (cells.length) out.push(cells);
  return out;
}

const CONFIGS = [
  { name: 'bitmaps', query: '', scale: 1 },
  { name: 'svg', query: '?raster=svg', scale: 1 },
  { name: 'bitmaps@2x', query: '', scale: 2 },
  { name: 'svg@2x', query: '?raster=svg', scale: 2 },
];

for (const cfg of CONFIGS) {
  test(`WebKit ${cfg.name}: the ink of every face, ink-only and transformed sprite shows`, { skip: missing || false, timeout: 600000 }, async (t) => {
    const W = 1280, H = 900;
    const wk = await launchWebKit({ width: W, height: H, scale: cfg.scale });
    try {
      const bad = [];
      const ratios = [];
      let p = 0;
      for (const cells of pages(IDS, 1, W, H)) {
        await wk.goto('/tests/webkit/sprites.html' + cfg.query);
        await wk.waitFor('return window.__ready === true && !!(window.AT && AT.art)');
        const r = await wk.execAsync('return await window.render(arguments[0], arguments[1]);', cells, GAP);
        assert.equal(r.mode, cfg.query ? 'svg' : 'bitmap', 'the bitmap layer\'s mode');
        if (!cfg.query) assert.equal(r.bitmaps, r.imgs, 'every sprite shown as a bitmap');
        const shot = await wk.screenshot();
        save(`ink-${cfg.name.replace('@', '-')}-${++p}.png`, shot);
        const png = PNG.sync.read(shot);
        const d = png.width / r.innerWidth;
        assert.equal(Math.round(d * 100) / 100, cfg.scale, `devicePixelRatio (${r.dpr}, screenshot ${png.width}px wide)`);
        for (const c of r.cells) {
          const rect = [c.x * d, c.y * d, c.w * d, c.h * d];
          const off = Math.round((c.w + GAP) * d);
          const shows = darker(png, rect, png, off); // game vs noink
          const plain = darker(png, [rect[0] + 2 * off, rect[1], rect[2], rect[3]], png, -off); // plain vs noink
          const ratio = plain ? shows / plain : 0;
          ratios.push(`${c.id} ${(ratio * 100).toFixed(0)}%`);
          if (!c.inkLines) bad.push(`${c.id}: no ink lines in its SVG`);
          else if (plain < 20 * d * d) bad.push(`${c.id}: its unfiltered ink covers only ${plain} px`);
          else if (ratio < INK_MIN) bad.push(`${c.id}: ${shows} ink px of ${plain} (${(ratio * 100).toFixed(0)}%)`);
        }
      }
      t.diagnostic(`${IDS.length} sprites, ink shown / unfiltered: ${ratios.join(', ')}`);
      assert.deepEqual(bad, [], `ink missing in WebKit (screenshots in ${path.relative(ROOT, OUT)})`);
    } finally {
      await wk.close();
    }
  });
}

for (const cfg of CONFIGS.slice(0, 2)) {
  test(`WebKit ${cfg.name}: every puppet on the title shows its eyes and mouth`, { skip: missing || false, timeout: 600000 }, async (t) => {
    const wk = await launchWebKit({ width: 1280, height: 720, scale: cfg.scale });
    try {
      await wk.goto('/index.html?manual=1' + (cfg.query ? '&' + cfg.query.slice(1) : ''));
      await wk.waitFor(`return performance.getEntriesByName('at:built:title').length > 0`, { timeout: 120000 });
      // the clock only moves when asked (?manual=1): play until the title has faded in, then 3 s more
      await wk.execAsync(`
        for (let i = 0; i < 600 && !performance.getEntriesByName('at:shown:title').length; i++) await __test.step(0.1, 10);
        await __test.step(3, 10);
        await AT.art.idle();
        await AT.imagesReady(document.body, 60000);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));`);
      const faces = await wk.exec(`
        const shown = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; } return true; };
        return [...document.querySelectorAll('#stage img[data-sprite]')].filter((im) => /^(at|mm|dd|bb)_(eyes|mouth)_/.test(im.dataset.sprite) && shown(im)).map((im) => {
          const r = im.getBoundingClientRect();
          return { id: im.dataset.sprite, x: r.left, y: r.top, w: r.width, h: r.height, complete: im.complete, natural: im.naturalWidth, k: im.dataset.k || null };
        });`);
      const puppets = await wk.exec(`return [...new Set([...document.querySelectorAll('#stage img[data-sprite]')].map((im) => im.dataset.sprite.split('_')[0]).filter((p) => /^(at|mm|dd|bb)$/.test(p)))]`);
      const a = PNG.sync.read(await wk.screenshot());
      await wk.exec(`window.__hidden = [...document.querySelectorAll('#stage img[data-sprite]')].filter((im) => /^(at|mm|dd|bb)_(eyes|mouth)_/.test(im.dataset.sprite)); window.__hidden.forEach((im) => { im.style.visibility = 'hidden'; });`);
      await wk.execAsync('await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));');
      const shotB = await wk.screenshot();
      const b = PNG.sync.read(shotB);
      await wk.exec(`window.__hidden.forEach((im) => { im.style.visibility = ''; });`);
      save(`title-${cfg.name}.png`, PNG.sync.write(a));
      save(`title-${cfg.name}-faceless.png`, shotB);
      const d = a.width / 1280;
      const mode = await wk.exec('return AT.art.mode');
      assert.equal(mode, cfg.query ? 'svg' : 'bitmap');
      t.diagnostic(`puppets ${puppets.join(' ')}; faces ${faces.map((f) => f.id).join(' ')}`);
      assert.ok(puppets.length >= 3, `puppets on the title: ${puppets}`);
      const bad = [], counts = [];
      for (const p of puppets) {
        for (const part of ['eyes', 'mouth']) {
          const mine = faces.filter((f) => f.id.startsWith(`${p}_${part}_`));
          if (mine.length !== 1) { bad.push(`${p}: ${mine.length} ${part} shown (${mine.map((f) => f.id)})`); continue; }
          const f = mine[0];
          if (!f.complete || !f.natural) { bad.push(`${f.id}: not loaded`); continue; }
          const n = darker(a, [f.x * d, f.y * d, f.w * d, f.h * d], b);
          counts.push(`${f.id} ${n}`);
          // with the old ink region: 0 px for dad's mouth and the baby's eyes, 7-15 for Atticus's mouth
          if (n < 40 * d * d) bad.push(`${f.id}: darkens only ${n} px of the face`);
        }
      }
      t.diagnostic(`device px each face part darkens: ${counts.join(', ')}`);
      assert.deepEqual(bad, [], `faces missing in WebKit (screenshots in ${path.relative(ROOT, OUT)})`);
    } finally {
      await wk.close();
    }
  });
}

// measured (WebKitGTK 2.52): the game's bitmap has 1.09-1.80 times the gradient energy of the plain
// way (median 1.47); painted the plain way, 1.00-1.01
const SHARP_MIN = 1.05, SHARP_MEDIAN = 1.25;
test('WebKit: bitmaps at k = 2 are painted at that resolution, not magnified from 1x', { skip: missing || false, timeout: 600000 }, async (t) => {
  const ids = [...FACES, 'star', 'toothbrush', 'stool', 'badge_teeth', 'shelf_panel'];
  const wk = await launchWebKit({ width: 1280, height: 720, scale: 1 });
  try {
    await wk.goto('/tests/webkit/sprites.html');
    await wk.waitFor('return window.__ready === true && !!(window.AT && AT.art)');
    const r = await wk.execAsync('return await window.sharpness(arguments[0], arguments[1]);', ids, 2);
    assert.equal(r.mode, 'bitmap');
    assert.equal(r.sized, true, 'the boot probe finds WebKit filters an SVG image at its own size (AT.art.sized)');
    const ratios = r.rows.map((x) => ({ id: x.id, v: x.plain ? x.game / x.plain : 0 }));
    t.diagnostic(`gradient energy, game / plain: ${ratios.map((x) => `${x.id} ${x.v.toFixed(2)}`).join(', ')}`);
    const sorted = ratios.map((x) => x.v).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    assert.deepEqual(ratios.filter((x) => !(x.v >= SHARP_MIN)).map((x) => `${x.id} ${x.v.toFixed(2)}`), [], 'bitmaps no sharper than a magnified 1x picture');
    assert.ok(median >= SHARP_MEDIAN, `median ${median.toFixed(2)}`);
  } finally {
    await wk.close();
  }
});
