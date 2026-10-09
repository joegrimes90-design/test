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
 * @param {boolean} [opts.voice] include js/voice-data.js (2.2 MB, default false)
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

// All game source files (not the generated voice data), as {file, src}.
export function gameSources() {
  return scriptList().filter((f) => !f.includes('voice-data')).map((file) => ({ file, src: read(file) }));
}
