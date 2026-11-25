// Kıyaslama panellerinin saf verisi: token tüketimi, gecikme ve toplam fiyat. DOM'a bağımlı değildir.
// Token ve fiyat cost.ts'teki varsayımlardan türetilir; gecikme bu projede yapılan ölçümlerden gelir
// (ölçülmeyen değerler açıkça "ölçülmedi" olarak işaretlenir, tahmin yazılmaz).
import { DEFAULT_CHOICES, DEFAULT_STATE, type Choices, type Mode, type Role } from './flow.ts';
import { ASSUMPTIONS, estimate, formatUsd, type Usage } from './cost.ts';

export type Metric = 'tokens' | 'latency' | 'price';
export const METRICS: { value: Metric; title: string; hint: string; unit: string }[] = [
  { value: 'tokens', title: 'Token tüketimi', hint: 'Bir konuşma dakikasında harcanan token', unit: 'token / konuşma dk' },
  { value: 'latency', title: 'Gecikme', hint: 'Soru bittikten ilk yanıt sesine kadar: internette yayımlanan tipik süre ve bizim ölçümümüz', unit: 'ilk yanıt sesi' },
  { value: 'price', title: 'Toplam fiyat', hint: 'Seçilen dakika ve kullanıcı sayısına göre aylık tutar', unit: 'aylık' },
];

/** Kıyaslanan birim: bir avatar ve onu konuşturan model(ler). */
export type Candidate = { id: string; label: string; models: string; role: Role; mode: Mode; choices: Choices; realtime: boolean };
export const CANDIDATES: Candidate[] = [
  { id: 'gemini-live', label: 'Gemini Live', models: 'Gemini 3.8 Live · ses + avatar görüntüsü', role: 'avatar', mode: 'gemini', choices: DEFAULT_CHOICES, realtime: true },
  { id: 'synthesia-realtime', label: 'Synthesia + OpenAI Realtime', models: 'gpt-realtime-2.1 · sesten sese', role: 'llm', mode: 'synthesia', choices: DEFAULT_STATE.synthesia, realtime: true },
  { id: 'synthesia-openai', label: 'Synthesia + OpenAI zinciri', models: 'gpt-transcribe → gpt-5.4-mini → gpt-4o-mini-tts', role: 'stt', mode: 'synthesia', choices: DEFAULT_CHOICES, realtime: false },
  { id: 'drawn-realtime', label: 'Çizim avatar + OpenAI Realtime', models: 'gpt-realtime-2.1 · sesten sese', role: 'llm', mode: 'local', choices: DEFAULT_STATE.local, realtime: true },
  { id: 'drawn-openai', label: 'Çizim avatar + OpenAI zinciri', models: 'gpt-transcribe → gpt-5.4-mini → gpt-4o-mini-tts', role: 'tts', mode: 'local', choices: DEFAULT_CHOICES, realtime: false },
];
export const MIN_COMPARE = 2;
export const DEFAULT_COMPARE = ['gemini-live', 'synthesia-realtime', 'drawn-realtime'];
export const COMPARE_KEY = 'pmi-flow.compare.v1';

export function parseCompare(raw: string | null): string[] {
  try {
    const value = JSON.parse(raw ?? 'null') as unknown;
    return Array.isArray(value) ? CANDIDATES.map(candidate => candidate.id).filter(id => value.includes(id)) : [...DEFAULT_COMPARE];
  } catch { return [...DEFAULT_COMPARE]; }
}
/** Adayı ekler ya da çıkarır; her aday çıkarılabilir. Sıra aday listesindeki sıradır. */
export function toggleCompare(selected: string[], id: string): string[] {
  if (!CANDIDATES.some(candidate => candidate.id === id)) return selected;
  const next = selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id];
  return CANDIDATES.map(candidate => candidate.id).filter(item => next.includes(item));
}

