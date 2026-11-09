import { describe, expect, it, vi } from 'vitest';
import { FakeSpeech, type SpeechClock } from '../../speech/FakeSpeech';
import type { SpeechEvent } from '../../speech/SpeechPort';
import { AnimationStateMachine } from './index';

function fixture() {
  let now = 0;
  const jobs = new Set<{ at: number; callback: () => void }>();
  const clock: SpeechClock = {
    setTimeout(callback, delay) {
      const job = { at: now + delay, callback };
      jobs.add(job);
      return job;
    },
    clearTimeout(handle) { jobs.delete(handle as { at: number; callback: () => void }); },
  };
  const speech = new FakeSpeech(true, clock);
  const machine = new AnimationStateMachine(speech);
  return { speech, machine, advance(ms: number) {
    now += ms;
    for (const job of jobs) {
      if (job.at <= now) { jobs.delete(job); job.callback(); }
    }
  } };
}

describe('AnimationStateMachine', () => {
  it.each(['stop', 'Idle', 'Thinking', 'speak', 'dispose'] as const)(
    'cancels speech before starting the target of %s', command => {
      const { speech, machine } = fixture();
      machine.speak('Önce');
      machine.update(200);
      const order: string[] = [];
      const originalCancel = speech.cancel.bind(speech);
      vi.spyOn(speech, 'cancel').mockImplementation(() => {
        order.push(`cancel:${machine.snapshot.target}`);
        originalCancel();
      });
      const originalSpeak = speech.speak.bind(speech);
      vi.spyOn(speech, 'speak').mockImplementation((text, settings) => {
        order.push(`speak:${machine.snapshot.target}`);
        originalSpeak(text, settings);
      });
      if (command === 'stop') machine.stop();
      else if (command === 'dispose') machine.dispose();
      else if (command === 'speak') machine.speak('Yeni');
      else machine.setState(command);
      expect(order[0]).toBe('cancel:Speaking');
      const target = command === 'speak' ? 'Speaking' : command === 'Thinking' ? 'Thinking' : 'Idle';
      expect(machine.snapshot.target).toBe(target);
      expect(machine.snapshot.progress).toBe(0);
      if (command === 'speak') expect(order[1]).toBe('speak:Speaking');
      expect(machine.update(200).weights[target]).toBe(1);
    },
  );

  it.each([150, 200, 300])('blends continuously from zero to one in %s ms', duration => {
    const { speech } = fixture();
    const machine = new AnimationStateMachine(speech, duration);
    machine.setState('Thinking');
    expect(machine.snapshot.weights.Thinking).toBe(0);
    for (let step = 1; step <= 10; step++) {
      const snapshot = machine.update(duration / 10);
      expect(snapshot.progress).toBeCloseTo(step / 10);
      expect(snapshot.weights.Thinking).toBeCloseTo(step / 10);
      expect(snapshot.weights.Idle + snapshot.weights.Speaking + snapshot.weights.Thinking).toBeCloseTo(1);
    }
    expect(machine.update(1000).weights.Thinking).toBe(1);
  });

  it('keeps the visible blend continuous and the last command authoritative', () => {
    const { speech, machine } = fixture();
    const subscribe = vi.spyOn(speech, 'subscribe');
    machine.speak('Eski');
    const oldListener = subscribe.mock.calls[0][0];
    machine.update(70);
    const before = machine.snapshot.weights;
    machine.setState('Thinking');
    expect(machine.snapshot.weights).toEqual(before);
    machine.update(40);
    machine.speak('Yeni');
    oldListener({ type: 'end' });
    expect(machine.snapshot.target).toBe('Speaking');
    machine.stop();
    machine.setState('Thinking');
    oldListener({ type: 'end' });
    expect(machine.update(200).weights).toEqual({ Idle: 0, Speaking: 0, Thinking: 1 });
  });

  it('ignores an end callback delivered synchronously by cancellation', () => {
    const { speech, machine } = fixture();
    const subscribe = vi.spyOn(speech, 'subscribe');
    machine.speak('Merhaba');
    const listener = subscribe.mock.calls[0][0];
    vi.spyOn(speech, 'cancel').mockImplementation(() => listener({ type: 'end' }));
    machine.setState('Thinking');
    expect(machine.snapshot.target).toBe('Thinking');
    expect(machine.snapshot.progress).toBe(0);
  });

  it('crossfades to Idle on the active FakeSpeech end event', () => {
    const { machine, advance } = fixture();
    machine.speak('Merhaba');
    machine.update(200);
    advance(400);
    expect(machine.snapshot.target).toBe('Idle');
    expect(machine.snapshot.weights.Speaking).toBe(1);
    expect(machine.update(100).weights).toEqual({ Idle: 0.5, Speaking: 0.5, Thinking: 0 });
    expect(machine.update(100).weights.Idle).toBe(1);
  });

  it('unsubscribes on disposal and ignores subsequent commands and callbacks', () => {
    const { speech, machine } = fixture();
    const listeners: ((event: SpeechEvent) => void)[] = [];
    const unsubscribe = vi.fn();
    vi.spyOn(speech, 'subscribe').mockImplementation(listener => {
      listeners.push(listener);
      return unsubscribe;
    });
    const cancel = vi.spyOn(speech, 'cancel');
    machine.speak('Merhaba');
    machine.dispose();
    const count = cancel.mock.calls.length;
    machine.speak('Sonra');
    machine.setState('Thinking');
    machine.stop();
    machine.dispose();
    listeners[0]({ type: 'end' });
    expect(cancel).toHaveBeenCalledTimes(count);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(machine.update(200).weights.Idle).toBe(1);
  });

  it.each([-1, NaN, Infinity])('rejects invalid frame delta %s without advancing', delta => {
    const { machine } = fixture();
    machine.setState('Thinking');
    const before = machine.snapshot;
    expect(() => machine.update(delta)).toThrow(RangeError);
    expect(machine.snapshot).toEqual(before);
  });

  it.each([0, 149, 301, NaN, Infinity])('rejects blend duration %s', duration => {
    const { speech } = fixture();
    expect(() => new AnimationStateMachine(speech, duration)).toThrow(RangeError);
  });
});
