import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpeechPort, FakeSpeech, SpeechSynthesisAdapter, type SpeechEvent, type SynthesisEngine } from './index';

const settings = { rate: 1, pitch: 1 };
const voice = (lang: string): SpeechSynthesisVoice => ({
  lang, voiceURI: lang, name: lang, localService: true, default: false,
});
function harness(initial = [voice('tr-TR')]) {
  let voices = initial;
  const target = new EventTarget();
  const utterances: SpeechSynthesisUtterance[] = [];
  const engine: SynthesisEngine = {
    getVoices: () => voices,
    speak: utterance => { utterances.push(utterance); },
    cancel: vi.fn(),
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  };
  const adapter = new SpeechSynthesisAdapter(engine, text => ({ text } as SpeechSynthesisUtterance));
  const events: SpeechEvent[] = [];
  adapter.subscribe(event => events.push(event));
  return { adapter, engine, events, utterances, change(next: SpeechSynthesisVoice[]) {
    voices = next; target.dispatchEvent(new Event('voiceschanged'));
  } };
}
function fire(utterance: SpeechSynthesisUtterance, name: 'start' | 'boundary' | 'end', charIndex = 0) {
  utterance[`on${name}`]?.call(utterance, { charIndex, name: 'word' } as SpeechSynthesisEvent);
}
afterEach(() => { vi.useRealTimers(); });

describe('SpeechSynthesisAdapter', () => {
  it('reports unavailable voices and resumes pending speech after voiceschanged', () => {
    const h = harness([voice('en-US')]);
    expect(h.adapter.getTurkishVoices()).toEqual([]);
    expect(h.events).toEqual([{ type: 'voiceUnavailable' }]);
    h.adapter.speak('Merhaba', settings);
    expect(h.utterances).toHaveLength(0);
    h.change([voice('en-US'), voice('tr'), voice('tr-TR')]);
    expect(h.adapter.getTurkishVoices().map(v => v.lang)).toEqual(['tr', 'tr-TR']);
    expect(h.utterances[0].voice?.lang).toBe('tr-TR');
    h.adapter.dispose();
  });
  it('forwards ordered start, word boundaries and end with selected settings', () => {
    const h = harness([voice('tr'), voice('tr-TR')]);
    h.adapter.speak('Merhaba  dünya', { voice: 'tr', rate: 1.2, pitch: 0.8 });
    const u = h.utterances[0];
    expect([u.voice?.lang, u.rate, u.pitch]).toEqual(['tr', 1.2, 0.8]);
    fire(u, 'start'); fire(u, 'boundary'); fire(u, 'boundary', 9); fire(u, 'end');
    expect(h.events).toEqual([{ type: 'start' },
      { type: 'boundary', charIndex: 0, wordIndex: 0 },
      { type: 'boundary', charIndex: 9, wordIndex: 1 }, { type: 'end' }]);
    h.adapter.dispose();
  });
  it('finishes without boundary support and ignores late events after cancel', () => {
    const h = harness();
    h.adapter.speak('Merhaba', settings);
    fire(h.utterances[0], 'start'); fire(h.utterances[0], 'end');
    expect(h.events).toEqual([{ type: 'start' }, { type: 'end' }]);
    h.adapter.speak('Yeni', settings);
    h.adapter.cancel();
    fire(h.utterances[1], 'start'); fire(h.utterances[1], 'boundary'); fire(h.utterances[1], 'end');
    expect(h.events).toHaveLength(2);
    expect(h.engine.cancel).toHaveBeenCalled();
    h.adapter.dispose();
  });
  it('does not restart cancelled pending speech', () => {
    const h = harness([]);
    h.adapter.speak('Merhaba', settings); h.adapter.cancel(); h.change([voice('tr')]);
    expect(h.utterances).toHaveLength(0);
    h.adapter.dispose();
  });
});

describe('FakeSpeech and query modes', () => {
  it('emits deterministic events with fake timers', () => {
    vi.useFakeTimers();
    const speech = createSpeechPort('?speech=fake');
    const events: SpeechEvent[] = [];
    speech.subscribe(event => events.push(event));
    speech.speak('Bir iki', settings); vi.runAllTimers();
    expect(events).toEqual([{ type: 'start' }, { type: 'boundary', charIndex: 0, wordIndex: 0 },
      { type: 'boundary', charIndex: 4, wordIndex: 1 }, { type: 'end' }]);
    speech.dispose();
  });
  it('cancels active speech and allows a new utterance', () => {
    vi.useFakeTimers();
    const speech = new FakeSpeech();
    const events: SpeechEvent[] = [];
    speech.subscribe(event => events.push(event));
    speech.speak('Eski metin', settings); vi.advanceTimersByTime(0);
    speech.cancel(); vi.runAllTimers();
    expect(events).toEqual([{ type: 'start' }]);
    speech.speak('Yeni', settings); vi.runAllTimers();
    expect(events.map(event => event.type)).toEqual(['start', 'start', 'boundary', 'end']);
    speech.dispose();
  });
  it('none mode reports unavailable and never starts', () => {
    const speech = createSpeechPort('?speech=none');
    const events: SpeechEvent[] = [];
    speech.subscribe(event => events.push(event));
    expect(speech.getTurkishVoices()).toEqual([]);
    speech.speak('Merhaba', settings);
    expect(events).toEqual([{ type: 'voiceUnavailable' }, { type: 'voiceUnavailable' }]);
    speech.dispose();
  });
});
