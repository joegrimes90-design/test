// Baseline handling for the visual quality tests.
//
//   npm run test:visual            compare against tests/visual/baselines/*.png
//   npm run test:update-baselines  re-record every baseline from the current code
//
// A missing baseline is written and the test fails ("re-run to compare").
// On failure the actual, expected and an amplified diff image are written to
// test-results/ (and attached to the HTML report) with the metrics as JSON.
import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { ROOT } from './load-game.mjs';
import { readPng, writePng, compareImages, judge, diffImage, encodeBaseline } from './image-compare.mjs';
import { THRESHOLDS } from '../visual/thresholds.mjs';

export const BASELINE_DIR = path.join(ROOT, 'tests/visual/baselines');

export { THRESHOLDS };

const fmtSummary = (s) => {
  const ps = (v) => (v === Infinity || v === null ? '∞' : v);
  let out = `PSNR ${ps(s.psnr)} dB, SSIM ${s.ssim}, sharpness ${s.sharpness}, shift ${s.shift.join('/')}; worst tile PSNR ${ps(s.worstTile.psnr)} SSIM ${s.worstTile.ssim}`;
  if (s.worstSprite) out += `; worst sprite ${s.worstSprite.name} PSNR ${ps(s.worstSprite.psnr)} sharp ${s.worstSprite.sharpness}`;
  return out;
};

/**
 * Compare a PNG screenshot with tests/visual/baselines/<name>.png.
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {string} name
 * @param {Buffer} png
 * @param {{regions?: {name:string,x:number,y:number,w:number,h:number}[], thresholds?: object}} [opts]
 */
export async function expectMatchesBaseline(testInfo, name, png, opts = {}) {
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  const file = path.join(BASELINE_DIR, `${name}.png`);
  const mode = testInfo.config.updateSnapshots; // 'all' | 'changed' | 'missing' | 'none'
  const actual = readPng(png);
  if (mode === 'all' || !fs.existsSync(file)) {
    const existed = fs.existsSync(file);
    fs.writeFileSync(file, encodeBaseline(actual));
    testInfo.annotations.push({ type: 'visual', description: `${name}: baseline ${existed ? 're-recorded' : 'written'}` });
    console.log(`[visual] ${name}: baseline ${existed ? 're-recorded' : 'written'} (${actual.width}x${actual.height})`);
    if (mode !== 'all') expect(existed, `baseline ${path.relative(ROOT, file)} was missing; it has been written, re-run to compare`).toBe(true);
    return null;
  }
  const expected = readPng(file);
  const cmp = compareImages(actual, expected, { regions: opts.regions });
  const th = { ...THRESHOLDS, ...(opts.thresholds || {}) };
  const { failures, summary } = judge(cmp, opts.regions ? th : { ...th, region: null });
  const line = cmp.sizeMismatch ? `size mismatch ${cmp.actual} vs ${cmp.expected}` : fmtSummary(summary);
  console.log(`[visual] ${name}: ${line}${failures.length ? '  FAIL' : ''}`);
  testInfo.annotations.push({ type: 'visual', description: `${name}: ${line}` });
  const metricsFile = testInfo.outputPath(`${name}-metrics.json`);
  fs.writeFileSync(metricsFile, JSON.stringify({ name, thresholds: th, summary, failures }, null, 2));
  if (failures.length && mode === 'changed') {
    fs.writeFileSync(file, encodeBaseline(actual));
    console.log(`[visual] ${name}: baseline updated (--update-snapshots=changed)`);
    return summary;
  }
  if (failures.length) {
    const out = (s) => testInfo.outputPath(`${name}-${s}.png`);
    fs.writeFileSync(out('actual'), png);
    fs.copyFileSync(file, out('expected'));
    if (!cmp.sizeMismatch) writePng(out('diff'), diffImage(actual, expected));
    for (const s of ['actual', 'expected', 'diff']) if (fs.existsSync(out(s))) await testInfo.attach(`${name}-${s}`, { path: out(s), contentType: 'image/png' });
    await testInfo.attach(`${name}-metrics`, { path: metricsFile, contentType: 'application/json' });
  }
  expect(failures, `${name} differs visibly from its baseline (diff images in ${path.relative(ROOT, testInfo.outputDir)})`).toEqual([]);
  return summary;
}