// ---------- token ----------
const A = ASSUMPTIONS;
export type TokenPart = { label: string; tokens: number };
/** Bir konuşma dakikasındaki token kalemleri (cost.ts varsayımlarıyla). */
export function tokenParts(candidate: Candidate): TokenPart[] {
  if (candidate.mode === 'gemini') return [
    { label: 'Avatar görüntüsü', tokens: A.speakShare * 6192 * 60 },           // 6.192 token/sn, yalnızca konuşurken
    { label: 'Ses çıkışı', tokens: A.speakShare * (.018 / 12e-6) },             // $0,018/dk ÷ $12/1M
    { label: 'Ses girişi', tokens: A.listenShare * (.005 / 3e-6) },             // $0,005/dk ÷ $3/1M
  ];
  if (candidate.realtime) return [
    { label: 'Ses çıkışı', tokens: A.speakShare * 1200 * A.realtimeContext },   // 1 token / 50 ms
    { label: 'Ses girişi', tokens: A.listenShare * 600 * A.realtimeContext },   // 1 token / 100 ms
  ];
  return [
    { label: 'LLM girişi', tokens: A.turnsPerMinute * A.inputTokensPerTurn },
    { label: 'TTS ses çıkışı', tokens: A.speakShare * (.015 / 12e-6) },         // ~$0,015/dk ÷ $12/1M
    { label: 'LLM çıkışı', tokens: A.turnsPerMinute * A.outputTokensPerTurn },
  ];
}
export const tokenTotal = (candidate: Candidate) => tokenParts(candidate).reduce((sum, part) => sum + part.tokens, 0);

// ---------- gecikme ----------
/** Saniye; soru bittikten ilk yanıt sesine kadar.
 *  published: internette yayımlanan tipik aralık (bizim ölçümümüz değil; kaynaklar farklı koşullarda ölçmüş).
 *  measured: bu projede ölçülen değer; null ise ölçülmedi ve unmeasured nedenini söyler.
 *  ready: sayfa açılışından avatarın hazır olmasına (bizim ölçüm). */
export type Latency = { published: [number, number]; publishedNote: string; measured: number | null; measuredNote: string; unmeasured: string; ready: [number, number] | null; readyNote: string };
// Yayımlanan değerler (Kasım 2026'da derlendi):
//  - gpt-realtime: ilk ses ortancası ~1,0 sn (Speko S2S); diğer testlerde 0,7–1,5 sn (Weekend, Smallest AI).
//  - Gemini Live: 1,6 sn (Smallest AI, Speko) ile 3,0 sn (Artificial Analysis, Softcery üzerinden) arası.
//  - STT -> LLM -> TTS zinciri: 1,1 sn hedef (Twilio) ile 1,4 sn gerçek ortanca (Hugging Face testi) arası.
//  - Avatar görüntüsü için Synthesia ya da Gemini'ye özel yayımlanmış süre bulunamadı; genel olarak 0,05–0,2 sn eklediği yazıyor (Agora).
const REALTIME_PUBLISHED: [number, number] = [.7, 1.5], CHAIN_PUBLISHED: [number, number] = [1.1, 1.4];
export const LATENCY: Record<string, Latency> = {
  'gemini-live': { published: [1.6, 3], publishedNote: 'Yalnızca ses modeli; avatar görüntüsü için kaynak yok', measured: null, measuredNote: '', unmeasured: 'Ölçüm denendi ama güvenilir sonuç alınamadı: durum göstergesi yanıt gelmeden değişiyor (0,06 sn gibi imkânsız değerler).', ready: [5.8, 9.1], readyNote: '3 ölçüm' },
  'synthesia-realtime': { published: REALTIME_PUBLISHED, publishedNote: 'Yalnızca ses modeli; Synthesia görüntüsü için kaynak yok', measured: null, measuredNote: '', unmeasured: 'Ölçülemedi: test oturumları "Synthesia bağlantısı sona erdi" hatasıyla düştü.', ready: [8.5, 26.2], readyNote: '3 ölçüm' },
  'synthesia-openai': { published: CHAIN_PUBLISHED, publishedNote: 'Yalnızca zincir; Synthesia görüntüsü için kaynak yok', measured: null, measuredNote: '', unmeasured: 'Ölçülemez: bu birleşim uygulamada henüz bağlı değil.', ready: [8.5, 26.2], readyNote: 'avatar oturumu' },
  'drawn-realtime': { published: REALTIME_PUBLISHED, publishedNote: 'gpt-realtime için yayımlanan testler', measured: .89, measuredNote: 'Yazılı soru, 3 denemenin ortancası', unmeasured: '', ready: null, readyNote: 'mikrofona basınca bağlanır' },
  'drawn-openai': { published: CHAIN_PUBLISHED, publishedNote: 'Zincir için yayımlanan hedef ve testler', measured: 5.8, measuredNote: 'Zincir ölçümü (video avatarla), 3 denemenin ortancası', unmeasured: '', ready: [0, 0], readyNote: 'oturum gerekmez' },
};

