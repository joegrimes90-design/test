// The generated sprite manifest (js/sprite-manifest.js, written by tools/sprite-manifest.mjs)
// is current, as far as reading the scene code can tell: each scene's list holds every sprite its
// code shows, and every sprite placed at a literal scale on a stage-wide layer at that scale, so the
// game can paint them before the scene asks rather than during play. (Scales that come from playing
// a scene, such as tweens and puppets, are checked by the end-to-end playthroughs: nothing may be
// painted during play, AT.art.stats().playMisses.)
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

test('a sprite placed at a literal scale on a stage-wide layer is listed at that scale', () => {
  // E.node(W | E.world | E.ui | I, { sprite: 'id' }).set({ ..., s: N }): W is E.world (the camera never
  // zooms) and I a close-up card's inner layer (scale 1 once the card is open), so the scene shows the
  // sprite at N, at rest; its manifest must list it at N (or in a range of random sizes around N), or it
  // is painted during play. (A stale scale, not just a missing sprite: the hand-washing sink at s 2.6.)
  const stale = [];
  let checked = 0;
  for (const sc of SCENES) {
    const src = read(`js/scenes/${sc}.js`);
    for (const m of src.matchAll(/E\.node\((W|E\.world|E\.ui|I)\s*,\s*\{\s*sprite:\s*'(\w+)'\s*\}\)\.set\(\{([^}]*)\}\)/g)) {
      const lit = /(?:^|[\s,])s:\s*([0-9.]+)\s*(?:,|$)/.exec(m[3]);
      const n = lit ? +lit[1] : 0;
      if (!(n > 0)) continue; // (s: 0 pops in with a tween: its steps are recorded by playing it)
      checked++;
      const es = M.scenes[sc].filter((e) => e[0] === m[2]);
      const exact = es.some((e) => e.length === 2 && Math.abs(e[1] / n - 1) < 1e-3);
      const random = es.some((e) => e.length === 4 && e[3] === 0 && e[1] <= n * 1.001 && e[2] >= n / 1.001);
      if (!exact && !random) stale.push(`${sc}: ${m[2]} at s ${n} (listed: ${JSON.stringify(es.map((e) => e.slice(1)))})`);
    }
  }
  assert.ok(checked > 30, `only ${checked} literal scales found: has the scene code changed shape?`);
  assert.deepEqual(stale, [], `sprites listed at other scales than the scene places them: ${REGEN}`);
});

test('a step listed at the manifest\'s own size is one bitmap there, and every scale it stands for is listed on other screens', () => {
  // AT.art.sceneList at devicePixelRatio u (no stage yet: the unit is the device pixel ratio)
  const listAt = (u, sc) => { game.devicePixelRatio = u; try { return new Set(A.sceneList(sc).map(([id, k]) => `${id}@${k.toFixed(3)}`)); } finally { delete game.devicePixelRatio; } };
  const round3 = (k) => Math.round(k * 1000) / 1000;
  const bucketUp = (k, n) => round3(Math.pow(2, Math.ceil(n * Math.log2(k) - 1e-6) / n));
  const REF = M.unit;
  assert.equal(REF, 1.6, 'the manifest records the unit it was made at (1280x720 at 2x)');
  const bad = [];
  for (const sc of SCENES) {
    // the manifest's own size: exactly what each row says, nothing more
    const ref = listAt(REF, sc), want = new Set();
    for (const e of M.scenes[sc]) {
      if (!A.has(e[0])) continue;
      if (e.length === 2) want.add(`${e[0]}@${round3(e[1] * REF).toFixed(3)}`);
      else if (e.length === 3) want.add(`${e[0]}@${bucketUp(e[1] * REF, e[2]).toFixed(3)}`);
      else if (e[3] > 0) for (let j = Math.ceil(e[3] * Math.log2(e[1] * REF) - 1e-6); j <= Math.ceil(e[3] * Math.log2(e[2] * REF) - 1e-6); j++) want.add(`${e[0]}@${round3(Math.pow(2, j / e[3])).toFixed(3)}`);
    }
    assert.deepEqual([...ref].sort(), [...want].sort(), `${sc} at the manifest's own size`);
    // another screen (1194x834 at 2x: 1.4925; 1024x768 at 1x: 0.64): a scale anywhere in a listed
    // step's window there (the scales that came out as that step at the manifest's size) is listed
    // (but for tweens to random sizes: more than 4 steps of one sprite, painted at the steps seen)
    const steps8 = {};
    for (const e of M.scenes[sc]) if (e.length === 3 && e[2] === 8) steps8[e[0]] = (steps8[e[0]] || 0) + 1;
    for (const u of [1.4925, 0.64]) {
      const other = listAt(u, sc);
      for (const e of M.scenes[sc]) {
        if (e.length !== 3 || !A.has(e[0]) || (e[2] === 8 && steps8[e[0]] > 4)) continue;
        const n = e[2], j = Math.ceil(n * Math.log2(e[1] * REF) - 1e-6);
        const lo = Math.pow(2, (j - 1) / n) / REF, hi = Math.pow(2, j / n) / REF;
        for (const rel of [lo * 1.0001, (lo + hi) / 2, hi]) {
          const key = `${e[0]}@${bucketUp(rel * u, n).toFixed(3)}`;
          if (!other.has(key)) bad.push(`${sc} at ${u}: ${JSON.stringify(e)} at ${rel.toFixed(4)} needs ${key}`);
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 20), []);
});

test('an exact row\'s key is rounded from the scale the sprite\'s own matrix gives, below 1 as well', () => {
  // A sprite's scale is the stage's (single precision: DOMMatrix.scale(); at 1194x834 at 2x,
  // 1.49249995) times its node's as the CSS transform parses (single precision: scale(0.6000) is
  // 0.60000002), multiplied in double precision: the thought bubbles' icons at s 0.6 come out at
  // 0.89550000 (key 0.896). The plain product 0.6 x 1.49249995 = 0.89549997 would make it 0.895:
  // painted twice behind the cover, and again during play.
  const listAt = (u, sc) => { game.devicePixelRatio = u; try { return A.sceneList(sc).filter(([id]) => id === (sc === 'baby' ? 'bottle' : 'potty')).map(([, k]) => k); } finally { delete game.devicePixelRatio; } };
  const u = Math.fround(1.4925);
  assert.ok(M.scenes.potty.some((e) => e[0] === 'potty' && e.length === 2 && e[1] === 0.6), 'potty lists its bubble\'s potty at 0.6');
  assert.ok(M.scenes.baby.some((e) => e[0] === 'bottle' && e.length === 2 && e[1] === 0.6), 'baby lists its bubble\'s bottle at 0.6');
  assert.equal(Math.round(u * 0.6 * 1000) / 1000, 0.895, '(the plain product rounds down)');
  for (const sc of ['potty', 'baby']) {
    const ks = listAt(u, sc);
    assert.ok(ks.includes(0.896), `${sc} at 1194x834 at 2x: ${JSON.stringify(ks)}`);
    assert.ok(!ks.includes(0.895), `${sc} at 1194x834 at 2x: not the plain product's key`);
  }
});

test('the manifest is a classic script that index.html loads before the game boots', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('js/sprite-manifest.js') > html.indexOf('js/art-scenes.js'), 'after the art');
  assert.ok(html.indexOf('js/sprite-manifest.js') < html.indexOf('AT.boot()'), 'before AT.boot()');
  assert.doesNotMatch(read('js/sprite-manifest.js'), /^\s*(import|export)\s/m);
});
