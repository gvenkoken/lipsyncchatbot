import { loadConfig as defaultLoadConfig } from '../config/config-loader.js';
import { selectVoice as defaultSelectVoice, voiceId } from '../voice/voice-selector.js';
import { splitSentences } from '../speech/split.js';
import { prepareSpeechText } from '../speech/text.js';
import { buildTimeline as defaultBuildTimeline, resyncAt as defaultResyncAt, sampleAt, VISEME_TARGETS } from '../lipsync/index.js';

/** The mouth shape leads the sound slightly: smoothing needs a few frames to reach it. */
export const MOUTH_LEAD_MS = 40;
/** Voice speed relative to the lipsync estimate is learnt within these limits. */
export const PACE_LIMITS = Object.freeze({ min: 0.6, max: 1.8 });

const defaultClock = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: id => globalThis.clearTimeout(id)
};

/** SpeechPort end means the entire parts queue has ended. The port suppresses
 * cancelled native events; detached callbacks are also guarded by session id.
 * open() resolves when config is loaded and the greeting timer is scheduled.
 * When the port reports parts, each sentence gets its own timeline from its real
 * start, the mouth rests between sentences, and the voice's measured speed
 * (pace) is kept per voice so the next sentences match it better.
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
    this.voicePreference = '';
    this.paces = new Map();
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
    const spoken = prepareSpeechText(text);
    this.session = { id: this.sessionId, text: spoken, parts: splitSentences(spoken), status: 'Waiting' };
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
      session.text = prepareSpeechText(config.greeting.text);
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
    if (!prepareSpeechText(text)) return;
    const session = this.replace(text, 'Waiting');
    this.animator.start();
    this.liveliness?.start();
    this.speak(session);
  }

  speak(session) {
    const { voice, missingVoice } = this.selectVoice(this.speech, { preferred: this.voicePreference });
    if (missingVoice) this.emit('voice-warning', { message: missingVoice });
    const rate = this.rate;
    const paceKey = `${voiceId(voice)}|${rate}`;
    let timeline = null;
    let origin = 0;
    let offset = 0;
    let part = null;
    const begin = (text, charIndex) => {
      timeline = this.buildTimeline(text, rate * (this.paces.get(paceKey) ?? 1));
      origin = this.clock.now();
      offset = charIndex;
    };
    const update = () => {
      if (!this.current(session)) return;
      const target = timeline ? sampleAt(timeline, this.clock.now() - origin + MOUTH_LEAD_MS) : VISEME_TARGETS.closed;
      this.animator.setMouthTarget({ open: target.openness, width: target.width, round: target.roundness });
    };
    const listen = (type, callback) => this.cleanups.push(this.speech.on(type, event => {
      if (this.current(session, event)) callback(event);
    }));
    listen('start', () => {
      if (session.status === 'Speaking') return;
      session.status = 'Speaking';
      this.state = 'Speaking';
      // The whole text is the estimate for ports that do not report parts.
      begin(session.text, 0);
      this.cleanups.push(this.animator.subscribe(update));
      update();
    });
    listen('part', event => {
      begin(session.text.slice(event.charIndex, event.charIndex + event.length), event.charIndex);
      part = { timeline, startedAt: origin };
      update();
    });
    listen('part-end', () => {
      if (part) this.learnPace(paceKey, part.timeline.estimateMs, this.clock.now() - part.startedAt);
      part = null;
      timeline = null;
      update();
    });
    listen('boundary', event => {
      if (!timeline) return;
      this.resyncAt(timeline, event.charIndex - offset, this.clock.now() - origin);
      update();
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

  /** Compare a sentence's estimated and real length; very short ones say little about speed. */
  learnPace(key, estimateMs, measuredMs) {
    if (!(estimateMs >= 400) || !(measuredMs >= 300)) return;
    const pace = this.paces.get(key) ?? 1;
    const observed = pace * estimateMs / measuredMs;
    const next = (pace + observed) / 2;
    this.paces.set(key, Math.min(PACE_LIMITS.max, Math.max(PACE_LIMITS.min, next)));
  }

  /** '' selects the best Turkish voice; applies from the next speech, not saved. */
  setVoice(id) {
    if (typeof id !== 'string') throw new TypeError('voice id must be a string');
    this.voicePreference = id;
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
