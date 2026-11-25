// Video avatar akışı: mesaj -> LLM (akış) -> cümle cümle TTS -> hizalama -> avatar.
import type { AvatarPlayer } from '../video-avatar/player.ts';
import { EnergyAlignProvider, type TimingProvider } from '../video-avatar/timing.ts';

export type AssistantStatus = { chat: boolean; tts: boolean; stt: boolean; model: string; voice: string; sampleRate: number };
export type AssistantMessage = { id: string; role: 'user' | 'assistant'; text: string; append?: boolean };
/** Gecikme ölçümü (ms, mesaj gönderiminden itibaren). */
export type TurnMetrics = { model: string; firstToken?: number; firstSentence?: number; ttsDone?: number; mouthStart?: number; done?: number; sentences: number };
type Callbacks = {
  onMessage: (message: AssistantMessage) => void;
  onBusy: (busy: boolean) => void;            // LLM yanıtı bekleniyor / üretiliyor
  onError: (message: string) => void;
  onMetrics?: (metrics: TurnMetrics) => void;
};

export const DEMO_REPLY = 'Merhaba, size nasıl yardımcı olabilirim?';
const DEMO_AUDIO = '/viseme-rig/demo.wav';

/** Akan metni seslendirilecek cümlelere böler. Çok kısa parçalar sonrakine eklenir. */
export class SentenceSplitter {
  private buffer = '';
  private minChars: number;
  constructor(minChars = 14) { this.minChars = minChars; }
  push(text: string): string[] {
    this.buffer += text;
    const out: string[] = [];
    for (;;) {
      // Cümle sonu: . ! ? … ardından boşluk. Ondalık sayı ("3.5") ve kısaltma içi noktalar boşluk olmadığı için bölünmez.
      const match = /[.!?…]+["')\]]?\s+/.exec(this.buffer.slice(this.minChars));
      if (!match) break;
      const end = this.minChars + match.index + match[0].length;
      out.push(this.buffer.slice(0, end).trim()); this.buffer = this.buffer.slice(end);
    }
    return out.filter(Boolean);
  }
  flush(): string[] { const rest = this.buffer.trim(); this.buffer = ''; return rest ? [rest] : []; }
}

/** Seslendirilmeyecek biçimlendirmeyi ayıklar (model yine de üretirse). */
export const speakable = (text: string) => text.replace(/```[\s\S]*?```/g, ' ').replace(/[*_#`>|]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();

export function pcmToBuffer(context: BaseAudioContext, bytes: ArrayBuffer, sampleRate: number) {
  const samples = new Int16Array(bytes, 0, bytes.byteLength >> 1), buffer = context.createBuffer(1, Math.max(1, samples.length), sampleRate), channel = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
  return buffer;
}

export class AvatarConversation {
  private callbacks: Callbacks;
  private timing: TimingProvider;
  private generation = 0;
  private controller?: AbortController;
  private statusPromise?: Promise<AssistantStatus>;
  private history: { role: 'user' | 'assistant'; text: string }[] = [];
  private next = 0;
  player?: AvatarPlayer;
  voice = true;

  constructor(callbacks: Callbacks, timing: TimingProvider = new EnergyAlignProvider()) { this.callbacks = callbacks; this.timing = timing; }

  status(refresh = false) {
    if (!this.statusPromise || refresh) this.statusPromise = fetch('/api/avatar/status').then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<AssistantStatus>; })
      .catch(() => ({ chat: false, tts: false, stt: false, model: '', voice: '', sampleRate: 24000 }));
    return this.statusPromise;
  }

  /** Söz kesme: üretimi, kuyruktaki sesleri ve çalan sesi durdurur. */
  interrupt() { this.generation++; this.controller?.abort(); this.controller = undefined; this.player?.stop(); this.callbacks.onBusy(false); }
  get active() { return !!this.controller || !!this.player?.speaking; }
  reset() { this.interrupt(); this.history = []; }

  async transcribe(audio: Blob): Promise<string> {
    const response = await fetch('/api/avatar/stt', { method: 'POST', headers: { 'Content-Type': audio.type || 'audio/webm' }, body: audio });
    const body = await response.json().catch(() => ({})) as { text?: string; error?: string };
    if (!response.ok) throw new Error(body.error ?? 'Ses yazıya çevrilemedi.');
    return body.text ?? '';
  }

  private async speech(text: string, signal: AbortSignal, sampleRate: number) {
    const context = await this.player!.prepareAudio();
    const response = await fetch('/api/avatar/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal });
    if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? 'Seslendirme alınamadı.');
    const buffer = pcmToBuffer(context, await response.arrayBuffer(), Number(response.headers.get('X-Sample-Rate')) || sampleRate);
    return { buffer, timings: await this.timing.getTimings({ buffer, text }) };
  }

  async send(text: string) {
    this.interrupt();
    const generation = this.generation, controller = new AbortController(); this.controller = controller;
    const started = performance.now(), since = () => Math.round(performance.now() - started);
    const userId = `u${++this.next}`, replyId = `a${++this.next}`;
    this.callbacks.onMessage({ id: userId, role: 'user', text });
    this.callbacks.onBusy(true);
    const status = await this.status();
    if (generation !== this.generation) return;
    const speak = this.voice && !!this.player;
    const metrics: TurnMetrics = { model: status.model, sentences: 0 };
    let shown = '', full = '';
    const show = (part: string) => { if (generation !== this.generation || !part) return; this.callbacks.onMessage({ id: replyId, role: 'assistant', text: part, append: shown.length > 0 }); shown += part; };
    // Oynatma zinciri: cümleler TTS'e paralel gider, sırayla ve boşluksuz çalınır; metin sesiyle birlikte görünür.
    let chain: Promise<void> = Promise.resolve(), playing: Promise<void> = Promise.resolve(), failed = false;
    const enqueue = (sentence: string, useTts: boolean) => {
      const clean = speakable(sentence); metrics.sentences++;
      if (!speak || !useTts || !clean || failed) { chain = chain.then(() => show((shown ? ' ' : '') + sentence)); return; }
      const first = metrics.sentences === 1;
      const audio = this.speech(clean.slice(0, 600), controller.signal, status.sampleRate).then(result => { if (first) metrics.ttsDone = since(); return result; });
      audio.catch(() => {});
      chain = chain.then(async () => {
        if (generation !== this.generation) return;
        try {
          const { buffer, timings } = await audio;
          if (generation !== this.generation) return;
          if (first) this.player!.onMouthStart = at => { if (metrics.mouthStart === undefined) { metrics.mouthStart = Math.round(at - started); this.callbacks.onMetrics?.({ ...metrics }); } };
          // Ses hazır olur olmaz kuyruğa girer (öncekinin bitmesi beklenmez); metin, sesi başladığı anda görünür.
          playing = this.player!.play(buffer, timings, () => show((shown ? ' ' : '') + sentence));
        } catch (error) {
          if (generation !== this.generation || controller.signal.aborted) return;
          failed = true; show((shown ? ' ' : '') + sentence); // ses alınamazsa metin yine görünür
          this.callbacks.onError((error as Error).message || 'Seslendirme alınamadı.');
        }
      });
    };
    try {
      if (!status.chat) { await this.demo(generation, show, speak); return; }
      const response = await fetch('/api/avatar/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, history: this.history }), signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? 'Yanıt alınamadı.');
      const splitter = new SentenceSplitter(), reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let pending = '';
      const handle = (event: { type: string; text?: string; error?: string; model?: string }) => {
        if (event.type === 'start' && event.model) metrics.model = event.model;
        if (event.type === 'error') throw new Error(event.error ?? 'Yanıt tamamlanamadı.');
        if (event.type !== 'delta' || !event.text) return;
        metrics.firstToken ??= since(); full += event.text;
        for (const sentence of splitter.push(event.text)) { metrics.firstSentence ??= since(); enqueue(sentence, status.tts); }
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += value;
        for (let index = pending.indexOf('\n\n'); index >= 0; index = pending.indexOf('\n\n')) {
          const line = pending.slice(0, index); pending = pending.slice(index + 2);
          if (line.startsWith('data: ')) handle(JSON.parse(line.slice(6)));
        }
      }
      for (const sentence of splitter.flush()) { metrics.firstSentence ??= since(); enqueue(sentence, status.tts); }
      this.history.push({ role: 'user', text }, { role: 'assistant', text: full.trim() });
      if (generation === this.generation) this.callbacks.onBusy(false);
      await chain; await playing;
      metrics.done = since();
      if (generation === this.generation) this.callbacks.onMetrics?.({ ...metrics });
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return;
      this.callbacks.onError((error as Error).message || 'Yanıt alınamadı.');
    } finally {
      if (generation === this.generation) { this.controller = undefined; this.callbacks.onBusy(false); }
    }
  }

  /** .env eksikken: kutu çalışır, avatar hazır bir cümleyi gömülü sesle söyler. */
  private async demo(generation: number, show: (text: string) => void, speak: boolean) {
    this.callbacks.onBusy(false);
    if (speak) try {
      const context = await this.player!.prepareAudio();
      const buffer = await context.decodeAudioData(await (await fetch(DEMO_AUDIO)).arrayBuffer());
      if (generation !== this.generation) return;
      await this.player!.play(buffer, await this.timing.getTimings({ buffer, text: DEMO_REPLY }), () => show(DEMO_REPLY)); return;
    } catch { /* Ses açılamazsa yalnızca metin gösterilir. */ }
    show(DEMO_REPLY);
  }
}
