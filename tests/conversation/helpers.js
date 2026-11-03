import { Conversation } from '../../web/src/conversation/index.js';
import { FakeSpeech } from '../../web/src/speech/fake-speech.js';
import { FaceAnimator } from '../../web/src/animation/index.js';
import { FakeClock } from '../helpers/clock.js';

export class Clock extends FakeClock {
  timers = new Map();
  setTimeout = (callback, delay) => {
    const id = this.nextId++;
    this.timers.set(id, { callback, at: this.time + delay });
    return id;
  };
  clearTimeout = id => this.timers.delete(id);
  advance(ms) {
    const until = this.time + ms;
    while (true) {
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    super.advance(until - this.time);
  }
}

export const config = (text = 'Merhaba!', delayMs = 1500) => ({
  greeting: { text, delayMs }, speech: { rate: 1, pitch: 1, lang: 'tr-TR' }
});

export function setup(overrides = {}) {
  const clock = new Clock();
  const speech = new FakeSpeech();
  const animator = new FaceAnimator({ clock });
  const order = [];
  const cancel = speech.cancel.bind(speech);
  speech.cancel = () => { order.push('cancel'); cancel(); };
  const close = animator.closeMouth.bind(animator);
  animator.closeMouth = () => { order.push('close'); close(); };
  const speak = speech.speak.bind(speech);
  speech.speak = (...args) => { order.push('speak'); speak(...args); };
  const conversation = new Conversation({ speech, animator, clock,
    loadConfig: async () => config(), ...overrides });
  return { conversation, speech, animator, clock, order };
}
