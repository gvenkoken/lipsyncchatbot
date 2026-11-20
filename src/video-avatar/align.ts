// Zaman damgası vermeyen TTS (OpenAI) için: ses enerjisi + metinden harf zamanlaması tahmini.
// Saf mantık; tarayıcıda AudioBuffer ile, Node'da Float32Array ile çalışır.
//  1) 10 ms RMS zarfı + uyarlanır eşik -> konuşma / sessizlik bölgeleri
//  2) metin öbekleri -> bölgeler (dinamik programlama; noktalama sessizliğe denk gelsin)
//  3) bölge içinde harfler: ağırlıklı süre önseli + akustik ipuçları (enerji, sıfır geçiş oranı) ile Viterbi
import { isVowelChar, lower, visemeOf, type Timing } from './visemes.ts';

export type AlignParams = {
  hop: number;            // zarf adımı (s)
  threshold: number;      // gürültü tabanı ile tepe arasındaki (dB) oran: üstü konuşma
  minSilence: number;     // bundan kısa sessizlik konuşmaya katılır (s)
  minSpeech: number;      // bundan kısa konuşma bölgesi atılır (s)
  vowel: number; plosive: number; fricative: number; sonorant: number; // harf süre ağırlıkları
  softG: number;          // "ğ"nin önceki ünlüye eklediği ağırlık
  wordGap: number;        // bölge içindeki kelime arası ağırlığı
  commaGap: number;       // sessizliğe denk gelmeyen noktalama ağırlığı
  finalLengthen: number;  // bölge sonundaki son ünlünün uzaması (çarpan)
  finalWord: number;      // öbeğin son kelimesinin uzaması (çarpan)
  initialPad: number;     // bölge başında konuşma eşiği aşılmadan önceki pay (s)
  punctuationBonus: number; // öbek sınırının noktalamaya denk gelmemesinin cezası
  longGap: number;        // noktalamasız yerde bundan uzun sessizlik beklenmez (s)
  acoustic: number;       // akustik hizalamanın ağırlığı (0 = yalnızca orantılı dağıtım + tepe çekme)
  energyWeight: number;   // enerji ipucu (ünlü yüksek, patlamalı kapanışı düşük)
  zcrWeight: number;      // sıfır geçiş oranı ipucu (s, ş, z, ç, c, j yüksek)
  zcrSibilant: number;    // ıslıklı ünsüz eşiği (0..1)
  peakPull: number;       // (akustik kapalıyken) ünlü merkezlerini enerji tepelerine çekme oranı
  peakMaxShift: number;   // en fazla kaydırma (s)
};
// Kalibrasyonla ayarlanan değerler: node scripts/avatar-calibrate.mjs --tune  (viseme_analysis/out_v2/calibration.json)
export const DEFAULT_ALIGN: AlignParams = {
  hop: .01, threshold: .27, minSilence: .1, minSpeech: .04,
  vowel: 1, plosive: .62, fricative: .7, sonorant: .45, softG: .25,
  wordGap: .2, commaGap: .35, finalLengthen: 1, finalWord: 1, initialPad: 0,
  punctuationBonus: .25, longGap: .25,
  acoustic: .5, energyWeight: 1, zcrWeight: .5, zcrSibilant: .22, peakPull: .5, peakMaxShift: .06,
};

const PLOSIVE = new Set([...'pbtdkgçc']), FRICATIVE = new Set([...'fvszşjh']);
const SIBILANT = new Set([...'szşçcj']), WEAK = new Set([...'fvh']);
const PUNCT = /[.,;:!?…–—]/;
type Unit = { char: string; weight: number; word: number; vowel: boolean };
type Word = { units: Unit[]; breakAfter: boolean; text: string };
type Slot = { char: string; weight: number; vowel: boolean; gap: boolean; pause?: boolean };
export type Region = { start: number; end: number };
type Features = { db: Float32Array; zcr: Float32Array; energy: Float32Array };

function letterWeight(char: string, p: AlignParams) {
  if (/\d/.test(char)) return p.vowel * 3; // rakam birkaç hece okunur
  if (isVowelChar(char)) return p.vowel;
  return PLOSIVE.has(char) ? p.plosive : FRICATIVE.has(char) ? p.fricative : p.sonorant;
}

export function tokenize(text: string, p: AlignParams): Word[] {
  const words: Word[] = [];
  for (const token of text.trim().split(/\s+/)) {
    if (!token) continue;
    const units: Unit[] = [];
    for (const raw of token) {
      const char = lower(raw);
      if (char === 'ğ') { const previous = units.at(-1); if (previous?.vowel) previous.weight += p.softG; units.push({ char: raw, weight: 0, word: words.length, vowel: false }); continue; }
      if (!visemeOf(char)) continue;
      units.push({ char: raw, weight: letterWeight(char, p), word: words.length, vowel: isVowelChar(char) });
    }
    const breakAfter = PUNCT.test(token.at(-1) ?? '');
    if (!units.length) { if (breakAfter && words.length) words[words.length - 1].breakAfter = true; continue; }
    words.push({ units, breakAfter, text: token });
  }
  return words;
}