// ---------- artılar / eksiler ----------
export type Notes = { pros: string[]; cons: string[] };
export const NOTES: Record<Metric, Record<string, Notes>> = {
  tokens: {
    'gemini-live': { pros: ['Ses tokenı az: saniyede yaklaşık 25', 'Avatar dinlerken görüntü tokenı harcanmaz'], cons: ['Görüntü saniyede 6.192 token üretir; toplamın neredeyse tamamı', 'Avatar ne kadar çok konuşursa tüketim o kadar artar'] },
    'synthesia-realtime': { pros: ['Avatar token harcamaz, dakika ile faturalanır', 'Tek model: ayrı STT ve TTS tokenı yok'], cons: ['Geçmiş ses her turda yeniden sayılır', 'Uzun konuşmada tüketim dakikadan hızlı büyür'] },
    'synthesia-openai': { pros: ['Avatar token harcamaz', 'Geçmiş metin olarak tutulur; ses tokenı birikmez'], cons: ['Her yanıtta persona ve geçmiş yeniden gönderilir', 'STT dakika ile faturalanır; token olarak izlenemez'] },
    'drawn-realtime': { pros: ['Avatar tarayıcıda çizilir; token harcamaz', 'Tek model: ayrı STT ve TTS tokenı yok'], cons: ['Geçmiş ses her turda yeniden sayılır', 'Ses tokenı metin tokenından çok daha pahalı'] },
    'drawn-openai': { pros: ['Avatar tarayıcıda çizilir; token harcamaz', 'Tüketimin çoğu ucuz metin tokenı'], cons: ['Her yanıtta persona ve geçmiş yeniden gönderilir', 'Üç ayrı modelin tüketimi ayrı izlenir'] },
  },
  latency: {
    'gemini-live': { pros: ['Sesten sese: arada STT ve TTS beklemesi yok', 'Ölçülen en kısa hazırlanma: 6–9 sn'], cons: ['Görüntü yalnızca yanıt sırasında gelir', 'Oturum 9 dakikada bir yeniden kurulur'] },
    'synthesia-realtime': { pros: ['Sesten sese yanıt; söz kesme desteklenir', 'Avatar boştayken de canlı görüntü verir'], cons: ['Hazırlanma en uzun ve en değişken: 8–26 sn', 'Ses, avatar görüntüsü üretilene kadar bekler'] },
    'synthesia-openai': { pros: ['Yanıt cümle cümle seslendirilebilir', 'Her adım ayrı ölçülüp iyileştirilebilir'], cons: ['Üç adım art arda bekler', 'Üstüne avatar görüntüsü gecikmesi eklenir'] },
    'drawn-realtime': { pros: ['Ölçülen en hızlı yanıt: 0,9 sn', 'Görüntü tarayıcıda: avatar gecikmesi yok'], cons: ['Oturum mikrofona basınca kurulur', 'Sesli soruda konuşmanın bitişini bekleme eklenir'] },
    'drawn-openai': { pros: ['Oturum hazırlığı yok; hemen kullanılır', 'İlk metin 1,7 sn\'de gelir'], cons: ['Ölçümümüz yayımlanan sürenin 4 katı: cümle bitmeden seslendirme başlamıyor', 'Konuşma sıra tabanlı; söz kesme yok'] },
  },
  price: {
    'gemini-live': { pros: ['Ses ucuz: dakikası yaklaşık 1 sent', 'Tek servis, tek fatura'], cons: ['Avatar görüntüsü konuşma dakikası başına ~$0,37', 'Görüntü fiyatı Google sayfasından doğrulanmadı'] },
    'synthesia-realtime': { pros: ['Avatar ücreti sabit ve öngörülebilir: $0,10/dk', 'Fiyatlar resmi sayfalardan doğrulandı'], cons: ['Avatar, konuşulmasa da oturum süresince faturalanır', 'Üstüne ses modeli ücreti eklenir'] },
    'synthesia-openai': { pros: ['Ses tarafı Realtime\'dan yaklaşık 5 kat ucuz', 'Model değiştirerek maliyet düşürülebilir'], cons: ['Avatar ücreti toplamın büyük kısmı olur', 'Henüz bağlı değil; geliştirme maliyeti var'] },
    'drawn-realtime': { pros: ['Avatar ücreti yok', 'Canlı seçenekler içinde en ucuzu'], cons: ['Ses tokenı pahalı: $32 giriş / $64 çıkış', 'Uzun konuşmada geçmiş ses yeniden faturalanır'] },
    'drawn-openai': { pros: ['En ucuz seçenek: dakikası yaklaşık 1,3 sent', 'Yalnızca kullanım kadar ücret; açık oturum yok'], cons: ['Henüz bağlı değil; geliştirme maliyeti var', 'TTS dakika ücreti tahmini'] },
  },
};

