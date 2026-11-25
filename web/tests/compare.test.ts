import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANDIDATES, DEFAULT_COMPARE, LATENCY, METRICS, MIN_COMPARE, NOTES, best, parseCompare, summarize, tokenParts, tokenTotal, toggleCompare } from '../src/flow/compare.ts';
import { DEFAULT_USAGE, estimate } from '../src/flow/cost.ts';

const byId = (id: string) => CANDIDATES.find(candidate => candidate.id === id)!;

test('her aday için üç kıyasta da artı, eksi ve gecikme kaydı var', () => {
  assert.deepEqual(METRICS.map(metric => metric.value), ['tokens', 'latency', 'price']);
  for (const metric of METRICS) for (const candidate of CANDIDATES) {
    const notes = NOTES[metric.value][candidate.id];
    assert.ok(notes.pros.length >= 2 && notes.cons.length >= 2, `${metric.value}/${candidate.id}`);
  }
  for (const candidate of CANDIDATES) {
    const latency = LATENCY[candidate.id];
    assert.ok(latency.published[0] > 0 && latency.published[1] >= latency.published[0], candidate.id);
    assert.ok(latency.measured === null ? latency.unmeasured.length > 20 : latency.measuredNote.length > 5, `${candidate.id}: ölçüm ya da ölçülmeme nedeni`);
  }
  assert.equal(CANDIDATES[0].id, 'gemini-live');
});

test('seçim: her aday çıkarılabilir, yenisi eklenebilir, sıra sabittir', () => {
  assert.equal(MIN_COMPARE, 2);
  assert.deepEqual(parseCompare(null), DEFAULT_COMPARE);
  assert.deepEqual(parseCompare('bozuk'), DEFAULT_COMPARE);
  assert.deepEqual(parseCompare('["drawn-openai","yok","gemini-live"]'), ['gemini-live', 'drawn-openai']);
  assert.deepEqual(parseCompare('["gemini-live"]'), ['gemini-live'], 'kullanıcının bıraktığı seçim korunur');
  assert.deepEqual(parseCompare('[]'), []);
  const two = ['gemini-live', 'drawn-openai'];
  assert.deepEqual(toggleCompare(two, 'gemini-live'), ['drawn-openai']);
  assert.deepEqual(toggleCompare(['drawn-openai'], 'drawn-openai'), []);
  assert.deepEqual(toggleCompare(two, 'synthesia-realtime'), ['gemini-live', 'synthesia-realtime', 'drawn-openai']);
  assert.equal(toggleCompare(two, 'bilinmeyen'), two);
  let all: string[] = []; for (const candidate of [...CANDIDATES].reverse()) all = toggleCompare(all, candidate.id);
  assert.deepEqual(all, CANDIDATES.map(candidate => candidate.id));
});

test('token: Gemini\'de görüntü baskın; Realtime bağlam çarpanıyla; zincirde metin tokenı', () => {
  const gemini = tokenParts(byId('gemini-live'));
  assert.equal(gemini[0].tokens, .5 * 6192 * 60); assert.ok(gemini[0].tokens / tokenTotal(byId('gemini-live')) > .99);
  assert.equal(tokenTotal(byId('drawn-realtime')), (.5 * 1200 + .4 * 600) * 1.5);
  assert.equal(tokenTotal(byId('synthesia-realtime')), tokenTotal(byId('drawn-realtime')), 'Synthesia avatarı token harcamaz');
  assert.deepEqual(tokenParts(byId('drawn-openai')).map(part => Math.round(part.tokens)), [3600, 625, 180]);
  assert.deepEqual(summarize('tokens', byId('gemini-live'), DEFAULT_USAGE).values.map(item => item.value), ['187 bin']);
  assert.deepEqual(summarize('tokens', byId('drawn-realtime'), DEFAULT_USAGE).values.map(item => item.value), ['1.260']);
});

test('fiyat maliyet hesabıyla aynıdır', () => {
  const usage = { minutes: 30, users: 1000 };
  for (const candidate of CANDIDATES) assert.equal(summarize('price', candidate, usage).score, estimate(candidate.mode, candidate.choices, usage).monthly);
  assert.deepEqual(best('price', CANDIDATES.map(candidate => candidate.id), usage), ['drawn-openai']);
  assert.deepEqual(best('tokens', ['gemini-live', 'synthesia-realtime', 'drawn-realtime'], usage), ['synthesia-realtime', 'drawn-realtime']);
  assert.deepEqual(best('price', ['gemini-live'], usage), [], 'tek adayla kazanan gösterilmez');
});

test('gecikme: ortalama süre ve bizim ölçüm iki satır; açıklamalar tooltip\'te; ölçülmeyen "–"', () => {
  const gemini = summarize('latency', byId('gemini-live'), DEFAULT_USAGE);
  assert.deepEqual(gemini.values.map(item => [item.label, item.value]), [['Ortalama süre', '2,3 sn'], ['Ölçüm', '–']]);
  assert.deepEqual(gemini.detail, [], 'açıklama satırı yok; hepsi tooltip\'te');
  assert.match(gemini.values[0].tip!.lines.join(' '), /Aralık: 1,6–3,0 sn/); assert.match(gemini.values[0].tip!.lines.join(' '), /Bizim ölçümümüz değil/);
  assert.equal(gemini.values[1].missing, true); assert.equal(gemini.values[1].tip!.title, 'Ölçülmedi');
  assert.match(gemini.values[1].tip!.lines.join(' '), /güvenilir sonuç alınamadı.*Avatarın hazırlanması: 5,8–9,1 sn/);
  const drawn = summarize('latency', byId('drawn-realtime'), DEFAULT_USAGE);
  assert.deepEqual(drawn.values.map(item => item.value), ['1,1 sn', '0,9 sn']); assert.equal(drawn.values[1].tip!.title, 'Bizim ölçümümüz');
  assert.deepEqual(summarize('latency', byId('drawn-openai'), DEFAULT_USAGE).values.map(item => item.value), ['1,3 sn', '5,8 sn']);
  assert.match(summarize('latency', byId('synthesia-openai'), DEFAULT_USAGE).values[1].tip!.lines[0], /henüz bağlı değil/);
  // kazanan yayımlanan aralığın ortasına göredir (her adayda var)
  assert.deepEqual(best('latency', CANDIDATES.map(candidate => candidate.id), DEFAULT_USAGE), ['synthesia-realtime', 'drawn-realtime']);
});
