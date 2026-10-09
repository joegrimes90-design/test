// Sprites: everything the code draws is defined, and every definition turns
// into a well-formed SVG with a sensible box and only known filters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, gameSources, read } from '../helpers/load-game.mjs';

const game = loadGame();
const A = game.AT.art;
const ids = [...A.list()]; // copy: arrays from the vm realm fail deepStrictEqual
const defined = new Set(ids);
const sources = gameSources().filter(({ file }) => !/art-(core|characters|props|scenes)\.js$/.test(file));

// Quoted strings in an expression, ignoring comparison operands.
const literals = (expr) => [...expr.replace(/[!=]==?\s*'[^']*'/g, '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
// Text of `const NAME = [ ... ]` or `NAME = { ... }` in a file.
const constBody = (src, name) => {
  const m = new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*([\\[{])`).exec(src);
  if (!m) return null;
  const open = m[1], close = open === '[' ? ']' : '}';
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(m.index + m[0].length, i);
  }
  return null;
};
// Argument number `n` (0-based) of the call starting at `start` (just after the "(")
function argAt(src, start, n) {
  let depth = 0, cur = '', idx = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) { if (depth === 0) return idx === n ? cur : null; depth--; }
    if (ch === ',' && depth === 0) { if (idx === n) return cur; idx++; cur = ''; continue; }
    cur += ch;
  }
  return null;
}

function usedSprites() {
  const uses = []; // {file, id, how}
  const add = (file, how, list) => list.forEach((id) => uses.push({ file, id, how }));
  for (const { file, src } of sources) {
    // { sprite: 'x' } and { sprite: cond ? 'a' : 'b' } and { sprite: E.pick(list) }
    for (const m of src.matchAll(/sprite\s*:\s*([^,}]+)/g)) {
      const expr = m[1];
      add(file, 'sprite:', literals(expr.replace(/'\w+'\s*\+\s*\w+/g, '')));
      const pick = /E\.pick\((\w+)\)/.exec(expr);
      if (pick) add(file, `E.pick(${pick[1]})`, literals(constBody(src, pick[1]) || ''));
      const concat = /'(\w+_)'\s*\+\s*(\w+)/.exec(expr);
      if (concat) add(file, 'concat', ['potty', 'teeth', 'baby'].map((k) => concat[1] + k));
    }
    // AT.art.img/url/box('x'), node.swap('x'), node.add('x'), puppet.hold('x'), hudButton(id, 'x')
    for (const m of src.matchAll(/(AT\.art\.(?:img|url|box)|\.swap|(?<!classList)\.add|\.hold)\(/g)) {
      add(file, m[1], literals(argAt(src, m.index + m[0].length, 0) || ''));
    }
    for (const m of src.matchAll(/hudButton\(/g)) add(file, 'hudButton', literals(argAt(src, m.index + m[0].length, 1) || ''));
    // hub.js mk('room_teeth', x, y) helper
    for (const m of src.matchAll(/\bmk\('([^']+)'/g)) add(file, 'mk', [m[1]]);
    // baby.js think(c, 'teddy', s)
    for (const m of src.matchAll(/this\.think\(/g)) add(file, 'think', literals(argAt(src, m.index + m[0].length, 1) || ''));
    // particles: E.burst(layer, sprites, ...) and E.floatUp(layer, sprite, ...)
    for (const m of src.matchAll(/E\.(burst|floatUp)\(/g)) {
      const arg = (argAt(src, m.index + m[0].length, 1) || '').trim();
      if (/^\w+$/.test(arg)) {
        const body = constBody(src, arg);
        if (body) add(file, `${m[1]}(${arg})`, literals(body));
      } else add(file, m[1], literals(arg));
    }
    // lists of sprite names handed around: badge: 'x', badgeFor = {...}, bugSprites = [...], colours = [...]
    for (const m of src.matchAll(/badge\s*:\s*'([^']+)'/g)) add(file, 'badge:', [m[1]]);
    for (const name of ['badgeFor', 'bugSprites', 'sprites', 'colours']) {
      const body = constBody(src, name);
      if (body && /'\w+_\w+'|'confetti\d'/.test(body)) add(file, name, literals(body).filter((s) => /_|\d/.test(s) && !s.startsWith('#')));
    }
  }
  return uses;
}

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
