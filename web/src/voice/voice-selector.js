export const MISSING_VOICE_MESSAGE = 'Türkçe ses bulunamadı, varsayılan ses kullanılıyor.';

const subscriptions = new WeakMap();

function isTurkish(voice) {
  const lang = String(voice.lang ?? '').replaceAll('_', '-').toLowerCase();
  return lang === 'tr' || lang === 'tr-tr';
}

/** Call at the start of each utterance. Voice changes never interrupt speech.
 * missingVoice is the warning message, or null when a Turkish voice exists.
 * The port also emits missingVoice with { message } for notice subscribers.
 */
export function selectVoice(port) {
  let state = subscriptions.get(port);
  if (!state) {
    state = { voices: [], unsubscribe: null };
    state.unsubscribe = port.onVoicesChanged(() => {
      state.voices = [...port.getVoices()];
    });
    subscriptions.set(port, state);
  }
  // Query again for every new utterance, including implementations whose voice
  // list can change before their voiceschanged notification is delivered.
  state.voices = [...port.getVoices()];
  const turkish = state.voices.filter(isTurkish);
  const voice = turkish.find(candidate => candidate.localService === true)
    ?? turkish[0];
  if (voice) return { voice, missingVoice: null };

  const fallback = state.voices.find(candidate => candidate.default === true) ?? null;
  port.emit('missingVoice', { message: MISSING_VOICE_MESSAGE });
  return { voice: fallback, missingVoice: MISSING_VOICE_MESSAGE };
}

/** Release the subscription when the owning session is disposed. */
export function disposeVoiceSelector(port) {
  subscriptions.get(port)?.unsubscribe();
  subscriptions.delete(port);
}
