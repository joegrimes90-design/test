// Narration loading in js/audio.js, against a fake live AudioContext:
// the audio file arrives after boot (lines asked for meanwhile wait for it and
// never fall back to the speech synthesiser), scenes decode their lines ahead,
// and decoded audio stays within its memory budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadGame, read } from '../helpers/load-game.mjs';

const SR = 48000;
class FakeBuffer {
  constructor(ch, len, sr) { this.numberOfChannels = ch; this.length = len; this.sampleRate = sr; this.duration = len / sr; }
  getChannelData() { return new Float32Array(this.length); }
}
const param = (v) => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
class FakeAudioContext {
  constructor() { this.state = 'running'; this.sampleRate = SR; this.currentTime = 0; this.destination = {}; this.started = []; this.decodes = 0; FakeAudioContext.last = this; }
  node(extra) { return { connect() {}, disconnect() {}, ...extra }; }
  createGain() { return this.node({ gain: param(1) }); }
  createDynamicsCompressor() { return this.node({ threshold: param(0), ratio: param(1), attack: param(0), release: param(0) }); }
  createBuffer(ch, len, sr) { return new FakeBuffer(ch, len, sr); }
  // (unlock() starts a one-sample silent buffer: only count real lines)
  createBufferSource() { const c = this; return this.node({ buffer: null, start() { if (this.buffer.length > 1) c.started.push(this.buffer); }, stop() {} }); }
  createOscillator() { return this.node({ frequency: param(440), start() {}, stop() {} }); }
  createBiquadFilter() { return this.node({ frequency: param(350), Q: param(1) }); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  // 48 kbit/s MP3: bytes -> seconds of mono audio, resampled to the context rate
  decodeAudioData(bytes, ok) {
    this.decodes++;
    const b = new FakeBuffer(1, Math.round((bytes.byteLength * 8 / 48000) * SR), SR);
    return new Promise((r) => setImmediate(() => { ok(b); r(b); }));
  }
}

function boot() {
  const spoken = [];
  const timers = [];
  const listeners = {};
  const game = loadGame({
    globals: {
      addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
      AudioContext: FakeAudioContext,
      speechSynthesis: { speak: (u) => spoken.push(u.text), cancel() {} },
      SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } },
      // the 1.5 s wait for late audio runs on these, by hand
      setTimeout: (fn, ms) => timers.push({ fn, ms }),
      clearTimeout: () => {},
    },
  });
  const loadAudio = () => vm.runInContext(read('js/voice-data.js'), game, { filename: 'js/voice-data.js' });
  const fire = (type) => (listeners[type] || []).forEach((fn) => fn({ type }));
  return { game, AT: game.AT, spoken, timers, loadAudio, fire };
}
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

test('the game boots with the narration index only: text and durations, no audio', () => {
  const { AT, game } = boot();
  assert.ok(game.AT_VOICE.n_hello.t && game.AT_VOICE.n_hello.d > 0);
  assert.equal(game.AT_VOICE.n_hello.a, undefined);
  assert.equal(AT.audio.stats().voiceLoaded, false);
  assert.equal(AT.audio.voice('n_hello'), game.AT_VOICE.n_hello.d, 'voice() reports the duration from the index');
});

test('a line asked for before the audio has arrived waits for it, then plays', async () => {
  const { AT, spoken, loadAudio } = boot();
  AT.audio.unlock();
  const ctx = FakeAudioContext.last;
  AT.audio.voice('n_hello');
  await settle();
  assert.equal(ctx.started.length, 0);
  assert.equal(AT.audio.stats().waited, 1);
  loadAudio();
  await settle();
  assert.equal(ctx.started.length, 1, 'played once the audio arrived');
  assert.deepEqual(spoken, [], 'never the speech synthesiser');
  assert.equal(AT.audio.stats().played, 1);
});

test('stopVoice() (a scene change) cancels a line still waiting for its audio', async () => {
  const { AT, spoken, loadAudio } = boot();
  AT.audio.unlock();
  const ctx = FakeAudioContext.last;
  AT.audio.voice('n_hello');
  AT.audio.stopVoice();
  loadAudio();
  await settle();
  assert.equal(ctx.started.length, 0);
  assert.deepEqual(spoken, []);
});

test('a line still waiting after 1.5 s is dropped, leaving just the caption', async () => {
  const { AT, spoken, timers, loadAudio } = boot();
  AT.audio.unlock();
  const ctx = FakeAudioContext.last;
  AT.audio.voice('n_hello');
  const wait = timers.find((t) => t.ms === 1500);
  assert.ok(wait, 'waits 1.5 s');
  wait.fn();
  loadAudio();
  await settle();
  assert.equal(ctx.started.length, 0, 'too late: not played out of step with its caption');
  assert.deepEqual(spoken, []);
  assert.equal(AT.audio.stats().dropped, 1);
});

test('if the page finishes loading without the audio file, lines use the speech synthesiser', async () => {
  const { AT, spoken, fire } = boot();
  AT.audio.unlock();
  AT.audio.voice('n_hello');
  await settle();
  assert.deepEqual(spoken, []);
  fire('load'); // js/voice-data.js failed to load
  await settle();
  assert.deepEqual(spoken, ['Hello! This is Atticus!'], 'the waiting line');
  AT.audio.voice('a_hi');
  assert.equal(spoken.length, 2, 'later lines straight away');
});

test('lines without recorded audio still use the speech synthesiser once the audio file is in', async () => {
  const { AT, spoken, loadAudio } = boot();
  AT.audio.unlock();
  loadAudio();
  AT.audio.voice('c_p1'); // cartoon-only: its audio is not loaded in play
  await settle();
  assert.equal(spoken.length, 1);
});

test('scenes decode their first lines ahead, and decoded audio stays under 10 MB over a whole playthrough', async () => {
  const { AT, game, spoken, loadAudio } = boot();
  AT.audio.prefetch('title');
  AT.audio.unlock();
  loadAudio();
  await settle(200);
  const ctx = FakeAudioContext.last;
  const title = game.AT_VOICE_SCENES.title;
  assert.ok(ctx.decodes >= 3 && ctx.decodes <= title.length, `decoded ahead: ${ctx.decodes}`);
  const before = ctx.decodes;
  AT.audio.voice(title[0]);
  await settle();
  assert.equal(ctx.decodes, before, 'a prefetched line plays without decoding again');
  assert.equal(ctx.started.length, 1);
  // every scene, every line, twice (reminders repeat)
  for (const scene of ['hub', 'potty', 'hub', 'teeth', 'hub', 'baby', 'hub', 'party', 'tv', 'title']) {
    AT.audio.prefetch(scene);
    await settle(50);
    for (const id of [...game.AT_VOICE_SCENES[scene], ...game.AT_VOICE_SCENES[scene]]) { AT.audio.voice(id); await settle(3); }
    AT.audio.stopVoice();
  }
  const st = AT.audio.stats();
  assert.ok(st.peakVoiceBytes <= 10e6, `peak ${st.peakVoiceBytes} bytes`);
  assert.ok(st.voiceBytes <= 8e6);
  assert.deepEqual(spoken, []);
  assert.ok(st.played > 200, `${st.played} lines played`);
});
