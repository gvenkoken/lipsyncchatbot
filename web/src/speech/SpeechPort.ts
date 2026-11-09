export interface SpeechVoice { id: string; name: string; lang: string }
export interface SpeechSettings { voice?: string; rate: number; pitch: number }
export type SpeechEvent = { type: 'start' | 'end' | 'voiceUnavailable' }
  | { type: 'boundary'; charIndex: number; wordIndex: number };
export interface SpeechPort {
  getTurkishVoices(): SpeechVoice[];
  speak(text: string, settings: SpeechSettings): void;
  cancel(): void;
  subscribe(listener: (event: SpeechEvent) => void): () => void;
  dispose(): void;
}
export abstract class SpeechEvents {
  private listeners = new Set<(event: SpeechEvent) => void>();
  subscribe(listener: (event: SpeechEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  protected emit(event: SpeechEvent): void { this.listeners.forEach(listener => listener(event)); }
  protected clearListeners(): void { this.listeners.clear(); }
}
export function wordOffsets(text: string): number[] {
  return Array.from(text.matchAll(/\S+/gu), match => match.index!);
}
