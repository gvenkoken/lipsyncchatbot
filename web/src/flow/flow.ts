// Akış panosunun saf veri modeli: düğümler, kenarlar, seçenekler ve ok geometrisi.
// DOM'a bağımlı değildir. Düğümler mutlak konumludur; ileride sürükleme ve yeni şekiller buraya eklenir.
import type { Settings } from '../chat/settings.ts';

export type Mode = Settings['mode'];
export type Role = 'avatar' | 'stt' | 'llm' | 'tts';
export type FlowNode = { id: string; role: Role; title: string; caption: string; x: number; y: number };
export type FlowEdge = { from: string; to: string; label: string };
/** wired: bu seçenek uygulamada gerçekten çalışıyor. mode: seçilince sohbet kutusunun modu değişir.
 *  litellm: sağlayıcıya LiteLLM üzerinden erişilebilir (docs.litellm.ai, 13 Kasım 2026). */
export type FlowOption = { value: string; label: string; detail: string; wired: boolean; mode?: Mode; litellm?: boolean };
export type Choices = Record<Exclude<Role, 'avatar'>, string>;
/** Her avatar türünün kendi zinciri vardır: Custom için ayrı, Synthesia için ayrı seçim tutulur. */
export type ChoiceState = { video: Choices; synthesia: Choices; local: Choices };
/** Uygulamadaki bağlantısı OpenAI Realtime ile kurulu olan avatarlar: zincir seçilebilir ama yalnızca Realtime bağlı. */
const REALTIME_MODES: Mode[] = ['synthesia', 'local'];

export const NODE = { width: 172, height: 86 };
export const BOARD = { width: 1140, height: 190 };
export const GRID = 24;

const Y = 72;
export const NODES: FlowNode[] = [
  { id: 'avatar-in', role: 'avatar', title: 'Avatar (web)', caption: 'Kullanıcı konuşur ya da yazar', x: 48, y: Y },
  { id: 'stt', role: 'stt', title: 'STT', caption: 'Konuşma → metin', x: 264, y: Y },
  { id: 'llm', role: 'llm', title: 'LLM', caption: 'Yanıtı üretir', x: 480, y: Y },
  { id: 'tts', role: 'tts', title: 'TTS', caption: 'Metin → ses', x: 696, y: Y },
  { id: 'avatar-out', role: 'avatar', title: 'Avatar (web)', caption: 'Dudak senkronuyla konuşur', x: 912, y: Y },
];
export const EDGES: FlowEdge[] = [
  { from: 'avatar-in', to: 'stt', label: 'ses' },
  { from: 'stt', to: 'llm', label: 'metin' },
  { from: 'llm', to: 'tts', label: 'yanıt' },
  { from: 'tts', to: 'avatar-out', label: 'ses' },
];

export const OPTIONS: Record<Role, FlowOption[]> = {
  avatar: [
    { value: 'gemini', label: 'Gemini', detail: 'Live · sesten sese', wired: true, mode: 'gemini' },
    { value: 'synthesia', label: 'Synthesia', detail: 'Canlı avatar', wired: true, mode: 'synthesia' },
    { value: 'realtime', label: 'Çizim avatar', detail: 'Tarayıcıda çizilir', wired: true, mode: 'local' },
  ],
  stt: [
    { value: 'openai', label: 'OpenAI', detail: 'gpt-transcribe', wired: true, litellm: true },
    { value: 'google', label: 'Google', detail: 'Speech-to-Text', wired: false, litellm: true },
    { value: 'azure', label: 'Azure', detail: 'Speech', wired: false, litellm: true },
    { value: 'elevenlabs', label: 'ElevenLabs', detail: 'Scribe v2 Realtime', wired: false, litellm: true },
    { value: 'deepgram', label: 'Deepgram', detail: 'Nova', wired: false, litellm: true },
  ],
  llm: [
    { value: 'openai', label: 'OpenAI', detail: 'gpt-5.4-mini', wired: true, litellm: true },
    { value: 'gemini', label: 'Gemini', detail: 'Google', wired: false, litellm: true },
    { value: 'azure', label: 'Azure OpenAI', detail: 'Microsoft', wired: false, litellm: true },
  ],
  tts: [
    { value: 'openai', label: 'OpenAI', detail: 'gpt-4o-mini-tts', wired: true, litellm: true },
    { value: 'elevenlabs', label: 'ElevenLabs', detail: 'Flash', wired: false, litellm: true },
    { value: 'azure', label: 'Azure', detail: 'Neural TTS', wired: false, litellm: true },
    { value: 'google', label: 'Google', detail: 'Chirp', wired: false, litellm: true },
  ],
};

export const DEFAULT_CHOICES: Choices = { stt: 'openai', llm: 'openai', tts: 'openai' };
/** Synthesia bağlantısı uygulamada OpenAI Realtime (sesten sese) ile kurulu: üç adım tek serviste. */
export const REALTIME = 'realtime';
export const REALTIME_OPTION: FlowOption = { value: REALTIME, label: 'OpenAI Realtime', detail: 'Sesten sese', wired: true, litellm: true };
export const DEFAULT_STATE: ChoiceState = { video: DEFAULT_CHOICES, synthesia: { stt: REALTIME, llm: REALTIME, tts: REALTIME }, local: { stt: REALTIME, llm: REALTIME, tts: REALTIME } };
export const CHOICES_KEY = 'pmi-flow.choices.v2';

