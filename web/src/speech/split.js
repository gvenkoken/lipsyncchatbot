/** Keep whitespace so joining parts preserves text and boundary offsets. */
export function splitSentences(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (!text.trim()) return [];
  return text.match(/[^.!?]*[.!?]+["'”’)]*\s*|[^.!?]+$/gu).filter(part => part.trim());
}
