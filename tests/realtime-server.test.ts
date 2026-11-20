import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRealtimeHandler } from '../server/realtime.ts';

const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
async function server(apiKey: string, upstream: typeof fetch) {
  const handler = createRealtimeHandler({ getConfig: () => ({ apiKey, model: 'gpt-realtime-2.1' }), fetch: upstream });
  const app = createServer((req, res) => { void handler(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  const address = app.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  return { origin, post: (path: string, body: string, requestOrigin = origin) => fetch(origin + path, { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/sdp' }, body }), close: () => new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve())) };
}

test('status and missing-key errors never expose credentials or create calls', async () => {
  let requested = false;
  const app = await server('', async () => { requested = true; throw Error('unexpected'); });
  try {
    const status = await fetch(app.origin + '/api/realtime/status');
    assert.deepEqual(await status.json(), { configured: false, model: 'gpt-realtime-2.1' });
    assert.equal((await app.post('/api/realtime/session', sdp)).status, 503);
    assert.equal(requested, false);
  } finally { await app.close(); }
});

test('a different origin or invalid SDP cannot spend the server API key', async () => {
  let requested = false;
  const app = await server('test-secret', async () => { requested = true; throw Error('unexpected'); });
  try {
    assert.equal((await app.post('/api/realtime/session', sdp, 'https://foreign.example')).status, 403);
    assert.equal((await app.post('/api/realtime/session', 'invalid')).status, 400);
    assert.equal((await fetch(app.origin + '/api/realtime/session')).status, 405);
    assert.equal(requested, false);
  } finally { await app.close(); }
});

test('server sends SDP and Turkish voice configuration upstream; browser receives only SDP and call ID', async () => {
  const calls: string[] = [];
  const app = await server('test-secret', async (url, options) => {
    calls.push(String(url));
    assert.equal((options?.headers as Record<string,string>).Authorization, 'Bearer test-secret');
    if (String(url).endsWith('/hangup')) return new Response(null, { status: 200 });
    const body = options?.body as FormData;
    assert.equal(body.get('sdp'), sdp);
    const session = JSON.parse(String(body.get('session')));
    assert.equal(session.model, 'gpt-realtime-2.1');
    assert.equal(session.audio.input.transcription.language, 'tr');
    assert.equal(session.audio.input.turn_detection.interrupt_response, true);
    assert.equal(session.audio.output.voice, 'marin');
    return new Response('v=0\r\nanswer', { status: 201, headers: { Location: '/v1/realtime/calls/rtc_test' } });
  });
  try {
    const answer = await app.post('/api/realtime/session', sdp);
    assert.equal(answer.status, 201); assert.equal(answer.headers.get('X-PMI-Call-Id'), 'rtc_test');
    assert.equal(await answer.text(), 'v=0\r\nanswer');
    const status = await fetch(app.origin + '/api/realtime/status');
    assert.equal((await status.text()).includes('test-secret'), false);
    await app.post('/api/realtime/hangup', JSON.stringify({ callId: 'unknown' }));
    assert.equal(calls.length, 1);
    assert.equal((await app.post('/api/realtime/hangup', JSON.stringify({ callId: 'rtc_test' }))).status, 204);
    assert.equal(calls.length, 2); assert.ok(calls[1].endsWith('/rtc_test/hangup'));
  } finally { await app.close(); }
});

test('upstream failures return actionable errors without forwarding sensitive diagnostics', async () => {
  const app = await server('test-secret', async () => new Response('diagnostics: test-secret', { status: 429 }));
  try {
    const response = await app.post('/api/realtime/session', sdp);
    assert.equal(response.status, 429);
    const problem = await response.json() as { error: string; code: string };
    assert.equal(problem.code, 'rate_limit'); assert.match(problem.error, /limit/);
    assert.equal(JSON.stringify(problem).includes('test-secret'), false);
  } finally { await app.close(); }
});
