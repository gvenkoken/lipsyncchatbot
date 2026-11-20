// Saf mantık: harf zamanlaması -> viseme izi -> t anındaki katman ağırlıkları.
// DOM'a bağımlı değildir; node --test ve çevrimdışı render aynı kodu kullanır.

export type Timing = { char: string; start: number; end: number };
export type Viseme = 'SIL' | 'REST_OPEN' | 'PBM' | 'FV' | 'DNT' | 'SZ' | 'SH' | 'KG' | 'A' | 'E' | 'I' | 'O' | 'U';
export type Cue = { viseme: Viseme; start: number; end: number; variant: number; vowel: boolean };
export type Layer = { viseme: Viseme; variant: number; weight: number };

export const TUNING = {
  anticipation: 0.03,   // ağız sesten ~30 ms önce şekil alır
  crossfade: 0.06,      // 50–70 ms
  crossfadeWide: 0.1,   // yayvan <-> yayvan olmayan şekil geçişi
  minCue: 0.05,         // daha kısa viseme komşusuyla birleşir
  pbmMin: 0.07,         // dudak kapanması en az bu kadar sürer
  pbmHold: 0.035,       // bunun en az bu kadarı tam kapalı (60 fps'te ~2 kare)
  longPause: 0.18,      // bundan kısa boşluk/noktalamada ağız kapanmaz
  levelLow: 0.12, levelHigh: 0.5, // ses şiddeti (0..1) -> REST_OPEN ile tam şekil arası
  variants: 3,
};

const SPREAD = new Set<Viseme>(['E', 'I', 'SZ']);
const MAP: Record<string, Viseme> = {};
for (const [viseme, letters] of Object.entries({ PBM: 'pbm', FV: 'fvw', DNT: 'tdnlr', SZ: 'sz', SH: 'şçcj', KG: 'kghyqx', A: 'aâ', E: 'e', I: 'ıiî', O: 'oö', U: 'uüû' })) for (const letter of letters) MAP[letter] = viseme as Viseme;
const VOWELS = new Set<Viseme>(['A', 'E', 'I', 'O', 'U']);
export const lower = (char: string) => char.toLocaleLowerCase('tr-TR');
export const visemeOf = (char: string): Viseme | undefined => /\d/.test(char) ? 'E' : MAP[lower(char)];
export const isVowelChar = (char: string) => { const v = visemeOf(char); return !!v && VOWELS.has(v); };

/** Harf zamanlarından viseme izi üretir. */
export function buildTrack(timings: Timing[]): Cue[] {
  type Raw = { viseme: Viseme | 'KG?' ; start: number; end: number; word: number };
  const raw: Raw[] = [];
  let word = 0;
  for (const timing of timings) {
    const char = lower(timing.char);
    if (char === 'ğ') { // önceki ünlüyü uzatır
      const previous = raw.at(-1);
      if (previous && previous.word === word && previous.end <= timing.end) previous.end = timing.end;
      continue;
    }
    const viseme = visemeOf(char);
    if (!viseme) { word++; continue; } // boşluk / noktalama: aşağıda aralığa göre ele alınır
    raw.push({ viseme: viseme === 'KG' ? 'KG?' : viseme, start: timing.start, end: Math.max(timing.end, timing.start), word });
  }
  // KG komşu ünlünün şeklini alır: aynı kelimede önce sonraki, yoksa önceki ünlü.
  const resolved: { viseme: Viseme; start: number; end: number }[] = raw.map((cue, index) => {
    if (cue.viseme !== 'KG?') return { viseme: cue.viseme, start: cue.start, end: cue.end };
    let pick: Viseme = 'KG';
    for (let i = index + 1; i < raw.length && raw[i].word === cue.word; i++) if (VOWELS.has(raw[i].viseme as Viseme)) { pick = raw[i].viseme as Viseme; break; }
    if (pick === 'KG') for (let i = index - 1; i >= 0 && raw[i].word === cue.word; i--) if (VOWELS.has(raw[i].viseme as Viseme)) { pick = raw[i].viseme as Viseme; break; }
    return { viseme: pick, start: cue.start, end: cue.end };
  });
  // Boşluklar: kısa olanı önceki şekil doldurur, uzun olanı SIL olur.
  const filled: typeof resolved = [];
  let cursor = 0;
  for (const cue of resolved) {
    const gap = cue.start - cursor;
    if (gap >= TUNING.longPause || (!filled.length && gap > 0.02)) filled.push({ viseme: 'SIL', start: cursor, end: cue.start });
    else if (gap > 0 && filled.length) filled[filled.length - 1].end = cue.start;
    filled.push({ ...cue, start: Math.max(cue.start, cursor) });
    cursor = Math.max(cursor, cue.end);
  }
  // PBM en az pbmMin sürsün: komşulardan pay al.
  for (let i = 0; i < filled.length; i++) {
    const cue = filled[i];
    if (cue.viseme !== 'PBM') continue;
    let need = TUNING.pbmMin - (cue.end - cue.start);
    const before = filled[i - 1], after = filled[i + 1];
    if (need > 0 && before && before.viseme !== 'PBM') { const take = Math.min(need * .6, Math.max(0, before.end - before.start - .03)); before.end -= take; cue.start -= take; need -= take; }
    if (need > 0 && after && after.viseme !== 'PBM') { const take = Math.min(need, Math.max(0, after.end - after.start - .03)); after.start += take; cue.end += take; }
  }
  // Aynı viseme'leri birleştir, çok kısa olanları komşuya kat (PBM hariç).
  const merged: typeof resolved = [];
  for (const cue of filled) {
    if (cue.end <= cue.start) continue;
    const previous = merged.at(-1);
    if (previous && previous.viseme === cue.viseme) previous.end = cue.end;
    else if (previous && cue.end - cue.start < TUNING.minCue && cue.viseme !== 'PBM' && cue.viseme !== 'SIL') previous.end = cue.end;
    else merged.push({ ...cue });
  }
  // Aynı viseme her tekrarında sıradaki varyantı kullanır.
  const counters = new Map<Viseme, number>();
  return merged.map(cue => {
    const count = counters.get(cue.viseme) ?? 0; counters.set(cue.viseme, count + 1);
    return { ...cue, variant: count % TUNING.variants, vowel: VOWELS.has(cue.viseme) };
  });
}

