import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../../web/src/config/config-loader.js';

const config = JSON.parse(await readFile(resolve(process.cwd(), 'web/config/lypsync.config.json'), 'utf8'));
const copy = () => structuredClone(config);
const defaultConfig = { ...config, face: { style: "drawn" } };
const response = value => ({ ok: true, json: async () => value });
function logger() {
  const messages = [];
  return { messages, warn: message => messages.push(message) };
}

test('face style accepts photo and drawn; missing or invalid styles warn and fall back', async () => {
  for (const style of ['photo', 'drawn', undefined, 'cartoon']) {
    const input = copy();
    input.face = style === undefined ? {} : { style };
    const log = logger();
    const result = await loadConfig(async () => response(input), log);
    assert.equal(result.face.style, style === 'photo' ? 'photo' : 'drawn');
    assert.equal(log.messages.length, style === undefined || style === 'cartoon' ? 1 : 0);
    if (log.messages.length) assert.match(log.messages[0], /varsayılan/);
  }
  const input = copy();
  delete input.face;
  const log = logger();
  assert.equal((await loadConfig(async () => response(input), log)).face.style, 'drawn');
  assert.equal(log.messages.length, 1);
});

test('lidColor preserves six-digit hex colors and defaults missing or invalid values', async () => {
  for (const value of [undefined, 'red', '#ABC', '#AABBCC', '#aabbcc']) {
    const input = copy();
    for (const eye of input.eyes) {
      if (value === undefined) delete eye.lidColor;
      else eye.lidColor = value;
    }
    const result = await loadConfig(async () => response(input), logger());
    const expected = ['#AABBCC', '#aabbcc'].includes(value) ? value : '#C8937A';
    assert.deepEqual(result.eyes.map(eye => eye.lidColor), [expected, expected]);
  }
});

test('file and defaults contain measured face coordinates with distinct styles', async () => {
  const fallback = await loadConfig(async () => response({}), logger());
  assert.equal(config.face.style, 'photo');
  assert.equal(fallback.face.style, 'drawn');
  for (const source of [config, fallback]) {
    assert.deepEqual(source.mouth, { x: 236, y: 221, width: 50, lipColor: '#985D50' });
    assert.deepEqual(source.eyes.map(({ x, y, width, height }) => ({ x, y, width, height })), [
      { x: 201, y: 150, width: 30, height: 14 },
      { x: 270, y: 149, width: 30, height: 14 }
    ]);
  }
});

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
    assert.deepEqual(await loadConfig(fetchFn, log), defaultConfig);
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
  assert.deepEqual(await loadConfig(async () => response({}), logger()), defaultConfig);
});
