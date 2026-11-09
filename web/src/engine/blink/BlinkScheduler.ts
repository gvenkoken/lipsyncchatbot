/** Random samples must be finite and in [0, 1). */
export type Random = () => number;
export type EyePose = 'open' | 'half-open' | 'closed';

const BLINK_DURATION_MS = 150;

/**
 * Independent eye channel driven only by elapsed milliseconds.
 * Intervals are measured from blink start to blink start (including the blink).
 * No timers or animation state are owned by this scheduler.
 */
export class BlinkScheduler {
  private elapsedMs = 0;
  private nextBlinkAtMs: number;

  constructor(private readonly random: Random = Math.random) {
    this.nextBlinkAtMs = this.sampleInterval();
  }

  /** Advance by a finite, nonnegative delta and return the current eye pose. */
  update(deltaMs: number): EyePose {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new RangeError('Blink delta must be finite and nonnegative.');
    }
    this.elapsedMs += deltaMs;

    // Consume complete cycles so coarse frames preserve the same schedule.
    while (this.elapsedMs >= this.nextBlinkAtMs + BLINK_DURATION_MS) {
      this.nextBlinkAtMs += this.sampleInterval();
    }

    const phaseMs = this.elapsedMs - this.nextBlinkAtMs;
    if (phaseMs < 30) return 'open';
    if (phaseMs < 60) return 'half-open';
    if (phaseMs < 120) return 'closed';
    return 'half-open';
  }

  private sampleInterval(): number {
    const value = this.random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError('Blink Random must return a finite value in [0, 1).');
    }
    return 2000 + value * 4000;
  }
}
