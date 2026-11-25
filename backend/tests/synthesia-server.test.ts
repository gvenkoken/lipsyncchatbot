import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createSynthesiaHandler, type SynthesiaConfig } from '../src/synthesia.ts';

const config: SynthesiaConfig = { apiKey: 'synth-secret', defaultAvatarId: 'av_default', customAvatarId: 'av_custom',
  livekitUrl: 'wss://example.livekit.cloud', livekitApiKey: 'API-test', livekitApiSecret: 'room-secret-value-12345678901234567890', openaiApiKey: 'openai-secret', openaiModel: 'gpt-realtime-2.1' };
async function server(overrides: Partial<SynthesiaConfig> = {}, ensureWorker: () => Promise<void> = async () => {}, lifetime = 60000) {
  const deleted: string[] = [];
  const relay = createSynthesiaHandler({ getConfig: () => ({ ...config, ...overrides }), ensureWorker,
    deleteRoom: async room => { deleted.push(room); }, sessionLifetimeMs: lifetime });
  const app = createServer((req, res) => { void relay.handler(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
  return { origin, deleted, post: (path: string, body: unknown, requestOrigin = origin) => fetch(origin + '/api/synthesia/' + path, { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    close: async () => { await relay.dispose(); await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve())); } };
}
test('missing credentials and missing custom avatar prevent a worker or microphone session', async () => {
  let started = 0;
  const app = await server({ apiKey: '', customAvatarId: '' }, async () => { started++; });
  try {
    const text = await (await fetch(app.origin + '/api/synthesia/status')).text();
    assert.equal(JSON.parse(text).configured, false); assert.ok(!text.includes('openai-secret') && !text.includes('room-secret'));
    assert.equal((await app.post('session', { avatar: 'default' })).status, 503);
    assert.equal((await app.post('session', { avatar: 'custom' })).status, 503); assert.equal(started, 0);
  } finally { await app.close(); }
});
test('cross-origin, malformed, oversized and arbitrary avatar requests cannot dispatch a paid worker', async () => {
  let started = 0; const app = await server({}, async () => { started++; });
  try {
    assert.equal((await app.post('session', { avatar: 'default' }, 'https://foreign.example')).status, 403);
    assert.equal((await app.post('session', { avatar: 'av_arbitrary' })).status, 400);
    assert.equal((await app.post('session', null)).status, 400);
    assert.equal((await app.post('session', { avatar: 'default', padding: 'a'.repeat(5000) })).status, 413);
    assert.equal((await fetch(app.origin + '/api/synthesia/session')).status, 405); assert.equal(started, 0);
  } finally { await app.close(); }
});
test('both choices mint short room-specific tokens with correct avatar dispatch and synchronized streams', async () => {
  const app = await server();
  try {
    for (const avatar of ['default', 'custom']) {
      const response = await app.post('session', { avatar, avatarId: 'av_untrusted' }); assert.equal(response.status, 201);
      const body = await response.json();
      const jwt = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString());
      assert.equal(jwt.video.roomJoin, true); assert.equal(jwt.video.roomAdmin, undefined);
      assert.deepEqual(jwt.video.canPublishSources, ['microphone']); assert.ok(jwt.exp - jwt.nbf <= 120);
      assert.equal(jwt.roomConfig.syncStreams, true); assert.equal(jwt.roomConfig.agents[0].agentName, 'pmi-synthesia');
      const metadata = JSON.parse(jwt.roomConfig.agents[0].metadata);
      assert.equal(metadata.avatarId, 'av_' + avatar); assert.equal(metadata.userIdentity, jwt.sub);
      assert.ok(!JSON.stringify(body).includes(config.apiKey)); assert.ok(!JSON.stringify(body).includes(config.livekitApiSecret));
      assert.equal((await app.post('session', { avatar })).status, 409);
      await app.post('hangup', { sessionId: 'unknown' }); assert.equal(app.deleted.length, avatar === 'default' ? 0 : 1);
      assert.equal((await app.post('hangup', { sessionId: body.sessionId })).status, 204); assert.equal(app.deleted.at(-1), jwt.video.room);
    }
  } finally { await app.close(); }
});
test('concurrent start is rejected and worker failure never exposes upstream secrets', async () => {
  let finish!: () => void;
  const app = await server({}, () => new Promise<void>(resolve => { finish = resolve; }));
  try {
    const first = app.post('session', { avatar: 'default' });
    while (!finish) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await app.post('session', { avatar: 'custom' })).status, 409);
    finish(); assert.equal((await first).status, 201);
  } finally { await app.close(); }
  const failed = await server({}, async () => { throw new Error(config.apiKey); });
  try { const response = await failed.post('session', { avatar: 'default' }); assert.equal(response.status, 502); assert.ok(!(await response.text()).includes(config.apiKey)); }
  finally { await failed.close(); }
});
test('expiry and server teardown delete only rooms created by this relay', async () => {
  const app = await server({}, async () => {}, 30);
  try {
    assert.equal((await app.post('session', { avatar: 'default' })).status, 201);
    await new Promise(resolve => setTimeout(resolve, 60)); assert.equal(app.deleted.length, 1); assert.match(app.deleted[0], /^pmi-/);
  } finally { await app.close(); }
});
test('documented gallery UUIDs are accepted and passed through without guessing an av_ prefix', async () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  const app = await server({ defaultAvatarId: id });
  try {
    const status = await (await fetch(app.origin + '/api/synthesia/status')).json(); assert.equal(status.avatars.default.configured, true);
    const response = await app.post('session', { avatar: 'default' }); assert.equal(response.status, 201);
    const body = await response.json(); const jwt = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString());
    assert.equal(JSON.parse(jwt.roomConfig.agents[0].metadata).avatarId, id);
  } finally { await app.close(); }
});
