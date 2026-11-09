export const MISSING_VOICE_MESSAGE = 'Türkçe ses bulunamadı, varsayılan ses kullanılıyor.';

const subscriptions = new WeakMap();

// Names browsers give their better voices. Neural voices (Edge "Online (Natural)")
// sound the most natural, then Apple's downloaded Premium/Enhanced voices, then
// Chrome's online Google voice; the basic system voices come last.
const QUALITY = [
  [/natural|neural|online/i, 50],
  [/premium/i, 40],
  [/enhanced|geli[sş]mi[sş]|geli[sş]tirilmi[sş]|iyile[sş]tirilmi[sş]/i, 35],
  [/^google\b/i, 30]
];

function isTurkish(voice) {
  const lang = String(voice.lang ?? '').replaceAll('_', '-').toLowerCase();
  return lang === 'tr' || lang === 'tr-tr';
}

/** Higher is better. A local voice wins a tie: it starts faster and reports word boundaries. */
export function voiceQuality(voice) {
  const name = String(voice.name ?? '');
  const score = Math.max(0, ...QUALITY.filter(([pattern]) => pattern.test(name)).map(([, value]) => value));
  return score + (voice.localService === true ? 2 : 0);
}

/** Turkish voices, best first; equal voices keep the browser's order. */
export function turkishVoices(voices) {
  return voices.map((voice, index) => ({ voice, index }))
    .filter(({ voice }) => isTurkish(voice))
    .sort((a, b) => voiceQuality(b.voice) - voiceQuality(a.voice) || a.index - b.index)
    .map(({ voice }) => voice);
}

/** A stable id for a voice choice; voiceURI is unique per browser. */
export function voiceId(voice) {
  return String(voice?.voiceURI || voice?.name || '');
}

/** Call at the start of each utterance. Voice changes never interrupt speech.
 * preferred is a voiceId the user picked; when it is gone the best Turkish voice is used.
 * missingVoice is the warning message, or null when a Turkish voice exists.
 * Without a Turkish voice no voice is forced, so the browser picks one for the
 * utterance language instead of reading Turkish with a foreign default voice.
 * The port also emits missingVoice with { message } for notice subscribers.
 */
export function selectVoice(port, { preferred = '' } = {}) {
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
  const turkish = turkishVoices(state.voices);
  const chosen = preferred ? turkish.find(candidate => voiceId(candidate) === preferred) : undefined;
  const voice = chosen ?? turkish[0];
  if (voice) return { voice, missingVoice: null };

  port.emit('missingVoice', { message: MISSING_VOICE_MESSAGE });
  return { voice: null, missingVoice: MISSING_VOICE_MESSAGE };
}

/** Release the subscription when the owning session is disposed. */
export function disposeVoiceSelector(port) {
  subscriptions.get(port)?.unsubscribe();
  subscriptions.delete(port);
}
