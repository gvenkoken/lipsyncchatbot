import { SpeechPort, validateParts } from './speech-port.js';

export class FakeSpeech extends SpeechPort {
  constructor({ voices = [], supportsBoundary = true } = {}) {
    super();
    this.supportsBoundary = supportsBoundary;
    this.voices = [...voices];
    this.calls = [];
    this.active = false;
    this.unlocked = false;
  }
  speak(parts, options = {}) {
    validateParts(parts);
    this.cancel();
    this.calls.push({ parts: [...parts], options: { ...options } });
    this.active = parts.some(part => part.trim());
    this.started = false;
  }
  cancel() { this.active = false; }
  unlock() { this.unlocked = true; }
  getVoices() { return [...this.voices]; }
  setVoices(voices) { this.voices = [...voices]; this.emit('voiceschanged'); }
  emitStart() {
    if (!this.active || this.started) return;
    this.started = true;
    this.emit('start');
  }
  emitBoundary(details) {
    if (this.active && this.supportsBoundary) this.emit('boundary', details);
  }
  emitEnd() {
    if (!this.active) return;
    this.active = false;
    this.emit('end');
  }
  emitError(error) {
    if (!this.active) return;
    this.active = false;
    this.emit('error', { error });
  }
}
