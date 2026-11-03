import { loadConfig as defaultLoadConfig } from '../config/config-loader.js';
import { selectVoice as defaultSelectVoice } from '../voice/voice-selector.js';
import { splitSentences } from '../speech/split.js';
import { buildTimeline as defaultBuildTimeline, resyncAt as defaultResyncAt, sampleAt } from '../lipsync/index.js';

const defaultClock = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: id => globalThis.clearTimeout(id)
};

/** SpeechPort end means the entire parts queue has ended. The port suppresses
 * cancelled native events; detached callbacks are also guarded by session id.
 * open() resolves when config is loaded and the greeting timer is scheduled.
 */
export class Conversation {
  constructor({ speech, animator, liveliness, clock = defaultClock,
    loadConfig = defaultLoadConfig, selectVoice = defaultSelectVoice,
    buildTimeline = defaultBuildTimeline, resyncAt = defaultResyncAt }) {
    Object.assign(this, { speech, animator, liveliness, clock, loadConfig,
      selectVoice, buildTimeline, resyncAt });
    this.state = 'Closed';
    this.sessionId = 0;
    this.session = null;
    this.rate = 1;
    this.pitch = 1;
    this.rateChanged = false;
    this.pitchChanged = false;
    this.config = { speech: { lang: 'tr-TR' } };
    this.listeners = new Map();
    this.cleanups = [];
    this.timer = null;
  }

  on(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  emit(type, details = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener({ type, ...details });
  }

  clearWork() {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }

  replace(text, state) {
    // Invalidate before cancel(), which may synchronously dispatch old events.
    this.sessionId += 1;
    if (this.session && ['Waiting', 'Speaking'].includes(this.session.status)) {
      this.session.status = 'Cancelled';
    }
    this.clearWork();
    this.speech.cancel();
    this.animator.closeMouth();
    this.session = { id: this.sessionId, text, parts: splitSentences(text), status: 'Waiting' };
    this.state = state;
    return this.session;
  }

  async open() {
    const openedAt = this.clock.now();
    const session = this.replace('', 'Waiting');
    this.animator.start();
    this.liveliness?.start();
    try {
      const config = await this.loadConfig();
      if (!this.current(session)) return;
      this.config = config;
      if (!this.rateChanged) this.rate = config.speech.rate;
      if (!this.pitchChanged) this.pitch = config.speech.pitch;
      session.text = config.greeting.text;
      session.parts = splitSentences(session.text);
      this.timer = this.clock.setTimeout(() => {
        this.timer = null;
        if (this.current(session)) this.speak(session);
      }, Math.max(0, openedAt + config.greeting.delayMs - this.clock.now()));
    } catch (error) {
      if (this.current(session)) this.finish(session, error);
    }
  }

  current(session, event = {}) {
    return this.sessionId === session.id && this.session === session &&
      ['Waiting', 'Speaking'].includes(session.status) &&
      (event.sessionId === undefined || event.sessionId === session.id);
  }

  say(text) {
    if (typeof text !== 'string') throw new TypeError('text must be a string');
    if (!text.trim()) return;
    const session = this.replace(text, 'Waiting');
    this.animator.start();
    this.liveliness?.start();
    this.speak(session);
  }

  speak(session) {
    const { voice, missingVoice } = this.selectVoice(this.speech);
    if (missingVoice) this.emit('voice-warning', { message: missingVoice });
    const rate = this.rate;
    let timeline;
    let origin;
    const listen = (type, callback) => this.cleanups.push(this.speech.on(type, event => {
      if (this.current(session, event)) callback(event);
    }));
    listen('start', () => {
      if (session.status === 'Speaking') return;
      session.status = 'Speaking';
      this.state = 'Speaking';
      timeline = this.buildTimeline(session.text, rate);
      origin = this.clock.now();
      const update = () => {
        if (!this.current(session)) return;
        const target = sampleAt(timeline, this.clock.now() - origin);
        this.animator.setMouthTarget({ open: target.openness, width: target.width, round: target.roundness });
      };
      this.cleanups.push(this.animator.subscribe(update));
      update();
    });
    listen('boundary', event => {
      if (timeline) this.resyncAt(timeline, event.charIndex, this.clock.now() - origin);
    });
    listen('end', () => this.finish(session));
    listen('error', event => this.finish(session, event.error));
    this.liveliness?.glanceBeforeSpeech();
    try {
      this.speech.speak(session.parts, {
        voice: voice ?? undefined, rate, pitch: this.pitch, lang: this.config.speech.lang
      });
    } catch (error) {
      if (this.current(session)) this.finish(session, error);
    }
  }

  finish(session, error) {
    this.clearWork();
    this.animator.closeMouth();
    session.status = 'Ended';
    this.state = 'Idle';
    if (error !== undefined) this.emit('error', { error });
  }

  close() {
    this.replace('', 'Closed');
    this.session = null;
    this.liveliness?.stop();
    this.animator.stop();
  }

  setRate(value) {
    this.validateControl(value);
    this.rate = value;
    this.rateChanged = true;
  }

  setPitch(value) {
    this.validateControl(value);
    this.pitch = value;
    this.pitchChanged = true;
  }

  validateControl(value) {
    if (!Number.isFinite(value) || value < 0.5 || value > 1.5) {
      throw new RangeError('speech control must be between 0.5 and 1.5');
    }
  }
}
