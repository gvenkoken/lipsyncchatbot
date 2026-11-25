// Zamanlama kaynağı değiştirilebilir: bugün enerji tabanlı tahmin, ileride ElevenLabs "with-timestamps" vb.
import { alignText, type AlignParams } from './align.ts';
import type { Timing } from './visemes.ts';

export type SpeechAudio = { buffer: AudioBuffer; text: string; /** Sağlayıcı kendi zaman damgalarını verdiyse */ timings?: Timing[] };
export interface TimingProvider {
  readonly name: string;
  getTimings(speech: SpeechAudio): Promise<Timing[]> | Timing[];
}

/** OpenAI TTS gibi zaman damgası vermeyen sesler için: ses enerjisi + metin. */
export class EnergyAlignProvider implements TimingProvider {
  readonly name = 'energy-align';
  private params?: Partial<AlignParams>;
  constructor(params?: Partial<AlignParams>) { this.params = params; }
  getTimings(speech: SpeechAudio) { return alignText(speech.buffer, speech.text, this.params); }
}

/** TTS karakter zaman damgası döndürüyorsa (ör. ElevenLabs with-timestamps) doğrudan kullanılır. */
export class ProvidedTimingProvider implements TimingProvider {
  readonly name = 'provided';
  private fallback: TimingProvider;
  constructor(fallback: TimingProvider = new EnergyAlignProvider()) { this.fallback = fallback; }
  getTimings(speech: SpeechAudio) { return speech.timings?.length ? speech.timings : this.fallback.getTimings(speech); }
}