/** Bu avatar türünde bir adım için seçilebilecekler. Realtime, Synthesia ve Çizim avatar zincirinde sunulur. */
export const optionsFor = (role: Role, mode: Mode): FlowOption[] => role !== 'avatar' && REALTIME_MODES.includes(mode) ? [REALTIME_OPTION, ...OPTIONS[role]] : OPTIONS[role];
const stateKey = (mode: Mode): keyof ChoiceState => mode === 'synthesia' ? 'synthesia' : mode === 'local' ? 'local' : 'video';
export const choicesFor = (mode: Mode, state: ChoiceState): Choices => state[stateKey(mode)];

/** Seçimi uygular. Realtime üç adımı birlikte kapsar: biri seçilince hepsi Realtime olur,
 *  biri başka sağlayıcıya geçince Realtime'da kalan diğerleri OpenAI'ye döner. */
export function applyChoice(state: ChoiceState, mode: Mode, role: Exclude<Role, 'avatar'>, value: string): ChoiceState {
  if (isIntegrated(mode) || !optionsFor(role, mode).some(option => option.value === value)) return state;
  const key = stateKey(mode);
  let next: Choices = { ...state[key], [role]: value };
  if (value === REALTIME) next = { stt: REALTIME, llm: REALTIME, tts: REALTIME };
  else for (const other of ['stt', 'llm', 'tts'] as const) if (next[other] === REALTIME) next[other] = 'openai';
  return { ...state, [key]: next };
}

/** Sayfadaki seçim uygulamada gerçekten çalışıyor mu? Çalışmıyorsa sohbet açılmaz. */
export function chatReady(mode: Mode, state: ChoiceState): boolean {
  if (isIntegrated(mode)) return true;
  const choices = choicesFor(mode, state);
  return (['stt', 'llm', 'tts'] as const).every(role => selection(role, mode, choices).option.wired);
}

export function parseState(raw: string | null): ChoiceState {
  const result: ChoiceState = { video: { ...DEFAULT_STATE.video }, synthesia: { ...DEFAULT_STATE.synthesia }, local: { ...DEFAULT_STATE.local } };
  try {
    const value = JSON.parse(raw ?? 'null') as Record<string, Record<string, unknown>> | null;
    for (const key of ['video', 'synthesia', 'local'] as const) {
      const saved = value?.[key];
      if (!saved || typeof saved !== 'object') continue;
      for (const role of ['stt', 'llm', 'tts'] as const) if (optionsFor(role, key).some(option => option.value === saved[role])) result[key][role] = saved[role] as string;
      // Realtime yarım kalamaz: üçü birden değilse varsayılana dön.
      const count = (['stt', 'llm', 'tts'] as const).filter(role => result[key][role] === REALTIME).length;
      if (count !== 0 && count !== 3) result[key] = { ...DEFAULT_STATE[key] };
    }
  } catch { /* bozuk kayıt: varsayılan */ }
  return result;
}

/** Video (Custom) avatar panodan kaldırıldı; kodu duruyor ve yalnızca kayıtlı ayarla açılabilir (testler bunu kullanır). */
export const CUSTOM_OPTION: FlowOption = { value: 'custom', label: 'Custom', detail: 'Video avatar', wired: true, mode: 'video' };
export const avatarOption = (mode: Mode) => mode === 'video' ? CUSTOM_OPTION : OPTIONS.avatar.find(option => option.mode === mode) ?? OPTIONS.avatar[0];

/** Gemini Live sesten sese çalışır ve avatarla aynı servistir: STT, LLM ve TTS ayrı seçilemez.
 *  Custom, Synthesia ve Çizim avatar yalnızca avatarı çizer; STT, LLM ve TTS ayrı ayrı seçilir. */
export const isIntegrated = (mode: Mode) => mode === 'gemini';

/** Seçenek bu avatarla uygulamada gerçekten çalışıyor mu? Custom zincirinde yalnızca OpenAI,
 *  Synthesia ve Çizim avatar zincirinde yalnızca OpenAI Realtime bağlı. */
export const isWired = (role: Role, option: FlowOption, mode: Mode) => role === 'avatar' ? option.wired : REALTIME_MODES.includes(mode) ? option.value === REALTIME : option.wired;

/** Düğümde gösterilecek seçim. locked: avatar servisine dahil olduğu için değiştirilemez. */
export function selection(role: Role, mode: Mode, choices: Choices): { option: FlowOption; locked: boolean } {
  const avatar = avatarOption(mode);
  if (role === 'avatar') return { option: avatar, locked: false };
  // Sesten sese modlarda üç adımı tek bir ses modeli yapar; kutu o modeli gösterir (avatarın adını değil).
  if (isIntegrated(mode)) return { option: { value: avatar.value, label: 'Gemini Live', detail: 'Sesten sese · tek model', wired: true }, locked: true };
  const options = optionsFor(role, mode), option = options.find(item => item.value === choices[role]) ?? options[0];
  return { option: { ...option, wired: isWired(role, option, mode) }, locked: false };
}

/** İki düğüm arasında, sağ kenardan sol kenara yumuşak ok yolu (SVG path) ve etiket noktası. */
export function edgePath(from: FlowNode, to: FlowNode) {
  const x1 = from.x + NODE.width, y1 = from.y + NODE.height / 2, x2 = to.x, y2 = to.y + NODE.height / 2;
  const bend = Math.max(18, Math.abs(x2 - x1) / 2);
  return { d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, labelX: (x1 + x2) / 2, labelY: (y1 + y2) / 2 };
}


/** Menüde gösterim: LiteLLM üzerinden erişilebilenler tek grupta, diğerleri ayrı. Sıra korunur. */
export function menuGroups(role: Role, mode: Mode): { litellm: boolean; options: FlowOption[] }[] {
  const all = optionsFor(role, mode), inside = all.filter(option => option.litellm), outside = all.filter(option => !option.litellm);
  return [{ litellm: true, options: inside }, { litellm: false, options: outside }].filter(group => group.options.length);
}
