import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaticServer, resolveServerConfig } from '../scripts/serve.mjs';

function send(server, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const response = {
      writeHead(status, headers = {}) {
        this.status = status;
        this.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
        return this;
      },
      end(body) {
        resolve({ status: this.status, headers: this.headers, body: body?.toString() ?? '' });
      }
    };
    Promise.resolve(server.listeners('request')[0]({ url: path, method }, response)).catch(reject);
  });
}

test('server configuration defaults and environment overrides', () => {
  assert.deepEqual(resolveServerConfig({}), { port: 8080, host: 'localhost' });
  assert.deepEqual(resolveServerConfig({ PORT: '0', HOST: '127.0.0.1' }), { port: 0, host: '127.0.0.1' });
  assert.deepEqual(resolveServerConfig({ PORT: '9090' }), { port: 9090, host: 'localhost' });
  assert.deepEqual(resolveServerConfig({ HOST: '0.0.0.0' }), { port: 8080, host: '0.0.0.0' });
});

test('configured listener binds the requested address', async t => {
  const server = createStaticServer();
  const config = resolveServerConfig({ PORT: '0', HOST: '127.0.0.1' });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, resolve);
    });
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip('Sandbox does not permit listening on a TCP socket');
      return;
    }
    throw error;
  }
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.equal(address.address, config.host);
  assert.ok(address.port > 0);
});

test('request handler serves readiness and preserves static path protection', async () => {
  const server = createStaticServer();
  const ready = await send(server, '/health/ready');
  assert.equal(ready.status, 200);
  assert.equal(ready.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(ready.body, 'ok');
  const head = await send(server, '/health/ready', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-type'], ready.headers['content-type']);
  assert.equal(head.body, '');
  assert.equal((await send(server, '/health/ready', 'POST')).status, 405);

  assert.equal((await send(server, '/index.html')).status, 200);
  const configFile = await send(server, '/config/lypsync.config.json');
  assert.equal(configFile.status, 200);
  assert.equal(configFile.headers['content-type'], 'application/json; charset=utf-8');
  for (const path of ['/../package.json', '/%2e%2e/package.json', '/%2e%2e/health/ready']) {
    assert.equal((await send(server, path)).status, 403);
  }
  assert.equal((await send(server, '/package.json')).status, 404);
});
