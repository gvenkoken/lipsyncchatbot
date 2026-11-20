// alignText kalibrasyonu: OpenAI TTS cümlelerinde kelime başlangıç hatası (referans: faster-whisper).
// Kullanım: node scripts/avatar-calibrate.mjs [--tune] [--detail]
// Veri: viseme_analysis/scripts/c02_calibration_data.py  ->  viseme_analysis/out_v2/calib/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignSamples, speechRegions, DEFAULT_ALIGN } from '../src/video-avatar/align.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'viseme_analysis/out_v2/calib');
const dataset = JSON.parse(fs.readFileSync(path.join(dir, 'dataset.json'), 'utf8'));
export function readWav(file) {
  const bytes = fs.readFileSync(file), pcm = new Int16Array(bytes.buffer, bytes.byteOffset + 44, (bytes.length - 44) >> 1);
  return { samples: Float32Array.from(pcm, value => value / 32768), sampleRate: bytes.readUInt32LE(24) };
}
const items = dataset.items.filter(item => item.exact).map(item => ({ ...item, ...readWav(path.join(dir, item.wav)) }));

// Kalibrasyondan ÖNCEKİ ilk tahmin (orantılı dağıtım + tepe çekme) – karşılaştırma için sabit.
const INITIAL = { hop: .01, threshold: .22, minSilence: .12, minSpeech: .04, vowel: 1, plosive: .62, fricative: .9, sonorant: .62, softG: .45, wordGap: .12, commaGap: .35,
  finalLengthen: 1.5, finalWord: 1, initialPad: .02, punctuationBonus: .25, longGap: .25, acoustic: 0, energyWeight: 1, zcrWeight: 1, zcrSibilant: .22, peakPull: .5, peakMaxShift: .06 };

// Referans düzeltmesi: Whisper ilk kelimeyi 0.00'a koyar ve duraklamadan sonraki kelimenin başlangıcını geç verir
// (cümle sınırındaki uzun kelimeleri kırpar). Kelimeden hemen önce gerçek bir sessizlik bitiyorsa referans, sesin
// yeniden başladığı andır. Eşik sabittir; ayarlanan parametrelerden bağımsızdır. Ham Whisper değerleri de raporlanır.
const REFERENCE = { ...INITIAL, threshold: .33 };
for (const item of items) {
  const { regions } = speechRegions(item.samples, item.sampleRate, REFERENCE);
  item.reference = [];
  item.words.forEach((word, index) => {
    let value = word.start;
    if (index === 0) value = regions[0]?.start ?? 0;
    else {
      const previous = item.reference[index - 1], previousEnd = item.words[index - 1].end;
      const onsets = regions.slice(1).map(region => region.start).filter(onset => onset <= word.start + .06 && onset > previous + .12 && onset >= previousEnd - .25);
      if (onsets.length) value = onsets.at(-1);
    }
    item.reference.push(value);
  });
}
function errors(params, subset = items, raw = false) {
  const all = [];
  for (const item of subset) {
    const result = alignSamples(item.samples, item.sampleRate, item.text, params);
    if (result.words.length !== item.words.length) { all.push(...item.words.map(() => .5)); continue; }
    item.words.forEach((word, index) => all.push(Math.abs(result.words[index].start - (raw ? word.start : item.reference[index]))));
  }
  return all;
}
const stats = list => { const sorted = [...list].sort((a, b) => a - b); return { mean_ms: +(sorted.reduce((sum, value) => sum + value, 0) / sorted.length * 1000).toFixed(1), median_ms: +(sorted[sorted.length >> 1] * 1000).toFixed(1), p90_ms: +(sorted[Math.floor(sorted.length * .9)] * 1000).toFixed(1), n: sorted.length }; };
const objective = (params, subset) => { const s = stats(errors(params, subset)); return s.mean_ms + .5 * s.p90_ms; };

const report = {
  voice: dataset.voice, model: dataset.model, sentences: items.length, words: items.reduce((sum, item) => sum + item.words.length, 0),
  reference: 'faster-whisper medium kelime başlangıçları; sessizlikten sonraki kelimeler ses başlangıcına çekildi',
  reference_starts_moved: items.reduce((sum, item) => sum + item.reference.filter((value, index) => Math.abs(value - item.words[index].start) > .03).length, 0),
  before: stats(errors(INITIAL)), before_vs_raw_whisper: stats(errors(INITIAL, items, true)),
  current_defaults: stats(errors(DEFAULT_ALIGN)), current_defaults_vs_raw_whisper: stats(errors(DEFAULT_ALIGN, items, true)),
};

if (process.argv.includes('--tune')) {
  const grid = {
    acoustic: [0, .5, 1, 1.5, 2.5, 4], energyWeight: [.5, 1, 1.5, 2.5], zcrWeight: [0, .5, 1, 2, 3], zcrSibilant: [.12, .17, .22, .28, .35],
    threshold: [.12, .17, .22, .27, .33], minSilence: [.1, .12, .15, .18], plosive: [.4, .5, .62, .75], fricative: [.7, .9, 1.1, 1.3],
    sonorant: [.45, .55, .62, .75], softG: [0, .25, .45, .7], wordGap: [0, .06, .12, .2], commaGap: [.1, .35, .6], finalLengthen: [1, 1.5, 2, 2.6],
    finalWord: [1, 1.15, 1.3, 1.5], initialPad: [0, .02, .04], punctuationBonus: [.1, .25, .4, .6], longGap: [.1, .25, .5],
  };
  // Aşırı uyumu görmek için: çift numaralı cümlelerde ayarla, tek numaralılarda doğrula.
  const train = items.filter((_, index) => index % 2 === 0), held = items.filter((_, index) => index % 2 === 1);
  let best = { ...INITIAL, acoustic: 1 }, score = objective(best, train);
  for (let round = 0; round < 3; round++) {
    let improved = false;
    for (const [key, values] of Object.entries(grid)) for (const value of values) {
      if (best[key] === value) continue;
      const candidate = { ...best, [key]: value }, s = objective(candidate, train);
      if (s < score - .2) { best = candidate; score = s; improved = true; }
    }
    if (!improved) break;
  }
  report.tuned_params = best;
  report.before_heldout = stats(errors(INITIAL, held));
  report.after_train = stats(errors(best, train)); report.after_heldout = stats(errors(best, held)); report.after_all = stats(errors(best));
  report.after_all_vs_raw_whisper = stats(errors(best, items, true));
}
fs.writeFileSync(path.join(root, 'viseme_analysis/out_v2/calibration.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--detail')) for (const item of items) {
  const result = alignSamples(item.samples, item.sampleRate, item.text, report.tuned_params ?? DEFAULT_ALIGN);
  console.log(item.id, '| bölgeler', result.regions.map(r => r.start.toFixed(2) + '-' + r.end.toFixed(2)).join(' '), '| ref', item.reference.map(v => v.toFixed(2)).join(' '), '| hata(ms)', item.reference.map((v, i) => Math.round((result.words[i].start - v) * 1000)).join(' '));
}
