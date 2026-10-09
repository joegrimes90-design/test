// Narration: every line the code says exists in tools/voice-lines.json and in
// the generated narration files, with matching text, speaker and audio:
//   js/voice-index.js     text, speaker, duration of every line + the lines each scene says
//   js/voice-data.js      audio of the lines said in play (loaded after AT.boot())
//   js/voice-cartoons.js  audio of the lines only the cartoons say (?record mode only)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gameSources, read, ROOT, loadVoice, VOICE_FILES } from '../helpers/load-game.mjs';
import { readClips, render } from '../../tools/split-voice.mjs';

const spec = JSON.parse(read('tools/voice-lines.json'));
const lines = new Map(spec.lines.map(([id, s, t]) => [id, { s, t }]));
const { index: AT_VOICE, scenes: SCENES, audio } = loadVoice();
const GAME = audio.game || {}, CARTOONS = audio.cartoons || {};
const sources = gameSources();

// String literals inside the argument of AT.say( / AT.sayNow( / remind: / AT.celebrate([...])
function callSiteIds() {
  const found = [];
  const unresolved = [];
  for (const { file, src } of sources) {
    const re = /(AT\.say|AT\.sayNow|remind)\s*(\(|:)\s*([^,)}]+)|AT\.celebrate\(\s*(\[[^\]]*\]|[^,)]+)/g;
    for (const m of src.matchAll(re)) {
      // drop comparison operands (kind === 'poo' ? 'n_do_poo' : 'n_do_wee')
      const arg = (m[3] || m[4]).trim().replace(/[!=]==?\s*'[^']*'/g, '');
      const ids = [...arg.matchAll(/'([^']+)'/g)].map((x) => x[1]);
      if (ids.length) ids.forEach((id) => found.push({ file, id }));
      else unresolved.push(`${file}: ${m[0]}`);
    }
  }
  return { found, unresolved };
}
const literalIds = (src) => [...src.matchAll(/'([nadmc]_[a-z0-9_]+)'/g)].map((m) => m[1]);
const sha = (s) => crypto.createHash('sha256').update(s || '').digest('hex');
const isMp3 = (b64) => {
  const bytes = Buffer.from(b64 || '', 'base64');
  return bytes.length >= 1000 && (bytes.subarray(0, 3).toString('latin1') === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));
};

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
  // (AT.say's own plumbing, E.choose's reminder, the hub's room-name map, the potty's cheers)
  const allowed = new Set(['js/game.js: AT.say(id', 'js/engine.js: AT.sayNow(opts.remind', 'js/scenes/hub.js: AT.say(names[k]', 'js/scenes/potty.js: AT.celebrate(cheers[i]']);
  assert.deepEqual(unresolved.filter((u) => !allowed.has(u)), [], 'call sites with an unexpected non-literal line id');
});

test('every line-id-shaped string literal in the code is a real line', () => {
  const missing = [];
  for (const { file, src } of sources) {
    for (const id of literalIds(src)) if (!lines.has(id)) missing.push(`${file}: ${id}`);
  }
  assert.deepEqual(missing, []);
});

test('js/voice-index.js has every line (text, speaker, duration) and no audio', () => {
  const problems = [];
  for (const [id, { s, t }] of lines) {
    const v = AT_VOICE[id];
    if (!v) { problems.push(`${id}: missing (run tools/gen_voice.py)`); continue; }
    if (v.t !== t) problems.push(`${id}: text differs: "${v.t}" vs "${t}"`);
    if (v.s !== s) problems.push(`${id}: speaker ${v.s} vs ${s}`);
    if (!(v.d > 0.2 && v.d < 30)) problems.push(`${id}: odd duration ${v.d}`);
    if ('a' in v) problems.push(`${id}: audio belongs in voice-data.js / voice-cartoons.js, not the index`);
  }
  for (const id of Object.keys(AT_VOICE)) if (!lines.has(id)) problems.push(`${id}: in voice-index.js but not in voice-lines.json (stale)`);
  assert.deepEqual(problems, []);
});

