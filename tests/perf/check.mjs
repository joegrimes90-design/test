// Load-performance budget check:  npm run perf  [-- --runs 3] [--update-baseline] [--only noThrottle,cpu4]
//
// Runs tools/perf.mjs in three configurations and prints the numbers next to
// tests/perf/budget.json and tests/perf/baseline.json; exits 1 if a budgeted
// metric is over budget (the 'stretch' block is printed but never fails):
//   noThrottle  no CPU throttle, with --scenes (transition phases, per-scene frames)
//               and --trace (tile raster ms per frame on the idle title)
//   cpu4        4x CPU throttle, like a tablet
//   revisit     no throttle, a persistent profile loaded twice (--revisit): the second
//               load (revisit.*) is what a returning player sees
// Not part of `npm test`: timings are noisy and it takes several minutes.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const RUNS = arg('runs', '3');
const budget = JSON.parse(fs.readFileSync(path.join(here, 'budget.json'), 'utf8'));
const baselineFile = path.join(here, 'baseline.json');
const baseline = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : {};

// name -> [perf.mjs args, key of the result object to read (null = top level)]
const ALL = {
  noThrottle: [['--cpu', '1', '--scenes', '--trace'], null],
  cpu4: [['--cpu', '4'], null],
  // frames are measured by the other two; here only load and transition times matter
  revisit: [['--cpu', '1', '--revisit', '--scenes', '--title-frames', '0', '--scene-frames', '0'], 'revisit'],
};
const only = arg('only', null);
const CONFIGS = Object.fromEntries(Object.entries(ALL).filter(([n]) => !only || only.split(',').includes(n)));
const measured = {};
const raw = {};
for (const [name, [args, key]] of Object.entries(CONFIGS)) {
  const out = path.join(os.tmpdir(), `atticus-perf-${process.pid}-${name}.json`);
  console.log(`\n▶ tools/perf.mjs ${args.join(' ')} --runs ${RUNS}`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(root, 'tools/perf.mjs'), ...args, '--runs', RUNS, '--json', out], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0 || !fs.existsSync(out)) { console.error(`perf.mjs failed (exit ${r.status})`); process.exit(2); }
  raw[name] = JSON.parse(fs.readFileSync(out, 'utf8'));
  measured[name] = key ? raw[name][key] : raw[name];
  fs.unlinkSync(out);
  console.log(`  (${Math.round((Date.now() - t0) / 1000)} s)`);
}

const METRICS = ['titleShown', 'titlePainted', 'titleLive', 'frameP50', 'frameP95', 'rasterMsPerFrame', 'maxLongTaskPlay',
  'transitionMax', 'sceneFrameP95', 'warm', 'fcp', 'longTaskMs', 'maxLongTask', 'heapMB', 'errors'];
const fails = [];
const fmt = (v) => (v == null ? '-' : String(v));
for (const name of Object.keys(CONFIGS)) {
  const b = budget[name] || {};
  const st = (budget.stretch && budget.stretch[name]) || {};
  const m = measured[name];
  console.log(`\n${name} (median of ${RUNS} runs)`);
  console.log(`  ${'metric'.padEnd(16)}${'now'.padStart(9)}${'budget'.padStart(9)}${'baseline'.padStart(10)}`);
  for (const k of METRICS) {
    const v = m[k];
    const lim = b[k] ?? st[k];
    const stretch = b[k] == null && st[k] != null;
    const base = baseline[name] && baseline[name][k];
    if (v == null && lim == null && base == null) continue;
    const over = lim != null && v != null && v > lim;
    if (over && !stretch) fails.push(`${name}.${k} = ${v} > budget ${lim}`);
    const verdict = lim == null ? '' : over ? (stretch ? '  over stretch target' : '  OVER BUDGET') : (stretch ? '  ok (stretch)' : '  ok');
    console.log(`  ${k.padEnd(16)}${fmt(v).padStart(9)}${fmt(lim).padStart(9)}${fmt(base).padStart(10)}${verdict}`);
  }
  if (m.scenes) {
    const cols = ['faded', 'dom', 'raster', 'built', 'shown', 'painted', 'frameP50', 'frameP95'];
    console.log(`  per scene (ms after AT.go):\n    ${'scene'.padEnd(8)}${cols.map((c) => c.padStart(9)).join('')}`);
    for (const [sc, v] of Object.entries(m.scenes)) console.log(`    ${sc.padEnd(8)}${cols.map((c) => fmt(v[c]).padStart(9)).join('')}`);
  }
  if (name === 'revisit' && raw[name].cold) {
    const c = raw[name].cold;
    console.log(`  (cold load in the same profile: titleShown ${fmt(c.titleShown)}, titlePainted ${fmt(c.titlePainted)}, transitionMax ${fmt(c.transitionMax)})`);
  }
}

if (process.argv.includes('--update-baseline')) {
  const rec = { recorded: new Date().toISOString(), runs: +RUNS, machine: `${os.cpus().length} CPUs, ${os.platform()}`, note: 'headless Chromium, 1280x720 at deviceScaleFactor 2 (tools/perf.mjs)', ...baseline };
  rec.recorded = new Date().toISOString();
  rec.runs = +RUNS;
  for (const name of Object.keys(CONFIGS)) {
    rec[name] = Object.fromEntries(METRICS.filter((k) => measured[name][k] != null).map((k) => [k, measured[name][k]]));
    if (measured[name].scenes) rec[name].scenes = measured[name].scenes;
  }
  fs.writeFileSync(baselineFile, JSON.stringify(rec, null, 2) + '\n');
  console.log(`\nwrote ${path.relative(root, baselineFile)}`);
}

if (fails.length) {
  console.log(`\n✗ over budget:\n  ${fails.join('\n  ')}`);
  process.exit(1);
}
console.log('\n✓ within budget');
