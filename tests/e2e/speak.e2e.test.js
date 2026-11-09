import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, assertMouthClosed, assertReady } from './helpers.js';

for (const parts of [['Merhaba.'], ['Pembe bir balon buldum.', 'Onu büyük bir kutuya koydum.', 'Bugün birlikte konuşuyoruz.', 'Şimdi dinleniyoruz.']]) {
  test(`AC06.5: ordered sentence queue with ${parts.length} parts`, async t => {
    const env = await setup(t); await env.open(); env.say(parts.join(' '));
    assert.deepEqual(env.speech.calls.at(-1).parts, parts.map((part, index) => index < parts.length - 1 ? part + ' ' : part));
    env.speech.emitStart();
    // The paragraph starts with a closed /p/ viseme (90 ms). Advance the
    // fake frames into the following vowel before checking the rendered path.
    env.frames(12);
    assert.equal(env.mouth.getAttribute('display'), 'inline');
    env.speech.emitEnd(); assertReady(env);
    const count = env.speech.calls.length; env.clock.advance(2000);
    assert.equal(env.speech.calls.length, count);
  });
}

test('AC08.3: replacement cancels, closes mouth and rejects stale end', async t => {
  const env = await setup(t); await env.open();
  env.say('Pembe bir balon buldum. Uzun bir konuşma başlıyor.');
  env.speech.emitStart(); env.frames(12);
  assert.equal(env.mouth.getAttribute('display'), 'inline');
  const stale = [...env.speech.listeners.get('end')];
  let cancellations = 0;
  const cancel = env.speech.cancel.bind(env.speech);
  env.speech.cancel = () => { cancellations++; cancel(); };
  env.say('Yeni metin.');
  assert.ok(cancellations > 0);
  assert.deepEqual(env.speech.calls.at(-1).parts, ['Yeni metin.']);
  assertMouthClosed(env);
  env.speech.emitStart();
  for (const callback of stale) callback({});
  assert.equal(env.speech.active, true);
  assert.equal(env.widget.status.element.textContent, 'Konuşuyor');
  env.speech.emitEnd(); assertReady(env);
});

test('AC14.3: dismiss fallback warning, then use late Turkish voice', async t => {
  const env = await setup(t); await env.open(); env.say('Merhaba.');
  assert.equal(env.widget.warning.element.hidden, false);
  assert.equal(env.speech.calls.at(-1).options.voice, undefined);
  env.widget.warning.closeButton.dispatch('click');
  assert.equal(env.widget.warning.element.hidden, true);
  env.speech.emitEnd();
  const voice = { name: 'Türkçe', lang: 'tr-TR', localService: true };
  env.speech.setVoices([voice]); env.say('Yeniden merhaba.');
  assert.equal(env.speech.calls.at(-1).options.voice, voice);
  assert.equal(env.widget.warning.element.hidden, true);
});

test('empty text is ignored; rate and pitch reach SpeechPort', async t => {
  const env = await setup(t); await env.open(); env.say('   ');
  assert.equal(env.widget.action.disabled, true); assert.equal(env.speech.calls.length, 0);
  for (const [control, value] of [[env.widget.rate, '1.3'], [env.widget.pitch, '0.7']]) {
    control.input.value = value; control.input.dispatch('input');
  }
  env.say('Merhaba.');
  assert.equal(env.speech.calls[0].options.rate, 1.3);
  assert.equal(env.speech.calls[0].options.pitch, 0.7);
});

test('AC15.5: changed fetched coordinates update the SVG when the panel reopens', async t => {
  const env = await setup(t, config => { config.face.style = 'drawn'; });
  await env.open();
  const geometry = group => ({
    mouth: group.children.at(-1).getAttribute('d'),
    eyes: group.children.slice(1, 3).map(eye => ({
      x: eye.getAttribute('cx'), y: eye.getAttribute('cy')
    }))
  });
  const previous = geometry(env.group);
  env.widget.toggle.dispatch('click');
  assert.equal(env.widget.panel.element.hidden, true);
  // Change only face coordinates in the next fake fetch response. Derive
  // them from the real config so this test follows owner calibration changes.
  env.config.mouth.x += 8;
  env.config.mouth.y += 6;
  env.config.mouth.width += 4;
  env.config.mouth.lipColor = '#123456';
  env.config.body.width += 20;
  env.config.body.height += 30;
  for (const eye of env.config.eyes) {
    eye.x += 5;
    eye.y += 3;
    eye.width += 4;
    eye.height += 2;
    eye.irisColor = '#654321';
  }
  const requestCount = env.requests.length;
  await env.open();
  assert.equal(env.requests.length, requestCount + 1);
  // Read the live SVG again so replacing the renderer is also supported.
  const group = env.widget.panel.element.children[1].children[0].children[0].children[0];
  env.assertRequests();
  const { x, y, width } = env.config.mouth;
  const half = width / 2;
  assert.deepEqual(geometry(group), {
    mouth: `M ${x - half} ${y} Q ${x} ${y} ${x + half} ${y} Q ${x} ${y} ${x - half} ${y} Z`,
    eyes: env.config.eyes.map(eye => ({ x: String(eye.x), y: String(eye.y) }))
  });
  const svg = env.widget.panel.element.children[1].children[0].children[0];
  assert.equal(svg.getAttribute('viewBox'), `0 0 ${env.config.body.width} ${env.config.body.height}`);
  assert.equal(svg.children.length, 1);
  assert.equal(group.children.length, 8);
  assert.equal(group.children.at(-1).getAttribute('fill'), env.config.mouth.lipColor);
  assert.equal(group.children.at(-1).getAttribute('stroke'), env.config.mouth.lipColor);
  env.config.eyes.forEach((eye, index) => {
    assert.equal(group.children[index + 1].getAttribute('rx'), String(eye.width / 2));
    assert.equal(group.children[index + 1].getAttribute('ry'), String(eye.height / 2));
    assert.equal(group.children[index + 3].getAttribute('fill'), eye.irisColor);
    assert.equal(group.children[index + 3].getAttribute('rx'), String(eye.height * 0.3));
  });
  const updated = geometry(group);
  assert.notEqual(updated.mouth, previous.mouth);
  updated.eyes.forEach((eye, index) => {
    assert.notEqual(eye.x, previous.eyes[index].x);
    assert.notEqual(eye.y, previous.eyes[index].y);
  });
});

test('the voice list offers the Turkish voices best first and the choice reaches SpeechPort', async t => {
  const env = await setup(t); await env.open();
  const select = env.widget.voice.select;
  assert.deepEqual(select.children.map(option => option.textContent), ['Otomatik (en doğal Türkçe ses)']);
  const yelda = { name: 'Yelda', lang: 'tr-TR', localService: true, voiceURI: 'yelda' };
  const google = { name: 'Google Türkçe', lang: 'tr-TR', localService: false, voiceURI: 'google' };
  env.speech.setVoices([{ name: 'Samantha', lang: 'en-US', voiceURI: 'sam' }, yelda, google]);
  assert.deepEqual(select.children.map(option => option.textContent), ['Otomatik (en doğal Türkçe ses)', 'Google Türkçe · çevrim içi', 'Yelda']);
  env.say('Merhaba.');
  assert.equal(env.speech.calls.at(-1).options.voice, google);
  select.value = 'yelda'; select.dispatch('change');
  env.say('Tekrar merhaba.');
  assert.equal(env.speech.calls.at(-1).options.voice, yelda);
  // A chosen voice that disappears falls back to automatic.
  env.speech.setVoices([google]);
  assert.equal(select.value, '');
});
