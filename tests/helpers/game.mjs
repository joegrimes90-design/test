// Shared browser helpers for the e2e and visual suites.
//
// - prepare(page): seeds Math.random (so every run sees the same "random"
//   particles, blinks and delays) and installs the in-page auto-player.
// - openGame(page, {scene}): loads index.html?manual=1 (clock stopped, see
//   installTestHook in js/engine.js) and waits until the scene is built.
// - stepUntil / advance / autoPlay: move the game clock in fixed steps.
//   While the clock is fast-forwarded the stage is hidden (visibility only;
//   layout and game logic are untouched), because painting this game's
//   filter-heavy sprites costs 100-300 ms per frame (and live SVG sprites are
//   shown until their bitmaps are painted). The stage is shown again for every
//   tap/rub and before every screenshot.
import { expect } from '@playwright/test';

export const SEED = 20251009;

/** Page-side code: seeded Math.random and the auto-player. Runs before any game script. */
function pageInit({ seed, audio }) {
  // mulberry32: tiny, fast, good enough for particles
  let s = seed >>> 0;
  Math.random = function random() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  if (!audio) {
    // Visual tests run silent: the music scheduler calls Math.random from a
    // real-time setInterval, which would make particle positions depend on
    // wall-clock timing.
    window.AudioContext = undefined;
    window.webkitAudioContext = undefined;
  }

  const FF_ID = '__test_ff';
  const stage = () => document.getElementById('stage');
  const hide = () => {
    if (!document.getElementById(FF_ID)) {
      const st = document.createElement('style');
      st.id = FF_ID;
      st.textContent = '#stage{visibility:hidden!important}';
      document.head.appendChild(st);
    }
  };
  const show = () => { const st = document.getElementById(FF_ID); if (st) st.remove(); };
  // on screen: has a size, isn't display:none, and overlaps the stage
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0) || getComputedStyle(el).display === 'none') return false;
    const s = stage().getBoundingClientRect();
    return r.right > s.left && r.left < s.right && r.bottom > s.top && r.top < s.bottom;
  };
  const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  // Centre of a sprite's box in CSS px, from the game's geometry rather than the
  // <img> element, whose size differs a little between bitmap and SVG mode
  // (AT.art), so both modes make exactly the same moves.
  const spriteCentre = (im) => {
    const M = window.AT && AT.art && AT.art.deviceMatrix && AT.art.deviceMatrix(im);
    if (!M) return centre(im.getBoundingClientRect());
    const b = AT.art.box(im.dataset.sprite), d = window.devicePixelRatio || 1;
    const p = M.transformPoint(new DOMPoint(b[2] / 2, b[3] / 2));
    return { x: p.x / d, y: p.y / d };
  };
  const k = () => stage().getBoundingClientRect().width / 1600; // CSS px per stage px
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const opacityOf = (el) => parseFloat(el.style.opacity === '' ? 1 : el.style.opacity);

  const auto = {
    hide, show, lastRub: null, rubTarget: null, actions: 0,
    // a zig-zag scrub path around (x, y) in CSS px, amplitude in stage px
    path(x, y, ax, ay) {
      const s = k();
      return Array.from({ length: 24 }, (_, i) => [x + Math.sin(i) * ax * s, y + Math.cos(i * 1.3) * ay * s]);
    },
    // What would a child do now? Mirrors tools/playtest.mjs:
    // tap the glowing thing (the one the hint hand points at if several),
    // brush the dirty teeth, rub where the hand points.
    find() {
      const root = stage();
      const hand = [...root.querySelectorAll('img[data-sprite="hand"]')].find(vis);
      const handPt = hand ? (() => { const r = hand.parentNode.getBoundingClientRect(); return { x: r.left, y: r.top }; })() : null;
      const glows = [...root.querySelectorAll('.glowring')].filter(vis)
        .map((g) => g.parentNode.querySelector(':scope > .hit.on')).filter(Boolean);
      if (glows.length) {
        auto.rubTarget = null;
        let target = glows.length === 1 ? glows[0] : null;
        if (!target && handPt) target = glows.reduce((a, b) => (dist(centre(b.getBoundingClientRect()), handPt) < dist(centre(a.getBoundingClientRect()), handPt) ? b : a));
        if (!target) return null; // several choices: wait for the hint hand
        auto.tapTarget = target;
        return { type: 'tap', ...centre(target.getBoundingClientRect()), what: target.parentNode.querySelector(':scope > img')?.dataset.sprite || 'node' };
      }
      const dirt = [...root.querySelectorAll('img[data-sprite="tooth_dirt"]')].find((im) => vis(im) && opacityOf(im.parentNode) > 0.02);
      if (dirt) {
        const op = opacityOf(dirt.parentNode);
        const lr = auto.lastRub;
        // brushing hasn't started yet (narration still playing): wait a second
        if (lr && lr.el === dirt && lr.op === op && AT.engine.time - lr.time < 1) return null;
        auto.lastRub = { el: dirt, op, time: AT.engine.time };
        const c = spriteCentre(dirt);
        return { type: 'rub', path: auto.path(c.x, c.y, 40, 20), what: 'tooth_dirt' };
      }
      if (handPt) {
        const cands = [...root.querySelectorAll('.hit.on')].filter(vis);
        if (cands.length) {
          auto.rubTarget = cands.reduce((a, b) => (dist(centre(b.getBoundingClientRect()), handPt) < dist(centre(a.getBoundingClientRect()), handPt) ? b : a));
        } else {
          return { type: 'rub', path: auto.path(handPt.x, handPt.y, 40, 20), what: 'hand' };
        }
      }
      const t = auto.rubTarget;
      if (t && t.isConnected && t.classList.contains('on') && vis(t)) {
        const r = t.getBoundingClientRect();
        const c = centre(r);
        const s = k();
        return { type: 'rub', path: auto.path(c.x, c.y, Math.min(60, (0.3 * r.width) / s), Math.min(30, (0.3 * r.height) / s)), what: 'rub-area' };
      }
      auto.rubTarget = null;
      return null;
    },
    // Called with the stage visible: pick a point where the tap target is on top.
    aim() {
      const t = auto.tapTarget;
      const r = t.getBoundingClientRect();
      const hits = (x, y) => { const e = document.elementFromPoint(x, y); return e && (e === t || t.contains(e)); };
      const c = centre(r);
      if (hits(c.x, c.y)) return c;
      for (let j = 1; j < 6; j++) for (let i = 1; i < 6; i++) {
        const x = r.left + (r.width * i) / 6, y = r.top + (r.height * j) / 6;
        if (hits(x, y)) return { x, y };
      }
      return c;
    },
    // Step the clock (stage hidden) until `until()` holds, or until the auto-player
    // has something to do (when `act`). Always steps at least once.
    async advance(untilSrc, maxClock, fps, act) {
      const until = untilSrc ? (0, eval)(`(${untilSrc})`) : () => false;
      hide();
      const E = AT.engine;
      const end = E.time + maxClock;
      for (;;) {
        await window.__test.step(1 / fps, fps);
        if (until()) return { done: true, time: E.time };
        if (act) { const a = auto.find(); if (a) { auto.actions++; return { action: a, time: E.time }; } }
        if (E.time >= end) return { stuck: true, time: E.time, scene: AT.sceneName };
      }
    },
  };
  window.__auto = auto;
}

