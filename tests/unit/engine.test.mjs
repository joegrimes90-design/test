// The engine clock and the deterministic test hook (?manual=1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/load-game.mjs';

const engineOnly = () => loadGame({ only: ['art-core', 'engine'] });

test('normal mode drives the clock with requestAnimationFrame and has no test hook', () => {
  const g = engineOnly();
  g.AT.engine.init({});
  assert.equal(g.rafCalls, 1);
  assert.equal(g.__test, undefined);
});

test('manual mode: no requestAnimationFrame, clock moves only through __test.step', async () => {
  const g = engineOnly();
  const E = g.AT.engine;
  E.init({ manual: true });
  assert.equal(g.rafCalls || 0, 0);
  assert.equal(typeof g.__test.step, 'function');
  assert.equal(E.time, 0);
  const seen = [];
  E.every((dt) => seen.push(dt));
  const t = await g.__test.step(1, 10);
  assert.ok(Math.abs(t - 1) < 1e-9, `time ${t}`);
  assert.equal(seen.length, 10, 'one engine tick per step');
  assert.ok(seen.every((dt) => Math.abs(dt - 0.1) < 1e-12));
  assert.equal(g.__test.time, E.time);
});

test('timers, tweens and chained waits resolve in order on the stepped clock', async () => {
  const g = engineOnly();
  const E = g.AT.engine;
  E.init({ manual: true });
  const log = [];
  const obj = { x: 0 };
  E.spawn(async () => { await E.wait(0.25); log.push(['a', E.time]); await E.wait(0.25); log.push(['b', E.time]); });
  E.spawn(async () => { await E.tween(obj, { x: 100 }, 0.4, 'linear'); log.push(['tween', E.time, obj.x]); });
  await g.__test.step(0.2, 20);
  assert.equal(log.length, 0);
  assert.ok(obj.x > 45 && obj.x < 55, `mid-tween x=${obj.x}`);
  await g.__test.step(0.6, 20);
  assert.deepEqual(log.map((l) => l[0]), ['a', 'tween', 'b']);
  assert.equal(obj.x, 100);
  for (const [, t] of log) assert.ok(t <= 0.8 + 1e-9);
});

test('cancelling a scene token rejects its pending waits', async () => {
  const g = engineOnly();
  const E = g.AT.engine;
  E.init({ manual: true });
  let outcome = null;
  E.wait(1).then(() => { outcome = 'resolved'; }, (e) => { outcome = e === E.CANCEL ? 'cancelled' : 'error'; });
  E.newToken();
  await g.__test.step(1.5, 10);
  assert.equal(outcome, 'cancelled');
});

test('E.rand is deterministic in recording mode', () => {
  const a = engineOnly().AT.engine, b = engineOnly().AT.engine;
  a.init({ record: true }); b.init({ record: true });
  const sa = Array.from({ length: 5 }, a.rand), sb = Array.from({ length: 5 }, b.rand);
  assert.deepEqual(sa, sb);
  assert.ok(sa.every((v) => v >= 0 && v < 1));
});
