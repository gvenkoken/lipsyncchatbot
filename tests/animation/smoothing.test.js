import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceAnimator, FaceState } from '../../web/src/animation/index.js';
import { FakeClock } from '../helpers/clock.js';

const scalars = state => [
  ...Object.values(state.mouth), state.eyelid,
  ...Object.values(state.pupil), state.headTilt, state.breath
];

test('every FaceState channel advances by 0.35 without overshooting', () => {
  const clock = new FakeClock();
  const animator = new FaceAnimator({ clock });
  assert.ok(animator.state instanceof FaceState);
  animator.setTargets({
    mouth: { open: 1, width: 1, round: 1 }, eyelid: 1,
    pupil: { x: 1, y: -1 }, headTilt: -1, breath: 1
  });
  const starts = scalars(animator.state).map(channel => channel.current);
  animator.start();
  clock.advance(16);
  assert.equal(animator.state.mouth.open.current, 0.35);
  scalars(animator.state).forEach((channel, index) => {
    assert.equal(channel.current, starts[index] + (channel.target - starts[index]) * 0.35);
  });
  clock.advance(16);
  assert.equal(animator.state.mouth.open.current, 0.5775);
  for (let frame = 0; frame < 100; frame++) {
    const previous = scalars(animator.state).map(channel => channel.current);
    clock.advance(16);
    scalars(animator.state).forEach((channel, index) => {
      assert.ok(channel.current >= Math.min(previous[index], channel.target));
      assert.ok(channel.current <= Math.max(previous[index], channel.target));
    });
  }
  animator.stop();
});

test('repeated start keeps one frame pending and closeMouth converges in 20 frames', () => {
  const clock = new FakeClock();
  const animator = new FaceAnimator({ clock });
  let renders = 0;
  const unsubscribe = animator.subscribe(state => {
    assert.equal(state, animator.state);
    renders++;
    animator.start();
  });
  animator.setMouthTarget({ open: 1 });
  animator.start();
  animator.start();
  assert.equal(clock.frames.size, 1);
  for (let frame = 0; frame < 20; frame++) clock.advance(16);
  assert.equal(renders, 20);
  animator.closeMouth();
  assert.equal(animator.state.mouth.open.target, 0);
  for (let frame = 0; frame < 20; frame++) {
    clock.advance(16);
    assert.equal(clock.frames.size, 1);
  }
  assert.ok(animator.state.mouth.open.current < 0.01);
  unsubscribe();
  clock.advance(16);
  assert.equal(renders, 40);
  animator.stop();
  animator.stop();
  assert.equal(clock.frames.size, 0);
  clock.advance(16);
  assert.equal(renders, 40);
});

test('partial targets preserve other channels and invalid updates are atomic', () => {
  const animator = new FaceAnimator({ clock: new FakeClock() });
  animator.setTargets({ pupil: { x: -0.5 } });
  assert.equal(animator.state.pupil.x.target, -0.5);
  assert.equal(animator.state.pupil.y.target, 0);
  assert.equal(animator.state.mouth.width.target, 0.5);
  assert.throws(() => animator.setTargets({ breath: 1, eyelid: NaN }), TypeError);
  assert.equal(animator.state.breath.target, 0);
  assert.throws(() => animator.setMouthTarget({ unknown: 1 }), TypeError);
});
