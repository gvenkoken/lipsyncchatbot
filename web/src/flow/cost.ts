// Akış panosundaki seçimlere göre tahmini aylık maliyet. Saf hesap; DOM'a bağımlı değildir.
// Fiyatlar liste fiyatıdır (USD, vergi ve hacim indirimi hariç), 13 Kasım 2026'da derlendi.
// verified: sağlayıcının kendi fiyat sayfasından okundu. false: üçüncü taraf kaynak ya da varsayım.
import { REALTIME as REALTIME_VALUE, isIntegrated, optionsFor, type Choices, type Mode, type Role } from './flow.ts';

export const PRICES_AS_OF = '13 Kasım 2026';
export const MINUTE_OPTIONS = [10, 30, 60, 120] as const;   // kullanıcı başına aylık konuşma dakikası
export const USER_OPTIONS = [1000, 5000, 10000, 50000] as const;
export type Usage = { minutes: number; users: number };
export const DEFAULT_USAGE: Usage = { minutes: 30, users: 1000 };
export const USAGE_KEY = 'pmi-flow.usage.v1';

/** Bir konuşma dakikasının içeriği. Tüm kalemler bu varsayımlardan türetilir. */
export const ASSUMPTIONS = {
  listenShare: .4,        // dakikanın bu kadarında kullanıcı konuşur (STT'ye giden ses)
  speakShare: .5,         // dakikanın bu kadarında avatar konuşur (TTS'ten çıkan ses)
  turnsPerMinute: 3,      // dakikadaki soru-yanıt sayısı
  inputTokensPerTurn: 1200, // persona + geçmiş + soru
  outputTokensPerTurn: 60,  // 1–3 cümlelik yanıt
  charsPerSpokenMinute: 850, // Türkçe konuşmada dakikadaki karakter
  realtimeContext: 1.5,   // Realtime: geçmiş ses her turda yeniden faturalanır
};

type Rate = { perMinute: number; basis: string; verified: boolean };
const A = ASSUMPTIONS;
const perListen = (usdPerAudioMinute: number) => usdPerAudioMinute * A.listenShare;
const perSpeak = (usdPerAudioMinute: number) => usdPerAudioMinute * A.speakShare;
const perChars = (usdPerMillion: number) => usdPerMillion / 1e6 * A.charsPerSpokenMinute * A.speakShare;
const perTokens = (inputPerMillion: number, outputPerMillion: number) => A.turnsPerMinute * (A.inputTokensPerTurn * inputPerMillion + A.outputTokensPerTurn * outputPerMillion) / 1e6;
// OpenAI Realtime: ses girişi 600 token/dk, ses çıkışı 1200 token/dk; gpt-realtime-2.1 $32 / $64 (1M ses tokenı).
const REALTIME = (perListen(600 * 32 / 1e6) + perSpeak(1200 * 64 / 1e6)) * A.realtimeContext;

export const RATES: Record<Exclude<Role, 'avatar'>, Record<string, Rate>> = {
  stt: {
    openai: { perMinute: perListen(.0045), basis: 'gpt-transcribe: $0,0045 / ses dk', verified: true },
    google: { perMinute: perListen(.016), basis: 'Speech-to-Text V2: $0,016 / ses dk', verified: true },
    azure: { perMinute: perListen(1 / 60), basis: 'Gerçek zamanlı: $1 / ses saati', verified: false },
    elevenlabs: { perMinute: perListen(.39 / 60), basis: 'Scribe v2 Realtime: $0,39 / ses saati', verified: true },
    deepgram: { perMinute: perListen(.0077), basis: 'Nova-3 akış: $0,0077 / ses dk', verified: false },
  },
  llm: {
    openai: { perMinute: perTokens(.75, 4.5), basis: 'gpt-5.4-mini: $0,75 giriş / $4,50 çıkış (1M token)', verified: true },
    gemini: { perMinute: perTokens(.75, 3.75), basis: 'Gemini 3.8 Flash: $0,75 / $3,75 (1M token); 1 Ocak 2027\'den sonra iki katı', verified: true },
    azure: { perMinute: perTokens(.75, 4.5), basis: 'OpenAI liste fiyatıyla aynı varsayıldı', verified: false },
  },
  tts: {
    openai: { perMinute: perSpeak(.015), basis: 'gpt-4o-mini-tts: yaklaşık $0,015 / ses dk ($12 / 1M ses tokenı)', verified: false },
    elevenlabs: { perMinute: perChars(50), basis: 'Flash v2.5: $50 / 1M karakter', verified: false },
    azure: { perMinute: perChars(15), basis: 'Neural: $15 / 1M karakter', verified: false },
    google: { perMinute: perChars(30), basis: 'Chirp 3 HD: $30 / 1M karakter', verified: true },
  },
};

