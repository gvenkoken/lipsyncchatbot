import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeSpeech, SpeechPort } from '../../web/src/speech/index.js';

test('FakeSpeech implements the port and manually delivers events', () => {
  const speech = new FakeSpeech();
  assert.ok(speech instanceof SpeechPort);
  for (const method of ['speak', 'cancel', 'unlock', 'getVoices', 'onVoicesChanged', 'emitStart', 'emitBoundary', 'emitEnd', 'emitError', 'setVoices']) {
    assert.equal(typeof speech[method], 'function');
  }
  const events = [];
  for (const type of ['start', 'boundary', 'end', 'error']) speech.on(type, event => events.push(event));
  speech.unlock();
  assert.equal(speech.unlocked, true);
  speech.speak(['Merhaba.'], { lang: 'tr-TR' });
  speech.emitStart(); speech.emitStart();
  speech.emitBoundary({ charIndex: 2 }); speech.emitEnd(); speech.emitEnd();
  speech.speak(['Hata.']); speech.emitError('failed');
  assert.deepEqual(events.map(event => event.type), ['start', 'boundary', 'end', 'error']);
  assert.equal(events[1].charIndex, 2);
  assert.equal(events[3].error, 'failed');
  assert.deepEqual(speech.calls[0], { parts: ['Merhaba.'], options: { lang: 'tr-TR' } });
  let changed = 0;
  const off = speech.onVoicesChanged(() => changed++);
  speech.setVoices([{ lang: 'tr-TR' }]); off(); speech.setVoices([]);
  assert.equal(changed, 1);
  assert.deepEqual(speech.getVoices(), []);
  speech.speak(['İptal.']); speech.cancel();
  speech.emitStart(); speech.emitBoundary({ charIndex: 0 }); speech.emitEnd(); speech.emitError('late');
  assert.equal(events.length, 4);
});
