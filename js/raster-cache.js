/* Painted sprite bitmaps kept across visits (IndexedDB), so a returning player's
 * scenes appear without painting anything.
 *
 * js/art-core.js paints each sprite into a PNG once per device scale k. Those PNGs
 * are stored here, lossless, under a key covering everything that affects their
 * pixels: the sprite id, a hash of its SVG text (editing a drawing or AT.palette
 * changes it), k, the browser build (user agent) and CACHE_VERSION (bump it when
 * the painting or the scale-to-pixels mapping in art-core changes). At boot one
 * readonly getAll() loads every record (the blobs stay on disk until an image
 * reads them); art-core looks keys up synchronously and checks a hit's size when
 * it decodes it (a wrong-size record is deleted and the bitmap painted again).
 * New bitmaps are written in one transaction when the browser is idle after a
 * scene has faded in (never while painting behind a cover). Housekeeping, once a
 * session when idle: records for other drawings, browsers or versions go, at most
 * 32 scales are kept per sprite, and the least recently used go above 150 MB.
 * Where IndexedDB is missing or refused (some file:// pages, sandboxed iframes,
 * private windows) or slow to open, the game simply paints as on a first visit.
 * Nothing here logs console errors.
 */
window.AT = window.AT || {};

AT.rasterCache = (() => {
  const DB_NAME = 'atticus-raster';
  const CACHE_VERSION = 1;
  const OPEN_MS = 400;          // give up on IndexedDB if it has not opened by then
  const LOAD_MS = 1500;         // ... or if reading the records takes longer than this
  const MAX_BYTES = 150 * 1048576;
  const MAX_PER_SPRITE = 32;
  const fnv = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  };
  const uaTag = fnv((typeof navigator !== 'undefined' && navigator.userAgent) || '');
  const key = (id, hash, k) => `${id}|${hash}|${k.toFixed(3)}|${uaTag}|${CACHE_VERSION}`;

  let db = null;               // IDBDatabase once open, else null
  let loading = null;          // Promise: records loaded (or given up)
  const records = new Map();   // key -> {key, id, hash, k, cw, ch, ms, bytes, blob, created}
  const used = new Map();      // key -> last use (Date.now())
  const pending = new Map();   // key -> record to write
  const touched = new Set();   // keys used this session (their 'used' time is written)
  const deleted = new Set();   // keys to delete
  const st = { available: false, loaded: 0, loadMs: 0, hits: 0, writes: 0, deletes: 0, errors: 0 };
  let flushing = null, flushQueued = false, housekept = false;

  const timeout = (p, ms) => new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
  const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

  function openDb() {
    return new Promise((resolve, reject) => {
      let r;
      try {
        // (throws synchronously in sandboxed iframes and some file:// pages)
        r = indexedDB.open(DB_NAME, 1);
      } catch (e) { reject(e); return; }
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('bm')) d.createObjectStore('bm', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('used')) d.createObjectStore('used', { keyPath: 'key' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('blocked'));
    });
  }

  // Open the database and read every record: call early (AT.boot); resolves when done or given up.
  function load() {
    if (loading) return loading;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    loading = (async () => {
      if (typeof indexedDB === 'undefined' || !indexedDB) return false;
      const opening = openDb();
      const d = await timeout(opening, OPEN_MS);
      if (!d) {
        // slow to open: carry on without it now, but still store this visit's bitmaps if it opens later
        opening.then((late) => { db = late; st.available = true; late.onversionchange = () => { late.close(); db = null; }; }, () => {});
        return false;
      }
      db = d;
      st.available = true;
      d.onversionchange = () => { d.close(); db = null; };
      const all = await timeout((async () => {
        const tx = d.transaction(['bm', 'used'], 'readonly');
        return Promise.all([req(tx.objectStore('bm').getAll()), req(tx.objectStore('used').getAll())]);
      })(), LOAD_MS);
      if (!all) return false;
      for (const r of all[0]) if (r && r.key && r.blob) records.set(r.key, r);
      for (const u of all[1]) if (u && u.key) used.set(u.key, u.used);
      st.loaded = records.size;
      return true;
    })().catch(() => { st.errors++; return false; }).then((ok) => {
      if (typeof performance !== 'undefined') st.loadMs = Math.round(performance.now() - t0);
      return ok;
    });
    return loading;
  }

  // The stored record for this bitmap, or null. (Synchronous: from the records loaded at boot.)
  function get(id, hash, k) {
    const r = records.get(key(id, hash, k));
    if (!r || deleted.has(r.key)) return null;
    return r;
  }
  // A stored record was just used to show a bitmap.
  function touch(r) { st.hits++; touched.add(r.key); used.set(r.key, Date.now()); }
  // Store a freshly painted bitmap (written later, when idle).
  function put(id, hash, k, entry) {
    if (!entry || !entry.blob) return;
    const r = { key: key(id, hash, k), id, hash, k, cw: entry.cw, ch: entry.ch, ms: Math.round(entry.ms || 0), bytes: entry.blob.size, blob: entry.blob, created: Date.now() };
    records.set(r.key, r);
    used.set(r.key, r.created);
    deleted.delete(r.key);
    pending.set(r.key, r);
  }
  // A record turned out to be unusable (wrong size, unreadable): forget it.
  function drop(r) {
    if (!r) return;
    records.delete(r.key);
    pending.delete(r.key);
    used.delete(r.key);
    deleted.add(r.key);
  }

  // Write what is pending in one readwrite transaction. Resolves when it is committed (or failed).
  function flush() {
    if (flushing) return flushing.then(() => (pending.size || deleted.size || touched.size ? flush() : undefined));
    if (!db || (!pending.size && !deleted.size && !touched.size)) return Promise.resolve();
    const puts = [...pending.values()], dels = [...deleted], uses = [...touched];
    pending.clear(); deleted.clear(); touched.clear();
    flushing = new Promise((resolve) => {
      try {
        const tx = db.transaction(['bm', 'used'], 'readwrite');
        const bm = tx.objectStore('bm'), us = tx.objectStore('used');
        for (const r of puts) { bm.put(r); us.put({ key: r.key, used: used.get(r.key) || r.created }); }
        for (const k of uses) if (records.has(k)) us.put({ key: k, used: used.get(k) });
        for (const k of dels) { bm.delete(k); us.delete(k); }
        tx.oncomplete = () => { st.writes += puts.length; st.deletes += dels.length; resolve(); };
        tx.onerror = tx.onabort = (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); st.errors++; resolve(); };
      } catch (e) { st.errors++; resolve(); }
    }).then(() => { flushing = null; });
    return flushing;
  }
  // Flush when the browser is idle (called after a scene has faded in).
  const whenIdle = (fn, ms) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: ms }) : setTimeout(fn, 200));
  function flushSoon() {
    if (flushQueued || !db) return;
    flushQueued = true;
    whenIdle(() => { flushQueued = false; flush(); }, 3000);
  }

  // Once a session, when idle: forget records that can never be used again, keep at most
  // MAX_PER_SPRITE scales per sprite, then the most recently used within MAX_BYTES.
  // hashOf(id): the current SVG hash of a sprite, or null if there is no such sprite.
  function housekeep(hashOf) {
    if (housekept || !db) return Promise.resolve();
    housekept = true;
    return new Promise((resolve) => whenIdle(resolve, 5000)).then(() => {
      const keep = [];
      for (const r of records.values()) {
        const h = hashOf(r.id);
        if (!h || h !== r.hash || r.key !== key(r.id, r.hash, r.k)) drop(r);
        else keep.push(r);
      }
      const last = (r) => used.get(r.key) || r.created || 0;
      keep.sort((a, b) => last(b) - last(a));
      const perId = new Map();
      let bytes = 0;
      for (const r of keep) {
        const n = (perId.get(r.id) || 0) + 1;
        perId.set(r.id, n);
        bytes += r.bytes || 0;
        if (n > MAX_PER_SPRITE || bytes > MAX_BYTES) drop(r);
      }
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* best effort */ }
      return flush();
    });
  }

  function stats() {
    let bytes = 0;
    for (const r of records.values()) bytes += r.bytes || 0;
    return { ...st, records: records.size, bytes, pending: pending.size };
  }

  // leaving or hiding the page: write what is pending (best effort)
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('pagehide', () => { flush(); });
  }

  return { load, get, touch, put, drop, flush, flushSoon, housekeep, stats, key, CACHE_VERSION };
})();