/** 10 ms RMS zarfı (dB), sıfır geçiş oranı ve uyarlanır eşikle konuşma bölgeleri. */
export function speechRegions(samples: Float32Array, sampleRate: number, p: AlignParams) {
  const hop = Math.max(1, Math.round(sampleRate * p.hop)), count = Math.floor(samples.length / hop);
  const db = new Float32Array(count), zcr = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let sum = 0, crossings = 0; const from = Math.max(0, i * hop - hop / 2 | 0), to = Math.min(samples.length, i * hop + hop * 1.5 | 0);
    for (let j = from; j < to; j++) { sum += samples[j] * samples[j]; if (j > from && (samples[j] >= 0) !== (samples[j - 1] >= 0)) crossings++; }
    db[i] = 10 * Math.log10(sum / Math.max(1, to - from) + 1e-10);
    zcr[i] = Math.min(1, crossings / Math.max(1, to - from) * (sampleRate / 8000)); // 4 kHz ton = 1
  }
  const sorted = Float32Array.from(db).sort();
  const floor = Math.max(sorted[Math.floor(count * .05)] ?? -100, -80), peak = sorted[Math.floor(count * .95)] ?? 0;
  const limit = floor + p.threshold * (peak - floor);
  const energy = new Float32Array(count); // 0..1: gürültü tabanı -> tepe
  for (let i = 0; i < count; i++) energy[i] = Math.min(1, Math.max(0, (db[i] - floor) / Math.max(1, peak - floor)));
  const regions: Region[] = [];
  let start = -1;
  for (let i = 0; i <= count; i++) {
    const voiced = i < count && db[i] > limit;
    if (voiced && start < 0) start = i;
    if (!voiced && start >= 0) { regions.push({ start: start * p.hop, end: i * p.hop }); start = -1; }
  }
  const joined: Region[] = [];
  for (const region of regions) {
    const previous = joined.at(-1);
    if (previous && region.start - previous.end < p.minSilence) previous.end = region.end; else joined.push({ ...region });
  }
  return { regions: joined.filter(region => region.end - region.start >= p.minSpeech), db, zcr, energy, limit, duration: samples.length / sampleRate };
}

/** Kelimeleri sırayla konuşma bölgelerine dağıtır (dinamik programlama). Dönen: her bölgenin kelime aralığı [from,to). */
export function assignWords(words: Word[], regions: Region[], p: AlignParams): [number, number][] {
  const n = words.length, m = regions.length;
  if (!m) return [];
  const prefix = [0]; for (const word of words) prefix.push(prefix.at(-1)! + word.units.reduce((sum, unit) => sum + unit.weight, 0) + p.wordGap);
  const speech = regions.reduce((sum, region) => sum + region.end - region.start, 0);
  const rate = speech / Math.max(1e-6, prefix[n]); // ağırlık birimi başına saniye
  const INF = 1e9;
  const cost = Array.from({ length: m + 1 }, () => new Float64Array(n + 1).fill(INF));
  const back = Array.from({ length: m + 1 }, () => new Int32Array(n + 1).fill(-1));
  cost[0][0] = 0;
  for (let r = 1; r <= m; r++) {
    const length = regions[r - 1].end - regions[r - 1].start;
    const gapAfter = r < m ? regions[r].start - regions[r - 1].end : 0;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= j; i++) {
      if (cost[r - 1][i] >= INF) continue;
      const expected = (prefix[j] - prefix[i]) * rate;
      // Boş bölge (nefes, tıkırtı) süresi kadar cezalandırılır.
      let c = i === j ? length * 2 : Math.abs(length - expected) / Math.max(.15, length);
      // Sessizlik noktalamaya denk gelmeli; noktalamasız yerde uzun sessizlik daha da olası değil.
      if (j > i && j < n && !words[j - 1].breakAfter) c += p.punctuationBonus * (1 + Math.max(0, gapAfter - p.minSilence) / Math.max(.01, p.longGap));
      const total = cost[r - 1][i] + c;
      if (total < cost[r][j]) { cost[r][j] = total; back[r][j] = i; }
    }
  }
  const spans: [number, number][] = [];
  for (let r = m, j = n; r >= 1; r--) { const i = back[r][j]; spans.unshift([i, j]); j = i; }
  return spans;
}

