// The generated sprite manifest (js/sprite-manifest.js, written by tools/sprite-manifest.mjs)
// is current: each scene's list holds every sprite its code shows, so the game can paint them
// behind the scene's entry cover rather than during play.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, read } from '../helpers/load-game.mjs';
import { usedSprites, puppetSprites } from '../helpers/sprite-uses.mjs';

const REGEN = 'run node tools/sprite-manifest.mjs';
const game = loadGame();
const M = game.AT_SPRITES;
const A = game.AT.art;
const SCENES = Object.keys(game.AT.scenes);

test('the manifest is loaded with the game and covers every scene', () => {
  assert.ok(M && M.scenes && M.next, `window.AT_SPRITES missing (${REGEN})`);
  assert.deepEqual(Object.keys(M.scenes).sort(), [...SCENES].sort(), REGEN);
  for (const sc of SCENES) {
    assert.ok(M.scenes[sc].length > 10, `${sc}: only ${M.scenes[sc].length} entries (${REGEN})`);
    for (const n of M.next[sc] || []) assert.ok(SCENES.includes(n), `next[${sc}]: unknown scene ${n}`);
  }
});

test('every manifest entry is a defined sprite at a sensible scale', () => {
  const bad = [];
  for (const sc of SCENES) {
    for (const e of M.scenes[sc]) {
      // [id, s] | [id, s, steps] | [id, lo, hi, steps] (steps 0: random exact scales, not prefetched)
      const id = e[0], lo = e[1], hi = e.length === 4 ? e[2] : lo, n = e.length > 2 ? e[e.length - 1] : 0;
      if (!A.has(id)) bad.push(`${sc}: ${id} is not a sprite`);
      if (!(lo >= 0.06 && hi >= lo && hi < 6)) bad.push(`${sc}: ${id} scale ${lo}-${hi}`);
      if (e.length === 3 && ![8, 32].includes(n)) bad.push(`${sc}: ${id} in 2^(1/${n}) steps`);
      if (e.length === 4 && ![0, 4].includes(n)) bad.push(`${sc}: ${id} range in 2^(1/${n}) steps`);
      // (particles from bursts of several sizes; one burst spreads over 2x, i.e. 4 steps)
      if (e.length === 4 && n === 4 && Math.ceil(4 * Math.log2(hi / lo)) > 10) bad.push(`${sc}: ${id} spans too many steps ${lo}-${hi}`);
      if (e.length < 2 || e.length > 4) bad.push(`${sc}: ${JSON.stringify(e)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("each scene's manifest lists every sprite the scene shows", () => {
  const puppets = puppetSprites();
  const missing = [];
  for (const sc of SCENES) {
    const file = `js/scenes/${sc}.js`;
    const src = read(file);
    const listed = new Set(M.scenes[sc].map((e) => e[0]));
    const need = new Map(); // id -> why
    for (const u of usedSprites([{ file, src }])) need.set(u.id, u.how);
    // every part and face of each puppet the scene makes (hidden faces are painted too)
    const kinds = new Set([...src.matchAll(/AT\.puppet\([^,]+,\s*'(\w+)'/g)].map((m) => m[1]));
    if (/AT\.celebrate\(/.test(src)) { kinds.add('mama'); kinds.add('dada'); need.set('heart', 'AT.celebrate'); }
    for (const k of kinds) for (const id of puppets[k] || []) need.set(id, `puppet ${k}`);
    // shared moments from js/game.js
    if (/AT\.confetti\(|AT\.celebrate\((?![^)]*quiet)/.test(src)) for (let i = 0; i < 6; i++) need.set('confetti' + i, 'confetti');
    if (/AT\.starBar\(/.test(src)) need.set('star_empty', 'AT.starBar');
    if (/AT\.flyStar\(/.test(src)) { need.set('star', 'AT.flyStar'); need.set('sparkle', 'AT.flyStar'); }
    for (const id of ['ui_home', 'ui_sound']) need.set(id, 'HUD');
    for (const [id, why] of need) if (!listed.has(id)) missing.push(`${sc}: ${id} (${why})`);
  }
  assert.deepEqual(missing, [], `sprites a scene shows but its manifest does not list: ${REGEN}`);
});

test('the manifest is a classic script that index.html loads before the game boots', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('js/sprite-manifest.js') > html.indexOf('js/art-scenes.js'), 'after the art');
  assert.ok(html.indexOf('js/sprite-manifest.js') < html.indexOf('AT.boot()'), 'before AT.boot()');
  assert.doesNotMatch(read('js/sprite-manifest.js'), /^\s*(import|export)\s/m);
});