// ---------- kart özeti ----------
const tr = (value: number, digits = 0) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
export const formatTokens = (tokens: number) => tokens >= 10000 ? `${tr(tokens / 1000)} bin` : tr(Math.round(tokens));
export const formatSeconds = (seconds: number) => `${tr(seconds, 1)} sn`;

/** Kartın alt bölümü. values: aynı hizada gösterilen değerler; tip: üzerine gelince açılan açıklama.
 *  score: küçük olan daha iyi. */
export type Tip = { title: string; lines: string[] };
export type SummaryValue = { label: string; value: string; tip?: Tip; missing?: boolean };
export type Summary = { values: SummaryValue[]; detail: string[]; score: number | null };
const range = (pair: [number, number]) => pair[0] === pair[1] ? formatSeconds(pair[0]) : `${tr(pair[0], 1)}–${tr(pair[1], 1)} sn`;
export function summarize(metric: Metric, candidate: Candidate, usage: Usage): Summary {
  if (metric === 'tokens') {
    const total = tokenTotal(candidate);
    return { values: [{ label: 'token / konuşma dk', value: formatTokens(total) }], detail: tokenParts(candidate).map(part => `${part.label}: ${formatTokens(part.tokens)}`), score: total };
  }
  if (metric === 'latency') {
    // "Ortalama süre": yayımlanan aralığın ortası. Aralığın kendisi ve kaynak notu tooltip'te.
    const latency = LATENCY[candidate.id], mid = (latency.published[0] + latency.published[1]) / 2;
    const ready = !latency.ready || latency.ready[1] === 0 ? latency.readyNote : `${range(latency.ready)} (${latency.readyNote})`;
    return {
      values: [
        { label: 'Ortalama süre', value: formatSeconds(mid), tip: { title: 'İnternette yayımlanan süre', lines: [`Aralık: ${range(latency.published)}; gösterilen değer aralığın ortası.`, `${latency.publishedNote}.`, 'Bizim ölçümümüz değil.'] } },
        latency.measured === null
          ? { label: 'Ölçüm', value: '–', missing: true, tip: { title: 'Ölçülmedi', lines: [latency.unmeasured, `Avatarın hazırlanması: ${ready}`] } }
          : { label: 'Ölçüm', value: formatSeconds(latency.measured), tip: { title: 'Bizim ölçümümüz', lines: [`${latency.measuredNote}.`, `Avatarın hazırlanması: ${ready}`] } },
      ],
      detail: [], score: mid,
    };
  }
  const cost = estimate(candidate.mode, candidate.choices, usage);
  return { values: [{ label: 'aylık', value: formatUsd(cost.monthly) }], detail: [`${formatUsd(cost.perMinute)} / konuşma dk`, `${formatUsd(cost.perUser)} / kullanıcı`, ...(cost.verified ? [] : ['Bazı fiyatlar doğrulanmadı'])], score: cost.monthly };
}
/** En iyi (en düşük) değere sahip adaylar; kıyaslanabilir en az iki değer yoksa boş. */
export function best(metric: Metric, ids: string[], usage: Usage): string[] {
  const scored = CANDIDATES.filter(candidate => ids.includes(candidate.id)).map(candidate => ({ id: candidate.id, score: summarize(metric, candidate, usage).score })).filter(item => item.score !== null) as { id: string; score: number }[];
  if (scored.length < 2) return [];
  const min = Math.min(...scored.map(item => item.score));
  return scored.filter(item => item.score === min).map(item => item.id);
}
