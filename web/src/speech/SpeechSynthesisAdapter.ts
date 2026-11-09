import { SpeechEvents, wordOffsets, type SpeechPort, type SpeechSettings, type SpeechVoice } from './SpeechPort';

export type SynthesisEngine = Pick<SpeechSynthesis, 'getVoices' | 'speak' | 'cancel' | 'addEventListener' | 'removeEventListener'>;

export class SpeechSynthesisAdapter extends SpeechEvents implements SpeechPort {
  private generation = 0;
  private disposed = false;
  private pending?: () => void;
  private readonly voicesChanged = () => {
    if (!this.voices().length) { this.emit({ type: 'voiceUnavailable' }); return; }
    const pending = this.pending;
    this.pending = undefined;
    pending?.();
  };
  constructor(
    private readonly synthesis: SynthesisEngine | undefined = globalThis.speechSynthesis,
    private readonly createUtterance: (text: string) => SpeechSynthesisUtterance = text => new SpeechSynthesisUtterance(text),
  ) {
    super();
    synthesis?.addEventListener('voiceschanged', this.voicesChanged);
  }
  private voices(): SpeechSynthesisVoice[] {
    return (this.synthesis?.getVoices() ?? []).filter(voice => /^tr(?:-tr)?$/i.test(voice.lang));
  }
  getTurkishVoices(): SpeechVoice[] {
    const voices = this.voices();
    if (!voices.length && !this.disposed) this.emit({ type: 'voiceUnavailable' });
    return voices.map(voice => ({ id: voice.voiceURI, name: voice.name, lang: voice.lang }));
  }
  speak(text: string, settings: SpeechSettings): void {
    if (this.disposed) return;
    this.cancel();
    const generation = this.generation;
    const begin = () => {
      if (generation !== this.generation || this.disposed) return;
      const voices = this.voices();
      const voice = voices.find(item => item.voiceURI === settings.voice)
        ?? voices.find(item => /^tr-tr$/i.test(item.lang)) ?? voices[0];
      if (!voice || !this.synthesis) return;
      const utterance = this.createUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = settings.rate;
      utterance.pitch = settings.pitch;
      const offsets = wordOffsets(text);
      let finished = false;
      const active = () => !finished && generation === this.generation && !this.disposed;
      utterance.onstart = () => { if (active()) this.emit({ type: 'start' }); };
      utterance.onboundary = event => {
        if (!active() || (event.name && event.name !== 'word')) return;
        let wordIndex = 0;
        offsets.forEach((offset, index) => { if (offset <= event.charIndex) wordIndex = index; });
        this.emit({ type: 'boundary', charIndex: event.charIndex, wordIndex });
      };
      const finish = () => {
        if (!active()) return;
        finished = true;
        this.emit({ type: 'end' });
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      this.synthesis.speak(utterance);
    };
    if (!this.voices().length) {
      this.pending = begin;
      this.emit({ type: 'voiceUnavailable' });
    } else begin();
  }
  cancel(): void { this.generation++; this.pending = undefined; this.synthesis?.cancel(); }
  dispose(): void {
    this.cancel();
    this.disposed = true;
    this.synthesis?.removeEventListener('voiceschanged', this.voicesChanged);
    this.clearListeners();
  }
}
