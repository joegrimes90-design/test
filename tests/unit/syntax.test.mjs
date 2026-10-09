// The game must still start on older tablets that toddlers often end up with
// (iOS 12-13.3, Safari below 13.1). Nothing transpiles js/: tools/build-artifact.mjs
// only inlines it, so a single newer token (??, ?., ??=, ||=, class fields, #private)
// is a SyntaxError there and the whole file never runs (?raster=svg can't help).
// So every game script must parse as an ES2019 classic script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'acorn';
import { ROOT, read } from '../helpers/load-game.mjs';

const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => {
  const p = path.posix.join(dir, d.name);
  return d.isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
});

test('every js/ file parses as an ES2019 classic script', () => {
  const files = walk('js');
  assert.ok(files.includes('js/art-core.js') && files.includes('js/scenes/teeth.js'), 'found the game scripts');
  const problems = [];
  for (const f of files) {
    try { parse(read(f), { ecmaVersion: 2019, sourceType: 'script' }); } catch (e) { problems.push(`${f}: ${e.message}`); }
  }
  assert.deepEqual(problems, []);
});

test('inline scripts in index.html parse as ES2019', () => {
  for (const m of read('index.html').matchAll(/<script>([\s\S]*?)<\/script>/g)) parse(m[1], { ecmaVersion: 2019, sourceType: 'script' });
});

test('the ES2019 check catches newer syntax', () => {
  for (const src of ['a ?? b', 'a?.b', 'a ||= b', 'class A { x = 1 }']) {
    assert.throws(() => parse(src, { ecmaVersion: 2019, sourceType: 'script' }), SyntaxError, src);
  }
});
