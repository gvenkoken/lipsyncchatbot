import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack, sampleTrack, visemeOf, TUNING, type Timing } from '../src/video-avatar/visemes.ts';
import { alignSamples, speechRegions, tokenize, DEFAULT_ALIGN } from '../src/video-avatar/align.ts';

const spell = (text: string, step = .08, start = 0): Timing[] => [...text].map((char, i) => ({ char, start: start + i * step, end: start + (i + 1) * step }));

test('Türkçe harfler rapordaki viseme tablosuna eşlenir', () => {
  const expected: Record<string, string> = { p: 'PBM', b: 'PBM', m: 'PBM', f: 'FV', v: 'FV', t: 'DNT', d: 'DNT', n: 'DNT', l: 'DNT', r: 'DNT', s: 'SZ', z: 'SZ', 'ş': 'SH', 'ç': 'SH', c: 'SH', j: 'SH', k: 'KG', g: 'KG', h: 'KG', y: 'KG', a: 'A', e: 'E', i: 'I', 'ı': 'I', o: 'O', 'ö': 'O', u: 'U', 'ü': 'U' };
  for (const [letter, viseme] of Object.entries(expected)) assert.equal(visemeOf(letter), viseme, letter);
  assert.equal(visemeOf('I'), 'I'); assert.equal(visemeOf('İ'), 'I'); assert.equal(visemeOf(' '), undefined);
});

test('KG komşu ünlünün şeklini alır, ğ önceki ünlüyü uzatır', () => {
  const track = buildTrack(spell('dağ kol'));
  assert.deepEqual(track.map(cue => cue.viseme), ['DNT', 'A', 'O', 'DNT']); // k->O (sonraki ünlü), o ile birleşir
  assert.ok(track[1].end >= .24 - 1e-9, 'a, ğ süresini de kapsar');
  assert.deepEqual(buildTrack(spell('ak')).map(cue => cue.viseme), ['A']); // sonraki ünlü yoksa önceki
});

test('kısa boşlukta ağız kapanmaz, uzun boşluk SIL olur', () => {
  const short = buildTrack([...spell('al'), { char: ',', start: .16, end: .26 }, ...spell('al', .08, .26)]);
  assert.ok(!short.some(cue => cue.viseme === 'SIL'));
  const long = buildTrack([...spell('al'), { char: '.', start: .16, end: .56 }, ...spell('al', .08, .56)]);
  assert.deepEqual(long.map(cue => cue.viseme), ['A', 'DNT', 'SIL', 'A', 'DNT']);
});

test('PBM en az iki kare tam kapalı görünür ve kısa viseme komşusuyla birleşir', () => {
  const track = buildTrack([{ char: 'a', start: 0, end: .2 }, { char: 'b', start: .2, end: .225 }, { char: 'a', start: .225, end: .4 }, { char: 't', start: .4, end: .43 }, { char: 'a', start: .43, end: .6 }]);
  const pbm = track.find(cue => cue.viseme === 'PBM')!;
  assert.ok(pbm.end - pbm.start >= TUNING.pbmMin - 1e-9);
  assert.ok(!track.some(cue => cue.viseme === 'DNT'), '30 ms\'lik t komşusuna katılır');
  let closed = 0;
  for (let t = 0; t < .6; t += 1 / 60) { const layers = sampleTrack(track, t, 1); if (layers.length === 1 && layers[0].viseme === 'PBM') closed++; }
  assert.ok(closed >= 2, `tam kapalı kare: ${closed}`);
});

test('geçişler önceden başlar, ağırlıklar 1 eder, varyantlar sırayla döner', () => {
  const track = buildTrack(spell('masa masa', .12));
  const starts = track.filter(cue => cue.viseme === 'A').map(cue => cue.variant);
  assert.deepEqual(starts, [0, 1, 2, 0]);
  const first = track[1]; // ilk A
  const before = sampleTrack(track, first.start - TUNING.anticipation - .005, 1);
  assert.ok(before.some(layer => layer.viseme === 'A' && layer.weight > .4), 'A, sesten önce görünmeye başlar');
  for (let t = -.1; t < 1.3; t += .007) assert.ok(Math.abs(sampleTrack(track, t, .8).reduce((sum, layer) => sum + layer.weight, 0) - 1) < 1e-6);
});

