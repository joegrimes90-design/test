// Sound pauses in js/audio.js, against a fake AudioContext: AT.audio.hold() (the game
// clock paused while sprites are repainted after a resize, js/game.js) and a hidden page
// (visibilitychange) can overlap, and sound comes back only when both are over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/load-game.mjs';

class FakeAudioContext {
  constructor() { this.state = FakeAudioContext.initial || 'running'; this.refuse = !!FakeAudioContext.refuse; this.sampleRate = 48000; this.currentTime = 0; this.destination = {}; FakeAudioContext.last = this; }
  node(extra) { return { connect() {}, disconnect() {}, ...extra }; }
  createGain() { return this.node({ gain: { value: 1 } }); }
  createDynamicsCompressor() { const p = { value: 0 }; return this.node({ threshold: p, ratio: p, attack: p, release: p }); }
  createBuffer(ch, len, sr) { return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr }; }
  createBufferSource() { return this.node({ buffer: null, start() {}, stop() {} }); }
  // (the statechange event comes a task later, as in browsers; refuse: no tap allowed sound yet)
  resume() {
    this.resumes = (this.resumes || 0) + 1;
    if (this.refuse) return Promise.reject(new Error('not allowed'));
    this.state = 'running'; this.later(); return Promise.resolve();
  }
  suspend() { this.state = 'suspended'; this.later(); return Promise.resolve(); }
  later() { setTimeout(() => { if (this.onchange) this.onchange(); }, 0); }
  addEventListener(type, fn) { if (type === 'statechange') this.onchange = fn; }
  set(state) { this.state = state; if (this.onchange) this.onchange(); }
}

function boot() {
  // the helper's own fake document (no game scripts run for it), recording its listeners
  const listeners = {};
  const doc = { ...loadGame({ only: ['(none)'] }).document, hidden: false };
  doc.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  const game = loadGame({ globals: { document: doc, AudioContext: FakeAudioContext } });
  const setHidden = (h) => { doc.hidden = h; (listeners.visibilitychange || []).forEach((fn) => fn({ type: 'visibilitychange' })); };
  game.AT.audio.unlock();
  return { AT: game.AT, ctx: FakeAudioContext.last, setHidden };
}

test('a hidden page suspends sound and brings it back', () => {
  const { ctx, setHidden } = boot();
  assert.equal(ctx.state, 'running');
  setHidden(true);
  assert.equal(ctx.state, 'suspended');
  setHidden(false);
  assert.equal(ctx.state, 'running');
});

test('coming back to the page while a resize repaint holds the sound keeps it quiet until the repaint ends', () => {
  const { AT, ctx, setHidden } = boot();
  AT.audio.hold(true);
  assert.equal(ctx.state, 'suspended');
  setHidden(true);
  setHidden(false);
  assert.equal(ctx.state, 'suspended', 'the clock is still paused for the repaint');
  AT.audio.hold(false);
  assert.equal(ctx.state, 'running');
});

test('a resize while the page is hidden (a rotation in the background) keeps sound off until both are over', () => {
  const { AT, ctx, setHidden } = boot();
  setHidden(true);
  assert.equal(ctx.state, 'suspended');
  AT.audio.hold(true);
  setHidden(false);
  assert.equal(ctx.state, 'suspended', 'back on the page, but the repaint is not over');
  AT.audio.hold(false);
  assert.equal(ctx.state, 'running');
  // and the other way round: the repaint ends first, while still hidden
  setHidden(true);
  AT.audio.hold(true);
  AT.audio.hold(false);
  assert.equal(ctx.state, 'suspended', 'still hidden');
  setHidden(false);
  assert.equal(ctx.state, 'running');
});

test('sound that was not running stays off after a pause; a tap during the pause starts it and it plays when the pause ends', async () => {
  FakeAudioContext.initial = 'suspended'; FakeAudioContext.refuse = true; // the browser has not allowed sound yet
  const { AT, ctx, setHidden } = boot();
  FakeAudioContext.initial = undefined; FakeAudioContext.refuse = false;
  assert.equal(ctx.state, 'suspended');
  AT.audio.hold(true);
  setHidden(true);
  setHidden(false);
  AT.audio.hold(false);
  assert.equal(ctx.state, 'suspended', 'a pause never starts sound by itself');
  AT.audio.hold(true);
  ctx.refuse = false;
  const n = ctx.resumes || 0;
  AT.audio.unlock(); // a tap on the still scene
  // never run yet: started inside the tap (iOS may refuse a first start later, without one) ...
  assert.equal(ctx.resumes, n + 1, 'resumed during the tap');
  await new Promise((r) => setTimeout(r, 5));
  // ... and suspended again at once
  assert.equal(ctx.state, 'suspended', 'not while the repaint holds it');
  AT.audio.hold(false);
  assert.equal(ctx.state, 'running');
});

test('iOS stopping the sound (a call, Siri, another app\'s sound: \'interrupted\') is left to iOS: never fought for; a tap or iOS resumes it', () => {
  const { AT, ctx, setHidden } = boot();
  ctx.set('interrupted');
  assert.equal(ctx.state, 'interrupted', 'not taken back');
  AT.audio.unlock(); // a tap
  assert.equal(ctx.state, 'running');
  // interrupted when a pause begins: resumed when it ends
  ctx.set('interrupted');
  setHidden(true);
  setHidden(false);
  assert.equal(ctx.state, 'running');
});

test('a resume that lands during a pause (asked for before it began) is suspended again', () => {
  const { AT, ctx } = boot();
  AT.audio.hold(true);
  assert.equal(ctx.state, 'suspended');
  ctx.set('running'); // e.g. hold(false)'s resume, landing after the next hold(true)
  assert.equal(ctx.state, 'suspended');
  AT.audio.hold(false);
  assert.equal(ctx.state, 'running');
});

test('once sound has run, a tap during a pause leaves it suspended (no held narration leaks)', () => {
  const { AT, ctx } = boot();
  AT.audio.hold(true);
  const n = ctx.resumes || 0;
  AT.audio.unlock();
  assert.equal(ctx.resumes || 0, n, 'not resumed');
  assert.equal(ctx.state, 'suspended');
  AT.audio.hold(false);
  assert.equal(ctx.state, 'running');
});

test('a context never started by a tap is not started by a state change', () => {
  const listeners = {};
  const doc = { ...loadGame({ only: ['(none)'] }).document, hidden: false };
  doc.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  const game = loadGame({ globals: { document: doc, AudioContext: FakeAudioContext } });
  game.AT.audio.init();
  const ctx = FakeAudioContext.last;
  ctx.set('suspended');
  assert.equal(ctx.state, 'suspended');
});
