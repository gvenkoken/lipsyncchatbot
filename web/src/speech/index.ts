export * from './SpeechPort';
export * from './SpeechSynthesisAdapter';
export * from './FakeSpeech';
import { FakeSpeech } from './FakeSpeech';
import type { SpeechPort } from './SpeechPort';
import { SpeechSynthesisAdapter } from './SpeechSynthesisAdapter';

/** The session owner must dispose the returned port. No network or storage is used. */
export function createSpeechPort(search: string = globalThis.location?.search ?? ''): SpeechPort {
  const mode = new URLSearchParams(search).get('speech');
  if (mode === 'fake') return new FakeSpeech();
  if (mode === 'none') return new FakeSpeech(false);
  return new SpeechSynthesisAdapter();
}
