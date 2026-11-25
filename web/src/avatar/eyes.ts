export const EYE_LABELS = ['Düz bakış', 'Hafif kapanma', 'Yarım kapalı', 'Kapalı', 'Sağa bakış', 'Sola bakış', 'Yukarı bakış'] as const;
export const EYE_TIMING = { blinkMin: 7000, blinkMax: 11000, blinkDuration: 260, gazeMin: 16000, gazeMax: 24000 } as const;

export class EyeMotion {
  private random: () => number;
  private initialized = false;
  private suspended = false;
  private nextBlink = 0;
  private blinkStarted: number | undefined;
  private nextGaze = 0;
  private gazeUntil = 0;
  private gazeFrame = 1;
  private lastGazeStart = -Infinity;
  private previousMode = '';
  private thinkingSince: number | undefined;
  private thoughtUsed = false;
  constructor(random = Math.random) { this.random = random; }
  reset(now: number) {
    this.initialized = true; this.suspended = false; this.blinkStarted = undefined;
    this.nextBlink = now + EYE_TIMING.blinkMin + this.random() * (EYE_TIMING.blinkMax - EYE_TIMING.blinkMin);
    this.nextGaze = now + EYE_TIMING.gazeMin + this.random() * (EYE_TIMING.gazeMax - EYE_TIMING.gazeMin);
    this.gazeUntil = 0; this.gazeFrame = 1; this.previousMode = ''; this.thinkingSince = undefined; this.thoughtUsed = false;
    this.lastGazeStart = -Infinity;
  }
  sample(now: number, mode: string, enabled = true) {
    if (!enabled) { this.suspended = true; return 1; }
    if (!this.initialized || this.suspended) this.reset(now);
    if (mode !== this.previousMode) {
      this.thinkingSince = mode === 'thinking' ? now : undefined;
      this.thoughtUsed = false; this.previousMode = mode;
    }
    if (this.blinkStarted === undefined && now >= this.nextBlink) this.blinkStarted = now;
    if (this.blinkStarted !== undefined) {
      const elapsed = now - this.blinkStarted;
      if (elapsed < 45) return 2;
      if (elapsed < 90) return 3;
      if (elapsed < 140) return 4;
      if (elapsed < 190) return 3;
      if (elapsed < 235) return 2;
      if (elapsed < EYE_TIMING.blinkDuration) return this.gazeUntil > now ? this.gazeFrame : 1;
      this.blinkStarted = undefined;
      this.nextBlink = now + EYE_TIMING.blinkMin + this.random() * (EYE_TIMING.blinkMax - EYE_TIMING.blinkMin);
    }
    if (this.gazeUntil && now >= this.gazeUntil) { this.gazeUntil = 0; this.gazeFrame = 1; }
    const thoughtDue = this.thinkingSince !== undefined && now - this.thinkingSince >= 900 && !this.thoughtUsed && now - this.lastGazeStart >= EYE_TIMING.gazeMin;
    if (!this.gazeUntil && (now >= this.nextGaze || thoughtDue)) {
      this.gazeFrame = mode === 'thinking' ? 7 : this.random() < .5 ? 5 : 6;
      this.gazeUntil = now + 700 + this.random() * 400;
      this.lastGazeStart = now; this.thoughtUsed = true;
      this.nextGaze = now + EYE_TIMING.gazeMin + this.random() * (EYE_TIMING.gazeMax - EYE_TIMING.gazeMin);
    }
    return this.gazeFrame;
  }
}
