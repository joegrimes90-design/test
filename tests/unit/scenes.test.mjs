// Scenes, cartoons and their videos are all wired up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadGame, gameSources, scriptList, ROOT, read } from '../helpers/load-game.mjs';

const game = loadGame();
const { AT } = game;
const SCENES = ['title', 'hub', 'potty', 'teeth', 'baby', 'tv', 'party'];
const CARTOONS = ['potty', 'teeth', 'baby'];

test('every scene has build() and run()', () => {
  assert.deepEqual(Object.keys(AT.scenes).sort(), [...SCENES].sort());
  for (const name of SCENES) {
    assert.equal(typeof AT.scenes[name].build, 'function', `${name}.build`);
    assert.equal(typeof AT.scenes[name].run, 'function', `${name}.run`);
  }
});

test('every AT.go() target is a scene', () => {
  const targets = new Set();
  for (const { src } of gameSources()) {
    for (const m of src.matchAll(/AT\.go\(([^,)]+)/g)) {
      for (const l of m[1].replace(/[!=]==?\s*'[^']*'/g, '').matchAll(/'(\w+)'/g)) targets.add(l[1]);
    }
  }
  assert.deepEqual([...targets].sort(), ['hub', 'party', 'title']);
  for (const t of targets) assert.ok(AT.scenes[t], `AT.go('${t}')`);
  // hub rooms open scenes by key
  const hub = read('js/scenes/hub.js');
  const rooms = [...hub.slice(hub.indexOf('const rooms'), hub.indexOf('};', hub.indexOf('const rooms'))).matchAll(/(\w+): mk\(/g)].map((m) => m[1]);
  assert.deepEqual(rooms.sort(), ['baby', 'potty', 'teeth', 'tv']);
  for (const r of rooms) assert.ok(AT.scenes[r], `room ${r}`);
});

test('cartoons exist for potty, teeth and baby, matching the TV episodes', () => {
  assert.deepEqual(Object.keys(AT.cartoons).sort(), [...CARTOONS].sort());
  for (const name of CARTOONS) {
    assert.equal(typeof AT.cartoons[name].build, 'function');
    assert.equal(typeof AT.cartoons[name].run, 'function');
  }
  assert.deepEqual([...AT.scenes.tv.EPISODES.map((e) => e.key)], CARTOONS);
  for (const e of AT.scenes.tv.EPISODES) assert.ok(AT.art.has(e.badge), e.badge);
  assert.equal(typeof AT.recordCartoon, 'function');
});

const magic = {
  mp4: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp',
  webm: (b) => b.readUInt32BE(0) === 0x1a45dfa3,
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
};
test('every cartoon has its .mp4, .webm and .jpg poster', () => {
  for (const name of CARTOONS) {
    for (const ext of ['mp4', 'webm', 'jpg']) {
      const f = path.join(ROOT, 'videos', `${name}.${ext}`);
      assert.ok(fs.existsSync(f), `videos/${name}.${ext} missing (run tools/render-videos.mjs)`);
      const size = fs.statSync(f).size;
      assert.ok(size > (ext === 'jpg' ? 5_000 : 200_000), `videos/${name}.${ext} is suspiciously small (${size} bytes)`);
      const head = Buffer.alloc(16);
      const fd = fs.openSync(f, 'r'); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
      assert.ok(magic[ext](head), `videos/${name}.${ext} is not a valid ${ext}`);
    }
  }
});

test('index.html loads every script in a working order', () => {
  const list = scriptList();
  for (const f of list) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} missing`);
  const at = (f) => list.indexOf(f);
  assert.equal(at('js/art-core.js'), 0, 'art-core.js first (creates window.AT)');
  for (const f of ['js/art-characters.js', 'js/art-props.js', 'js/art-scenes.js']) assert.ok(at(f) > 0 && at(f) < at('js/characters.js'), f);
  assert.ok(at('js/engine.js') < at('js/characters.js') && at('js/engine.js') < at('js/game.js'));
  assert.ok(at('js/game.js') < at('js/scenes/title.js'), 'game.js before the scenes');
  for (const s of SCENES) assert.ok(at(`js/scenes/${s}.js`) > 0, `scene ${s} loaded`);
  assert.match(read('index.html'), /<script>AT\.boot\(\);<\/script>\s*<\/body>/, 'AT.boot() runs last');
});
