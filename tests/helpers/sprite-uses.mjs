// Which sprites the game's code uses, found by reading its source (no browser):
// { sprite: 'x' } options, AT.art.img/url/box('x'), node.swap/add('x'), puppet.hold('x'),
// HUD buttons, hub rooms, thought bubbles, particles (E.burst/E.floatUp) and lists of
// sprite names handed around. Shared by tests/unit/sprites.test.mjs (every used sprite is
// defined) and tests/unit/manifest.test.mjs (every used sprite is in its scene's manifest).
import { gameSources, read } from './load-game.mjs';

// Quoted strings in an expression, ignoring comparison operands.
export const literals = (expr) => [...expr.replace(/[!=]==?\s*'[^']*'/g, '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
// Text of `const NAME = [ ... ]` or `NAME = { ... }` in a file.
export const constBody = (src, name) => {
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
export function argAt(src, start, n) {
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

/** Sprite uses in the game's scripts (not the art definitions), as [{file, id, how}]. */
export function usedSprites(sources = gameSources().filter(({ file }) => !/art-(core|characters|props|scenes)\.js$/.test(file))) {
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

/** Puppet kinds (characters.js DEFS) -> every sprite a puppet of that kind shows (parts and face variants). */
export function puppetSprites() {
  const src = read('js/characters.js');
  const defs = src.slice(src.indexOf('const DEFS'), src.indexOf('class Puppet'));
  const out = {};
  for (const m of defs.matchAll(/^ {4}(\w+): \{/gm)) {
    const start = m.index + m[0].length;
    const next = /^ {4}\w+: \{/m.exec(defs.slice(start));
    const body = defs.slice(start, next ? start + next.index : defs.length);
    out[m[1]] = literals(body).filter((s) => /^(at|mm|dd|bb)_/.test(s));
  }
  return out;
}
