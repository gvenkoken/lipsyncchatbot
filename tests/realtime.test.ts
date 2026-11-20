import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeConversation, type RealtimeMessage, type RealtimeState } from '../src/chat/realtime.ts';

class Channel {
  readyState = 'connecting'; sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null; onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 'closed'; }
  event(event: object) { this.onmessage?.({ data: JSON.stringify(event) }); }
}
class Peer {
  static latest: Peer;
  channel = new Channel(); connectionState = 'new'; closed = false;
  ontrack: unknown = null; onconnectionstatechange: (() => void) | null = null;
  constructor() { Peer.latest = this; }
  addTrack() {}
  createDataChannel() { return this.channel; }
  async createOffer() { return { type: 'offer', sdp: 'v=0\r\nm=audio' }; }
  async setLocalDescription() {}
  async setRemoteDescription() { this.connectionState = 'connected'; this.channel.readyState = 'open'; this.channel.onopen?.(); this.channel.event({ type: 'session.created' }); }
  getReceivers() { return []; }
  close() { this.closed = true; }
}
function setup(getUserMedia?: () => Promise<unknown>, status = true) {
  const originals = ['navigator', 'RTCPeerConnection', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const track = { stopped: false, enabled: true, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const requests: string[] = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: getUserMedia ?? (async () => stream) } } });
  Object.defineProperty(globalThis, 'RTCPeerConnection', { configurable: true, value: Peer });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: string) => {
    requests.push(url);
    if (url.endsWith('/status')) return Response.json({ configured: status });
    if (url.endsWith('/hangup')) return new Response(null, { status: 204 });
    return new Response('answer', { status: 201, headers: { 'X-PMI-Call-Id': 'rtc_test' } });
  } });
  const states: RealtimeState[] = [], messages: RealtimeMessage[] = [], errors: string[] = [];
  const conversation = new RealtimeConversation({ onState: state => states.push(state), onMessage: message => messages.push(message), onError: error => errors.push(error), onAudio: () => {}, onMode: () => {} });
  return { conversation, track, states, messages, errors, requests, restore: () => { conversation.stop(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis,key,descriptor); else Reflect.deleteProperty(globalThis,key); } } };
}
const tick = () => new Promise(resolve => setTimeout(resolve,0));

test('a live session sends text, handles streaming transcripts, mutes, and releases media on close', async () => {
  const t = setup();
  try {
    await t.conversation.start();
    assert.deepEqual(t.states, ['connecting', 'connected']);
    const channel = Peer.latest.channel;
    const id = t.conversation.sendText('Merhaba');
    assert.ok(id); assert.equal(channel.sent[0].type, 'conversation.item.create'); assert.equal(channel.sent[1].type, 'response.create');
    channel.event({ type: 'response.output_audio_transcript.delta', item_id: 'reply', delta: 'Mer' });
    channel.event({ type: 'response.output_audio_transcript.done', item_id: 'reply', transcript: 'Merhaba!' });
    channel.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'voice', transcript: 'Nasılsın?' });
    assert.deepEqual(t.messages.map(message => [message.role, message.text, !!message.append]), [['assistant','Mer',true],['assistant','Merhaba!',false],['user','Nasılsın?',false]]);
    t.conversation.mute(true); assert.equal(t.track.enabled, false);
    t.conversation.mute(false); assert.equal(t.track.enabled, true);
    t.conversation.stop(); assert.equal(t.track.stopped,true); assert.equal(Peer.latest.closed,true);
    assert.equal(t.states.at(-1),'idle'); assert.ok(t.requests.includes('/api/realtime/hangup')); assert.deepEqual(t.errors,[]);
  } finally { t.restore(); }
});

test('closing while microphone permission is pending stops the late stream without creating a call', async () => {
  let resolve!: (stream: unknown) => void, stopped = false;
  const t = setup(() => new Promise(done => { resolve = done; }));
  try {
    const task = t.conversation.start(); await tick(); t.conversation.stop();
    resolve({ getTracks: () => [{ stop: () => { stopped = true; } }] }); await task;
    assert.equal(stopped,true); assert.equal(t.requests.includes('/api/realtime/session'),false); assert.deepEqual(t.errors,[]);
  } finally { t.restore(); }
});

test('a missing key never opens the microphone and leaves the live control reusable', async () => {
  let requested = false;
  const t = setup(async () => { requested = true; }, false);
  try {
    await t.conversation.start(); assert.equal(requested,false); assert.equal(t.states.at(-1),'idle');
    assert.match(t.errors[0],/yapılandırılmadı/);
  } finally { t.restore(); }
});

test('interrupting a response cancels generation and unplayed WebRTC audio', async () => {
  const t = setup();
  try {
    await t.conversation.start(); const channel = Peer.latest.channel;
    channel.event({ type: 'response.created' }); channel.event({ type: 'output_audio_buffer.started' });
    t.conversation.interrupt(); assert.deepEqual(channel.sent.map(event => event.type),['response.cancel','output_audio_buffer.clear']);
    channel.event({ type: 'error', error: { code: 'response_cancel_not_active' } }); assert.deepEqual(t.errors,[]);
  } finally { t.restore(); }
});
