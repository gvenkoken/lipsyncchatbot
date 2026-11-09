import { describe, expect, it, vi } from 'vitest';
import { BlinkScheduler, type EyePose } from './index';

/** Fake frame clock: no wall clock or timers are involved. */
function clock(scheduler: BlinkScheduler) {
  let now = 0;
  return (atMs: number) => {
    const pose = scheduler.update(atMs - now);
    now = atMs;
    return pose;
  };
}

describe('BlinkScheduler', () => {
  it.each([0, 1 - Number.EPSILON])('keeps consecutive starts within 2–6 seconds for Random %s', value => {
    const sample = clock(new BlinkScheduler(() => value));
    const interval = 2000 + value * 4000;
    expect(interval).toBeGreaterThanOrEqual(2000);
    expect(interval).toBeLessThanOrEqual(6000);
    for (let blink = 1; blink <= 4; blink++) {
      const start = interval * blink;
      expect(sample(start)).toBe('open');
      expect(sample(start + 31)).toBe('half-open');
      expect(sample(start + 61)).toBe('closed');
      expect(sample(start + 151)).toBe('open');
    }
  });

  it('passes through open, half-open, closed, half-open, open in 150 ms', () => {
    const sample = clock(new BlinkScheduler(() => 0));
    const poses = [0, 30, 60, 120, 150].map(offset => sample(2000 + offset));
    expect(poses).toEqual(['open', 'half-open', 'closed', 'half-open', 'open']);
    expect(sample(2151)).toBe('open');
  });

  it('continues at the same cadence while the caller changes animation state', () => {
    const sample = clock(new BlinkScheduler(() => 0));
    const observed: Record<string, EyePose[]> = {};
    for (const [index, state] of ['Idle', 'Speaking', 'Thinking'].entries()) {
      observed[state] = [1, 2, 3].map(blink => sample((index * 3 + blink) * 2000 + 60));
    }
    expect(observed).toEqual({
      Idle: ['closed', 'closed', 'closed'],
      Speaking: ['closed', 'closed', 'closed'],
      Thinking: ['closed', 'closed', 'closed'],
    });
  });

  it('preserves varying random intervals across coarse and fine frame deltas', () => {
    const random = () => {
      const values = [0, 0.5, 0.9, 0.25];
      return vi.fn(() => values.shift() ?? 0);
    };
    const coarseRandom = random();
    const fineRandom = random();
    const coarse = clock(new BlinkScheduler(coarseRandom));
    const fine = clock(new BlinkScheduler(fineRandom));
    for (let time = 0; time < 11660; time += 10) fine(time);
    expect(coarse(11660)).toBe('closed');
    expect(fine(11660)).toBe('closed');
    expect(coarseRandom.mock.calls.length).toBe(fineRandom.mock.calls.length);
    expect(coarse(11750)).toBe('open');
  });

  it.each([-1, NaN, Infinity])('rejects invalid delta %s without advancing', delta => {
    const scheduler = new BlinkScheduler(() => 0);
    expect(() => scheduler.update(delta)).toThrow(RangeError);
    expect(scheduler.update(2060)).toBe('closed');
  });

  it.each([-0.1, 1, NaN, Infinity])('rejects invalid Random sample %s', value => {
    expect(() => new BlinkScheduler(() => value)).toThrow(RangeError);
  });
});
