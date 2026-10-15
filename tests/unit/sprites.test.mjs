// Sprites: everything the code draws is defined, and every definition turns
// into a well-formed SVG with a sensible box and only known filters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, read } from '../helpers/load-game.mjs';
import { usedSprites, literals } from '../helpers/sprite-uses.mjs';

const game = loadGame();
const A = game.AT.art;
const ids = [...A.list()]; // copy: arrays from the vm realm fail deepStrictEqual
const defined = new Set(ids);

test('the art engine defines ~150 sprites', () => {
  assert.ok(ids.length >= 140, `${ids.length} sprites`);
  assert.equal(new Set(ids).size, ids.length);
});

test('every sprite used by the code is defined', (t) => {
  const uses = usedSprites();
  const used = new Set(uses.map((u) => u.id));
  const charSprites = (id) => /^(at|mm|dd|bb)_/.test(id); // used through puppet DEFS (next test)
  const unused = ids.filter((id) => !used.has(id) && !charSprites(id));
  if (unused.length) t.diagnostic(`defined but not referenced directly: ${unused.join(', ')}`);
  assert.ok(uses.length > 150, `found ${uses.length} sprite uses`);
  const missing = uses.filter((u) => !defined.has(u.id));
  assert.deepEqual(missing, [], 'sprites used but never defined with AT.art.define');
});

test('puppet parts and faces (characters.js DEFS) are defined', () => {
  const src = read('js/characters.js');
  const defs = src.slice(src.indexOf('const DEFS'), src.indexOf('class Puppet'));
  const names = literals(defs).filter((s) => /^(at|mm|dd|bb)_/.test(s));
  assert.ok(names.length > 50, `${names.length} part/face sprites`);
  assert.deepEqual(names.filter((n) => !defined.has(n)), []);
  // every character sprite in the art is used by a puppet (no orphaned faces)
  const charSprites = ids.filter((id) => /^(at|mm|dd|bb)_/.test(id));
  assert.deepEqual(charSprites.filter((id) => !names.includes(id)), []);
});

test('every sprite has a positive, finite box', () => {
  for (const id of ids) {
    const b = A.box(id);
    assert.equal(b.length, 4, id);
    assert.ok(b.every(Number.isFinite), `${id}: box ${b}`);
    assert.ok(b[2] > 0 && b[3] > 0, `${id}: box size ${b[2]}x${b[3]}`);
    assert.ok(b[2] <= 1600 && b[3] <= 900, `${id}: box larger than the stage`);
  }
});

// A tiny XML checker: balanced tags, quoted attributes, no stray text.
function checkSvg(svg) {
  const errs = [];
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|<!--[\s\S]*?-->/g;
  let pos = 0, m;
  while ((m = re.exec(svg))) {
    const between = svg.slice(pos, m.index);
    const inText = ['text', 'tspan', 'title', 'style'].includes(stack[stack.length - 1]);
    if (between.trim() && !inText) errs.push(`stray text "${between.trim().slice(0, 40)}"`);
    pos = re.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    const [, close, name, , self] = m;
    if (close) { const top = stack.pop(); if (top !== name) errs.push(`</${name}> closes <${top}>`); }
    else if (!self) stack.push(name);
  }
  if (svg.slice(pos).trim()) errs.push(`unparsed tail "${svg.slice(pos, pos + 60)}"`);
  if (stack.length) errs.push(`unclosed <${stack.join('>, <')}>`);
  if (/NaN|undefined|Infinity|\[object/.test(svg)) errs.push('NaN/undefined in markup');
  if (/[<>]/.test(svg.replace(re, ''))) errs.push('unbalanced < or >');
  return errs;
}

test('every sprite renders to well-formed SVG with known filters', () => {
  const problems = [];
  for (const id of ids) {
    const svg = A.svgOf(id);
    const errs = checkSvg(svg);
    if (!svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')) errs.push('missing svg root/xmlns');
    const [x, y, w, h] = A.box(id);
    if (!svg.includes(`viewBox="${x} ${y} ${w} ${h}"`)) errs.push('viewBox does not match box');
    const filterIds = new Set([...svg.matchAll(/<filter id="([^"]+)"/g)].map((mm) => mm[1]));
    for (const ref of svg.matchAll(/url\(#([^)]+)\)/g)) if (!filterIds.has(ref[1])) errs.push(`unknown filter #${ref[1]}`);
    if (!/<(path|rect|circle|ellipse|g|text)\b/.test(svg.replace(/<defs>[\s\S]*<\/defs>/, ''))) errs.push('draws nothing');
    if (errs.length) problems.push(`${id}: ${errs.join('; ')}`);
  }
  assert.deepEqual(problems, []);
});

test('sprite SVGs are deterministic (same input, same picture)', () => {
  const again = loadGame({ only: ['art-'] }).AT.art;
  for (const id of ids) assert.equal(again.svgOf(id), A.svgOf(id), id);
});
