import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeSpeech } from '../../web/src/speech/index.js';
import { selectVoice, disposeVoiceSelector } from '../../web/src/voice/index.js';

const warning = 'Türkçe ses bulunamadı, varsayılan ses kullanılıyor.';

test('missing Turkish returns the default voice and emits the exact warning per selection', () => {
  const other = { lang: 'en-US' };
  const defaultVoice = { lang: 'en-US', default: true };
  const port = new FakeSpeech({ voices: [other, defaultVoice] });
  const events = [];
  port.on('missingVoice', event => events.push(event));
  assert.deepEqual(selectVoice(port), { voice: defaultVoice, missingVoice: warning });
  assert.deepEqual(selectVoice(port), { voice: defaultVoice, missingVoice: warning });
  assert.deepEqual(events, Array.from({ length: 2 }, () => ({ type: 'missingVoice', message: warning })));
  disposeVoiceSelector(port);
});

test('without a default voice, including an empty list, fallback is null', () => {
  for (const voices of [[], [{ lang: 'en-US' }]]) {
    const port = new FakeSpeech({ voices });
    assert.deepEqual(selectVoice(port), { voice: null, missingVoice: warning });
    disposeVoiceSelector(port);
  }
});

test('late Turkish voices apply to the next selection without cancelling ongoing speech', () => {
  const defaultVoice = { lang: 'en-US', default: true };
  const port = new FakeSpeech({ voices: [defaultVoice] });
  const events = [];
  port.on('missingVoice', event => events.push(event));
  const first = selectVoice(port);
  port.speak(['Merhaba.'], { voice: first.voice });
  let cancellations = 0;
  const cancel = port.cancel.bind(port);
  port.cancel = () => { cancellations++; cancel(); };
  const turkish = { lang: 'tr-TR', localService: true };
  port.setVoices([defaultVoice, turkish]);
  assert.equal(port.active, true);
  assert.equal(port.calls.length, 1);
  assert.equal(port.calls[0].options.voice, defaultVoice);
  assert.deepEqual(selectVoice(port), { voice: turkish, missingVoice: null });
  assert.equal(cancellations, 0);
  assert.equal(events.length, 1);
  assert.equal(port.active, true);
  disposeVoiceSelector(port);
});

test('Turkish language variants are recognized and local voices take priority', () => {
  for (const lang of ['tr-TR', 'tr_TR', 'tr', 'TR-tr']) {
    const remote = { lang: 'tr-TR', localService: false, default: true };
    const local = { lang, localService: true };
    const port = new FakeSpeech({ voices: [remote, local] });
    port.on('missingVoice', () => assert.fail('Unexpected warning'));
    assert.equal(selectVoice(port).voice, local);
    port.setVoices([remote]);
    assert.deepEqual(selectVoice(port), { voice: remote, missingVoice: null });
    disposeVoiceSelector(port);
  }
});

test('selection subscribes once and disposal removes the voice-change listener', () => {
  const port = new FakeSpeech();
  selectVoice(port);
  selectVoice(port);
  assert.equal(port.listeners.get('voiceschanged').size, 1);
  disposeVoiceSelector(port);
  assert.equal(port.listeners.get('voiceschanged').size, 0);
  selectVoice(port);
  assert.equal(port.listeners.get('voiceschanged').size, 1);
  disposeVoiceSelector(port);
});
