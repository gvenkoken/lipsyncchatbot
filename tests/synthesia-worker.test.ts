import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { WorkerMessage, ServerMessage, RegisterWorkerResponse } from '@livekit/protocol';
import { createSynthesiaManager } from '../server/synthesia-manager.ts';

test('native worker starts on Windows, registers the named agent, and closes with its local server', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.on('listening', resolve));
  let name: string | undefined;
  server.on('connection', socket => socket.on('message', data => {
    const message = WorkerMessage.fromBinary(new Uint8Array(data as Buffer));
    if (message.message.case !== 'register') return;
    name = message.message.value.agentName;
    socket.send(new ServerMessage({ message: { case: 'register', value: new RegisterWorkerResponse({ workerId: 'local-test-worker' }) } }).toBinary());
  }));
  const manager = createSynthesiaManager(root);
  try {
    const port = (server.address() as { port: number }).port;
    await manager.ensureWorker({ apiKey: 'test-only', defaultAvatarId: 'av_test', customAvatarId: '', livekitUrl: `ws://127.0.0.1:${port}/`,
      livekitApiKey: 'local-test', livekitApiSecret: 'local-test-secret-12345678901234567890', openaiApiKey: 'unused', openaiModel: 'gpt-realtime-2.1' });
    assert.equal(name, 'pmi-synthesia');
  } finally {
    manager.dispose();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { server.clients.forEach(socket => socket.terminate()); reject(new Error('Worker did not close')); }, 9000);
      const poll = setInterval(() => { if (server.clients.size === 0) { clearInterval(poll); clearTimeout(timeout); server.close(() => resolve()); } }, 40);
      poll.unref();
    });
  }
});
