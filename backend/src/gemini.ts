import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import WebSocket, { WebSocketServer } from 'ws';
import { parseRole, selectHits, toolResult, type Rag, type Role } from './rag.ts';
import { fill, loadPrompts } from './rag-prompt.ts';

export type GeminiConfig = { project: string; location: string; model: string; avatar: string; credentialsFile: string };
/** Demo oturumu: ad ve rol istemciden gelir (gerçek kimlik doğrulama değildir). */
export type GeminiUser = { name: string; role: Role };
export const SEARCH_TOOL = 'bilgi_tabaninda_ara';
const ROLE_TEXT: Record<Role, string> = { employee: 'çalışan', partner: 'iş ortağı (bayi)', guest: 'giriş yapmamış misafir' };
export const cleanName = (value: unknown) => typeof value === 'string' ? value.replace(/[^\p{L}\p{M} .'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40) : '';
/** Sistem talimatı: kimlik, konuşma biçimi, kullanıcı ve bilgi tabanı kuralları. Metinler rag-prompt.md'den gelir. */
export function geminiInstruction(user?: GeminiUser) {
  const prompts = loadPrompts();
  if (!user) return prompts.kimlik;
  const values = { ad: user.name, rol: ROLE_TEXT[user.role], arac: SEARCH_TOOL };
  const sections = [prompts.kimlik, user.name ? prompts.kullanici_adli : prompts.kullanici, prompts.bilgi_tabani, ...(user.role === 'guest' ? [prompts.misafir] : []), prompts.kurallar];
  return sections.map(text => fill(text, values)).join('\n');
}
type Options = { rag?: Rag; getConfig: () => GeminiConfig; getToken?: (config: GeminiConfig) => Promise<string | null>; credentialsAvailable?: (config: GeminiConfig) => boolean; connect?: (url: string, token: string) => WebSocket; sessionLifetimeMs?: number };
const projectPattern = /^[a-z][a-z\d-]{4,61}[a-z\d]$/;
const locations = ['us-central1'];
const sameOrigin = (req: IncomingMessage) => {
  try { const origin = new URL(req.headers.origin ?? ''); return origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname) && origin.host === req.headers.host; }
  catch { return false; }
};
export function hasGeminiCredentials(config: GeminiConfig) {
  const file = config.credentialsFile || process.env.GOOGLE_APPLICATION_CREDENTIALS || join(process.env.APPDATA || join(homedir(), '.config'), 'gcloud', 'application_default_credentials.json');
  return existsSync(file);
}
export function geminiStatus(config: GeminiConfig, credentials = hasGeminiCredentials(config)) {
  const missing = [!projectPattern.test(config.project) && 'GOOGLE_CLOUD_PROJECT', !credentials && 'GOOGLE_CLOUD_AUTH', !locations.includes(config.location) && 'GOOGLE_CLOUD_LOCATION', config.model !== 'gemini-3.8-live' && 'GEMINI_LIVE_MODEL', !/^[A-Za-z]{1,40}$/.test(config.avatar) && 'GEMINI_AVATAR_NAME'].filter((value): value is string => !!value);
  return { configured: missing.length === 0, missing, model: config.model, avatar: config.avatar };
}
export function buildGeminiSetup(config: GeminiConfig, user?: GeminiUser) {
  const prompts = loadPrompts();
  return { setup: {
    model: `projects/${config.project}/locations/${config.location}/publishers/google/models/${config.model}`,
    generation_config: { response_modalities: ['VIDEO'], speech_config: { language_code: 'tr-TR', voice_config: { prebuilt_voice_config: { voice_name: 'Puck' } } } },
    avatar_config: { avatar_name: config.avatar },
    system_instruction: { parts: [{ text: geminiInstruction(user) }] },
    ...(user ? { tools: [{ function_declarations: [{ name: SEARCH_TOOL, description: prompts.arac_aciklamasi, parameters: { type: 'OBJECT', properties: { sorgu: { type: 'STRING', description: prompts.arac_sorgu_aciklamasi } }, required: ['sorgu'] } }] }] } : {}),
    input_audio_transcription: {}, output_audio_transcription: {},
    realtime_input_config: { automatic_activity_detection: { silence_duration_ms: 650, prefix_padding_ms: 200 }, activity_handling: 'START_OF_ACTIVITY_INTERRUPTS' },
  } };
}
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' ? value as RecordValue : {};
const field = (obj: RecordValue, camel: string, snake: string) => obj[camel] ?? obj[snake];

export function createGeminiHandler(options: Options) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 32768 });
  const active = new Set<() => void>();
  const credentials = options.credentialsAvailable ?? hasGeminiCredentials;
  const getToken = options.getToken ?? (async config => {
    const auth = new GoogleAuth({ projectId: config.project, keyFilename: config.credentialsFile || undefined, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    return auth.getAccessToken();
  });
  const connect = options.connect ?? ((url, token) => new WebSocket(url, { headers: { Authorization: `Bearer ${token}` }, maxPayload: 8 * 1024 * 1024, handshakeTimeout: 15000 }));
  const json = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0];
    if (!path?.startsWith('/api/gemini/')) { next(); return; }
    if (path === '/api/gemini/status' && req.method === 'GET') { const config = options.getConfig(); json(res, 200, geminiStatus(config, credentials(config))); return; }
    json(res, 404, { error: 'Bulunamadı.' });
  };
  sockets.on('connection', (client, req) => {
    let upstream: WebSocket | undefined, ended = false, ready = false;
    // Demo oturumu: ad ve rol bağlantı adresinden okunur. Bilgi tabanı yoksa araç da tanımlanmaz.
    const params = new URL(req.url ?? '', 'http://localhost').searchParams;
    const user: GeminiUser | undefined = options.rag ? { name: cleanName(params.get('name')), role: parseRole(params.get('role')) } : undefined;
    const answerTools = async (calls: unknown[]) => {
      const responses = [], shown: { id: string; title: string }[] = [];
      for (const raw of calls) {
        const call = record(raw), args = record(call.args), query = typeof args.sorgu === 'string' ? args.sorgu : typeof args.query === 'string' ? args.query : '';
        if (call.name !== SEARCH_TOOL || !user || !options.rag) { responses.push({ id: call.id, name: call.name, response: { hata: 'Bilinmeyen araç.' } }); continue; }
        const { context, sources } = selectHits(query.trim() ? await options.rag.search(query, user.role, 3).catch(() => []) : []);
        for (const hit of sources) if (!shown.some(item => item.id === hit.id)) shown.push({ id: hit.id, title: hit.title });
        responses.push({ id: call.id, name: call.name, response: toolResult(context, user.role) });
      }
      if (ended || upstream?.readyState !== WebSocket.OPEN) return;
      upstream.send(JSON.stringify({ tool_response: { function_responses: responses } }));
      if (shown.length) send({ type: 'sources', sources: shown.slice(0, 2) });
    };
    let inputId = `gemini_${randomUUID()}`, outputId = `gemini_${randomUUID()}`;
    let inputText = '', outputText = '';
    const send = (event: object) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(event)); };
    const stop = () => {
      if (ended) return; ended = true; clearTimeout(startup); clearTimeout(lifetime); active.delete(stop);
      if (upstream) { if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate(); else upstream.close(); }
      if (client.readyState === WebSocket.OPEN) client.close(1000, 'Session ended');
    };
    const fail = (code: string, message: string) => { send({ type: 'error', code, error: message }); stop(); };
    const startup = setTimeout(() => fail('timeout', 'Gemini bağlantısı zaman aşımına uğradı. Yeniden deneyebilirsiniz.'), 30000); startup.unref();
    const lifetime = setTimeout(() => fail('session_limit', 'Gemini görüşmesi süre sınırına ulaştı. Yeniden başlatabilirsiniz.'), options.sessionLifetimeMs ?? 9 * 60 * 1000); lifetime.unref();
    active.add(stop);
    if (active.size > 1) { fail('busy', 'Önce açık Gemini görüşmesini kapatın.'); return; }
    client.on('close', stop); client.on('error', stop);
    client.on('message', (data, binary) => {
      if (!ready || upstream?.readyState !== WebSocket.OPEN) return;
      if (upstream.bufferedAmount > 1024 * 1024) { fail('backpressure', 'Gemini ses bağlantısı yavaşladı. Yeniden başlatın.'); return; }
      if (binary) {
        const buffer = Buffer.from(data as Buffer);
        if (!buffer.length || buffer.length > 16384 || buffer.length % 2) { fail('invalid_audio', 'Mikrofon ses biçimi geçersiz.'); return; }
        upstream.send(JSON.stringify({ realtime_input: { audio: { data: buffer.toString('base64'), mime_type: 'audio/pcm;rate=16000' } } })); return;
      }
      try {
        const event = record(JSON.parse(data.toString()));
        if (event.type === 'stop') { stop(); return; }
        if (event.type !== 'text' || typeof event.text !== 'string' || !event.text.trim() || event.text.length > 2000) return;
        // Yazılı soruda arama sunucuda yapılır ve sonuç soruyla birlikte modele verilir: model aracı çağırmayı
        // atlasa da yanıt belgeye dayanır. Sesli soruda metin önceden bilinmediği için arama araç çağrısıyla yapılır.
        const text = event.text;
        const forward = (context: string) => { if (!ended && upstream?.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ client_content: { turns: [{ role: 'user', parts: [{ text: text + context }] }], turn_complete: true } })); };
        send({ type: 'mode', mode: 'thinking' });
        if (!user || !options.rag) { forward(''); return; }
        const role = user.role;
        void options.rag.search(text, role, 3).catch(() => []).then(hits => {
          const { context, sources } = selectHits(hits);
          forward(context.length ? `

[${fill(loadPrompts().yazili_soru_notu, { arac: SEARCH_TOOL })} ${JSON.stringify(toolResult(context, role))}]` : '');
          if (sources.length) send({ type: 'sources', sources: sources.map(hit => ({ id: hit.id, title: hit.title })) });
        });
      } catch { fail('invalid_message', 'Gemini isteği okunamadı.'); }
    });
    const onUpstreamMessage = (data: WebSocket.RawData) => {
      if (ended) return;
      try {
        const message = record(JSON.parse(data.toString()));
        if (message.error) { fail('google_error', 'Google Cloud erişimi doğrulanamadı. Model, bölge, Vertex AI API ve Live Avatar erişimini kontrol edin.'); return; }
        if (field(message, 'setupComplete', 'setup_complete')) {
          ready = true; clearTimeout(startup); send({ type: 'ready' });
          // Generate the first video frames without waiting for microphone speech.
          upstream?.send(JSON.stringify({ realtime_input: { text: user?.name ? `Kullanıcıyı adıyla (${user.name}) kısaca Türkçe selamla ve dinle.` : 'Kısaca Türkçe merhaba de ve kullanıcıyı dinle.' } }));
        }
        const calls = field(record(field(message, 'toolCall', 'tool_call')), 'functionCalls', 'function_calls');
        if (Array.isArray(calls) && calls.length) { send({ type: 'mode', mode: 'thinking' }); void answerTools(calls).catch(() => fail('tool_error', 'Bilgi tabanı araması tamamlanamadı. Yeniden deneyebilirsiniz.')); }
        const content = record(field(message, 'serverContent', 'server_content'));
        if (content.interrupted) { send({ type: 'interrupted' }); outputId = `gemini_${randomUUID()}`; outputText = ''; }
        const turn = record(field(content, 'modelTurn', 'model_turn'));
        for (const raw of Array.isArray(turn.parts) ? turn.parts : []) {
          const inline = record(field(record(raw), 'inlineData', 'inline_data'));
          if (typeof inline.data !== 'string') continue;
          const mime = field(inline, 'mimeType', 'mime_type');
          if (typeof mime !== 'string' || !/^(video|application)\/mp4/.test(mime)) { fail('unexpected_media', 'Gemini canlı avatar videosu göndermedi. Projenin Live Avatar erişimini kontrol edin.'); return; }
          const bytes = Buffer.from(inline.data, 'base64');
          if (client.bufferedAmount + bytes.length > 8 * 1024 * 1024) { fail('backpressure', 'Gemini video bağlantısı yavaşladı. Yeniden başlatın.'); return; }
          if (client.readyState === WebSocket.OPEN) client.send(bytes, { binary: true });
        }
        const input = record(field(content, 'inputTranscription', 'input_transcription'));
        if (typeof input.text === 'string' && input.text) {
          inputText += input.text; send({ type: 'message', id: inputId, role: 'user', text: inputText });
          if (input.finished) { inputId = `gemini_${randomUUID()}`; inputText = ''; }
        }
        const output = record(field(content, 'outputTranscription', 'output_transcription'));
        if (typeof output.text === 'string' && output.text) { outputText += output.text; send({ type: 'message', id: outputId, role: 'assistant', text: outputText }); }
        if (field(content, 'turnComplete', 'turn_complete')) {
          send({ type: 'turn_complete' }); outputId = `gemini_${randomUUID()}`; outputText = '';
          if (inputText) { inputId = `gemini_${randomUUID()}`; inputText = ''; }
        }
        if (field(message, 'goAway', 'go_away')) fail('session_limit', 'Google bu görüşmeyi sonlandırıyor. Yeniden başlatabilirsiniz.');
      } catch { fail('invalid_response', 'Gemini yanıtı okunamadı.'); }
    };
    void (async () => {
      const config = options.getConfig();
      if (!sameOrigin(req)) { fail('origin', 'Bu bağlantıya izin verilmiyor.'); return; }
      if (!geminiStatus(config, credentials(config)).configured) { fail('not_configured', 'Gemini için Google Cloud projesi ve yerel kimlik doğrulaması henüz yapılandırılmadı.'); return; }
      try {
        const token = await getToken(config); if (ended) return;
        if (!token) { fail('authentication', 'Google Cloud kimlik doğrulamasını tamamlayın.'); return; }
        const url = `wss://${config.location}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`;
        upstream = connect(url, token);
        upstream.once('open', () => { if (!ended) upstream?.send(JSON.stringify(buildGeminiSetup(config, user))); });
        upstream.on('message', onUpstreamMessage);
        upstream.on('error', () => fail('connection', 'Google Cloud bağlantısı kurulamadı. Proje yetkilerini ve Live Avatar erişimini kontrol edin.'));
        upstream.on('close', code => {
          if (!ended) fail('upstream_closed', code === 1007 || code === 1008 ? 'Gemini Live Avatar oturumu reddedildi. Model, avatar ve projenin Live Avatar erişimini kontrol edin.' : 'Gemini bağlantısı sona erdi. Yeniden başlatabilirsiniz.');
        });
      } catch { if (!ended) fail('authentication', 'Google Cloud oturumu açılamadı. gcloud ile yerel kimlik doğrulamasını tamamlayın.'); }
    })();
  });
  const attach = (server: EventEmitter) => {
    const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (req.url?.split('?')[0] !== '/api/gemini/live') return;
      if (!sameOrigin(req)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
      sockets.handleUpgrade(req, socket, head, client => sockets.emit('connection', client, req));
    };
    server.on('upgrade', upgrade);
    return () => server.off('upgrade', upgrade);
  };
  return { handler, attach, dispose: () => { for (const stop of active) stop(); sockets.close(); } };
}
