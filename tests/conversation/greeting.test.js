import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, config } from './helpers.js';

test('greeting waits exactly 1500 ms', async () => {
  const { conversation: c, clock, speech } = setup();
  const opening = c.open();
  assert.equal(c.state, 'Waiting');
  await opening;
  clock.advance(1499);
  assert.equal(speech.calls.length, 0);
  clock.advance(1);
  assert.deepEqual(speech.calls[0].parts, ['Merhaba!']);
  clock.advance(1500);
  assert.equal(speech.calls.length, 1);
});

test('reopen reloads text and delay; close cancels waiting and speaking', async () => {
  let loads = 0;
  const { conversation: c, clock, speech, animator, order } = setup({
    loadConfig: async () => ++loads === 1 ? config() : config('Yeniden!', 200)
  });
  await c.open();
  c.close();
  clock.advance(1500);
  assert.equal(speech.calls.length, 0);
  await c.open();
  clock.advance(199);
  assert.equal(speech.calls.length, 0);
  clock.advance(1);
  assert.deepEqual(speech.calls[0].parts, ['Yeniden!']);
  speech.emitStart();
  const id = c.sessionId;
  order.length = 0;
  c.close();
  assert.deepEqual(order, ['cancel', 'close']);
  assert.equal(c.state, 'Closed');
  assert.equal(animator.state.mouth.open.target, 0);
  await c.open();
  assert.ok(c.sessionId > id);
  clock.advance(200);
  assert.equal(speech.calls.length, 2);
});

test('a late config result cannot resurrect a closed or replaced session', async () => {
  let resolve;
  const { conversation: c, clock, speech } = setup({
    loadConfig: () => new Promise(done => { resolve = done; })
  });
  const pending = c.open();
  c.close();
  resolve(config());
  await pending;
  clock.advance(3000);
  assert.equal(c.state, 'Closed');
  assert.equal(speech.calls.length, 0);
});