test('düşük ses şiddetinde ünlüler REST_OPEN\'a karışır', () => {
  const track = buildTrack([{ char: 'a', start: 0, end: .5 }]);
  assert.equal(sampleTrack(track, .2, 1)[0].viseme, 'A');
  assert.equal(sampleTrack(track, .2, .02)[0].viseme, 'REST_OPEN');
  const mid = sampleTrack(track, .2, (TUNING.levelLow + TUNING.levelHigh) / 2);
  assert.deepEqual(mid.map(layer => layer.viseme).sort(), ['A', 'REST_OPEN']);
});

// --- alignText: sentetik ses (konuşma = gürültü patlaması, sessizlik = sıfır) ---
function synth(parts: [number, boolean][], rate = 16000) {
  const samples = new Float32Array(Math.round(parts.reduce((sum, [d]) => sum + d, 0) * rate));
  let at = 0, seed = 7;
  for (const [duration, voiced] of parts) {
    const n = Math.round(duration * rate);
    for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; samples[at + i] = voiced ? (seed / 0x7fffffff - .5) * .6 : (seed / 0x7fffffff - .5) * .0004; }
    at += n;
  }
  return { samples, rate };
}

test('konuşma bölgeleri bulunur, kısa sessizlik birleştirilir', () => {
  const { samples, rate } = synth([[.2, false], [.8, true], [.05, false], [.4, true], [.4, false], [.9, true], [.2, false]]);
  const { regions } = speechRegions(samples, rate, DEFAULT_ALIGN);
  assert.equal(regions.length, 2);
  assert.ok(Math.abs(regions[0].start - .2) < .03 && Math.abs(regions[0].end - 1.45) < .03 && Math.abs(regions[1].start - 1.85) < .03);
});

test('öbekler noktalamaya göre bölgelere eşlenir, harfler ağırlıklı dağıtılır', () => {
  const { samples, rate } = synth([[.1, false], [.5, true], [.35, false], [1.8, true], [.1, false]]);
  const text = 'Merhaba, bugün size nasıl yardımcı olabilirim?';
  const result = alignSamples(samples, rate, text);
  assert.equal(result.words.length, 6);
  assert.ok(result.words[0].end <= .62 && result.words[1].start >= .9, 'virgül sessizliğe denk gelir');
  assert.ok(Math.abs(result.words[0].start - .1) < .04 && Math.abs(result.words.at(-1)!.end - 2.75) < .04);
  for (let i = 1; i < result.timings.length; i++) assert.ok(result.timings[i].start >= result.timings[i - 1].start - 1e-9 && result.timings[i].end >= result.timings[i].start - 1e-9);
  const a = result.timings.find(t => t.char === 'a')!, b = result.timings.find(t => t.char === 'b')!;
  assert.ok(a.end - a.start > b.end - b.start, 'ünlü, patlamalı ünsüzden uzun');
  assert.equal(result.timings.filter(t => /\p{L}/u.test(t.char)).map(t => t.char).join(''), text.replace(/[^\p{L}]/gu, ''));
});

test('ğ sıfır süre alır; boş ya da yalnızca noktalama metinleri güvenlidir', () => {
  const words = tokenize('dağ', DEFAULT_ALIGN);
  assert.deepEqual(words[0].units.map(unit => unit.weight > 0), [true, true, false]);
  assert.ok(words[0].units[1].weight > DEFAULT_ALIGN.vowel);
  const { samples, rate } = synth([[.5, true]]);
  assert.deepEqual(alignSamples(samples, rate, '...').timings, []);
  assert.ok(alignSamples(new Float32Array(1600), 16000, 'sessiz').timings.length > 0);
});