function envelopePeaks(db: Float32Array, hop: number, region: Region) {
  const from = Math.round(region.start / hop), to = Math.min(db.length, Math.round(region.end / hop));
  const smooth: number[] = [];
  for (let i = from; i < to; i++) { let sum = 0, count = 0; for (let k = -2; k <= 2; k++) if (i + k >= from && i + k < to) { sum += db[i + k]; count++; } smooth.push(sum / count); }
  const peaks: number[] = [];
  for (let i = 1; i < smooth.length - 1; i++) {
    if (smooth[i] < smooth[i - 1] || smooth[i] < smooth[i + 1]) continue;
    let left = smooth[i], right = smooth[i];
    for (let k = i - 1; k >= Math.max(0, i - 12); k--) left = Math.min(left, smooth[k]);
    for (let k = i + 1; k <= Math.min(smooth.length - 1, i + 12); k++) right = Math.min(right, smooth[k]);
    if (smooth[i] - Math.max(left, right) < 1.5) continue; // en az 1,5 dB belirginlik
    const time = (from + i) * hop;
    if (peaks.length && time - peaks.at(-1)! < .07) continue;
    peaks.push(time);
  }
  return peaks;
}

/** Harf sırasını 10 ms'lik enerji / sıfır-geçiş özelliklerine oturtur (yarı-Markov Viterbi). Dönen: sınırlar (s). */
function acousticBounds(slots: Slot[], start: number, end: number, expected: number[], f: Features, p: AlignParams): number[] | undefined {
  const t0 = Math.round(start / p.hop), T = Math.min(f.energy.length, Math.round(end / p.hop)) - t0, K = slots.length;
  if (T < K || T < 4) return undefined;
  // Harf sınıfına göre bir karenin uyum puanı (yüksek = uyumlu)
  const score = (slot: Slot, t: number) => {
    const e = f.energy[t0 + t], z = f.zcr[t0 + t], char = lower(slot.char);
    if (slot.gap) return p.energyWeight * (.3 - e) * 1.5; // eşiğin kaçırdığı duraklamalar (nefes vb.) burada yakalanır
    if (slot.vowel || /\d/.test(char)) return p.energyWeight * (e - .55) - p.zcrWeight * Math.max(0, z - p.zcrSibilant * .7) * 2;
    if (SIBILANT.has(char)) return p.zcrWeight * (z - p.zcrSibilant) * 3;
    if (PLOSIVE.has(char)) return p.energyWeight * (.45 - e);
    if (WEAK.has(char)) return p.energyWeight * .5 * (.5 - e) + p.zcrWeight * (z - p.zcrSibilant * .6);
    return p.energyWeight * .4 * (e - .4) - p.zcrWeight * Math.max(0, z - p.zcrSibilant * .7) * 2; // m n l r y
  };
  const NEG = -1e9;
  let previous = new Float64Array(T + 1).fill(NEG); previous[0] = 0;
  const back: Int16Array[] = [];
  for (let k = 0; k < K; k++) {
    const slot = slots[k], want = expected[k] / p.hop;
    const current = new Float64Array(T + 1).fill(NEG), from = new Int16Array(T + 1).fill(-1);
    if (slot.weight === 0 && !slot.gap) { current.set(previous); for (let t = 0; t <= T; t++) from[t] = t; back.push(from); previous = current; continue; } // ğ: süresiz
    const prefix = new Float64Array(T + 1); for (let t = 0; t < T; t++) prefix[t + 1] = prefix[t] + score(slot, t);
    // Kelime arası boşluk 0–150 ms, noktalama boşluğu 0–900 ms sürebilir; uzaması cezalandırılmaz.
    const pause = !!slot.pause;
    const dmin = slot.gap ? 0 : 2, dmax = pause ? 90 : slot.gap ? 15 : Math.max(dmin + 2, Math.ceil(want * 3 + 6)), spread = want * .5 + 2;
    for (let t = 0; t <= T; t++) {
      if (previous[t] <= NEG / 2) continue;
      for (let d = dmin; d <= dmax && t + d <= T; d++) {
        const deviation = slot.gap ? Math.min(0, d - want) / spread : (d - want) / spread;
        const total = previous[t] + p.acoustic * (prefix[t + d] - prefix[t]) - deviation * deviation;
        if (total > current[t + d]) { current[t + d] = total; from[t + d] = t; }
      }
    }
    back.push(from); previous = current;
  }
  if (previous[T] <= NEG / 2) return undefined;
  const frames = new Array<number>(K + 1); frames[K] = T;
  for (let k = K - 1; k >= 0; k--) frames[k] = back[k][frames[k + 1]];
  return frames.map(frame => (t0 + frame) * p.hop);
}

