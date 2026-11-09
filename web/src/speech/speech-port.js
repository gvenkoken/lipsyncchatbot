/** on(type, listener) returns an unsubscribe function. Boundary charIndex is
 * relative to parts.join(''). Cancellation silently replaces the session.
 * Events: start (once), part { index, charIndex, length } and part-end { index }
 * around each part when the engine reports them, boundary, end, error. */
export class SpeechPort {
  constructor() { this.listeners = new Map(); this.supportsBoundary = false; }
  on(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }
  emit(type, details = {}) {
    for (const listener of this.listeners.get(type) || []) listener({ ...details, type });
  }
  onVoicesChanged(listener) { return this.on('voiceschanged', listener); }
  speak() { throw new Error('Implement speak'); }
  cancel() { throw new Error('Implement cancel'); }
  unlock() { throw new Error('Implement unlock'); }
  getVoices() { throw new Error('Implement getVoices'); }
}
export function validateParts(parts) {
  if (!Array.isArray(parts) || parts.some(part => typeof part !== 'string')) {
    throw new TypeError('parts must be an array of strings');
  }
}
