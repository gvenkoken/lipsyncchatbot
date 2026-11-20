import { speechFrame, type TimedMouthCue } from './poses';

export type MouthCue = TimedMouthCue;
export function letterFrame(letter: string) {
  const c = letter.toLocaleLowerCase('tr-TR');
  if (/[mbp]/.test(c)) return 1;
  if (/[aâ]/.test(c)) return 5;
  if (/[eoöuüû]/.test(c)) return 4;
  if (/[ıiîlrdtn]/.test(c)) return 3;
  return /\p{L}/u.test(c) ? 2 : 1;
}
export function timeline(text: string, rate = 1): MouthCue[] {
  let time = 0;
  return [...text].map(letter => {
    const duration = (/[.,!?;:]/.test(letter) ? .22 : /\s/.test(letter) ? .045 : /[aeıioöuü]/i.test(letter) ? .09 : .06) / rate;
    const cue = { start: time, end: time + duration, frame: letterFrame(letter) }; time = cue.end; return cue;
  });
}
export class SpeechDriver {
  private utterance?: SpeechSynthesisUtterance;
  private ticker?: number;
  private watchdog?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private cues: MouthCue[] = [];
  private epoch = 0;
  private anchor = 1;
  private lastFrame = 1;
  speak(text: string, voiceURI: string, rate: number, onFrame: (frame: number) => void, onState: (state: 'thinking' | 'speaking' | 'ended' | 'error', error?: string) => void) {
    this.stop(); const id = this.generation;
    if (!('speechSynthesis' in window)) { onState('error', 'Bu tarayıcı seslendirmeyi desteklemiyor.'); return; }
    const utterance = new SpeechSynthesisUtterance(text.trim()); this.utterance = utterance;
    utterance.lang = 'tr-TR'; utterance.rate = rate;
    const voices = speechSynthesis.getVoices();
    const voice = voices.find(v => v.voiceURI === voiceURI) ?? voices.find(v => v.lang.toLowerCase().startsWith('tr'));
    if (voice) utterance.voice = voice;
    this.cues = timeline(text.trim(), rate); onState('thinking');
    this.watchdog = setTimeout(() => { if (id === this.generation) { this.stop(); onFrame(1); onState('error', 'Ses başlatılamadı. Başka bir ses seçip tekrar deneyin.'); } }, 8000);
    utterance.onstart = () => {
      if (id !== this.generation) return;
      clearTimeout(this.watchdog); this.epoch = performance.now(); onState('speaking');
      const tick = () => {
        if (id !== this.generation) return;
        const elapsed = (performance.now() - this.epoch) / 1000;
        const frame = speechFrame(this.cues, elapsed, this.anchor);
        if (frame !== this.lastFrame) { this.lastFrame = frame; onFrame(frame); }
        this.ticker = requestAnimationFrame(tick);
      };
      tick();
    };
    utterance.onboundary = e => {
      if (id !== this.generation || e.name !== 'word') return;
      this.anchor = this.lastFrame;
      this.cues = timeline(text.trim().slice(e.charIndex), rate); this.epoch = performance.now();
    };
    utterance.onend = () => { if (id === this.generation) { this.stop(); onFrame(1); onState('ended'); } };
    utterance.onerror = e => { if (id === this.generation) { this.stop(); onFrame(1); onState('error', `Seslendirme açılamadı (${e.error}).`); } };
    speechSynthesis.speak(utterance);
  }
  stop() {
    this.generation++; if (this.ticker !== undefined) cancelAnimationFrame(this.ticker); clearTimeout(this.watchdog);
    if (this.utterance) {
      this.utterance.onstart = null; this.utterance.onend = null; this.utterance.onboundary = null; this.utterance.onerror = null;
      speechSynthesis.cancel(); this.utterance = undefined;
    }
    this.cues = []; this.ticker = undefined; this.anchor = 1; this.lastFrame = 1;
  }
}
