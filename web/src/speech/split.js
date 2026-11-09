/** Longer parts are cut at a comma or a space: long utterances start late and
 * some engines (Chrome's online voices) stop reading after about 15 seconds. */
export const MAX_PART_LENGTH = 200;

// A period after these words does not end the sentence ("Dr. Deniz", "vb. şeyler").
const ABBREVIATIONS = new Set(['dr', 'prof', 'doç', 'doc', 'av', 'yrd', 'sn', 'vb', 'vs', 'örn', 'bkz', 'no',
  'st', 'mr', 'mrs', 'ms', 'op', 'uzm', 'müh', 'arş', 'gör', 'çev', 'yy', 'tel', 'cad', 'sok', 'mah', 'apt', 'bul']);

const isLower = character => character !== character.toLocaleUpperCase('tr-TR');

function endsSentence(text, index, mark, rest) {
  if (/[!?]/u.test(mark)) return true;
  // "15. yüzyıl", "Bekle... sonra": a lower-case word continues the sentence.
  if (isLower(rest[0])) return false;
  if (/^\.$/u.test(mark)) {
    const word = /(\p{L}+)$/u.exec(text.slice(0, index))?.[1] ?? '';
    if (ABBREVIATIONS.has(word.toLocaleLowerCase('tr-TR'))) return false;
    if (word.length === 1 && !isLower(word)) return false; // An initial: "A. Yılmaz"
  }
  return true;
}

function cutLong(part) {
  const pieces = [];
  while (part.length > MAX_PART_LENGTH) {
    const head = part.slice(0, MAX_PART_LENGTH);
    let cut = -1;
    for (const match of head.matchAll(/[,;:—–]\s+/gu)) if (match.index >= 40) cut = match.index + match[0].length;
    if (cut < 0) for (const match of head.matchAll(/\s+/gu)) if (match.index > 0) cut = match.index + match[0].length;
    if (cut <= 0 || cut >= part.length) cut = MAX_PART_LENGTH;
    pieces.push(part.slice(0, cut));
    part = part.slice(cut);
  }
  if (part.trim()) pieces.push(part);
  else if (pieces.length) pieces[pieces.length - 1] += part;
  return pieces;
}

/** Keep whitespace so joining parts preserves text and boundary offsets. */
export function splitSentences(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (!text.trim()) return [];
  const sentences = [];
  let start = 0;
  for (const match of text.matchAll(/[.!?…]+["'”’)\]]*/gu)) {
    const markEnd = match.index + match[0].length;
    const space = /^\s*/u.exec(text.slice(markEnd))[0];
    const rest = text.slice(markEnd + space.length);
    // "3.5" or "a.b": no space after the mark, so the sentence goes on.
    if (rest && (!space || !endsSentence(text, match.index, match[0].replace(/["'”’)\]]+$/u, ''), rest))) continue;
    sentences.push(text.slice(start, markEnd + space.length));
    start = markEnd + space.length;
  }
  if (start < text.length) sentences.push(text.slice(start));
  return sentences.flatMap(cutLong).filter(part => part.trim());
}
