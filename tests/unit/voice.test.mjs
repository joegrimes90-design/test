// Narration: every line the code says exists in tools/voice-lines.json and in
// the generated js/voice-data.js, with matching text, speaker and audio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, gameSources, read } from '../helpers/load-game.mjs';

const spec = JSON.parse(read('tools/voice-lines.json'));
const lines = new Map(spec.lines.map(([id, s, t]) => [id, { s, t }]));
const { AT_VOICE } = loadGame({ only: ['voice-data'], voice: true });
const sources = gameSources();

// String literals inside the argument of AT.say( / AT.sayNow( / remind:
function callSiteIds() {
  const found = [];
  const unresolved = [];
  for (const { file, src } of sources) {
    const re = /(AT\.say|AT\.sayNow|remind)\s*(\(|:)\s*([^,)}]+)/g;
    for (const m of src.matchAll(re)) {
      // drop comparison operands (kind === 'poo' ? 'n_do_poo' : 'n_do_wee')
      const arg = m[3].trim().replace(/[!=]==?\s*'[^']*'/g, '');
      const ids = [...arg.matchAll(/'([^']+)'/g)].map((x) => x[1]);
      if (ids.length) ids.forEach((id) => found.push({ file, id }));
      else unresolved.push(`${file}: ${m[0]}`);
    }
  }
  return { found, unresolved };
}

test('voice-lines.json is well formed', () => {
  assert.ok(spec.lines.length > 50);
  assert.equal(lines.size, spec.lines.length, 'line ids are unique');
  for (const [id, s, t] of spec.lines) {
    assert.match(id, /^[a-z]_[a-z0-9_]+$/, `id ${id}`);
    assert.ok(spec._speakers[s], `${id}: unknown speaker ${s}`);
    assert.ok(t && t.trim().length > 1, `${id}: empty text`);
    // prefix names the speaker (n_ narrator, a_ Atticus, m_ Mama, d_ Dada); c_ = cartoon, any speaker
    if (id[0] !== 'c') assert.equal(id[0].toUpperCase(), s, `${id}: prefix should match speaker ${s}`);
  }
});

test('every line the code says is in voice-lines.json', () => {
  const { found, unresolved } = callSiteIds();
  assert.ok(found.length > 80, `found ${found.length} call sites`);
  const missing = found.filter(({ id }) => !lines.has(id));
  assert.deepEqual(missing, [], 'lines used in code but missing from tools/voice-lines.json');
  // Non-literal arguments must be one of the known pass-through variables
  // (their values are literals elsewhere, covered by the next test).
  // (AT.say's own plumbing, E.choose's reminder, and the hub's room-name map)
  const allowed = new Set(['js/game.js: AT.say(id', 'js/engine.js: AT.sayNow(opts.remind', 'js/scenes/hub.js: AT.say(names[k]']);
  assert.deepEqual(unresolved.filter((u) => !allowed.has(u)), [], 'call sites with an unexpected non-literal line id');
});

test('every line-id-shaped string literal in the code is a real line', () => {
  const missing = [];
  for (const { file, src } of sources) {
    for (const m of src.matchAll(/'([nadmc]_[a-z0-9_]+)'/g)) if (!lines.has(m[1])) missing.push(`${file}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('js/voice-data.js matches voice-lines.json (text, speaker, duration, MP3 audio)', () => {
  assert.ok(AT_VOICE, 'AT_VOICE defined');
  const problems = [];
  for (const [id, { s, t }] of lines) {
    const v = AT_VOICE[id];
    if (!v) { problems.push(`${id}: missing (run tools/gen_voice.py)`); continue; }
    if (v.t !== t) problems.push(`${id}: text differs: "${v.t}" vs "${t}"`);
    if (v.s !== s) problems.push(`${id}: speaker ${v.s} vs ${s}`);
    if (!(v.d > 0.2 && v.d < 30)) problems.push(`${id}: odd duration ${v.d}`);
    const bytes = Buffer.from(v.a || '', 'base64');
    const mp3 = bytes.subarray(0, 3).toString('latin1') === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    if (bytes.length < 1000 || !mp3) problems.push(`${id}: audio is not an MP3 (${bytes.length} bytes)`);
  }
  for (const id of Object.keys(AT_VOICE)) if (!lines.has(id)) problems.push(`${id}: in voice-data.js but not in voice-lines.json (stale)`);
  assert.deepEqual(problems, []);
});

test('lines used by the cartoons exist', () => {
  const src = read('js/cartoons.js');
  const ids = [...src.matchAll(/'(c_[a-z0-9_]+)'/g)].map((m) => m[1]);
  assert.ok(ids.length >= 15);
  for (const id of ids) assert.ok(lines.has(id) && AT_VOICE[id], id);
});