/** Avatar servisine ait kalemler. Custom avatar tarayıcıda çizilir, servis ücreti yoktur.
 *  Synthesia yalnızca avatarı yayınlar; STT, LLM ve TTS seçilen sağlayıcılardan ayrıca eklenir. */
const REALTIME_RATE: Rate = { perMinute: REALTIME, basis: 'gpt-realtime-2.1: $32 giriş / $64 çıkış (1M ses tokenı); STT, LLM ve TTS tek serviste', verified: true };

export const AVATAR_RATES: Record<Mode, { label: string; rate: Rate }[]> = {
  video: [{ label: 'Avatar', rate: { perMinute: 0, basis: 'Tarayıcıda çizilir; servis ücreti yok', verified: true } }],
  synthesia: [
    { label: 'Synthesia', rate: { perMinute: .1, basis: 'Interactive Avatar API: $0,10 / konuşma dk (yalnızca avatar; STT, LLM, TTS ayrı)', verified: true } },
  ],
  // Avatar görüntüsü ayrı faturalanır ve asıl kalemdir: $1 / 1M video tokenı, konuşurken 6.192 token/sn
  // (yaklaşık $0,37 / konuşma dk). Rakam üçüncü taraf kaynaklardan; Google Cloud fiyat sayfasına dayandırılıyor.
  gemini: [
    { label: 'Gemini Live (ses)', rate: { perMinute: perListen(.005) + perSpeak(.018), basis: 'Gemini 3.8 Live: $0,005 giriş / $0,018 çıkış (ses dk)', verified: true } },
    { label: 'Gemini avatar görüntüsü', rate: { perMinute: perSpeak(6192 * 60 / 1e6), basis: 'Video çıkışı: $1 / 1M token, 6.192 token/sn; yalnızca avatar konuşurken', verified: false } },
  ],
  local: [{ label: 'Avatar', rate: { perMinute: 0, basis: 'Tarayıcıda çizilir; servis ücreti yok', verified: true } }],
};

export type CostPart = { key: string; role: Role; label: string; perMinute: number; monthly: number; basis: string; verified: boolean };
export type Estimate = { parts: CostPart[]; totalMinutes: number; perMinute: number; perUser: number; monthly: number; verified: boolean };

export function parseUsage(raw: string | null): Usage {
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<Usage> | null;
    return { minutes: MINUTE_OPTIONS.find(option => option === value?.minutes) ?? DEFAULT_USAGE.minutes, users: USER_OPTIONS.find(option => option === value?.users) ?? DEFAULT_USAGE.users };
  } catch { return { ...DEFAULT_USAGE }; }
}

/** Seçili akışın aylık maliyeti: kullanıcı × kişi başı dakika × (kalemlerin dakika ücreti toplamı). */
export function estimate(mode: Mode, choices: Choices, usage: Usage): Estimate {
  const totalMinutes = usage.minutes * usage.users;
  const rows: { key: string; role: Role; label: string; rate: Rate }[] = AVATAR_RATES[mode].map((item, index) => ({ key: `avatar-${index}`, role: 'avatar', label: item.label, rate: item.rate }));
  if (!isIntegrated(mode) && choices.llm === REALTIME_VALUE) rows.push({ key: 'realtime', role: 'llm', label: 'OpenAI Realtime', rate: REALTIME_RATE });
  else if (!isIntegrated(mode)) for (const role of ['stt', 'llm', 'tts'] as const) {
    const options = optionsFor(role, mode), option = options.find(item => item.value === choices[role] && item.value !== REALTIME_VALUE) ?? options.find(item => item.value !== REALTIME_VALUE)!;
    rows.push({ key: role, role, label: `${role.toUpperCase()} · ${option.label}`, rate: RATES[role][option.value] });
  }
  const parts = rows.map(row => ({ key: row.key, role: row.role, label: row.label, perMinute: row.rate.perMinute, monthly: row.rate.perMinute * totalMinutes, basis: row.rate.basis, verified: row.rate.verified }));
  const perMinute = parts.reduce((sum, part) => sum + part.perMinute, 0);
  return { parts, totalMinutes, perMinute, perUser: perMinute * usage.minutes, monthly: perMinute * totalMinutes, verified: parts.every(part => part.verified) };
}

const money = (digits: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
/** 1 doların üstü her zaman iki ondalıkla yazılır ($76.860,00): nokta binlik, virgül ondalık olduğu karışmasın. */
export const formatUsd = (value: number) => value === 0 ? '$0' : money(value >= 1 ? 2 : value >= .01 ? 3 : 4).format(value);
export const formatCount = (value: number) => value >= 1000 ? `${value / 1000}k` : String(value);