/** Seed randomness and install the auto-player. Call before page.goto(). */
export async function prepare(page, { seed = SEED, audio = true } = {}) {
  await page.addInitScript(pageInit, { seed, audio });
}

/** Load the game in manual-clock mode and wait until `scene` is built (clock still at 0). */
export async function openGame(page, { scene = 'title', manual = true, query = {} } = {}) {
  const q = new URLSearchParams();
  if (scene !== 'title') q.set('scene', scene);
  if (manual) q.set('manual', '1');
  // AT_RASTER=svg runs a suite on the plain SVG sprites (the bitmap layer's kill switch)
  if (process.env.AT_RASTER && !('raster' in query)) q.set('raster', process.env.AT_RASTER);
  for (const [k, v] of Object.entries(query)) q.set(k, v);
  await page.goto('/index.html?' + q);
  await page.waitForFunction((s) => performance.getEntriesByName('at:built:' + s).length > 0, scene, { timeout: 60_000 });
}

const src = (fn) => (typeof fn === 'function' ? fn.toString() : fn);

/** Advance the clock (stage hidden) until `until` (a function run in the page) returns truthy. */
export async function stepUntil(page, until, { maxClock = 120, fps = 10 } = {}) {
  const r = await page.evaluate(({ u, maxClock, fps }) => window.__auto.advance(u, maxClock, fps, false), { u: src(until), maxClock, fps });
  if (!r.done) throw new Error(`condition not reached after ${maxClock}s of game clock (scene ${r.scene}, t=${r.time.toFixed(1)}): ${src(until)}`);
  return r.time;
}

