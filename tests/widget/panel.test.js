import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { mountApp } from '../../web/src/app.js';
import { FakeElement, createFakeDOM } from '../helpers/dom.js';
import { FakeSpeech } from '../../web/src/speech/fake-speech.js';
import { Clock } from '../conversation/helpers.js';

async function setup(hash = '#karakter-testi', speechSettings = {}) {
  const dom = createFakeDOM(hash);
  dom.document.createElementNS = (_, tag) => new FakeElement(tag);
  dom.document.documentElement = { style: { setProperty() {} } };
  dom.document.head = new FakeElement('head');
  const config = JSON.parse(await readFile(path.resolve(process.cwd(), 'web/config/lypsync.config.json'), 'utf8'));
  const calls = [];
  const speech = new FakeSpeech(speechSettings);
  const clock = new Clock();
  const unmount = mountApp({ ...dom, speech, clock, fetch: async (url, options) => {
    calls.push({ url, ...options }); return { ok: true, json: async () => config };
  } });
  await unmount.ready;
  return { ...dom, unmount, widget: unmount.widget, speech, clock, calls, config };
}

test('app mounts the screen, opens after unlock and closes active speech', async t => {
  const env = await setup(); t.after(env.unmount);
  const { widget, speech, clock, calls, config } = env;
  assert.equal(widget.panel.element.hidden, true);
  assert.equal(widget.toggle.getAttribute('aria-expanded'), 'false');
  widget.toggle.dispatch('click');
  assert.equal(speech.unlocked, true);
  assert.equal(widget.toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(widget.status.element.textContent, 'Selamlama bekleniyor');
  await Promise.resolve(); clock.advance(config.greeting.delayMs); speech.emitStart();
  assert.equal(widget.status.element.textContent, 'Konuşuyor');
  assert.equal(speech.active, true);
  widget.toggle.dispatch('click');
  assert.equal(speech.active, false);
  assert.equal(widget.panel.element.hidden, true);
  assert.equal(widget.toggle.getAttribute('aria-expanded'), 'false');
  widget.toggle.dispatch('click');
  assert.equal(widget.status.element.textContent, 'Selamlama bekleniyor');
  assert.deepEqual(calls, [{ url: '/config/lypsync.config.json', method: 'GET', cache: 'no-store' }]);
  const stage = widget.panel.element.children[1];
  const svg = stage.children[0].children[0];
  assert.equal(svg.getAttribute('role'), 'img');
  assert.equal(svg.getAttribute('aria-label'), 'Akilay karakteri');
  const image = svg.children[0].children[0];
  assert.match(image.getAttribute('href'), /^\/?assets\//);
  image.dispatch('error');
  assert.match(stage.textContent, /Karakter görseli yüklenemedi/);
});

test('empty input is disabled; controls apply to the next utterance and warning is dismissible', async t => {
  const { widget, speech, unmount, config } = await setup(); t.after(unmount);
  widget.toggle.dispatch('click'); await Promise.resolve();
  assert.equal(widget.rate.input.value, String(config.speech.rate));
  assert.equal(widget.pitch.input.value, String(config.speech.pitch));
  for (const control of [widget.rate, widget.pitch]) {
    assert.equal(control.input.getAttribute('min'), '0.5');
    assert.equal(control.input.getAttribute('max'), '1.5');
    assert.equal(control.input.getAttribute('step'), '0.1');
  }
  for (const value of ['', '   ']) {
    widget.entry.input.value = value; widget.entry.input.dispatch('input');
    assert.equal(widget.action.disabled, true); widget.action.dispatch('click');
  }
  assert.equal(speech.calls.length, 0);
  widget.entry.input.value = '<b>Merhaba!</b>'; widget.entry.input.dispatch('input');
  widget.rate.input.value = '1.3'; widget.rate.input.dispatch('input');
  widget.pitch.input.value = '0.7'; widget.pitch.input.dispatch('input');
  widget.action.dispatch('click'); speech.emitStart();
  assert.equal(widget.status.element.textContent, 'Konuşuyor');
  assert.equal(widget.action.disabled, false);
  assert.equal(speech.calls[0].parts.join(''), '<b>Merhaba!</b>');
  assert.equal(speech.calls[0].options.rate, 1.3);
  assert.equal(speech.calls[0].options.pitch, 0.7);
  assert.equal(widget.warning.element.hidden, false);
  assert.match(widget.warning.element.textContent, /Türkçe ses bulunamadı, varsayılan ses kullanılıyor\./);
  widget.warning.closeButton.dispatch('click');
  assert.equal(widget.warning.element.hidden, true);
  assert.equal(speech.active, true);
  widget.action.dispatch('click'); assert.equal(speech.calls.length, 2);
  widget.panel.closeButton.dispatch('click'); assert.equal(speech.active, false);
});

test('navigation disposes the session and a fresh mount resets controls', async t => {
  const env = await setup(''); t.after(env.unmount);
  env.widget.rate.input.value = '1.5'; env.widget.rate.input.dispatch('input');
  env.widget.toggle.dispatch('click');
  env.window.location.hash = '#karsilastirma'; env.window.dispatch('hashchange');
  assert.equal(env.speech.active, false);
  assert.match(env.root.textContent, /T12/);
  env.window.location.hash = '#karakter-testi'; env.window.dispatch('hashchange');
  assert.equal(env.unmount.widget.rate.input.value, String(env.config.speech.rate));
  assert.equal(env.unmount.widget.panel.element.hidden, true);
});

test('late speech callbacks cannot change the reopened session status', async t => {
  const { widget, speech, clock, config, unmount } = await setup();
  t.after(unmount);
  widget.toggle.dispatch('click');
  await Promise.resolve();
  clock.advance(config.greeting.delayMs);
  const lateStart = [...speech.listeners.get('start')];
  const lateEnd = [...speech.listeners.get('end')];
  const lateError = [...speech.listeners.get('error')];
  speech.emitStart();
  assert.equal(widget.status.element.textContent, 'Konuşuyor');
  widget.toggle.dispatch('click');
  widget.toggle.dispatch('click');
  await Promise.resolve();
  for (const callback of [...lateStart, ...lateEnd, ...lateError]) callback({});
  speech.emit('end');
  assert.equal(widget.status.element.textContent, 'Selamlama bekleniyor');
  assert.equal(widget.toggle.getAttribute('aria-expanded'), 'true');

  clock.advance(config.greeting.delayMs);
  speech.emitStart();
  for (const callback of [...lateEnd, ...lateError]) callback({});
  assert.equal(widget.status.element.textContent, 'Konuşuyor');
  speech.emitEnd();
  assert.equal(widget.status.element.textContent, 'Hazır');
});

test('widget sources never use HTML string insertion', async () => {
  const directory = path.resolve(process.cwd(), 'web/src/widget');
  for (const file of await readdir(directory)) {
    assert.equal((await readFile(path.join(directory, file), 'utf8')).includes('inner' + 'HTML'), false);
  }
});
