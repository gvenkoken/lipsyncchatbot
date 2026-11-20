import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Video avatar: sohbet (akış), seslendirme ve konuşma tanıma; hepsi OpenAI.
// Anahtarlar yalnızca burada, sunucuda kullanılır; yanıtlara ve loglara yazılmaz.
export type AvatarConfig = {
  openaiApiKey: string; chatModel: string; ttsModel: string; ttsVoice: string; sttModel: string;
};
type Options = { getConfig: () => AvatarConfig; fetch?: typeof fetch; personaFile?: string; limits?: Partial<typeof LIMITS> };

export const AVATAR_DEFAULTS = { chatModel: 'gpt-5.4-mini', ttsModel: 'gpt-4o-mini-tts', ttsVoice: 'ash', sttModel: 'gpt-transcribe' };
const LIMITS = {
  messageChars: 2000, historyItems: 24, historyChars: 12000, ttsChars: 600, audioBytes: 4 * 1024 * 1024,
  chatPerMinute: 20, ttsPerMinute: 90, sttPerMinute: 20,
};
const TTS_INSTRUCTIONS = 'Doğal, akıcı İstanbul Türkçesiyle, samimi ve sakin genç bir erkek gibi konuş.';
export const TTS_SAMPLE_RATE = 24000; // OpenAI "pcm": 24 kHz, 16 bit, mono, başlıksız
const FALLBACK_PERSONA = 'Sen PMI Assistant adlı sesli bir asistansın. Türkçe, konuşma diliyle, bir ile üç kısa cümleyle ve düz metin olarak yanıt ver.';

