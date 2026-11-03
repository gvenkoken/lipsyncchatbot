import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../../web/src/config/config-loader.js';

const config = JSON.parse(await readFile(resolve(process.cwd(), 'web/config/lypsync.config.json'), 'utf8'));
const copy = () => structuredClone(config);
const response = value => ({ ok: true, json: async () => value });
function logger() {
  const messages = [];
  return { messages, warn: message => messages.push(message) };
}

test('her yükleme önbelleksiz GET yapar ve yeni selamlamayı okur', async () => {
  const calls = [];
  const next = copy();
  next.greeting = { text: 'Tekrar merhaba', delayMs: 2300 };
  const answers = [copy(), next];
  const fetchFn = async (...args) => {
    calls.push(args);
    return response(answers.shift());
  };
  const log = logger();
  assert.deepEqual(await loadConfig(fetchFn, log), config);
  assert.deepEqual((await loadConfig(fetchFn, log)).greeting, next.greeting);
  assert.deepEqual(calls, Array.from({ length: 2 }, () => [
    '/config/lypsync.config.json', { method: 'GET', cache: 'no-store' }
  ]));
  assert.deepEqual(log.messages, []);
});

test('hız ve ton eksik veya aralık dışında ise 1, geçerliyse verilen değerdir', async () => {
  for (const value of [undefined, 2, 0.8, 0.5, 1.5, NaN, Infinity, '1']) {
    const input = copy();
    input.speech.rate = value;
    input.speech.pitch = value;
    const result = await loadConfig(async () => response(input), logger());
    const expected = [0.8, 0.5, 1.5].includes(value) ? value : 1;
    assert.equal(result.speech.rate, expected);
    assert.equal(result.speech.pitch, expected);
  }
});

test('hatalı alanlar ayrı ayrı tamamlanır ve bir Türkçe uyarı verilir', async () => {
  for (const value of [-1, '12', Infinity, NaN]) {
    const input = copy();
    input.mouth.x = value;
    input.eyes[0].irisColor = 'red';
    input.eyes[1].y = 160;
    const log = logger();
    const result = await loadConfig(async () => response(input), log);
    assert.equal(result.mouth.x, config.mouth.x);
    assert.equal(result.eyes[0].irisColor, config.eyes[0].irisColor);
    assert.equal(result.eyes[1].y, 160);
    assert.equal(log.messages.length, 1);
    assert.match(log.messages[0], /varsayılan/);
  }
});

test('varsayılan gövde korunur ve türev kaynak aynen alınır', async () => {
  const base = await loadConfig(async () => response({}), logger());
  assert.deepEqual(base.body, {
    src: 'assets/owner/akilay2-removebg-preview-1.png', width: 463, height: 539
  });
  assert.equal(base.greeting.delayMs, 1500);
  const input = copy();
  input.body.src = 'assets/generated/akilay2-face-base.png';
  assert.equal((await loadConfig(async () => response(input), logger())).body.src, input.body.src);
});

test('bozuk JSON, başarısız HTTP ve okuma hatası varsayılanlarla devam eder', async () => {
  const failures = [
    async () => ({ ok: true, json: async () => JSON.parse('{') }),
    async () => ({ ok: false }),
    async () => { throw new Error('Okuma hatası'); },
    async () => response(null)
  ];
  for (const fetchFn of failures) {
    const log = logger();
    assert.deepEqual(await loadConfig(fetchFn, log), config);
    assert.equal(log.messages.length, 1);
  }
});

test('sonuçlar birbirinden bağımsızdır; eksik göz ve geçersiz boyut tamamlanır', async () => {
  const input = copy();
  input.eyes = [input.eyes[0]];
  input.body.width = 0;
  input.greeting.delayMs = -1;
  const first = await loadConfig(async () => response(input), logger());
  assert.deepEqual(first, config);
  first.eyes[0].x = 999;
  first.body.width = 999;
  assert.deepEqual(await loadConfig(async () => response({}), logger()), config);
});
