import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceAnimator } from '../../web/src/animation/index.js';
import { LivelinessScheduler } from '../../web/src/liveliness/index.js';
import { FaceRenderer } from '../../web/src/face/index.js';
import { WidgetConversation } from '../../web/src/widget/conversation.js';
import { FakeRandom } from '../helpers/random.js';
import { setup } from './helpers.js';

for (const speaking of [false, true]) {
  test(`AC03.4 / AC04.4: two minutes of deterministic ${speaking ? 'speech' : 'idle'} animation`, async t => {
    // Mount the app as well as a pipeline with an injected Random: mountApp does
    // not expose a Random dependency. No global clock or randomness is patched.
    const env = await setup(t);
    const animator = new FaceAnimator({ clock: env.clock });
    const random = new FakeRandom([0.1, 0.7, 0.35, 0.9, 0.6, 0.4]);
    const liveliness = new LivelinessScheduler({ animator, clock: env.clock, random });
    const renderer = new FaceRenderer(env.config, { document: env.document });
    env.root.appendChild(renderer.svg);
    const conversation = new WidgetConversation({ speech: env.speech, animator, liveliness,
      clock: env.clock, loadConfig: async () => env.config });
    t.after(() => conversation.close());
    await conversation.open();
    // Finish the greeting, then select the scenario under observation.
    env.clock.advance(1500); env.speech.emitStart(); env.speech.emitEnd();
    if (speaking) {
      conversation.say('Pembe bir balon buldum. Büyük yuvarlak kutuyu gördüm. '.repeat(100));
      env.speech.emitStart();
    }
    const blinks = [];
    const openings = [];
    let wasBlinking = false;
    const detach = animator.subscribe(state => {
      renderer.render(state);
      openings.push(state.mouth.open.current);
      const blinking = state.eyelid.target === 1;
      if (blinking && !wasBlinking) blinks.push(env.clock.now());
      wasBlinking = blinking;
    });
    t.after(detach);
    for (let elapsed = 0; elapsed < 120000; elapsed += 10) env.clock.advance(10);
    assert.ok(blinks.length >= 20);
    const intervals = blinks.slice(1).map((time, i) => time - blinks[i]);
    assert.ok(intervals.every(ms => ms >= 2000 && ms <= 6000));
    assert.ok(new Set(intervals).size > 2, 'blink rhythm must vary');
    for (let i = 1; i < openings.length; i++) assert.ok(Math.abs(openings[i] - openings[i - 1]) <= 0.35);
    if (speaking) assert.ok(new Set(openings).size > 10, 'speech must animate multiple mouth shapes');
    else assert.ok(openings.every(value => value === 0));
    env.speech.emitEnd();
    for (let i = 0; i < 100; i++) env.clock.advance(16);
    assert.ok(animator.state.mouth.open.current < 1e-8);
  });
}