export function createAvatarHandler(options: Options) {
  const request = options.fetch ?? fetch;
  const limits = { ...LIMITS, ...options.limits };
  const personaFile = options.personaFile ?? fileURLToPath(new URL('./persona.md', import.meta.url));
  let persona = { text: FALLBACK_PERSONA, mtime: -1 };
  const system = () => {
    try {
      const mtime = statSync(personaFile).mtimeMs;
      if (mtime !== persona.mtime) persona = { text: readFileSync(personaFile, 'utf8').trim() || FALLBACK_PERSONA, mtime };
    } catch { /* Dosya yoksa yerleşik kısa persona kullanılır. */ }
    return persona.text;
  };
  const hits = new Map<string, number[]>();
  const allowed = (req: IncomingMessage, kind: string, perMinute: number) => {
    const key = `${kind}:${req.socket.remoteAddress ?? ''}`, now = Date.now();
    const recent = (hits.get(key) ?? []).filter(time => now - time < 60000);
    if (recent.length >= perMinute) { hits.set(key, recent); return false; }
    recent.push(now); hits.set(key, recent);
    if (hits.size > 500) for (const [name, times] of hits) if (!times.some(time => now - time < 60000)) hits.delete(name);
    return true;
  };
  const json = (res: ServerResponse, status: number, body: unknown) => {
    if (res.headersSent) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const read = async (req: IncomingMessage, limit: number) => {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > limit) throw new Error('BODY_TOO_LARGE');
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  };
  // Yukarı akış hatalarında ayrıntı (olası kimlik bilgisi) iletilmez; yalnızca sınıf ve genel bir mesaj.
  const upstreamError = (status: number, provider: 'OpenAI') => ({
    code: status === 429 ? 'rate_limit' : status === 401 || status === 403 ? 'auth' : 'upstream_error',
    error: status === 429 ? `${provider} kullanım limiti doldu. Biraz sonra yeniden deneyin.`
      : status === 401 || status === 403 ? `${provider} erişimi doğrulanamadı. API anahtarını ve model yetkisini kontrol edin.`
      : status === 404 ? `${provider} modeli bulunamadı. .env.local içindeki model adını kontrol edin.`
      : `${provider} isteği tamamlanamadı. Yeniden deneyin.`,
  });

  async function chat(req: IncomingMessage, res: ServerResponse, config: AvatarConfig) {
    if (!config.openaiApiKey.trim()) { json(res, 503, { code: 'not_configured', error: 'Sohbet modeli henüz yapılandırılmadı.' }); return; }
    if (!allowed(req, 'chat', limits.chatPerMinute)) { json(res, 429, { code: 'rate_limit', error: 'Çok hızlı mesaj gönderiyorsunuz. Biraz bekleyin.' }); return; }
    let body: { message?: unknown; history?: unknown };
    try { body = JSON.parse((await read(req, 256 * 1024)).toString('utf8')) as typeof body; } catch (error) { json(res, error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 413 : 400, { error: 'İstek okunamadı.' }); return; }
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) { json(res, 400, { error: 'Mesaj boş olamaz.' }); return; }
    if (message.length > limits.messageChars) { json(res, 413, { error: `Mesaj en fazla ${limits.messageChars} karakter olabilir.` }); return; }
    // Geçmiş: yalnızca {role, text}; en yeni kayıtlar korunur, toplam uzunluk sınırlanır, ilk kayıt kullanıcıdan olur.
    const history: { role: 'user' | 'assistant'; content: string }[] = [];
    if (Array.isArray(body.history)) {
      let budget = limits.historyChars;
      for (const item of body.history.slice(-limits.historyItems).reverse()) {
        const entry = item as { role?: unknown; text?: unknown };
        if ((entry?.role !== 'user' && entry?.role !== 'assistant') || typeof entry.text !== 'string' || !entry.text.trim()) continue;
        const text = entry.text.trim().slice(0, limits.messageChars);
        if ((budget -= text.length) < 0) break;
        history.unshift({ role: entry.role, content: text });
      }
      while (history.length && history[0].role !== 'user') history.shift();
    }
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', abort);
    const send = (event: Record<string, unknown>) => { if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };
    let started = false;
    const open = () => { if (started) return; started = true; res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); };
    try {
      // OpenAI Responses API, akış (SSE). Sistem promptu persona.md'den gelir.
      const upstream = await request('https://api.openai.com/v1/responses', {
        method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
        headers: { Authorization: `Bearer ${config.openaiApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.chatModel, instructions: system(), input: [...history, { role: 'user', content: message }], stream: true, store: false }),
      });
      if (!upstream.ok || !upstream.body) { json(res, upstream.status >= 400 ? upstream.status : 502, upstreamError(upstream.status, 'OpenAI')); return; }
      const decoder = new TextDecoder(); let pending = '', finished = false, sawText = false;
      const handle = (data: string) => {
        if (!data || data === '[DONE]') return;
        const event = JSON.parse(data) as { type?: string; delta?: unknown; response?: { model?: string; status?: string } };
        if (event.type === 'response.created') { open(); send({ type: 'start', model: event.response?.model ?? config.chatModel }); }
        else if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') { open(); sawText = true; send({ type: 'delta', text: event.delta }); }
        else if (event.type === 'response.refusal.delta' && !sawText) { open(); sawText = true; send({ type: 'delta', text: 'Bu konuda yardımcı olamıyorum. Başka bir şey sormak ister misiniz?' }); }
        else if (event.type === 'response.completed' || event.type === 'response.incomplete') { open(); finished = true; send({ type: 'done', model: event.response?.model ?? config.chatModel, stop_reason: event.response?.status ?? 'completed' }); }
        else if (event.type === 'response.failed' || event.type === 'error') throw new Error('UPSTREAM_FAILED');
      };
      for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
        pending += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
        for (let index = pending.indexOf('\n\n'); index >= 0; index = pending.indexOf('\n\n')) {
          const block = pending.slice(0, index); pending = pending.slice(index + 2);
          for (const line of block.split('\n')) if (line.startsWith('data:')) handle(line.slice(5).trim());
        }
      }
      open(); if (!finished) send({ type: 'done', model: config.chatModel, stop_reason: 'completed' });
      res.end();
    } catch {
      if (res.destroyed || res.writableEnded) return;
      const payload = upstreamError(502, 'OpenAI');
      if (started) { send({ type: 'error', ...payload }); res.end(); } else json(res, 502, payload);
    } finally { res.off('close', abort); }
  }

  async function tts(req: IncomingMessage, res: ServerResponse, config: AvatarConfig) {
    if (!config.openaiApiKey.trim()) { json(res, 503, { code: 'not_configured', error: 'Seslendirme henüz yapılandırılmadı.' }); return; }
    if (!allowed(req, 'tts', limits.ttsPerMinute)) { json(res, 429, { code: 'rate_limit', error: 'Çok fazla seslendirme isteği. Biraz bekleyin.' }); return; }
    let text = '';
    try { text = String((JSON.parse((await read(req, 16 * 1024)).toString('utf8')) as { text?: unknown }).text ?? '').trim(); } catch { json(res, 400, { error: 'İstek okunamadı.' }); return; }
    if (!text) { json(res, 400, { error: 'Seslendirilecek metin boş.' }); return; }
    if (text.length > limits.ttsChars) { json(res, 413, { error: `Seslendirilecek metin en fazla ${limits.ttsChars} karakter olabilir.` }); return; }
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', abort);
    try {
      // PCM: tarayıcıda decode gecikmesi olmadan doğrudan AudioBuffer'a yazılır.
      const upstream = await request('https://api.openai.com/v1/audio/speech', {
        method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
        headers: { Authorization: `Bearer ${config.openaiApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.ttsModel, voice: config.ttsVoice, input: text, instructions: TTS_INSTRUCTIONS, response_format: 'pcm' }),
      });
      if (!upstream.ok || !upstream.body) { json(res, upstream.status >= 400 ? upstream.status : 502, upstreamError(upstream.status, 'OpenAI')); return; }
      res.writeHead(200, { 'Content-Type': 'audio/L16; rate=' + TTS_SAMPLE_RATE + '; channels=1', 'X-Sample-Rate': String(TTS_SAMPLE_RATE), 'Cache-Control': 'no-store' });
      for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) if (!res.destroyed) res.write(chunk);
      res.end();
    } catch {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) res.end(); else json(res, 502, upstreamError(502, 'OpenAI'));
    } finally { res.off('close', abort); }
  }

  async function stt(req: IncomingMessage, res: ServerResponse, config: AvatarConfig) {
    if (!config.openaiApiKey.trim()) { json(res, 503, { code: 'not_configured', error: 'Konuşma tanıma henüz yapılandırılmadı.' }); return; }
    if (!allowed(req, 'stt', limits.sttPerMinute)) { json(res, 429, { code: 'rate_limit', error: 'Çok fazla ses kaydı gönderildi. Biraz bekleyin.' }); return; }
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const extension = ({ 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' } as Record<string, string>)[type];
    if (!extension) { json(res, 415, { error: 'Desteklenmeyen ses biçimi.' }); return; }
    let audio: Buffer;
    try { audio = await read(req, limits.audioBytes); } catch { json(res, 413, { error: 'Ses kaydı çok uzun. Daha kısa konuşun.' }); return; }
    if (audio.length < 800) { json(res, 400, { error: 'Ses kaydı boş.' }); return; }
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(audio)], { type }), `kayit.${extension}`);
    form.set('model', config.sttModel); form.set('language', 'tr'); form.set('response_format', 'json');
    try {
      const upstream = await request('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${config.openaiApiKey}` }, body: form, signal: AbortSignal.timeout(30000) });
      if (!upstream.ok) { json(res, upstream.status, upstreamError(upstream.status, 'OpenAI')); return; }
      const result = await upstream.json() as { text?: unknown };
      json(res, 200, { text: typeof result.text === 'string' ? result.text.trim().slice(0, limits.messageChars) : '' });
    } catch { json(res, 502, upstreamError(502, 'OpenAI')); }
  }

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0];
    if (!path?.startsWith('/api/avatar/')) { next(); return; }
    res.setHeader('Cache-Control', 'no-store');
    const config = options.getConfig();
    if (path === '/api/avatar/status' && req.method === 'GET') {
      json(res, 200, { chat: !!config.openaiApiKey.trim(), tts: !!config.openaiApiKey.trim(), stt: !!config.openaiApiKey.trim(), model: config.chatModel, voice: config.ttsVoice, sampleRate: TTS_SAMPLE_RATE,
        limits: { messageChars: limits.messageChars, ttsChars: limits.ttsChars } }); return;
    }
    const route = ({ '/api/avatar/chat': chat, '/api/avatar/tts': tts, '/api/avatar/stt': stt } as Record<string, typeof chat>)[path];
    if (!route) { json(res, 404, { error: 'Bulunamadı.' }); return; }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: 'POST gerekli.' }); return; }
    // Bu demo yalnızca yerelde çalışır; ücretli çağrılar bu sayfadan gelmelidir.
    let sameOrigin = false;
    try {
      const origin = new URL(req.headers.origin ?? '');
      sameOrigin = origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname) && origin.host === req.headers.host;
    } catch { /* Eksik ya da geçersiz origin reddedilir. */ }
    if (!sameOrigin) { json(res, 403, { error: 'Bu bağlantıya izin verilmiyor.' }); return; }
    try { await route(req, res, config); }
    catch { if (!res.destroyed && !res.writableEnded) { if (res.headersSent) res.end(); else json(res, 502, { error: 'İstek tamamlanamadı. Yeniden deneyin.' }); } }
  };
}
