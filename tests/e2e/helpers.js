import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { mountApp } from '../../web/src/app.js';
import { FakeElement, createFakeDOM } from '../helpers/dom.js';
import { Clock } from '../conversation/helpers.js';
import { FakeSpeech } from '../../web/src/speech/fake-speech.js';

export async function setup(t, configure = () => {}) {
  const dom = createFakeDOM('#karakter-testi');
  dom.document.createElementNS = (_, tag) => new FakeElement(tag);
  dom.document.documentElement = { style: { setProperty() {} } };
  dom.document.head = new FakeElement('head');
  const config = JSON.parse(await readFile(path.resolve(process.cwd(), 'web/config/lypsync.config.json'), 'utf8'));
  configure(config);
  const speech = new FakeSpeech();
  const clock = new Clock();
  const requests = [];
  const unmount = mountApp({ ...dom, speech, clock, fetch: async (url, options) => {
    requests.push({ url, ...options });
    return { ok: true, json: async () => structuredClone(config) };
  } });
  t.after(unmount);
  await unmount.ready;
  const widget = unmount.widget;
  const group = widget.panel.element.children[1].children[0].children[0].children[0];
  const mouth = group.children.at(-1);
  const closed = mouth.getAttribute('d');
  return { ...dom, config, speech, clock, widget, group, mouth, closed, requests,
    async open() { widget.toggle.dispatch('click'); await widget.opened; },
    say(text) { widget.entry.input.value = text; widget.entry.input.dispatch('input'); widget.action.dispatch('click'); },
    frames(count = 100) { for (let i = 0; i < count; i++) clock.advance(16); },
    assertRequests() { for (const request of requests) assert.deepEqual(request, { url: '/config/lypsync.config.json', method: 'GET', cache: 'no-store' }); }
  };
}

export function assertMouthClosed(env) {
  env.frames();
  const numbers = text => text.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
  const expected = numbers(env.closed);
  numbers(env.mouth.getAttribute('d')).forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-8));
}

export function assertReady(env) {
  assertMouthClosed(env);
  assert.equal(env.widget.status.element.textContent, 'Hazır');
}
