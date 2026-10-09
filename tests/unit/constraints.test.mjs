// Hosting constraints any optimisation must keep:
//  - works from file:// (double-clicked): classic scripts only, no ES modules,
//    no fetch/XHR of local files, no workers loaded from files;
//  - bundles into one HTML fragment (tools/build-artifact.mjs) for a claude.ai
//    artifact, whose CSP allows own files, blob:/data: images and Google Fonts only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, read, scriptList } from '../helpers/load-game.mjs';

const html = read('index.html');
const jsFiles = scriptList();
const cssFiles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
// strip comments so prose doesn't trip the checks
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('index.html uses classic local scripts and stylesheets only', () => {
  assert.doesNotMatch(html, /type=["']module["']/);
  for (const tag of html.matchAll(/<script\b([^>]*)>/g)) {
    const src = /src="([^"]+)"/.exec(tag[1]);
    if (src) assert.ok(!/^[a-z]+:/i.test(src[1]) && fs.existsSync(path.join(ROOT, src[1])), `script ${src[1]}`);
  }
  for (const f of cssFiles) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
});

test('the game never asks for persistent storage (Firefox would show the player a permission prompt)', () => {
  // the bitmap cache (js/raster-cache.js) is best-effort and cheap to rebuild
  for (const f of jsFiles.filter((x) => !x.includes('voice-'))) {
    assert.doesNotMatch(code(f), /navigator\s*\.\s*storage|storage\s*\.\s*persist|requestStorageAccess/, `${f} asks the browser for persistent storage`);
  }
});

test('game scripts never load files at runtime (works from file://)', () => {
  const problems = [];
  for (const f of jsFiles.filter((x) => !x.includes('voice-data'))) {
    const src = code(f);
    if (/^\s*(import|export)\s/m.test(src)) problems.push(`${f}: ES module syntax`);
    if (/\bimport\s*\(/.test(src)) problems.push(`${f}: dynamic import()`);
    if (/\bfetch\s*\(/.test(src)) problems.push(`${f}: fetch()`);
    if (/XMLHttpRequest/.test(src)) problems.push(`${f}: XMLHttpRequest`);
    if (/new\s+(Shared)?Worker\s*\(\s*['"`]/.test(src)) problems.push(`${f}: Worker from a file (use a blob: URL)`);
    if (/importScripts\s*\(\s*['"`]/.test(src)) problems.push(`${f}: importScripts of a file`);
    if (/serviceWorker/.test(src)) problems.push(`${f}: service worker`);
    for (const m of src.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
      if (!/^http:\/\/www\.w3\.org\//.test(m[0])) problems.push(`${f}: external URL ${m[0]}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('stylesheets only reference data: URLs or Google Fonts', () => {
  for (const f of cssFiles) {
    for (const m of code(f).matchAll(/url\(\s*['"]?([^'")]+)/g)) {
      assert.ok(/^data:/.test(m[1]) || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(m[1]), `${f}: url(${m[1].slice(0, 60)})`);
    }
  }
});

test('tools/build-artifact.mjs bundles everything into one HTML fragment', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'atticus-artifact-'));
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'tools/build-artifact.mjs'), out], { stdio: 'pipe' });
    const bundle = fs.readFileSync(path.join(out, 'atticus.html'), 'utf8');
    assert.doesNotMatch(bundle, /<script[^>]+src=/, 'no external scripts');
    assert.doesNotMatch(bundle, /<link[^>]+stylesheet/, 'no external stylesheets');
    assert.match(bundle, /AT\.boot\(\)/);
    // every script made it in, in document order (src and inline), so AT.boot()
    // runs before the narration audio has even arrived
    const marker = (f) => read(f).trim().split('\n')[0].slice(0, 80);
    const tags = [...html.matchAll(/<script(?: src="([^"]+)")?>([^<]*)<\/script>/g)].map(([, src, inline]) => ({ name: src || inline, marker: src ? marker(src) : inline }));
    assert.deepEqual(tags.filter((t) => t.name.endsWith('.js')).map((t) => t.name), jsFiles);
    let at = -1;
    for (const t of tags) {
      const i = bundle.indexOf(t.marker, at + 1);
      assert.ok(i > at, `${t.name} missing or out of order in the bundle`);
      at = i;
    }
    assert.ok(bundle.indexOf('<script>AT.boot();</script>') < bundle.indexOf(marker('js/voice-data.js')), 'AT.boot() before the voice audio');
    assert.equal(bundle.indexOf(marker('js/voice-cartoons.js')), -1, 'cartoon-only narration is not bundled');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
