// Load the game's classic <script> files into a Node vm context, with just
// enough of a window/document shim for their top-level code to run. Nothing
// here touches a real DOM: the art engine's define()/svgOf() are pure, and the
// scene/cartoon/audio modules only define objects until the game boots.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// The script order from index.html (the single source of truth).
export function scriptList() {
  const html = read('index.html');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
}

const noop = () => {};
function fakeElement() {
  const el = {
    style: {}, dataset: {}, children: [],
    classList: { add: noop, remove: noop, contains: () => false, toggle: noop },
    appendChild: (c) => { el.children.push(c); return c; },
    insertBefore: (c) => c, removeChild: noop, replaceChild: noop, remove: noop,
    addEventListener: noop, removeEventListener: noop, setAttribute: noop,
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  };
  return el;
}

/**
 * @param {object} [opts]
 * @param {string[]} [opts.only] load only scripts whose path matches one of these substrings
 * @param {boolean} [opts.voice] include the narration audio, js/voice-data.js (1.7 MB, default false;
 *   the small js/voice-index.js with every line's text and duration is always loaded)
 * @param {object} [opts.globals] extra globals for the context (e.g. a fake OfflineAudioContext)
 */
export function loadGame(opts = {}) {
  let blobN = 0;
  const storage = new Map();
  const ctx = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    atob, btoa,
    Blob: class { constructor(parts, o) { this.parts = parts; this.type = o && o.type; } },
    URL: { createObjectURL: () => `blob:test/${++blobN}`, revokeObjectURL: noop },
    URLSearchParams,
    // (a real MessageChannel would keep the Node process alive)
    MessageChannel: class { constructor() { const p1 = { onmessage: null }; this.port1 = p1; this.port2 = { postMessage: () => setImmediate(() => p1.onmessage && p1.onmessage({})) }; } },
    performance: { mark: noop, now: () => 0, getEntriesByName: () => [] },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    location: { search: '' },
    navigator: {},
    requestAnimationFrame: (fn) => { ctx.rafCalls = (ctx.rafCalls || 0) + 1; },
    addEventListener: noop, removeEventListener: noop,
    innerWidth: 1600, innerHeight: 900,
    document: {
      createElement: fakeElement,
      getElementById: fakeElement,
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener: noop, removeEventListener: noop,
      documentElement: fakeElement(), body: fakeElement(),
    },
    ...(opts.globals || {}),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const files = scriptList().filter((f) => (opts.voice || !f.includes('voice-data')) && (!opts.only || opts.only.some((s) => f.includes(s))));
  for (const f of files) vm.runInContext(read(f), ctx, { filename: f });
  return ctx;
}

// All game source files (not the generated js/voice-*.js narration files), as {file, src}.
export function gameSources() {
  return scriptList().filter((f) => !f.startsWith('js/voice-')).map((file) => ({ file, src: read(file) }));
}

export const VOICE_FILES = ['js/voice-index.js', 'js/voice-data.js', 'js/voice-cartoons.js'];
/**
 * The narration files on their own (index, game audio, cartoon audio), run with a
 * stand-in AT.addVoiceAudio. `readFile(path)` returns a file's text or null (default:
 * the working tree), so the same loader reads older versions from git.
 * Returns {index: AT_VOICE, scenes: AT_VOICE_SCENES, audio: {game: {id: base64}, cartoons: {...}}}.
 */
export function loadVoice(readFile = (p) => (fs.existsSync(path.join(ROOT, p)) ? read(p) : null)) {
  const window = {};
  const audio = {};
  const AT = { addVoiceAudio: (map, part = 'game') => { audio[part] = Object.assign(audio[part] || {}, map); } };
  const ctx = vm.createContext({ window, AT });
  for (const f of VOICE_FILES) {
    const src = readFile(f);
    if (src != null) vm.runInContext(src, ctx, { filename: f });
  }
  return { index: window.AT_VOICE || {}, scenes: window.AT_VOICE_SCENES || null, audio };
}
