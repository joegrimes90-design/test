// Load-performance budget check:  npm run perf  [-- --runs 3] [--update-baseline]
//
// Runs tools/perf.mjs twice (no CPU throttle, and 4x CPU throttle like a
// tablet), prints the numbers next to tests/perf/budget.json and
// tests/perf/baseline.json, and exits 1 if a budgeted metric is over budget.
// Not part of `npm test`: it takes a minute or two and timings are noisy.
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

const CONFIGS = { noThrottle: ['--cpu', '1'], cpu4: ['--cpu', '4'] };
const measured = {};
for (const [name, args] of Object.entries(CONFIGS)) {
  const out = path.join(os.tmpdir(), `atticus-perf-${process.pid}-${name}.json`);
  console.log(`\n▶ tools/perf.mjs ${args.join(' ')} --runs ${RUNS}`);
  const r = spawnSync(process.execPath, [path.join(root, 'tools/perf.mjs'), ...args, '--runs', RUNS, '--json', out], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0 || !fs.existsSync(out)) { console.error(`perf.mjs failed (exit ${r.status})`); process.exit(2); }
  measured[name] = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.unlinkSync(out);
}

const METRICS = ['titleShown', 'frameP50', 'frameP95', 'warm', 'fcp', 'longTaskMs', 'maxLongTask', 'heapMB', 'errors'];
const fails = [];
for (const name of Object.keys(CONFIGS)) {
  const b = budget[name] || {};
  console.log(`\n${name} (median of ${RUNS} runs)`);
  console.log(`  ${'metric'.padEnd(12)}${'now'.padStart(9)}${'budget'.padStart(9)}${'baseline'.padStart(10)}`);
  for (const k of METRICS) {
    const v = measured[name][k];
    const lim = b[k];
    const base = baseline[name] && baseline[name][k];
    const over = lim != null && v > lim;
    if (over) fails.push(`${name}.${k} = ${v} > budget ${lim}`);
    console.log(`  ${k.padEnd(12)}${String(v).padStart(9)}${String(lim ?? '-').padStart(9)}${String(base ?? '-').padStart(10)}${over ? '  OVER BUDGET' : lim != null ? '  ok' : ''}`);
  }
}

if (process.argv.includes('--update-baseline')) {
  const rec = { recorded: new Date().toISOString(), runs: +RUNS, machine: `${os.cpus().length} CPUs, ${os.platform()}`, note: 'headless Chromium, 1280x720 at deviceScaleFactor 2 (tools/perf.mjs)' };
  for (const name of Object.keys(CONFIGS)) rec[name] = Object.fromEntries(METRICS.map((k) => [k, measured[name][k]]));
  fs.writeFileSync(baselineFile, JSON.stringify(rec, null, 2) + '\n');
  console.log(`\nwrote ${path.relative(root, baselineFile)}`);
}

if (fails.length) {
  console.log(`\n✗ over budget:\n  ${fails.join('\n  ')}`);
  process.exit(1);
}
console.log('\n✓ within budget');
