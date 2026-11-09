import type { SpeechEvent } from '../../speech/SpeechPort';

export type VisemePose = 'closed' | 'a' | 'e' | 'i' | 'ı' | 'o' | 'ö' | 'u' | 'ü'
  | 'fv' | 'sz' | 'td' | 'l' | 'r' | 'çş' | 'gk' | 'h' | 'y';
const vowels = new Set<VisemePose>(['a', 'e', 'i', 'ı', 'o', 'ö', 'u', 'ü']);
const consonants: Readonly<Record<string, VisemePose>> = {
  b: 'closed', p: 'closed', m: 'closed', n: 'closed', f: 'fv', v: 'fv',
  s: 'sz', z: 'sz', t: 'td', d: 'td', l: 'l', r: 'r', ç: 'çş', ş: 'çş',
  c: 'çş', j: 'çş', g: 'gk', k: 'gk', ğ: 'closed', h: 'h', y: 'y',
};

/** Locale casing keeps dotted İ and dotless I distinct. Unknown symbols rest. */
export function letterToViseme(letter: string): VisemePose {
  const lower = letter.normalize('NFC').toLocaleLowerCase('tr-TR');
  return vowels.has(lower as VisemePose) ? lower as VisemePose : consonants[lower] ?? 'closed';
}

export interface VisemeCue {
  readonly startMs: number;
  readonly endMs: number;
  /** UTF-16 offsets, matching SpeechSynthesis boundary events. */
  readonly charIndex: number;
  readonly wordIndex: number;
  readonly pose: VisemePose;
  readonly isVowel: boolean;
}
export interface VisemeSettings {
  readonly rate?: number;
  readonly syllableMs?: number;
  readonly pauseMs?: number;
  readonly blendMs?: number;
}
export interface VisemeTimeline {
  readonly cues: readonly VisemeCue[];
  readonly durationMs: number;
  readonly blendMs: number;
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive.`);
  return value;
}

/** Each vowel nucleus contributes one syllable; vowel-less words get one beat.
 * Vowels receive three timing units, consonants one. Separators always rest.
 * This is a deterministic text estimate, corrected by speech word boundaries.
 */
export function createVisemeTimeline(text: string, settings: VisemeSettings = {}): VisemeTimeline {
  const rate = positive(settings.rate ?? 1, 'rate');
  const syllableMs = positive(settings.syllableMs ?? 180, 'syllableMs') / rate;
  const pauseMs = positive(settings.pauseMs ?? 80, 'pauseMs') / rate;
  const blendMs = positive(settings.blendMs ?? 30, 'blendMs') / rate;
  const cues: VisemeCue[] = [];
  let time = 0;
  let wordIndex = -1;
  // Keep punctuation separate, but count words like SpeechPort (non-space runs).
  for (const token of text.matchAll(/\s+|\S+/gu)) {
    const whitespace = /^\s/u.test(token[0]);
    if (!whitespace) wordIndex++;
    const parts = Array.from(token[0]);
    const vowelCount = parts.filter(part => vowels.has(letterToViseme(part))).length;
    const letterCount = parts.filter(part => /\p{L}/u.test(part)).length;
    const unit = syllableMs * Math.max(1, vowelCount) / Math.max(1, letterCount + vowelCount * 2);
    let charIndex = token.index!;
    for (const part of parts) {
      const pose = letterToViseme(part);
      const isVowel = vowels.has(pose);
      const separator = !/\p{L}/u.test(part);
      const duration = separator ? pauseMs : unit * (isVowel ? 3 : 1);
      cues.push(Object.freeze({ startMs: time, endMs: time + duration, charIndex,
        wordIndex: whitespace ? -1 : wordIndex, pose, isVowel }));
      time += duration;
      charIndex += part.length;
    }
  }
  return Object.freeze({ cues: Object.freeze(cues), durationMs: time, blendMs });
}

export interface VisemeWeight { readonly pose: VisemePose; readonly weight: number }
const rest: readonly VisemeWeight[] = Object.freeze([Object.freeze({ pose: 'closed', weight: 1 })]);

/** No timers: caller supplies elapsed frame deltas and forwards SpeechPort events.
 * Subscribe with speech.subscribe(event => player.handleSpeechEvent(event)).
 * Cancellation should call reset(), since SpeechPort.cancel does not emit end.
 */
export class VisemePlayer {
  private active = false;
  private positionMs = 0;
  constructor(readonly timeline: VisemeTimeline) {}

  reset(): void { this.active = false; this.positionMs = 0; }

  handleSpeechEvent(event: SpeechEvent): void {
    if (event.type === 'start') { this.positionMs = 0; this.active = true; }
    else if (event.type === 'end' || event.type === 'voiceUnavailable') this.reset();
    else if (event.type === 'boundary' && this.active) {
      const cue = this.timeline.cues.find(item => item.wordIndex >= 0 && item.charIndex === event.charIndex)
        ?? this.timeline.cues.find(item => item.wordIndex === event.wordIndex);
      if (cue) {
        const wordStart = this.timeline.cues.find(item => item.wordIndex === cue.wordIndex);
        if (wordStart) this.positionMs = wordStart.startMs;
      }
    }
  }

  update(deltaMs: number): readonly VisemeWeight[] {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new RangeError('Viseme delta must be finite and nonnegative.');
    if (!this.active) return rest;
    this.positionMs += deltaMs;
    const cue = this.timeline.cues.find(item => item.startMs <= this.positionMs && this.positionMs < item.endMs);
    if (!cue || cue.pose === 'closed') return rest;
    // Start the target immediately; fade back to rest inside this cue only.
    // Thus no vowel weight can leak into a consonant or a silent separator.
    const fade = Math.min(this.timeline.blendMs, (cue.endMs - cue.startMs) / 2);
    const weight = Math.min(1, (cue.endMs - this.positionMs) / fade);
    return [{ pose: cue.pose, weight }, { pose: 'closed', weight: 1 - weight }];
  }
}
