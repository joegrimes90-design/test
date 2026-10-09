// Sound pauses in js/audio.js, against a fake AudioContext: AT.audio.hold() (the game
// clock paused while sprites are repainted after a resize, js/game.js) and a hidden page
// (visibilitychange) can overlap, and sound comes back only when both are over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/load-game.mjs';

class FakeAudioContext {
  constructor() { this.state = 'running'; this.sampleRate = 48000; this.currentTime = 0; this.destination = {}; FakeAudioContext.last = this; }
  node(extra) { return { connect() {}, disconnect() {}, ...extra }; }
  createGain() { return this.node({ gain: { value: 1 } }); }
  createDynamicsCompressor() { const p = { value: 0 }; return this.node({ threshold: p, ratio: p, attack: p, release: p }); }
  createBuffer(ch, len, sr) { return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr }; }
  createBufferSource() { return this.node({ buffer: null, start() {}, stop() {} }); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
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

test('sound that was not running stays off after a pause; a tap during the pause resumes it when the pause ends', () => {
  const { AT, ctx, setHidden } = boot();
  ctx.state = 'suspended'; // e.g. the browser has not allowed sound yet
  AT.audio.hold(true);
  setHidden(true);
  setHidden(false);
  AT.audio.hold(false);
  assert.equal(ctx.state, 'suspended', 'a pause never starts sound by itself');
  AT.audio.hold(true);
  AT.audio.unlock(); // a tap on the still scene
  assert.equal(ctx.state, 'suspended', 'not while the repaint holds it');
  AT.audio.hold(false);
  assert.equal(ctx.state, 'running');
});
