import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SynthesiaConversation } from '../src/chat/synthesia.ts';

type Sdk = typeof import('livekit-client');
class MockRoom {
  static latest: MockRoom;
  events = new Map<string, (...args: unknown[]) => void>();
  closed = false; published = false; sent: object[] = [];
  localParticipant = { publishTrack: async () => { this.published = true; }, publishData: async (data: Uint8Array) => { this.sent.push(JSON.parse(new TextDecoder().decode(data))); } };
  constructor() { MockRoom.latest = this; }
  on(name: string, handler: (...args: unknown[]) => void) { this.events.set(name, handler); return this; }
  emit(name: string, ...args: unknown[]) { this.events.get(name)?.(...args); }
  connect() { return Promise.resolve(); }
  disconnect() { this.closed = true; return Promise.resolve(); }
  removeAllListeners() { this.events.clear(); }
  startAudio() { return Promise.resolve(); }
  event(event: object, identity = 'pmi-agent') { this.emit('data', new TextEncoder().encode(JSON.stringify(event)), { identity }, 0, 'pmi.synthesia'); }
}
function setup(options: { configured?: boolean; microphone?: () => Promise<unknown>; session?: () => Promise<Response> } = {}) {
  const originalFetch = globalThis.fetch, originalStream = Object.getOwnPropertyDescriptor(globalThis, 'MediaStream');
  Object.defineProperty(globalThis, 'MediaStream', { configurable: true, value: class {} });
  const requests: string[] = [], states: string[] = [], errors: string[] = [], messages: unknown[] = [], videos: unknown[] = [];
  const mic = { stopped: false, stop() { this.stopped = true; } };
  const sdk = { Room: MockRoom, RoomEvent: { TrackSubscribed: 'track', TrackUnsubscribed: 'untrack', ParticipantDisconnected: 'left', Disconnected: 'end', DataReceived: 'data' }, Track: { Kind: { Video: 'video', Audio: 'audio' } }, createLocalAudioTrack: options.microphone ?? (async () => mic) } as unknown as Sdk;
  let loaded = 0;
  globalThis.fetch = (async (url: string) => {
    requests.push(url);
    if (url.endsWith('/status')) return Response.json({ avatars: { default: { configured: options.configured ?? true }, custom: { configured: options.configured ?? true } } });
    if (url.endsWith('/hangup')) return new Response(null, { status: 204 });
    return options.session?.() ?? Response.json({ sessionId: 'owned', url: 'wss://example.test', token: 'room-token', avatarIdentity: 'synthesia-avatar-agent', agentIdentity: 'pmi-agent' }, { status: 201 });
  }) as typeof fetch;
  const conversation = new SynthesiaConversation({ onState: state => states.push(state), onMode: () => {}, onError: error => errors.push(error), onMessage: message => messages.push(message), onVideo: video => videos.push(video) }, async () => { loaded++; return sdk; });
  return { conversation, mic, states, errors, messages, videos, requests, loaded: () => loaded,
    restore: () => { conversation.stop(); globalThis.fetch = originalFetch; if (originalStream) Object.defineProperty(globalThis, 'MediaStream', originalStream); else Reflect.deleteProperty(globalThis, 'MediaStream'); } };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('Synthesia waits for agent AND video, routes text, ignores untrusted peers, and releases room/media', async () => {
  const t = setup(); let stopped = false;
  try {
    await t.conversation.start('default'); const room = MockRoom.latest;
    assert.deepEqual(t.states, ['connecting']); assert.equal(room.published, true);
    room.event({ type: 'ready' }, 'other'); assert.deepEqual(t.states, ['connecting']);
    room.event({ type: 'ready' }); assert.deepEqual(t.states, ['connecting']);
    room.emit('track', { kind: 'video', mediaStreamTrack: { stop() { stopped = true; } }, detach: () => [] }, {}, { identity: 'synthesia-avatar-agent' });
    assert.equal(t.states.at(-1), 'connected'); assert.equal(t.videos.length, 1);
    const id = t.conversation.sendText('Merhaba'); assert.ok(id); assert.deepEqual(room.sent[0], { type: 'text', id, text: 'Merhaba' });
    room.event({ type: 'message', id: 'reply', role: 'assistant', text: 'Merhaba!' }); assert.equal(t.messages.length, 1);
    t.conversation.interrupt(); assert.deepEqual(room.sent[1], { type: 'interrupt' });
    t.conversation.stop(); assert.equal(t.mic.stopped, true); assert.equal(room.closed, true); assert.equal(stopped, true);
    assert.equal(t.videos.at(-1), null); assert.ok(t.requests.includes('/api/synthesia/hangup')); assert.deepEqual(t.errors, []);
  } finally { t.restore(); }
});
test('unconfigured custom avatar never loads SDK or asks for microphone', async () => {
  const t = setup({ configured: false });
  try { await t.conversation.start('custom'); assert.equal(t.loaded(), 0); assert.equal(t.states.at(-1), 'idle'); assert.match(t.errors[0], /Interactive ID/); }
  finally { t.restore(); }
});
test('cancel pending permission stops the late track without creating a session', async () => {
  let resolve!: (value: unknown) => void, stopped = false;
  const t = setup({ microphone: () => new Promise(done => { resolve = done; }) });
  try {
    const start = t.conversation.start('default'); await tick(); t.conversation.stop();
    resolve({ stop() { stopped = true; } }); await start;
    assert.equal(stopped, true); assert.ok(!t.requests.includes('/api/synthesia/session')); assert.equal(t.states.at(-1), 'idle');
  } finally { t.restore(); }
});
test('cancel pending session releases its late token and never joins the room', async () => {
  let resolve!: (value: Response) => void;
  const t = setup({ session: () => new Promise(done => { resolve = done; }) });
  try {
    const start = t.conversation.start('default'); await tick(); t.conversation.stop();
    resolve(Response.json({ sessionId: 'late' }, { status: 201 })); await start;
    assert.equal(t.mic.stopped, true); assert.ok(t.requests.includes('/api/synthesia/hangup')); assert.equal(t.states.at(-1), 'idle');
  } finally { t.restore(); }
});
test('losing the avatar participant ends the session and leaves a recoverable error', async () => {
  const t = setup();
  try { await t.conversation.start('custom'); MockRoom.latest.emit('left', { identity: 'synthesia-avatar-agent' }); assert.equal(t.states.at(-1), 'idle'); assert.equal(t.mic.stopped, true); assert.equal(t.errors.length, 1); }
  finally { t.restore(); }
});
