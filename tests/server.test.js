import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
        resolve({ status: this.status, headers: this.headers, body: body?.toString() ?? '',
          rawBody: body === undefined ? Buffer.alloc(0) : Buffer.from(body) });
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

test('GET and HEAD serve the repository owner image', async t => {
  const server = createStaticServer();
  let listening = false;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    listening = true;
    t.after(() => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }));
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    t.diagnostic('TCP binding is unavailable; checking the request handler directly');
  }
  async function get(method) {
    if (!listening) {
      const response = await send(server, '/assets/owner/akilay2-removebg-preview-1.png', method);
      return { ...response, body: response.rawBody };
    }
    return new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: server.address().port,
        path: '/assets/owner/akilay2-removebg-preview-1.png', method }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode,
          headers: response.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.end();
    });
  }
  const expected = await readFile(resolve(process.cwd(), 'assets/owner/akilay2-removebg-preview-1.png'));
  const image = await get('GET');
  assert.equal(image.status, 200);
  assert.equal(image.headers['content-type'], 'image/png');
  assert.deepEqual(image.body, expected);
  const head = await get('HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-type'], 'image/png');
  assert.equal(head.body.length, 0);
});

test('asset image extensions use the expected content types', async () => {
  const server = createStaticServer({
    realpath: async file => file,
    readFile: async file => {
      assert.ok(file.startsWith(resolve(process.cwd(), 'assets') + '/'));
      return Buffer.from('fixture');
    }
  });
  for (const [extension, type] of [['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp']]) {
    const response = await send(server, `/assets/example.${extension}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], type);
    assert.equal(response.body, 'fixture');
  }
});

test('unsafe asset paths are rejected before accessing files', async () => {
  const unexpected = async () => assert.fail('Unsafe paths must not access the filesystem');
  const server = createStaticServer({ realpath: unexpected, readFile: unexpected });
  for (const path of ['/assets/../package.json', '/assets/%2e%2e/package.json',
    '/assets/%2e%2e%2fpackage.json', '/assets/%5cpackage.json', '/assets/\\package.json', '/assets/%00image.png']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await send(server, path, method);
      assert.equal(response.status, 403);
      assert.ok(!response.body.includes('"name"'));
    }
  }
});

test('canonical paths outside either serving root are forbidden', async () => {
  // Model realpath following a symlink without creating a symlink in the checkout.
  const server = createStaticServer({
    realpath: async () => resolve(process.cwd(), 'package.json'),
    readFile: async () => assert.fail('Escaping canonical paths must not be read')
  });
  for (const path of ['/assets/escape.png', '/escape.html']) {
    assert.equal((await send(server, path)).status, 403);
  }
});

test('web entry points and configuration preserve their contents', async () => {
  const server = createStaticServer();
  for (const [path, file, type] of [
    ['/', 'web/index.html', 'text/html; charset=utf-8'],
    ['/index.html', 'web/index.html', 'text/html; charset=utf-8'],
    ['/config/lypsync.config.json', 'web/config/lypsync.config.json', 'application/json; charset=utf-8']
  ]) {
    const response = await send(server, path);
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], type);
    assert.equal(response.body, await readFile(resolve(process.cwd(), file), 'utf8'));
  }
});
