import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { createGeminiHandler, type GeminiConfig } from '../server/gemini.ts';

const config: GeminiConfig = { project: 'pmi-test-project', location: 'us-central1', model: 'gemini-3.8-live', avatar: 'Ben', credentialsFile: 'private-credential-file' };
class Upstream extends EventEmitter {
  readyState = WebSocket.CONNECTING; bufferedAmount = 0; sent: Record<string, unknown>[] = []; closed = false;
  open() { this.readyState = WebSocket.OPEN; this.emit('open'); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.closed = true; this.readyState = WebSocket.CLOSED; this.emit('close', 1000); }
  terminate() { this.close(); }
  message(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value))); }
}
const wait = async (predicate: () => boolean) => { const end = Date.now() + 2500; while (!predicate()) { if (Date.now() > end) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 5)); } };
async function server(options: { available?: boolean; token?: () => Promise<string | null>; lifetime?: number } = {}) {
  let tokenCalls = 0; const upstreams: Upstream[] = [], clients: WebSocket[] = [];
  const relay = createGeminiHandler({ getConfig: () => config, credentialsAvailable: () => options.available ?? true,
    getToken: async () => { tokenCalls++; return options.token ? options.token() : 'google-test-secret'; },
    connect: (url, token) => {
      assert.ok(url.startsWith('wss://us-central1-aiplatform.googleapis.com/')); assert.equal(token, 'google-test-secret');
      const upstream = new Upstream(); upstreams.push(upstream); return upstream as unknown as WebSocket;
    }, sessionLifetimeMs: options.lifetime,
  });
  const app = createServer((req, res) => relay.handler(req, res, () => { res.writeHead(404); res.end(); }));
  relay.attach(app); await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
  const connect = async () => {
    const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/gemini/live', { origin }); clients.push(socket);
    const messages: Record<string, unknown>[] = [], binary: Buffer[] = [];
    socket.on('message', (data, isBinary) => { if (isBinary) binary.push(Buffer.from(data as Buffer)); else messages.push(JSON.parse(data.toString())); });
    socket.on('error', () => {}); await new Promise<void>(resolve => socket.once('open', resolve));
    return { socket, messages, binary };
  };
  return { origin, connect, upstreams, tokenCalls: () => tokenCalls, close: async () => {
    clients.forEach(client => client.close()); relay.dispose();
    await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
  } };
}
test('missing Cloud authentication reports status and never obtains a token or starts a provider session', async () => {
  const app = await server({ available: false });
  try {
    const response = await fetch(app.origin + '/api/gemini/status'); const status = await response.json();
    assert.equal(status.configured, false); assert.deepEqual(status.missing, ['GOOGLE_CLOUD_AUTH']);
    assert.ok(!JSON.stringify(status).includes(config.credentialsFile));
    const client = await app.connect(); await wait(() => client.messages.length > 0);
    assert.equal(client.messages[0].code, 'not_configured'); assert.equal(app.tokenCalls(), 0); assert.equal(app.upstreams.length, 0);
  } finally { await app.close(); }
});
test('foreign WebSocket origins cannot use Google Cloud credentials', async () => {
  const app = await server();
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(app.origin.replace('http:', 'ws:') + '/api/gemini/live', { origin: 'https://foreign.example' });
      socket.on('error', () => {}); socket.on('open', () => reject(new Error('Foreign origin accepted')));
      socket.on('unexpected-response', (_req, response) => { resolve(response.statusCode!); response.destroy(); socket.terminate(); });
    });
    assert.equal(status, 403); assert.equal(app.tokenCalls(), 0);
  } finally { await app.close(); }
});
test('server owns OAuth; setup requests native video; PCM, text, video and transcripts travel in the right directions', async () => {
  const app = await server();
  try {
    const client = await app.connect(); await wait(() => app.upstreams.length === 1); const upstream = app.upstreams[0]; upstream.open();
    const setup = upstream.sent[0].setup as Record<string, any>;
    assert.equal(setup.model, 'projects/pmi-test-project/locations/us-central1/publishers/google/models/gemini-3.8-live');
    assert.deepEqual(setup.generation_config.response_modalities, ['VIDEO']); assert.equal(setup.avatar_config.avatar_name, 'Ben');
    upstream.message({ setupComplete: {} }); await wait(() => client.messages.some(message => message.type === 'ready'));
    client.socket.send(Buffer.from([0, 0, 1, 0])); client.socket.send(JSON.stringify({ type: 'text', text: 'Merhaba' }));
    await wait(() => upstream.sent.length >= 4);
    assert.deepEqual(upstream.sent[2], { realtime_input: { audio: { data: 'AAABAA==', mime_type: 'audio/pcm;rate=16000' } } });
    assert.deepEqual(upstream.sent[3], { client_content: { turns: [{ role: 'user', parts: [{ text: 'Merhaba' }] }], turn_complete: true } });
    upstream.message({ serverContent: { modelTurn: { parts: [{ inlineData: { data: 'AQID', mimeType: 'video/mp4' } }] }, inputTranscription: { text: 'Nasıl', finished: false }, outputTranscription: { text: 'Mer', finished: false } } });
    upstream.message({ serverContent: { inputTranscription: { text: 'sın?', finished: true }, outputTranscription: { text: 'haba!', finished: true }, turnComplete: true } });
    await wait(() => client.messages.some(message => message.type === 'turn_complete'));
    assert.deepEqual([...client.binary[0]], [1, 2, 3]);
    const messages = client.messages.filter(message => message.type === 'message');
    assert.equal(messages[0].id, messages[2].id); assert.equal(messages[2].text, 'Nasılsın?'); assert.equal(messages[3].text, 'Merhaba!');
    assert.ok(!JSON.stringify(client.messages).includes('google-test-secret'));
    client.socket.close(); await wait(() => upstream.closed);
  } finally { await app.close(); }
});
test('closing during OAuth prevents a late provider connection; auth failures do not expose diagnostics', async () => {
  let resolve!: (value: string) => void; const app = await server({ token: () => new Promise(done => { resolve = done; }) });
  try {
    const client = await app.connect(); await wait(() => !!resolve); client.socket.close();
    await new Promise(resolve => setTimeout(resolve, 20)); resolve('google-test-secret'); await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(app.upstreams.length, 0);
  } finally { await app.close(); }
  const failed = await server({ token: async () => { throw new Error('private-key-secret'); } });
  try {
    const client = await failed.connect(); await wait(() => client.messages.length > 0);
    assert.equal(client.messages[0].code, 'authentication'); assert.ok(!JSON.stringify(client.messages).includes('private-key-secret'));
  } finally { await failed.close(); }
});
test('upstream refusal and expiry clean up both sockets and never silently fall back to another provider', async () => {
  const app = await server();
  try {
    const client = await app.connect(); await wait(() => app.upstreams.length === 1);
    app.upstreams[0].open(); app.upstreams[0].emit('close', 1008, Buffer.from('private upstream diagnostics'));
    await wait(() => client.messages.length > 0); assert.equal(client.messages[0].code, 'upstream_closed');
    assert.ok(!JSON.stringify(client.messages).includes('private upstream diagnostics')); assert.equal(app.upstreams[0].closed, true);
  } finally { await app.close(); }
  const expiring = await server({ lifetime: 60 });
  try {
    const client = await expiring.connect(); await wait(() => expiring.upstreams.length === 1); expiring.upstreams[0].open();
    await wait(() => client.messages.some(message => message.code === 'session_limit')); assert.equal(expiring.upstreams[0].closed, true);
  } finally { await expiring.close(); }
});