test('every line has MP3 audio in exactly one of voice-data.js and voice-cartoons.js', () => {
  const problems = [];
  for (const id of lines.keys()) {
    const where = [GAME[id] && 'voice-data.js', CARTOONS[id] && 'voice-cartoons.js'].filter(Boolean);
    if (where.length !== 1) problems.push(`${id}: audio in ${where.length ? where.join(' and ') : 'neither file'}`);
    else if (!isMp3(GAME[id] || CARTOONS[id])) problems.push(`${id}: audio is not an MP3`);
  }
  for (const id of [...Object.keys(GAME), ...Object.keys(CARTOONS)]) if (!lines.has(id)) problems.push(`${id}: audio for a line not in voice-lines.json (stale)`);
  assert.deepEqual(problems, []);
});

test("every line a scene says is in that scene's AT_VOICE_SCENES list, with its audio in voice-data.js", () => {
  assert.ok(SCENES, 'window.AT_VOICE_SCENES defined');
  const sceneFiles = sources.filter(({ file }) => /^js\/scenes\/\w+\.js$/.test(file));
  assert.deepEqual(Object.keys(SCENES).sort(), sceneFiles.map(({ file }) => file.slice(10, -3)).sort(), 'one list per scene');
  const { found } = callSiteIds();
  const said = (file, src) => new Set([...found.filter((f) => f.file === file).map((f) => f.id), ...literalIds(src)]);
  // lines in shared code (game.js's default cheers, ...) can be said in any scene
  const shared = sources.filter(({ file }) => !/^js\/scenes\//.test(file) && file !== 'js/cartoons.js').flatMap(({ file, src }) => [...said(file, src)]);
  const problems = [];
  for (const { file, src } of sceneFiles) {
    const name = file.slice(10, -3);
    for (const id of new Set([...said(file, src), ...shared])) if (!SCENES[name].includes(id)) problems.push(`${name}: ${id} missing from its list`);
  }
  for (const [name, ids] of Object.entries(SCENES)) {
    for (const id of ids) if (!GAME[id]) problems.push(`${name}: ${id} has no audio in voice-data.js`);
  }
  assert.deepEqual(problems, [], 'run node tools/split-voice.mjs');
});

test('normal play does not download the cartoon-only lines', () => {
  const play = new Set(Object.values(SCENES).flat());
  assert.deepEqual(Object.keys(CARTOONS).filter((id) => play.has(id)), [], 'a scene says a line kept in voice-cartoons.js');
  assert.deepEqual(Object.keys(GAME).filter((id) => !play.has(id)), [], 'voice-data.js has lines no scene says');
  assert.ok(Object.keys(CARTOONS).length >= 20, 'the cartoon narration is in voice-cartoons.js');
});

test('lines used by the cartoons exist', () => {
  const src = read('js/cartoons.js');
  const ids = literalIds(src);
  assert.ok(ids.filter((id) => id.startsWith('c_')).length >= 15);
  for (const id of ids) assert.ok(lines.has(id) && AT_VOICE[id] && (GAME[id] || CARTOONS[id]), id);
});

test('the narration files are exactly what tools/split-voice.mjs writes', () => {
  const want = render(readClips());
  for (const f of VOICE_FILES) assert.ok(read(f) === want[f], `${f} is out of date or edited by hand (run node tools/split-voice.mjs)`);
});

// Splitting and re-splitting must never touch the MP3 bytes. Compares every line
// whose text is unchanged with the last commit (whichever file layout it used).
test('every clip is byte-for-byte the audio in git HEAD', (t) => {
  const git = (p) => {
    try { return execFileSync('git', ['show', `HEAD:${p}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return null; }
  };
  const head = loadVoice(git);
  if (!Object.keys(head.index).length) return t.skip('no git history here');
  const headClip = (id) => (head.audio.game || {})[id] || (head.audio.cartoons || {})[id] || head.index[id]?.a;
  const problems = [];
  let compared = 0;
  for (const [id, { t: text }] of lines) {
    const old = head.index[id];
    if (!old || old.t !== text) continue; // new or re-worded line: new audio is expected
    compared++;
    if (sha(GAME[id] || CARTOONS[id]) !== sha(headClip(id))) problems.push(`${id}: audio differs from HEAD`);
    if (AT_VOICE[id].d !== old.d) problems.push(`${id}: duration ${AT_VOICE[id].d} vs ${old.d} in HEAD`);
  }
  assert.deepEqual(problems, []);
  assert.ok(compared > 50, `compared ${compared} lines`);
});
