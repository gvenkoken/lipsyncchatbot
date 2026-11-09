import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createStaticServer } from '../scripts/serve.mjs';
import { mountApp } from '../web/src/app.js';
import { createFakeDOM } from './helpers/dom.js';
import { FakeClock } from './helpers/clock.js';
import { FakeRandom } from './helpers/random.js';

function get(port, path) {
  return new Promise((resolveRequest, reject) => {
    const req = request({ hostname: '127.0.0.1', port, method: 'GET', path }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolveRequest({ status: response.statusCode, headers: response.headers, body }));
      response.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

// Exercise the same HTTP handler when the sandbox forbids listening sockets.
function dispatch(server, path) {
  return new Promise(resolveResponse => {
    const response = {
      writeHead(status, headers = {}) {
        this.status = status;
        this.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
        return this;
      },
      end(body = '') {
        resolveResponse({ status: this.status, headers: this.headers, body: body.toString() });
      }
    };
    server.emit('request', { method: 'GET', url: path }, response);
  });
}

test('static GET routes, module entry and traversal rejection', async t => {
  const server = createStaticServer();
  let fetchPath;
  try {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    t.after(() => new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())));
    const port = server.address().port;
    fetchPath = path => get(port, path);
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    t.diagnostic('Listening is forbidden; checking the HTTP handler directly.');
    fetchPath = path => dispatch(server, path);
  }
  const html = await fetchPath('/index.html');
  assert.equal(html.status, 200);
  assert.match(html.headers['content-type'], /^text\/html/);
  assert.match(html.body, /<html lang="tr">/);
  assert.match(html.body, /<script type="module" src="\/src\/app.js"><\/script>/);
  const script = await fetchPath('/src/app.js');
  assert.equal(script.status, 200);
  assert.match(script.headers['content-type'], /^text\/javascript/);
  for (const path of ['/../package.json', '/%2e%2e/package.json', '/%2e%2e%5cpackage.json']) {
    assert.equal((await fetchPath(path)).status, 403);
  }
  assert.equal((await fetchPath('/missing.js')).status, 404);
  assert.equal((await fetchPath('/%ZZ')).status, 400);
});

test('package has exact commands and no dependencies', async () => {
  const pkg = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node scripts/run-tests.mjs');
  assert.equal(pkg.scripts.posttest, 'node scripts/run-tests.mjs e2e');
  assert.equal(pkg.scripts.start, 'node scripts/serve.mjs');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});

test('hash changes replace the placeholder and listeners can be removed', () => {
  const dom = createFakeDOM();
  const unmount = mountApp(dom);
  assert.equal(dom.root.children[0].children[0].textContent, 'Karakter testi');
  assert.match(dom.root.textContent, /T11/);
  dom.window.location.hash = '#karsilastirma';
  dom.window.dispatch('hashchange');
  assert.equal(dom.root.children.length, 1);
  assert.equal(dom.root.children[0].children[0].textContent, 'Karakter görseli karşılaştırması');
  assert.match(dom.root.textContent, /T12/);
  dom.window.location.hash = '#karakter-testi';
  dom.window.dispatch('hashchange');
  assert.match(dom.root.textContent, /T11/);
  dom.window.location.hash = '#unknown';
  dom.window.dispatch('hashchange');
  assert.match(dom.root.textContent, /T11/);
  unmount();
  dom.window.location.hash = '#karsilastirma';
  dom.window.dispatch('hashchange');
  assert.match(dom.root.textContent, /T11/);
});

test('fake DOM attributes, text and events', () => {
  const { document } = createFakeDOM();
  const element = document.createElement('button');
  element.setAttribute('aria-label', 'Aç');
  element.textContent = 'Aç';
  let clicks = 0;
  element.addEventListener('click', () => { clicks++; });
  element.dispatch({ type: 'click' });
  assert.equal(clicks, 1);
  assert.equal(element.getAttribute('aria-label'), 'Aç');
  assert.equal(element.textContent, 'Aç');
});

test('clock and random are deterministic', () => {
  const clock = new FakeClock(10);
  const seen = [];
  clock.requestAnimationFrame(time => seen.push(time));
  const cancelled = clock.requestAnimationFrame(() => assert.fail('cancelled frame'));
  clock.cancelAnimationFrame(cancelled);
  clock.advance(16);
  clock.advance(16);
  assert.deepEqual(seen, [26]);
  assert.equal(clock.now(), 42);
  const random = new FakeRandom([0.1, 0.9]);
  assert.deepEqual([random.next(), random.next(), random.next()], [0.1, 0.9, 0.1]);
  assert.throws(() => new FakeRandom([]), RangeError);
});
