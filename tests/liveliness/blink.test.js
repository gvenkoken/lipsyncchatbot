import test from 'node:test';
import assert from 'node:assert/strict';
import { LivelinessScheduler } from '../../web/src/liveliness/index.js';
import { FaceAnimator } from '../../web/src/animation/index.js';
import { FakeClock } from '../helpers/clock.js';
import { FakeRandom } from '../helpers/random.js';

function setup(values) {
  const clock = new FakeClock();
  const animator = new FaceAnimator({ clock });
  const scheduler = new LivelinessScheduler({ animator, clock, random: new FakeRandom(values) });
  return { clock, animator, scheduler };
}

function simulate(values) {
  const { clock, scheduler } = setup(values);
  const starts = [];
  const durations = [];
  let previous = 0;
  let start;
  for (let ms = 0; ms <= 600000; ms++) {
    const { eyelid } = scheduler.update();
    if (eyelid && !previous) { start = ms; starts.push(ms); }
    if (!eyelid && previous) durations.push(ms - start);
    previous = eyelid;
    clock.advance(1);
  }
  return { starts, durations };
}

test('ten minute plans have bounded, varied intervals and 120 ms blinks', () => {
  const values = [0, 0.2, 0.1, 0.4, 0.3, 0.6, 0.5, 0.8, 0.7, 0.9, 0.999];
  const { starts, durations } = simulate(values);
  const gaps = starts.slice(1).map((start, index) => start - starts[index]);
  assert.ok(starts.length > 100);
  assert.ok(gaps.every(gap => gap >= 2000 && gap <= 6000));
  assert.ok(new Set(gaps).size >= 5);
  assert.ok(durations.length > 100);
  assert.ok(durations.every(duration => duration >= 100 && duration <= 140));
  assert.notDeepEqual(starts, simulate([0.5]).starts);
  assert.deepEqual(starts, simulate(values).starts);
});

function plannedStarts(values, count) {
  const { clock, scheduler } = setup(values);
  const result = [];
  for (let index = 0; index < count; index++) {
    const start = scheduler.blinkStart;
    clock.advance(start - clock.now());
    assert.equal(scheduler.update().eyelid, 1);
    clock.advance(119);
    assert.equal(scheduler.update().eyelid, 1);
    clock.advance(1);
    assert.equal(scheduler.update().eyelid, 0);
    result.push(start);
  }
  return result;
}

test('below threshold creates pairs, with a mandatory single between pairs', () => {
  assert.deepEqual(plannedStarts([0.1], 6), [2400, 4400, 6800, 9200, 11200, 13600]);
  assert.deepEqual(plannedStarts([0.15], 4), [2600, 5200, 7800, 10400]);
  assert.deepEqual(plannedStarts([0.5], 4), [4000, 8000, 12000, 16000]);
});

test('sparse updates preserve the seeded schedule', () => {
  const dense = setup([0.1, 0.9, 0.3, 0.6]);
  const sparse = setup([0.1, 0.9, 0.3, 0.6]);
  for (let i = 0; i < 10000; i++) {
    dense.clock.advance(1);
    dense.scheduler.update();
  }
  sparse.clock.advance(10000);
  assert.deepEqual(sparse.scheduler.update(), dense.scheduler.update());
  assert.equal(sparse.scheduler.blinkStart, dense.scheduler.blinkStart);
});

test('phase shifted motion and temporary glance write only FaceState targets', () => {
  const { clock, scheduler, animator } = setup([0.5]);
  const initial = scheduler.update();
  scheduler.glanceBeforeSpeech();
  clock.advance(300);
  const glance = scheduler.update();
  assert.equal(glance.pupil.x, -0.25);
  assert.equal(glance.pupil.y, -0.12);
  assert.notEqual(glance.breath, initial.breath);
  assert.notEqual(glance.headTilt, initial.headTilt);
  assert.equal(animator.state.breath.target, glance.breath);
  assert.equal(animator.state.headTilt.target, glance.headTilt);
  assert.equal(animator.state.pupil.x.current, 0);
  assert.equal(animator.state.mouth.width.target, 0.5);
  clock.advance(300);
  assert.deepEqual(scheduler.update().pupil, { x: 0, y: 0 });
  clock.advance(400);
  assert.deepEqual(scheduler.update().pupil, { x: 0, y: 0 });
});

test('start is idempotent and stop removes the subscription without another rAF', () => {
  const { clock, scheduler, animator } = setup([0.5]);
  scheduler.start();
  scheduler.start();
  assert.equal(animator.listeners.size, 1);
  assert.equal(clock.frames.size, 0);
  animator.start();
  clock.advance(300);
  assert.equal(clock.frames.size, 1);
  assert.notEqual(animator.state.breath.target, 0.5);
  scheduler.stop();
  scheduler.stop();
  assert.equal(animator.listeners.size, 0);
  assert.equal(animator.state.eyelid.target, 0);
  assert.equal(animator.state.breath.target, 0);
  clock.advance(300);
  assert.equal(animator.state.breath.target, 0);
  animator.stop();
  assert.equal(clock.frames.size, 0);
});
