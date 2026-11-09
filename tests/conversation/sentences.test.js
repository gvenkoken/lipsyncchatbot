import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from '../../web/src/lipsync/index.js';
import { MOUTH_LEAD_MS, PACE_LIMITS } from '../../web/src/conversation/index.js';
import { setup } from './helpers.js';

const part = (speech, index, charIndex, length) => speech.emit('part', { index, charIndex, length });

test('each sentence gets its own timeline from its real start, and the mouth rests between sentences', () => {
  const built = [];
  const { conversation: c, speech, clock, animator } = setup({
    buildTimeline: (text, rate) => { built.push([text, rate]); return buildTimeline(text, rate); }
  });
  c.say('Ali geldi. Oya da.');
  assert.deepEqual(speech.calls[0].parts, ['Ali geldi. ', 'Oya da.']);
  speech.emitStart();
  part(speech, 0, 0, 11);
  assert.equal(animator.state.mouth.open.target, 1); // "A"
  clock.advance(400);
  speech.emit('part-end', { index: 0 });
  assert.equal(animator.state.mouth.open.target, 0);
  clock.advance(500); // The voice pauses between sentences; the mouth stays closed.
  assert.equal(animator.state.mouth.open.target, 0);
  part(speech, 1, 11, 7);
  assert.equal(animator.state.mouth.round.target, 1); // "O" at its real start, not 900 ms into the old estimate
  assert.deepEqual(built.map(([text]) => text), ['Ali geldi. Oya da.', 'Ali geldi. ', 'Oya da.']);
  // Boundaries are global; they resync inside the current sentence.
  speech.emitBoundary({ charIndex: 15 }); // "da" starts now
  assert.equal(animator.state.mouth.open.target, 0.25); // "d"
  speech.emitEnd();
  assert.equal(c.state, 'Idle');
});

test('the mouth shape leads the sound slightly', () => {
  const { conversation: c, speech, clock, animator } = setup();
  c.say('am');
  speech.emitStart();
  const timeline = buildTimeline('am', 1);
  // Just before "m" starts, the lead already shows the closure.
  clock.advance(timeline[1].startMs - MOUTH_LEAD_MS + 1);
  assert.equal(animator.state.mouth.open.target, 0);
});

test('the measured speed of a voice is learnt and applied to the next sentences', () => {
  const rates = [];
  const { conversation: c, speech, clock } = setup({
    buildTimeline: (text, rate) => { rates.push(rate); return buildTimeline(text, rate); }
  });
  const voice = { name: 'Yelda', lang: 'tr-TR', voiceURI: 'yelda' };
  speech.setVoices([voice]);
  const text = 'Bugün birlikte küçük bir konuşma deneyi yapıyoruz. Pembe bir balon buldum.';
  c.say(text);
  speech.emitStart();
  const [first] = speech.calls[0].parts;
  part(speech, 0, 0, first.length);
  const estimate = buildTimeline(first, 1).estimateMs;
  clock.advance(estimate / 1.4); // This voice is 1.4 times faster than the estimate.
  speech.emit('part-end', { index: 0 });
  part(speech, 1, first.length, text.length - first.length);
  assert.ok(Math.abs(rates.at(-1) - 1.2) < 1e-9, String(rates.at(-1))); // Half way to 1.4
  speech.emitEnd();
  c.say('Yeniden merhaba, nasılsın bugün?');
  speech.emitStart();
  assert.ok(Math.abs(rates.at(-1) - 1.2) < 1e-9);
  // Very short sentences and absurd measurements do not move it far.
  c.learnPace('yelda|1', 100, 50);
  c.learnPace('yelda|1', 1000, 100);
  assert.ok(Math.abs(c.paces.get('yelda|1') - 1.2) < 1e-9);
  c.learnPace('x|1', 5000, 300);
  assert.equal(c.paces.get('x|1'), PACE_LIMITS.max);
  c.learnPace('y|1', 1000, 1e9);
  assert.equal(c.paces.get('y|1'), PACE_LIMITS.min);
});

test('the chosen voice is used from the next speech, and typed text is prepared for reading', () => {
  const { conversation: c, speech } = setup();
  const google = { name: 'Google Türkçe', lang: 'tr-TR', localService: false, voiceURI: 'google' };
  const yelda = { name: 'Yelda', lang: 'tr-TR', localService: true, voiceURI: 'yelda' };
  speech.setVoices([yelda, google]);
  c.say('Merhaba 😀 **dünya**\n- süt al');
  assert.equal(speech.calls[0].options.voice, google);
  assert.equal(c.session.text, 'Merhaba dünya. süt al');
  assert.equal(speech.calls[0].parts.join(''), c.session.text);
  c.setVoice('yelda');
  c.say('Tekrar.');
  assert.equal(speech.calls[1].options.voice, yelda);
  c.setVoice('');
  c.say('Bir daha.');
  assert.equal(speech.calls[2].options.voice, google);
  assert.throws(() => c.setVoice(null), TypeError);
  const count = speech.calls.length;
  c.say(' 😀 ');
  assert.equal(speech.calls.length, count);
});
