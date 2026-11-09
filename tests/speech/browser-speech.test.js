import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSpeech } from '../../web/src/speech/index.js';

function engine(boundary = true) {
  const spoken = [];
  const listeners = new Map();
  class Utterance {
    constructor(text) { this.text = text; if (boundary) this.onboundary = null; }
  }
  const synthesis = {
    speak: utterance => spoken.push(utterance),
    cancel() { this.cancelCount = (this.cancelCount || 0) + 1; },
    getVoices: () => [{ lang: 'tr-TR' }],
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type),
  };
  return { port: new BrowserSpeech({ synthesis, Utterance }), spoken, listeners, synthesis };
}

test('reads sequentially, emits one start/end and global boundary offsets', () => {
  const { port, spoken } = engine();
  const events = [];
  for (const type of ['start', 'boundary', 'end']) port.on(type, event => events.push(event));
  const voice = { lang: 'tr-TR' };
  port.speak(['Bir. ', 'İki? ', 'Üç!'], { voice, rate: 0.9, pitch: 1.2, lang: 'tr-TR' });
  assert.equal(spoken.length, 1);
  for (let i = 0; i < 3; i += 1) {
    const utterance = spoken[i];
    assert.equal(utterance.voice, voice);
    assert.equal(utterance.rate, 0.9);
    assert.equal(utterance.pitch, 1.2);
    assert.equal(utterance.lang, 'tr-TR');
    utterance.onstart();
    utterance.onboundary({ charIndex: 1, name: 'word' });
    utterance.onend();
    utterance.onend();
  }
  assert.deepEqual(events.map(event => event.type), ['start', 'boundary', 'boundary', 'boundary', 'end']);
  assert.deepEqual(events.filter(event => event.type === 'boundary').map(event => event.charIndex), [1, 6, 11]);
  assert.deepEqual(spoken.map(item => item.text), ['Bir. ', 'İki? ', 'Üç!']);
});

test('cancel and replacement discard stale callbacks', () => {
  const { port, spoken } = engine();
  const events = [];
  for (const type of ['start', 'boundary', 'end', 'error']) port.on(type, event => events.push(event));
  port.speak(['Eski.', 'Kalan.']);
  const old = spoken[0];
  port.cancel();
  old.onstart(); old.onboundary({ charIndex: 0 }); old.onend(); old.onerror({ error: 'canceled' });
  assert.deepEqual(events, []);
  assert.equal(spoken.length, 1);
  port.speak(['Yeni.']);
  old.onend();
  spoken[1].onstart(); spoken[1].onend();
  assert.deepEqual(events.map(event => event.type), ['start', 'end']);
});

test('unlock is once, unsupported boundaries are safe, voices are forwarded', () => {
  const { port, spoken, listeners } = engine(false);
  assert.equal(port.supportsBoundary, false);
  port.unlock(); port.unlock();
  assert.deepEqual(spoken.map(item => item.text), ['']);
  let changed = 0;
  const off = port.onVoicesChanged(() => changed++);
  listeners.get('voiceschanged')();
  off(); listeners.get('voiceschanged')();
  assert.equal(changed, 1);
  assert.deepEqual(port.getVoices(), [{ lang: 'tr-TR' }]);
  port.speak(['Merhaba.']);
  spoken[1].onstart(); spoken[1].onend();
  port.dispose();
  assert.equal(listeners.size, 0);
});

test('engine failure terminates the queue and empty text does not speak', () => {
  const { port, spoken } = engine();
  const errors = [];
  port.on('error', event => errors.push(event.error));
  port.speak([' ']);
  assert.equal(spoken.length, 0);
  port.speak(['Bir.', 'İki.']);
  spoken[0].onerror({ error: 'synthesis-failed' });
  spoken[0].onend();
  assert.deepEqual(errors, ['synthesis-failed']);
  assert.equal(spoken.length, 1);
});

test('each part reports its start and end with its place in the whole text', () => {
  const { port, spoken } = engine(false);
  const events = [];
  for (const type of ['start', 'part', 'part-end', 'end']) port.on(type, event => events.push(event));
  port.speak(['Bir. ', 'İki? ', 'Üç!']);
  for (let i = 0; i < 3; i += 1) {
    spoken[i].onstart();
    spoken[i].onstart(); // Some engines repeat start; it is reported once.
    spoken[i].onend();
  }
  assert.deepEqual(events.map(({ type, index, charIndex, length }) => [type, index, charIndex, length]), [
    ['start', undefined, undefined, undefined],
    ['part', 0, 0, 5], ['part-end', 0, undefined, undefined],
    ['part', 1, 5, 5], ['part-end', 1, undefined, undefined],
    ['part', 2, 10, 3], ['part-end', 2, undefined, undefined],
    ['end', undefined, undefined, undefined]
  ]);
});