/** Advance the clock by exactly `sec` seconds in 1/fps steps (stage hidden). */
export async function step(page, sec, fps = 30) {
  return page.evaluate(async ({ sec, fps }) => { window.__auto.hide(); return window.__test.step(sec, fps); }, { sec, fps });
}

export const reveal = (page) => page.evaluate(() => window.__auto.show());
export const hideStage = (page) => page.evaluate(() => window.__auto.hide());

/** Wait until the scene `name` has faded in (stepping the clock). */
export const waitShown = (page, name, opts) =>
  stepUntil(page, `() => performance.getEntriesByName('at:shown:${name}').length > 0`, opts);

/** Click a point given in stage coordinates (1600x900 space). */
export async function tapStage(page, x, y) {
  await reveal(page);
  const p = await page.evaluate(([x, y]) => {
    const r = document.getElementById('stage').getBoundingClientRect();
    return { x: r.left + (x * r.width) / 1600, y: r.top + (y * r.height) / 900 };
  }, [x, y]);
  await page.mouse.click(p.x, p.y);
}

/** Click the centre of the first element matching `selector` (stage shown first). */
export async function tapElement(page, selector) {
  await reveal(page);
  const p = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  expect(p, `element ${selector}`).not.toBeNull();
  await page.mouse.click(p.x, p.y);
}

/**
 * Play the current scene like a child would until `until` holds in the page.
 * Returns {time, actions, log}. Throws if nothing happens for `idleClock` seconds.
 */
export async function autoPlay(page, until, { maxClock = 900, idleClock = 60, fps = 10, maxActions = 600 } = {}) {
  const log = [];
  const t0 = await page.evaluate(() => AT.engine.time);
  for (let i = 0; i < maxActions; i++) {
    const r = await page.evaluate(({ u, idleClock, fps }) => window.__auto.advance(u, idleClock, fps, true), { u: src(until), idleClock, fps });
    if (r.done) return { time: r.time, actions: log.length, log };
    if (r.stuck) throw new Error(`auto-player stuck: nothing to do for ${idleClock}s of game clock (scene ${r.scene}, t=${r.time.toFixed(1)}); last actions: ${log.slice(-8).join(', ')}`);
    if (r.time - t0 > maxClock) throw new Error(`auto-player ran out of time (${maxClock}s of game clock)`);
    const a = r.action;
    log.push(`${a.type}:${a.what}@${r.time.toFixed(1)}`);
    await reveal(page);
    if (a.type === 'tap') {
      const p = await page.evaluate(() => window.__auto.aim());
      await page.mouse.click(p.x, p.y);
    } else {
      for (const [x, y] of a.path) await page.mouse.move(x, y);
    }
  }
  throw new Error(`auto-player gave up after ${maxActions} actions`);
}

/** Wait for sprite bitmaps, fonts and every image to be decoded, with the stage shown. */
export async function settleForScreenshot(page) {
  await reveal(page);
  await page.evaluate(async () => {
    if (window.AT && AT.art && AT.art.idle) await AT.art.idle();
    await document.fonts.ready;
    await Promise.all([...document.querySelectorAll('img')].map((im) => im.decode().catch(() => {})));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}
