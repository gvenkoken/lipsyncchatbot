import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalRecorder, type Recording, type RecordingState } from '../src/chat/recorder.ts';

class FakeRecorder {
  static isTypeSupported = () => true;
  state = 'inactive'; mimeType = 'audio/webm';
  onstop: (() => void) | null = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; setTimeout(() => { this.ondataavailable?.({ data: new Blob(['audio data']) }); this.onstop?.(); }, 0); }
}

const sleep = () => new Promise(resolve => setTimeout(resolve, 10));
function setup(getUserMedia: () => Promise<unknown>) {
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const oldRecorder = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia } } });
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: FakeRecorder });
  const states: RecordingState[] = [], ready: Recording[] = [], errors: string[] = [];
  const recorder = new LocalRecorder({ onState: state => states.push(state), onReady: clip => ready.push(clip), onError: error => errors.push(error) });
  const restore = () => {
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
    if (oldRecorder) Object.defineProperty(globalThis, 'MediaRecorder', oldRecorder); else Reflect.deleteProperty(globalThis, 'MediaRecorder');
  };
  return { recorder, states, ready, errors, restore };
}

test('stopping produces an actual audio File and releases the microphone', async () => {
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => stopped++ }] };
  const t = setup(async () => stream);
  try {
    await t.recorder.start(); t.recorder.stop(); await sleep();
    assert.deepEqual(t.states, ['requesting', 'recording', 'stopping', 'idle']);
    assert.equal(t.ready.length, 1); assert.ok(t.ready[0].file.size > 0);
    assert.equal(t.ready[0].file.type, 'audio/webm'); assert.match(t.ready[0].file.name, /\.webm$/);
    assert.equal(stopped, 1); assert.deepEqual(t.errors, []);
  } finally { t.restore(); }
});

test('closing during a permission request stops the late stream and creates no recording', async () => {
  let resolve!: (value: unknown) => void, stopped = 0, requests = 0;
  const t = setup(() => { requests++; return new Promise(done => { resolve = done; }); });
  try {
    const request = t.recorder.start(); await t.recorder.start(); t.recorder.cancel();
    resolve({ getTracks: () => [{ stop: () => stopped++ }] }); await request;
    assert.equal(requests, 1); assert.equal(stopped, 1); assert.equal(t.ready.length, 0);
    assert.equal(t.states.at(-1), 'idle'); assert.deepEqual(t.errors, []);
  } finally { t.restore(); }
});

test('cancelling active recording discards chunks and stops every track', async () => {
  let stopped = 0;
  const t = setup(async () => ({ getTracks: () => [1, 2].map(() => ({ stop: () => stopped++ })) }));
  try {
    await t.recorder.start(); t.recorder.cancel(); await sleep();
    assert.equal(stopped, 2); assert.equal(t.ready.length, 0); assert.equal(t.states.at(-1), 'idle');
  } finally { t.restore(); }
});

test('denied microphone permission returns to idle with an actionable error', async () => {
  const t = setup(async () => { throw new DOMException('denied', 'NotAllowedError'); });
  try {
    await t.recorder.start(); assert.equal(t.states.at(-1), 'idle');
    assert.equal(t.ready.length, 0); assert.match(t.errors[0], /Mikrofon izni/);
  } finally { t.restore(); }
});
