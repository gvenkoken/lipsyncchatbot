// Targets are normalized to [0, 1]; timing uses milliseconds throughout.
export const VISEME_TARGETS = Object.freeze({
  closed: Object.freeze({ openness: 0, width: 0.5, roundness: 0 }),
  wide: Object.freeze({ openness: 1, width: 0.8, roundness: 0 }),
  spread: Object.freeze({ openness: 0.4, width: 1, roundness: 0 }),
  round: Object.freeze({ openness: 0.6, width: 0.4, roundness: 1 }),
  narrow: Object.freeze({ openness: 0.25, width: 0.55, roundness: 0.15 })
});

export const MIN_VISEME_MS = 70;

function kindFor(character) {
  const letter = character.toLocaleLowerCase('tr-TR');
  if ('mbp'.includes(letter)) return 'closed';
  if (letter === 'a') return 'wide';
  if ('eiı'.includes(letter)) return 'spread';
  if ('oöuü'.includes(letter)) return 'round';
  return /\p{L}/u.test(letter) ? 'narrow' : 'closed';
}

/**
 * Each entry has kind, startMs, durationMs and a normalized target.
 * timeline.words holds { charIndex, startMs } in original UTF-16 coordinates,
 * matching SpeechSynthesis boundary indices even after short entries merge.
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
  let charIndex = 0;
  for (const character of text) {
    if (wordIndices.has(charIndex)) timeline.words.push({ charIndex, startMs });
    const kind = kindFor(character);
    const baseMs = /[aeıioöuü]/u.test(character.toLocaleLowerCase('tr-TR')) ? 140 :
      /[\p{L}\p{N}]/u.test(character) ? 90 : 110;
    const durationMs = baseMs / rate;
    const previous = timeline.at(-1);
    if (durationMs < MIN_VISEME_MS && previous) {
      previous.durationMs += durationMs;
    } else {
      timeline.push({ kind, startMs, durationMs, target: VISEME_TARGETS[kind] });
    }
    startMs += durationMs;
    charIndex += character.length;
  }

  // A leading short entry has no predecessor: absorb its following entries.
  while (timeline.length > 1 && timeline[0].durationMs < MIN_VISEME_MS) {
    timeline[0].durationMs += timeline[1].durationMs;
    timeline.splice(1, 1);
  }
  // Keep an explicit, sampleable closed pose at the end of every utterance.
  const durationMs = Math.max(MIN_VISEME_MS, 120 / rate);
  const last = timeline.at(-1);
  if (last.durationMs < MIN_VISEME_MS) {
    last.kind = 'closed';
    last.target = VISEME_TARGETS.closed;
    last.durationMs += durationMs;
  } else if (last.kind === 'closed') last.durationMs += durationMs;
  else timeline.push({ kind: 'closed', startMs, durationMs, target: VISEME_TARGETS.closed });
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