const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

function indexAt(track: Cue[], time: number) {
  let lo = 0, hi = track.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (track[mid].start <= time) lo = mid; else hi = mid - 1; }
  return lo;
}

/** t anında çizilecek ağız katmanları (ağırlıklar toplamı 1). level: 0..1 anlık ses şiddeti. */
export function sampleTrack(track: Cue[], audioTime: number, level = 1): Layer[] {
  const rest: Layer[] = [{ viseme: 'SIL', variant: 0, weight: 1 }];
  if (!track.length) return rest;
  const time = audioTime + TUNING.anticipation;
  if (time < track[0].start - TUNING.crossfade || time >= track.at(-1)!.end + TUNING.crossfade) return rest;
  const index = indexAt(track, Math.max(time, track[0].start));
  const cue = track[index];
  const sil: Cue = { viseme: 'SIL', start: 0, end: 0, variant: 0, vowel: false };
  const next = track[index + 1] ?? sil;
  const duration = cue.end - cue.start;
  // Geçiş, mevcut viseme'in sonunda yapılır; PBM tam kapalı kalma süresini korur.
  // Yayvan (E/I/SZ) ile yayvan olmayan şekil arasında yanaklar da değişir; bu geçiş daha uzun tutulur.
  const wide = SPREAD.has(cue.viseme) !== SPREAD.has(next.viseme);
  const fade = Math.max(.012, cue.viseme === 'PBM' ? Math.min(TUNING.crossfade, duration - TUNING.pbmHold) : wide ? Math.min(TUNING.crossfadeWide, duration * .75) : Math.min(TUNING.crossfade, duration * .6));
  let mix = time < cue.start ? 0 : smooth((time - (cue.end - fade)) / fade);
  let from: Cue = cue, to: Cue = next;
  if (time < track[0].start) { from = sil; to = cue; mix = smooth(1 - (track[0].start - time) / TUNING.crossfade); }
  const layers = new Map<string, Layer>();
  const add = (source: Cue, weight: number) => {
    if (weight <= 0) return;
    // Sessiz geçen ünlüler REST_OPEN'a yaklaşır; zamanlama hatalarını da maskeler.
    const full = source.vowel ? smooth((level - TUNING.levelLow) / (TUNING.levelHigh - TUNING.levelLow)) : 1;
    for (const [viseme, variant, share] of [[source.viseme, source.variant, full], ['REST_OPEN', 0, 1 - full]] as const) {
      if (share <= 0) continue;
      const key = viseme + variant, existing = layers.get(key);
      if (existing) existing.weight += weight * share; else layers.set(key, { viseme, variant, weight: weight * share });
    }
  };
  add(from, 1 - mix); add(to, mix);
  return [...layers.values()].sort((a, b) => b.weight - a.weight);
}

/** 10 ms'lik RMS zarfı (0..1, sözcenin tepe değerine göre normalize). */
export function loudnessEnvelope(samples: Float32Array, sampleRate: number, hopSeconds = .01) {
  const hop = Math.max(1, Math.round(sampleRate * hopSeconds)), count = Math.ceil(samples.length / hop);
  const rms = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let sum = 0; const from = Math.max(0, i * hop - hop), to = Math.min(samples.length, i * hop + hop);
    for (let j = from; j < to; j++) sum += samples[j] * samples[j];
    rms[i] = Math.sqrt(sum / Math.max(1, to - from));
  }
  const sorted = Float32Array.from(rms).sort();
  const peak = sorted[Math.floor(sorted.length * .95)] || 1e-6;
  for (let i = 0; i < count; i++) rms[i] = Math.min(1, rms[i] / peak);
  return { values: rms, hop: hop / sampleRate };
}

export function levelAt(envelope: { values: Float32Array; hop: number }, time: number) {
  const position = time / envelope.hop, index = Math.floor(position);
  if (index < 0 || index >= envelope.values.length) return 0;
  const a = envelope.values[index], b = envelope.values[Math.min(envelope.values.length - 1, index + 1)];
  return a + (b - a) * (position - index);
}