/** Ünlü merkezlerini en yakın enerji tepelerine çeker (akustik hizalama kapalıyken ya da başarısızsa). */
function pullToPeaks(slots: Slot[], bounds: number[], start: number, region: Region, db: Float32Array, p: AlignParams) {
  const vowels = slots.map((slot, i) => slot.vowel ? i : -1).filter(i => i >= 0);
  const peaks = envelopePeaks(db, p.hop, region);
  if (vowels.length < 2 || Math.abs(peaks.length - vowels.length) > Math.max(1, Math.round(vowels.length * .2))) return;
  const anchors: { at: number; to: number }[] = [];
  let cursor = 0;
  for (const index of vowels) {
    const centre = (bounds[index] + bounds[index + 1]) / 2;
    let best = -1, distance = p.peakMaxShift * 2;
    for (let k = cursor; k < peaks.length; k++) { const d = Math.abs(peaks[k] - centre); if (d < distance) { distance = d; best = k; } else if (peaks[k] > centre) break; }
    if (best < 0) continue;
    cursor = best + 1;
    anchors.push({ at: centre, to: centre + Math.max(-p.peakMaxShift, Math.min(p.peakMaxShift, (peaks[best] - centre) * p.peakPull)) });
  }
  if (!anchors.length) return;
  const knots = [{ at: start, to: start }, ...anchors, { at: region.end, to: region.end }].filter((knot, i, all) => i === 0 || (knot.at > all[i - 1].at + 1e-4 && knot.to > all[i - 1].to + 1e-4));
  const warp = (time: number) => {
    for (let k = 1; k < knots.length; k++) if (time <= knots[k].at) { const a = knots[k - 1], b = knots[k]; return a.to + (time - a.at) * (b.to - a.to) / (b.at - a.at); }
    return time;
  };
  for (let i = 1; i < bounds.length - 1; i++) bounds[i] = warp(bounds[i]);
}

/** Bir bölgedeki kelimelerin harflerine süre dağıtır. */
function layout(words: Word[], region: Region, f: Features, p: AlignParams): Timing[] {
  const slots: Slot[] = [];
  words.forEach((word, index) => {
    const stretch = index === words.length - 1 ? p.finalWord : 1; // öbek sonu yavaşlaması
    for (const unit of word.units) slots.push({ char: unit.char, weight: unit.weight * stretch, vowel: unit.vowel, gap: false });
    if (index < words.length - 1) slots.push({ char: ' ', weight: word.breakAfter ? p.commaGap : p.wordGap, vowel: false, gap: true, pause: word.breakAfter });
  });
  for (let i = slots.length - 1; i >= 0; i--) if (slots[i].vowel) { slots[i].weight *= p.finalLengthen; break; } // söz sonu uzaması
  const start = Math.max(0, region.start - p.initialPad), total = slots.reduce((sum, slot) => sum + slot.weight, 0) || 1;
  const scale = (region.end - start) / total;
  let bounds = [start]; for (const slot of slots) bounds.push(bounds.at(-1)! + slot.weight * scale);
  const refined = p.acoustic > 0 ? acousticBounds(slots, start, region.end, slots.map(slot => slot.weight * scale), f, p) : undefined;
  if (refined) bounds = refined; else if (p.peakPull > 0) pullToPeaks(slots, bounds, start, region, f.db, p);
  return slots.map((slot, i) => ({ char: slot.char, start: bounds[i], end: bounds[i + 1] }));
}

export type AlignResult = { timings: Timing[]; words: { text: string; start: number; end: number }[]; regions: Region[] };

export function alignSamples(samples: Float32Array, sampleRate: number, text: string, params: Partial<AlignParams> = {}): AlignResult {
  const p = { ...DEFAULT_ALIGN, ...params };
  const words = tokenize(text, p);
  const features = speechRegions(samples, sampleRate, p), { regions, duration } = features;
  if (!words.length) return { timings: [], words: [], regions };
  const usable = regions.length ? regions : [{ start: 0, end: duration }];
  const spans = assignWords(words, usable, p);
  const timings: Timing[] = [], wordTimes: AlignResult['words'] = [];
  spans.forEach(([from, to], index) => {
    if (to <= from) return;
    const part = layout(words.slice(from, to), usable[index], features, p);
    if (timings.length) timings.push({ char: ' ', start: timings.at(-1)!.end, end: part[0].start }); // bölgeler arası sessizlik
    let cursor = 0;
    for (let w = from; w < to; w++) {
      const letters = part.slice(cursor, cursor + words[w].units.length);
      wordTimes.push({ text: words[w].text, start: letters[0].start, end: letters.at(-1)!.end });
      cursor += words[w].units.length + 1;
    }
    timings.push(...part);
  });
  return { timings, words: wordTimes, regions };
}

/** İstemci tarafı: AudioBuffer + metin -> [{char,start,end}] */
export function alignText(audio: { getChannelData(channel: number): Float32Array; sampleRate: number }, text: string, params?: Partial<AlignParams>): Timing[] {
  return alignSamples(audio.getChannelData(0), audio.sampleRate, text, params).timings;
}
