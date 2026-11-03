import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildTimeline } from '../../web/src/lipsync/index.js';
import { setup } from './helpers.js';

test('blank text is a no-op; replacement cancels before speaking immediately', () => {
  const { conversation: c, speech, order } = setup();
  c.say('Eski metin.');
  speech.emitStart();
  const old = c.session;
  const lateEnd = [...speech.listeners.get('end')][0];
  order.length = 0;
  c.say('');
  c.say('   ');
  assert.equal(c.session, old);
  assert.equal(c.state, 'Speaking');
  assert.deepEqual(order, []);
  c.say('Yeni metin.');
  assert.deepEqual(order.slice(0, 3), ['cancel', 'close', 'speak']);
  assert.equal(old.status, 'Cancelled');
  assert.ok(c.sessionId > old.id);
  assert.deepEqual(speech.calls.at(-1).parts, ['Yeni metin.']);
  speech.emitStart();
  lateEnd({});
  assert.equal(c.state, 'Speaking');
  speech.emitEnd();
  assert.equal(c.state, 'Idle');
  assert.equal(c.session.status, 'Ended');
});

test('start builds timeline, boundaries resync, queue end closes mouth', () => {
  const events = [];
  const { conversation: c, speech, clock, animator } = setup({
    buildTimeline: (...args) => { events.push('start'); return buildTimeline(...args); },
    resyncAt: (_timeline, index, time) => events.push(['boundary', index, time])
  });
  c.say('Ali. Ece! Oya?');
  assert.deepEqual(speech.calls[0].parts, ['Ali. ', 'Ece! ', 'Oya?']);
  assert.deepEqual(events, []);
  speech.emitStart();
  assert.ok(animator.state.mouth.open.target > 0);
  for (const index of [5, 10]) {
    clock.advance(100);
    speech.emitBoundary({ charIndex: index });
    assert.equal(c.state, 'Speaking');
  }
  assert.deepEqual(events, ['start', ['boundary', 5, 100], ['boundary', 10, 200]]);
  speech.emitEnd();
  assert.equal(c.state, 'Idle');
  assert.equal(animator.state.mouth.open.target, 0);
  clock.advance(100);
  assert.equal(animator.state.mouth.open.target, 0);
});

test('controls affect only the next speech and reject out-of-range values', async () => {
  const { conversation: c, speech } = setup();
  c.say('Bir.');
  c.setRate(0.7);
  c.setPitch(1.3);
  assert.equal(speech.calls[0].options.rate, 1);
  assert.equal(speech.calls[0].options.pitch, 1);
  c.say('İki.');
  assert.equal(speech.calls[1].options.rate, 0.7);
  assert.equal(speech.calls[1].options.pitch, 1.3);
  assert.throws(() => c.setRate(2), RangeError);
  assert.throws(() => c.setPitch(NaN), RangeError);
  const source = await readFile(resolve(process.cwd(), 'web/src/conversation/index.js'), 'utf8');
  assert.doesNotMatch(source, /localStorage|document\.cookie/);
});

test('fallback warns; late Turkish voice is selected on the next speech', () => {
  const { conversation: c, speech } = setup();
  const fallback = { lang: 'en-US', default: true };
  speech.setVoices([fallback]);
  const warnings = [];
  c.on('voice-warning', event => warnings.push(event.message));
  c.say('Merhaba.');
  assert.equal(speech.calls[0].options.voice, fallback);
  assert.deepEqual(warnings, ['Türkçe ses bulunamadı, varsayılan ses kullanılıyor.']);
  const turkish = { lang: 'tr-TR' };
  speech.setVoices([turkish]);
  assert.equal(speech.calls.length, 1);
  c.say('Tekrar.');
  assert.equal(speech.calls[1].options.voice, turkish);
  assert.equal(warnings.length, 1);
});

test('speech errors close the mouth and finish the session', () => {
  const { conversation: c, speech, animator } = setup();
  c.say('Merhaba.');
  speech.emitStart();
  speech.emitError('unavailable');
  assert.equal(c.state, 'Idle');
  assert.equal(animator.state.mouth.open.target, 0);
});
