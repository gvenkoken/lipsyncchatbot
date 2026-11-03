import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, assertReady } from './helpers.js';

test('AC01.4: greeting at 1500 ms, start opens mouth, end restores ready', async t => {
  const env = await setup(t); await env.open();
  assert.equal(env.speech.unlocked, true);
  env.clock.advance(1499); assert.equal(env.speech.calls.length, 0);
  env.clock.advance(1);
  assert.deepEqual(env.speech.calls[0].parts, ['Merhaba! ', 'Ben Akilay.']);
  assert.equal(env.mouth.getAttribute('display'), 'none');
  env.speech.emitStart();
  // Initial /m/ keeps the mouth closed for 90 ms. Render into /e/,
  // including the frame that applies the animator's new target.
  env.frames(12);
  assert.equal(env.widget.status.element.textContent, 'Konuşuyor');
  assert.equal(env.mouth.getAttribute('display'), 'inline');
  env.speech.emitEnd(); assertReady(env); env.assertRequests();
});

test('AC09.3: close cancels speech; reopening reloads the 800 ms delay', async t => {
  const env = await setup(t); await env.open();
  env.clock.advance(1500); env.speech.emitStart(); env.frames(12);
  assert.equal(env.mouth.getAttribute('display'), 'inline');
  env.widget.toggle.dispatch('click');
  assert.equal(env.speech.active, false);
  assert.equal(env.mouth.getAttribute('display'), 'none');
  assert.equal(env.widget.panel.element.hidden, true);
  env.config.greeting.delayMs = 800;
  env.config.greeting.text = 'Yeniden merhaba.';
  await env.open();
  const count = env.speech.calls.length;
  env.clock.advance(799); assert.equal(env.speech.calls.length, count);
  env.clock.advance(1); assert.equal(env.speech.calls.length, count + 1);
  assert.deepEqual(env.speech.calls.at(-1).parts, ['Yeniden merhaba.']);
  assert.equal(env.requests.length, 3); env.assertRequests();
});
