import { SpeechEvents, wordOffsets, type SpeechPort, type SpeechSettings, type SpeechVoice } from './SpeechPort';

export interface SpeechClock {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}
const clock: SpeechClock = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Fixed timing supports fake timers and injected schedulers without browser speech. */
export class FakeSpeech extends SpeechEvents implements SpeechPort {
  private generation = 0;
  private handles: unknown[] = [];
  private disposed = false;
  constructor(private readonly available = true, private readonly scheduler: SpeechClock = clock) { super(); }
  getTurkishVoices(): SpeechVoice[] {
    if (!this.available && !this.disposed) this.emit({ type: 'voiceUnavailable' });
    return this.available ? [{ id: 'fake-tr', name: 'Türkçe (sahte)', lang: 'tr-TR' }] : [];
  }
  speak(text: string, settings: SpeechSettings): void {
    if (this.disposed) return;
    this.cancel();
    if (!this.available) { this.emit({ type: 'voiceUnavailable' }); return; }
    const generation = this.generation;
    const schedule = (delay: number, callback: () => void) => {
      this.handles.push(this.scheduler.setTimeout(() => {
        if (generation === this.generation && !this.disposed) callback();
      }, delay));
    };
    const step = 200 / (Number.isFinite(settings.rate) && settings.rate > 0 ? settings.rate : 1);
    schedule(0, () => this.emit({ type: 'start' }));
    const offsets = wordOffsets(text);
    offsets.forEach((charIndex, wordIndex) => schedule((wordIndex + 1) * step,
      () => this.emit({ type: 'boundary', charIndex, wordIndex })));
    schedule((offsets.length + 1) * step, () => this.emit({ type: 'end' }));
  }
  cancel(): void {
    this.generation++;
    this.handles.forEach(handle => this.scheduler.clearTimeout(handle));
    this.handles = [];
  }
  dispose(): void { this.cancel(); this.disposed = true; this.clearListeners(); }
}
