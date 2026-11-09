const EMOJI = /\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|️|\p{Emoji_Modifier})*/gu;

/**
 * Turns typed text into what the voice should read: emoji and markdown marks
 * are dropped (voices spell them out), list bullets are removed, runs of spaces become one space, and a
 * line break without punctuation becomes a sentence end so each line of a list
 * is read with its own intonation instead of as one run-on sentence.
 */
export function prepareSpeechText(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const lines = text
    .replace(EMOJI, ' ')
    .replace(/[*#`~]+/gu, ' ')
    .split(/\r\n|\r|\n|\u2028|\u2029/u)
    .map(line => line.replace(/\s+/gu, ' ').trim().replace(/^[-•–]\s+/u, ''))
    .filter(Boolean);
  return lines
    .map((line, index) => index < lines.length - 1 && !/[.!?…:;,]["'”’)\]]*$/u.test(line) ? `${line}.` : line)
    .join(' ');
}
