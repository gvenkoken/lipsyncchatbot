// Targets are normalized to [0, 1]; timing uses milliseconds throughout.
export const VISEME_TARGETS = Object.freeze({
  closed: Object.freeze({ openness: 0, width: 0.5, roundness: 0 }),
  wide: Object.freeze({ openness: 1, width: 0.8, roundness: 0 }),
  mid: Object.freeze({ openness: 0.6, width: 0.85, roundness: 0 }),
  spread: Object.freeze({ openness: 0.4, width: 1, roundness: 0 }),
  round: Object.freeze({ openness: 0.6, width: 0.4, roundness: 1 }),
  tight: Object.freeze({ openness: 0.35, width: 0.3, roundness: 1 }),
  teeth: Object.freeze({ openness: 0.12, width: 0.6, roundness: 0 }),
  pucker: Object.freeze({ openness: 0.3, width: 0.4, roundness: 0.6 }),
  narrow: Object.freeze({ openness: 0.25, width: 0.55, roundness: 0.15 })
});

/** Shorter consonant poses are not visible after smoothing; they join a neighbour.
 * Vowels, m/b/p closures and pauses always keep their own pose. */
export const MIN_VISEME_MS = 45;

// Durations at rate 1, tuned to Turkish TTS voices (about 14 letters per second).
const VOWEL_MS = 85;
const CONSONANT_MS = 65;
const BILABIAL_MS = 75;
const DIGIT_MS = 220;
const SPACE_MS = 20;
const COMMA_PAUSE_MS = 180;
const SENTENCE_PAUSE_MS = 250;

const SHAPES = new Map([
  ...[...'mbp'].map(letter => [letter, 'closed']),
  ['a', 'wide'], ['e', 'mid'],
  ...[...'iıî'].map(letter => [letter, 'spread']),
  ...[...'oö'].map(letter => [letter, 'round']),
  ...[...'uüû'].map(letter => [letter, 'tight']),
  ...[...'fv'].map(letter => [letter, 'teeth']),
  ...[...'şçcj'].map(letter => [letter, 'pucker'])
]);
const VOWELS = /[aâeıiîoöuüû]/u;

/** How a character moves the mouth: a pose, a pause, an extension of the previous pose, or nothing. */
function classify(character) {
  const letter = character.toLocaleLowerCase('tr-TR');
  if (/\s/u.test(letter)) return { extend: SPACE_MS };
  // ğ lengthens the vowel before it; h takes the shape of its neighbours.
  if (letter === 'ğ' || letter === 'h') return { extend: CONSONANT_MS, kind: 'narrow', spoken: true };
  if (/\p{N}/u.test(letter)) return { kind: 'mid', ms: DIGIT_MS, keep: true, spoken: true };
  if (/\p{L}/u.test(letter)) {
    const kind = SHAPES.get(letter) ?? 'narrow';
    const vowel = VOWELS.test(letter);
    return { kind, ms: kind === 'closed' ? BILABIAL_MS : vowel ? VOWEL_MS : CONSONANT_MS, keep: vowel || kind === 'closed', spoken: true };
  }
  if (/[.!?…]/u.test(letter)) return { kind: 'closed', ms: SENTENCE_PAUSE_MS, keep: true };
  if (/[,;:—–]/u.test(letter)) return { kind: 'closed', ms: COMMA_PAUSE_MS, keep: true };
  return null; // Quotes, brackets and other symbols are not spoken.
}

/**
 * Each entry has kind, startMs, durationMs and a normalized target.
 * timeline.words holds { charIndex, startMs } in original UTF-16 coordinates,
 * matching SpeechSynthesis boundary indices even after entries merge.
 * timeline.estimateMs is the estimated spoken length without the final closed pose.
 * No clock or speech event is required to construct or sample the estimate.
 */
export function buildTimeline(text, rate = 1) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError('rate must be positive and finite');
  const timeline = [];
  if (!text.trim()) return timeline;
  timeline.words = [];

  const wordIndices = new Set(Array.from(text.matchAll(/[\p{L}\p{N}]+/gu), match => match.index));
  let startMs = 0;
  let spokenEndMs = 0;
  let charIndex = 0;
  const push = (kind, durationMs, keep) => {
    const previous = timeline.at(-1);
    // Same pose again, or a consonant too short to be seen: keep the previous pose longer.
    if (previous && (previous.kind === kind || (!keep && durationMs < MIN_VISEME_MS))) previous.durationMs += durationMs;
    else timeline.push({ kind, startMs, durationMs, target: VISEME_TARGETS[kind], keep });
    startMs += durationMs;
  };
  for (const character of text) {
    if (wordIndices.has(charIndex)) timeline.words.push({ charIndex, startMs });
    charIndex += character.length;
    const sound = classify(character);
    if (!sound) continue;
    if (sound.extend !== undefined) {
      const durationMs = sound.extend / rate;
      if (timeline.length) { timeline.at(-1).durationMs += durationMs; startMs += durationMs; }
      else if (sound.kind) push(sound.kind, durationMs, false);
    } else push(sound.kind, sound.ms / rate, sound.keep);
    if (sound.spoken) spokenEndMs = startMs;
  }
  timeline.estimateMs = spokenEndMs;
  if (!timeline.length) return timeline;

  // A short leading consonant has no predecessor: the next pose starts earlier instead.
  if (timeline.length > 1 && !timeline[0].keep && timeline[0].durationMs < MIN_VISEME_MS) {
    const [first, next] = timeline;
    Object.assign(next, { startMs: first.startMs, durationMs: next.durationMs + first.durationMs });
    timeline.shift();
  }
  // Keep an explicit, sampleable closed pose at the end of every utterance;
  // a final consonant too short to be seen becomes part of it.
  const last = timeline.at(-1);
  const durationMs = Math.max(MIN_VISEME_MS, 120 / rate);
  if (last.kind === 'closed') last.durationMs += durationMs;
  else if (!last.keep && last.durationMs < MIN_VISEME_MS) Object.assign(last, { kind: 'closed', target: VISEME_TARGETS.closed, durationMs: last.durationMs + durationMs });
  else timeline.push({ kind: 'closed', startMs, durationMs, target: VISEME_TARGETS.closed });
  for (const entry of timeline) delete entry.keep;
  return timeline;
}

/**
 * Mutates and returns the timeline. Only recorded word starts are accepted;
 * whitespace, punctuation and unknown indices are ignored. The common offset
 * preserves all durations and ordering, including already elapsed entries.
 */
export function resyncAt(timeline, charIndex, nowMs) {
  if (!Number.isInteger(charIndex) || charIndex < 0 || !Number.isFinite(nowMs)) return timeline;
  // Boundary events normally point exactly at the word's first character.
  const word = timeline.words?.find(item => item.charIndex === charIndex);
  if (!word) return timeline;
  const offset = nowMs - word.startMs;
  for (const entry of timeline) entry.startMs += offset;
  for (const entry of timeline.words) entry.startMs += offset;
  return timeline;
}

/** Piecewise constant targets; interpolation belongs to the animation loop. */
export function sampleAt(timeline, tMs) {
  if (!Number.isFinite(tMs)) return { ...VISEME_TARGETS.closed };
  const entry = timeline.find(item => tMs >= item.startMs && tMs < item.startMs + item.durationMs);
  return { ...(entry?.target ?? VISEME_TARGETS.closed) };
}
