import { SpeechPort, validateParts } from './speech-port.js';

export class BrowserSpeech extends SpeechPort {
  constructor({ synthesis = globalThis.speechSynthesis,
    Utterance = globalThis.SpeechSynthesisUtterance } = {}) {
    super();
    this.synthesis = synthesis;
    this.Utterance = Utterance;
    this.generation = 0;
    this.unlocked = false;
    this.supportsBoundary = Boolean(Utterance && 'onboundary' in new Utterance(''));
    this.voicesChanged = () => this.emit('voiceschanged');
    synthesis?.addEventListener('voiceschanged', this.voicesChanged);
  }
  getVoices() { return this.synthesis?.getVoices() || []; }
  unlock() {
    if (this.unlocked || !this.synthesis || !this.Utterance) return;
    this.synthesis.speak(new this.Utterance(''));
    this.unlocked = true;
  }
  cancel() {
    this.generation += 1;
    this.activeUtterance = null;
    this.synthesis?.cancel();
  }
  speak(parts, { voice, rate = 1, pitch = 1, lang = 'tr-TR' } = {}) {
    validateParts(parts);
    this.cancel();
    const generation = this.generation;
    if (!parts.some(part => part.trim())) return;
    if (!this.synthesis || !this.Utterance) {
      this.emit('error', { error: 'unsupported' });
      return;
    }
    const queue = [...parts];
    let started = false;
    let offset = 0;
    const read = index => {
      if (generation !== this.generation) return;
      if (index === queue.length) {
        this.activeUtterance = null;
        this.generation += 1;
        this.emit('end');
        return;
      }
      const utterance = new this.Utterance(queue[index]);
      this.activeUtterance = utterance;
      Object.assign(utterance, { rate, pitch, lang });
      if (voice !== undefined) utterance.voice = voice;
      const partOffset = offset;
      let finished = false;
      let partStarted = false;
      const current = () => generation === this.generation && !finished;
      utterance.onstart = () => {
        if (!current() || partStarted) return;
        partStarted = true;
        if (!started) {
          started = true;
          this.emit('start');
        }
        // Each sentence's real start lets the mouth resync even without boundary events.
        this.emit('part', { index, charIndex: partOffset, length: queue[index].length });
      };
      if (this.supportsBoundary) utterance.onboundary = event => {
        if (current()) this.emit('boundary', {
          charIndex: offset + event.charIndex, charLength: event.charLength,
          name: event.name, elapsedTime: event.elapsedTime,
        });
      };
      utterance.onend = () => {
        if (!current()) return;
        finished = true;
        offset += queue[index].length;
        if (partStarted) this.emit('part-end', { index });
        read(index + 1);
      };
      utterance.onerror = event => {
        if (!current()) return;
        this.cancel();
        this.emit('error', { error: event.error });
      };
      try { this.synthesis.speak(utterance); }
      catch (error) { utterance.onerror({ error }); }
    };
    read(0);
  }
  dispose() {
    this.cancel();
    this.synthesis?.removeEventListener('voiceschanged', this.voicesChanged);
    this.listeners.clear();
  }
}
