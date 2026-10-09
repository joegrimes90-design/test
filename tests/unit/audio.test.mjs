// Sound: every effect and music track the game asks for exists and renders.
// Uses AT.audio.renderOffline (the cartoon soundtrack mixer) against a fake
// OfflineAudioContext that validates arguments the way browsers do (non-finite
// values throw, exponential ramps must stay above zero) and counts the sources
// each sound starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, gameSources, read } from '../helpers/load-game.mjs';

const finite = (...v) => { for (const x of v) if (!Number.isFinite(x)) throw new TypeError(`non-finite value ${x}`); };
class Param {
  constructor(v) { this.value = v; }
  setValueAtTime(v, t) { finite(v, t); if (t < 0) throw new RangeError('negative time'); }
  linearRampToValueAtTime(v, t) { finite(v, t); }
  exponentialRampToValueAtTime(v, t) { finite(v, t); if (v <= 0) throw new RangeError(`exponential ramp to ${v}`); }
  setTargetAtTime(v, t, c) { finite(v, t, c); }
  cancelScheduledValues(t) { finite(t); }
}
class FakeBuffer {
  constructor(ch, len, sr) { this.numberOfChannels = ch; this.length = len; this.sampleRate = sr; this.duration = len / sr; this.ch = Array.from({ length: ch }, () => new Float32Array(len)); }
  getChannelData(i) { return this.ch[i]; }
}
class FakeOfflineAudioContext {
  constructor(ch, len, sr) {
    finite(ch, len, sr);
    this.length = len; this.sampleRate = sr; this.currentTime = 0; this.destination = { dest: true };
    this.started = []; // [kind, time]
  }
  node(extra) {
    const ctx = this;
    return Object.assign({ connect(n) { if (!n) throw new TypeError('connect(undefined)'); return n; }, disconnect() {} }, extra(ctx));
  }
  source(kind, params) {
    return this.node((ctx) => ({
      ...params,
      start(t = 0, off = 0) { finite(t, off); if (this._s) throw new Error('start() twice'); this._s = true; ctx.started.push([kind, t]); },
      stop(t = 0) { finite(t); },
    }));
  }
  createGain() { return this.node(() => ({ gain: new Param(1) })); }
  createDynamicsCompressor() { return this.node(() => ({ threshold: new Param(-24), ratio: new Param(12), attack: new Param(0.003), release: new Param(0.25), knee: new Param(30) })); }
  createBiquadFilter() { return this.node(() => ({ type: 'lowpass', frequency: new Param(350), Q: new Param(1), gain: new Param(0) })); }
  createOscillator() { return this.source('osc', { type: 'sine', frequency: new Param(440), detune: new Param(0) }); }
  createBufferSource() { return this.source('buffer', { buffer: null, loop: false, playbackRate: new Param(1) }); }
  createBuffer(ch, len, sr) { finite(ch, len, sr); return new FakeBuffer(ch, len, sr); }
  decodeAudioData(buf, ok) { const b = new FakeBuffer(1, 4800, 48000); if (ok) ok(b); return Promise.resolve(b); }
  startRendering() { FakeOfflineAudioContext.last = this; return Promise.resolve(new FakeBuffer(2, this.length, this.sampleRate)); }
}

const game = loadGame({ voice: true, globals: { OfflineAudioContext: FakeOfflineAudioContext } });
const audio = game.AT.audio;
const SR = 4000;
async function render(events, duration) {
  const wav = await audio.renderOffline(events, duration, SR);
  const ctx = FakeOfflineAudioContext.last;
  return { wav, started: ctx.started };
}

// names declared in an object literal block of audio.js, e.g. `const SFX = {`
function blockKeys(src, decl) {
  const start = src.indexOf(decl);
  assert.ok(start >= 0, decl);
  let depth = 0, i = src.indexOf('{', start);
  const from = i;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return [...src.slice(from, i).matchAll(/^ {4}(\w+): /gm)].map((m) => m[1]);
}
const audioSrc = read('js/audio.js');
const SFX = blockKeys(audioSrc, 'const SFX = {');
const TRACKS = blockKeys(audioSrc, 'const TRACKS = {');
const INST = blockKeys(audioSrc, 'const INST = {');

function usedNames(re) {
  const out = new Set();
  for (const { src } of gameSources()) {
    for (const m of src.matchAll(re)) {
      for (const l of m[1].replace(/[!=]==?\s*'[^']*'/g, '').matchAll(/'([^']+)'/g)) out.add(l[1]);
    }
  }
  return [...out];
}

test('the audio module declares effects, tracks and instruments', () => {
  assert.ok(SFX.length > 40, `${SFX.length} sfx`);
  assert.deepEqual(TRACKS.sort(), ['brush', 'happy', 'lullaby', 'party', 'play']);
  assert.ok(INST.length >= 6);
});

test('every sound effect the code plays exists', () => {
  const used = [...new Set([...usedNames(/AT\.audio\.sfx\(([^,)]+)/g), ...usedNames(/loopSfx\(('[^']+')/g)])];
  assert.ok(used.length > 30, `${used.length} effects used`);
  assert.deepEqual(used.filter((n) => !SFX.includes(n)), [], 'effects played but not defined in audio.js SFX');
});

test('every music track the code plays exists', () => {
  const used = usedNames(/AT\.audio\.music\(([^)]+)\)/g);
  assert.ok(used.length >= 5);
  assert.deepEqual(used.filter((n) => !TRACKS.includes(n)), []);
});

test('every track only uses defined instruments (parsed)', () => {
  const start = audioSrc.indexOf('const TRACKS = {');
  const block = audioSrc.slice(start, audioSrc.indexOf('const INST = {'));
  const parts = new Set([...block.matchAll(/\['(\w+)', /g)].map((m) => m[1]));
  assert.ok(parts.size >= 6);
  assert.deepEqual([...parts].filter((p) => !INST.includes(p)), []);
});

test('every sound effect renders without Web Audio errors and makes sound', async () => {
  for (const name of SFX) {
    const { started } = await render([{ t: 0.1, type: 'sfx', name }], 3);
    assert.ok(started.length > 0, `sfx ${name} started no sources`);
    for (const [, t] of started) assert.ok(t >= 0.1 && t < 4, `sfx ${name} starts at ${t}`);
  }
});

test('every music track renders a full loop with all its instruments', async () => {
  for (const name of TRACKS) {
    const { started, wav } = await render([{ t: 0, type: 'music', name }], 40);
    assert.ok(started.length > 50, `track ${name}: only ${started.length} notes`);
    const bytes = Buffer.from(wav, 'base64');
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.equal(bytes.subarray(8, 12).toString(), 'WAVE');
    assert.equal(bytes.readUInt32LE(24), SR, 'sample rate');
  }
});

test('narration lines are mixed into the soundtrack', async () => {
  const { started } = await render([{ t: 1, type: 'voice', id: 'n_hello' }, { t: 3, type: 'voice', id: 'a_hi' }], 6);
  const buffers = started.filter(([k]) => k === 'buffer').map(([, t]) => t);
  assert.deepEqual(buffers, [1.02, 3.02]);
});

test('without an AudioContext (silent browsers) the game API is a no-op', () => {
  assert.doesNotThrow(() => { audio.sfx('pop'); audio.music('happy'); audio.stopMusic(); audio.stopVoice(); });
  assert.equal(audio.ready, false);
  assert.ok(audio.voice('n_hello') > 0, 'voice() still reports the line duration');
});
