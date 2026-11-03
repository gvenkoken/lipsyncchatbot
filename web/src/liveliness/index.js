export const DOUBLE_BLINK_PROBABILITY = 0.15;

/**
 * Uses the animator's existing frame subscription; never schedules frames itself.
 * Clock supplies now() in milliseconds; Random supplies next() in [0, 1).
 * Call start()/stop() to attach/detach, or update() to sample manually.
 * A double is a pair separated by 2000 ms, preserving AC04.1's minimum
 * interval for every blink, including the second blink of a pair.
 */
export class LivelinessScheduler {
  constructor({ animator, clock = { now: () => performance.now() }, random = { next: () => Math.random() } }) {
    this.animator = animator;
    this.clock = clock;
    this.random = random;
    this.origin = clock.now();
    this.blinkStart = this.origin + this.interval();
    this.secondOfPair = false;
    this.previousWasDouble = false;
    this.glanceStart = null;
    this.unsubscribe = null;
  }

  interval() {
    return 2000 + this.random.next() * 4000;
  }

  advanceBlink() {
    if (this.secondOfPair) {
      this.secondOfPair = false;
      this.previousWasDouble = true;
      this.blinkStart += this.interval();
    } else if (!this.previousWasDouble && this.random.next() < DOUBLE_BLINK_PROBABILITY) {
      this.secondOfPair = true;
      this.blinkStart += 2000;
    } else {
      this.previousWasDouble = false;
      this.blinkStart += this.interval();
    }
  }

  update() {
    const now = this.clock.now();
    // Advance from scheduled timestamps, so sparse frames do not shift the plan.
    while (now >= this.blinkStart + 120) this.advanceBlink();
    const seconds = (now - this.origin) / 1000;
    const glanceAge = this.glanceStart === null ? -1 : now - this.glanceStart;
    const glance = glanceAge >= 0 && glanceAge < 600
      ? Math.sin(Math.PI * glanceAge / 600) : 0;
    const targets = {
      eyelid: now >= this.blinkStart ? 1 : 0,
      breath: 0.5 + 0.5 * Math.sin(seconds * 2 * Math.PI / 4),
      headTilt: 0.04 * Math.sin(seconds * 2 * Math.PI / 5 + Math.PI / 3),
      pupil: { x: glance ? -0.25 * glance : 0, y: glance ? -0.12 * glance : 0 }
    };
    this.animator.setTargets(targets);
    return targets;
  }

  glanceBeforeSpeech() {
    this.glanceStart = this.clock.now();
    this.update();
  }

  start() {
    if (this.unsubscribe) return;
    this.update();
    this.unsubscribe = this.animator.subscribe(() => this.update());
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.glanceStart = null;
    this.animator.setTargets({ eyelid: 0, pupil: { x: 0, y: 0 }, breath: 0, headTilt: 0 });
  }
}
