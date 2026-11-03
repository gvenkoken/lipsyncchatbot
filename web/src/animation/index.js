const pair = value => ({ current: value, target: value });

/** Each scalar keeps its rendered value and its independently set target. */
export class FaceState {
  constructor() {
    this.mouth = { open: pair(0), width: pair(0.5), round: pair(0) };
    this.eyelid = pair(0);
    this.pupil = { x: pair(0), y: pair(0) };
    this.headTilt = pair(0);
    this.breath = pair(0);
  }
}

const channels = state => [
  ...Object.values(state.mouth), state.eyelid,
  ...Object.values(state.pupil), state.headTilt, state.breath
];

/**
 * clock supplies requestAnimationFrame(callback) and cancelAnimationFrame(id).
 * Subscribers receive FaceState after all channels advance, once per frame.
 * Pass partial numeric targets, e.g. { pupil: { x: -0.2 }, breath: 1 }.
 */
export class FaceAnimator {
  constructor({ clock = globalThis } = {}) {
    this.clock = clock;
    this.state = new FaceState();
    this.listeners = new Set();
    this.running = false;
    this.frameId = null;
    this.tick = () => {
      this.frameId = null;
      if (!this.running) return;
      // Queue first so subscriber calls to start() cannot create another loop.
      this.frameId = this.clock.requestAnimationFrame(this.tick);
      for (const channel of channels(this.state)) {
        channel.current += (channel.target - channel.current) * 0.35;
      }
      for (const listener of [...this.listeners]) listener(this.state);
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.frameId = this.clock.requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    if (this.frameId !== null) this.clock.cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setTargets(targets) {
    const updates = [];
    const collect = (state, values) => {
      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw new TypeError('targets must be an object');
      }
      for (const [key, value] of Object.entries(values)) {
        if (!Object.hasOwn(state, key)) throw new TypeError(`Unknown target: ${key}`);
        const channel = state[key];
        if (Object.hasOwn(channel, 'current')) {
          if (!Number.isFinite(value)) throw new TypeError(`${key} must be finite`);
          updates.push([channel, value]);
        } else collect(channel, value);
      }
    };
    collect(this.state, targets);
    for (const [channel, value] of updates) channel.target = value;
  }

  setMouthTarget(target) {
    this.setTargets({ mouth: target });
  }

  closeMouth() {
    this.setMouthTarget({ open: 0, width: 0.5, round: 0 });
  }
}
