import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOUTH_POSES, PREVIEW_SEQUENCE, mouthBetween, previewFrame, speechFrame } from '../src/avatar/poses.ts';

const order = MOUTH_POSES.map(pose => pose.id);
const unique = (values: number[]) => values.filter((value, index) => index === 0 || value !== values[index - 1]);

test('opening and closing traverse supplied poses in physical order, including skipped main targets', () => {
  const opening = unique(Array.from({ length: 601 }, (_, i) => mouthBetween(1, 5, i / 600)));
  const closing = unique(Array.from({ length: 601 }, (_, i) => mouthBetween(5, 1, i / 600)));
  assert.deepEqual(opening, order);
  assert.deepEqual(closing, [...order].reverse());
  assert.equal(mouthBetween(1, 5, -1), 1);
  assert.equal(mouthBetween(1, 5, 2), 5);
});

test('preview keeps every original main-pose deadline and the original total duration', () => {
  for (const interval of [80, 150, 360]) {
    for (let index = 0; index < PREVIEW_SEQUENCE.length; index++) {
      assert.equal(previewFrame(index * interval, interval), PREVIEW_SEQUENCE[index]);
    }
    const total = interval * PREVIEW_SEQUENCE.length;
    for (let t = 0; t <= total; t += 13) assert.equal(previewFrame(t, interval), previewFrame(t + total, interval));
    const frames = new Set(Array.from({ length: total }, (_, t) => previewFrame(t, interval)));
    assert.equal(frames.size, 12);
    // The deliberate closed-mouth pause stays closed throughout its slot.
    for (let t = 8 * interval; t < 9 * interval; t++) assert.equal(previewFrame(t, interval), 1);
  }
  assert.equal(previewFrame(-20, 150), 1);
});

test('fast speech transitions finish inside each cue without extending audio timing', () => {
  const cues = [5, 1, 4, 2, 5, 3].map((frame, i) => ({ frame, start: i * .06, end: (i + 1) * .06 }));
  for (const cue of cues) {
    assert.equal(speechFrame(cues, cue.end - .001), cue.frame);
    for (let t = cue.start; t < cue.end; t += .001) assert.ok(order.includes(speechFrame(cues, t)));
  }
  const sampled = new Set(Array.from({ length: 36 }, (_, t) => speechFrame(cues, t / 100)));
  assert.ok([...sampled].some(id => id > 5));
  assert.equal(speechFrame(cues, .36), 1);
});

test('word resynchronization starts from the displayed pose and never resets the first cue to closed', () => {
  const cues = [{ start: 0, end: .09, frame: 3 }];
  assert.equal(speechFrame(cues, 0, 12), 12);
  assert.equal(speechFrame(cues, .08, 12), 3);
  assert.equal(speechFrame(cues, -1, 12), 12);
  assert.equal(speechFrame([], 1), 1);
});
